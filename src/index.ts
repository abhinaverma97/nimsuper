import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin";
import {
  loadStore,
  saveStore,
  addKey,
  getNextKey,
  getActiveKeys,
  getDefaultStore,
  recordRateLimit,
  resetRateLimit,
  recordModelRateLimit,
} from "./storage.js";
import type { KeyStore, KeyStoreConfig, FallbackModel } from "./types.js";
import {
  extractStatus,
  describeError,
  is429Error,
  isStatusMessageRateLimited,
  shouldRetryForError,
  type SessionState,
} from "./errors.js";

const PROVIDER_ID = "nvidia";
const NIM_BASE_URL = "https://integrate.api.nvidia.com";
const VALID_STRATEGIES = ["round-robin", "least-failures"] as const;

function isValidStrategy(
  val: unknown,
): val is KeyStoreConfig["rotationStrategy"] {
  return val === "round-robin" || val === "least-failures";
}

function modelKey(model: { providerID: string; modelID: string }): string {
  return `${model.providerID}/${model.modelID}`;
}

async function isSubagentSession(
  client: PluginInput["client"],
  sessionID: string,
): Promise<boolean> {
  try {
    const res = await (
      client.session as unknown as {
        get: (p: { path: { id: string } }) => Promise<unknown>;
      }
    ).get({ path: { id: sessionID } });
    const data =
      res && typeof res === "object" && "data" in res
        ? (res as { data: unknown }).data
        : res;
    if (!data || typeof data !== "object") return false;
    return (data as Record<string, unknown>)?.parentID !== undefined;
  } catch (err) {
    console.debug(
      `[nimsuper] isSubagentSession failed for ${sessionID}:`,
      err,
    );
    return false;
  }
}

const SUBAGENT_CACHE_MAX_SIZE = 1000;
const SUBAGENT_CACHE_TTL_MS = 60_000;
const ERROR_DEDUP_WINDOW_MS = 500;
const SESSIONS_MAX_SIZE = 500;
const SESSIONS_MAX_AGE_MS = 10 * 60 * 1000;

const subAgentCache = new Map<string, number>();

async function isSubagentSessionCached(
  client: PluginInput["client"],
  sessionID: string,
): Promise<boolean> {
  const cached = subAgentCache.get(sessionID);
  if (cached !== undefined) {
    if (cached > Date.now()) {
      return true;
    }
    subAgentCache.delete(sessionID);
  }
  const result = await isSubagentSession(client, sessionID);
  if (result) {
    if (subAgentCache.size >= SUBAGENT_CACHE_MAX_SIZE) {
      const firstKey = subAgentCache.keys().next().value;
      if (firstKey !== undefined) {
        subAgentCache.delete(firstKey);
      }
    }
    subAgentCache.set(sessionID, Date.now() + SUBAGENT_CACHE_TTL_MS);
  }
  return result;
}

function findChainIndex(
  chain: FallbackModel[],
  model: { providerID: string; modelID: string } | undefined,
): number {
  if (!model) return -1;
  return chain.findIndex((entry) => entry.id === model.modelID);
}

