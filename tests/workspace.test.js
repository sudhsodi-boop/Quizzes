const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");
const { once } = require("node:events");
const WS = require("ws");
const { grade, roundLabel } = require("../quiz-rules");
test("multi-answer partial credit is bounded, penalizes wrong selections and rejects duplicates", () => {
  const q = {
    type: "multi",
    options: ["A", "B", "C", "D"],
    correctAnswers: [0, 2],
  };
  assert.equal(grade(q, [0, 2]), 1);
  assert.equal(grade(q, [0]), 0.5);
  assert.equal(grade(q, [0, 1]), 0);
  assert.equal(grade(q, [0, 1, 2]), 0.5);
  assert.equal(grade(q, [0, 1, 2, 3]), 0);
  assert.equal(grade(q, [1]), 0);
  assert.throws(() => grade(q, [0, 0]));
  assert.throws(() => grade(q, []));
  assert.throws(() => grade(q, [4]));
  assert.equal(roundLabel(1, ""), "Round 2");
  assert.equal(roundLabel(0, "Round 1: Easy"), "Round 1: Easy");
});
test(
  "private workspaces, host-only controls and persistent 24-hour attempts",
  { timeout: 60000 },
  async (t) => {
    const root = path.join(__dirname, ".."),
      dir = fs.mkdtempSync(path.join(root, ".test-data-"));
    const origin = "http://localhost:4187";
    let child;
    const sockets = [];
    const database = process.env.WORKSPACE_TEST_DATABASE_URL || "";
    if (database && !new URL(database).pathname.startsWith("/quizzes_test"))
      throw Error("Only a dedicated test database is allowed.");
    async function start() {
      child = spawn(process.execPath, ["server.js"], {
        cwd: root,
        env: {
          ...process.env,
          PORT: "4187",
          DATA_DIR: dir,
          NODE_ENV: "test",
          ALLOW_SETUP: "true",
          RENDER: "",
          DATABASE_URL: database,
          DATABASE_TEST_NO_TLS: database ? "true" : "",
          SUPABASE_URL: "",
          SUPABASE_SERVICE_KEY: "",
          INITIAL_ADMIN_EMAIL: "",
          INITIAL_ADMIN_PASSWORD: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      await new Promise((resolve, reject) => {
        let log = "";
        const timer = setTimeout(
          () => reject(Error("Startup timeout: " + log)),
          10000,
        );
        child.stdout.on("data", (b) => {
          log += b;
          if (log.includes("listening")) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.stderr.on("data", (b) => (log += b));
        child.once("exit", () => {
          clearTimeout(timer);
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
    async function req(url, method = "GET", body, cookie = "") {
      const res = await fetch(origin + url, {
        method,
        headers: {
          Origin: origin,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body:
          body === undefined
            ? undefined
            : Buffer.isBuffer(body)
              ? body
              : JSON.stringify(body),
      });
      const value = (res.headers.get("content-type") || "").includes(
        "application/json",
      )
        ? await res.json()
        : Buffer.from(await res.arrayBuffer());
      return {
        res,
        value,
        cookie: res.headers.get("set-cookie")?.split(";")[0],
      };
    }
    async function socket(cookie = "") {
      const ws = new WS(origin.replace("http", "ws") + "/live", {
        origin,
        headers: { Cookie: cookie },
      });
      const inbox = [],
        listeners = [];
      sockets.push(ws);
      ws.on("message", (b) => {
        const message = JSON.parse(b);
        const i = listeners.findIndex((l) => l.type === message.type);
        if (i >= 0) {
          const item = listeners.splice(i, 1)[0];
          clearTimeout(item.timer);
          item.resolve(message);
        } else inbox.push(message);
      });
      await once(ws, "open");
      return {
        ws,
        send: (type, data = {}) => ws.send(JSON.stringify({ type, ...data })),
        wait: (type) => {
          const i = inbox.findIndex((m) => m.type === type);
          if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
          return new Promise((resolve, reject) => {
            const l = {
              type,
              resolve,
              timer: setTimeout(() => reject(Error("Missing " + type)), 5000),
            };
            listeners.push(l);
          });
        },
      };
    }
    let owner,
      friend,
      quizId,
      media,
      pub,
      visitor,
      host,
      player,
      code,
      hostToken;
    const password = crypto.randomBytes(20).toString("hex");
    const quiz = {
      title: "Owner private quiz",
      description: "Isolation fixture",
      music: "",
      rounds: [
        {
          title: "Easy",
          questions: [
            {
              type: "multi",
              text: "Choose prime numbers",
              options: ["2", "4", "3", "6"],
              correctAnswers: [0, 2],
              seconds: 30,
              points: 1000,
              media: "",
            },
          ],
        },
        {
          title: "",
          questions: [
            {
              type: "boolean",
              text: "The sky is blue.",
              correct: 0,
              seconds: 30,
              points: 1000,
              media: "",
            },
          ],
        },
      ],
    };
    try {
      await start();
      await req("/api/setup", "POST", {
        email: "owner@private.test",
        password,
        organization: "Owner",
      });
      owner = (
        await req("/api/login", "POST", {
          email: "owner@private.test",
          password,
        })
      ).cookie;
      await t.test(
        "invitations are one-use and friends start with an empty private workspace",
        async () => {
          const inv = await req("/api/invitations", "POST", {}, owner);
          assert.equal(inv.res.status, 201);
          const invite = inv.value.path.split("#")[1];
          const redeemed = await req("/api/invitations/redeem", "POST", {
            invite,
            email: "friend@private.test",
            password,
            organization: "Friend",
          });
          assert.equal(redeemed.res.status, 201);
          friend = redeemed.cookie;
          assert.equal(
            (
              await req("/api/invitations/redeem", "POST", {
                invite,
                email: "second@private.test",
                password,
                organization: "Other",
              })
            ).res.status,
            400,
          );
          assert.deepEqual(
            (await req("/api/quizzes", "GET", undefined, friend)).value,
            [],
          );
          assert.ok(
            (await req("/api/quizzes", "GET", undefined, owner)).value.length >
              0,
          );
        },
      );
      await t.test(
        "quiz, media, publication and websocket ownership is enforced",
        async () => {
          const png = Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6sGkAAAAASUVORK5CYII=",
            "base64",
          );
          media = (await req("/api/media", "POST", png, owner)).value.url;
          assert.equal(
            (await req(media, "GET", undefined, friend)).res.status,
            404,
          );
          assert.equal((await req(media)).res.status, 404);
          assert.equal(
            (await req(media, "GET", undefined, owner)).res.status,
            200,
          );
          quiz.rounds[0].questions[0].media = media;
          const saved = await req("/api/quizzes", "POST", quiz, owner);
          assert.equal(saved.res.status, 201);
          quizId = saved.value.id;
          assert.equal(
            (await req("/api/quizzes", "POST", quiz, friend)).res.status,
            400,
          );
          assert.equal(
            (await req("/api/quizzes/" + quizId, "PUT", quiz, friend)).res
              .status,
            404,
          );
          assert.equal(
            (await req("/api/quizzes/" + quizId, "DELETE", undefined, friend))
              .res.status,
            404,
          );
          assert.equal(
            (await req("/api/publications", "POST", { quizId }, friend)).res
              .status,
            404,
          );
          const bad = await socket(friend);
          bad.send("create_game", { quizId });
          assert.match((await bad.wait("error")).message, /saved quiz/);
          bad.ws.close();
          pub = (await req("/api/publications", "POST", { quizId }, owner))
            .value;
          assert.ok(pub.closes - Date.now() > 23.9 * 60 * 60 * 1000);
          assert.deepEqual(
            (await req("/api/publications", "GET", undefined, friend)).value,
            [],
          );
          assert.equal(
            (
              await req(
                "/api/publications/" + pub.id + "/results",
                "GET",
                undefined,
                friend,
              )
            ).res.status,
            404,
          );
        },
      );
      await t.test(
        "only the host can control music/leaderboards; round transitions preserve scoring",
        async () => {
          host = await socket(owner);
          host.send("create_game", { quizId });
          const room = await host.wait("game_created");
          code = room.game.code;
          hostToken = room.hostToken;
          player = await socket();
          player.send("join_game", { code, name: "Live participant" });
          await player.wait("joined");
          player.send("set_music", { playing: false, volume: 0 });
          assert.match((await player.wait("error")).message, /not available/);
          player.send("set_leaderboard", { visible: true });
          await player.wait("error");
          host.send("set_music", { playing: false, volume: 0.2 });
          assert.deepEqual((await player.wait("music_control")).musicState, {
            playing: false,
            volume: 0.2,
          });
          host.send("next_question");
          const started = await player.wait("question_started");
          assert.equal(started.question.type, "multi");
          assert.equal(started.question.lastInRound, true);
          assert.equal(started.question.roundLabel, "Round 1: Easy");
          assert.equal(started.question.correctAnswers, undefined);
          assert.equal((await req(started.question.media)).res.status, 200);
          assert.equal(
            (
              await req(
                started.question.media.replace(
                  /grant=[^&]+/,
                  "grant=" + "0".repeat(64),
                ),
              )
            ).res.status,
            404,
          );
          player.send("submit_answer", {
            questionId: started.question.id,
            answer: [0],
          });
          await player.wait("answer_received");
          host.send("reveal_answers");
          const result = await player.wait("question_ended");
          assert.equal(result.roundEnded, true);
          assert.equal(result.leaderboardVisible, true);
          assert.ok(
            result.leaderboard[0].score > 0 &&
              result.leaderboard[0].score <= 500,
          );
          host.send("set_leaderboard", { visible: false });
          assert.equal(
            (await player.wait("leaderboard_control")).visible,
            false,
          );
          host.send("next_question");
          assert.equal(
            (await player.wait("round_intro")).game.upcomingRound,
            "Round 2",
          );
          host.send("next_question");
          await player.wait("question_started");
          host.send("set_leaderboard", { visible: true });
          assert.equal(
            (await player.wait("leaderboard_control")).visible,
            true,
          );
          const late = await socket();
          late.send("join_game", { code, name: "Late viewer" });
          const lateState = await late.wait("joined");
          assert.equal(lateState.game.leaderboardVisible, true);
          assert.ok(lateState.visibleLeaderboard.some((p) => p.score > 0));
          assert.deepEqual(lateState.game.musicState, {
            playing: false,
            volume: 0.2,
          });
          late.send("refresh_music");
          assert.equal((await late.wait("music_refreshed")).music, "");
          host.send("end_game");
          await player.wait("game_ended");
          assert.equal(
            (await req("/api/reports", "GET", undefined, friend)).value.length,
            0,
          );
          assert.equal(
            (await req("/api/reports", "GET", undefined, owner)).value.length,
            1,
          );
        },
      );
      await t.test(
        "published progress survives restart and duplicate submissions are rejected",
        async () => {
          const initial = await req("/api/published/" + pub.id);
          visitor = initial.cookie;
          assert.ok(visitor);
          assert.equal(initial.value.question, undefined);
          assert.equal(initial.value.solutions, undefined);
          const join = await req(
            "/api/published/" + pub.id + "/join",
            "POST",
            { name: "Async participant" },
            visitor,
          );
          assert.equal(join.value.question.correctAnswers, undefined);
          assert.equal(join.value.attempt.score, undefined);
          const responses = await Promise.all([
            req(
              "/api/published/" + pub.id + "/answer",
              "POST",
              { index: 0, answer: [0] },
              visitor,
            ),
            req(
              "/api/published/" + pub.id + "/answer",
              "POST",
              { index: 0, answer: [0, 2] },
              visitor,
            ),
          ]);
          assert.deepEqual(
            responses.map((r) => r.res.status).sort(),
            [200, 409],
          );
          assert.equal(
            (
              await req(
                "/api/published/" + pub.id + "/join",
                "POST",
                { name: "Another name" },
                visitor,
              )
            ).value.attempt.name,
            "Async participant",
          );
          for (const ws of sockets) ws.close();
          await stop();
          await start();
          const resume = await req(
            "/api/published/" + pub.id,
            "GET",
            undefined,
            visitor,
          );
          assert.equal(resume.value.question.index, 1);
          assert.equal(resume.value.attempt.score, undefined);
          assert.equal(resume.value.solutions, undefined);
          const finish = await req(
            "/api/published/" + pub.id + "/answer",
            "POST",
            { index: 1, answer: 0 },
            visitor,
          );
          assert.equal(finish.value.attempt.completed, true);
          assert.equal(finish.value.solutions, undefined);
          assert.equal(finish.value.attempt.score, undefined);
          assert.equal(
            (
              await req(
                "/api/published/" + pub.id + "/answer",
                "POST",
                { index: 1, answer: 0 },
                visitor,
              )
            ).res.status,
            409,
          );
        },
      );
      await t.test(
        "closing releases only the visitor’s answers and blocks later joins/submissions",
        async () => {
          await req(
            "/api/publications/" + pub.id + "/close",
            "POST",
            {},
            owner,
          );
          const closed = await req(
            "/api/published/" + pub.id,
            "GET",
            undefined,
            visitor,
          );
          assert.equal(closed.value.closed, true);
          assert.equal(closed.value.solutions.length, 2);
          assert.ok(closed.value.attempt.score >= 1500);
          assert.equal(closed.value.solutions[0].correct, "2 + 3");
          assert.equal(
            (
              await req(
                "/api/published/" + pub.id + "/answer",
                "POST",
                { index: 1, answer: 0 },
                visitor,
              )
            ).res.status,
            409,
          );
          const stranger = await req("/api/published/" + pub.id);
          assert.equal(stranger.value.solutions, undefined);
          assert.equal(
            (
              await req(
                "/api/published/" + pub.id + "/join",
                "POST",
                { name: "Too late" },
                stranger.cookie,
              )
            ).res.status,
            409,
          );
          const result = (
            await req(
              "/api/publications/" + pub.id + "/results",
              "GET",
              undefined,
              owner,
            )
          ).value;
          assert.equal(result.closed, true);
          assert.equal(result.leaderboard.length, 1);
          assert.equal(result.leaderboard[0].name, "Async participant");
        },
      );
      await t.test(
        "workspace backups contain no other host accounts, content, reports or attempts",
        async () => {
          for (const [who, expected] of [
            [friend, 0],
            [owner, 1],
          ]) {
            const backup = await req("/api/backup", "POST", { password }, who);
            assert.equal(backup.res.status, 200);
            const file = path.join(dir, expected ? "owner.zip" : "friend.zip");
            fs.writeFileSync(file, backup.value);
            const saved = JSON.parse(
              execFileSync("unzip", ["-p", file, "database.json"], {
                encoding: "utf8",
              }),
            );
            assert.equal(saved.version, 2);
            assert.equal(saved.tables.admins.length, 1);
            assert.equal(saved.tables.publications.length, expected);
            assert.equal(saved.tables.attempts.length, expected);
            assert.equal(saved.tables.reports.length, expected);
            assert.equal(saved.tables.media.length, expected);
            assert.equal(saved.tables.invitations.length, 0);
            if (!expected) {
              assert.equal(saved.tables.quizzes.length, 0);
              assert.ok(!JSON.stringify(saved).includes("owner@private.test"));
            }
          }
        },
      );
      await t.test(
        "natural deadlines and invitation expiry are enforced without scheduled jobs",
        async () => {
          async function update(sql, args) {
            if (database) {
              const c = new (require("pg").Client)({
                connectionString: database,
              });
              await c.connect();
              let i = 0;
              await c.query(
                sql.replace(/\?/g, () => "$" + ++i),
                args,
              );
              await c.end();
            } else {
              const db = new (require("better-sqlite3"))(
                path.join(dir, "quizzes.sqlite"),
              );
              db.prepare(sql.replaceAll("quizzes_private.", "")).run(...args);
              db.close();
            }
          }
          const expiredPub = (
            await req("/api/publications", "POST", { quizId }, owner)
          ).value;
          await req(
            "/api/published/" + expiredPub.id + "/join",
            "POST",
            { name: "Incomplete" },
            visitor,
          );
          await req(
            "/api/published/" + expiredPub.id + "/answer",
            "POST",
            { index: 0, answer: [0] },
            visitor,
          );
          await update(
            "UPDATE quizzes_private.publications SET closes=? WHERE id=?",
            [Date.now() - 1, expiredPub.id],
          );
          const expired = (
            await req(
              "/api/published/" + expiredPub.id,
              "GET",
              undefined,
              visitor,
            )
          ).value;
          assert.equal(expired.closed, true);
          assert.equal(expired.attempt.score, 500);
          assert.equal(expired.solutions.length, 2);
          assert.equal(
            (
              await req(
                "/api/published/" + expiredPub.id + "/answer",
                "POST",
                { index: 1, answer: 0 },
                visitor,
              )
            ).res.status,
            409,
          );
          const invitation = (
            await req("/api/invitations", "POST", {}, owner)
          ).value.path.split("#")[1];
          await update(
            "UPDATE quizzes_private.invitations SET expires=? WHERE digest=?",
            [
              Date.now() - 1,
              crypto.createHash("sha256").update(invitation).digest("hex"),
            ],
          );
          assert.equal(
            (
              await req("/api/invitations/redeem", "POST", {
                invite: invitation,
                email: "late@private.test",
                password,
                organization: "Late",
              })
            ).res.status,
            400,
          );
        },
      );
    } finally {
      for (const ws of sockets) ws.terminate();
      await stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
