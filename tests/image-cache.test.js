const { test } = require("node:test");
const assert = require("node:assert/strict");
const createCache = require("../private-image-cache");
const load =
  (length, char = 1) =>
  async (resize) => {
    resize(length);
    return Buffer.alloc(length, char);
  };
const config = {
  maxBytes: 24,
  maxItemBytes: 10,
  maxInFlight: 2,
  maxEntries: 4,
  ttl: 60000,
};

test("100 image leases share a single cold fetch and the same buffer", async () => {
  const cache = createCache(config);
  let finish,
    calls = 0;
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  const loader = async (resize) => {
    calls++;
    resize(8);
    await gate;
    return Buffer.alloc(8, 7);
  };
  const requests = Array.from({ length: 100 }, () =>
    cache.acquire("photo", loader),
  );
  assert.equal(calls, 1);
  assert.equal(cache.stats().inFlight, 1);
  finish();
  const leases = await Promise.all(requests);
  for (const lease of leases) {
    assert.equal(lease.buffer, leases[0].buffer);
    assert.deepEqual(lease.buffer, Buffer.alloc(8, 7));
    lease.release();
    lease.release(); // Idempotent close/finish cleanup.
  }
  const warm = await cache.acquire("photo", loader);
  assert.equal(calls, 1);
  warm.release();
  cache.clear();
  assert.equal(cache.stats().bytes, 0);
});

test("payload budget includes pinned/expired buffers and in-flight reservations", async () => {
  let now = 0;
  const cache = createCache({ ...config, now: () => now, ttl: 1000 });
  const first = await cache.acquire("a", load(10));
  const second = await cache.acquire("b", load(10));
  assert.equal(cache.stats().bytes, 20);
  assert.equal(await cache.acquire("c", load(10)), null);
  now = 1001; // Expiry cannot free bytes still being sent to a slow client.
  assert.equal(await cache.acquire("a", load(10)), null);
  assert.equal(cache.stats().bytes, 20);
  first.release();
  const third = await cache.acquire("c", load(10));
  assert.ok(third);
  assert.ok(cache.stats().bytes <= 24);
  second.release();
  third.release();
  cache.clear();
  assert.equal(cache.stats().bytes, 0);
});

test("LRU eviction, idle expiry and entry limits release payloads", async () => {
  const cache = createCache({ ...config, maxEntries: 2, ttl: 25 });
  for (const key of ["a", "b", "c"])
    (await cache.acquire(key, load(3))).release();
  assert.equal(cache.stats().entries, 2);
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.deepEqual(cache.stats(), {
    bytes: 0,
    inFlight: 0,
    entries: 0,
    retained: 0,
  });
});

test("two cold downloads maximum; distinct excess loads stream instead of waiting", async () => {
  const cache = createCache(config);
  let finish;
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  const loader = async (resize) => {
    resize(4);
    await gate;
    return Buffer.alloc(4);
  };
  const a = cache.acquire("a", loader),
    b = cache.acquire("b", loader);
  assert.equal(await cache.acquire("c", loader), null);
  assert.equal(cache.stats().inFlight, 2);
  finish();
  for (const lease of await Promise.all([a, b])) lease.release();
  cache.clear();
  assert.equal(cache.stats().bytes, 0);
});

test("failed shared fetches release reservations and allow a later retry", async () => {
  const cache = createCache(config);
  let calls = 0;
  const failed = async () => {
    calls++;
    await Promise.resolve();
    throw Error("test failure");
  };
  const outcomes = await Promise.allSettled(
    Array.from({ length: 20 }, () => cache.acquire("a", failed)),
  );
  assert.equal(calls, 1);
  assert.ok(outcomes.every((x) => x.status === "rejected"));
  assert.equal(cache.stats().bytes, 0);
  const retry = await cache.acquire("a", load(5));
  assert.equal(retry.buffer.length, 5);
  retry.release();
  cache.clear();
});

test("invalidate during a fetch or send does not leak buffers or reuse old bytes", async () => {
  const cache = createCache(config);
  let finish;
  const old = cache.acquire("a", async (resize) => {
    resize(6);
    await new Promise((resolve) => {
      finish = resolve;
    });
    return Buffer.alloc(6, 1);
  });
  cache.invalidate("a");
  const fresh = await cache.acquire("a", load(6, 2));
  finish();
  const stale = await old;
  assert.equal(stale.buffer[0], 1);
  assert.equal(fresh.buffer[0], 2);
  assert.equal(cache.stats().bytes, 12);
  stale.release();
  fresh.release();
  assert.equal(cache.stats().bytes, 6);
  cache.clear();
  assert.equal(cache.stats().bytes, 0);
});

test("invalid sizes and retained-entry saturation fail safely", async () => {
  const cache = createCache({ ...config, maxEntries: 1 });
  await assert.rejects(
    cache.acquire("bad", async (resize) => {
      resize(11);
      return Buffer.alloc(11);
    }),
  );
  assert.equal(cache.stats().bytes, 0);
  const a = await cache.acquire("a", load(1));
  cache.invalidate("a");
  assert.equal(await cache.acquire("b", load(1)), null);
  a.release();
  cache.clear();
  assert.equal(cache.stats().retained, 0);
});
