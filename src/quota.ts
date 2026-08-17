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

function resolveQuotaModelKey(modelId: string): string {
  const clean = modelId.replace(/^antigravity-/, "").toLowerCase();
  if (clean.includes("claude")) return "claude-sonnet-4-6";
  if (clean.includes("gpt-oss")) return "gpt-oss-120b-medium";
  if (clean.includes("gemini-pro") || clean.includes("3.1-pro")) return "gemini-pro-agent";
  return "gemini-3.6-flash-high";
}

export async function fetchSingleAccountQuota(
  apiKey: string,
  modelId: string,
): Promise<{ fiveHourFraction: number; weeklyFraction: number } | null> {
  try {
    const auth = await getOrRefreshAntigravityAccessToken(apiKey);
    if (!auth) return null;

    const targetModel = resolveQuotaModelKey(modelId);
    const headers = {
      ...getAntigravityHeaders(auth.accessToken),
      "Content-Type": "application/json",
    };

    const projectId = auth.projectId || "rising-fact-p41fc";

    // 1. Fetch 5-hour rolling limit from fetchAvailableModels
    let fiveHourFraction = 1.0;
    try {
      const modelsRes = await fetch("https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels", {
        method: "POST",
        headers,
        body: JSON.stringify({ project: projectId }),
      });
      if (modelsRes.ok) {
        const data = (await modelsRes.json()) as any;
        const modelEntry = data.models?.[targetModel] ?? data.models?.[modelId];
        if (modelEntry?.quotaInfo?.remainingFraction != null) {
          fiveHourFraction = Number(modelEntry.quotaInfo.remainingFraction);
        }
      }
    } catch {}

    // 2. Fetch Weekly/Daily quota from retrieveUserQuota
    let weeklyFraction = 1.0;
    try {
      const quotaRes = await fetch("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": "GeminiCLI/1.0.0/gemini-2.5-pro (windows; amd64)",
        },
        body: JSON.stringify({ project: projectId }),
      });
      if (quotaRes.ok) {
        const quotaData = (await quotaRes.json()) as any;
        if (Array.isArray(quotaData.buckets) && quotaData.buckets.length > 0) {
          const matchingBucket =
            quotaData.buckets.find((b: any) => b.modelId === targetModel) ??
            quotaData.buckets.find((b: any) => b.modelId?.includes("gemini")) ??
            quotaData.buckets[0];
          if (matchingBucket?.remainingFraction != null) {
            weeklyFraction = Number(matchingBucket.remainingFraction);
          }
        }
      }
    } catch {}

    return { fiveHourFraction, weeklyFraction };
  } catch {
    return null;
  }
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

  const results = await Promise.all(
    activeKeys.map((k) => fetchSingleAccountQuota(k.key, targetModel)),
  );

  const validResults = results.filter((r): r is { fiveHourFraction: number; weeklyFraction: number } => r != null);

  if (validResults.length === 0) {
    return { fiveHourPercent: 100, weeklyPercent: 100 };
  }

  // Normalize: sum of remaining fractions / count * 100
  const avgFiveHour =
    validResults.reduce((acc, r) => acc + r.fiveHourFraction, 0) / validResults.length;
  const avgWeekly =
    validResults.reduce((acc, r) => acc + r.weeklyFraction, 0) / validResults.length;

  const data: QuotaSummary = {
    fiveHourPercent: Math.min(100, Math.max(0, Number((avgFiveHour * 100).toFixed(1)))),
    weeklyPercent: Math.min(100, Math.max(0, Number((avgWeekly * 100).toFixed(1)))),
  };

  quotaCache.set(cacheKey, {
    timestamp: Date.now(),
    data,
  });

  return data;
}

export function formatMinimalQuotaString(quota: QuotaSummary): string {
  return `5h: ${quota.fiveHourPercent}% | W: ${quota.weeklyPercent}%`;
}
