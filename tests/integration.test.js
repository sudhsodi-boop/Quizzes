const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn, spawnSync, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { once } = require("node:events");
const WebSocket = require("ws");
const root = path.join(__dirname, "..");
const temp = fs.mkdtempSync(path.join(root, ".test-data-"));
const port = 4181,
  origin = `http://localhost:${port}`;
let server,
  cookie = "",
  quizId,
  code,
  reportId;
const clients = [];
let remoteMedia;
if (
  process.env.TEST_DATABASE_URL &&
  !/^quizzes_test/.test(
    new URL(process.env.TEST_DATABASE_URL).pathname.slice(1),
  )
)
  throw Error("Only a dedicated quizzes_test database is allowed for tests.");
async function start() {
  server = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: temp,
      ALLOW_SETUP: "true",
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL || "",
      DATABASE_TEST_NO_TLS: process.env.TEST_DATABASE_URL ? "true" : "",
      RENDER: "",
      INITIAL_ADMIN_EMAIL: "",
      INITIAL_ADMIN_PASSWORD: "",
      SUPABASE_URL: remoteMedia?.url || "",
      SUPABASE_SERVICE_KEY: remoteMedia?.key || "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Server startup timed out")),
      10000,
    );
    server.stdout.on("data", (d) => {
      if (d.toString().includes("listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on("data", (d) => console.error(d.toString()));
    server.once("exit", (c) => {
      clearTimeout(timer);
      reject(Error("Server exited " + c));
    });
  });
}
async function stop() {
  if (!server) return;
  const exited = once(server, "exit");
  server.kill("SIGTERM");
  await exited;
  server = null;
}
async function request(url, method = "GET", body, auth = true, headers = {}) {
  const res = await fetch(origin + url, {
    method,
    headers: {
      Origin: origin,
      ...(auth ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body:
      body === undefined
        ? undefined
        : Buffer.isBuffer(body)
          ? body
          : JSON.stringify(body),
  });
  const value = await res.json();
  return { res, value };
}
async function client(auth = false) {
  const ws = new WebSocket(`ws://localhost:${port}/live`, {
    origin,
    headers: auth ? { Cookie: cookie } : {},
  });
  const c = {
    ws,
    inbox: [],
    listeners: [],
    send(type, data = {}) {
      ws.send(JSON.stringify({ type, ...data }));
    },
    wait(type, predicate = () => true) {
      const i = c.inbox.findIndex((x) => x.type === type && predicate(x));
      if (i >= 0) return Promise.resolve(c.inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const entry = {
          type,
          predicate,
          resolve: (m) => {
            clearTimeout(timer);
            resolve(m);
          },
        };
        const timer = setTimeout(() => {
          c.listeners = c.listeners.filter((x) => x !== entry);
          reject(Error("Timed out: " + type));
        }, 8000);
        c.listeners.push(entry);
      });
    },
  };
  ws.on("message", (d) => {
    const m = JSON.parse(d);
    const i = c.listeners.findIndex((x) => x.type === m.type && x.predicate(m));
    if (i >= 0) c.listeners.splice(i, 1)[0].resolve(m);
    else c.inbox.push(m);
  });
  clients.push(c);
  await once(ws, "open");
  return c;
}
test(
  "Quizzes integration: auth, media, quiz engine, 100 players, persistence",
  { timeout: 90000 },
  async (t) => {
    try {
      if (process.env.TEST_REMOTE_MEDIA === "true")
        remoteMedia = await require("./mock-media")();
      await start();
      let password = crypto.randomBytes(24).toString("base64");
      await t.test(
        "host authentication and static file allowlist",
        async () => {
          assert.equal(
            (await request("/api/quizzes", "GET", undefined, false)).res.status,
            401,
          );
          for (const file of [
            "/server.js",
            "/storage.js",
            "/data/quizzes.sqlite",
            "/package.json",
            "/.env",
          ])
            assert.equal((await request(file)).res.status, 404);
          assert.equal(
            (
              await request(
                "/api/setup",
                "POST",
                {
                  email: "host@example.test",
                  password,
                  organization: "Test nonprofit",
                },
                false,
                { Origin: "https://evil.invalid" },
              )
            ).res.status,
            403,
          );
          assert.equal(
            (
              await request(
                "/api/setup",
                "POST",
                {
                  email: "host@example.test",
                  password,
                  organization: "Test nonprofit",
                },
                false,
              )
            ).res.status,
            201,
          );
          assert.equal(
            (await request("/api/setup", "POST", {}, false)).res.status,
            403,
          );
          assert.equal(
            (
              await request(
                "/api/login",
                "POST",
                { email: "host@example.test", password: "not-the-password" },
                false,
              )
            ).res.status,
            401,
          );
          const login = await request(
            "/api/login",
            "POST",
            { email: "host@example.test", password },
            false,
          );
          assert.equal(login.res.status, 200);
          cookie = login.res.headers.get("set-cookie").split(";")[0];
          assert.match(
            login.res.headers.get("set-cookie"),
            /HttpOnly; SameSite=Strict/,
          );
          assert.equal(
            (await request("/api/session")).value.user.organization,
            "Test nonprofit",
          );
          const guest = await client();
          guest.send("create_game");
          assert.match((await guest.wait("error")).message, /sign in/i);
          guest.ws.close();
        },
      );
      let media;
      await t.test(
        "uploads and saved multi-round quiz validation",
        async () => {
          assert.equal(
            (
              await request(
                "/api/media",
                "POST",
                Buffer.from('<svg onload="alert(1)"></svg>'),
              )
            ).res.status,
            400,
          );
          const png = Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6sGkAAAAASUVORK5CYII=",
            "base64",
          );
          const uploaded = await request("/api/media", "POST", png);
          assert.equal(uploaded.res.status, 201);
          media = uploaded.value.url;
          assert.equal(
            (await fetch(origin + media, {headers:{Cookie:cookie}})).headers.get("content-type"),
            "image/png",
          );
          const quiz = {
            title: "Integration quiz",
            description: "Persistence test",
            rounds: [
              {
                title: "Choice and true/false",
                questions: [
                  {
                    type: "choice",
                    text: "Two plus two?",
                    options: ["4", "5"],
                    correct: 0,
                    seconds: 5,
                    points: 1000,
                    media,
                  },
                  {
                    type: "boolean",
                    text: "Volunteers matter.",
                    correct: 0,
                    seconds: 5,
                    points: 1000,
                  },
                ],
              },
              {
                title: "Text round",
                questions: [
                  {
                    type: "text",
                    text: "Together we are ____",
                    accepted: ["stronger", "better together"],
                    seconds: 5,
                    points: 1000,
                  },
                ],
              },
            ],
          };
          const saved = await request("/api/quizzes", "POST", quiz);
          assert.equal(saved.res.status, 201);
          quizId = saved.value.id;
          assert.equal(
            saved.value.rounds[0].questions[0].mediaType,
            "image/png",
          );
          const invalid = structuredClone(quiz);
          invalid.rounds[0].questions[0].correct = 8;
          assert.equal(
            (await request("/api/quizzes", "POST", invalid)).res.status,
            400,
          );
          quiz.title = "Saved integration quiz";
          assert.equal(
            (await request("/api/quizzes/" + quizId, "PUT", quiz)).value.title,
            quiz.title,
          );
        },
      );
      let host, player, hostToken, playerToken;
      await t.test(
        "separate host and player sessions, scoring and hidden answers",
        async () => {
          host = await client(true);
          host.send("create_game", { quizId });
          const created = await host.wait("game_created");
          code = created.game.code;
          hostToken = created.hostToken;
          player = await client();
          player.send("join_game", { code, name: "Test player" });
          const joined = await player.wait("joined");
          playerToken = joined.playerToken;
          player.send("start_question");
          assert.match((await player.wait("error")).message, /not available/);
          host.send("start_question");
          const started = await player.wait("question_started");
          assert.equal(started.question.text, "Two plus two?");
          assert.ok(!("correct" in started.question));
          assert.ok(!("accepted" in started.question));
          player.send("submit_answer", {
            questionId: started.question.id,
            answer: 0,
          });
          await player.wait("answer_received");
          player.send("submit_answer", {
            questionId: started.question.id,
            answer: 0,
          });
          assert.match((await player.wait("error")).message, /already locked/);
          const pending = await host.wait(
            "participants_updated",
            (m) => m.game.participants[0]?.answered,
          );
          assert.equal(pending.game.participants[0].score, 0);
          host.send("reveal_answers");
          const result = await player.wait("question_ended");
          assert.equal(result.correct, "4");
          assert.ok(result.leaderboard[0].score >= 500);
          host.send("next_question");
          const tf = await player.wait("question_started");
          assert.equal(tf.question.type, "boolean");
          player.send("submit_answer", {
            questionId: tf.question.id,
            answer: 1,
          });
          await player.wait("answer_received");
          host.send("reveal_answers");
          const wrong = await player.wait("question_ended");
          assert.equal(wrong.leaderboard[0].score, result.leaderboard[0].score);
        },
      );
      await t.test(
        "reconnect preserves scores and locked answers; text normalization",
        async () => {
          player.ws.close();
          await once(player.ws, "close");
          player = await client();
          player.send("resume_player", { code, playerToken });
          const resumed = await player.wait("joined");
          assert.equal(resumed.answered, true);
          assert.ok(resumed.game.participants[0].score > 0);
          host.ws.close();
          await once(host.ws, "close");
          host = await client(true);
          host.send("resume_host", { code, hostToken });
          assert.equal(
            (await host.wait("host_resumed")).game.status,
            "results",
          );
          host.send("next_question");
          assert.match((await player.wait("round_intro")).game.upcomingRound,/Round 2/);
          host.send("next_question");
          const q = await player.wait("question_started");
          assert.equal(q.question.type, "text");
          assert.ok(!("accepted" in q.question));
          player.send("submit_answer", {
            questionId: "old-question",
            answer: "wrong",
          });
          assert.match((await player.wait("error")).message, /older question/);
          player.send("submit_answer", {
            questionId: q.question.id,
            answer: "  BETTER    together  ",
          });
          await player.wait("answer_received");
          host.send("reveal_answers");
          await player.wait("question_ended");
          host.send("next_question");
          const ended = await player.wait("game_ended");
          assert.ok(ended.leaderboard[0].score >= 1000);
          reportId = ended.reportId;
          const r = (await request("/api/reports")).value.find(
            (r) => r.id === reportId,
          );
          assert.equal(r.questionsPlayed, 3);
          assert.equal(r.answers[2].correct, true);
          assert.equal(r.answers[1].correct, false);
        },
      );
      await t.test(
        "100 participants, hard capacity limit and server timer expiry",
        async () => {
          const h = await client(true);
          h.send("create_game", { quizId });
          const g = await h.wait("game_created");
          const players = await Promise.all(
            Array.from({ length: 100 }, async (_, i) => {
              const c = await client();
              c.send("join_game", { code: g.game.code, name: "Player " + i });
              await c.wait("joined");
              return c;
            }),
          );
          const extra = await client();
          extra.send("join_game", { code: g.game.code, name: "One too many" });
          assert.match((await extra.wait("error")).message, /full/);
          extra.ws.close();
          h.send("start_question");
          await Promise.all(
            players.map(async (c) => {
              const q = await c.wait("question_started");
              c.send("submit_answer", { questionId: q.question.id, answer: 0 });
              await c.wait("answer_received");
            }),
          );
          const results = await Promise.all(
            players.map((c) => c.wait("question_ended")),
          );
          assert.equal(results[0].leaderboard.length, 100);
          assert.ok(results[0].leaderboard.every((p) => p.score >= 500));
          players[0].send("submit_answer", {
            questionId: "expired",
            answer: 0,
          });
          assert.match((await players[0].wait("error")).message, /closed/);
          h.send("end_game");
          await h.wait("game_ended");
          for (const c of players) c.ws.close();
          h.ws.close();
        },
      );
      await t.test(
        "database, account and media persist across server restart",
        async () => {
          for (const c of clients) c.ws.close();
          await stop();
          await start();
          assert.equal(
            (await request("/api/session")).value.setupRequired,
            false,
          );
          assert.ok(
            (await request("/api/quizzes")).value.some((q) => q.id === quizId),
          );
          assert.ok(
            (await request("/api/reports")).value.some(
              (r) => r.id === reportId,
            ),
          );
          assert.equal((await fetch(origin + media, {headers:{Cookie:cookie}})).status, 200);
        },
      );
      await t.test(
        "portable backup download and restore into a fresh database",
        async () => {
          assert.equal(
            (await request("/api/backup", "POST", { password: "incorrect" }))
              .res.status,
            401,
          );
          const response = await fetch(origin + "/api/backup", {
            method: "POST",
            headers: {
              Origin: origin,
              Cookie: cookie,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ password }),
          });
          assert.equal(response.status, 200);
          assert.equal(response.headers.get("content-type"), "application/zip");
          const zip = path.join(temp, "backup.zip");
          fs.writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
          const snapshot = JSON.parse(
            execFileSync("unzip", ["-p", zip, "database.json"], {
              encoding: "utf8",
            }),
          );
          assert.equal(snapshot.format, "quizzes-backup");
          assert.ok(snapshot.tables.quizzes.some((q) => q.id === quizId));
          assert.ok(!snapshot.tables.sessions);
          const extracted = path.join(temp, "restore-input");
          fs.mkdirSync(extracted);
          execFileSync("unzip", ["-q", zip, "-d", extracted]);
          const restored = path.join(temp, "restored");
          const env = {
            ...process.env,
            NODE_ENV: "test",
            DATA_DIR: restored,
            DATABASE_URL: "",
            SUPABASE_URL: "",
            SUPABASE_SERVICE_KEY: "",
            INITIAL_ADMIN_EMAIL: "",
            INITIAL_ADMIN_PASSWORD: "",
            RENDER: "",
          };
          const result = spawnSync(
            process.execPath,
            ["scripts/restore.js", extracted],
            { cwd: root, env, encoding: "utf8" },
          );
          assert.equal(result.status, 0, result.stderr);
          const check = new (require("better-sqlite3"))(
            path.join(restored, "quizzes.sqlite"),
          );
          assert.equal(
            check.prepare("SELECT COUNT(*) AS n FROM reports").get().n,
            2,
          );
          assert.ok(
            check.prepare("SELECT id FROM quizzes WHERE id=?").get(quizId),
          );
          check.close();
          assert.ok(
            fs.existsSync(path.join(restored, "media", media.split("/").pop())),
          );
          const second = spawnSync(
            process.execPath,
            ["scripts/restore.js", extracted],
            { cwd: root, env, encoding: "utf8" },
          );
          assert.equal(second.status, 1);
        },
      );
      await t.test(
        "recovery code rotates, resets once, and revokes existing sessions",
        async () => {
          const first = await request("/api/recovery-code", "POST", {
            password,
          });
          assert.equal(first.res.status, 200);
          const second = await request("/api/recovery-code", "POST", {
            password,
          });
          assert.equal(second.res.status, 200);
          const next = crypto.randomBytes(24).toString("base64");
          assert.equal(
            (
              await request(
                "/api/recover",
                "POST",
                {
                  email: "host@example.test",
                  code: first.value.code,
                  password: next,
                },
                false,
              )
            ).res.status,
            401,
          );
          const attempts = await Promise.all(
            [1, 2].map(() =>
              request(
                "/api/recover",
                "POST",
                {
                  email: "host@example.test",
                  code: second.value.code,
                  password: next,
                },
                false,
              ),
            ),
          );
          assert.deepEqual(
            attempts.map((x) => x.res.status).sort(),
            [200, 401],
          );
          assert.equal((await request("/api/quizzes")).res.status, 401);
          assert.equal(
            (
              await request(
                "/api/login",
                "POST",
                { email: "host@example.test", password },
                false,
              )
            ).res.status,
            401,
          );
          password = next;
          const login = await request(
            "/api/login",
            "POST",
            { email: "host@example.test", password },
            false,
          );
          assert.equal(login.res.status, 200);
          cookie = login.res.headers.get("set-cookie").split(";")[0];
          assert.equal((await request("/api/quizzes")).res.status, 200);
        },
      );
      await t.test("logout invalidates host session", async () => {
        assert.equal(
          (await request("/api/logout", "POST", {})).res.status,
          200,
        );
        assert.equal((await request("/api/quizzes")).res.status, 401);
      });
    } finally {
      clients.forEach((c) => c.ws.terminate());
      await stop();
      if (remoteMedia) await remoteMedia.stop();
      fs.rmSync(temp, { recursive: true, force: true });
    }
  },
);
