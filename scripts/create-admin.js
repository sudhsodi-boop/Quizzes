// Run in a private terminal on your own server; never send passwords in chat.
const readline = require("readline/promises");
const crypto = require("crypto");
const { db, ready, passwordHash } = require("../storage");
async function hidden(prompt) {
  if (!process.stdin.isTTY)
    throw Error("Use an interactive terminal for private password entry.");
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    function onData(data) {
      for (const c of data.toString()) {
        if (c === "\u0003") {
          done();
          reject(Error("Cancelled"));
          return;
        }
        if (c === "\r" || c === "\n") {
          done();
          resolve(value);
          return;
        }
        if (c === "\u007f") {
          value = value.slice(0, -1);
        } else if (c >= " ") {
          value += c;
        }
      }
    }
    function done() {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    }
    process.stdin.on("data", onData);
  });
}
(async () => {
  await ready;
  const resetting = process.argv.includes("--reset");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const email = (await rl.question("Host email: ")).trim().toLowerCase();
  const organization = resetting
    ? "Recovery"
    : (await rl.question("Organization name: ")).trim();
  rl.close();
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    !organization ||
    organization.length > 120
  )
    throw Error("Enter a valid email and organization name.");
  const password = await hidden("Password (12+ characters; input hidden): ");
  const confirm = await hidden("Confirm password: ");
  if (password !== confirm || password.length < 12 || password.length > 128)
    throw Error("Passwords must match and contain 12–128 characters.");
  const encoded = await passwordHash(password);
  if (resetting) {
    await db.withTransaction(async (tx) => {
      const admin = await tx
        .prepare("SELECT id FROM admins WHERE email=?")
        .get(email);
      if (!admin) throw Error("Host account not found.");
      await tx
        .prepare("UPDATE admins SET password=? WHERE id=?")
        .run(encoded, admin.id);
      await tx.prepare("DELETE FROM sessions WHERE admin_id=?").run(admin.id);
      await tx
        .prepare("DELETE FROM recovery_codes WHERE admin_id=?")
        .run(admin.id);
    });
    console.log(
      "Host password reset. Existing sessions and recovery codes revoked.",
    );
    return;
  }
  await db
    .prepare("INSERT INTO admins VALUES (?,?,?,?)")
    .run(crypto.randomUUID(), email, encoded, organization);
  console.log("Host account created. Sign in through the app.");
})()
  .catch((err) => {
    console.error(
      err.code === "SQLITE_CONSTRAINT_UNIQUE"
        ? "That host already exists."
        : err.message,
    );
    process.exitCode = 1;
  })
  .finally(() => db.close());
