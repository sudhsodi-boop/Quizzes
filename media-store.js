const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { dataDir } = require("./storage");
const { startupError } = require("./startup-diagnostics");
const remote = !!process.env.SUPABASE_URL;
const bucket = process.env.SUPABASE_MEDIA_BUCKET || "quizzes-media";
const folder = path.join(dataDir, "media");
const key = process.env.SUPABASE_SERVICE_KEY;
const imageCache = require("./private-image-cache")();
let base;
if (remote) {
  let url;
  try {
    const value = process.env.SUPABASE_URL;
    if (value !== value.trim()) throw Error();
    url = new URL(value);
    if (
      (url.protocol !== "https:" &&
        !(process.env.NODE_ENV === "test" && url.protocol === "http:")) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw Error();
  } catch {
    throw startupError("CONFIG_MEDIA_URL", "MEDIA_CONFIG");
  }
  base = url.origin + "/storage/v1";
  if (!key) throw startupError("CONFIG_MEDIA_KEY_MISSING", "MEDIA_CONFIG");
  if (
    key !== key.trim() ||
    /\s/.test(key) ||
    !(
      key.startsWith("sb_secret_") ||
      /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)
    )
  )
    throw startupError("CONFIG_MEDIA_KEY_TYPE", "MEDIA_CONFIG");
} else fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
if (!/^[a-z0-9-]{1,63}$/.test(bucket))
  throw startupError("CONFIG_MEDIA_BUCKET", "MEDIA_CONFIG");
const headers = () => ({
  apikey: key,
  ...(key?.startsWith("eyJ") ? { Authorization: "Bearer " + key } : {}),
});
function safeId(id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw Error("Invalid media id");
  return id;
}
async function request(route, options = {}) {
  const response = await fetch(base + route, {
    ...options,
    headers: { ...headers(), ...options.headers },
    signal: AbortSignal.timeout(30000),
  });
  return response;
}
function mediaStartupFailure(response, stage) {
  const error = new Error("Media service rejected a startup request.");
  error.startupStage = stage;
  error.startupHttpStatus = response.status;
  return error;
}
const ready = (async () => {
  let stage = "MEDIA_BUCKET_LOOKUP";
  try {
    if (!remote) return;
    let res = await request("/bucket/" + bucket);
    if (res.status === 404 || res.status === 400) {
      stage = "MEDIA_BUCKET_CREATE";
      res = await request("/bucket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: bucket,
          name: bucket,
          public: false,
          file_size_limit: 10 * 1024 * 1024,
          allowed_mime_types: [
            "image/png",
            "image/jpeg",
            "image/gif",
            "image/webp",
            "audio/mpeg",
            "audio/wav",
            "audio/ogg",
          ],
        }),
      });
      if (!res.ok) {
        // Another instance may have created the same private bucket after our
        // initial lookup. Verify existence instead of failing on a duplicate.
        const creationError = mediaStartupFailure(res, stage);
        const verification = await request("/bucket/" + bucket);
        if (!verification.ok) throw creationError;
        res = verification;
      } else {
        stage = "MEDIA_BUCKET_LOOKUP";
        res = await request("/bucket/" + bucket);
      }
    }
    if (!res.ok) throw mediaStartupFailure(res, stage);
    stage = "MEDIA_BUCKET_VALIDATE";
    let info;
    try {
      info = await res.json();
    } catch {
      throw startupError("MEDIA_RESPONSE_INVALID", stage);
    }
    if (!info || typeof info.public !== "boolean")
      throw startupError("MEDIA_RESPONSE_INVALID", stage);
    if (info.public) throw startupError("MEDIA_BUCKET_PUBLIC", stage);
  } catch (error) {
    if (!error.startupStage) error.startupStage = stage;
    throw error;
  }
})();
async function write(id, buffer, mime) {
  safeId(id);
  imageCache.invalidate(id);
  if (!remote)
    return fs.promises.writeFile(path.join(folder, id), buffer, {
      mode: 0o600,
    });
  const r = await request("/object/" + bucket + "/" + id, {
    method: "POST",
    headers: { "Content-Type": mime, "x-upsert": "true" },
    body: buffer,
  });
  if (!r.ok) throw Error("Media upload failed.");
  imageCache.invalidate(id);
}
async function read(id) {
  safeId(id);
  if (!remote) return fs.promises.readFile(path.join(folder, id));
  const r = await request("/object/authenticated/" + bucket + "/" + id);
  if (!r.ok) throw Error("Media download failed.");
  return Buffer.from(await r.arrayBuffer());
}
async function loadSharedImage(id, resize, maxBytes) {
  const r = await request("/object/authenticated/" + bucket + "/" + id);
  if (r.status !== 200) {
    await r.body?.cancel();
    throw Error("Media is unavailable.");
  }
  const length = Number(r.headers.get("content-length"));
  // Supabase normally supplies the object length. Unknown/encoded/oversized
  // bodies retain the old streaming path rather than being buffered without a bound.
  if (
    !Number.isSafeInteger(length) ||
    length <= 0 ||
    length > maxBytes ||
    (r.headers.get("content-encoding") &&
      r.headers.get("content-encoding") !== "identity")
  ) {
    await r.body?.cancel();
    throw Object.assign(Error("Stream this image instead."), {
      code: "IMAGE_STREAM_ONLY",
    });
  }
  resize(length);
  const buffer = Buffer.alloc(length);
  const reader = r.body.getReader();
  let offset = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > length)
        throw Error("Invalid image length.");
      buffer.set(value, offset);
      offset += value.byteLength;
    }
    if (offset !== length) throw Error("Incomplete image download.");
    return buffer;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
