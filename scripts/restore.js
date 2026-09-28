const fs = require("node:fs");
const path = require("node:path");
const { db, ready, TABLES, migrateOwnership } = require("../storage");
const media = require("../media-store");
const columns = {
  admins: ["id", "email", "password", "organization"],
  quizzes: ["id", "document", "updated"],
  media: ["id", "mime", "name"],
  reports: ["id", "document", "ended"],
  recovery_codes: ["digest", "admin_id", "created"],
  metadata: ["key", "value"],
  ownership: ["kind", "item_id", "owner_id"],
  invitations: ["digest", "owner_id", "expires", "used"],
  publications: ["id", "owner_id", "document", "created", "closes"],
  editor_drafts: ["owner_id", "draft_key", "version", "updated", "document"],
  attempts: [
    "id",
    "publication_id",
    "browser_hash",
    "name",
    "document",
    "updated",
  ],
};
(async () => {
  if (!process.argv[2])
    throw Error("Usage: npm run restore -- /path/to/extracted-private-backup");
  const root = path.resolve(process.argv[2]);
  const snapshot = JSON.parse(
    fs.readFileSync(path.join(root, "database.json"), "utf8"),
  );
  if (
    snapshot.format !== "quizzes-backup" ||
    ![1, 2, 3].includes(snapshot.version) ||
    !snapshot.tables
  )
    throw Error("Unsupported backup format.");
  if (snapshot.version === 1)
    for (const table of [
      "ownership",
      "invitations",
      "publications",
      "attempts",
    ])
      snapshot.tables[table] = [];
  if (snapshot.version < 3) snapshot.tables.editor_drafts = [];
  for (const table of TABLES) {
    if (!Array.isArray(snapshot.tables[table]))
      throw Error("Missing backup table.");
    for (const row of snapshot.tables[table])
      for (const col of columns[table])
        if (!Object.hasOwn(row, col)) throw Error("Incomplete backup record.");
  }
  await Promise.all([ready, media.ready]);
  if (
    (await db.prepare("SELECT id FROM admins LIMIT 1").get()) ||
    (await db.prepare("SELECT id FROM reports LIMIT 1").get())
  )
    throw Error(
      "Restore only into a new empty deployment. Existing host accounts/reports will not be overwritten.",
    );
  for (const m of snapshot.tables.media) {
    if (!/^[a-f0-9-]{36}$/.test(m.id)) throw Error("Invalid media identifier.");
    await media.write(
      m.id,
      fs.readFileSync(path.join(root, "media", m.id)),
      m.mime,
    );
  }
  await db.withTransaction(async (tx) => {
    for (const table of [...TABLES].reverse())
      await tx.prepare("DELETE FROM " + table).run();
    for (const table of TABLES) {
      const names = columns[table];
      for (const row of snapshot.tables[table])
        await tx
          .prepare(
            `INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`,
          )
          .run(...names.map((k) => row[k]));
    }
  });
  await migrateOwnership();
  console.log(
    "Saved accounts, quizzes, reports and media restored. Sign in again; live rooms and old login sessions are not restored.",
  );
})()
  .catch((err) => {
    console.error(
      err.code
        ? "Restore failed. Check your private backup and database configuration."
        : err.message,
    );
    process.exitCode = 1;
  })
  .finally(() => db.close());
