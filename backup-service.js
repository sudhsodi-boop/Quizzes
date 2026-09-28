const { ZipArchive } = require("archiver");
const { exportDatabase } = require("./storage");
const mediaStore = require("./media-store");
async function writeBackup(destination, ownerId) {
  const snapshot = await exportDatabase(ownerId);
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const completed = new Promise((resolve, reject) => {
    destination.on("finish", resolve);
    destination.on("error", reject);
    archive.on("error", reject);
    archive.on("warning", reject);
  });
  archive.pipe(destination);
  try {
    archive.append(JSON.stringify(snapshot, null, 2), {
      name: "database.json",
    });
    archive.append(
      "PRIVATE BACKUP: contains host password hashes, recovery-code hashes, quizzes, private editor drafts/import-review text, participant reports and uploaded media. Store securely. Restore with npm run restore -- /path/to/extracted-backup. Active rooms and login sessions are not included.\n",
      { name: "READ-ME.txt" },
    );
    for (const m of snapshot.tables.media) {
      const bytes = await mediaStore.read(m.id);
      archive.append(bytes, { name: "media/" + m.id });
    }
    await archive.finalize();
    await completed;
  } catch (e) {
    archive.abort();
    destination.destroy(e);
    await completed.catch(() => {});
    throw e;
  }
}
module.exports = { writeBackup };
