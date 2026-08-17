import { describe, expect, it } from "bun:test";
import { detectProviderForRequest, getProviderHeaders } from "./provider.js";
import { generatePKCE, encodeState, decodeState, authorizeAntigravity, getAntigravityHeaders } from "./antigravity.js";

describe("detectProviderForRequest", () => {
  it("detects NVIDIA requests from provider info and API URL", () => {
    expect(
      detectProviderForRequest({
        provider: { info: { id: "nvidia" } },
        model: { providerID: "nvidia", api: "https://integrate.api.nvidia.com/v1/models" },
      }),
    ).toBe("nvidia");
  });

  it("detects NVIDIA requests when provider object has direct id (no info wrapper)", () => {
    expect(
      detectProviderForRequest({
        provider: { id: "nvidia" },
        model: { id: "meta/llama-3.3-70b-instruct" },
      }),
    ).toBe("nvidia");
  });

  it("detects NVIDIA requests from nested API url object", () => {
    expect(
      detectProviderForRequest({
        provider: { id: "custom" },
        model: { api: { baseURL: "https://integrate.api.nvidia.com/v1" } },
      }),
    ).toBe("nvidia");
  });

  it("detects Google requests from Gemini provider info", () => {
    expect(
      detectProviderForRequest({
        provider: { info: { id: "google" } },
        model: { providerID: "google", api: "https://generativelanguage.googleapis.com/v1beta/models" },
      }),
    ).toBe("google");
  });

  it("detects Google requests from gemini provider ID", () => {
    expect(
      detectProviderForRequest({
        provider: { info: { id: "openai" } },
        model: { providerID: "gemini", api: "https://generativelanguage.googleapis.com/v1beta/models" },
      }),
    ).toBe("google");
  });

  it("detects Antigravity requests from cloudcode endpoint", () => {
    expect(
      detectProviderForRequest({
        provider: { id: "custom" },
        model: { api: "https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent" },
      }),
    ).toBe("antigravity");
  });

  it("detects Antigravity requests from provider ID", () => {
    expect(
      detectProviderForRequest({
        provider: { id: "antigravity" },
        model: { id: "claude-sonnet-4-6" },
      }),
    ).toBe("antigravity");
  });
});

describe("getProviderHeaders", () => {
  it("uses bearer auth for NVIDIA", () => {
    expect(getProviderHeaders("nvidia", "abc123")).toEqual({
      Authorization: "Bearer abc123",
      authorization: "Bearer abc123",
    });
  });

  it("uses x-goog-api-key for Google", () => {
    expect(getProviderHeaders("google", "abc123")).toEqual({ "x-goog-api-key": "abc123" });
  });

  it("generates Cloud Code headers for Antigravity", () => {
    const headers = getProviderHeaders("antigravity", "mock-token|my-project-123");
    expect(headers["Authorization"]).toBe("Bearer mock-token");
    expect(headers["x-goog-user-project"]).toBe("my-project-123");
    expect(headers["X-Goog-Api-Client"]).toBe("google-cloud-sdk vscode_cloudshelleditor/0.1");
    expect(headers["Client-Metadata"]).toContain('"ideType":"ANTIGRAVITY"');
  });

  it("returns no headers when provider is unknown", () => {
    expect(getProviderHeaders(null, "abc123")).toEqual({});
  });
});

describe("Antigravity PKCE and State Helpers", () => {
  it("generates valid PKCE verifier and challenge", () => {
    const pkce = generatePKCE();
    expect(pkce.verifier).toBeDefined();
    expect(pkce.challenge).toBeDefined();
    expect(pkce.verifier.length).toBeGreaterThan(20);
    expect(pkce.challenge.length).toBeGreaterThan(20);
  });

  it("encodes and decodes OAuth state with PKCE verifier and project ID", () => {
    const payload = { verifier: "test-verifier-12345", projectId: "test-project-99" };
    const encoded = encodeState(payload);
    const decoded = decodeState(encoded);
    expect(decoded.verifier).toBe(payload.verifier);
    expect(decoded.projectId).toBe(payload.projectId);
  });

  it("generates complete Google OAuth URL with PKCE parameters", () => {
    const auth = authorizeAntigravity("my-proj");
    const u = new URL(auth.url);
    expect(u.searchParams.get("client_id")).toBeDefined();
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("code_challenge")).toBeDefined();
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("state")).toBeDefined();
  });
});
