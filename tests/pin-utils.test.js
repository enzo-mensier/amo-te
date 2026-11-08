import test from 'node:test';
import assert from 'node:assert/strict';
import { constantTimeEqual, hashPin } from '../supabase/functions/_shared/pin-utils.js';

test('hashes PINs with a server-side HMAC secret', async () => {
  const firstHash = await hashPin('0123', 'server-secret');
  assert.match(firstHash, /^[0-9a-f]{64}$/);
  assert.equal(await hashPin('0123', 'server-secret'), firstHash);
  assert.notEqual(await hashPin('0123', 'different-secret'), firstHash);
  assert.notEqual(await hashPin('0124', 'server-secret'), firstHash);
});

test('compares hashes without early exit on differing characters', () => {
  assert.equal(constantTimeEqual('012345', '012345'), true);
  assert.equal(constantTimeEqual('012345', '012346'), false);
  assert.equal(constantTimeEqual('012345', '0123'), false);
});
