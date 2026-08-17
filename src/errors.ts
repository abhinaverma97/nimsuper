export interface SessionState {
  attemptIndex: number;
  inRetry: boolean;
  aborting: boolean;
  pendingRetryIndex: number | undefined;
  lastUserMessageID: string | undefined;
  activeChainKey: string | undefined;
  activeChainModelId: string | undefined;
  rateLimitCount: number;
  currentModelId: string | undefined;
  lastFailedModelId: string | undefined;
  lastErrorHandledAt: number;
  createdAt: number;
  sessionProviderId: string | undefined;
  lastUsedKeyId?: string;
}

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

export function extractStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const rec = error as Record<string, unknown>;
  const data = rec.data as Record<string, unknown> | undefined;
  if (typeof data?.statusCode === "number") return data.statusCode;
  if (typeof data?.status === "number") return data.status;
  if (typeof rec.status === "number") return rec.status;
  if (typeof rec.statusCode === "number") return rec.statusCode;
  return undefined;
}

const RATE_LIMIT_MESSAGE_PATTERNS: ReadonlyArray<RegExp> = [
  /\b429\b/,
  /too many requests/i,
  /rate[- ]limit(?:ed| reach)/i,
  /exceeded.*(?:rate|quota)/i,
  /quota.*exceeded/i,
  /resource.*exhausted/i,
];

export function isStatusMessageRateLimited(message: unknown): boolean {
  if (typeof message !== "string" || message.length === 0) return false;
  return RATE_LIMIT_MESSAGE_PATTERNS.some((re) => re.test(message));
}

export const is429Error = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  if (extractStatus(error) === 429) return true;
  const rec = error as Record<string, unknown>;
  const data = rec.data as Record<string, unknown> | undefined;
  const message = data?.message ?? rec.message;
  return isStatusMessageRateLimited(message);
};

export function describeError(
  error: unknown,
  state: SessionState,
  maxRateLimitFailures: number,
): string {
  if (!error || typeof error !== "object") return "Unknown error";
  const rec = error as Record<string, unknown>;

  if (rec.name === "MessageAbortedError") {
    const msg =
      typeof (rec.data as Record<string, unknown>)?.message === "string"
        ? ((rec.data as Record<string, unknown>).message as string)
        : "";
    if (/time\s*out|timed\s*out|timeout/i.test(msg))
      return "Request timed out after 60s";
    return `Message aborted: ${msg || "no details"}`;
  }

  if (rec.name === "APIError") {
    const data = rec.data as Record<string, unknown> | undefined;
    const statusCode = extractStatus(error);
    const body = data?.body as Record<string, unknown> | undefined;
    const apiMsg =
      typeof body?.message === "string"
        ? body.message
        : typeof body?.error === "string"
          ? body.error
          : typeof body?.title === "string"
            ? body.title
            : undefined;
    if (statusCode === 429) {
      return `Rate limited (429) — ${state.rateLimitCount}/${maxRateLimitFailures} consecutive`;
    }
    if (typeof statusCode === "number") {
      return `API error ${statusCode}${apiMsg ? `: ${apiMsg}` : ""}`;
    }
    return `API error${apiMsg ? `: ${apiMsg}` : ""}`;
  }

  if (rec.name === "ProviderAuthError") return "Provider auth error";

  const statusCode = extractStatus(error);
  if (statusCode === 429) {
    return `Rate limited (429) — ${state.rateLimitCount}/${maxRateLimitFailures} consecutive`;
  }
  if (typeof statusCode === "number") {
    const title =
      typeof rec.title === "string"
        ? rec.title
        : typeof rec.message === "string"
          ? rec.message
          : undefined;
    return `API error ${statusCode}${title ? `: ${title}` : ""}`;
  }

  const msg =
    typeof rec.message === "string"
      ? rec.message
      : typeof rec.code === "string"
        ? rec.code
        : "Unknown error";
  return msg;
}

export function shouldRetryForError(
  error: unknown,
  state: SessionState,
): boolean {
  if (!error || typeof error !== "object") return false;
  const rec = error as Record<string, unknown>;

  if (rec.name === "MessageAbortedError") {
    const msg =
      typeof (rec.data as Record<string, unknown>)?.message === "string"
        ? ((rec.data as Record<string, unknown>).message as string)
        : "";
    return /time\s*out|timed\s*out|timeout/i.test(msg);
  }

  if (rec.name === "APIError") {
    const data = rec.data as Record<string, unknown> | undefined;
    if (data?.isRetryable) return true;
    const statusCode = extractStatus(error);
    if (
      typeof statusCode === "number" &&
      RETRYABLE_STATUS_CODES.has(statusCode)
    ) {
      return true;
    }
    return is429Error(error);
  }

  if (rec.name === "ProviderAuthError") return false;

  const statusCode = extractStatus(error);
  if (
    typeof statusCode === "number" &&
    RETRYABLE_STATUS_CODES.has(statusCode)
  ) {
    return true;
  }
  return is429Error(error);
}
