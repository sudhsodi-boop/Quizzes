"use strict";
// Buzzer rounds: players buzz from their phones, the server orders them by its
// own clock, and the host awards points by hand. Everything a buzzer question
// does must leave the existing question types completely untouched.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");
const crypto = require("node:crypto");
const WebSocket = require("ws");

const root = path.join(__dirname, "..");
const temp = fs.mkdtempSync(path.join(root, ".test-buzzer-"));
const port = 4187;
const origin = `http://localhost:${port}`;

let server,
  cookie = "";

async function start() {
  server = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: temp,
      ALLOW_SETUP: "true",
      NODE_ENV: "test",
      DATABASE_URL: "",
      DATABASE_TEST_NO_TLS: "",
      RENDER: "",
      INITIAL_ADMIN_EMAIL: "",
      INITIAL_ADMIN_PASSWORD: "",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write(d));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Server startup timed out")),
      15000,
    );
    server.stdout.on("data", (d) => {
      if (d.toString().includes("listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

async function request(p, method = "GET", body) {
  const res = await fetch(origin + p, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      Origin: origin,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    value = text;
  }
  return { res, value };
}

function client() {
  const ws = new WebSocket(`ws://localhost:${port}/live`, {
    origin,
    headers: cookie ? { Cookie: cookie } : {},
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
    async expectError(send, pattern) {
      c.send(send.type, send);
      const m = await c.wait("error");
      assert.match(m.message, pattern);
      return m;
    },
  };
  ws.on("message", (d) => {
    const m = JSON.parse(d);
    const i = c.listeners.findIndex((x) => x.type === m.type && x.predicate(m));
    if (i >= 0) c.listeners.splice(i, 1)[0].resolve(m);
    else c.inbox.push(m);
  });
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(c));
    ws.once("error", reject);
  });
}

test(
  "buzzer rounds: fair ordering, host-awarded scoring and no effect on other types",
  { timeout: 60000 },
  async (t) => {
    await start();
    const host = {};
    const players = [];
    try {
      const password = crypto.randomBytes(24).toString("base64");
      assert.equal(
        (
          await request("/api/setup", "POST", {
            email: "buzzer@example.test",
            password,
            organization: "Buzzer test",
          })
        ).res.status,
        201,
      );
      assert.equal(
        (
          await request("/api/login", "POST", {
            email: "buzzer@example.test",
            password,
          })
        ).res.status,
        200,
      );

      // One buzzer question followed by an ordinary choice question: the
      // second one proves the new type does not change existing behaviour.
      const quiz = {
        title: "Buzzer quiz",
        description: "",
        rounds: [
          {
            title: "Name that tune",
            questions: [
              {
                type: "buzzer",
                text: "Name this song",
                accepted: ["Tum Hi Ho", "Tum Hi Ho (Arijit Singh)"],
                seconds: 20,
                points: 1000,
                notes: "Host note",
              },
              {
                type: "choice",
                text: "Two plus two?",
                options: ["4", "5"],
                correct: 0,
                seconds: 10,
                points: 1000,
              },
            ],
          },
        ],
      };
      const saved = await request("/api/quizzes", "POST", quiz);
      assert.equal(saved.res.status, 201, JSON.stringify(saved.value));
      assert.equal(saved.value.rounds[0].questions[0].type, "buzzer");

      // A buzzer question must not be savable without its expected answer.
      const incomplete = structuredClone(quiz);
      incomplete.rounds[0].questions[0].accepted = [];
      assert.equal(
        (await request("/api/quizzes", "POST", incomplete)).res.status,
        400,
      );

      await t.test("host opens the room and three players join", async () => {
        host.client = await client();
        host.client.send("create_game", { quizId: saved.value.id });
        const created = await host.client.wait("game_created");
        host.code = created.game.code;
        for (const name of ["Anita", "Rahul", "Meera"]) {
          const p = await client();
          p.send("join_game", { code: host.code, name });
          const joined = await p.wait("joined");
          p.id = joined.playerId;
          players.push(p);
        }
      });

      await t.test(
        "a buzzer question opens a buzzing window, not a countdown",
        async () => {
          host.client.send("next_question");
          const m = await players[0].wait("buzzer_started");
          assert.equal(m.game.status, "buzzer");
          assert.equal(m.game.deadline, null, "no timer runs on a buzzer");
          assert.equal(m.open, true);
          assert.deepEqual(m.buzzes, []);
          // The answer must never reach the players.
          assert.equal(m.question.text, "Name this song");
          assert.ok(!("accepted" in m.question));
          assert.ok(!("correct" in m.question));
        },
      );

      await t.test("buzzes are ordered by the server clock", async () => {
        // Buzz in a deliberately shuffled order: Meera, Anita, Rahul.
        players[2].send("buzz");
        await players[2].wait("buzz_received");
        players[0].send("buzz");
        await players[0].wait("buzz_received");
        players[1].send("buzz");
        await players[1].wait("buzz_received");
        const queue = await players[0].wait(
          "buzz_queue",
          (x) => x.buzzes.length === 3,
        );
        assert.deepEqual(
          queue.buzzes.map((b) => b.name),
          ["Meera", "Anita", "Rahul"],
        );
        assert.deepEqual(
          queue.buzzes.map((b) => b.position),
          [1, 2, 3],
        );
        assert.deepEqual(
          queue.buzzes.map((b) => b.status),
          ["waiting", "waiting", "waiting"],
        );
      });

      await t.test("a player cannot buzz twice", async () => {
        await players[0].expectError({ type: "buzz" }, /already buzzed/);
      });

      await t.test("only the host can score a buzz", async () => {
        await players[0].expectError(
          { type: "buzz_verdict", playerId: players[0].id, correct: true },
          /not available|Action is not available/,
        );
      });

      await t.test(
        "a wrong answer moves to the next name in the queue",
        async () => {
          host.client.send("buzz_verdict", {
            playerId: players[2].id,
            correct: false,
          });
          const queue = await host.client.wait(
            "buzz_queue",
            (x) => x.buzzes[0].status === "wrong",
          );
          assert.equal(queue.buzzes[0].name, "Meera");
          assert.equal(queue.buzzes[0].status, "wrong");
          assert.equal(queue.buzzes[1].status, "waiting");
          assert.equal(queue.open, true, "others may still buzz in");
        },
      );

      await t.test(
        "a correct answer scores, closes buzzing and ends the question",
        async () => {
          host.client.send("buzz_verdict", {
            playerId: players[1].id,
            correct: true,
          });
          const ended = await host.client.wait("question_ended");
          assert.equal(ended.game.status, "results");
          assert.equal(ended.buzzerWon, true);
          assert.equal(ended.correct, "Tum Hi Ho / Tum Hi Ho (Arijit Singh)");
          const name = (n) => ended.leaderboard.find((r) => r.name === n).score;
          assert.ok(name("Rahul") > 0, "the correct buzzer scored");
          assert.ok(
            name("Rahul") >= 100 && name("Rahul") <= 1000,
            "the speed bonus stays inside the question's points",
          );
          assert.equal(name("Meera"), 0, "a wrong buzz scores nothing");
          assert.equal(name("Anita"), 0, "a player who never answered scores 0");
        },
      );

      await t.test("buzzing is closed after the question ends", async () => {
        await players[1].expectError({ type: "buzz" }, /nothing to buzz|closed/);
      });

      await t.test(
        "the next ordinary question behaves exactly as before",
        async () => {
          // Ordinary rule, unchanged: the last question of a round is
          // announced before it starts, so the host advances twice.
          host.client.send("next_question");
          await players[0].wait("last_question_intro");
          host.client.send("next_question");
          const started = await players[0].wait("question_started");
          assert.equal(started.game.status, "question");
          assert.ok(started.game.deadline > Date.now(), "timer is back");
          assert.equal(started.question.type, "choice");
          assert.ok(!("correct" in started.question));
          // Drop anything left over from the buzzer question so the assertions
          // below can only be satisfied by this question's own results.
          players[0].inbox.length = 0;
          players[0].send("submit_answer", {
            questionId: started.question.id,
            answer: 0,
          });
          await players[0].wait("answer_received");
          host.client.send("reveal_answers");
          const ended = await players[0].wait(
            "question_ended",
            (m) => m.correct === "4",
          );
          assert.equal(ended.correct, "4");
          const score = (n) => ended.leaderboard.find((r) => r.name === n).score;
          assert.ok(score("Anita") > 0, "a correct choice answer still scores");
          assert.ok(
            score("Rahul") >= 100 && score("Rahul") <= 1000,
            "the buzzer points were kept through the next question",
          );
          assert.equal(score("Meera"), 0, "the wrong buzz stays at zero");
        },
      );

      await t.test("revealing with no winner scores nobody", async () => {
        // Restart the flow on a fresh room and leave the buzzer unanswered.
        host.client.send("end_game");
        await host.client.wait("game_ended");
        host.client2 = await client();
        host.client2.send("create_game", { quizId: saved.value.id });
        const created = await host.client2.wait("game_created");
        const p = await client();
        p.send("join_game", { code: created.game.code, name: "Solo" });
        await p.wait("joined");
        host.client2.send("next_question");
        await p.wait("buzzer_started");
        host.client2.send("stop_buzzing");
        const closed = await host.client2.wait("buzz_queue");
        assert.equal(closed.open, false);
        await p.expectError({ type: "buzz" }, /closed/);
        host.client2.send("reveal_answers");
        const ended = await host.client2.wait("question_ended");
        assert.equal(ended.buzzerWon, false);
        assert.deepEqual(
          ended.leaderboard.map((r) => r.score),
          [0],
        );
      });
    } finally {
      for (const p of players) p.ws.close();
      host.client?.ws.close();
      host.client2?.ws.close();
      server.kill("SIGKILL");
      await once(server, "exit").catch(() => {});
      fs.rmSync(temp, { recursive: true, force: true });
    }
  },
);
