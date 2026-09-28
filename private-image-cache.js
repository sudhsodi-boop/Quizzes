"use strict";

// Internal optimization only. Call AFTER media authorization on every request.
// Leases pin a shared Buffer until the HTTP response completes: slow clients
// cannot make an evicted-but-still-sending buffer escape the payload budget.
module.exports = function privateImageCache({
  maxBytes = 24 * 1024 * 1024,
  maxItemBytes = 10 * 1024 * 1024,
  maxEntries = 32,
  maxInFlight = 2,
  ttl = 10 * 60 * 1000,
  now = Date.now,
} = {}) {
  const entries = new Map();
  let bytes = 0,
    inFlight = 0,
    retained = 0;
  function free(entry) {
    if (!entry.resident && !entry.loading && !entry.users && entry.accounted) {
      bytes -= entry.size;
      entry.accounted = false;
      retained--;
      entry.buffer = null;
    }
  }
  function retire(entry) {
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
    clearTimeout(entry.timer);
    entry.resident = false;
    free(entry);
  }
  function release(entry) {
    entry.users--;
    free(entry);
  }
  function trim() {
    for (const entry of entries.values()) {
      if (!entry.loading && entry.expires <= now()) retire(entry);
    }
    for (const entry of entries.values()) {
      if (bytes + maxItemBytes <= maxBytes && retained < maxEntries) break;
      if (!entry.loading && !entry.users) retire(entry);
    }
  }
  async function acquire(key, load) {
    let entry = entries.get(key);
    if (entry && !entry.loading && entry.expires <= now()) {
      retire(entry);
      entry = null;
    }
    if (!entry) {
      if (inFlight >= maxInFlight) return null; // Stream normally instead of queuing.
      trim();
      if (bytes + maxItemBytes > maxBytes || retained >= maxEntries)
        return null;
      entry = {
        key,
        size: maxItemBytes,
        loading: true,
        users: 0,
        resident: true,
        accounted: true,
        expires: Infinity,
        buffer: null,
      };
      bytes += entry.size;
      retained++;
      inFlight++;
      entries.set(key, entry);
      entry.pending = (async () => {
        try {
          // The loader calls resize BEFORE allocating its known-length buffer.
          const resize = (size) => {
            if (!Number.isSafeInteger(size) || size <= 0 || size > entry.size)
              throw Error("Image exceeds its reserved payload budget.");
            bytes -= entry.size - size;
            entry.size = size;
          };
          const buffer = await load(resize, maxItemBytes);
          if (!Buffer.isBuffer(buffer) || buffer.length !== entry.size)
            throw Error("Unexpected image buffer size.");
          entry.buffer = buffer;
          entry.expires = now() + ttl;
          if (entry.resident) {
            entry.timer = setTimeout(() => retire(entry), ttl);
            entry.timer.unref?.();
          }
        } catch (err) {
          retire(entry); // Do not cache errors; a later request can recover.
          throw err;
        } finally {
          entry.loading = false;
          inFlight--;
          free(entry);
        }
      })();
    } else {
      // LRU among idle entries, without changing expiry.
      entries.delete(key);
      entries.set(key, entry);
    }
    entry.users++;
    try {
      await entry.pending;
      let released = false;
      return {
        buffer: entry.buffer,
        release() {
          if (!released) {
            released = true;
            release(entry);
          }
        },
      };
    } catch (err) {
      release(entry);
      throw err;
    }
  }
  return {
    acquire,
    invalidate(key) {
      const entry = entries.get(key);
      if (entry) retire(entry);
    },
    clear() {
      for (const entry of entries.values()) retire(entry);
    },
    // Internal diagnostics for tests; never exposed by an HTTP endpoint.
    stats: () => ({ bytes, inFlight, entries: entries.size, retained }),
  };
};
