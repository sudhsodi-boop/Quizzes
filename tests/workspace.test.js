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
          SITE_ADMIN_EMAIL: "owner@private.test",
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
    async function req(
      url,
      method = "GET",
      body,
      cookie = "",
      extraHeaders = {},
    ) {
      const res = await fetch(origin + url, {
        method,
        headers: {
          Origin: origin,
          ...extraHeaders,
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
          const notice = await player.wait("last_question_intro");
          assert.equal(notice.game.deadline, null);
          assert.equal(notice.game.upcomingRound, "Round 1: Easy");
          assert.equal(notice.question, undefined);
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
          await player.wait("last_question_intro");
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
          assert.equal(join.value.attempt.score, 0);
          assert.deepEqual(join.value.solutions, []);
          assert.equal(join.value.leaderboard, undefined);
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
          assert.ok(resume.value.attempt.score >= 500);
          assert.equal(resume.value.solutions.length, 1);
          assert.equal(resume.value.solutions[0].correct, "2 + 3");
          assert.equal(resume.value.question.correct, undefined);
          assert.equal(resume.value.leaderboard, undefined);
          const finish = await req(
            "/api/published/" + pub.id + "/answer",
            "POST",
            { index: 1, answer: 0 },
            visitor,
          );
          assert.equal(finish.value.attempt.completed, true);
          assert.equal(finish.value.solutions.length, 2);
          assert.ok(finish.value.attempt.score >= 1500);
          assert.equal(finish.value.leaderboard.length, 1);
          assert.deepEqual(Object.keys(finish.value.leaderboard[0]).sort(), [
            "isYou",
            "name",
            "rank",
            "score",
          ]);
          assert.equal(finish.value.leaderboard[0].isYou, true);
          assert.equal(finish.value.leaderboard[0].rank, 1);
          assert.equal(
            (await req("/api/published/" + pub.id)).value.leaderboard,
            undefined,
          );
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
            assert.equal(saved.version, 3);
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
      await t.test(
        "designated admin full-Studio edits are scoped, revision-checked and never available to friends",
        async () => {
          assert.equal(
            (await req("/api/session", "GET", undefined, owner)).value.user
              .isSiteAdmin,
            true,
          );
          assert.equal(
            (await req("/api/session", "GET", undefined, friend)).value.user
              .isSiteAdmin,
            false,
          );
          assert.equal(
            (await req("/api/oversight/workspaces")).res.status,
            401,
          );
          assert.equal(
            (await req("/api/oversight/workspaces", "GET", undefined, friend))
              .res.status,
            403,
          );
          const friendId = (await req("/api/session", "GET", undefined, friend))
            .value.user.id;
          const wav = Buffer.alloc(8044);
          wav.write("RIFF");
          wav.writeUInt32LE(8036, 4);
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
          const friendMusic = (await req("/api/media", "POST", wav, friend))
            .value.url;
          const fq = JSON.parse(JSON.stringify(quiz));
          fq.title = "Friend-only quiz";
          fq.music = friendMusic;
          fq.rounds[0].questions[0].media = "";
          const saved = (await req("/api/quizzes", "POST", fq, friend)).value;
          const fp = (
            await req("/api/publications", "POST", { quizId: saved.id }, friend)
          ).value;
          const live = await socket(friend);
          live.send("create_game", { quizId: saved.id });
          await live.wait("game_created");
          live.send("end_game");
          await live.wait("game_ended");
          const view = (
            await req(
              "/api/oversight/workspaces/" + friendId,
              "GET",
              undefined,
              owner,
            )
          ).value;
          assert.equal(view.quizzes[0].title, "Friend-only quiz");
          assert.equal(view.reports.length, 1);
          assert.equal(view.publications.length, 1);
          assert.equal(view.owner.password, undefined);
          assert.equal(
            (await req(friendMusic, "GET", undefined, owner)).res.status,
            200,
          );
          assert.equal(
            (
              await req(
                "/api/publications/" + fp.id + "/results",
                "GET",
                undefined,
                owner,
              )
            ).res.status,
            200,
          );
          assert.equal(
            (
              await req(
                "/api/publications/" + fp.id + "/close",
                "POST",
                {},
                owner,
              )
            ).res.status,
            404,
          );
          assert.equal(
            (
              await req(
                "/api/publications/" + fp.id + "/extend",
                "POST",
                { closes: fp.closes + 86400000 },
                owner,
              )
            ).res.status,
            404,
          );
          assert.equal(
            (
              await req(
                "/api/publications/" + fp.id,
                "DELETE",
                undefined,
                owner,
              )
            ).res.status,
            404,
          );
          assert.equal(
            (
              await req(
                "/api/reports/" + view.reports[0].id,
                "DELETE",
                undefined,
                owner,
              )
            ).res.status,
            404,
          );
          assert.equal(
            (await req("/api/quizzes/" + saved.id, "PUT", fq, owner)).res
              .status,
            404,
          );
          assert.equal(
            (
              await req(
                "/api/oversight/workspaces/" + friendId,
                "POST",
                {},
                owner,
              )
            ).res.status,
            405,
          );
          const editorPath =
            "/api/oversight/workspaces/" + friendId + "/quizzes/" + saved.id;
          const original = (await req(editorPath, "GET", undefined, owner))
            .value;
          assert.equal(original._oversightOwner, friendId);
          assert.equal(original.music, friendMusic);
          assert.equal(
            (await req(editorPath, "GET", undefined, friend)).res.status,
            403,
          );
          assert.equal(
            (
              await req(editorPath, "PUT", original, friend, {
                "If-Match": '"1"',
              })
            ).res.status,
            403,
          );
          assert.equal(
            (await req(editorPath, "PUT", original, owner)).res.status,
            428,
          );
          assert.equal(
            (await req(editorPath, "DELETE", undefined, owner)).res.status,
            405,
          );
          assert.equal(
            (await req("/api/quizzes/" + saved.id, "DELETE", undefined, owner))
              .res.status,
            404,
          );
          const adminId = (await req("/api/session", "GET", undefined, owner))
            .value.user.id;
          assert.equal(
            (
              await req(
                "/api/oversight/workspaces/" + adminId + "/quizzes/" + saved.id,
                "GET",
                undefined,
                owner,
              )
            ).res.status,
            404,
          );
          const media = await req(editorPath + "/media", "POST", wav, owner);
          assert.equal(media.res.status, 201);
          assert.equal(
            (await req(media.value.url, "GET", undefined, friend)).res.status,
            200,
          );
          assert.equal(
            (await req(editorPath + "/media", "POST", wav, friend)).res.status,
            403,
          );
          const pending = {
            ...original,
            title: "Admin revised friend quiz",
            music: media.value.url,
          };
          const adminDraft = await req(
            "/api/editor-drafts/" + saved.id,
            "PUT",
            { version: 0, document: pending },
            owner,
          );
          assert.equal(adminDraft.res.status, 200);
          assert.equal(
            (
              await req(
                "/api/editor-drafts/" + saved.id,
                "GET",
                undefined,
                friend,
              )
            ).res.status,
            404,
          );
          assert.equal(
            (
              await req(
                "/api/editor-drafts/" + saved.id,
                "PUT",
                { version: 0, document: pending },
                friend,
              )
            ).res.status,
            403,
          );
          assert.equal(
            (await req("/api/quizzes", "GET", undefined, friend)).value.find(
              (q) => q.id === saved.id,
            ).title,
            "Friend-only quiz",
          );
          const updated = await req(
            editorPath,
            "PUT",
            { ...pending, _lastAdminEdit: { email: "spoofed" } },
            owner,
            { "If-Match": '"1"' },
          );
          assert.equal(updated.res.status, 200);
          assert.equal(updated.value._revision, 2);
          assert.equal(
            updated.value._lastAdminEdit.email,
            "owner@private.test",
          );
          assert.equal(updated.value._oversightOwner, undefined);
          assert.equal(
            (await req("/api/quizzes", "GET", undefined, friend)).value.find(
              (q) => q.id === saved.id,
            ).title,
            "Admin revised friend quiz",
          );
          assert.equal(
            (
              await req(editorPath, "PUT", pending, owner, {
                "If-Match": '"1"',
              })
            ).res.status,
            409,
          );
          assert.equal(
            (
              await req("/api/quizzes/" + saved.id, "PUT", original, friend, {
                "If-Match": '"1"',
              })
            ).res.status,
            409,
          );
          // An owner save keeps the truthful last-admin-edit stamp and original ownership.
          assert.equal(
            (
              await req(
                "/api/quizzes/" + saved.id,
                "PUT",
                updated.value,
                friend,
                { "If-Match": '"2"' },
              )
            ).value._lastAdminEdit.email,
            "owner@private.test",
          );
          await req(
            "/api/editor-drafts/" + saved.id,
            "DELETE",
            { version: adminDraft.value.version },
            owner,
          );
          const guest = (await req("/api/published/" + fp.id)).value;
          assert.equal(guest.title, "Friend-only quiz");
          assert.match(guest.music, /grant=/);
          assert.equal((await req(guest.music)).res.status, 200);
          const ownList = (await req("/api/quizzes", "GET", undefined, owner))
            .value;
          assert.ok(!ownList.some((q) => q.id === saved.id));
          await req("/api/reports", "DELETE", undefined, owner);
          assert.equal(
            (await req("/api/reports", "GET", undefined, owner)).value.length,
            0,
          );
          assert.equal(
            (await req("/api/reports", "GET", undefined, friend)).value.length,
            1,
          );
          assert.equal(
            (
              await req(
                "/api/reports/" + view.reports[0].id,
                "DELETE",
                undefined,
                friend,
              )
            ).res.status,
            200,
          );
          assert.equal(
            (await req("/api/reports", "GET", undefined, friend)).value.length,
            0,
          );
        },
      );
      await t.test(
        "extensions retain attempts, reject reopening and serialize against closing; deletion is owner-scoped",
        async () => {
          const fresh = (
            await req("/api/publications", "POST", { quizId }, owner)
          ).value;
          await req(
            "/api/published/" + fresh.id + "/join",
            "POST",
            { name: "Keep my progress" },
            visitor,
          );
          await req(
            "/api/published/" + fresh.id + "/answer",
            "POST",
            { index: 0, answer: [0] },
            visitor,
          );
          assert.equal(
            (
              await req(
                "/api/publications/" + fresh.id + "/extend",
                "POST",
                { closes: fresh.closes + 86400000 },
                friend,
              )
            ).res.status,
            404,
          );
          assert.equal(
            (
              await req(
                "/api/publications/" + fresh.id + "/extend",
                "POST",
                { closes: fresh.closes - 1 },
                owner,
              )
            ).res.status,
            400,
          );
          assert.equal(
            (
              await req(
                "/api/publications/" + fresh.id + "/extend",
                "POST",
                { closes: Date.now() + 366 * 86400000 },
                owner,
              )
            ).res.status,
            400,
          );
          assert.equal(
            (
              await req(
                "/api/publications/" + fresh.id + "/extend",
                "POST",
                { closes: fresh.closes + 86400000 },
                owner,
              )
            ).res.status,
            200,
          );
          const progress = (
            await req("/api/published/" + fresh.id, "GET", undefined, visitor)
          ).value;
          assert.equal(progress.closes, fresh.closes + 86400000);
          assert.equal(progress.attempt.cursor, 1);
          assert.equal(progress.attempt.score, 500);
          assert.equal(progress.solutions.length, 1);
          assert.equal(
            (
              await req(
                "/api/publications/" + fresh.id,
                "DELETE",
                undefined,
                owner,
              )
            ).res.status,
            409,
          );
          await stop();
          await start();
          const resumed = (
            await req("/api/published/" + fresh.id, "GET", undefined, visitor)
          ).value;
          assert.equal(resumed.closes, fresh.closes + 86400000);
          assert.equal(resumed.attempt.cursor, 1);
          assert.equal(resumed.solutions.length, 1);
          await Promise.all([
            req(
              "/api/publications/" + fresh.id + "/extend",
              "POST",
              { closes: fresh.closes + 2 * 86400000 },
              owner,
            ),
            req("/api/publications/" + fresh.id + "/close", "POST", {}, owner),
          ]);
          assert.equal(
            (await req("/api/published/" + fresh.id, "GET", undefined, visitor))
              .value.closed,
            true,
          );
          assert.equal(
            (
              await req(
                "/api/publications/" + fresh.id + "/extend",
                "POST",
                { closes: fresh.closes + 3 * 86400000 },
                owner,
              )
            ).res.status,
            409,
          );
          assert.equal(
            (
              await req(
                "/api/publications/" + fresh.id,
                "DELETE",
                undefined,
                friend,
              )
            ).res.status,
            404,
          );
          assert.equal(
            (
              await req(
                "/api/publications/" + fresh.id,
                "DELETE",
                undefined,
                owner,
              )
            ).res.status,
            200,
          );
          assert.equal(
            (await req("/api/published/" + fresh.id, "GET", undefined, visitor))
              .res.status,
            404,
          );
          assert.equal(
            (
              await req(
                "/api/publications/" + fresh.id + "/results",
                "GET",
                undefined,
                owner,
              )
            ).res.status,
            404,
          );
          assert.ok(
            (await req("/api/quizzes", "GET", undefined, owner)).value.some(
              (q) => q.id === quizId,
            ),
          );
          await stop();
          await start();
          assert.equal(
            (await req("/api/reports", "GET", undefined, owner)).value.length,
            0,
          );
          assert.equal(
            (await req("/api/published/" + fresh.id)).res.status,
            404,
          );
        },
      );
      await t.test(
        "immediate feedback, completed-only rankings, shared ranks and private answer history",
        async () => {
          const created = await req(
            "/api/quizzes",
            "POST",
            {
              title: "Instant feedback",
              description: "",
              music: "",
              rounds: [
                {
                  title: "",
                  questions: [
                    {
                      type: "choice",
                      text: "Choose A",
                      options: ["A", "B"],
                      correct: 0,
                      seconds: 30,
                      points: 1000,
                      media: "",
                    },
                    {
                      type: "text",
                      text: "Type hello",
                      accepted: ["hello"],
                      seconds: 30,
                      points: 1000,
                      media: "",
                    },
                  ],
                },
              ],
            },
            owner,
          );
          assert.equal(created.res.status, 201);
          const publication = (
            await req(
              "/api/publications",
              "POST",
              { quizId: created.value.id },
              owner,
            )
          ).value;
          const path = "/api/published/" + publication.id;
          async function join(name) {
            const initial = await req(path);
            const r = await req(
              path + "/join",
              "POST",
              { name },
              initial.cookie,
            );
            assert.equal(r.value.question.correct, undefined);
            assert.deepEqual(r.value.solutions, []);
            assert.equal(r.value.leaderboard, undefined);
            return initial.cookie;
          }
          const alice = await join("Alice"),
            bob = await join("Bob"),
            unfinished = await join("Still playing"),
            skipped = await join("Skipped");
          const first = (
            await req(path + "/answer", "POST", { index: 0, answer: 0 }, alice)
          ).value;
          assert.equal(first.solutions.length, 1);
          assert.equal(first.solutions[0].correct, "A");
          assert.equal(first.solutions[0].pointsEarned, 1000);
          assert.equal(first.question.accepted, undefined);
          assert.equal(first.leaderboard, undefined);
          const finished = (
            await req(
              path + "/answer",
              "POST",
              { index: 1, answer: " HELLO " },
              alice,
            )
          ).value;
          assert.equal(finished.attempt.score, 2000);
          assert.equal(finished.solutions[1].correct, "hello");
          assert.equal(finished.leaderboard.length, 1);
          await req(path + "/answer", "POST", { index: 0, answer: 0 }, bob);
          await req(
            path + "/answer",
            "POST",
            { index: 1, answer: "hello" },
            bob,
          );
          const wrong = (
            await req(
              path + "/answer",
              "POST",
              { index: 0, answer: 1 },
              skipped,
            )
          ).value;
          assert.equal(wrong.solutions[0].pointsEarned, 0);
          const skip = (
            await req(
              path + "/answer",
              "POST",
              { index: 1, skip: true },
              skipped,
            )
          ).value;
          assert.equal(skip.solutions[1].yourAnswer, null);
          assert.equal(skip.solutions[1].correct, "hello");
          const ranked = (await req(path, "GET", undefined, alice)).value;
          assert.deepEqual(
            ranked.leaderboard.map((r) => [r.rank, r.score]),
            [
              [1, 2000],
              [1, 2000],
              [3, 0],
            ],
          );
          assert.equal(ranked.leaderboard.filter((r) => r.isYou).length, 1);
          for (const row of ranked.leaderboard)
            assert.deepEqual(Object.keys(row).sort(), [
              "isYou",
              "name",
              "rank",
              "score",
            ]);
          assert.ok(
            !ranked.leaderboard.some((r) => r.name === "Still playing"),
          );
          assert.equal(
            (await req(path, "GET", undefined, unfinished)).value.leaderboard,
            undefined,
          );
          assert.equal((await req(path)).value.leaderboard, undefined);
          assert.equal((await req(path)).value.solutions, undefined);
          await stop();
          await start();
          assert.deepEqual(
            (await req(path, "GET", undefined, alice)).value.leaderboard,
            ranked.leaderboard,
          );
          await req(
            "/api/publications/" + publication.id + "/close",
            "POST",
            {},
            owner,
          );
          assert.equal(
            (await req(path, "GET", undefined, alice)).value.leaderboard.length,
            3,
          );
          assert.equal(
            (await req(path, "GET", undefined, unfinished)).value.leaderboard,
            undefined,
          );
        },
      );
      await t.test(
        "assignment deadlines, stable shuffled grading and server-enforced timers",
        async () => {
          const baseQuestion = { seconds: 120, points: 1000, media: "" };
          const created = (
            await req(
              "/api/quizzes",
              "POST",
              {
                title: "Assignment settings",
                description: "",
                music: "",
                rounds: [
                  {
                    title: "",
                    questions: [
                      {
                        ...baseQuestion,
                        type: "choice",
                        text: "Choose B",
                        options: ["A", "B", "C", "D"],
                        correct: 1,
                      },
                      {
                        ...baseQuestion,
                        type: "multi",
                        text: "Choose prime numbers",
                        options: ["2", "4", "3", "6"],
                        correctAnswers: [0, 2],
                      },
                      {
                        ...baseQuestion,
                        type: "text",
                        text: "Type hello",
                        accepted: ["hello"],
                      },
                      {
                        ...baseQuestion,
                        type: "boolean",
                        text: "True or false",
                        correct: 1,
                      },
                    ],
                  },
                ],
              },
              owner,
            )
          ).value;
          for (const options of [
            { closes: Date.now() - 1 },
            { closes: Date.now() + 366 * 86400000 },
            { timerEnabled: "true" },
            { randomizeAnswers: 1 },
          ]) {
            assert.equal(
              (
                await req(
                  "/api/publications",
                  "POST",
                  { quizId: created.id, ...options },
                  owner,
                )
              ).res.status,
              400,
            );
          }
          const closes = Date.now() + 2 * 86400000;
          const shuffled = (
            await req(
              "/api/publications",
              "POST",
              { quizId: created.id, closes, randomizeAnswers: true },
              owner,
            )
          ).value;
          const endpoint = "/api/published/" + shuffled.id;
          const cookie = (await req(endpoint)).cookie;
          let state = (
            await req(
              endpoint + "/join",
              "POST",
              { name: "Shuffled participant" },
              cookie,
            )
          ).value;
          assert.equal(state.closes, closes);
          assert.deepEqual(state.settings, {
            timerEnabled: false,
            randomizeAnswers: true,
          });
          assert.equal(state.question.deadline, null);
          assert.equal(JSON.stringify(state).includes("shuffleSeed"), false);
          const order = state.question.options;
          assert.deepEqual([...order].sort(), ["A", "B", "C", "D"]);
          await stop();
          await start();
          assert.deepEqual(
            (await req(endpoint, "GET", undefined, cookie)).value.question
              .options,
            order,
          );
          state = (
            await req(
              endpoint + "/answer",
              "POST",
              { index: 0, answer: order.indexOf("B") },
              cookie,
            )
          ).value;
          assert.equal(state.attempt.score, 1000);
          assert.equal(state.solutions[0].yourAnswer, 1);
          assert.equal(state.solutions[0].correct, "B");
          const multiOrder = state.question.options;
          assert.equal(
            (
              await req(
                endpoint + "/answer",
                "POST",
                { index: 1, answer: [0, 0] },
                cookie,
              )
            ).res.status,
            400,
          );
          assert.equal(
            (
              await req(
                endpoint + "/answer",
                "POST",
                { index: 1, answer: [999] },
                cookie,
              )
            ).res.status,
            400,
          );
          state = (
            await req(
              endpoint + "/answer",
              "POST",
              {
                index: 1,
                answer: [
                  multiOrder.indexOf("2"),
                  multiOrder.indexOf("3"),
                  multiOrder.indexOf("4"),
                ],
              },
              cookie,
            )
          ).value;
          assert.equal(state.solutions[1].credit, 0.5);
          assert.equal(state.attempt.score, 1500);
          state = (
            await req(
              endpoint + "/answer",
              "POST",
              { index: 2, answer: " HELLO " },
              cookie,
            )
          ).value;
          state = (
            await req(
              endpoint + "/answer",
              "POST",
              { index: 3, answer: state.question.options.indexOf("False") },
              cookie,
            )
          ).value;
          assert.equal(state.attempt.score, 3500);
          assert.equal(state.attempt.completed, true);
          assert.equal(state.leaderboard[0].score, 3500);
          // Timers are persisted in each attempt, not in a process-local timeout.
          const timed = (
            await req(
              "/api/publications",
              "POST",
              {
                quizId: created.id,
                timerEnabled: true,
                randomizeAnswers: true,
              },
              owner,
            )
          ).value;
          const timedPath = "/api/published/" + timed.id;
          const timedCookie = (await req(timedPath)).cookie;
          state = (
            await req(
              timedPath + "/join",
              "POST",
              { name: "Timed participant" },
              timedCookie,
            )
          ).value;
          const firstDeadline = state.question.deadline;
          assert.ok(firstDeadline > Date.now());
          assert.equal(
            (
              await req(
                timedPath + "/join",
                "POST",
                { name: "Again" },
                timedCookie,
              )
            ).value.question.deadline,
            firstDeadline,
          );
          async function expire() {
            if (database) {
              const client = new (require("pg").Client)({
                connectionString: database,
              });
              await client.connect();
              try {
                const row = (
                  await client.query(
                    "SELECT id,document FROM quizzes_private.attempts WHERE publication_id=$1",
                    [timed.id],
                  )
                ).rows[0];
                const d = JSON.parse(row.document);
                d.deadline = Date.now() - 1;
                await client.query(
                  "UPDATE quizzes_private.attempts SET document=$1 WHERE id=$2",
                  [JSON.stringify(d), row.id],
                );
              } finally {
                await client.end();
              }
            } else {
              const local = new (require("better-sqlite3"))(
                path.join(dir, "quizzes.sqlite"),
              );
              try {
                const row = local
                  .prepare(
                    "SELECT id,document FROM attempts WHERE publication_id=?",
                  )
                  .get(timed.id);
                const d = JSON.parse(row.document);
                d.deadline = Date.now() - 1;
                local
                  .prepare("UPDATE attempts SET document=? WHERE id=?")
                  .run(JSON.stringify(d), row.id);
              } finally {
                local.close();
              }
            }
          }
          await expire();
          state = (
            await req(
              timedPath + "/answer",
              "POST",
              { index: 0, answer: state.question.options.indexOf("B") },
              timedCookie,
            )
          ).value;
          assert.equal(state.solutions[0].timedOut, true);
          assert.equal(state.attempt.score, 0);
          assert.equal(state.awaitingNext, true);
          assert.equal(state.question, undefined);
          assert.equal(
            (
              await req(
                timedPath + "/answer",
                "POST",
                { index: 1, answer: [0] },
                timedCookie,
              )
            ).res.status,
            409,
          );
          assert.equal(
            (await req(timedPath, "GET", undefined, timedCookie)).value
              .awaitingNext,
            true,
          );
          const starts = await Promise.all([
            req(timedPath + "/next", "POST", { index: 1 }, timedCookie),
            req(timedPath + "/next", "POST", { index: 1 }, timedCookie),
          ]);
          assert.ok(starts.every((r) => r.res.status === 200));
          assert.equal(
            starts[0].value.question.deadline,
            starts[1].value.question.deadline,
          );
          await expire();
          state = (await req(timedPath, "GET", undefined, timedCookie)).value;
          assert.equal(state.attempt.cursor, 2);
          assert.equal(state.solutions[1].timedOut, true);
          assert.equal(
            (await req(timedPath, "GET", undefined, timedCookie)).value.attempt
              .cursor,
            2,
          );
          assert.equal(
            (await req(timedPath + "/next", "POST", { index: 1 }, timedCookie))
              .res.status,
            409,
          );
          state = (
            await req(timedPath + "/next", "POST", { index: 2 }, timedCookie)
          ).value;
          const preservedDeadline = state.question.deadline;
          await stop();
          await start();
          assert.equal(
            (await req(timedPath, "GET", undefined, timedCookie)).value.question
              .deadline,
            preservedDeadline,
          );
          await req(
            timedPath + "/answer",
            "POST",
            { index: 2, answer: "hello" },
            timedCookie,
          );
          state = (
            await req(timedPath + "/next", "POST", { index: 3 }, timedCookie)
          ).value;
          state = (
            await req(
              timedPath + "/answer",
              "POST",
              { index: 3, answer: state.question.options.indexOf("False") },
              timedCookie,
            )
          ).value;
          assert.equal(state.attempt.completed, true);
          assert.equal(state.attempt.score, 2000);
          assert.equal(state.awaitingNext, false);
          assert.equal(state.leaderboard[0].score, 2000);
          const backup = await req("/api/backup", "POST", { password }, owner);
          assert.equal(backup.res.status, 200);
          const backupFile = path.join(dir, "timed-assignment-backup.zip");
          fs.writeFileSync(backupFile, backup.value);
          const saved = JSON.parse(
            execFileSync("unzip", ["-p", backupFile, "database.json"], {
              encoding: "utf8",
            }),
          );
          const savedPublication = saved.tables.publications.find(
            (p) => p.id === timed.id,
          );
          assert.equal(
            JSON.parse(savedPublication.document).publicationSettings
              .timerEnabled,
            true,
          );
          const savedAttempt = JSON.parse(
            saved.tables.attempts.find((a) => a.publication_id === timed.id)
              .document,
          );
          assert.equal(savedAttempt.answers[0].timedOut, true);
          assert.equal(savedAttempt.shuffleSeed.length, 32);
          assert.equal(savedAttempt.score, 2000);
        },
      );
    } finally {
      for (const ws of sockets) ws.terminate();
      await stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
