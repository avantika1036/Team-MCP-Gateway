import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ServerRegistry } from '../dist/registry.js';

async function withRegistry(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'urumi-registry-test-'));
  try {
    const filePath = path.join(directory, 'servers.json');
    const registry = await ServerRegistry.open(filePath);
    await run({ registry, filePath });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const server = (id) => ({
  id,
  name: `Test ${id}`,
  url: `http://${id}.svc.cluster.local:3000/mcp`,
  enabled: true,
});

test('registry starts empty and persists additions across reopen', async () => {
  await withRegistry(async ({ registry, filePath }) => {
    assert.deepEqual(await registry.list(), []);

    const created = await registry.add(server('calculator'));
    assert.equal(created.id, 'calculator');
    assert.ok(created.createdAt);
    assert.ok(created.updatedAt);

    const persisted = JSON.parse(await readFile(filePath, 'utf8'));
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].url, 'http://calculator.svc.cluster.local:3000/mcp');

    const reopened = await ServerRegistry.open(filePath);
    assert.deepEqual(await reopened.list(), [created]);
  });
});

test('registry rejects duplicate IDs and supports update/remove', async () => {
  await withRegistry(async ({ registry }) => {
    await registry.add(server('utility'));
    await assert.rejects(registry.add(server('utility')), /already exists/);

    const updated = await registry.update('utility', { enabled: false, name: 'Disabled Utility' });
    assert.equal(updated?.enabled, false);
    assert.equal(updated?.name, 'Disabled Utility');
    assert.equal(await registry.update('missing', { enabled: false }), undefined);

    assert.equal(await registry.remove('utility'), true);
    assert.equal(await registry.remove('utility'), false);
    assert.deepEqual(await registry.list(), []);
  });
});

test('registry serializes concurrent writes without dropping entries', async () => {
  await withRegistry(async ({ registry }) => {
    const ids = Array.from({ length: 16 }, (_, index) => `service-${index}`);
    await Promise.all(ids.map((id) => registry.add(server(id))));

    const current = await registry.list();
    assert.equal(current.length, ids.length);
    assert.deepEqual(current.map((entry) => entry.id).sort(), ids.sort());
  });
});
