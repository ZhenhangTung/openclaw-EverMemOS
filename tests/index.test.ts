import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseConfig, flattenSearchResults, memoryToText, generateMessageId } from "../src/index.js";
import evermemosPlugin from "../src/index.js";
import type { MemoryItem } from "../src/client.js";

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

  it("should flatten memories with scores", () => {
    const memories: MemoryItem[] = [
      { summary: "Test memory", id: "1", memory_type: "episodic_memory" },
      { summary: "Another memory", id: "2", memory_type: "episodic_memory" },
    ];
    const scores = [0.95, 0.8];

    const result = flattenSearchResults(memories, scores);
    expect(result).toHaveLength(2);
    expect(result[0]._type).toBe("episodic_memory");
    expect(result[0]._score).toBe(0.95);
    expect(result[0].summary).toBe("Test memory");
    expect(result[1]._type).toBe("episodic_memory");
    expect(result[1]._score).toBe(0.8);
  });

  it("should include profiles from separate array", () => {
    const memories: MemoryItem[] = [
      { summary: "Episode 1", id: "1", memory_type: "episodic_memory" },
    ];
    const scores = [0.9];
    const profiles = [
      { category: "Preferences", description: "Likes coffee", score: 0.85 },
    ];

    const result = flattenSearchResults(memories, scores, profiles);
    expect(result).toHaveLength(2);
    expect(result[0]._type).toBe("episodic_memory");
    expect(result[1]._type).toBe("profile");
    expect(result[1]._score).toBe(0.85);
  });

  it("should handle missing scores gracefully", () => {
    const memories: MemoryItem[] = [
      { summary: "Test", id: "1", memory_type: "episodic_memory" },
    ];

    const result = flattenSearchResults(memories);
    expect(result).toHaveLength(1);
    expect(result[0]._score).toBeUndefined();
  });

  it("should default memory_type to episodic_memory", () => {
    const memories: MemoryItem[] = [
      { summary: "No type", id: "1" },
    ];

    const result = flattenSearchResults(memories);
    expect(result).toHaveLength(1);
    expect(result[0]._type).toBe("episodic_memory");
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

// ============================================================================
// Plugin register: multi-user & group support tests
// ============================================================================

describe("evermemosPlugin.register – multi-user & group support", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let registeredTools: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let registeredHooks: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let registeredCommands: Record<string, any>;

  const mockFetch = vi.fn();

  beforeEach(() => {
    registeredTools = {};
    registeredHooks = {};
    registeredCommands = {};
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);

    const mockApi = {
      id: "openclaw-evermemos",
      name: "Memory (EverMemOS)",
      version: "0.1.0",
      description: "test",
      source: "test",
      config: {},
      pluginConfig: {
        baseUrl: "http://localhost:1995/api/v1",
        userId: "default_user",
        groupId: "default_group",
        autoCapture: false,
        autoRecall: false,
      },
      runtime: {},
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerTool: (tool: any, opts?: any) => {
        registeredTools[opts?.name || tool.name] = tool;
      },
      registerCli: vi.fn(),
      registerService: vi.fn(),
      on: (hookName: string, handler: unknown) => {
        registeredHooks[hookName] = handler;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerCommand: (command: any) => {
        registeredCommands[command.name] = command;
      },
      resolvePath: (p: string) => p,
    };

    evermemosPlugin.register(mockApi as never);
  });

  it("should register all 5 tools", () => {
    expect(registeredTools.memory_search).toBeDefined();
    expect(registeredTools.memory_store).toBeDefined();
    expect(registeredTools.memory_get).toBeDefined();
    expect(registeredTools.memory_list).toBeDefined();
    expect(registeredTools.memory_forget).toBeDefined();
  });

  it("memory_search tool should have groupId in parameters", () => {
    const schema = registeredTools.memory_search.parameters;
    expect(schema.properties.groupId).toBeDefined();
  });

  it("memory_store tool should have groupId in parameters", () => {
    const schema = registeredTools.memory_store.parameters;
    expect(schema.properties.groupId).toBeDefined();
  });

  it("memory_get tool should have groupId in parameters", () => {
    const schema = registeredTools.memory_get.parameters;
    expect(schema.properties.groupId).toBeDefined();
  });

  it("memory_list tool should have groupId in parameters", () => {
    const schema = registeredTools.memory_list.parameters;
    expect(schema.properties.groupId).toBeDefined();
  });

  it("memory_forget tool should have groupId in parameters", () => {
    const schema = registeredTools.memory_forget.parameters;
    expect(schema.properties.groupId).toBeDefined();
  });

  it("memory_search should use runtime userId and groupId over config defaults", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          status: "ok",
          result: {
            memories: [],
            profiles: [],
            scores: [],
            total_count: 0,
            has_more: false,
            pending_messages: [],
          },
        }),
    });

    await registeredTools.memory_search.execute("call1", {
      query: "test",
      userId: "runtime_user",
      groupId: "runtime_group",
    });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("user_id=runtime_user");
    expect(url).toContain("group_id=runtime_group");
  });

  it("memory_search should fall back to config userId and groupId when not provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          status: "ok",
          result: {
            memories: [],
            profiles: [],
            scores: [],
            total_count: 0,
            has_more: false,
            pending_messages: [],
          },
        }),
    });

    await registeredTools.memory_search.execute("call1", { query: "test" });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("user_id=default_user");
    expect(url).toContain("group_id=default_group");
  });

  it("memory_store should use runtime userId and groupId", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          status: "ok",
          message: "Extracted 1",
          result: { saved_memories: [], count: 1, status_info: "extracted" },
        }),
    });

    await registeredTools.memory_store.execute("call1", {
      text: "some content to store",
      userId: "runtime_user",
      groupId: "runtime_group",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.sender).toBe("runtime_user");
    expect(body.group_id).toBe("runtime_group");
  });

  it("memory_get should use runtime userId and groupId", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          status: "ok",
          result: { memories: [], total_count: 0, has_more: false },
        }),
    });

    await registeredTools.memory_get.execute("call1", {
      userId: "runtime_user",
      groupId: "runtime_group",
    });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("user_id=runtime_user");
    expect(url).toContain("group_id=runtime_group");
  });

  it("memory_list should use runtime groupId for all queries", async () => {
    // mock 4 responses for each memory type
    for (let i = 0; i < 4; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            status: "ok",
            result: { memories: [], total_count: 0, has_more: false },
          }),
      });
    }

    await registeredTools.memory_list.execute("call1", {
      userId: "runtime_user",
      groupId: "runtime_group",
    });

    // All 4 fetch calls should use runtime_group
    for (let i = 0; i < 4; i++) {
      const url = mockFetch.mock.calls[i][0] as string;
      expect(url).toContain("user_id=runtime_user");
      expect(url).toContain("group_id=runtime_group");
    }
  });

  it("memory_forget should use runtime groupId for deletion", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          status: "ok",
          message: "Deleted 1",
          result: { filters: ["user_id"], count: 1 },
        }),
    });

    await registeredTools.memory_forget.execute("call1", {
      userId: "runtime_user",
      groupId: "runtime_group",
      eventId: "event_001",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.user_id).toBe("runtime_user");
    expect(body.group_id).toBe("runtime_group");
  });

  it("/remember command should use context userId and groupId", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          status: "ok",
          message: "Extracted 1",
          result: { saved_memories: [], count: 1, status_info: "extracted" },
        }),
    });

    await registeredCommands.remember.handler({
      args: "I love running",
      config: {},
      userId: "cmd_user",
      groupId: "cmd_group",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.sender).toBe("cmd_user");
    expect(body.group_id).toBe("cmd_group");
  });

  it("/recall command should use context userId and groupId", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          status: "ok",
          result: {
            memories: [],
            profiles: [],
            scores: [],
            total_count: 0,
            has_more: false,
            pending_messages: [],
          },
        }),
    });

    await registeredCommands.recall.handler({
      args: "running",
      config: {},
      userId: "cmd_user",
      groupId: "cmd_group",
    });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("user_id=cmd_user");
    expect(url).toContain("group_id=cmd_group");
  });
});

