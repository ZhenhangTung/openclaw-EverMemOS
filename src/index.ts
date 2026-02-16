/**
 * OpenClaw EverMemOS Plugin
 *
 * Long-term memory via EverMemOS — an advanced memory OS that provides
 * structured extraction, intelligent retrieval, and progressive profile building.
 * Achieves 93% reasoning accuracy on the LoCoMo benchmark.
 *
 * Features:
 * - 5 tools: memory_search, memory_list, memory_store, memory_get, memory_forget
 * - Multi-modal memory types: episodic, event_log, foresight, profile
 * - Smart retrieval: keyword (BM25), vector, hybrid, RRF, and agentic search
 * - Auto-recall: injects relevant memories before each agent turn
 * - Auto-capture: stores conversation context after each agent turn
 * - CLI: openclaw evermemos search, openclaw evermemos stats
 */

import { Type } from "@sinclair/typebox";
import type {
  EverMemOSClient,
  MemoryItem,
  SearchMemoryGroup,
} from "./client.js";

// ============================================================================
// Types
// ============================================================================

type RetrieveMethod = "keyword" | "vector" | "hybrid" | "rrf" | "agentic";
type MemoryType = "episodic_memory" | "foresight" | "event_log" | "profile";

type EverMemOSConfig = {
  baseUrl: string;
  apiKey?: string;
  userId: string;
  groupId?: string;
  autoCapture: boolean;
  autoRecall: boolean;
  retrieveMethod: RetrieveMethod;
  memoryTypes: MemoryType[];
  topK: number;
};

// OpenClaw plugin API type (simplified — the actual type comes from openclaw/plugin-sdk)
type PluginLogger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

type AnyAgentTool = {
  name: string;
  label?: string;
  description: string;
  parameters: unknown;
  execute: (
    toolCallId: string,
    params: unknown,
  ) => Promise<{
    content: Array<{ type: string; text: string }>;
    details?: Record<string, unknown>;
  }>;
};

type OpenClawPluginApi = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  config: unknown;
  pluginConfig?: Record<string, unknown>;
  runtime: unknown;
  logger: PluginLogger;
  registerTool: (
    tool: AnyAgentTool,
    opts?: { name?: string },
  ) => void;
  registerCli: (
    registrar: (ctx: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      program: any;
      config: unknown;
      workspaceDir?: string;
      logger: PluginLogger;
    }) => void | Promise<void>,
    opts?: { commands?: string[] },
  ) => void;
  registerService: (service: {
    id: string;
    start: (ctx: unknown) => void | Promise<void>;
    stop?: (ctx: unknown) => void | Promise<void>;
  }) => void;
  on: (
    hookName: string,
    handler: (event: unknown, ctx: unknown) => unknown,
    opts?: { priority?: number },
  ) => void;
  registerCommand: (command: {
    name: string;
    description: string;
    acceptsArgs?: boolean;
    requireAuth?: boolean;
    handler: (ctx: {
      args?: string;
      config: unknown;
    }) => { text: string } | Promise<{ text: string }>;
  }) => void;
  resolvePath: (input: string) => string;
};

// ============================================================================
// Config
// ============================================================================

const ALLOWED_KEYS = [
  "baseUrl",
  "apiKey",
  "userId",
  "groupId",
  "autoCapture",
  "autoRecall",
  "retrieveMethod",
  "memoryTypes",
  "topK",
];

const VALID_RETRIEVE_METHODS: RetrieveMethod[] = [
  "keyword",
  "vector",
  "hybrid",
  "rrf",
  "agentic",
];

const VALID_MEMORY_TYPES: MemoryType[] = [
  "episodic_memory",
  "foresight",
  "event_log",
  "profile",
];

function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, envVar) => {
    const envValue = process.env[envVar as string];
    if (!envValue) {
      throw new Error(`Environment variable ${envVar} is not set`);
    }
    return envValue;
  });
}

