const fs = require("node:fs");
const path = require("node:path");
const { db, ready, dataDir } = require("../storage");
const media = require("../media-store");
const { writeBackup } = require("../backup-service");
(async () => {
  const name = process.argv[2];
  if (!name || !name.endsWith(".zip"))
    throw Error("Usage: npm run backup -- /private/path/quizzes-backup.zip");
  const dest = path.resolve(name);
  if (dest.startsWith(path.resolve(dataDir) + path.sep))
    throw Error("Store backups outside the live data directory.");
  await Promise.all([ready, media.ready]);
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  await writeBackup(fs.createWriteStream(dest, { flags: "wx", mode: 0o600 }));
  console.log(
    "Private database and media backup completed. Store the ZIP securely.",
  );
})()
  .catch(() => {
    console.error(
      "Backup failed. Check configuration, source files and destination path.",
    );
    process.exitCode = 1;
  })
  .finally(() => db.close());
