import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cloudSpeech} from '../providers.mjs';

test('identical narration shares one request and reuses the saved audio', async () => {
  const originalDirectory = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), 'storytime-test-'));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  process.chdir(directory);
  globalThis.fetch = async () => {
    calls++;
    return new Response('audio', {headers:{'Content-Type':'audio/mpeg'}});
  };
  try {
    const [first, simultaneous] = await Promise.all([cloudSpeech('Moonlight'), cloudSpeech('Moonlight')]);
    assert.deepEqual(first, simultaneous);
    assert.deepEqual(first, await cloudSpeech('Moonlight'));
    assert.equal(calls, 1);
    await cloudSpeech('A different script');
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalDirectory);
    await rm(directory, {recursive:true});
  }
});