function parseConfig(raw: unknown): EverMemOSConfig {
  if (raw == null) {
    raw = {};
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("openclaw-evermemos config required");
  }
  const cfg = raw as Record<string, unknown>;

  // Validate keys
  const unknown = Object.keys(cfg).filter((k) => !ALLOWED_KEYS.includes(k));
  if (unknown.length > 0) {
    throw new Error(`openclaw-evermemos config has unknown keys: ${unknown.join(", ")}`);
  }

  // Base URL is required
  let baseUrl: string;
  if (typeof cfg.baseUrl === "string" && cfg.baseUrl) {
    baseUrl = resolveEnvVars(cfg.baseUrl);
  } else {
    // Default to localhost
    baseUrl = process.env.EVERMEMOS_BASE_URL || "http://localhost:1995/api/v1";
  }

  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid baseUrl: ${baseUrl}`);
  }

  if (!/\/api\/v\d+\/?$/.test(parsedBaseUrl.pathname)) {
    throw new Error(
      "baseUrl must include a versioned API path (e.g. http://localhost:1995/api/v1 or https://api.evermind.ai/api/v0)",
    );
  }

  // API key is optional (required for cloud, optional for self-hosted)
  let apiKey: string | undefined;
  if (typeof cfg.apiKey === "string" && cfg.apiKey) {
    apiKey = resolveEnvVars(cfg.apiKey);
  } else if (process.env.EVERMEMOS_API_KEY) {
    apiKey = process.env.EVERMEMOS_API_KEY;
  }

  // Retrieve method
  let retrieveMethod: RetrieveMethod = "hybrid";
  if (typeof cfg.retrieveMethod === "string") {
    if (!VALID_RETRIEVE_METHODS.includes(cfg.retrieveMethod as RetrieveMethod)) {
      throw new Error(
        `Invalid retrieveMethod "${cfg.retrieveMethod}". Must be one of: ${VALID_RETRIEVE_METHODS.join(", ")}`,
      );
    }
    retrieveMethod = cfg.retrieveMethod as RetrieveMethod;
  }

  // Memory types
  let memoryTypes: MemoryType[] = ["episodic_memory"];
  if (Array.isArray(cfg.memoryTypes)) {
    for (const mt of cfg.memoryTypes) {
      if (typeof mt !== "string" || !VALID_MEMORY_TYPES.includes(mt as MemoryType)) {
        throw new Error(
          `Invalid memory type "${mt}". Must be one of: ${VALID_MEMORY_TYPES.join(", ")}`,
        );
      }
    }
    memoryTypes = cfg.memoryTypes as MemoryType[];
  }

  return {
    baseUrl,
    apiKey,
    userId: typeof cfg.userId === "string" && cfg.userId ? cfg.userId : "default",
    groupId: typeof cfg.groupId === "string" && cfg.groupId ? cfg.groupId : undefined,
    autoCapture: cfg.autoCapture !== false,
    autoRecall: cfg.autoRecall !== false,
    retrieveMethod,
    memoryTypes,
    topK: typeof cfg.topK === "number" ? cfg.topK : 10,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/** Extract readable text from a memory item */
function memoryToText(item: MemoryItem): string {
  if (item.summary) return item.summary;
  if (item.episode) return item.episode;
  if (item.atomic_fact) return item.atomic_fact;
  if (item.content) return item.content;
  if (item.foresight) return item.foresight;
  return JSON.stringify(item);
}

/** Flatten search result groups into a flat list of memories with types */
function flattenSearchResults(
  groups: SearchMemoryGroup[],
  scores?: Array<Record<string, number[]>>,
): Array<MemoryItem & { _type: string; _score?: number }> {
  const results: Array<MemoryItem & { _type: string; _score?: number }> = [];
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const scoreGroup = scores?.[i];
    for (const [memType, memories] of Object.entries(group)) {
      const typeScores = scoreGroup?.[memType];
      for (let j = 0; j < memories.length; j++) {
        results.push({
          ...memories[j],
          _type: memType,
          _score: typeScores?.[j],
        });
      }
    }
  }
  return results;
}

/** Generate a unique message ID */

/** Minimum text length to capture (skip very short messages) */
const MIN_CAPTURE_TEXT_LENGTH = 10;
function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================================
// Plugin Definition
// ============================================================================

const evermemosPlugin = {
  id: "openclaw-evermemos",
  name: "Memory (EverMemOS)",
  description:
    "EverMemOS memory backend — structured extraction, intelligent retrieval, and progressive profile building",
  kind: "memory" as const,
  configSchema: { parse: parseConfig },

  register(api: OpenClawPluginApi) {
    const cfg = parseConfig(api.pluginConfig);

    // Lazy-initialize client to avoid top-level import issues
    let client: EverMemOSClient | null = null;

    async function getClient(): Promise<EverMemOSClient> {
      if (client) return client;
      const { EverMemOSClient: ClientClass } = await import("./client.js");
      client = new ClientClass({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey });
      return client;
    }

    api.logger.info(
      `openclaw-evermemos: registered (url: ${cfg.baseUrl}, user: ${cfg.userId}, ` +
      `retrieve: ${cfg.retrieveMethod}, autoRecall: ${cfg.autoRecall}, autoCapture: ${cfg.autoCapture})`,
    );

    // ========================================================================
    // Tools
    // ========================================================================

    api.registerTool(
      {
        name: "memory_search",
        label: "Memory Search",
        description:
          "Search through memories stored in EverMemOS. Supports episodic memories, event logs, foresight, and profiles. " +
          "Use when you need context about user preferences, past decisions, or previously discussed topics.",
        parameters: Type.Object({
          query: Type.String({ description: "Search query" }),
          limit: Type.Optional(
            Type.Number({ description: `Max results (default: ${cfg.topK})` }),
          ),
          userId: Type.Optional(
            Type.String({ description: "User ID to scope search (default: configured userId)" }),
          ),
          memoryTypes: Type.Optional(
            Type.Array(
              Type.Union([
                Type.Literal("episodic_memory"),
                Type.Literal("foresight"),
                Type.Literal("event_log"),
                Type.Literal("profile"),
              ]),
              { description: "Memory types to search (default: configured types)" },
            ),
          ),
          retrieveMethod: Type.Optional(
            Type.Union([
              Type.Literal("keyword"),
              Type.Literal("vector"),
              Type.Literal("hybrid"),
              Type.Literal("rrf"),
              Type.Literal("agentic"),
            ], { description: "Retrieval method (default: configured method)" }),
          ),
        }),
        async execute(_toolCallId, params) {
          const {
            query,
            limit,
            userId,
            memoryTypes,
            retrieveMethod,
          } = params as {
            query: string;
            limit?: number;
            userId?: string;
            memoryTypes?: MemoryType[];
            retrieveMethod?: RetrieveMethod;
          };

          try {
            const c = await getClient();
            const response = await c.searchMemories({
              query,
              user_id: userId || cfg.userId,
              group_id: cfg.groupId,
              memory_types: memoryTypes || cfg.memoryTypes,
              top_k: limit ?? cfg.topK,
              retrieve_method: retrieveMethod || cfg.retrieveMethod,
            });

            const results = flattenSearchResults(
              response.result.memories,
              response.result.scores,
            );

            if (results.length === 0) {
              return {
                content: [{ type: "text", text: "No relevant memories found." }],
                details: { count: 0 },
              };
            }

            const text = results
              .map(
                (r, i) =>
                  `${i + 1}. [${r._type}] ${memoryToText(r)}${r._score != null ? ` (score: ${(r._score * 100).toFixed(0)}%)` : ""}`,
              )
              .join("\n");

            return {
              content: [
                { type: "text", text: `Found ${results.length} memories:\n\n${text}` },
              ],
              details: {
                count: results.length,
                total_count: response.result.total_count,
                memories: results.map((r) => ({
                  type: r._type,
                  text: memoryToText(r),
                  score: r._score,
                  id: r.id,
                })),
              },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Memory search failed: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "memory_search" },
    );

    api.registerTool(
      {
        name: "memory_store",
        label: "Memory Store",
        description:
          "Save a message into EverMemOS memory. The system will automatically extract episodic memories, " +
          "event logs, foresight predictions, and user profiles from the content.",
        parameters: Type.Object({
          text: Type.String({ description: "Information to remember" }),
          userId: Type.Optional(
            Type.String({ description: "User ID (sender) for this memory" }),
          ),
          role: Type.Optional(
            Type.Union([Type.Literal("user"), Type.Literal("assistant")], {
              description: "Role of the message sender (default: user)",
            }),
          ),
        }),
        async execute(_toolCallId, params) {
          const { text, userId, role = "user" } = params as {
            text: string;
            userId?: string;
            role?: "user" | "assistant";
          };

          try {
            const c = await getClient();
            const sender = userId || cfg.userId;
            const result = await c.memorize({
              message_id: generateMessageId(),
              create_time: new Date().toISOString(),
              sender,
              content: text,
              role,
              group_id: cfg.groupId,
            });

            const statusInfo = result.result.status_info;
            const count = result.result.count;

            let summary: string;
            if (statusInfo === "extracted") {
              summary = `Stored: ${count} memor${count === 1 ? "y" : "ies"} extracted from the content.`;
            } else {
              summary = "Message queued for memory extraction (awaiting boundary detection).";
            }

            return {
              content: [{ type: "text", text: summary }],
              details: {
                action: "stored",
                status_info: statusInfo,
                count,
              },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Memory store failed: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "memory_store" },
    );

    api.registerTool(
      {
        name: "memory_get",
        label: "Memory Get",
        description: "Retrieve memories for a specific user from EverMemOS.",
        parameters: Type.Object({
          userId: Type.Optional(
            Type.String({ description: "User ID (default: configured userId)" }),
          ),
          memoryType: Type.Optional(
            Type.Union([
              Type.Literal("episodic_memory"),
              Type.Literal("foresight"),
              Type.Literal("event_log"),
              Type.Literal("profile"),
            ], { description: "Memory type to retrieve (default: episodic_memory)" }),
          ),
          limit: Type.Optional(
            Type.Number({ description: "Maximum number of memories to return" }),
          ),
        }),
        async execute(_toolCallId, params) {
          const { userId, memoryType = "episodic_memory", limit = 20 } = params as {
            userId?: string;
            memoryType?: string;
            limit?: number;
          };

          try {
            const c = await getClient();
            const response = await c.fetchMemories({
              user_id: userId || cfg.userId,
              group_id: cfg.groupId,
              memory_type: memoryType,
              limit,
            });

            const memories = response.result.memories;

            if (!memories || memories.length === 0) {
              return {
                content: [{ type: "text", text: "No memories found." }],
                details: { count: 0 },
              };
            }

            const text = memories
              .map((r, i) => `${i + 1}. ${memoryToText(r)}`)
              .join("\n");

            return {
              content: [
                { type: "text", text: `${memories.length} memories (type: ${memoryType}):\n\n${text}` },
              ],
              details: {
                count: memories.length,
                total_count: response.result.total_count,
                has_more: response.result.has_more,
              },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Memory get failed: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "memory_get" },
    );

    api.registerTool(
      {
        name: "memory_list",
        label: "Memory List",
        description:
          "List all stored memories for a user across all memory types. " +
          "Use this when you want a comprehensive overview of what's been remembered.",
        parameters: Type.Object({
          userId: Type.Optional(
            Type.String({ description: "User ID (default: configured userId)" }),
          ),
          limit: Type.Optional(
            Type.Number({ description: "Maximum number of memories per type" }),
          ),
        }),
        async execute(_toolCallId, params) {
          const { userId, limit = 20 } = params as { userId?: string; limit?: number };

          try {
            const c = await getClient();
            const uid = userId || cfg.userId;
            const typesToQuery: MemoryType[] = ["episodic_memory", "event_log", "foresight", "profile"];
            const allMemories: Array<{ type: string; text: string }> = [];

            for (const memType of typesToQuery) {
              try {
                const response = await c.fetchMemories({
                  user_id: uid,
                  group_id: cfg.groupId,
                  memory_type: memType,
                  limit,
                });
                for (const mem of response.result.memories) {
                  allMemories.push({ type: memType, text: memoryToText(mem) });
                }
              } catch {
                // Some types may not be available; skip silently
              }
            }

            if (allMemories.length === 0) {
              return {
                content: [{ type: "text", text: "No memories stored yet." }],
                details: { count: 0 },
              };
            }

            const text = allMemories
              .map((r, i) => `${i + 1}. [${r.type}] ${r.text}`)
              .join("\n");

            return {
              content: [
                { type: "text", text: `${allMemories.length} memories:\n\n${text}` },
              ],
              details: { count: allMemories.length },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Memory list failed: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "memory_list" },
    );

    api.registerTool(
      {
        name: "memory_forget",
        label: "Memory Forget",
        description:
          "Delete memories from EverMemOS. You can delete by user_id, group_id, or specific event_id.",
        parameters: Type.Object({
          eventId: Type.Optional(
            Type.String({ description: "Specific memory event ID to delete" }),
          ),
          userId: Type.Optional(
            Type.String({ description: "User ID to delete memories for" }),
          ),
          memoryType: Type.Optional(
            Type.Union([
              Type.Literal("episodic_memory"),
              Type.Literal("foresight"),
              Type.Literal("event_log"),
            ], { description: "Memory type to delete" }),
          ),
          query: Type.Optional(
            Type.String({ description: "Search query to find and delete matching memories" }),
          ),
        }),
        async execute(_toolCallId, params) {
          const { eventId, userId, memoryType, query } = params as {
            eventId?: string;
            userId?: string;
            memoryType?: string;
            query?: string;
          };

          try {
            const c = await getClient();

            // If query is provided, search first then show candidates
            if (query && !eventId) {
              const searchResponse = await c.searchMemories({
                query,
                user_id: userId || cfg.userId,
                group_id: cfg.groupId,
                memory_types: memoryType ? [memoryType] : cfg.memoryTypes,
                top_k: 5,
                retrieve_method: cfg.retrieveMethod,
              });

              const results = flattenSearchResults(
                searchResponse.result.memories,
                searchResponse.result.scores,
              );

              if (results.length === 0) {
                return {
                  content: [{ type: "text", text: "No matching memories found to delete." }],
                  details: { found: 0 },
                };
              }

              const list = results
                .map(
                  (r) =>
                    `- [${r._type}] ${memoryToText(r).slice(0, 80)}${memoryToText(r).length > 80 ? "..." : ""}${r.id ? ` (id: ${r.id})` : ""}`,
                )
                .join("\n");

              return {
                content: [
                  {
                    type: "text",
                    text: `Found ${results.length} candidates. Use eventId to delete specific memories:\n${list}`,
                  },
                ],
                details: {
                  action: "candidates",
                  candidates: results.map((r) => ({
                    id: r.id,
                    type: r._type,
                    text: memoryToText(r),
                    score: r._score,
                  })),
                },
              };
            }

            // Direct deletion
            const result = await c.deleteMemories({
              event_id: eventId,
              user_id: userId || cfg.userId,
              group_id: cfg.groupId,
              memory_type: memoryType,
            });

            return {
              content: [
                {
                  type: "text",
                  text: `Deleted ${result.result.count} memor${result.result.count === 1 ? "y" : "ies"}.`,
                },
              ],
              details: {
                action: "deleted",
                deleted_count: result.result.count,
              },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Memory forget failed: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "memory_forget" },
    );

    // ========================================================================
    // CLI Commands
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const evermemos = program
          .command("evermemos")
          .description("EverMemOS memory plugin commands");

        const searchCmd = evermemos
          .command("search")
          .description("Search memories in EverMemOS");

        searchCmd
          .argument("<query>", "Search query")
          .option("--limit <n>", "Max results", String(cfg.topK))
          .option(
            "--method <method>",
            "Retrieval method: keyword, vector, hybrid, rrf, agentic",
            cfg.retrieveMethod,
          )
          .action(async (query: string, opts: { limit: string; method: string }) => {
            try {
              const c = await getClient();
              const limit = parseInt(opts.limit, 10);
              const response = await c.searchMemories({
                query,
                user_id: cfg.userId,
                group_id: cfg.groupId,
                memory_types: cfg.memoryTypes,
                top_k: limit,
                retrieve_method: opts.method,
              });

              const results = flattenSearchResults(
                response.result.memories,
                response.result.scores,
              );

              if (!results.length) {
                console.log("No memories found.");
                return;
              }

              const output = results.map((r) => ({
                type: r._type,
                text: memoryToText(r),
                score: r._score,
                id: r.id,
              }));
              console.log(JSON.stringify(output, null, 2));
            } catch (err) {
              console.error(`Search failed: ${String(err)}`);
            }
          });

        const statsCmd = evermemos
          .command("stats")
          .description("Show memory statistics from EverMemOS");

        statsCmd
          .action(async () => {
            try {
              const c = await getClient();
              console.log(`Server: ${cfg.baseUrl}`);
              console.log(`User: ${cfg.userId}`);
              console.log(`Group: ${cfg.groupId ?? "(none)"}`);
              console.log(`Retrieve method: ${cfg.retrieveMethod}`);
              console.log(`Memory types: ${cfg.memoryTypes.join(", ")}`);
              console.log(`Auto-recall: ${cfg.autoRecall}, Auto-capture: ${cfg.autoCapture}`);

              // Try to get counts per type
              for (const memType of ["episodic_memory", "event_log", "foresight", "profile"] as const) {
                try {
                  const response = await c.fetchMemories({
                    user_id: cfg.userId,
                    group_id: cfg.groupId,
                    memory_type: memType,
                    limit: 1,
                  });
                  console.log(`  ${memType}: ${response.result.total_count} memories`);
                } catch {
                  console.log(`  ${memType}: unavailable`);
                }
              }

              // Health check
              try {
                const health = await c.health();
                console.log(`Server status: ${health.status}`);
              } catch {
                console.log("Server status: unreachable");
              }
            } catch (err) {
              console.error(`Stats failed: ${String(err)}`);
            }
          });
      },
      { commands: ["evermemos"] },
    );

    // ========================================================================
    // Lifecycle Hooks
    // ========================================================================

    // Auto-recall: inject relevant memories before agent starts
    if (cfg.autoRecall) {
      api.on("before_agent_start", async (event: unknown, _ctx: unknown) => {
        const ev = event as { prompt?: string; messages?: unknown[] };
        if (!ev.prompt || ev.prompt.length < 5) return;

        try {
          const c = await getClient();
          const response = await c.searchMemories({
            query: ev.prompt,
            user_id: cfg.userId,
            group_id: cfg.groupId,
            memory_types: cfg.memoryTypes,
            top_k: cfg.topK,
            retrieve_method: cfg.retrieveMethod,
          });

          const results = flattenSearchResults(
            response.result.memories,
            response.result.scores,
          );

          if (results.length === 0) return;

          // Build memory context grouped by type
          const byType = new Map<string, string[]>();
          for (const r of results) {
            const type = r._type;
            if (!byType.has(type)) byType.set(type, []);
            byType.get(type)!.push(`- ${memoryToText(r)}`);
          }

          let memoryContext = "";
          for (const [type, items] of byType) {
            memoryContext += `\n${type}:\n${items.join("\n")}`;
          }

          api.logger.info(
            `openclaw-evermemos: injecting ${results.length} memories into context`,
          );

          return {
            prependContext:
              `<relevant-memories>\nThe following memories from EverMemOS may be relevant to this conversation:\n` +
              `${memoryContext}\n\n` +
              `Use these memories naturally when relevant — including indirect connections — but don't force them into every response or make assumptions beyond what's stated.\n` +
              `</relevant-memories>`,
          };
        } catch (err) {
          api.logger.warn(`openclaw-evermemos: recall failed: ${String(err)}`);
        }
      });
    }

    // Auto-capture: store the last user/assistant turn after agent ends
    if (cfg.autoCapture) {
      api.on("agent_end", async (event: unknown, _ctx: unknown) => {
        const ev = event as {
          messages?: unknown[];
          success?: boolean;
        };

        if (!ev.success || !ev.messages || ev.messages.length === 0) return;

        try {
          const c = await getClient();

          // Extract only the last turn (last user message + following assistant messages)
          const messages = ev.messages;
          let lastUserIdx = -1;
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (
              msg &&
              typeof msg === "object" &&
              (msg as Record<string, unknown>).role === "user"
            ) {
              lastUserIdx = i;
              break;
            }
          }
          const lastTurn = lastUserIdx >= 0 ? messages.slice(lastUserIdx) : [];

          let capturedCount = 0;
          for (const msg of lastTurn) {
            if (!msg || typeof msg !== "object") continue;
            const msgObj = msg as Record<string, unknown>;

            const role = msgObj.role;
            if (role !== "user" && role !== "assistant") continue;

            let textContent = "";
            const content = msgObj.content;

            if (typeof content === "string") {
              textContent = content;
            } else if (Array.isArray(content)) {
              for (const block of content) {
                if (
                  block &&
                  typeof block === "object" &&
                  "type" in block &&
                  (block as Record<string, unknown>).type === "text" &&
                  "text" in block &&
                  typeof (block as Record<string, unknown>).text === "string"
                ) {
                  textContent +=
                    (textContent ? "\n" : "") +
                    ((block as Record<string, unknown>).text as string);
                }
              }
            }

            if (!textContent || textContent.length < MIN_CAPTURE_TEXT_LENGTH) continue;
            // Skip injected memory context
            if (textContent.includes("<relevant-memories>")) continue;

            await c.memorize({
              message_id: generateMessageId(),
              create_time: new Date().toISOString(),
              sender: cfg.userId,
              content: textContent,
              role: role as "user" | "assistant",
              group_id: cfg.groupId,
            });
            capturedCount++;
          }

          if (capturedCount > 0) {
            api.logger.info(
              `openclaw-evermemos: auto-captured ${capturedCount} messages from last turn`,
            );
          }
        } catch (err) {
          api.logger.warn(`openclaw-evermemos: capture failed: ${String(err)}`);
        }
      });
    }

    // ========================================================================
    // Slash Commands
    // ========================================================================

    api.registerCommand({
      name: "remember",
      description: "Save something to EverMemOS memory",
      acceptsArgs: true,
      handler: async (ctx) => {
        const text = ctx.args?.trim();
        if (!text) {
          return { text: "Usage: /remember <text to remember>" };
        }

        try {
          const c = await getClient();
          const result = await c.memorize({
            message_id: generateMessageId(),
            create_time: new Date().toISOString(),
            sender: cfg.userId,
            content: text,
            role: "user",
            group_id: cfg.groupId,
          });

          if (result.result.status_info === "extracted") {
            return { text: `✅ Remembered: ${result.result.count} memor${result.result.count === 1 ? "y" : "ies"} extracted.` };
          }
          return { text: "✅ Message queued for memory extraction." };
        } catch (err) {
          return { text: `❌ Failed to remember: ${String(err)}` };
        }
      },
    });

    api.registerCommand({
      name: "recall",
      description: "Search your EverMemOS memories",
      acceptsArgs: true,
      handler: async (ctx) => {
        const query = ctx.args?.trim();
        if (!query) {
          return { text: "Usage: /recall <search query>" };
        }

        try {
          const c = await getClient();
          const response = await c.searchMemories({
            query,
            user_id: cfg.userId,
            group_id: cfg.groupId,
            memory_types: cfg.memoryTypes,
            top_k: cfg.topK,
            retrieve_method: cfg.retrieveMethod,
          });

          const results = flattenSearchResults(
            response.result.memories,
            response.result.scores,
          );

          if (results.length === 0) {
            return { text: "No relevant memories found." };
          }

          const lines = results.map(
            (r, i) =>
              `${i + 1}. [${r._type}] ${memoryToText(r)}${r._score != null ? ` (${(r._score * 100).toFixed(0)}%)` : ""}`,
          );

          return { text: `Found ${results.length} memories:\n\n${lines.join("\n")}` };
        } catch (err) {
          return { text: `❌ Recall failed: ${String(err)}` };
        }
      },
    });

    // ========================================================================
    // Service
    // ========================================================================

    api.registerService({
      id: "openclaw-evermemos",
      start: () => {
        api.logger.info(
          `openclaw-evermemos: initialized (url: ${cfg.baseUrl}, user: ${cfg.userId}, ` +
          `autoRecall: ${cfg.autoRecall}, autoCapture: ${cfg.autoCapture})`,
        );
      },
      stop: () => {
        api.logger.info("openclaw-evermemos: stopped");
      },
    });
  },
};

export default evermemosPlugin;

export { parseConfig, flattenSearchResults, memoryToText, generateMessageId };
export type { EverMemOSConfig, RetrieveMethod, MemoryType };
