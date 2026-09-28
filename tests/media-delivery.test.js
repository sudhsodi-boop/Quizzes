const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const WebSocket = require("ws");

test(
  "private remote images: 100 cold/warm deliveries, grants, ranges and recovery",
  { timeout: 60000 },
  async () => {
    const root = path.join(__dirname, "..");
    const dir = fs.mkdtempSync(path.join(root, ".test-data-image-relay-"));
    const media = await require("./mock-media")();
    const origin = "http://127.0.0.1:4189";
    const sockets = [];
    let child, cookie;
    async function api(url, body, bytes = false) {
      const r = await fetch(origin + url, {
        method: "POST",
        headers: {
          Origin: origin,
          ...(cookie ? { Cookie: cookie } : {}),
          "Content-Type": bytes
            ? "application/octet-stream"
            : "application/json",
        },
        body: bytes ? body : JSON.stringify(body),
      });
      assert.ok(r.ok, `${url}: ${r.status}`);
      if (r.headers.get("set-cookie"))
        cookie = r.headers.get("set-cookie").split(";")[0];
      return r.json();
    }
    async function client(auth) {
      const ws = new WebSocket(origin.replace("http", "ws") + "/live", {
        origin,
        headers: auth ? { Cookie: cookie } : {},
      });
      sockets.push(ws);
      const inbox = [],
        waits = [];
      ws.on("message", (raw) => {
        const m = JSON.parse(raw),
          i = waits.findIndex((w) => w.type === m.type);
        if (i < 0) inbox.push(m);
        else waits.splice(i, 1)[0].resolve(m);
      });
      await once(ws, "open");
      return {
        send: (type, data = {}) => ws.send(JSON.stringify({ type, ...data })),
        wait(type) {
          const i = inbox.findIndex((m) => m.type === type);
          if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
          return new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(Error("No message: " + type)),
              5000,
            );
            waits.push({
              type,
              resolve: (m) => {
                clearTimeout(timer);
                resolve(m);
              },
            });
          });
        },
        inbox,
      };
    }
    const png = Buffer.concat([
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6sGkAAAAASUVORK5CYII=",
        "base64",
      ),
      Buffer.alloc(32 * 1024),
    ]);
    const id = (url) => new URL(url, origin).pathname.split("/").pop();
    async function image(url, headers = {}) {
      const r = await fetch(origin + url, { headers });
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("cache-control"), "private, no-store");
      assert.equal(r.headers.get("content-type"), "image/png");
      assert.deepEqual(Buffer.from(await r.arrayBuffer()), png);
    }
    try {
      child = spawn(process.execPath, ["server.js"], {
        cwd: root,
        env: {
          ...process.env,
          NODE_ENV: "test",
          PORT: "4189",
          DATA_DIR: dir,
          ALLOW_SETUP: "true",
          DATABASE_URL: "",
          RENDER: "",
          INITIAL_ADMIN_EMAIL: "",
          INITIAL_ADMIN_PASSWORD: "",
          SUPABASE_URL: media.url,
          SUPABASE_SERVICE_KEY: media.key,
          SUPABASE_MEDIA_BUCKET: "quizzes-media",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("Startup timeout")), 10000);
        child.stdout.on("data", (b) => {
          if (String(b).includes("listening")) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          reject(Error("Unexpected exit " + code));
        });
      });
      const password = crypto.randomBytes(20).toString("hex");
      await api("/api/setup", {
        email: "relay@example.test",
        password,
        organization: "Image relay test",
      });
      await api("/api/login", { email: "relay@example.test", password });
      const a = await api("/api/media", png, true),
        b = await api("/api/media", png, true);
      media.control(id(a.url), { delay: 200 });
      media.control(id(b.url), { delay: 200 });
      const q = (image) => ({
        text: "Image question",
        type: "choice",
        options: ["A", "B"],
        correct: 0,
        seconds: 120,
        points: 1000,
        media: image.url,
      });
      const quiz = await api("/api/quizzes", {
        title: "Delivery test",
        rounds: [{ title: "Images", questions: [q(a), q(b)] }],
      });
      const host = await client(true);
      host.send("create_game", { quizId: quiz.id });
      const room = await host.wait("game_created");
      await host.wait("host_images");
      const player = await client(false);
      player.send("join_game", { code: room.game.code, name: "Image player" });
      const joined = await player.wait("joined");
      assert.equal(joined.question, null);
      assert.equal((await fetch(origin + a.url)).status, 404);
      assert.equal(media.reads(id(a.url)), 0);
      host.send("start_question");
      const current = await player.wait("question_started");
      assert.equal(current.game.status, "question");
      assert.ok(current.game.deadline > Date.now() + 115000); // No image-readiness barrier.
      await Promise.all(
        Array.from({ length: 100 }, () => image(current.question.media)),
      );
      assert.equal(
        media.reads(id(a.url)),
        1,
        "100 authorized cold requests share one upstream download",
      );
      await image(current.question.media);
      assert.equal(
        media.reads(id(a.url)),
        1,
        "warm hit never refetches the origin",
      );
      // Even a warm object must pass the ordinary per-request authorization gate.
      assert.equal((await fetch(origin + a.url)).status, 404);
      assert.equal(
        (await fetch(origin + a.url + "?until=1&grant=" + "a".repeat(64)))
          .status,
        404,
      );
      assert.equal(
        (await fetch(origin + "/private-image-cache.js")).status,
        404,
      );
      assert.equal(media.reads(id(a.url)), 1);
      assert.ok(!player.inbox.some((m) => m.type === "host_images"));
      const preloads = await host.wait("host_images");
      const upcoming = preloads.images.find((x) => x.index === 1);
      await image(upcoming.url, { Cookie: cookie }); // The existing host preload warms delivery to everyone.
      assert.equal(media.reads(id(b.url)), 1);
      host.send("reveal_answers");
      await player.wait("question_ended");
      host.send("start_question");
      await player.wait("last_question_intro");
      host.send("start_question");
      const next = await player.wait("question_started");
      await Promise.all(
        Array.from({ length: 100 }, () => image(next.question.media)),
      );
      assert.equal(
        media.reads(id(b.url)),
        1,
        "100 participants reuse the host-warmed server image",
      );
      // Range/audio paths remain independent streams, with access checked first.
      const partial = await fetch(origin + next.question.media, {
        headers: { Range: "bytes=1-8" },
      });
      assert.equal(partial.status, 206);
      assert.equal(
        partial.headers.get("content-range"),
        `bytes 1-8/${png.length}`,
      );
      assert.deepEqual(
        Buffer.from(await partial.arrayBuffer()),
        png.subarray(1, 9),
      );
      const invalidRange = await fetch(origin + next.question.media, {
        headers: { Range: "bytes=99999999-" },
      });
      assert.equal(invalidRange.status, 416);
      await invalidRange.arrayBuffer();
      // Unknown-length images use the existing bounded streaming path, not unbounded buffering.
      const unknown = await api("/api/media", png, true);
      media.control(id(unknown.url), { unknownLength: true });
      await image(unknown.url, { Cookie: cookie });
      assert.equal(media.reads(id(unknown.url)), 2); // One header probe, then a normal stream.
      const failed = await api("/api/media", png, true);
      media.control(id(failed.url), { failNext: true, delay: 100 });
      const failures = await Promise.all(
        Array.from({ length: 10 }, async () => {
          const r = await fetch(origin + failed.url, {
            headers: { Cookie: cookie },
          });
          await r.arrayBuffer();
          return r.status;
        }),
      );
      assert.ok(failures.every((status) => status >= 500));
      assert.equal(media.reads(id(failed.url)), 1);
      await image(failed.url, { Cookie: cookie });
      assert.equal(media.reads(id(failed.url)), 2);
      // One disconnected participant must not cancel the shared origin fetch.
      const interrupted = await api("/api/media", png, true);
      media.control(id(interrupted.url), { delay: 200 });
      const abort = new AbortController();
      const cancelled = fetch(origin + interrupted.url, {
        headers: { Cookie: cookie },
        signal: abort.signal,
      }).then(
        () => false,
        (error) => error.name === "AbortError",
      );
      const survivor = image(interrupted.url, { Cookie: cookie });
      setTimeout(() => abort.abort(), 50);
      assert.equal(await cancelled, true);
      await survivor;
      await image(interrupted.url, { Cookie: cookie });
      assert.equal(media.reads(id(interrupted.url)), 1);
      // Audio is never buffered by the image relay; seeking keeps working.
      const wav = Buffer.alloc(44 + 8000);
      wav.write("RIFF");
      wav.writeUInt32LE(wav.length - 8, 4);
      wav.write("WAVEfmt ", 8);
      wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(1, 20);
      wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(8000, 24);
      wav.writeUInt32LE(8000, 28);
      wav.writeUInt16LE(1, 32);
      wav.writeUInt16LE(8, 34);
      wav.write("data", 36);
      wav.writeUInt32LE(8000, 40);
      wav.fill(128, 44);
      const track = await api("/api/media", wav, true);
      for (let i = 0; i < 2; i++) {
        const r = await fetch(origin + track.url, {
          headers: { Cookie: cookie, Range: "bytes=0-43" },
        });
        assert.equal(r.status, 206);
        assert.equal(r.headers.get("content-type"), "audio/wav");
        assert.deepEqual(
          Buffer.from(await r.arrayBuffer()),
          wav.subarray(0, 44),
        );
      }
      assert.equal(media.reads(id(track.url)), 2);
    } finally {
      for (const ws of sockets) ws.terminate();
      if (child && child.exitCode === null) {
        const done = once(child, "exit");
        child.kill("SIGTERM");
        await done;
      }
      await media.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
