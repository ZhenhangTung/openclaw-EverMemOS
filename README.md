# 🦞🧠 OpenClaw EverMemOS Plugin

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

An [OpenClaw](https://github.com/openclaw/openclaw) plugin that adds long-term memory powered by [EverMemOS](https://github.com/EverMind-AI/EverMemOS) — an advanced Memory OS that provides structured extraction, intelligent retrieval, and progressive profile building with **93% reasoning accuracy** on the LoCoMo benchmark.

## Overview

This plugin integrates EverMemOS as the memory layer for OpenClaw agents. Unlike simple key-value memory stores, EverMemOS provides:

- **Multi-modal memory types** — Episodic memories, event logs, foresight predictions, and user profiles
- **Smart retrieval** — BM25 keyword search, vector semantic search, hybrid, RRF fusion, and LLM-guided agentic retrieval
- **Structured extraction** — Automatically extracts structured memories from conversations with boundary detection
- **Progressive profiles** — Builds and evolves user profiles over time from conversation patterns

### How It Works

```
                     ┌──────────────────┐
 OpenClaw Agent ────▶│  openclaw-       │──── REST API ──── EverMemOS Server
                     │  evermemos       │                  (localhost:1995)
                     │  plugin          │
                     └──────────────────┘
                       │
                       ├─ Auto-Recall (before_agent_start)
                       │   Searches relevant memories and injects into context
                       │
                       ├─ Auto-Capture (agent_end)
                       │   Stores conversation messages for memory extraction
                       │
                       └─ 5 Agent Tools
                           memory_search, memory_store, memory_get,
                           memory_list, memory_forget
```

1. **Auto-Recall** — Before the agent responds, the plugin searches EverMemOS for memories relevant to the current message and injects them into the agent's context
2. **Auto-Capture** — After the agent responds, the last user/assistant exchange is sent to EverMemOS which extracts episodic memories, event logs, foresight predictions, and updates user profiles
3. **Agent Tools** — Five tools for explicit memory operations during conversations
4. **Slash Commands** — `/remember` and `/recall` for quick manual memory operations

## Prerequisites

- [OpenClaw](https://github.com/openclaw/openclaw) installed and configured
- [EverMemOS](https://github.com/EverMind-AI/EverMemOS) server running (default: `http://localhost:1995`)

### Setting up EverMemOS

```bash
# Clone EverMemOS
git clone https://github.com/EverMind-AI/EverMemOS.git
cd EverMemOS

# Start infrastructure services
docker compose up -d

# Install dependencies
uv sync

# Configure environment
cp env.template .env
# Edit .env with your LLM_API_KEY and VECTORIZE_API_KEY

# Start the server
uv run python src/run.py

# Verify it's running
curl http://localhost:1995/health
```

## Installation

```bash
openclaw plugins install @evermemos/openclaw-evermemos
```

## Configuration

Add to your `openclaw.json`:

### Minimal Configuration

```json5
// plugins.entries
"openclaw-evermemos": {
  "enabled": true,
  "config": {
    // Self-hosted: http://localhost:1995/api/v1
    // Cloud: https://api.evermind.ai/api/v0
    "baseUrl": "http://localhost:1995/api/v1",

    "userId": "your-user-id"
  }
}
```

### Full Configuration

```json5
"openclaw-evermemos": {
  "enabled": true,
  "config": {
    // EverMemOS API base URL (must include versioned API path, supports ${EVERMEMOS_BASE_URL} env var)
    // Self-hosted: "http://localhost:1995/api/v1"
    // Cloud: "https://api.evermind.ai/api/v0"
    "baseUrl": "http://localhost:1995/api/v1",

    // API key: required for cloud, optional for self-hosted
    // Supports ${EVERMEMOS_API_KEY} env var
    "apiKey": "${EVERMEMOS_API_KEY}",

    // User ID for scoping memories
    "userId": "your-user-id",

    // Optional group ID for multi-user scenarios
    "groupId": "project-team",

    // Auto-recall: inject memories before each agent turn (default: true)
    "autoRecall": true,

    // Auto-capture: store context after each agent turn (default: true)
    "autoCapture": true,

    // Retrieval method: "keyword", "vector", "hybrid", "rrf", "agentic"
    "retrieveMethod": "hybrid",

    // Memory types to retrieve: "episodic_memory", "foresight", "event_log", "profile"
    "memoryTypes": ["episodic_memory"],

    // Maximum number of memories to retrieve per search (default: 10)
    "topK": 10
  }
}
```

## Agent Tools

The agent gets five tools it can call during conversations:

| Tool | Description |
|------|-------------|
| `memory_search` | Search memories by natural language query with configurable retrieval method |
| `memory_store` | Store a message for memory extraction (episodic, event log, foresight, profile) |
| `memory_get` | Retrieve memories for a user by memory type |
| `memory_list` | List all stored memories across all memory types |
| `memory_forget` | Delete memories by event ID, user ID, or search query |

### Memory Types

EverMemOS organizes memories into four types:

| Type | Description |
|------|-------------|
| `episodic_memory` | Narrative memories of events and conversations |
| `event_log` | Atomic facts extracted from episodes |
| `foresight` | Predictions and upcoming events extracted from conversations |
| `profile` | Progressive user profiles built from conversation patterns |

### Retrieval Methods

| Method | Description |
|--------|-------------|
| `keyword` | BM25 keyword search |
| `vector` | Semantic vector search |
| `hybrid` | Combined keyword + vector search |
| `rrf` | Reciprocal Rank Fusion (keyword + vector + ranking fusion) |
| `agentic` | LLM-guided multi-round intelligent retrieval |

## Slash Commands

| Command | Description |
|---------|-------------|
| `/remember <text>` | Save something to EverMemOS memory |
| `/recall <query>` | Search your memories and see results with relevance scores |

## CLI Commands

```bash
# Search memories
openclaw evermemos search "what does the user like to do on weekends"

# Search with specific retrieval method
openclaw evermemos search "project deadlines" --method agentic

# View statistics
openclaw evermemos stats
```

## Configuration Options

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `baseUrl` | `string` | `http://localhost:1995/api/v1` | EverMemOS API URL. Must include `/api/vx` (e.g. `/api/v1` or `/api/v0`) (supports `${EVERMEMOS_BASE_URL}`) |
| `apiKey` | `string` | — | API key for Bearer auth. Required for cloud, optional for self-hosted (supports `${EVERMEMOS_API_KEY}`) |
| `userId` | `string` | `"default"` | User ID for scoping memories |
| `groupId` | `string` | — | Optional group ID for multi-user scenarios |
| `autoRecall` | `boolean` | `true` | Inject memories before each agent turn |
| `autoCapture` | `boolean` | `true` | Store context after each agent turn |
| `retrieveMethod` | `string` | `"hybrid"` | Retrieval method: keyword, vector, hybrid, rrf, agentic |
| `memoryTypes` | `string[]` | `["episodic_memory"]` | Memory types to retrieve |
| `topK` | `number` | `10` | Max memories per recall/search |

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Type check
npm run lint

# Build
npm run build
```

## Comparison with Mem0 Plugin

| Feature | openclaw-mem0 (Mem0) | openclaw-evermemos (EverMemOS) |
|---------|---------------------|-------------------------------|
| Memory types | Flat text memories | Episodic, event log, foresight, profile |
| Retrieval | Similarity search | Keyword, vector, hybrid, RRF, agentic |
| Profile building | Manual | Automatic progressive profiles |
| Boundary detection | No | Automatic conversation boundary detection |
| LoCoMo accuracy | — | 93% |
| Backend | Mem0 Cloud or OSS | Self-hosted EverMemOS |
| Foresight | No | Predictive/prospective memory |

## License

[MIT](LICENSE)

## Acknowledgments

- [EverMemOS](https://github.com/EverMind-AI/EverMemOS) — The Memory OS for AI agents
- [OpenClaw](https://github.com/openclaw/openclaw) — Personal AI assistant
- [Mem0 OpenClaw Plugin](https://github.com/mem0ai/mem0/tree/main/openclaw) — Reference implementation for OpenClaw memory plugins
