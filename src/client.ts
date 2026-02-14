/**
 * EverMemOS API Client
 *
 * HTTP client for communicating with the EverMemOS REST API.
 * Supports memory storage (POST /api/v1/memories), retrieval (GET /api/v1/memories),
 * search (GET /api/v1/memories/search), and deletion (DELETE /api/v1/memories).
 */

// ============================================================================
// Types
// ============================================================================

export interface EverMemOSClientConfig {
  baseUrl: string;
}

/** POST /api/v1/memories request body */
export interface MemorizeMessageRequest {
  message_id: string;
  create_time: string;
  sender: string;
  content: string;
  group_id?: string;
  group_name?: string;
  sender_name?: string;
  role?: "user" | "assistant";
  refer_list?: string[];
}

/** POST /api/v1/memories response */
export interface MemorizeResponse {
  status: string;
  message: string;
  result: {
    saved_memories: unknown[];
    count: number;
    status_info: string; // "extracted" or "accumulated"
  };
}

/** GET /api/v1/memories request params */
export interface FetchMemRequest {
  user_id?: string;
  group_id?: string;
  limit?: number;
  offset?: number;
  memory_type?: string;
  start_time?: string;
  end_time?: string;
}

/** Memory item in fetch response */
export interface MemoryItem {
  memory_type?: string;
  user_id?: string;
  timestamp?: string;
  summary?: string;
  episode?: string;
  subject?: string;
  group_id?: string;
  group_name?: string;
  participants?: string[];
  id?: string;
  atomic_fact?: string;
  content?: string;
  foresight?: string;
  evidence?: string;
  [key: string]: unknown;
}

/** GET /api/v1/memories response */
export interface FetchMemResponse {
  status: string;
  message: string;
  result: {
    memories: MemoryItem[];
    total_count: number;
    has_more: boolean;
    metadata?: Record<string, unknown>;
  };
}

/** GET /api/v1/memories/search request params */
export interface RetrieveMemRequest {
  query?: string;
  user_id?: string;
  group_id?: string;
  memory_types?: string[];
  top_k?: number;
  retrieve_method?: string;
  start_time?: string;
  end_time?: string;
  current_time?: string;
  radius?: number;
}

/** Search result memory group */
export interface SearchMemoryGroup {
  [memoryType: string]: MemoryItem[];
}

/** GET /api/v1/memories/search response */
export interface SearchMemResponse {
  status: string;
  message: string;
  result: {
    memories: SearchMemoryGroup[];
    scores: Array<Record<string, number[]>>;
    importance_scores: number[];
    total_count: number;
    has_more: boolean;
    pending_messages: unknown[];
  };
}

/** DELETE /api/v1/memories request body */
export interface DeleteMemoriesRequest {
  event_id?: string;
  user_id?: string;
  group_id?: string;
  memory_type?: string;
}

/** DELETE /api/v1/memories response */
export interface DeleteMemoriesResponse {
  status: string;
  message: string;
  result: {
    filters: string[];
    count: number;
  };
}

/** GET /health response */
export interface HealthResponse {
  status: string;
  [key: string]: unknown;
}

// ============================================================================
// Client
// ============================================================================

export class EverMemOSClient {
  private baseUrl: string;

  constructor(config: EverMemOSClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
  }

  /** Check server health */
  async health(): Promise<HealthResponse> {
    const resp = await fetch(`${this.baseUrl}/health`);
    if (!resp.ok) {
      throw new Error(`EverMemOS health check failed: ${resp.status} ${resp.statusText}`);
    }
    return resp.json() as Promise<HealthResponse>;
  }

  /** Store a message into EverMemOS memory (POST /api/v1/memories) */
  async memorize(request: MemorizeMessageRequest): Promise<MemorizeResponse> {
    const resp = await fetch(`${this.baseUrl}/api/v1/memories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`EverMemOS memorize failed: ${resp.status} ${resp.statusText} ${text}`);
    }
    return resp.json() as Promise<MemorizeResponse>;
  }

  /** Fetch memories from EverMemOS (GET /api/v1/memories) */
  async fetchMemories(request: FetchMemRequest): Promise<FetchMemResponse> {
    const params = new URLSearchParams();
    if (request.user_id) params.set("user_id", request.user_id);
    if (request.group_id) params.set("group_id", request.group_id);
    if (request.limit != null) params.set("limit", String(request.limit));
    if (request.offset != null) params.set("offset", String(request.offset));
    if (request.memory_type) params.set("memory_type", request.memory_type);
    if (request.start_time) params.set("start_time", request.start_time);
    if (request.end_time) params.set("end_time", request.end_time);

    const resp = await fetch(`${this.baseUrl}/api/v1/memories?${params.toString()}`);
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`EverMemOS fetch failed: ${resp.status} ${resp.statusText} ${text}`);
    }
    return resp.json() as Promise<FetchMemResponse>;
  }

  /** Search/retrieve memories from EverMemOS (GET /api/v1/memories/search) */
  async searchMemories(request: RetrieveMemRequest): Promise<SearchMemResponse> {
    const resp = await fetch(`${this.baseUrl}/api/v1/memories/search`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    // Some HTTP clients/servers don't support GET with body, fall back to POST-style query
    if (!resp.ok && resp.status === 405) {
      return this.searchMemoriesPost(request);
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`EverMemOS search failed: ${resp.status} ${resp.statusText} ${text}`);
    }
    return resp.json() as Promise<SearchMemResponse>;
  }

  /** Fallback search using query params */
  private async searchMemoriesPost(request: RetrieveMemRequest): Promise<SearchMemResponse> {
    const params = new URLSearchParams();
    if (request.query) params.set("query", request.query);
    if (request.user_id) params.set("user_id", request.user_id);
    if (request.group_id) params.set("group_id", request.group_id);
    if (request.top_k != null) params.set("top_k", String(request.top_k));
    if (request.retrieve_method) params.set("retrieve_method", request.retrieve_method);
    if (request.memory_types?.length) {
      for (const mt of request.memory_types) {
        params.append("memory_types", mt);
      }
    }

    const resp = await fetch(`${this.baseUrl}/api/v1/memories/search?${params.toString()}`);
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`EverMemOS search failed: ${resp.status} ${resp.statusText} ${text}`);
    }
    return resp.json() as Promise<SearchMemResponse>;
  }

  /** Delete memories from EverMemOS (DELETE /api/v1/memories) */
  async deleteMemories(request: DeleteMemoriesRequest): Promise<DeleteMemoriesResponse> {
    const resp = await fetch(`${this.baseUrl}/api/v1/memories`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`EverMemOS delete failed: ${resp.status} ${resp.statusText} ${text}`);
    }
    return resp.json() as Promise<DeleteMemoriesResponse>;
  }
}
