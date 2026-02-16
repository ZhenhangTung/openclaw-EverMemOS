import { describe, it, expect } from "vitest";
import { parseConfig, flattenSearchResults, memoryToText, generateMessageId } from "../src/index.js";
import type { SearchMemoryGroup, MemoryItem } from "../src/client.js";

// ============================================================================
// parseConfig tests
// ============================================================================

describe("parseConfig", () => {
  it("should parse minimal config with defaults", () => {
    const cfg = parseConfig({});
    expect(cfg.baseUrl).toBe("http://localhost:1995/api/v1");
    expect(cfg.userId).toBe("default");
    expect(cfg.groupId).toBeUndefined();
    expect(cfg.autoCapture).toBe(true);
    expect(cfg.autoRecall).toBe(true);
    expect(cfg.retrieveMethod).toBe("hybrid");
    expect(cfg.memoryTypes).toEqual(["episodic_memory"]);
    expect(cfg.topK).toBe(10);
  });

  it("should parse null and undefined config with defaults", () => {
    const cfgFromNull = parseConfig(null);
    expect(cfgFromNull.baseUrl).toBe("http://localhost:1995/api/v1");
    expect(cfgFromNull.userId).toBe("default");

    const cfgFromUndefined = parseConfig(undefined);
    expect(cfgFromUndefined.baseUrl).toBe("http://localhost:1995/api/v1");
    expect(cfgFromUndefined.userId).toBe("default");
  });

  it("should parse full config", () => {
    const cfg = parseConfig({
      baseUrl: "http://evermemos.example.com:1995/api/v1",
      apiKey: "test-key",
      userId: "user_123",
      groupId: "group_456",
      autoCapture: false,
      autoRecall: true,
      retrieveMethod: "agentic",
      memoryTypes: ["episodic_memory", "foresight", "event_log"],
      topK: 20,
    });
    expect(cfg.baseUrl).toBe("http://evermemos.example.com:1995/api/v1");
    expect(cfg.apiKey).toBe("test-key");
    expect(cfg.userId).toBe("user_123");
    expect(cfg.groupId).toBe("group_456");
    expect(cfg.autoCapture).toBe(false);
    expect(cfg.autoRecall).toBe(true);
    expect(cfg.retrieveMethod).toBe("agentic");
    expect(cfg.memoryTypes).toEqual(["episodic_memory", "foresight", "event_log"]);
    expect(cfg.topK).toBe(20);
  });

  it("should reject invalid config types", () => {
    expect(() => parseConfig("string")).toThrow("config required");
    expect(() => parseConfig(42)).toThrow("config required");
    expect(() => parseConfig([])).toThrow("config required");
  });

  it("should reject unknown keys", () => {
    expect(() => parseConfig({ unknownKey: "value" })).toThrow("unknown keys");
  });

  it("should reject invalid retrieveMethod", () => {
    expect(() => parseConfig({ retrieveMethod: "invalid" })).toThrow("Invalid retrieveMethod");
  });

  it("should reject invalid memory types", () => {
    expect(() => parseConfig({ memoryTypes: ["invalid_type"] })).toThrow("Invalid memory type");
  });

  it("should resolve env vars in baseUrl", () => {
    process.env.TEST_EVERMEMOS_URL = "http://test:1995/api/v1";
    const cfg = parseConfig({ baseUrl: "${TEST_EVERMEMOS_URL}" });
    expect(cfg.baseUrl).toBe("http://test:1995/api/v1");
    delete process.env.TEST_EVERMEMOS_URL;
  });

  it("should throw on missing env var", () => {
    delete process.env.NONEXISTENT_VAR;
    expect(() => parseConfig({ baseUrl: "${NONEXISTENT_VAR}" })).toThrow(
      "Environment variable NONEXISTENT_VAR is not set",
    );
  });

  it("should use EVERMEMOS_BASE_URL env var as fallback", () => {
    process.env.EVERMEMOS_BASE_URL = "http://env-fallback:1995/api/v1";
    const cfg = parseConfig({});
    expect(cfg.baseUrl).toBe("http://env-fallback:1995/api/v1");
    delete process.env.EVERMEMOS_BASE_URL;
  });

  it("should reject baseUrl without versioned API path", () => {
    expect(() => parseConfig({ baseUrl: "http://localhost:1995" })).toThrow(
      "baseUrl must include a versioned API path",
    );
  });

  it("should use EVERMEMOS_API_KEY env var as fallback", () => {
    process.env.EVERMEMOS_API_KEY = "env-api-key";
    const cfg = parseConfig({});
    expect(cfg.apiKey).toBe("env-api-key");
    delete process.env.EVERMEMOS_API_KEY;
  });

  it("should resolve env vars in apiKey", () => {
    process.env.TEST_EVERMEMOS_API_KEY = "resolved-key";
    const cfg = parseConfig({ apiKey: "${TEST_EVERMEMOS_API_KEY}" });
    expect(cfg.apiKey).toBe("resolved-key");
    delete process.env.TEST_EVERMEMOS_API_KEY;
  });

  it("should accept all valid retrieve methods", () => {
    for (const method of ["keyword", "vector", "hybrid", "rrf", "agentic"]) {
      const cfg = parseConfig({ retrieveMethod: method });
      expect(cfg.retrieveMethod).toBe(method);
    }
  });

  it("should accept all valid memory types", () => {
    const cfg = parseConfig({
      memoryTypes: ["episodic_memory", "foresight", "event_log", "profile"],
    });
    expect(cfg.memoryTypes).toHaveLength(4);
  });
});

