import { describe, expect, it } from "vitest";
import { classifyGeminiFailure, geminiKindToCode } from "../src/gemini.js";

describe("gemini error classification", () => {
  it("maps 429 to rate_limited", () => {
    expect(classifyGeminiFailure({ status: 429, message: "RESOURCE_EXHAUSTED" })).toBe("rate_limited");
    expect(geminiKindToCode("rate_limited")).toBe("RATE_LIMITED");
  });

  it("maps quota language", () => {
    expect(classifyGeminiFailure({ status: 429, message: "quota exceeded" })).toBe("quota");
  });

  it("maps MAX_TOKENS", () => {
    expect(classifyGeminiFailure(new Error("finishReason MAX_TOKENS"))).toBe("token_limit");
  });

  it("maps safety blocks", () => {
    expect(classifyGeminiFailure(new Error("PROHIBITED_CONTENT"))).toBe("safety_blocked");
  });

  it("maps bad keys", () => {
    expect(classifyGeminiFailure({ status: 401, message: "invalid api key" })).toBe("bad_api_key");
  });
});
