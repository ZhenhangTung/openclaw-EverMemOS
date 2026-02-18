import { describe, it, expect, vi, beforeEach } from "vitest";
import { EverMemOSClient } from "../src/client.js";

// ============================================================================
// Mock fetch for testing
// ============================================================================

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

describe("EverMemOSClient", () => {
  let client: EverMemOSClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new EverMemOSClient({ baseUrl: "http://localhost:1995/api/v1" });
  });

  describe("constructor", () => {
    it("should strip trailing slashes from baseUrl", () => {
      const c = new EverMemOSClient({ baseUrl: "http://localhost:1995/api/v1///" });
      // We can verify by calling health and checking the URL
      mockFetch.mockResolvedValueOnce(mockResponse({ status: "healthy" }));
      c.health();
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:1995/health",
        expect.objectContaining({ headers: {} }),
      );
    });

    it("should use explicit /api/v1 path from baseUrl", async () => {
      const c = new EverMemOSClient({ baseUrl: "http://localhost:1995/api/v1" });
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          status: "ok",
          message: "Extracted 0 memories",
          result: { saved_memories: [], count: 0, status_info: "extracted" },
        }),
      );

      await c.memorize({
        message_id: "msg_001",
        create_time: "2025-01-15T10:00:00+00:00",
        sender: "user_001",
        content: "test",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:1995/api/v1/memories",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("should use existing api path from baseUrl", async () => {
      const c = new EverMemOSClient({ baseUrl: "https://api.evermind.ai/api/v0" });
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          status: "ok",
          message: "Extracted 0 memories",
          result: { saved_memories: [], count: 0, status_info: "extracted" },
        }),
      );

      await c.memorize({
        message_id: "msg_001",
        create_time: "2025-01-15T10:00:00+00:00",
        sender: "user_001",
        content: "test",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.evermind.ai/api/v0/memories",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("should reject baseUrl without versioned API path", () => {
      expect(() => new EverMemOSClient({ baseUrl: "http://localhost:1995" })).toThrow(
        "baseUrl must include a versioned API path",
      );
    });
  });

  describe("health", () => {
    it("should call /health endpoint", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ status: "healthy" }));

      const result = await client.health();
      expect(result.status).toBe("healthy");
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:1995/health",
        expect.objectContaining({ headers: {} }),
      );
    });

    it("should throw on failure", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({}, 500));

      await expect(client.health()).rejects.toThrow("health check failed");
    });
  });

  describe("memorize", () => {
    it("should POST to /api/v1/memories", async () => {
      const mockResult = {
        status: "ok",
        message: "Extracted 1 memories",
        result: { saved_memories: [], count: 1, status_info: "extracted" },
      };
      mockFetch.mockResolvedValueOnce(mockResponse(mockResult));

      const result = await client.memorize({
        message_id: "msg_001",
        create_time: "2025-01-15T10:00:00+00:00",
        sender: "user_001",
        content: "I love playing soccer on weekends",
      });

      expect(result.result.count).toBe(1);
      expect(result.result.status_info).toBe("extracted");
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:1995/api/v1/memories",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );

      // Verify the request body
      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.message_id).toBe("msg_001");
      expect(body.sender).toBe("user_001");
      expect(body.content).toBe("I love playing soccer on weekends");
    });

    it("should include optional fields", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          status: "ok",
          result: { saved_memories: [], count: 0, status_info: "accumulated" },
        }),
      );

      await client.memorize({
        message_id: "msg_002",
        create_time: "2025-01-15T10:05:00+00:00",
        sender: "user_001",
        content: "Hello",
        group_id: "group_123",
        group_name: "Project Chat",
        sender_name: "John",
        role: "user",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.group_id).toBe("group_123");
      expect(body.group_name).toBe("Project Chat");
      expect(body.sender_name).toBe("John");
      expect(body.role).toBe("user");
    });

    it("should throw on failure", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ error: "bad" }, 400));

      await expect(
        client.memorize({
          message_id: "msg_001",
          create_time: "2025-01-15T10:00:00+00:00",
          sender: "user_001",
          content: "test",
        }),
      ).rejects.toThrow("memorize failed");
    });
  });

  describe("fetchMemories", () => {
    it("should GET /api/v1/memories with query params", async () => {
      const mockResult = {
        status: "ok",
        result: {
          memories: [{ summary: "Test memory", memory_type: "episodic_memory" }],
          total_count: 1,
          has_more: false,
        },
      };
      mockFetch.mockResolvedValueOnce(mockResponse(mockResult));

      const result = await client.fetchMemories({
        user_id: "user_123",
        memory_type: "episodic_memory",
        limit: 10,
      });

      expect(result.result.memories).toHaveLength(1);
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("user_id=user_123");
      expect(url).toContain("memory_type=episodic_memory");
      expect(url).toContain("limit=10");
    });

    it("should handle empty results", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          status: "ok",
          result: { memories: [], total_count: 0, has_more: false },
        }),
      );

      const result = await client.fetchMemories({ user_id: "user_123" });
      expect(result.result.memories).toHaveLength(0);
    });
  });

  describe("searchMemories", () => {
    it("should GET /api/v1/memories/search with query params and no body", async () => {
      const mockResult = {
        status: "ok",
        result: {
          memories: [
            { summary: "Discussed coffee", user_id: "user_123", memory_type: "episodic_memory" },
          ],
          profiles: [],
          scores: [0.95],
          total_count: 1,
          has_more: false,
          pending_messages: [],
        },
      };
      mockFetch.mockResolvedValueOnce(mockResponse(mockResult));

      const result = await client.searchMemories({
        query: "coffee",
        user_id: "user_123",
        memory_types: ["episodic_memory"],
        top_k: 5,
        retrieve_method: "hybrid",
      });

      expect(result.result.memories).toHaveLength(1);
      expect(result.result.scores[0]).toBe(0.95);

      const [url, options] = mockFetch.mock.calls[0] as [string, Record<string, unknown> | undefined];
      expect(url).toContain("/api/v1/memories/search?");
      expect(url).toContain("query=coffee");
      expect(url).toContain("user_id=user_123");
      expect(url).toContain("top_k=5");
      expect(options?.body).toBeUndefined();
    });

    it("should throw on failure", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({}, 500));

      await expect(
        client.searchMemories({ query: "test", user_id: "u1" }),
      ).rejects.toThrow("search failed");
    });
  });

  describe("deleteMemories", () => {
    it("should DELETE /api/v1/memories", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          status: "ok",
          message: "Successfully deleted 1 memories",
          result: { filters: ["user_id", "event_id"], count: 1 },
        }),
      );

      const result = await client.deleteMemories({
        user_id: "user_123",
        event_id: "event_001",
      });

      expect(result.result.count).toBe(1);
      expect(result.result.filters).toEqual(["user_id", "event_id"]);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:1995/api/v1/memories",
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("should throw on failure", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({}, 500));

      await expect(
        client.deleteMemories({ user_id: "u1" }),
      ).rejects.toThrow("delete failed");
    });
  });

  describe("apiKey", () => {
    it("should include Authorization header when apiKey is provided", async () => {
      const c = new EverMemOSClient({
        baseUrl: "https://api.evermind.ai/api/v0",
        apiKey: "test_api_key",
      });

      mockFetch.mockResolvedValueOnce(
        mockResponse({
          status: "ok",
          message: "Extracted 0 memories",
          result: { saved_memories: [], count: 0, status_info: "extracted" },
        }),
      );

      await c.memorize({
        message_id: "msg_001",
        create_time: "2025-01-15T10:00:00+00:00",
        sender: "user_001",
        content: "test",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.evermind.ai/api/v0/memories",
        expect.objectContaining({
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer test_api_key",
          },
        }),
      );
    });
  });
});
