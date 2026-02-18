/**
 * EverMemOS API Client
 *
 * HTTP client for communicating with the EverMemOS REST API.
 * Supports memory storage (POST /memories), retrieval (GET /memories),
 * search (GET /memories/search), and deletion (DELETE /memories).
 */

// ============================================================================
// Types
// ============================================================================

export interface EverMemOSClientConfig {
  baseUrl: string;
  apiKey?: string;
}

/** POST /memories request body */
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

/** POST /memories response */
export interface MemorizeResponse {
  status: string;
  message: string;
  result: {
    saved_memories: unknown[];
    count: number;
    status_info: string; // "extracted" or "accumulated"
  };
}

/** GET /memories request params */
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

/** GET /memories response */
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

/** GET /memories/search request params */
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

/** Profile item returned by search */
export interface ProfileItem {
  category?: string;
  description?: string;
  item_type?: string;
  trait_name?: string;
  score?: number;
  [key: string]: unknown;
}

/** GET /memories/search response */
export interface SearchMemResponse {
  status: string;
  message: string;
  result: {
    memories: MemoryItem[];
    profiles: ProfileItem[];
    scores: number[];
    total_count: number;
    has_more: boolean;
    pending_messages: unknown[];
    metadata?: Record<string, unknown>;
    query_metadata?: Record<string, unknown>;
    original_data?: unknown[];
  };
}

/** DELETE /memories request body */
export interface DeleteMemoriesRequest {
  event_id?: string;
  user_id?: string;
  group_id?: string;
  memory_type?: string;
}

/** DELETE /memories response */
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
  private apiBaseUrl: string;
  private healthUrl: string;
  private apiKey?: string;

  constructor(config: EverMemOSClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;

    const parsed = new URL(this.baseUrl);
    const apiPathMatch = parsed.pathname.match(/^(.*)\/api\/(v\d+)\/?$/);
    if (!apiPathMatch) {
      throw new Error(
        "EverMemOS baseUrl must include a versioned API path (e.g. http://localhost:1995/api/v1 or https://api.evermind.ai/api/v0)",
      );
    }

    const rootPath = apiPathMatch[1].replace(/\/+$/, "");
    const version = apiPathMatch[2];

    this.apiBaseUrl = `${parsed.origin}${rootPath}/api/${version}`.replace(/\/+$/, "");
    this.healthUrl = `${parsed.origin}${rootPath}/health`;
  }

  private buildHeaders(includeJsonContentType = false): Record<string, string> {
    const headers: Record<string, string> = {};
    if (includeJsonContentType) {
      headers["Content-Type"] = "application/json";
    }
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  /** Check server health */
  async health(): Promise<HealthResponse> {
    const resp = await fetch(this.healthUrl, {
      headers: this.buildHeaders(),
    });
    if (!resp.ok) {
      throw new Error(`EverMemOS health check failed: ${resp.status} ${resp.statusText}`);
    }
    return resp.json() as Promise<HealthResponse>;
  }

  /** Store a message into EverMemOS memory (POST /memories) */
  async memorize(request: MemorizeMessageRequest): Promise<MemorizeResponse> {
    const resp = await fetch(`${this.apiBaseUrl}/memories`, {
      method: "POST",
      headers: this.buildHeaders(true),
      body: JSON.stringify(request),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`EverMemOS memorize failed: ${resp.status} ${resp.statusText} ${text}`);
    }
    return resp.json() as Promise<MemorizeResponse>;
  }

  /** Fetch memories from EverMemOS (GET /memories) */
  async fetchMemories(request: FetchMemRequest): Promise<FetchMemResponse> {
    const params = new URLSearchParams();
    if (request.user_id) params.set("user_id", request.user_id);
    if (request.group_id) params.set("group_id", request.group_id);
    if (request.limit != null) params.set("limit", String(request.limit));
    if (request.offset != null) params.set("offset", String(request.offset));
    if (request.memory_type) params.set("memory_type", request.memory_type);
    if (request.start_time) params.set("start_time", request.start_time);
    if (request.end_time) params.set("end_time", request.end_time);

    const resp = await fetch(`${this.apiBaseUrl}/memories?${params.toString()}`, {
      headers: this.buildHeaders(),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`EverMemOS fetch failed: ${resp.status} ${resp.statusText} ${text}`);
    }
    return resp.json() as Promise<FetchMemResponse>;
  }

  /** Search/retrieve memories from EverMemOS (GET /memories/search) */
  async searchMemories(request: RetrieveMemRequest): Promise<SearchMemResponse> {
    const params = new URLSearchParams();
    if (request.query) params.set("query", request.query);
    if (request.user_id) params.set("user_id", request.user_id);
    if (request.group_id) params.set("group_id", request.group_id);
    if (request.top_k != null) params.set("top_k", String(request.top_k));
    if (request.retrieve_method) params.set("retrieve_method", request.retrieve_method);
    if (request.start_time) params.set("start_time", request.start_time);
    if (request.end_time) params.set("end_time", request.end_time);
    if (request.current_time) params.set("current_time", request.current_time);
    if (request.radius != null) params.set("radius", String(request.radius));
    if (request.memory_types?.length) {
      for (const memoryType of request.memory_types) {
        params.append("memory_types", memoryType);
      }
    }

    const resp = await fetch(`${this.apiBaseUrl}/memories/search?${params.toString()}`, {
      headers: this.buildHeaders(),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`EverMemOS search failed: ${resp.status} ${resp.statusText} ${text}`);
    }
    return resp.json() as Promise<SearchMemResponse>;
  }

  /** Delete memories from EverMemOS (DELETE /memories) */
  async deleteMemories(request: DeleteMemoriesRequest): Promise<DeleteMemoriesResponse> {
    const resp = await fetch(`${this.apiBaseUrl}/memories`, {
      method: "DELETE",
      headers: this.buildHeaders(true),
      body: JSON.stringify(request),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`EverMemOS delete failed: ${resp.status} ${resp.statusText} ${text}`);
    }
    return resp.json() as Promise<DeleteMemoriesResponse>;
  }
}