// ============================================================================
// memoryToText tests
// ============================================================================

describe("memoryToText", () => {
  it("should prefer summary field", () => {
    const item: MemoryItem = { summary: "A summary", episode: "An episode" };
    expect(memoryToText(item)).toBe("A summary");
  });

  it("should fallback to episode", () => {
    const item: MemoryItem = { episode: "An episode" };
    expect(memoryToText(item)).toBe("An episode");
  });

  it("should fallback to atomic_fact", () => {
    const item: MemoryItem = { atomic_fact: "A fact" };
    expect(memoryToText(item)).toBe("A fact");
  });

  it("should fallback to content", () => {
    const item: MemoryItem = { content: "Some content" };
    expect(memoryToText(item)).toBe("Some content");
  });

  it("should fallback to foresight", () => {
    const item: MemoryItem = { foresight: "A prediction" };
    expect(memoryToText(item)).toBe("A prediction");
  });

  it("should serialize to JSON for unknown items", () => {
    const item: MemoryItem = { id: "123", user_id: "u1" };
    const text = memoryToText(item);
    expect(text).toContain('"id"');
    expect(text).toContain('"123"');
  });
});

// ============================================================================
// flattenSearchResults tests
// ============================================================================

describe("flattenSearchResults", () => {
  it("should flatten empty results", () => {
    expect(flattenSearchResults([])).toEqual([]);
  });

  it("should flatten single group with single type", () => {
    const groups: SearchMemoryGroup[] = [
      {
        episodic_memory: [
          { summary: "Test memory", id: "1" },
          { summary: "Another memory", id: "2" },
        ],
      },
    ];
    const scores = [{ episodic_memory: [0.95, 0.8] }];

    const result = flattenSearchResults(groups, scores);
    expect(result).toHaveLength(2);
    expect(result[0]._type).toBe("episodic_memory");
    expect(result[0]._score).toBe(0.95);
    expect(result[0].summary).toBe("Test memory");
    expect(result[1]._type).toBe("episodic_memory");
    expect(result[1]._score).toBe(0.8);
  });

  it("should flatten multiple groups with multiple types", () => {
    const groups: SearchMemoryGroup[] = [
      {
        episodic_memory: [{ summary: "Episode 1", id: "1" }],
        foresight: [{ foresight: "Prediction 1", id: "2" }],
      },
      {
        event_log: [{ atomic_fact: "Fact 1", id: "3" }],
      },
    ];

    const result = flattenSearchResults(groups);
    expect(result).toHaveLength(3);
    expect(result[0]._type).toBe("episodic_memory");
    expect(result[1]._type).toBe("foresight");
    expect(result[2]._type).toBe("event_log");
  });

  it("should handle missing scores gracefully", () => {
    const groups: SearchMemoryGroup[] = [
      { episodic_memory: [{ summary: "Test", id: "1" }] },
    ];

    const result = flattenSearchResults(groups);
    expect(result).toHaveLength(1);
    expect(result[0]._score).toBeUndefined();
  });
});

// ============================================================================
// generateMessageId tests
// ============================================================================

describe("generateMessageId", () => {
  it("should generate unique IDs", () => {
    const id1 = generateMessageId();
    const id2 = generateMessageId();
    expect(id1).not.toBe(id2);
  });

  it("should start with msg_ prefix", () => {
    const id = generateMessageId();
    expect(id).toMatch(/^msg_/);
  });
});
