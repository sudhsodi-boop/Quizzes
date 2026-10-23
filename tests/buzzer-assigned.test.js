const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:events") && require("node:child_process");

const PORT = 4192;
const ORIGIN = `http://127.0.0.1:${PORT}`;

// A buzzer question is a live, host-scored round. Assigned (self-paced)
// quizzes have no host, so the same question must be shown and graded there as
// a type-the-answer question against the same expected-answer list.
test(
  "a buzzer question in an assigned quiz is served and graded as a typed answer",
  { timeout: 90000 },
  async () => {
    const root = path.join(__dirname, ".."),
      dir = fs.mkdtempSync(path.join(root, ".test-data-"));
    const child = spawn(process.execPath, ["server.js"], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(PORT),
        DATA_DIR: dir,
        NODE_ENV: "test",
        ALLOW_SETUP: "true",
        RENDER: "",
        DATABASE_URL: "",
        SUPABASE_URL: "",
        SUPABASE_SERVICE_KEY: "",
        INITIAL_ADMIN_EMAIL: "",
        INITIAL_ADMIN_PASSWORD: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stdout.on("data", (d) => (stderr += d));
    child.stderr.on("data", (d) => (stderr += d));
    const hostCookie = { value: "" };
    const attemptCookie = { value: "" };

    async function ready() {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Startup timeout: " + stderr)),
          20000,
        );
        child.stdout.on("data", (b) => {
          stderr += b;
          if (stderr.includes("listening")) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.stderr.on("data", (b) => (stderr += b));
        child.once("exit", () => {
          clearTimeout(timer);
          reject(Error(stderr));
        });
      });
    }
    async function api(p, method = "GET", body, useHost = true) {
      const headers = { Origin: ORIGIN };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (useHost && hostCookie.value) headers.cookie = hostCookie.value;
      if (!useHost && attemptCookie.value) headers.cookie = attemptCookie.value;
      let res;
      try {
        res = await fetch(ORIGIN + p, {
        method,
        headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (err) {
        throw Error(
          `fetch ${p} failed: ${err.message} · server log:\n${stderr}`,
        );
      }
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) {
        const value = setCookie.split(";")[0];
        if (value.startsWith("quizzes_session=")) hostCookie.value = value;
        if (value.startsWith("quizzes_attempt=")) attemptCookie.value = value;
      }
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
      return { status: res.status, json };
    }
    function capture(res, expected) {
      assert.equal(
        res.status,
        expected,
        `expected ${expected}, got ${res.status}: ${JSON.stringify(res.json)}`,
      );
      return res.json;
    }

    try {
      await ready();
      const password = crypto.randomBytes(18).toString("base64");
      capture(
        await api(
          "/api/setup",
          "POST",
          {
            email: "host@example.test",
            password,
            organization: "Test nonprofit",
          },
          false,
        ),
        201,
      );
      capture(
        await api(
          "/api/login",
          "POST",
          { email: "host@example.test", password },
          false,
        ),
        200,
      );
      const quiz = capture(
        await api("/api/quizzes", "POST", {
          title: "Antakshari night",
          description: "",
          rounds: [
            {
              title: "Music",
              questions: [
                {
                  type: "buzzer",
                  text: "Name this song",
                  seconds: 30,
                  points: 1000,
                  accepted: ["Tum Hi Ho", "Tum Hi Ho (Arijit Singh)"],
                },
              ],
            },
          ],
        }),
        201,
      );
      const pub = capture(
        await api("/api/publications", "POST", {
          quizId: quiz.id,
          closes: Date.now() + 24 * 60 * 60 * 1000,
          timerEnabled: false,
          randomizeAnswers: false,
        }),
        201,
      );
      const id = pub.id;
      const before = capture(await api(`/api/published/${id}`, "GET", undefined, false), 200);
      assert.equal(before.total, 1);
      assert.ok(attemptCookie.value, "the participant needs an attempt cookie");
      capture(await api(`/api/published/${id}/join`, "POST", { name: "Meera" }, false), 200);
      const state = capture(
        await api(`/api/published/${id}`, "GET", undefined, false),
        200,
      );
      assert.equal(state.question.type, "text");
      assert.equal(state.question.options, undefined);
      assert.equal(state.question.text, "Name this song");
      // Answered with a listed alternative, ignoring case and spacing.
      capture(
        await api(
          `/api/published/${id}/answer`,
          "POST",
          { index: 0, answer: "  tum hi  ho  " },
          false,
        ),
        200,
      );
      const after = capture(
        await api(`/api/published/${id}`, "GET", undefined, false),
        200,
      );
      const solution = after.solutions[0];
      assert.equal(solution.type, "text");
      assert.equal(solution.correct, "Tum Hi Ho / Tum Hi Ho (Arijit Singh)");
      assert.ok(solution.pointsEarned > 0, "the typed answer should score");
      assert.equal(after.attempt.score, solution.pointsEarned);
    } finally {
      child.kill("SIGKILL");
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
