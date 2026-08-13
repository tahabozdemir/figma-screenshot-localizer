/**
 * The request/reply helper both threads share, plus the cancellation token.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Rpc, TimeoutError, CancellationToken } from '../dist-test/lib.mjs';

test('a reply resolves the matching request', async () => {
  const rpc = new Rpc('req', 1000);
  let issued = '';
  const promise = rpc.request((id) => {
    issued = id;
  });
  assert.equal(rpc.pending, 1);
  assert.equal(rpc.resolve(issued, 'answer'), true);
  assert.equal(await promise, 'answer');
  assert.equal(rpc.pending, 0);
});

test('ids are unique and carry the prefix', async () => {
  const rpc = new Rpc('http', 1000);
  const ids = [];
  const inFlight = [rpc.request((id) => ids.push(id)), rpc.request((id) => ids.push(id))];
  assert.notEqual(ids[0], ids[1]);
  for (const id of ids) assert.match(id, /^http\d+$/);

  rpc.rejectAll(new Error('teardown'));
  await Promise.all(inFlight.map((p) => p.catch(() => 'rejected'))).then((settled) =>
    assert.deepEqual(settled, ['rejected', 'rejected'])
  );
});

test('a late or unknown reply is ignored, not thrown', async () => {
  const rpc = new Rpc('req', 1000);
  let issued = '';
  const promise = rpc.request((id) => {
    issued = id;
  });
  rpc.resolve(issued, 'first');
  assert.equal(rpc.resolve(issued, 'second'), false, 'the same id must not settle twice');
  assert.equal(rpc.resolve('req999', 'stray'), false);
  assert.equal(await promise, 'first');
});

test('a request that times out rejects with a TimeoutError', async () => {
  const rpc = new Rpc('req', 5);
  const promise = rpc.request(() => {});
  await assert.rejects(() => promise, TimeoutError);
  assert.equal(rpc.pending, 0, 'a timed-out entry must not stay parked');
});

test('resolveAll settles everything in flight', async () => {
  const rpc = new Rpc('req', 1000);
  const a = rpc.request(() => {});
  const b = rpc.request(() => {});
  rpc.resolveAll('cancelled');
  assert.deepEqual(await Promise.all([a, b]), ['cancelled', 'cancelled']);
  assert.equal(rpc.pending, 0);
});

test('a send that throws rejects its own request instead of leaking it', async () => {
  const rpc = new Rpc('req', 1000);
  await assert.rejects(
    () =>
      rpc.request(() => {
        throw new Error('postMessage failed');
      }),
    /postMessage failed/
  );
  assert.equal(rpc.pending, 0);
});

/* ------------------------------------------------------------------ */

test('a cancellation token fires its listeners exactly once', () => {
  const token = new CancellationToken();
  let fired = 0;
  token.onCancel(() => fired++);
  assert.equal(token.cancelled, false);

  token.cancel();
  token.cancel();

  assert.equal(token.cancelled, true);
  assert.equal(fired, 1);
});

test('subscribing after cancellation fires immediately', () => {
  const token = new CancellationToken();
  token.cancel();
  let fired = 0;
  token.onCancel(() => fired++);
  assert.equal(fired, 1);
});

test('one throwing listener does not stop the others', () => {
  const token = new CancellationToken();
  let fired = 0;
  token.onCancel(() => {
    throw new Error('boom');
  });
  token.onCancel(() => fired++);
  token.cancel();
  assert.equal(fired, 1);
});

test('two runs get independent tokens', () => {
  const first = new CancellationToken();
  const second = new CancellationToken();
  first.cancel();
  assert.equal(second.cancelled, false, 'a late cancel must not reach the next run');
});
