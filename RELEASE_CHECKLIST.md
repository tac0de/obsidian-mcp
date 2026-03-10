# Release Checklist

1. Review `README.md`, examples, and changelog-worthy changes.
2. Run `npm run typecheck`.
3. Run `npm run test`.
4. Run `npm run build`.
5. Confirm `npm view @tac0de/knowledge-to-action-mcp version` is lower than `package.json`.
6. Commit changes.
7. Create and push a git tag like `v2.1.1`.
8. Publish with `npm publish`.
9. Verify the npm package page and GitHub release page.
