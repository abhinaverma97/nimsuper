import { getAntigravityHeaders, getOrRefreshAntigravityAccessToken } from "./antigravity.js";
import type { ApiKeyEntry } from "./types.js";

export interface QuotaSummary {
  fiveHourPercent: number;
  weeklyPercent: number;
}

interface CachedQuota {
  timestamp: number;
  data: QuotaSummary;
}

const QUOTA_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const quotaCache = new Map<string, CachedQuota>();

export function resolveQuotaModelKey(modelId: string): string {
  const clean = modelId.replace(/^antigravity-/, "").toLowerCase();
  if (clean.includes("claude")) return "claude-sonnet-4-6";
  if (clean.includes("gpt-oss")) return "gpt-oss-120b-medium";
  if (clean.includes("gemini-pro") || clean.includes("3.1-pro")) return "gemini-pro-agent";
  return "gemini-3.6-flash-high";
}

export async function fetchSingleAccountBatchQuotas(
  apiKey: string,
): Promise<Map<string, { fiveHourFraction: number; weeklyFraction: number }> | null> {
  try {
    const auth = await getOrRefreshAntigravityAccessToken(apiKey);
    if (!auth) return null;

    const headers = {
      ...getAntigravityHeaders(auth.accessToken),
      "Content-Type": "application/json",
    };
    const projectId = auth.projectId || "rising-fact-p41fc";

    const [modelsRes, quotaRes] = await Promise.all([
      fetch("https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels", {
        method: "POST",
        headers,
        body: JSON.stringify({ project: projectId }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => null),
      fetch("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": "GeminiCLI/1.0.0/gemini-2.5-pro (windows; amd64)",
        },
        body: JSON.stringify({ project: projectId }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => null),
    ]);

    const result = new Map<string, { fiveHourFraction: number; weeklyFraction: number }>();

    let availableModelsData: any = null;
    if (modelsRes && modelsRes.ok) {
      availableModelsData = await modelsRes.json().catch(() => null);
    }

    let quotaBucketsData: any = null;
    if (quotaRes && quotaRes.ok) {
      quotaBucketsData = await quotaRes.json().catch(() => null);
    }

    const defaultWeeklyFraction =
      quotaBucketsData?.buckets?.[0]?.remainingFraction != null
        ? Number(quotaBucketsData.buckets[0].remainingFraction)
        : 1.0;

    const allModelIds = [
      "claude-sonnet-4-6",
      "claude-opus-4-6-thinking",
      "gpt-oss-120b-medium",
      "gemini-pro-agent",
      "gemini-3.7-flash",
      "gemini-3.7-flash-tiered",
      "gemini-3.6-flash-high",
      "gemini-3.6-flash-medium",
      "gemini-3.6-flash-low",
      "gemini-3.1-pro-low",
      "gemini-3-flash-agent",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
    ];

    for (const mId of allModelIds) {
      const quotaKey = resolveQuotaModelKey(mId);
      const modelEntry =
        availableModelsData?.models?.[mId] ??
        availableModelsData?.models?.[quotaKey];

      const fiveHourFraction =
        modelEntry?.quotaInfo?.remainingFraction != null
          ? Number(modelEntry.quotaInfo.remainingFraction)
          : 1.0;

      let weeklyFraction = defaultWeeklyFraction;
      if (Array.isArray(quotaBucketsData?.buckets)) {
        const matchingBucket =
          quotaBucketsData.buckets.find((b: any) => b.modelId === quotaKey || b.modelId === mId) ??
          quotaBucketsData.buckets.find((b: any) => b.modelId?.includes("gemini"));
        if (matchingBucket?.remainingFraction != null) {
          weeklyFraction = Number(matchingBucket.remainingFraction);
        }
      }

      result.set(mId, { fiveHourFraction, weeklyFraction });
      result.set(`antigravity-${mId}`, { fiveHourFraction, weeklyFraction });
    }

    return result;
  } catch {
    return null;
  }
}

export async function refreshAllModelQuotas(
  keys: ApiKeyEntry[],
  modelsMap?: Record<string, any>,
): Promise<void> {
  const activeKeys = keys.filter((k) => k.provider === "antigravity" && k.enabled);
  if (activeKeys.length === 0) return;

  const keyBatchResults = await Promise.all(
    activeKeys.map((k) => fetchSingleAccountBatchQuotas(k.key)),
  );

  const validBatches = keyBatchResults.filter(
    (b): b is Map<string, { fiveHourFraction: number; weeklyFraction: number }> => b != null,
  );
  if (validBatches.length === 0) return;

  const activeKeyIds = activeKeys.map((k) => k.id).sort().join(",");

  const targetModels = [
    "claude-sonnet-4-6",
    "claude-opus-4-6-thinking",
    "gpt-oss-120b-medium",
    "gemini-pro-agent",
    "gemini-3.7-flash",
    "gemini-3.7-flash-tiered",
    "gemini-3.6-flash-high",
    "gemini-3.6-flash-medium",
    "gemini-3.6-flash-low",
    "gemini-3.1-pro-low",
    "gemini-3-flash-agent",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
  ];

  for (const mId of targetModels) {
    const fractions = validBatches
      .map((b) => b.get(mId))
      .filter((f): f is { fiveHourFraction: number; weeklyFraction: number } => f != null);

    if (fractions.length === 0) continue;

    const avgFiveHour =
      fractions.reduce((acc, f) => acc + f.fiveHourFraction, 0) / fractions.length;
    const avgWeekly =
      fractions.reduce((acc, f) => acc + f.weeklyFraction, 0) / fractions.length;

    const data: QuotaSummary = {
      fiveHourPercent: Math.min(100, Math.max(0, Number((avgFiveHour * 100).toFixed(1)))),
      weeklyPercent: Math.min(100, Math.max(0, Number((avgWeekly * 100).toFixed(1)))),
    };

    const quotaKey = resolveQuotaModelKey(mId);
    quotaCache.set(`${quotaKey}:${activeKeyIds}`, { timestamp: Date.now(), data });
    quotaCache.set(`${mId}:${activeKeyIds}`, { timestamp: Date.now(), data });
    quotaCache.set(`antigravity-${mId}:${activeKeyIds}`, { timestamp: Date.now(), data });

    if (modelsMap) {
      const model = modelsMap[`antigravity-${mId}`] ?? modelsMap[mId];
      if (model) {
        const cleanBase = (model.name ?? mId).replace(/\s+5h:.*$/, "");
        model.name = `${cleanBase} 5h: ${data.fiveHourPercent}% W: ${data.weeklyPercent}%`;
      }
    }
  }
}

export async function fetchSingleAccountQuota(
  apiKey: string,
  modelId: string,
): Promise<{ fiveHourFraction: number; weeklyFraction: number } | null> {
  const batch = await fetchSingleAccountBatchQuotas(apiKey);
  if (!batch) return null;
  return batch.get(modelId) ?? batch.get(resolveQuotaModelKey(modelId)) ?? null;
}

export async function getNormalizedQuota(
  keys: ApiKeyEntry[],
  modelId: string,
  forceRefresh: boolean = false,
): Promise<QuotaSummary> {
  const activeKeys = keys.filter((k) => k.provider === "antigravity" && k.enabled);
  if (activeKeys.length === 0) {
    return { fiveHourPercent: 100, weeklyPercent: 100 };
  }

  const targetModel = resolveQuotaModelKey(modelId);
  const cacheKey = `${targetModel}:${activeKeys.map((k) => k.id).sort().join(",")}`;
  const cached = quotaCache.get(cacheKey);

  if (!forceRefresh && cached && Date.now() - cached.timestamp < QUOTA_CACHE_TTL_MS) {
    return cached.data;
  }

  await refreshAllModelQuotas(keys);

  const fresh = quotaCache.get(cacheKey);
  if (fresh) return fresh.data;

  return { fiveHourPercent: 100, weeklyPercent: 100 };
}

export function formatMinimalQuotaString(quota: QuotaSummary): string {
  return `5h: ${quota.fiveHourPercent}% | W: ${quota.weeklyPercent}%`;
}
