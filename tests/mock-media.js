// Contract fixture only: this is not a hosted Supabase integration test.
const http = require("node:http");
module.exports = async function mockMedia() {
  let bucket = null;
  const objects = new Map();
  const reads = new Map(),
    controls = new Map();
  const key = "sb_secret_" + require("crypto").randomBytes(24).toString("hex");
  const server = http.createServer(async (req, res) => {
    if (req.headers.apikey !== key) {
      res.writeHead(401);
      return res.end("{}");
    }
    const pathname = new URL(req.url, "http://test").pathname;
    const json = (status, value) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (pathname === "/storage/v1/bucket" && req.method === "POST") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      bucket = JSON.parse(Buffer.concat(chunks));
      return json(200, bucket);
    }
    if (pathname === "/storage/v1/bucket/quizzes-media")
      return json(bucket ? 200 : 404, bucket || {});
    const id = pathname.split("/").pop();
    if (req.method === "POST" && pathname.includes("/object/quizzes-media/")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      objects.set(id, {
        bytes: Buffer.concat(chunks),
        mime: req.headers["content-type"],
      });
      return json(200, { Key: id });
    }
    if (
      req.method === "GET" &&
      pathname.includes("/object/authenticated/quizzes-media/")
    ) {
      reads.set(id, (reads.get(id) || 0) + 1);
      const control = controls.get(id) || {};
      if (control.delay)
        await new Promise((resolve) => setTimeout(resolve, control.delay));
      if (control.failNext) {
        control.failNext = false;
        return json(503, {});
      }
      const obj = objects.get(id);
      if (!obj) return json(404, {});
      let bytes = obj.bytes,
        status = 200;
      const headers = { "Content-Type": obj.mime, "Accept-Ranges": "bytes" };
      if (req.headers.range) {
        const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
        const start = m ? Number(m[1]) : bytes.length;
        const end = m?.[2]
          ? Math.min(Number(m[2]), bytes.length - 1)
          : bytes.length - 1;
        if (start > end || start >= bytes.length) {
          res.writeHead(416, { "Content-Range": `bytes */${bytes.length}` });
          return res.end();
        }
        headers["Content-Range"] = `bytes ${start}-${end}/${bytes.length}`;
        bytes = bytes.subarray(start, end + 1);
        status = 206;
      }
      if (!control.unknownLength) headers["Content-Length"] = bytes.length;
      res.writeHead(status, headers);
      return res.end(bytes);
    }
    return json(404, {});
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: "http://127.0.0.1:" + server.address().port,
    key,
    reads: (id) => reads.get(id) || 0,
    control: (id, options) => controls.set(id, options),
    stop: () => new Promise((r) => server.close(r)),
  };
};
