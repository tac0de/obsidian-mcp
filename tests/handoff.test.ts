import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';

let tempDir = '';
let vaultDir = '';
let workspaceDir = '';

async function write(root: string, relPath: string, content: string) {
  const target = path.join(root, relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
}

function getRegisteredTools(server: any): Record<string, any> {
  return server._registeredTools;
}

describe('repo handoff tools', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'handoff-test-'));
    vaultDir = path.join(tempDir, 'vault');
    workspaceDir = path.join(tempDir, 'workspace');
    await fs.mkdir(vaultDir, { recursive: true });
    await fs.mkdir(workspaceDir, { recursive: true });
    await write(vaultDir, 'plan.md', '# SearchFeature\nImplement SearchFeature for the dashboard.\nQuestion: where is the entrypoint?\n');
    await write(workspaceDir, 'src/search.ts', 'export const SearchFeature = true;\n');
    spawnSync('git', ['init'], { cwd: workspaceDir, stdio: 'ignore' });
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('returns repo-aware handoff output', async () => {
    const server = await createServer({
      cwd: workspaceDir,
      env: {
        ...process.env,
        OBSIDIAN_VAULT_ROOT: vaultDir
      }
    });

    const tools = getRegisteredTools(server);
    const result = await server.executeToolHandler(tools['action.handoff_to_repo'], { path: 'plan.md' }, {});

    expect(result.structuredContent.matchedFiles).toContain('src/search.ts');
    expect(result.structuredContent.nextSteps.length).toBeGreaterThan(0);
  });

  it('builds agent bundles with structured packets', async () => {
    const server = await createServer({
      cwd: workspaceDir,
      env: {
        ...process.env,
        OBSIDIAN_VAULT_ROOT: vaultDir
      }
    });

    const tools = getRegisteredTools(server);
    const result = await server.executeToolHandler(
      tools['context.bundle_for_agent'],
      { path: 'plan.md', objective: 'implement search', includeRepoHints: true },
      {}
    );

    expect(result.structuredContent.packet).toBeDefined();
    expect(result.structuredContent.repoHints.matchedFiles).toContain('src/search.ts');
  });

  it('rejects workspace path traversal', async () => {
    const server = await createServer({
      cwd: workspaceDir,
      env: {
        ...process.env,
        OBSIDIAN_VAULT_ROOT: vaultDir
      }
    });

    const tools = getRegisteredTools(server);
    await expect(
      server.executeToolHandler(tools['action.handoff_to_repo'], { path: 'plan.md', workspacePath: '../outside' }, {})
    ).rejects.toMatchObject({
      message: expect.stringContaining('E_PATH_TRAVERSAL')
    });
  });
});

