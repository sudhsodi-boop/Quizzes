const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { dataDir } = require("./storage");
const remote = !!process.env.SUPABASE_URL;
const bucket = process.env.SUPABASE_MEDIA_BUCKET || "quizzes-media";
const folder = path.join(dataDir, "media");
const key = process.env.SUPABASE_SERVICE_KEY;
let base;
if (remote) {
  const url = new URL(process.env.SUPABASE_URL);
  if (url.protocol !== "https:" && process.env.NODE_ENV !== "test")
    throw Error("Supabase media requires HTTPS.");
  base = url.origin + "/storage/v1";
  if (!key)
    throw Error("SUPABASE_SERVICE_KEY must be configured on the server.");
} else fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
if (!/^[a-z0-9-]{1,63}$/.test(bucket))
  throw Error("Invalid media bucket name.");
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
const ready = (async () => {
  if (!remote) return;
  let res = await request("/bucket/" + bucket);
  if (res.status === 404 || res.status === 400) {
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
    if (!res.ok && res.status !== 409)
      throw Error(
        "Unable to create the private media bucket. Check Supabase configuration.",
      );
    res = await request("/bucket/" + bucket);
  }
  if (!res.ok)
    throw Error(
      "Unable to access the media bucket. Check Supabase configuration.",
    );
  if ((await res.json()).public)
    throw Error("The configured media bucket must be private.");
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
      "Cache-Control": "private, max-age=3600",
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
    "Cache-Control": "private, max-age=3600",
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
