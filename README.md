# Knowledge-to-Action MCP

> Turn Obsidian notes into agent-ready context, preview-only plans, and safe repo handoffs.

[![CI](https://github.com/tac0de/knowledge-to-action-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/tac0de/knowledge-to-action-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40tac0de%2Fknowledge-to-action-mcp)](https://www.npmjs.com/package/@tac0de/knowledge-to-action-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

![Knowledge-to-Action MCP](./github-thumbnail.png)

`knowledge-to-action-mcp` is an MCP server for people whose real project context lives in notes, decisions, roadmaps, and meeting docs, not just code.

Most Obsidian MCP servers stop at "read a note" or "search a vault."

This one goes further:

```text
notes -> retrieval -> context packet -> action plan -> repo handoff
```

That means an MCP client can move from:

```text
"open this markdown file"
```

to:

```text
"understand the note, pull nearby context, summarize risks,
propose next steps, and show which repo files probably matter"
```

## Why It Matters

If you work out of Obsidian, your important context is usually spread across:

- roadmap notes
- meeting notes
- decisions
- linked references
- repo assumptions

Normal note integrations make an agent read those files.

`knowledge-to-action-mcp` helps an agent recover the surrounding context and turn it into something actionable without exposing a general shell runner.

## What Makes It Different

| Capability | Typical vault MCP | `knowledge-to-action-mcp` |
| --- | --- | --- |
| Read notes | Yes | Yes |
| Search notes | Yes | Yes |
| Follow links / backlinks | Sometimes | Yes |
| Graph-aware context recovery | Rarely | Yes |
| Optional embeddings | Rarely | Yes |
| Agent-ready context packet | No | Yes |
| Preview-only plan from note | No | Yes |
| Note-to-repo handoff | No | Yes |
| General shell access | Sometimes | No |

## 1-Minute Quickstart

Install:

```bash
npm install @tac0de/knowledge-to-action-mcp
```

Run in graph-only mode:

```bash
OBSIDIAN_VAULT_ROOT="/path/to/vault" \
npx @tac0de/knowledge-to-action-mcp
```

Turn on optional embeddings and planning:

```bash
OBSIDIAN_VAULT_ROOT="/path/to/vault" \
EMBEDDINGS_ENABLED=true \
PLANNING_ENABLED=true \
OPENAI_API_KEY="..." \
npx @tac0de/knowledge-to-action-mcp
```

Then call:

- `context.retrieve`
- `context.bundle_for_agent`
- `action.plan_from_note`
- `action.handoff_to_repo`

See also:

- sample vault: [`examples/sample-vault/`](./examples/sample-vault/)
- sample outputs: [`examples/sample-output/`](./examples/sample-output/)
- Claude Desktop config example: [`examples/claude-desktop-config.json`](./examples/claude-desktop-config.json)
- VS Code config example: [`examples/vscode-mcp.json`](./examples/vscode-mcp.json)
- Cursor config example: [`examples/cursor-mcp.json`](./examples/cursor-mcp.json)

## What You Actually Get

### 1. Obsidian-aware retrieval

- deterministic note listing, reading, and search
- wikilink resolution
- backlinks
- shared-tag neighbors
- graph-aware context recovery

### 2. Optional GraphRAG

When embeddings are enabled, retrieval becomes:

```text
lexical + graph + semantic rerank
```

No external graph database is required.

### 3. Agent-ready context packets

`context.bundle_for_agent` returns a structured packet instead of dumping raw markdown into a prompt.

That packet includes:

- brief
- key facts
- open questions
- risks
- related notes
- repo hints

### 4. Preview-only action planning

`action.plan_from_note` turns a note into:

- summary
- goals
- constraints
- decisions
- open questions
- suggested actions
- handoff prompt

It does not mutate files.

### 5. Safe repo handoff

`action.handoff_to_repo` connects note context to a workspace using:

- bounded ripgrep queries
- bounded git status
- matched file suggestions

This is intentionally not a general-purpose shell runner.

## Example Workflow

Imagine you have these notes:

- `roadmap/search.md`
- `meetings/2026-03-07-search-review.md`
- `decisions/search-scope.md`

And a repo with:

- `src/search.ts`
- `src/features/search/index.ts`

This MCP can help an agent:

1. Retrieve nearby notes with search, backlinks, tags, graph neighbors, and optional embeddings.
2. Compress that note cluster into a structured context packet.
3. Turn the source note into a preview-only action plan.
4. Suggest likely repo files before any edit happens.

That jump from "read notes" to "prepare action safely" is the whole point.

## Demo Assets

If you want something concrete before wiring your own vault:

- sample vault notes live in [`examples/sample-vault/`](./examples/sample-vault/)
- example `context.bundle_for_agent` output lives in [`examples/sample-output/context.bundle_for_agent.json`](./examples/sample-output/context.bundle_for_agent.json)
- example `action.plan_from_note` output lives in [`examples/sample-output/action.plan_from_note.json`](./examples/sample-output/action.plan_from_note.json)
- example Claude Desktop config lives in [`examples/claude-desktop-config.json`](./examples/claude-desktop-config.json)

## Public Tools

### Vault + Graph

- `vault.list_notes`
- `vault.read_note`
- `vault.search_notes`
- `vault.get_metadata`
- `graph.build`
- `graph.get_neighbors`
- `graph.get_backlinks`
- `context.gather`

### Retrieval + Planning

- `embeddings.index_vault`
- `context.retrieve`
- `context.bundle_for_agent`
- `action.plan_from_note`
- `action.handoff_to_repo`

### Workspace Inspection

- `exec.list_capabilities`
- `exec.rg_search`
- `exec.list_dir`
- `exec.git_status`

## Example Output

`context.bundle_for_agent`:

```json
{
  "brief": "Implement search using the existing dashboard flow.",
  "source": "roadmap/search.md",
  "keyFacts": [
    "Title: Search",
    "Tags: roadmap,search"
  ],
  "openQuestions": [
    "Where is the current search entrypoint?"
  ],
  "risks": [
    "Assumption: repo layout may differ from note context"
  ],
  "repoHints": {
    "matchedFiles": [
      "src/search.ts",
      "src/features/search/index.ts"
    ],
    "suggestedQueries": [
      "Search",
      "search"
    ]
  }
}
```

`action.plan_from_note`:

```json
{
  "source": "roadmap/search.md",
  "summary": "Implement search using the existing dashboard flow.",
  "goals": [
    "Ship dashboard search"
  ],
  "constraints": [
    "No mutation without explicit approval"
  ],
  "openQuestions": [
    "Where is the current search entrypoint?"
  ],
  "suggestedActions": [
    "Review matched repo files",
    "Resolve open questions before implementation"
  ],
  "generationMode": "deterministic"
}
```

## Configuration

### Required

- `OBSIDIAN_VAULT_ROOT`

### Optional embeddings

- `EMBEDDINGS_ENABLED=false`
- `EMBEDDING_PROVIDER=openai`
- `EMBEDDING_MODEL=text-embedding-3-small`
- `EMBEDDING_SQLITE_PATH=.knowledge-to-action-mcp/index.sqlite`
- `OPENAI_API_KEY=...`

### Optional planning

- `PLANNING_ENABLED=false`
- `PLANNING_PROVIDER=openai`
- `PLANNING_MODEL=gpt-4.1-mini`

### Optional workspace inspection

- `EXECUTION_ENABLED=false`
- `EXECUTION_CAPABILITIES=workspace.search,workspace.inspect,workspace.git_status`
- `EXECUTION_TIMEOUT_MS=5000`
- `EXECUTION_MAX_OUTPUT_BYTES=32768`

## Install In MCP Clients

Example stdio config:

```json
{
  "command": "npx",
  "args": ["-y", "@tac0de/knowledge-to-action-mcp"],
  "env": {
    "OBSIDIAN_VAULT_ROOT": "/path/to/vault"
  }
}
```

### VS Code

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "knowledge-to-action": {
      "command": "npx",
      "args": ["-y", "@tac0de/knowledge-to-action-mcp"],
      "env": {
        "OBSIDIAN_VAULT_ROOT": "/path/to/vault"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "knowledge-to-action": {
      "command": "npx",
      "args": ["-y", "@tac0de/knowledge-to-action-mcp"],
      "env": {
        "OBSIDIAN_VAULT_ROOT": "/path/to/vault"
      }
    }
  }
}
```

## Security Boundary

This package is designed to be useful without turning into a local shell bomb.

- vault access is read-only
- plan generation is preview-only
- embeddings are optional and local
- repo inspection is bounded to the configured working directory
- no generic `bash.exec` or arbitrary command tool is exposed

## Good Fit

Use this project if you want:

- Obsidian-native GraphRAG
- note-to-action workflows for agents
- structured context instead of giant markdown dumps
- repo-aware handoff without broad execution access

## Not Trying To Be

- a general purpose agent runtime
- a write-enabled automation framework
- a hosted knowledge platform
- a vector database product

## Compatibility

- package name: `@tac0de/knowledge-to-action-mcp`
- legacy CLI alias: `obsidian-mcp`
- Node.js 20+

## Status

`v2.1.1` is usable now:

- typecheck passes
- unit and integration tests pass
- npm pack dry-run passes

The project is still early, but the main workflow is already working.

## License

MIT
