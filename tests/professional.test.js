const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");
const { once } = require("node:events");
const WS = require("ws");
const root = path.join(__dirname, "..");
test(
  "Professional Studio: private drafts, revisions, backup restore and audience isolation",
  { timeout: 60000 },
  async (t) => {
    const dir = fs.mkdtempSync(path.join(root, ".test-studio-"));
    const origin = "http://localhost:4188",
      sockets = [],
      password = crypto.randomBytes(24).toString("hex");
    const database = process.env.STUDIO_TEST_DATABASE_URL || "";
    if (database && !new URL(database).pathname.startsWith("/quizzes_test"))
      throw Error("Dedicated test database required.");
    const env = {
      ...process.env,
      PORT: "4188",
      DATA_DIR: dir,
      NODE_ENV: "test",
      ALLOW_SETUP: "true",
      DATABASE_URL: database,
      DATABASE_TEST_NO_TLS: database ? "true" : "",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_KEY: "",
      RENDER: "",
      INITIAL_ADMIN_EMAIL: "",
      INITIAL_ADMIN_PASSWORD: "",
      SITE_ADMIN_EMAIL: "studio@example.test",
    };
    let child, owner, friend, official;
    async function start() {
      child = spawn(process.execPath, ["server.js"], {
        cwd: root,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      await new Promise((resolve, reject) => {
        let log = "";
        const timeout = setTimeout(
          () => reject(Error("Startup: " + log)),
          10000,
        );
        child.stdout.on("data", (b) => {
          log += b;
          if (log.includes("listening")) {
            clearTimeout(timeout);
            resolve();
          }
        });
        child.stderr.on("data", (b) => (log += b));
        child.once("exit", () => {
          clearTimeout(timeout);
          reject(Error(log));
        });
      });
    }
    async function stop() {
      if (!child || child.exitCode !== null) return;
      const done = once(child, "exit");
      child.kill("SIGTERM");
      await done;
      child = null;
    }
    async function req(url, method = "GET", body, cookie = "", extra = {}) {
      const response = await fetch(origin + url, {
        method,
        headers: {
          Origin: origin,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...extra,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const value = response.headers.get("content-type")?.includes("json")
        ? await response.json()
        : Buffer.from(await response.arrayBuffer());
      return {
        status: response.status,
        value,
        cookie: response.headers.get("set-cookie")?.split(";")[0],
      };
    }
    async function connect(cookie = "") {
      const ws = new WS(origin.replace("http", "ws") + "/live", {
        origin,
        headers: cookie ? { Cookie: cookie } : {},
      });
      sockets.push(ws);
      const queue = [],
        history = [],
        waiting = [];
      ws.on("message", (b) => {
        const m = JSON.parse(b);
        history.push(m);
        const i = waiting.findIndex((w) => w.type === m.type);
        if (i >= 0) {
          const w = waiting.splice(i, 1)[0];
          clearTimeout(w.timer);
          w.resolve(m);
        } else queue.push(m);
      });
      await once(ws, "open");
      return {
        ws,
        history,
        send(type, data = {}) {
          ws.send(JSON.stringify({ type, ...data }));
        },
        wait(type) {
          const i = queue.findIndex((m) => m.type === type);
          if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
          return new Promise((resolve, reject) => {
            const w = {
              type,
              resolve,
              timer: setTimeout(
                () =>
                  reject(
                    Error(
                      "Missing " +
                        type +
                        "; seen " +
                        history.map((m) => m.type).join(","),
                    ),
                  ),
                3000,
              ),
            };
            waiting.push(w);
          });
        },
      };
    }
    const key = "new-" + crypto.randomUUID();
    const document = {
      title: "Private recoverable draft",
      description: "Not official",
      music: "",
      rounds: [
        {
          title: "",
          questions: [
            {
              type: "choice",
              text: "",
              options: ["", ""],
              correct: -1,
              seconds: 20,
              points: 1000,
              notes: "private draft note",
              media: "",
              mediaType: "",
            },
          ],
        },
      ],
    };
    let version;
    try {
      await start();
      assert.equal(
        (
          await req("/api/setup", "POST", {
            email: "studio@example.test",
            password,
            organization: "Studio tests",
          })
        ).status,
        201,
      );
      owner = (
        await req("/api/login", "POST", {
          email: "studio@example.test",
          password,
        })
      ).cookie;
      const invite = (
        await req("/api/invitations", "POST", {}, owner)
      ).value.path.split("#")[1];
      friend = (
        await req("/api/invitations/redeem", "POST", {
          invite,
          email: "friend@studio.test",
          password,
          organization: "Friend",
        })
      ).cookie;
      await t.test(
        "drafts are authenticated, owner isolated and not official quizzes",
        async () => {
          const before = (await req("/api/quizzes", "GET", undefined, owner))
            .value;
          assert.equal((await req("/api/editor-drafts")).status, 401);
          const saved = await req(
            "/api/editor-drafts/" + key,
            "PUT",
            { version: 0, document },
            owner,
          );
          assert.equal(saved.status, 200);
          version = saved.value.version;
          assert.ok(Number.isSafeInteger(version));
          assert.equal(
            (await req("/api/editor-drafts/" + key, "GET", undefined, friend))
              .status,
            404,
          );
          assert.deepEqual(
            (await req("/api/editor-drafts", "GET", undefined, friend)).value,
            [],
          );
          assert.deepEqual(
            (await req("/api/quizzes", "GET", undefined, owner)).value,
            before,
          );
          assert.equal(
            (
              await req(
                "/api/editor-drafts/" + key,
                "PUT",
                {
                  version: 0,
                  document: { ...document, title: "Friend same key" },
                },
                friend,
              )
            ).status,
            200,
          );
          assert.equal(
            (await req("/api/editor-drafts/" + key, "GET", undefined, owner))
              .value.document.title,
            document.title,
          );
        },
      );
      await t.test(
        "draft compare-and-swap rejects stale tabs, stale delete and delete/recreate ABA",
        async () => {
          const attempts = await Promise.all(
            ["Tab A", "Tab B"].map((title) =>
              req(
                "/api/editor-drafts/" + key,
                "PUT",
                { version, document: { ...document, title } },
                owner,
              ),
            ),
          );
          assert.deepEqual(attempts.map((x) => x.status).sort(), [200, 409]);
          assert.equal(
            (
              await req(
                "/api/editor-drafts/" + key,
                "DELETE",
                { version },
                owner,
              )
            ).status,
            409,
          );
          version = attempts.find((x) => x.status === 200).value.version;
          assert.equal(
            (
              await req(
                "/api/editor-drafts/" + key,
                "DELETE",
                { version },
                owner,
              )
            ).status,
            200,
          );
          const again = await req(
            "/api/editor-drafts/" + key,
            "PUT",
            { version: 0, document },
            owner,
          );
          assert.equal(again.status, 200);
          assert.notEqual(again.value.version, version);
          assert.equal(
            (
              await req(
                "/api/editor-drafts/" + key,
                "PUT",
                { version, document },
                owner,
              )
            ).status,
            409,
          );
          version = again.value.version;
        },
      );
      await t.test(
        "malformed/oversized editor data fails without poisoning recovery",
        async () => {
          for (const patch of [
            { mediaType: {} },
            { seconds: '\"><img src=x onerror=alert(1)>' },
            { options: {} },
            { correctAnswers: [{}] },
            { notes: {} },
            { accepted: [{}] },
          ]) {
            const bad = structuredClone(document);
            Object.assign(bad.rounds[0].questions[0], patch);
            assert.equal(
              (
                await req(
                  "/api/editor-drafts/" + key,
                  "PUT",
                  { version, document: bad },
                  owner,
                )
              ).status,
              400,
            );
          }
          for (const patch of [
            { _importReport: {} },
            { title: "x".repeat(121) },
            { description: [] },
            { _revision: {} },
            {
              rounds: [
                {
                  title: "",
                  questions: Array(201).fill(document.rounds[0].questions[0]),
                },
              ],
            },
            { extra: "x".repeat(500001) },
          ])
            assert.equal(
              (
                await req(
                  "/api/editor-drafts/" + key,
                  "PUT",
                  { version, document: { ...document, ...patch } },
                  owner,
                )
              ).status,
              400,
            );
          const badMedia = structuredClone(document);
          badMedia.rounds[0].questions[0].media =
            "/media/" + crypto.randomUUID();
          assert.equal(
            (
              await req(
                "/api/editor-drafts/" + key,
                "PUT",
                { version, document: badMedia },
                owner,
              )
            ).status,
            400,
          );
          assert.deepEqual(
            (await req("/api/editor-drafts/" + key, "GET", undefined, owner))
              .value.document,
            document,
          );
        },
      );
      await t.test(
        "private recovery survives process restart and enforces 20-draft quota",
        async () => {
          await stop();
          await start();
          assert.equal(
            (await req("/api/editor-drafts/" + key, "GET", undefined, owner))
              .value.version,
            version,
          );
          const extra = [];
          for (let i = 0; i < 19; i++) {
            const k = "new-" + crypto.randomUUID();
            const r = await req(
              "/api/editor-drafts/" + k,
              "PUT",
              { version: 0, document },
              owner,
            );
            assert.equal(r.status, 200);
            extra.push([k, r.value.version]);
          }
          assert.equal(
            (
              await req(
                "/api/editor-drafts/new-" + crypto.randomUUID(),
                "PUT",
                { version: 0, document },
                owner,
              )
            ).status,
            409,
          );
          for (const [k, v] of extra)
            assert.equal(
              (
                await req(
                  "/api/editor-drafts/" + k,
                  "DELETE",
                  { version: v },
                  owner,
                )
              ).status,
              200,
            );
        },
      );
      await t.test(
        "version-3 backup includes only the owner’s drafts; versions 2 and 3 restore",
        async () => {
          const result = await req("/api/backup", "POST", { password }, owner);
          assert.equal(result.status, 200);
          const zip = path.join(dir, "backup.zip");
          fs.writeFileSync(zip, result.value);
          const extraction = path.join(dir, "extracted");
          fs.mkdirSync(extraction);
          execFileSync("unzip", ["-q", zip, "-d", extraction]);
          const snapshot = JSON.parse(
            fs.readFileSync(path.join(extraction, "database.json")),
          );
          assert.equal(snapshot.version, 3);
          assert.equal(snapshot.tables.editor_drafts.length, 1);
          assert.equal(
            JSON.parse(snapshot.tables.editor_drafts[0].document).title,
            document.title,
          );
          assert.ok(!JSON.stringify(snapshot).includes("friend@studio.test"));
          for (const v of [3, 2]) {
            const copy = structuredClone(snapshot);
            copy.version = v;
            if (v === 2) delete copy.tables.editor_drafts;
            fs.writeFileSync(
              path.join(extraction, "database.json"),
              JSON.stringify(copy),
            );
            const dataDir = path.join(dir, "restore" + v);
            execFileSync(process.execPath, ["scripts/restore.js", extraction], {
              cwd: root,
              env: { ...env, DATABASE_URL: "", DATA_DIR: dataDir },
              stdio: "pipe",
            });
            const db = new (require("better-sqlite3"))(
              path.join(dataDir, "quizzes.sqlite"),
            );
            assert.equal(
              db.prepare("SELECT COUNT(*) n FROM editor_drafts").get().n,
              v === 3 ? 1 : 0,
            );
            db.close();
          }
        },
      );
      await t.test(
        "official Save uses revision preconditions, independently of private drafts",
        async () => {
          const saved = await req(
            "/api/quizzes",
            "POST",
            {
              title: "Professional test room",
              description: "",
              rounds: [
                {
                  title: "First",
                  questions: [
                    {
                      type: "choice",
                      text: "Current question",
                      options: ["One", "Two"],
                      correct: 0,
                      seconds: 30,
                      points: 1000,
                      notes: "SECRET HOST NOTE",
                    },
                    {
                      type: "choice",
                      text: "SECRET UPCOMING QUESTION",
                      options: ["Next one", "Next two"],
                      correct: 1,
                      seconds: 30,
                      points: 1000,
                      notes: "SECRET NEXT NOTE",
                    },
                  ],
                },
              ],
            },
            owner,
          );
          assert.equal(saved.status, 201);
          official = saved.value;
          assert.equal(official._revision, 1);
          const changed = await req(
            "/api/quizzes/" + official.id,
            "PUT",
            { ...official, title: "Updated official" },
            owner,
            { "If-Match": '"1"' },
          );
          assert.equal(changed.status, 200);
          assert.equal(changed.value._revision, 2);
          assert.equal(
            (
              await req("/api/quizzes/" + official.id, "PUT", official, owner, {
                "If-Match": '"1"',
              })
            ).status,
            409,
          );
          assert.equal(
            (
              await req(
                "/api/editor-drafts/" + official.id,
                "PUT",
                { version: 0, document: official },
                friend,
              )
            ).status,
            404,
          );
          official = changed.value;
        },
      );
      await t.test(
        "projector is read-only, excludes private/future data and reconnects publicly",
        async () => {
          const host = await connect(owner);
          host.send("create_game", { quizId: official.id });
          const made = await host.wait("game_created");
          const consoleData = await host.wait("host_console");
          const code = made.game.code;
          assert.ok(consoleData.displayToken);
          assert.equal(consoleData.next.text, "Current question");
          const invalid = await connect();
          invalid.send("join_display", { code, displayToken: "0".repeat(64) });
          assert.match(
            (await invalid.wait("error")).message,
            /Display link unavailable/,
          );
          invalid.ws.close();
          const display = await connect();
          display.send("join_display", {
            code,
            displayToken: consoleData.displayToken,
          });
          const joined = await display.wait("display_joined");
          assert.equal(joined.game.participants.length, 0);
          for (const type of [
            "start_question",
            "set_music",
            "submit_answer",
            "refresh_images",
          ]) {
            display.send(type, { playing: false, volume: 0, answer: 0 });
            assert.match((await display.wait("error")).message, /read-only/);
          }
          const player = await connect();
          player.send("join_game", { code, name: "Actual test participant" });
          await player.wait("joined");
          host.send("start_question");
          const active = await display.wait("question_started");
          await player.wait("question_started");
          const secret = await host.wait("host_console");
          assert.equal(secret.currentNotes, "SECRET HOST NOTE");
          assert.equal(secret.next.text, "SECRET UPCOMING QUESTION");
          assert.ok(active.game.deadline > Date.now());
          for (const peer of [display, player]) {
            const data = JSON.stringify(peer.history);
            assert.ok(!data.includes("SECRET"));
            assert.ok(!data.includes(consoleData.displayToken));
            assert.ok(!data.includes(made.hostToken));
            assert.ok(!data.includes("host_console"));
          }
          display.ws.close();
          await once(display.ws, "close");
          const reconnected = await connect();
          reconnected.send("join_display", {
            code,
            displayToken: consoleData.displayToken,
          });
          const resumed = await reconnected.wait("display_joined");
          assert.equal(resumed.question.text, "Current question");
          assert.equal(resumed.game.deadline, active.game.deadline);
          assert.ok(!JSON.stringify(resumed).includes("SECRET"));
          host.send("reveal_answers");
          assert.equal(
            (await reconnected.wait("question_ended")).correct,
            "One",
          );
          host.send("end_game");
          await host.wait("game_ended");
          const closed = once(reconnected.ws, "close");
          assert.equal(
            (await req("/api/logout", "POST", {}, owner)).status,
            200,
          );
          await closed;
          const revoked = await connect();
          revoked.send("join_display", {
            code,
            displayToken: consoleData.displayToken,
          });
          assert.match(
            (await revoked.wait("error")).message,
            /Display link unavailable/,
          );
          owner = (
            await req("/api/login", "POST", {
              email: "studio@example.test",
              password,
            })
          ).cookie;
        },
      );
      await t.test(
        "current-image reports are diagnostic only and do not postpone questions or alter points",
        async () => {
          const response = await fetch(origin + "/api/media", {
            method: "POST",
            headers: {
              Origin: origin,
              Cookie: owner,
              "Content-Type": "image/png",
            },
            body: Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
              "base64",
            ),
          });
          const uploaded = {
            status: response.status,
            value: await response.json(),
          };
          assert.equal(uploaded.status, 201);
          const withMedia = structuredClone(document);
          withMedia.rounds[0].questions[0].media = uploaded.value.url;
          withMedia.rounds[0].questions[0].mediaType = "image/png";
          const mediaDraft = await req(
            "/api/editor-drafts/" + key,
            "PUT",
            { version, document: withMedia },
            owner,
          );
          assert.equal(mediaDraft.status, 200);
          version = mediaDraft.value.version;
          assert.equal(
            (
              await req(
                "/api/editor-drafts/" + key,
                "PUT",
                { version: 0, document: withMedia },
                friend,
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await req(
                "/api/editor-drafts/" + key,
                "PUT",
                {
                  version,
                  document: { ...withMedia, music: uploaded.value.url },
                },
                owner,
              )
            ).status,
            400,
          );

          const doc = structuredClone(official);
          doc.rounds[0].questions.forEach((q) => {
            q.media = uploaded.value.url;
            q.mediaType = "image/png";
          });
          const update = await req(
            "/api/quizzes/" + official.id,
            "PUT",
            doc,
            owner,
            { "If-Match": '"2"' },
          );
          assert.equal(update.status, 200);
          const host = await connect(owner);
          host.send("create_game", { quizId: official.id });
          const made = await host.wait("game_created");
          await host.wait("host_console");
          const p = await connect();
          p.send("join_game", { code: made.game.code, name: "Image tester" });
          await p.wait("joined");
          const began = Date.now();
          host.send("start_question");
          const q = await p.wait("question_started");
          assert.ok(Date.now() - began < 2000);
          const deadline = q.game.deadline;
          await host.wait("host_console");
          p.send("image_status", {
            questionId: q.question.id,
            state: "ready",
            elapsedMs: 5100,
          });
          const metrics = await host.wait("host_console");
          assert.deepEqual(metrics.image, {
            ready: 1,
            failed: 0,
            slow: 1,
            reported: 1,
          });
          p.send("submit_answer", { questionId: q.question.id, answer: 0 });
          await p.wait("answer_received");
          host.send("reveal_answers");
          const ended = await p.wait("question_ended");
          assert.equal(ended.game.deadline, deadline);
          assert.ok(ended.leaderboard[0].score > 900);
          host.send("next_question");
          const notice = await p.wait("last_question_intro");
          assert.equal(notice.game.deadline, null);
          assert.equal(notice.question, undefined);
          host.send("next_question");
          const next = await p.wait("question_started");
          const reset = await host.wait("host_console");
          assert.equal(reset.image.reported, 0);
          p.send("image_status", {
            questionId: q.question.id,
            state: "ready",
            elapsedMs: 1,
          });
          p.send("image_status", {
            questionId: next.question.id,
            state: "ready",
            elapsedMs: -1,
          });
          p.send("image_status", {
            questionId: next.question.id,
            state: "error",
            elapsedMs: 42,
          });
          const last = await host.wait("host_console");
          assert.deepEqual(last.image, {
            ready: 0,
            failed: 1,
            slow: 0,
            reported: 1,
          });
          host.send("end_game");
          await host.wait("game_ended");
        },
      );
      await t.test(
        "projector capacity, session replacement and exact expiry are enforced",
        async () => {
          const host = await connect(owner);
          host.send("create_game", { quizId: official.id });
          const made = await host.wait("game_created");
          const info = await host.wait("host_console");
          const displays = [];
          for (let i = 0; i < 4; i++) {
            const d = await connect();
            d.send("join_display", {
              code: made.game.code,
              displayToken: info.displayToken,
            });
            await d.wait("display_joined");
            displays.push(d);
          }
          const excess = await connect();
          excess.send("join_display", {
            code: made.game.code,
            displayToken: info.displayToken,
          });
          assert.match((await excess.wait("error")).message, /four projector/);
          excess.ws.close();
          const nextSession = (
            await req("/api/login", "POST", {
              email: "studio@example.test",
              password,
            })
          ).cookie;
          const closed = displays.map((d) => once(d.ws, "close"));
          const replacement = await connect(nextSession);
          replacement.send("resume_host", {
            code: made.game.code,
            hostToken: made.hostToken,
          });
          await replacement.wait("host_resumed");
          await Promise.all(closed);
          // Shorten the isolated test session; no application/production test hook.
          const digest = crypto
            .createHash("sha256")
            .update(
              decodeURIComponent(
                nextSession.slice(nextSession.indexOf("=") + 1),
              ),
            )
            .digest("hex");
          if (database) {
            const client = new (require("pg").Client)({
              connectionString: database,
            });
            await client.connect();
            await client.query(
              "UPDATE quizzes_private.sessions SET expires=$1 WHERE token=$2",
              [Date.now() + 1200, digest],
            );
            await client.end();
          } else {
            const sqlite = new (require("better-sqlite3"))(
              path.join(dir, "quizzes.sqlite"),
            );
            sqlite
              .prepare("UPDATE sessions SET expires=? WHERE token=?")
              .run(Date.now() + 1200, digest);
            sqlite.close();
          }
          const fresh = await connect();
          fresh.send("join_display", {
            code: made.game.code,
            displayToken: info.displayToken,
          });
          await fresh.wait("display_joined");
          await req("/api/logout", "POST", {}, owner);
          fresh.send("ping");
          await fresh.wait("clock");
          const expired = await once(fresh.ws, "close");
          assert.equal(expired[0], 4001);
          const blocked = await connect();
          blocked.send("join_display", {
            code: made.game.code,
            displayToken: info.displayToken,
          });
          assert.match(
            (await blocked.wait("error")).message,
            /Display link unavailable/,
          );
          owner = (
            await req("/api/login", "POST", {
              email: "studio@example.test",
              password,
            })
          ).cookie;
        },
      );
    } finally {
      for (const ws of sockets) ws.terminate();
      await stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
