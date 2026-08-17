import type { ProviderId } from "./types.js";
import { getAntigravityHeaders } from "./antigravity.js";

export type { ProviderId };

function normalize(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.toLowerCase() : undefined;
  }
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    const urlStr = obj.url ?? obj.baseURL ?? obj.baseUrl ?? obj.endpoint;
    if (typeof urlStr === "string") {
      const trimmed = urlStr.trim();
      return trimmed.length > 0 ? trimmed.toLowerCase() : undefined;
    }
  }
  return undefined;
}

function looksLikeNvidia(value: string | undefined): boolean {
  return !!value && /nvidia|nim/i.test(value);
}

function looksLikeGoogle(value: string | undefined): boolean {
  return !!value && /google|gemini|generativelanguage/i.test(value);
}

function looksLikeAntigravity(value: string | undefined): boolean {
  return (
    !!value &&
    (value.startsWith("antigravity-") ||
      value.endsWith(":antigravity") ||
      /antigravity|agy|cloudcode|claude|gpt-oss|gemini-pro-agent|gemini-3-flash-agent/i.test(value))
  );
}

export function detectProviderForRequest(input: unknown): ProviderId | null {
  const record = (input as Record<string, unknown> | undefined) ?? {};
  const provider = record.provider as Record<string, unknown> | undefined;
  const model = record.model as Record<string, unknown> | undefined;

  const providerId = normalize(
    (provider?.id as unknown) ??
      (provider?.providerID as unknown) ??
      (provider?.name as unknown) ??
      (provider?.info as Record<string, unknown> | undefined)?.id,
  );
  const modelProviderId = normalize(
    (model?.providerID as unknown) ??
      (model?.provider_id as unknown) ??
      (model?.provider as unknown) ??
      (model?.providerName as unknown) ??
      (model?.provider_name as unknown),
  );
  const api = normalize(
    (model?.api as unknown) ??
      (model?.url as unknown) ??
      (model?.endpoint as unknown) ??
      (provider?.api as unknown) ??
      (provider?.url as unknown),
  );
  const modelId = normalize(model?.id as unknown);

  // 1. Check API endpoint URL first (most definitive)
  if (api) {
    if (/cloudcode-pa\.googleapis\.com|sandbox\.googleapis\.com|antigravity/i.test(api)) return "antigravity";
    if (/integrate\.api\.nvidia\.com/i.test(api)) return "nvidia";
    if (/generativelanguage\.googleapis\.com|googleapis\.com/i.test(api)) return "google";
  }

  // 2. Check model ID (highly specific for model fallback requests)
  if (looksLikeAntigravity(modelId)) return "antigravity";
  if (looksLikeNvidia(modelId)) return "nvidia";
  if (looksLikeGoogle(modelId)) return "google";

  // 3. Check model provider ID
  if (looksLikeAntigravity(modelProviderId)) return "antigravity";
  if (looksLikeNvidia(modelProviderId)) return "nvidia";
  if (looksLikeGoogle(modelProviderId)) return "google";

  // 4. Check session provider ID (least specific, fallback)
  if (looksLikeAntigravity(providerId)) return "antigravity";
  if (looksLikeNvidia(providerId)) return "nvidia";
  if (looksLikeGoogle(providerId)) return "google";

  return null;
}

export function getProviderHeaders(provider: ProviderId | null, apiKey: string): Record<string, string> {
  if (!apiKey) return {};
  if (provider === "google") {
    return { "x-goog-api-key": apiKey };
  }
  if (provider === "nvidia") {
    return {
      Authorization: `Bearer ${apiKey}`,
      authorization: `Bearer ${apiKey}`,
    };
  }
  if (provider === "antigravity") {
    const parts = apiKey.split("|");
    const token = parts[0];
    const projectId = parts[1];
    return getAntigravityHeaders(token, projectId);
  }
  return {};
}
