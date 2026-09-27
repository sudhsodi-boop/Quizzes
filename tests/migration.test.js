const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const Database = require("better-sqlite3");
test("legacy content is assigned once; ambiguous shared workspaces fail closed without losing content", () => {
  const root = path.join(__dirname, "..");
  for (const count of [1, 2]) {
    const dir = fs.mkdtempSync(path.join(root, ".test-data-"));
    try {
      let db = new Database(path.join(dir, "quizzes.sqlite"));
      db.exec(
        "CREATE TABLE admins (id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,organization TEXT NOT NULL);CREATE TABLE quizzes (id TEXT PRIMARY KEY,document TEXT NOT NULL,updated BIGINT NOT NULL);",
      );
      const ids = Array.from({ length: count }, () => crypto.randomUUID());
      for (let i = 0; i < count; i++)
        db.prepare("INSERT INTO admins VALUES (?,?,?,?)").run(
          ids[i],
          `legacy${i}@example.test`,
          "unused:fixture",
          "Legacy",
        );
      const id = crypto.randomUUID();
      const value = JSON.stringify({ id, title: "Keep this legacy content" });
      db.prepare("INSERT INTO quizzes VALUES (?,?,?)").run(
        id,
        value,
        Date.now(),
      );
      db.close();
      const env = {
        ...process.env,
        DATA_DIR: dir,
        DATABASE_URL: "",
        RENDER: "",
        INITIAL_ADMIN_EMAIL: "",
        INITIAL_ADMIN_PASSWORD: "",
        WORKSPACE_OWNER_EMAIL: "",
        NODE_ENV: "test",
      };
      const run = (extra) =>
        spawnSync(
          process.execPath,
          [
            "-e",
            'const s=require("./storage");s.ready.then(()=>s.db.close()).catch(async e=>{console.error(e.code);await s.db.close();process.exitCode=1})',
          ],
          { cwd: root, env: { ...env, ...extra }, encoding: "utf8" },
        );
      const first = run({});
      assert.equal(first.status, count === 1 ? 0 : 1);
      if (count === 2) assert.match(first.stderr, /WORKSPACE_OWNER_REQUIRED/);
      db = new Database(path.join(dir, "quizzes.sqlite"));
      assert.equal(
        db.prepare("SELECT document FROM quizzes WHERE id=?").get(id).document,
        value,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS n FROM ownership").get().n,
        count === 1 ? 1 : 0,
      );
      db.close();
      if (count === 2) {
        const result = run({ WORKSPACE_OWNER_EMAIL: "legacy0@example.test" });
        assert.equal(result.status, 0, result.stderr);
      }
      assert.equal(
        run({
          WORKSPACE_OWNER_EMAIL: count === 2 ? "legacy1@example.test" : "",
        }).status,
        0,
      );
      db = new Database(path.join(dir, "quizzes.sqlite"));
      assert.equal(
        db
          .prepare("SELECT owner_id FROM ownership WHERE kind=? AND item_id=?")
          .get("quizzes", id).owner_id,
        ids[0],
      );
      if (count === 1) {
        const tables = {};
        for (const table of [
          "admins",
          "quizzes",
          "media",
          "reports",
          "recovery_codes",
          "metadata",
        ])
          tables[table] = db.prepare("SELECT * FROM " + table).all();
        tables.metadata = tables.metadata.filter(
          (row) => row.key !== "ownership_v1",
        );
        const backup = path.join(dir, "v1-backup");
        fs.mkdirSync(backup);
        fs.writeFileSync(
          path.join(backup, "database.json"),
          JSON.stringify({ format: "quizzes-backup", version: 1, tables }),
        );
        const destination = path.join(dir, "restored");
        const restore = spawnSync(
          process.execPath,
          ["scripts/restore.js", backup],
          {
            cwd: root,
            env: { ...env, DATA_DIR: destination },
            encoding: "utf8",
          },
        );
        assert.equal(restore.status, 0, restore.stderr);
        const restored = new Database(path.join(destination, "quizzes.sqlite"));
        assert.equal(
          restored.prepare("SELECT document FROM quizzes WHERE id=?").get(id)
            .document,
          value,
        );
        assert.equal(
          restored
            .prepare(
              "SELECT owner_id FROM ownership WHERE kind=? AND item_id=?",
            )
            .get("quizzes", id).owner_id,
          ids[0],
        );
        restored.close();
      }
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});
