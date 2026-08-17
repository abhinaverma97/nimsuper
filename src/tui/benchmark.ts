import type { FallbackModel, ProviderId } from "../types.js";
import { state, callRenderApp } from "./state.js";
import { getAntigravityHeaders, getOrRefreshAntigravityAccessToken } from "../antigravity.js";

const NIM_CHAT_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const GEMINI_STREAM_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const ANTIGRAVITY_STREAM_URL = "https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";
const FETCH_TIMEOUT_MS = 30_000;
const STREAM_CHUNK_TIMEOUT_MS = 30_000;
const TPS_UPDATE_INTERVAL_MS = 2_000;
const SPINNER_INTERVAL_MS = 80;
const CHARS_PER_TOKEN = 4;

export interface BenchmarkMetrics {
  ttfb: number | undefined;
  tps: number | undefined;
  tokenCount: number;
}

export type BenchmarkPhase = "idle" | "connecting" | "streaming" | "done" | "error" | "cancelled";

export interface BenchmarkState {
  phase: BenchmarkPhase;
  metrics: BenchmarkMetrics;
  error: string | undefined;
}

export class BenchmarkRunner {
  private generation = 0;
  private controller: AbortController | null = null;
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;
  private _phase: BenchmarkPhase = "idle";
  private _metrics: BenchmarkMetrics = {
    ttfb: undefined,
    tps: undefined,
    tokenCount: 0,
  };
  private _error: string | undefined;
  private _modelId: string | undefined;
  private _cancelled = false;
  private lastGoodTps: number | undefined;
  private provider: ProviderId;

  constructor(provider: ProviderId) {
    this.provider = provider;
  }

  private setTps(value: number | undefined): void {
    if (value != null && Number.isFinite(value) && value >= 0) {
      this._metrics.tps = value;
      this.lastGoodTps = value;
    } else if (this.lastGoodTps != null) {
      this._metrics.tps = this.lastGoodTps;
    }
  }

  get phase(): BenchmarkPhase {
    return this._phase;
  }

  get metrics(): BenchmarkMetrics {
    return { ...this._metrics };
  }

  get error(): string | undefined {
    return this._error;
  }

  get modelId(): string | undefined {
    return this._modelId;
  }

  get isRunning(): boolean {
    return this._phase === "connecting" || this._phase === "streaming";
  }

  getState(): BenchmarkState {
    return {
      phase: this._phase,
      metrics: { ...this._metrics },
      error: this._error,
    };
  }

  cancel(): void {
    this._cancelled = true;
    if (this.controller) {
      this.controller.abort();
    }
    this.teardown();
    this._phase = "cancelled";
    this._error = undefined;
  }

  async run(model: FallbackModel, apiKey: string): Promise<BenchmarkState> {
    this.cancel();
    this.generation++;
    const gen = this.generation;
    this._cancelled = false;

    this.controller = new AbortController();
    this._phase = "connecting";
    this._metrics = { ttfb: undefined, tps: undefined, tokenCount: 0 };
    this._error = undefined;
    this._modelId = model.id;

    this.startSpinner();

    try {
      await this.execute(model, apiKey, gen);

      if (this.generation !== gen) {
        return this.getState();
      }

      this._phase = "done";
    } catch (err) {
      if (this.generation !== gen) {
        return this.getState();
      }

      if (this._cancelled) {
        this._phase = "cancelled";
        this._error = undefined;
      } else {
        this._phase = "error";
        this._error = err instanceof Error ? err.message : "Benchmark failed";
      }
    } finally {
      if (this.generation === gen) {
        this.teardown();
      }
    }

    return this.getState();
  }

  applyResultToModel(model: FallbackModel): void {
    if (this._phase === "done") {
      model.benchmarkStatus = "done";
      model.benchmarkTtfb =
        this._metrics.ttfb != null && Number.isFinite(this._metrics.ttfb)
          ? this._metrics.ttfb
          : undefined;
      model.benchmarkTps =
        this._metrics.tps != null &&
        Number.isFinite(this._metrics.tps) &&
        this._metrics.tps > 0
          ? this._metrics.tps
          : undefined;
      if (model.benchmarkTps == null) {
        model.benchmarkStatus = "error";
        model.benchmarkError = "TPS calculation failed";
      }
    } else if (this._phase === "error") {
      model.benchmarkStatus = "error";
      model.benchmarkError = this._error;
    } else if (this._phase === "cancelled") {
      model.benchmarkStatus = "idle";
      delete model.benchmarkTtfb;
      delete model.benchmarkTps;
      delete model.benchmarkError;
    }
  }

  resetModel(model: FallbackModel): void {
    model.benchmarkStatus = "idle";
    delete model.benchmarkTtfb;
    delete model.benchmarkTps;
    delete model.benchmarkError;
  }