export const NvidiaNimKeyRotator: Plugin = async (
  input: PluginInput,
  options?: Record<string, unknown>,
) => {
  const client = input.client;
  const config: KeyStoreConfig = {
    storePath: options?.storePath as string | undefined,
    rotationStrategy: isValidStrategy(options?.rotationStrategy)
      ? options!.rotationStrategy
      : "round-robin",
  };

  const store = loadStore(config) ?? getDefaultStore();
  if (!Array.isArray(store.fallbackChain)) store.fallbackChain = [];

  const sessions = new Map<string, SessionState>();

  const reloadFromDisk = () => {
    let fresh: KeyStore | null = null;
    try {
      fresh = loadStore(config);
    } catch (err) {
      console.debug("[nimsuper] Failed to reload store from disk:", err);
      return;
    }
    if (fresh === null) return;
    try {
      store.keys = fresh.keys;
      store.currentIndex = fresh.currentIndex;
      store.rotationStrategy = fresh.rotationStrategy;
      store.updatedAt = fresh.updatedAt;
      store.lastUsedKeyId = fresh.lastUsedKeyId;
      store.fallbackChain = Array.isArray(fresh.fallbackChain)
        ? fresh.fallbackChain
        : [];
      store.maxRateLimitFailures =
        typeof fresh.maxRateLimitFailures === "number" &&
        Number.isFinite(fresh.maxRateLimitFailures) &&
        fresh.maxRateLimitFailures >= 1
          ? fresh.maxRateLimitFailures
          : getDefaultStore().maxRateLimitFailures;
    } catch (err) {
      console.debug("[nimsuper] Failed to apply reloaded store:", err);
    }
  };

  const safeSaveStore = () => {
    try {
      saveStore(store, config);
    } catch (err) {
      console.error("[nimsuper] Failed to save store:", err);
    }
  };

  const activeKeys = getActiveKeys(store);

  if (activeKeys.length === 0) {
    const envKey = process.env.NVIDIA_API_KEY;
    if (envKey) {
      const existing = store.keys.find((k) => k.name === "env-default");
      if (!existing) {
        addKey(store, "env-default", envKey);
        safeSaveStore();
      }
    }
  }

  const showToast = async (
    variant: "success" | "info" | "warning" | "error",
    message: string,
  ) => {
    try {
      await client.tui?.showToast?.({
        body: { title: "Model Fallback", message, variant },
      });
    } catch (err) {
      console.debug("[nimsuper] showToast failed:", err);
    }
  };

  const getState = (sessionID: string): SessionState => {
    const existing = sessions.get(sessionID);
    if (existing) return existing;
    if (sessions.size >= SESSIONS_MAX_SIZE) {
      const now = Date.now();
      let oldestId: string | undefined;
      let oldestTime = Infinity;
      for (const [id, s] of sessions) {
        if (s.createdAt < oldestTime) {
          oldestTime = s.createdAt;
          oldestId = id;
        }
      }
      if (oldestId) sessions.delete(oldestId);
      for (const [id, s] of sessions) {
        if (now - s.createdAt > SESSIONS_MAX_AGE_MS) {
          sessions.delete(id);
        }
      }
    }
    const next: SessionState = {
      attemptIndex: 0,
      inRetry: false,
      aborting: false,
      pendingRetryIndex: undefined,
      lastUserMessageID: undefined,
      activeChainKey: undefined,
      activeChainModelId: undefined,
      rateLimitCount: 0,
      currentModelId: undefined,
      lastFailedModelId: undefined,
      lastErrorHandledAt: 0,
      createdAt: Date.now(),
    };
    sessions.set(sessionID, next);
    return next;
  };

  const cleanupSession = (sessionID: string) => {
    sessions.delete(sessionID);
  };

  const waitForSessionIdle = async (
    sessionID: string,
    timeoutMs: number = 2000,
  ): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await client.session.status({});
        const data =
          res && typeof res === "object" && "data" in res
            ? (res as { data: unknown }).data
            : res;
        if (data && typeof data === "object") {
          const statusMap = data as Record<string, unknown>;
          const status = statusMap[sessionID] as
            | Record<string, unknown>
            | undefined;
          if (status?.type === "idle") {
            return true;
          }
          if (!status) {
            return true;
          }
        }
      } catch {
        // status endpoint might not be available, keep polling
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    console.debug(
      `[nimsuper] waitForSessionIdle timed out for ${sessionID}`,
    );
    return false;
  };

  const triggerRetry = async (
    sessionID: string,
    state: SessionState,
    reason?: string,
  ): Promise<boolean> => {
    const chain = store.fallbackChain;
    if (chain.length < 2) return false;

    let nextIndex = (state.attemptIndex + 1) % chain.length;
    if (
      state.lastFailedModelId &&
      chain[nextIndex]?.id === state.lastFailedModelId &&
      chain.length > 2
    ) {
      nextIndex = (nextIndex + 1) % chain.length;
    }
    state.inRetry = true;
    state.pendingRetryIndex = nextIndex;

    try {
      const source = chain[state.attemptIndex];
      const target = chain[nextIndex];
      if (!source || !target) return false;

      await showToast(
        "warning",
        `${source.name} → ${target.name}${reason ? `: ${reason}` : ""}`,
      );

      const messagesResult = await client.session.messages({
        path: { id: sessionID },
      });
      const entries =
        messagesResult && "data" in messagesResult
          ? messagesResult.data
          : messagesResult;
      if (!Array.isArray(entries)) return false;

      const userMessages = (entries as Array<Record<string, unknown>>).filter(
        (entry) => (entry?.info as Record<string, unknown>)?.role === "user",
      );
      if (userMessages.length === 0) return false;

      const lastUser = userMessages[userMessages.length - 1] as Record<
        string,
        unknown
      >;
      const lastUserInfo = lastUser.info as Record<string, unknown>;
      const lastUserParts = lastUser.parts as Array<Record<string, unknown>>;

      if (
        state.lastUserMessageID &&
        (lastUserInfo?.id as string) !== state.lastUserMessageID
      ) {
        return false;
      }

      const promptParts: Array<{
        type: "text";
        id: string;
        text: string;
        synthetic?: boolean;
        ignored?: boolean;
      }> = [];
      if (Array.isArray(lastUserParts)) {
        for (const part of lastUserParts) {
          if (part?.type === "text") {
            promptParts.push({
              type: "text",
              id: part.id as string,
              text: part.text as string,
              synthetic: part.synthetic as boolean | undefined,
              ignored: part.ignored as boolean | undefined,
            });
          }
        }
      }

      state.aborting = true;
      try {
        await client.session.abort({ path: { id: sessionID } });
      } catch (abortErr) {
        console.debug(`[nimsuper] abort failed for ${sessionID}:`, abortErr);
      }

      const idle = await waitForSessionIdle(sessionID);
      if (!idle) {
        console.debug(
          `[nimsuper] session ${sessionID} did not go idle after abort`,
        );
        state.pendingRetryIndex = undefined;
        return false;
      }

      await client.session.prompt({
        path: { id: sessionID },
        body: {
          messageID: lastUserInfo?.id as string,
          agent: lastUserInfo?.agent as string,
          model: {
            providerID: PROVIDER_ID,
            modelID: target.id,
          },
          parts: promptParts,
        },
      });

      return true;
    } catch (err) {
      console.debug(`[nimsuper] triggerRetry failed for ${sessionID}:`, err);
      state.pendingRetryIndex = undefined;
      return false;
    } finally {
      state.inRetry = false;
    }
  };

  const handleSessionError = async (event: Record<string, unknown>) => {
    const props = event.properties as Record<string, unknown> | undefined;
    const error = props?.error;
    const sessionID = props?.sessionID as string | undefined;

    if (is429Error(error)) {
      const errorKeyId = store.lastUsedKeyId;
      reloadFromDisk();
      if (errorKeyId) {
        recordRateLimit(store, errorKeyId);
        const stateForBlacklist = sessionID
          ? sessions.get(sessionID)
          : undefined;
        const modelForBlacklist =
          stateForBlacklist?.currentModelId ??
          stateForBlacklist?.activeChainModelId;
        if (modelForBlacklist) {
          recordModelRateLimit(store, errorKeyId, modelForBlacklist);
        }
        if (stateForBlacklist) {
          stateForBlacklist.lastFailedModelId = modelForBlacklist;
        }
      }
      safeSaveStore();
    }

    if (!sessionID) return;

    const state = sessions.get(sessionID);
    if (!state) return;
    if (state.aborting) {
      state.aborting = false;
      return;
    }
    if (state.inRetry) return;

    const now = Date.now();
    if (now - state.lastErrorHandledAt < ERROR_DEDUP_WINDOW_MS) return;
    state.lastErrorHandledAt = now;

    if (!shouldRetryForError(error, state)) {
      if (!is429Error(error)) {
        state.rateLimitCount = 0;
      }
      return;
    }

    if (await isSubagentSessionCached(client, sessionID)) {
      if (is429Error(error)) {
        await showToast(
          "warning",
          `Subagent rate limited — model switch skipped to preserve parent task`,
        );
      }
      return;
    }

    if (is429Error(error)) {
      state.rateLimitCount++;
      if (state.rateLimitCount < store.maxRateLimitFailures) return;
    } else {
      state.rateLimitCount = 0;
      return;
    }

    const reason = describeError(error, state, store.maxRateLimitFailures);
    await triggerRetry(sessionID, state, reason);
  };

  const handleSessionStatusRetry = async (
    sessionID: string,
    status: Record<string, unknown>,
  ) => {
    const message = status.message as string | undefined;
    const is429 = isStatusMessageRateLimited(message);
    if (!is429) return;

    const state = sessions.get(sessionID);
    if (!state) return;
    if (state.inRetry) return;

    if (await isSubagentSessionCached(client, sessionID)) {
      return;
    }

    reloadFromDisk();
    if (store.lastUsedKeyId) {
      recordRateLimit(store, store.lastUsedKeyId);
      const modelForBlacklist =
        state.currentModelId ?? state.activeChainModelId;
      if (modelForBlacklist) {
        recordModelRateLimit(store, store.lastUsedKeyId, modelForBlacklist);
      }
      state.lastFailedModelId = modelForBlacklist;
    }
    safeSaveStore();

    state.rateLimitCount++;
    if (state.rateLimitCount < store.maxRateLimitFailures) return;

    const reason = `Rate limited (429) — ${state.rateLimitCount}/${store.maxRateLimitFailures} consecutive`;
    await triggerRetry(sessionID, state, reason);
  };

  const handleSessionStepFailed = async (event: Record<string, unknown>) => {
    const props = event.properties as Record<string, unknown> | undefined;
    const sessionID = props?.sessionID as string | undefined;
    if (!sessionID) return;

    const error = props?.error as Record<string, unknown> | undefined;
    const errorMessage =
      typeof error?.message === "string" ? error.message : undefined;

    if (!isStatusMessageRateLimited(errorMessage) && !is429Error(error)) {
      return;
    }

    const state = sessions.get(sessionID);
    if (!state) return;
    if (state.inRetry) return;

    const now = Date.now();
    if (now - state.lastErrorHandledAt < ERROR_DEDUP_WINDOW_MS) return;
    state.lastErrorHandledAt = now;

    const errorKeyId = store.lastUsedKeyId;
    reloadFromDisk();
    if (errorKeyId) {
      recordRateLimit(store, errorKeyId);
      const modelForBlacklist =
        state.currentModelId ?? state.activeChainModelId;
      if (modelForBlacklist) {
        recordModelRateLimit(store, errorKeyId, modelForBlacklist);
      }
      state.lastFailedModelId = modelForBlacklist;
    }
    safeSaveStore();

    if (await isSubagentSessionCached(client, sessionID)) {
      await showToast(
        "warning",
        `Subagent rate limited — model switch skipped to preserve parent task`,
      );
      return;
    }

    state.rateLimitCount++;
    if (state.rateLimitCount < store.maxRateLimitFailures) return;

    const reason = `Rate limited (429) — ${state.rateLimitCount}/${store.maxRateLimitFailures} consecutive`;
    await triggerRetry(sessionID, state, reason);
  };

  const hooks: Hooks = {
    auth: {
      provider: PROVIDER_ID,
      methods: [
        {
          type: "api",
          label: "Enter NVIDIA NIM API Key",
          async authorize(inputs) {
            const key = inputs?.["apiKey"];
            if (!key) return { type: "failed" };

            try {
              const res = await fetch(`${NIM_BASE_URL}/v1/models`, {
                headers: { Authorization: `Bearer ${key}` },
              });
              if (!res.ok) return { type: "failed" };
            } catch (err) {
              console.debug("[nimsuper] authorize fetch failed:", err);
              return { type: "failed" };
            }

            return {
              type: "success",
              key,
              provider: PROVIDER_ID,
            };
          },
        },
      ],
    },
    "chat.headers": async (_input, _output) => {
      if (_input?.provider?.info?.id !== PROVIDER_ID) return;
      reloadFromDisk();
      const prevKeyId = store.lastUsedKeyId;
      const modelIdForRotation = _input.model?.id;
      const next = getNextKey(store, config, modelIdForRotation);
      if (next) {
        _output.headers["Authorization"] = `Bearer ${next.key.key}`;
        if (prevKeyId && prevKeyId !== next.key.id) {
          resetRateLimit(store, prevKeyId);
        }
        safeSaveStore();
      }
      if (modelIdForRotation && _input.sessionID) {
        const state = getState(_input.sessionID);
        state.currentModelId = modelIdForRotation;
      }
    },
    "chat.message": async (input, output) => {
      const reqModel = output.message.model ?? input.model;
      if (reqModel?.providerID !== PROVIDER_ID) return;
      const chain = store.fallbackChain;
      if (chain.length === 0) return;

      const sessionID = input.sessionID;
      const state = getState(sessionID);
      const requestedModel = output.message.model ?? input.model;
      let activeChainKey = state.activeChainKey;
      let activeChainKeyStr = activeChainKey;

      if (!activeChainKeyStr || state.pendingRetryIndex === undefined) {
        if (!requestedModel) {
          cleanupSession(sessionID);
          return;
        }
        activeChainKeyStr = modelKey(requestedModel);
      }

      const chainIndex = findChainIndex(chain, requestedModel);
      if (chainIndex < 0 && state.pendingRetryIndex === undefined) {
        cleanupSession(sessionID);
        return;
      }

      let desiredIndex: number;
      if (state.pendingRetryIndex !== undefined) {
        desiredIndex = state.pendingRetryIndex;
      } else {
        desiredIndex = chainIndex >= 0 ? chainIndex : 0;
      }

      const target = chain[desiredIndex];
      if (!target) {
        cleanupSession(sessionID);
        return;
      }

      output.message.model = {
        providerID: PROVIDER_ID,
        modelID: target.id,
      };

      state.activeChainKey = activeChainKeyStr;
      state.activeChainModelId = target.id;
      state.attemptIndex = desiredIndex;
      state.lastUserMessageID = output.message.id;
    },
    "shell.env": async (_input, output) => {
      if (output.env.NVIDIA_API_KEY !== undefined) {
        reloadFromDisk();
        const next = getNextKey(store, config);
        if (next) {
          output.env.NVIDIA_API_KEY = next.key.key;
          safeSaveStore();
        }
      }
    },
    event: async ({ event }) => {
      if (event.type === "session.error") {
        await handleSessionError(event as Record<string, unknown>);
        return;
      }

      if ((event.type as string) === "session.next.step.failed") {
        await handleSessionStepFailed(event as Record<string, unknown>);
        return;
      }

      if (event.type === "session.status") {
        const props = (event as Record<string, unknown>).properties as
          | Record<string, unknown>
          | undefined;
        const sessionID = props?.sessionID as string | undefined;
        const status = props?.status as Record<string, unknown> | undefined;
        const statusType = status?.type;

        if (statusType === "retry" && sessionID && status) {
          await handleSessionStatusRetry(sessionID, status);
          return;
        }

        if (statusType === "idle" && sessionID) {
          const state = sessions.get(sessionID);
          if (!state) return;
          state.rateLimitCount = 0;
          state.pendingRetryIndex = undefined;
          state.lastFailedModelId = undefined;
          if (state.inRetry) return;
          cleanupSession(sessionID);
          return;
        }
      }

      if (event.type === "session.idle") {
        const sessionID = (event.properties as Record<string, unknown>)
          ?.sessionID as string;
        if (!sessionID) return;
        const state = sessions.get(sessionID);
        if (!state) return;
        if (state.inRetry) return;
        state.pendingRetryIndex = undefined;
        state.lastFailedModelId = undefined;
        cleanupSession(sessionID);
      }

      if (event.type === "session.deleted") {
        const sessionID = (
          (event.properties as Record<string, unknown>)?.info as Record<
            string,
            unknown
          >
        )?.id as string;
        if (sessionID) cleanupSession(sessionID);
      }
    },
  };

  return hooks;
};

export default NvidiaNimKeyRotator;
