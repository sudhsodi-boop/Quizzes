const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { dataDir } = require("./storage");
const { startupError } = require("./startup-diagnostics");
const remote = !!process.env.SUPABASE_URL;
const bucket = process.env.SUPABASE_MEDIA_BUCKET || "quizzes-media";
const folder = path.join(dataDir, "media");
const key = process.env.SUPABASE_SERVICE_KEY;
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
}
async function read(id) {
  safeId(id);
  if (!remote) return fs.promises.readFile(path.join(folder, id));
  const r = await request("/object/authenticated/" + bucket + "/" + id);
  if (!r.ok) throw Error("Media download failed.");
  return Buffer.from(await r.arrayBuffer());
}
async function serve(req, res, id, mime) {
  safeId(id);
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
