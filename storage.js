const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const scrypt = promisify(crypto.scrypt);
const { validateHostSetup, startupError } = require("./startup-diagnostics");
const dataDir = process.env.DATA_DIR || path.join(__dirname, "data");
const cloud = !!process.env.DATABASE_URL;
if (
  process.env.RENDER &&
  (!cloud || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY)
) {
  throw new Error(
    "Refusing ephemeral deployment: configure DATABASE_URL, SUPABASE_URL and SUPABASE_SERVICE_KEY in the hosting dashboard.",
  );
}
const schema = `
CREATE TABLE IF NOT EXISTS admins (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, organization TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES admins(id), expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS quizzes (id TEXT PRIMARY KEY, document TEXT NOT NULL, updated BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, mime TEXT NOT NULL, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, document TEXT NOT NULL, ended BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS recovery_codes (digest TEXT PRIMARY KEY, admin_id TEXT UNIQUE NOT NULL REFERENCES admins(id), created BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ownership (kind TEXT NOT NULL, item_id TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES admins(id), PRIMARY KEY(kind,item_id));
CREATE INDEX IF NOT EXISTS ownership_by_owner ON ownership(owner_id,kind);
CREATE TABLE IF NOT EXISTS invitations (digest TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES admins(id), expires BIGINT NOT NULL, used BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS publications (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES admins(id), document TEXT NOT NULL, created BIGINT NOT NULL, closes BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, publication_id TEXT NOT NULL REFERENCES publications(id), browser_hash TEXT NOT NULL, name TEXT NOT NULL, document TEXT NOT NULL, updated BIGINT NOT NULL, UNIQUE(publication_id,browser_hash));
`;
const TABLES = [
  "admins",
  "quizzes",
  "media",
  "reports",
  "recovery_codes",
  "metadata",
  "ownership",
  "invitations",
  "publications",
  "attempts",
];
let db;
if (cloud) {
  const { Pool } = require("pg");
  const { databaseConfig } = require("./database-config");
  const configuration = databaseConfig(process.env);
  console.log(
    configuration.passwordSource === "separate"
      ? "Database credential mode: separate DATABASE_PASSWORD; URL password is ignored."
      : "Database credential mode: DATABASE_URL password.",
  );
  const pool = new Pool(configuration.options);
  pool.on("error", () =>
    console.error("A database connection was interrupted."),
  );
  const qualify = (sql) =>
    sql.replace(
      /'(?:''|[^'])*'|\b(admins|sessions|quizzes|media|reports|recovery_codes|metadata|ownership|invitations|publications|attempts)\b/g,
      (text, name) => (name ? "quizzes_private." + name : text),
    );
  const api = (client) => ({
    prepare(sql) {
      sql = qualify(sql);
      let index = 0;
      const query = sql.replace(/\?/g, () => "$" + ++index);
      return {
        get: async (...args) => (await client.query(query, args)).rows[0],
        all: async (...args) => (await client.query(query, args)).rows,
        run: async (...args) => ({
          changes: (await client.query(query, args)).rowCount,
        }),
      };
    },
    exec: (sql) => client.query(qualify(sql)),
  });
  db = {
    ...api(pool),
    kind: "postgres",
    async withTransaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(api(client));
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
} else {
  const Database = require("better-sqlite3");
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const native = new Database(path.join(dataDir, "quizzes.sqlite"));
  native.pragma("journal_mode=WAL");
  native.pragma("foreign_keys=ON");
  let tail = Promise.resolve();
  const queue = (fn) => {
    const task = tail.then(fn);
    tail = task.catch(() => {});
    return task;
  };
  const direct = {
    prepare(sql) {
      const stmt = native.prepare(sql);
      return {
        get: async (...args) => stmt.get(...args),
        all: async (...args) => stmt.all(...args),
        run: async (...args) => stmt.run(...args),
      };
    },
    exec: async (sql) => native.exec(sql),
  };
  db = {
    kind: "sqlite",
    prepare(sql) {
      return Object.fromEntries(
        ["get", "all", "run"].map((method) => [
          method,
          (...args) => queue(() => native.prepare(sql)[method](...args)),
        ]),
      );
    },
    exec: (sql) => queue(() => native.exec(sql)),
    withTransaction: (fn) =>
      queue(async () => {
        native.exec("BEGIN IMMEDIATE");
        try {
          const value = await fn(direct);
          native.exec("COMMIT");
          return value;
        } catch (e) {
          native.exec("ROLLBACK");
          throw e;
        }
      }),
    backup: (file) => queue(() => native.backup(file)),
    close: () => queue(() => native.close()),
  };
}
async function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64);
  return salt + ":" + key.toString("hex");
}
async function passwordMatches(password, stored) {
  const [salt, hex] = stored.split(":");
  const key = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(key, Buffer.from(hex, "hex"));
}
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const ready = (async () => {
  let stage = "DATABASE_SCHEMA";
  try {
    if (cloud) {
      await db.exec("CREATE SCHEMA IF NOT EXISTS quizzes_private");
      await db.exec("REVOKE ALL ON SCHEMA quizzes_private FROM PUBLIC");
    }
    await db.exec(schema);
    stage = "DATABASE_SEED";
    // Use a marker so deleting the last quiz does not bring the sample back.
    if (
      !(await db
        .prepare("SELECT value FROM metadata WHERE key=?")
        .get("seeded"))
    ) {
      await db.withTransaction(async (tx) => {
        if (
          !Number(
            (await tx.prepare("SELECT COUNT(*) AS n FROM quizzes").get()).n,
          )
        ) {
          const quiz = require("./seed-quiz.json");
          await tx
            .prepare(
              "INSERT INTO quizzes VALUES (?,?,?) ON CONFLICT (id) DO NOTHING",
            )
            .run(quiz.id, JSON.stringify(quiz), Date.now());
        }
        await tx
          .prepare(
            "INSERT INTO metadata VALUES (?,?) ON CONFLICT (key) DO NOTHING",
          )
          .run("seeded", "1");
      });
    }
    stage = "HOST_SETUP";
    const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.INITIAL_ADMIN_PASSWORD;
    if (
      (email || password) &&
      !(await db.prepare("SELECT id FROM admins LIMIT 1").get())
    ) {
      const { email, password, organization } = validateHostSetup(process.env);
      const encoded = await passwordHash(password);
      await db
        .prepare("INSERT INTO admins VALUES (?,?,?,?)")
        .run(crypto.randomUUID(), email, encoded, organization);
      console.log(
        "Initial host account created. Remove INITIAL_ADMIN_PASSWORD from the hosting environment after signing in.",
      );
    }
    await migrateOwnership();
  } catch (error) {
    if (!error.startupStage) error.startupStage = stage;
    throw error;
  }
})();
async function migrateOwnership(explicitOwner) {
  await db.withTransaction(async (tx) => {
    if (
      await tx
        .prepare("SELECT value FROM metadata WHERE key=?")
        .get("ownership_v1")
    )
      return;
    const admins = await tx.prepare("SELECT id,email FROM admins").all();
    if (!admins.length) return;
    const target = (process.env.WORKSPACE_OWNER_EMAIL || "")
      .trim()
      .toLowerCase();
    const owner =
      explicitOwner ||
      (admins.length === 1
        ? admins[0].id
        : admins.find((a) => a.email === target)?.id);
    if (!owner) throw startupError("WORKSPACE_OWNER_REQUIRED", "HOST_SETUP");
    for (const kind of ["quizzes", "media", "reports"]) {
      for (const row of await tx.prepare("SELECT id FROM " + kind).all())
        await tx
          .prepare(
            "INSERT INTO ownership (kind,item_id,owner_id) VALUES (?,?,?) ON CONFLICT(kind,item_id) DO NOTHING",
          )
          .run(kind, row.id, owner);
    }
    await tx
      .prepare(
        "INSERT INTO metadata (key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING",
      )
      .run("ownership_v1", "1");
  });
}
async function owns(kind, id, owner) {
  return !!(await db
    .prepare(
      "SELECT item_id FROM ownership WHERE kind=? AND item_id=? AND owner_id=?",
    )
    .get(kind, id, owner));
}
async function exportDatabase(ownerId) {
  return db.withTransaction(async (tx) => {
    const tables = {};
    for (const table of TABLES) {
      if (table === "invitations") {
        tables[table] = [];
        continue;
      } // Invites are access grants, not portable data.
      if (!ownerId) {
        tables[table] = await tx.prepare("SELECT * FROM " + table).all();
        continue;
      }
      if (table === "metadata") {
        tables[table] = [
          { key: "seeded", value: "1" },
          { key: "ownership_v1", value: "1" },
        ];
        continue;
      }
      const condition =
        table === "admins"
          ? "id=?"
          : table === "recovery_codes"
            ? "admin_id=?"
            : ["ownership", "publications"].includes(table)
              ? "owner_id=?"
              : table === "attempts"
                ? "publication_id IN (SELECT id FROM publications WHERE owner_id=?)"
                : "id IN (SELECT item_id FROM ownership WHERE kind='" +
                  table +
                  "' AND owner_id=?)";
      tables[table] = await tx
        .prepare("SELECT * FROM " + table + " WHERE " + condition)
        .all(ownerId);
    }
    return {
      format: "quizzes-backup",
      version: 2,
      created: Date.now(),
      tables,
    };
  });
}

module.exports = {
  db,
  dataDir,
  cloud,
  ready,
  TABLES,
  passwordHash,
  passwordMatches,
  hash,
  exportDatabase,
  owns,
  migrateOwnership,
};
