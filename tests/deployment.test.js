const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.join(__dirname, "..");
test("ephemeral Render deployments fail closed before creating a local database", () => {
  const dir = fs.mkdtempSync(path.join(root, ".test-data-"));
  try {
    const result = spawnSync(process.execPath, ["-e", 'require("./storage")'], {
      cwd: root,
      env: {
        ...process.env,
        RENDER: "true",
        DATABASE_URL: "",
        SUPABASE_URL: "",
        SUPABASE_SERVICE_KEY: "",
        DATA_DIR: dir,
      },
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing ephemeral deployment/);
    assert.ok(!fs.existsSync(path.join(dir, "quizzes.sqlite")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test(
  "production host bootstrap is private, creates Secure cookies and never overwrites an existing account",
  { timeout: 20000 },
  async () => {
    const dir = fs.mkdtempSync(path.join(root, ".test-data-"));
    const password = crypto.randomBytes(24).toString("hex");
    let child;
    const origin = "http://localhost:4183";
    const base = {
      ...process.env,
      PORT: "4183",
      DATA_DIR: dir,
      NODE_ENV: "production",
      RENDER: "",
      DATABASE_URL: "",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_KEY: "",
      ALLOW_SETUP: "true",
      INITIAL_ADMIN_EMAIL: "owner@example.test",
      INITIAL_ADMIN_PASSWORD: password,
      ORGANIZATION_NAME: "Bootstrap test",
    };
    async function start(env) {
      child = spawn(process.execPath, ["server.js"], {
        cwd: root,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("Startup timeout")), 8000);
        child.stdout.on("data", (b) => {
          if (b.toString().includes("listening")) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.once("exit", () => {
          clearTimeout(timer);
          reject(Error("Unexpected exit"));
        });
      });
    }
    async function stop() {
      if (!child) return;
      const done = once(child, "exit");
      child.kill("SIGTERM");
      await done;
      child = null;
    }
    const post = (url, body) =>
      fetch(origin + url, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    try {
      await start(base);
      const session = await (await fetch(origin + "/api/session")).json();
      assert.equal(session.setupRequired, false);
      assert.equal(session.setupEnabled, false);
      assert.equal((await post("/api/setup", {})).status, 403);
      const login = await post("/api/login", {
        email: base.INITIAL_ADMIN_EMAIL,
        password,
      });
      assert.equal(login.status, 200);
      assert.match(login.headers.get("set-cookie"), /; Secure/);
      await stop();
      await start({
        ...base,
        INITIAL_ADMIN_PASSWORD: crypto.randomBytes(24).toString("hex"),
      });
      assert.equal(
        (
          await post("/api/login", {
            email: base.INITIAL_ADMIN_EMAIL,
            password,
          })
        ).status,
        200,
      );
    } finally {
      await stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