// ============================================================================
// Lifecycle hooks: multi-user & group support tests
// ============================================================================

describe("evermemosPlugin.register – lifecycle hooks with userId/groupId", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let registeredHooks: Record<string, any>;
  const mockFetch = vi.fn();

  beforeEach(() => {
    registeredHooks = {};
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);

    const mockApi = {
      id: "openclaw-evermemos",
      name: "Memory (EverMemOS)",
      version: "0.1.0",
      description: "test",
      source: "test",
      config: {},
      pluginConfig: {
        baseUrl: "http://localhost:1995/api/v1",
        userId: "config_user",
        groupId: "config_group",
        autoCapture: true,
        autoRecall: true,
      },
      runtime: {},
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      registerTool: vi.fn(),
      registerCli: vi.fn(),
      registerService: vi.fn(),
      on: (hookName: string, handler: unknown) => {
        registeredHooks[hookName] = handler;
      },
      registerCommand: vi.fn(),
      resolvePath: (p: string) => p,
    };

    evermemosPlugin.register(mockApi as never);
  });

  it("should register before_agent_start and agent_end hooks", () => {
    expect(registeredHooks.before_agent_start).toBeDefined();
    expect(registeredHooks.agent_end).toBeDefined();
  });

  it("before_agent_start should use event userId and groupId over config", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          status: "ok",
          result: {
            memories: [],
            profiles: [],
            scores: [],
            total_count: 0,
            has_more: false,
            pending_messages: [],
          },
        }),
    });

    await registeredHooks.before_agent_start(
      { prompt: "What did we discuss yesterday?", userId: "event_user", groupId: "event_group" },
      {},
    );

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("user_id=event_user");
    expect(url).toContain("group_id=event_group");
  });

  it("before_agent_start should fall back to config userId and groupId", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          status: "ok",
          result: {
            memories: [],
            profiles: [],
            scores: [],
            total_count: 0,
            has_more: false,
            pending_messages: [],
          },
        }),
    });

    await registeredHooks.before_agent_start(
      { prompt: "What did we discuss yesterday?" },
      {},
    );

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("user_id=config_user");
    expect(url).toContain("group_id=config_group");
  });

  it("agent_end should use event userId and groupId for capture", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          status: "ok",
          message: "Extracted",
          result: { saved_memories: [], count: 1, status_info: "extracted" },
        }),
    });

    await registeredHooks.agent_end(
      {
        success: true,
        userId: "event_user",
        groupId: "event_group",
        messages: [
          { role: "user", content: "Tell me about my fitness plan and progress" },
        ],
      },
      {},
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.sender).toBe("event_user");
    expect(body.group_id).toBe("event_group");
  });

  it("agent_end should fall back to config userId and groupId", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          status: "ok",
          message: "Extracted",
          result: { saved_memories: [], count: 1, status_info: "extracted" },
        }),
    });

    await registeredHooks.agent_end(
      {
        success: true,
        messages: [
          { role: "user", content: "Tell me about my fitness plan and progress" },
        ],
      },
      {},
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.sender).toBe("config_user");
    expect(body.group_id).toBe("config_group");
  });
});
