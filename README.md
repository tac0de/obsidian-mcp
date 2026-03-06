# Obsidian MCP 1.1

`obsidian-mcp` is an MCP server for Obsidian vaults. It keeps the original read-only vault, graph, and context tools, and adds an opt-in execution layer for safe workspace inspection.

## In 5 Seconds

If your notes live in Obsidian and your AI only reads one file at a time, it will miss a lot of useful context.

`obsidian-mcp` lets an MCP client treat your vault more like a connected knowledge base instead of a pile of separate markdown files.

## Why People Use It

If an AI can only open one note at a time, it misses the bigger picture.

`obsidian-mcp` helps an MCP client understand your Obsidian vault more like a connected notebook:

- it can read notes safely
- it can follow `[[wikilinks]]`
- it can find backlinks
- it can use tags and graph neighbors to gather related context

That means the AI is less likely to answer from a single file in isolation. It can pull in nearby notes, related ideas, and references that already exist in your vault.

In plain terms:

- without this server: the AI reads one file if you point to it
- with this server: the AI can discover which other notes are probably relevant too

This is especially useful when your vault contains:

- project notes split across many files
- research notes with cross-links
- meeting notes, decisions, and follow-up docs
- personal knowledge bases where context is spread across tags and backlinks

## What You Actually Get

- better answers from your own notes, not just one selected file
- easier discovery of related notes you forgot existed
- backlink and neighbor exploration without custom scripting
- a local MCP server that does not need a separate hosted backend

## When This Is A Good Fit

This server is a good fit if you want an AI assistant to:

- read your Obsidian vault safely
- search across many notes
- follow note relationships automatically
- recover nearby context before answering

## When You May Not Need It

You may not need this server if:

- you only want raw file access
- your notes are mostly isolated documents with few links or tags
- you do not need graph-aware context recovery
- you do not use MCP clients

## Why Read-Only By Default

The default mode is still read-only because that is the safest and most generally useful setup.

For most users, the main value is:

- finding notes
- reading notes
- searching notes
- recovering surrounding context from links and tags

That gives most of the benefit without letting the server run local commands. The optional execution tools exist for controlled workspace inspection, not as the main selling point.

## Requirements

- Node.js 20 or newer
- An Obsidian vault path for `OBSIDIAN_VAULT_ROOT`

## Install

```bash
npm install
```

## Run

Read-only mode remains the default:

```bash
OBSIDIAN_VAULT_ROOT="/path/to/vault" npm run dev
```

## Core Tools

- `vault.list_notes`
- `vault.read_note`
- `vault.search_notes`
- `vault.get_metadata`
- `graph.build`
- `graph.get_neighbors`
- `graph.get_backlinks`
- `context.gather`

## Secure Execution Tools

Execution is opt-in and disabled by default. No generic shell tool is exposed.

Environment variables:

- `EXECUTION_ENABLED=false`
- `EXECUTION_CAPABILITIES=workspace.search,workspace.inspect,workspace.git_status`
- `EXECUTION_TIMEOUT_MS=5000`
- `EXECUTION_MAX_OUTPUT_BYTES=32768`

When execution is enabled, the server can expose:

- `exec.list_capabilities`
- `exec.rg_search`
- `exec.list_dir`
- `exec.git_status`

Capabilities map 1:1 to tools:

- `workspace.search` -> `exec.rg_search`
- `workspace.inspect` -> `exec.list_dir`
- `workspace.git_status` -> `exec.git_status`

Example:

```bash
OBSIDIAN_VAULT_ROOT="/path/to/vault" \
EXECUTION_ENABLED=true \
EXECUTION_CAPABILITIES="workspace.search,workspace.inspect" \
npm run dev
```

## Security Model

- Vault tools remain read-only.
- Execution tools are registered only when explicitly enabled.
- Commands are fixed adapters built on `spawn(..., { shell: false })`.
- The workspace root is locked to the server process working directory.
- Only a minimal allowlisted environment is passed to child processes.
- Execution emits minimal JSONL audit logs to `stderr`.
- Full command output is returned to MCP callers only through structured tool results, not audit logs.

## Limits

- No generic `bash.exec` tool
- No write or mutation commands
- No absolute paths or path traversal outside the configured workspace root

## License

MIT
