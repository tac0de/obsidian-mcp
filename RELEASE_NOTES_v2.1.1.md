# v2.1.1

This release improves discoverability, onboarding, and release readiness for `knowledge-to-action-mcp`.

## Highlights

- rewrote the README top section to explain the value proposition faster
- added badges and clearer MCP client setup examples
- added sample vault notes and sample outputs for faster evaluation
- added issue templates, PR template, Dependabot, and a GitHub release workflow
- tightened package metadata for better npm and GitHub discoverability
- removed the machine-specific absolute path from `manifest.json`
- bumped the package version to `2.1.1`

## Included assets

- sample vault: `examples/sample-vault/`
- sample outputs: `examples/sample-output/`
- client configs:
  - `examples/claude-desktop-config.json`
  - `examples/vscode-mcp.json`
  - `examples/cursor-mcp.json`

## Validation

- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm pack --dry-run`
