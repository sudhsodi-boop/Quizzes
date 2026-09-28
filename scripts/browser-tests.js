const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const testData = path.join(__dirname, "..", ".browser-test-data");
fs.rmSync(testData, { recursive: true, force: true });
try {
  const result = spawnSync(
    process.execPath,
    [require.resolve("@playwright/test/cli"), "test"],
    { stdio: "inherit", cwd: path.join(__dirname, "..") },
  );
  process.exitCode = result.status ?? 1;
  if (result.error) console.error(result.error);
} finally {
  fs.rmSync(testData, { recursive: true, force: true });
}
