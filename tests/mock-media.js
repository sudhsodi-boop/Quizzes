// Contract fixture only: this is not a hosted Supabase integration test.
const http = require("node:http");
module.exports = async function mockMedia() {
  let bucket = null;
  const objects = new Map();
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
      const obj = objects.get(id);
      if (!obj) return json(404, {});
      res.writeHead(200, {
        "Content-Type": obj.mime,
        "Content-Length": obj.bytes.length,
      });
      return res.end(obj.bytes);
    }
    return json(404, {});
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: "http://127.0.0.1:" + server.address().port,
    key,
    stop: () => new Promise((r) => server.close(r)),
  };
};
