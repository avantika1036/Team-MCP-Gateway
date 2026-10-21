import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authReferenceFromInput,
  buildCredentialHeaders,
  credentialKeyForUpstream,
  upstreamAuthInputSchema,
} from '../dist/upstream-auth.js';

test('bearer credentials are converted to request headers without changing the credential', () => {
  const input = upstreamAuthInputSchema.parse({
    type: 'bearer',
    credential: 'token-value-123',
  });

  assert.deepEqual(authReferenceFromInput(input), { type: 'bearer' });
  assert.deepEqual(buildCredentialHeaders({ type: 'bearer' }, input.credential), {
    Authorization: 'Bearer token-value-123',
  });
});

test('custom header credentials validate names and build the requested header', () => {
  const input = upstreamAuthInputSchema.parse({
    type: 'header',
    headerName: 'X-API-Key',
    credential: 'secret-value-456',
  });

  assert.deepEqual(authReferenceFromInput(input), { type: 'header', headerName: 'X-API-Key' });
  assert.deepEqual(buildCredentialHeaders(authReferenceFromInput(input), input.credential), {
    'X-API-Key': 'secret-value-456',
  });
});

test('credential input rejects reserved or malformed header names and blank credentials', () => {
  for (const headerName of ['Authorization', 'Host', 'Content-Length', 'X-Test\\r\\nInjected']) {
    assert.equal(
      upstreamAuthInputSchema.safeParse({
        type: 'header',
        headerName,
        credential: 'valid-secret',
      }).success,
      false,
      `expected ${headerName} to be rejected`,
    );
  }

  assert.equal(
    upstreamAuthInputSchema.safeParse({ type: 'bearer', credential: '   ' }).success,
    false,
  );
  assert.equal(
    upstreamAuthInputSchema.safeParse({
      type: 'bearer',
      credential: 'token\r\nX-Injected: yes',
    }).success,
    false,
  );
});

test('credential secret keys can only be derived from valid upstream IDs', () => {
  assert.equal(credentialKeyForUpstream('inventory'), 'credential-inventory');
  assert.throws(() => credentialKeyForUpstream('../other'), /Invalid upstream ID/);
});