  private async execute(model: FallbackModel, apiKey: string, gen: number): Promise<void> {
    const signal = this.controller!.signal;
    const startTime = Date.now();

    const fetchTimeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const combinedSignal = AbortSignal.any([signal, fetchTimeout]);

    let url: string;
    let headers: Record<string, string>;
    let body: string;

    let res: Response;
    if (this.provider === "nvidia") {
      url = NIM_CHAT_URL;
      headers = {
        Authorization: `Bearer ${apiKey}`,
        authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      };
      body = JSON.stringify({
        model: model.id,
        messages: [
          {
            role: "user",
            content: "Write a function that takes an array of integers and returns the two numbers that sum to a given target. Explain your approach.",
          },
        ],
        max_tokens: 1024,
        stream: true,
      });
      res = await fetch(url, { method: "POST", headers, body, signal: combinedSignal });
    } else if (this.provider === "antigravity") {
      const auth = await getOrRefreshAntigravityAccessToken(apiKey);
      if (!auth) {
        throw new Error("Failed to resolve Antigravity access token");
      }
      headers = {
        ...getAntigravityHeaders(auth.accessToken),
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      };
      const cleanModelId = model.id.replace(/^antigravity-/, "");
      body = JSON.stringify({
        project: auth.projectId || "rising-fact-p41fc",
        model: cleanModelId,
        request: {
          model: cleanModelId,
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: "Write a function that takes an array of integers and returns the two numbers that sum to a given target. Explain your approach.",
                },
              ],
            },
          ],
          generationConfig: { maxOutputTokens: 1024 },
        },
        requestType: "agent",
        userAgent: "antigravity",
      });

      const endpoints = [
        "https://daily-cloudcode-pa.sandbox.googleapis.com",
        "https://cloudcode-pa.googleapis.com",
      ];

      let lastRes: Response | null = null;
      for (const ep of endpoints) {
        url = `${ep}/v1internal:streamGenerateContent?alt=sse`;
        lastRes = await fetch(url, { method: "POST", headers, body, signal: combinedSignal });
        if (lastRes.ok) break;
      }
      if (!lastRes) throw new Error("No response from Antigravity endpoints");
      res = lastRes;
    } else {
      url = `${GEMINI_STREAM_URL}/${model.id}:streamGenerateContent?key=${apiKey}`;
      headers = { "Content-Type": "application/json" };
      body = JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: "Write a function that takes an array of integers and returns the two numbers that sum to a given target. Explain your approach.",
              },
            ],
          },
        ],
        generationConfig: { maxOutputTokens: 1024 },
      });
      res = await fetch(url, { method: "POST", headers, body, signal: combinedSignal });
    }

    if (this.generation !== gen) return;

    const firstByteTime = Date.now();
    this._metrics.ttfb = firstByteTime - startTime;
    this._phase = "streaming";
    callRenderApp();

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error("Response body is empty");
    }

    await this.readStream(reader, gen, firstByteTime);
  }

  private async readStream(
    reader: {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      cancel(): Promise<void>;
      releaseLock(): void;
    },
    gen: number,
    ttfbTime: number,
  ): Promise<void> {
    let streamStart = 0;
    let lastTpsUpdate = 0;
    let charCount = 0;
    let contentChunks = 0;
    let buffer = "";
    const decoder = new TextDecoder();
    let chunkTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const resetChunkTimeout = () => {
      if (chunkTimeoutId) clearTimeout(chunkTimeoutId);
      chunkTimeoutId = setTimeout(() => {
        try {
          reader.cancel();
        } catch {}
      }, STREAM_CHUNK_TIMEOUT_MS);
    };

    resetChunkTimeout();

    try {
      while (true) {
        if (this.generation !== gen) return;

        let chunk: { done: boolean; value?: Uint8Array };
        try {
          chunk = await reader.read();
        } catch (e) {
          if (e instanceof Error && (e.name === "AbortError" || e.name === "CanceledError")) {
            throw new Error("Stream timeout");
          }
          throw e;
        }

        if (this.generation !== gen) return;

        const { done, value } = chunk;
        if (done) break;

        resetChunkTimeout();

        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              let content: string | undefined;
              if (this.provider === "nvidia") {
                content = parsed?.choices?.[0]?.delta?.content;
              } else if (this.provider === "antigravity") {
                const candidate = parsed?.response?.candidates?.[0] ?? parsed?.candidates?.[0];
                content = candidate?.content?.parts?.[0]?.text;
              } else {
                content = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
              }
              if (content) {
                charCount += content.length;
                contentChunks++;
                if (streamStart === 0) {
                  streamStart = ttfbTime;
                }
              }
            } catch {}
          }
        }

        if (charCount === 0 || contentChunks < 2) continue;

        const estimatedTokens = Math.max(1, Math.round(charCount / CHARS_PER_TOKEN));
        this._metrics.tokenCount = estimatedTokens;

        const now = Date.now();
        const elapsed = Math.max(1, now - streamStart);
        const calculatedTps = (estimatedTokens / elapsed) * 1000;

        if (lastTpsUpdate === 0) {
          this.setTps(calculatedTps);
          lastTpsUpdate = now;
          callRenderApp();
        } else if (now - lastTpsUpdate >= TPS_UPDATE_INTERVAL_MS) {
          this.setTps(calculatedTps);
          lastTpsUpdate = now;
          callRenderApp();
        }
      }
    } finally {
      if (chunkTimeoutId) clearTimeout(chunkTimeoutId);
      try {
        reader.releaseLock();
      } catch {}
    }

    if (charCount > 0 && streamStart > 0) {
      const finalTokens = Math.max(1, Math.round(charCount / CHARS_PER_TOKEN));
      this._metrics.tokenCount = finalTokens;
      const streamDuration = Math.max(1, Date.now() - streamStart);
      this.setTps((finalTokens / streamDuration) * 1000);
    }
  }

  private startSpinner(): void {
    this.stopSpinner();
    this.spinnerInterval = setInterval(() => {
      if (this.isRunning && state.currentScreen === "fallback-chain") {
        callRenderApp();
      } else if (!this.isRunning) {
        this.stopSpinner();
      }
    }, SPINNER_INTERVAL_MS);
  }

  private stopSpinner(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
  }

  private teardown(): void {
    this.stopSpinner();
    this.controller = null;
  }
}