async function serve(req, res, id, mime) {
  safeId(id);
  // The server route has already checked owner/session or signed-grant access.
  // All responses remain private/no-store; this is NOT a browser/public cache.
  if (
    remote &&
    req.method === "GET" &&
    !req.headers.range &&
    mime.startsWith("image/")
  ) {
    let lease;
    try {
      lease = await imageCache.acquire(id, (resize, maxBytes) =>
        loadSharedImage(id, resize, maxBytes),
      );
    } catch (error) {
      if (error.code !== "IMAGE_STREAM_ONLY") throw error;
    }
    if (lease) {
      if (res.destroyed) {
        lease.release();
        return;
      }
      const release = () => {
        res.off("finish", release);
        res.off("close", release);
        lease.release();
      };
      res.once("finish", release);
      res.once("close", release);
      try {
        res.writeHead(200, {
          "Content-Type": mime,
          "Content-Length": lease.buffer.length,
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, no-store",
        });
        return res.end(lease.buffer);
      } catch (error) {
        release();
        throw error;
      }
    }
  }
  if (remote) {
    const r = await request("/object/authenticated/" + bucket + "/" + id, {
      headers: req.headers.range ? { Range: req.headers.range } : {},
    });
    if (![200, 206, 416].includes(r.status))
      throw Error("Media is unavailable.");
    const h = {
      "Content-Type": mime,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
    };
    for (const name of ["content-length", "content-range"])
      if (r.headers.has(name)) h[name] = r.headers.get(name);
    res.writeHead(r.status, h);
    const stream = Readable.fromWeb(r.body);
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy());
    return stream.pipe(res);
  }
  const file = path.join(folder, id),
    size = (await fs.promises.stat(file)).size;
  const h = {
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  };
  let start = 0,
    end = size - 1,
    status = 200;
  if (req.headers.range) {
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
    if (!m) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      return res.end();
    }
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      return res.end();
    }
    status = 206;
    h["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  res.writeHead(status, { ...h, "Content-Length": end - start + 1 });
  const stream = fs.createReadStream(file, { start, end });
  stream.on("error", () => res.destroy());
  return stream.pipe(res);
}
module.exports = { remote, ready, write, read, serve };
