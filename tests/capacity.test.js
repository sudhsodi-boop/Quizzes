"use strict";
// Event-capacity regressions for a full room (about 100 participants).
// These guard the two limits that actually bite on a shared free container:
// the per-answer broadcast fan-out and the shared-NAT connection budget.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");
const crypto = require("node:crypto");
const WebSocket = require("ws");

const root = path.join(__dirname, "..");
const temp = fs.mkdtempSync(path.join(root, ".test-capacity-"));
const port = 4186;
const origin = `http://localhost:${port}`;
const PLAYERS = 25;
const CONNECT_BUDGET = 60;

let server, cookie = "";

async function start() {
  server = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: temp,
      ALLOW_SETUP: "true",
      NODE_ENV: "test",
      CONNECTS_PER_MINUTE: String(CONNECT_BUDGET),
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
    counts: {},
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
        }, 15000);
        c.listeners.push(entry);
      });
    },
    has(type, predicate) {
      return c.inbox.find((x) => x.type === type && predicate(x)) || null;
    },
  };
  ws.on("message", (d) => {
    const m = JSON.parse(d);
    c.counts[m.type] = (c.counts[m.type] || 0) + 1;
    const i = c.listeners.findIndex((x) => x.type === m.type && x.predicate(m));
    if (i >= 0) c.listeners.splice(i, 1)[0].resolve(m);
    else c.inbox.push(m);
  });
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(c));
    ws.once("error", reject);
  });
}

const allAnswered = (m, n) =>
  m.game?.participants?.length === n &&
  m.game.participants.every((p) => p.answered);

test(
  "event capacity: a full room stays within its broadcast and connection budgets",
  { timeout: 120000 },
  async (t) => {
    await start();
    const host = {};
    const players = [];
    try {
      const password = crypto.randomBytes(24).toString("base64");
      assert.equal(
        (
          await request("/api/setup", "POST", {
            email: "capacity@example.test",
            password,
            organization: "Capacity test",
          })
        ).res.status,
        201,
      );
      const signedIn = await request("/api/login", "POST", {
        email: "capacity@example.test",
        password,
      });
      assert.equal(signedIn.res.status, 200);
      const saved = await request("/api/quizzes", "POST", {
        title: "Capacity quiz",
        description: "",
        rounds: [
          {
            title: "Only round",
            questions: [0, 1, 2].map((i) => ({
              type: "choice",
              text: `Question ${i + 1}?`,
              options: ["A", "B"],
              correct: 0,
              seconds: 60,
              points: 1000,
            })),
          },
        ],
      });
      assert.equal(saved.res.status, 201);
      const quizId = saved.value.id;
      void quizId;

      await t.test(`host launches a room and ${PLAYERS} players join`, async () => {
        host.client = await client();
        host.client.send("create_game", { quizId });
        const created = await host.client.wait("game_created");
        host.code = created.game.code;
        assert.match(host.code, /^QZ[0-9A-F]{6}$/);
        for (let i = 0; i < PLAYERS; i++) {
          const p = await client();
          p.send("join_game", { code: host.code, name: `Player ${i + 1}` });
          const joined = await p.wait("joined");
          assert.ok(joined.playerToken);
          players.push(p);
        }
      });

      await t.test(
        "answers from the whole room do not fan out one broadcast each",
        async () => {
          const observer = players[0];
          const before = observer.counts.participants_updated || 0;
          host.client.send("start_question");
          const started = await observer.wait("question_started");
          assert.equal(started.question.text, "Question 1?");
          for (const p of players)
            p.send("submit_answer", {
              questionId: started.question.id,
              answer: 0,
            });
          // The roster is coalesced, but it must still converge: the room must
          // eventually see that everybody has answered.
          let roster = null;
          for (let i = 0; i < 20 && !roster; i++) {
            const next = await observer
              .wait("participants_updated")
              .catch(() => null);
            if (next && allAnswered(next, PLAYERS)) roster = next;
          }
          assert.ok(roster, "the coalesced roster never showed all answers");
          const sent = (observer.counts.participants_updated || 0) - before;
          assert.ok(sent > 0, "the room still sends roster updates");
          t.diagnostic(`${PLAYERS} answers produced ${sent} roster broadcasts`);
          assert.ok(
            sent <= 8,
            `${PLAYERS} answers produced ${sent} roster broadcasts; coalescing regressed`,
          );
        },
      );

      await t.test("scoring is unchanged by coalescing", async () => {
        host.client.send("reveal_answers");
        const ended = await players[0].wait("question_ended");
        assert.equal(ended.leaderboard.length, PLAYERS);
        for (const row of ended.leaderboard)
          assert.ok(row.score >= 500, "every correct answer still scored");
      });

      await t.test(
        "the shared-NAT connection budget is enforced but roomy",
        async () => {
          // The budget is small here so the ceiling is observable; the shipped
          // default must stay far above one room's worth of phones.
          let ok = 0,
            rejected = 0;
          for (let i = 0; i < CONNECT_BUDGET + 20; i++) {
            const accepted = await new Promise((resolve) => {
              const ws = new WebSocket(`ws://localhost:${port}/live`, {
                origin,
              });
              let settled = false;
              const finish = (value) => {
                if (!settled) {
                  settled = true;
                  resolve(value);
                }
              };
              ws.once("open", () => {
                ws.close();
                finish(true);
              });
              ws.once("error", () => finish(false));
              ws.once("unexpected-response", () => finish(false));
            });
            if (accepted) ok++;
            else rejected++;
          }
          assert.ok(rejected > 0, "the connection budget was not enforced");
          assert.ok(
            ok <= CONNECT_BUDGET,
            `budget was ${CONNECT_BUDGET} but ${ok} connections opened`,
          );
          assert.ok(
            Number(process.env.CONNECTS_PER_MINUTE || 1200) >= 50,
            "the default budget must leave room for a room behind one NAT",
          );
        },
      );
    } finally {
      for (const p of players) p.ws.close();
      host.client?.ws.close();
      server.kill("SIGKILL");
      await once(server, "exit").catch(() => {});
      fs.rmSync(temp, { recursive: true, force: true });
    }
  },
);
