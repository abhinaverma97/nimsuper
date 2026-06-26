import { describe, it, expect } from "bun:test";
import {
  extractStatus,
  isStatusMessageRateLimited,
  is429Error,
  describeError,
  shouldRetryForError,
} from "./errors.js";

function makeState(
  overrides: Partial<Parameters<typeof describeError>[1]> = {},
) {
  return {
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
    createdAt: 0,
    sessionProviderId: undefined,
    ...overrides,
  };
}

describe("extractStatus", () => {
  it("returns number statusCode from data", () => {
    expect(extractStatus({ data: { statusCode: 429 } })).toBe(429);
    expect(extractStatus({ data: { status: 500 } })).toBe(500);
  });

  it("returns number status from root", () => {
    expect(extractStatus({ status: 503 })).toBe(503);
    expect(extractStatus({ statusCode: 504 })).toBe(504);
  });

  it("returns undefined for non-objects", () => {
    expect(extractStatus(null)).toBeUndefined();
    expect(extractStatus("error")).toBeUndefined();
    expect(extractStatus(42)).toBeUndefined();
  });

  it("returns undefined when status is string", () => {
    expect(extractStatus({ data: { statusCode: "429" } })).toBeUndefined();
    expect(extractStatus({ data: { status: "500" } })).toBeUndefined();
  });
});

describe("isStatusMessageRateLimited", () => {
  it("matches 429 in message", () => {
    expect(isStatusMessageRateLimited("Error 429")).toBe(true);
  });

  it("matches rate limit phrases", () => {
    expect(isStatusMessageRateLimited("Too many requests")).toBe(true);
    expect(isStatusMessageRateLimited("Rate-limited")).toBe(true);
    expect(isStatusMessageRateLimited("Rate limited")).toBe(true);
    expect(isStatusMessageRateLimited("Rate limit reached")).toBe(true);
    expect(isStatusMessageRateLimited("exceeded rate")).toBe(true);
    expect(isStatusMessageRateLimited("exceeded quota")).toBe(true);
    expect(isStatusMessageRateLimited("quota exceeded")).toBe(true);
    expect(isStatusMessageRateLimited("resource exhausted")).toBe(true);
  });

  it("returns false for non-matching messages", () => {
    expect(isStatusMessageRateLimited("Not found")).toBe(false);
    expect(isStatusMessageRateLimited("")).toBe(false);
    expect(isStatusMessageRateLimited(42)).toBe(false);
    expect(isStatusMessageRateLimited(null)).toBe(false);
  });
});

describe("is429Error", () => {
  it("detects numeric 429 status", () => {
    expect(is429Error({ data: { statusCode: 429 } })).toBe(true);
    expect(is429Error({ status: 429 })).toBe(true);
  });

  it("detects message-based 429", () => {
    expect(is429Error({ data: { message: "Error 429" } })).toBe(true);
    expect(is429Error({ message: "Too many requests" })).toBe(true);
    expect(is429Error({ data: { message: "Rate limited" } })).toBe(true);
  });

  it("returns false for non-429 errors", () => {
    expect(is429Error({ data: { statusCode: 500 } })).toBe(false);
    expect(is429Error({ message: "Not found" })).toBe(false);
    expect(is429Error(null)).toBe(false);
  });
});

describe("shouldRetryForError", () => {
  it("retries on MessageAbortedError with timeout", () => {
    const error = { name: "MessageAbortedError", data: { message: "timeout" } };
    expect(shouldRetryForError(error, makeState())).toBe(true);
  });

  it("retries on APIError with isRetryable", () => {
    const error = { name: "APIError", data: { isRetryable: true } };
    expect(shouldRetryForError(error, makeState())).toBe(true);
  });

  it("retries on APIError with retryable status code", () => {
    expect(
      shouldRetryForError(
        { name: "APIError", data: { statusCode: 429 } },
        makeState(),
      ),
    ).toBe(true);
    expect(
      shouldRetryForError(
        { name: "APIError", data: { statusCode: 500 } },
        makeState(),
      ),
    ).toBe(true);
    expect(
      shouldRetryForError(
        { name: "APIError", data: { statusCode: 503 } },
        makeState(),
      ),
    ).toBe(true);
  });

  it("retries on APIError with string statusCode via message fallback (CRITICAL FIX)", () => {
    // This is the exact bug: statusCode is "429" (string), so extractStatus returns undefined,
    // but is429Error catches it via message pattern
    const error = {
      name: "APIError",
      data: { statusCode: "429", message: "Error 429" },
    };
    expect(shouldRetryForError(error, makeState())).toBe(true);
  });

  it("retries on generic error with retryable status code", () => {
    expect(shouldRetryForError({ statusCode: 502 }, makeState())).toBe(true);
    expect(shouldRetryForError({ statusCode: 504 }, makeState())).toBe(true);
  });

  it("does not retry ProviderAuthError", () => {
    expect(
      shouldRetryForError({ name: "ProviderAuthError" }, makeState()),
    ).toBe(false);
  });

  it("does not retry non-retryable errors", () => {
    expect(
      shouldRetryForError(
        { name: "APIError", data: { statusCode: 400 } },
        makeState(),
      ),
    ).toBe(false);
    expect(shouldRetryForError({ statusCode: 404 }, makeState())).toBe(false);
  });
});

describe("describeError", () => {
  it("describes MessageAbortedError timeout", () => {
    const error = { name: "MessageAbortedError", data: { message: "timeout" } };
    expect(describeError(error, makeState(), 3)).toBe(
      "Request timed out after 60s",
    );
  });

  it("describes 429 rate limit", () => {
    const error = { name: "APIError", data: { statusCode: 429 } };
    const state = makeState({ rateLimitCount: 2 });
    expect(describeError(error, state, 3)).toBe(
      "Rate limited (429) — 2/3 consecutive",
    );
  });

  it("describes generic API error with status", () => {
    const error = {
      name: "APIError",
      data: { statusCode: 500, body: { message: "Server error" } },
    };
    expect(describeError(error, makeState(), 3)).toBe(
      "API error 500: Server error",
    );
  });

  it("describes ProviderAuthError", () => {
    expect(describeError({ name: "ProviderAuthError" }, makeState(), 3)).toBe(
      "Provider auth error",
    );
  });

  it("describes unknown error", () => {
    expect(describeError(null, makeState(), 3)).toBe("Unknown error");
    expect(describeError({ message: "Something broke" }, makeState(), 3)).toBe(
      "Something broke",
    );
  });
});
