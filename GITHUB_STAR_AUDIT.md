# GitHub Star Audit

This project looks technically stronger than its current GitHub attention level.

The issue is probably not core usefulness. The issue is packaging, discoverability, and social proof.

## Why Stars Are Likely Low

### 1. The value proposition is hidden behind explanation

The repo is useful, but the old README made visitors read too much before they could answer:

- what is this
- who is it for
- why is it better than the other Obsidian MCP servers
- how do I try it in under 60 seconds

Useful repos get starred when the first screen creates immediate clarity.

### 2. The niche is real and the audience is narrow

This is not a general JavaScript utility. It sits at the intersection of:

- MCP users
- Obsidian users
- people using agents seriously
- people who care about safe repo handoff

That audience exists, but it is much smaller than the audience for generic AI tools.

### 3. Discoverability terms are weaker than they should be

The strongest search terms in this space are usually things like:

- mcp server
- model context protocol
- obsidian mcp
- rag for obsidian
- graph rag
- coding agent context

The project name is distinctive, but not especially search-friendly.

### 4. There is limited social proof

A visitor deciding whether to star a repo looks for:

- obvious install command
- visual demo
- clear examples
- badges
- issue activity
- release cadence
- third-party mentions

Right now the repo has real substance, but not enough trust signals.

### 5. The repo sells architecture more than outcomes

People star for outcomes. They care about statements like:

- "my agent can turn notes into an execution plan"
- "I can connect roadmap notes to repo files safely"
- "I get graph-aware context from Obsidian without building my own stack"

If the repo leads with internal architecture instead, fewer people convert.

## What Will Most Likely Increase Stars

### 1. Improve the first screen of the README

Make the first screen answer:

- what this is
- why it is better
- what command to run
- what the output looks like

### 2. Add one concrete demo artifact

Best options:

- short GIF of install + tool call + output
- screenshot of MCP client config plus result
- mini example vault and sample repo

### 3. Distribute beyond GitHub

The repo should appear in places where MCP users already search:

- MCP server directories
- Obsidian community spaces
- relevant Hacker News / Reddit / X posts with a specific workflow demo
- "awesome MCP" style lists

### 4. Tighten keywords and metadata

Use stronger discoverability language in package metadata and README:

- `mcp-server`
- `model-context-protocol`
- `graph-rag`
- `agentic-rag`
- `obsidian-plugin`
- `developer-tools`

### 5. Show one before/after workflow

Example:

Before:

```text
Agent reads one note and misses the rest of the context.
```

After:

```text
Agent retrieves linked notes, summarizes risks, produces a plan,
and points to the right repo files without unrestricted shell access.
```

That is the kind of sentence that earns stars.

## Practical Next Moves

1. Rewrite the README top section for immediate clarity.
2. Add a GIF or terminal screenshot.
3. Add a small `examples/` directory with a sample vault and sample outputs.
4. Publish one short launch post focused on a concrete workflow, not the architecture.
5. Submit the repo to MCP directories and curated lists.

## Working Conclusion

The likely problem is not "this is not useful."

The likely problem is:

- too little top-of-page clarity
- too little proof
- too few distribution channels
- a niche audience that needs a stronger, faster explanation
