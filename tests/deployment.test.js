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
      ORGANIZATION_NAME: "Quizzes",
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

const {
  describeStartupFailure,
  checkStartup,
} = require("../startup-diagnostics");
test("startup diagnostics classify failures without printing credentials or upstream text", async () => {
  const secret = "PRIVATE-test-value-that-must-never-appear";
  const samples = [
    [{ code: "SELF_SIGNED_CERT_IN_CHAIN" }, "TLS_UNTRUSTED"],
    [{ cause: { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" } }, "TLS_UNTRUSTED"],
    [{ code: "28P01" }, "DB_AUTH_FAILED"],
    [{ message: "Tenant or user not found: " + secret }, "DB_POOLER_IDENTITY"],
    [{ code: "42501" }, "DB_PERMISSION_DENIED"],
    [{ cause: { code: "ENOTFOUND" } }, "DNS_LOOKUP_FAILED"],
    [{ code: "ENETUNREACH" }, "NETWORK_UNREACHABLE"],
    [
      { startupStage: "HOST_SETUP", code: "HOST_SETUP_CONFIG" },
      "HOST_SETUP_CONFIG",
    ],
    [
      { startupStage: "MEDIA_BUCKET_CREATE", startupHttpStatus: 401 },
      "MEDIA_HTTP_401",
    ],
    [
      { startupStage: "MEDIA_BUCKET_VALIDATE", code: "MEDIA_BUCKET_PUBLIC" },
      "MEDIA_BUCKET_PUBLIC",
    ],
    [{ code: secret, startupStage: secret }, "UNKNOWN"],
  ];
  for (const [fields, expected] of samples) {
    const error = Object.assign(
      new Error("postgresql://user:" + secret + "@private-host/database"),
      fields,
    );
    const result = describeStartupFailure("DATABASE_SCHEMA", error);
    assert.equal(result.code, expected);
    assert.ok(!JSON.stringify(result).includes(secret));
    assert.ok(!JSON.stringify(result).includes("private-host"));
  }
  const lines = [];
  const healthy = await checkStartup(
    [
      {
        stage: "DATABASE_SCHEMA",
        promise: Promise.reject(
          Object.assign(new Error(secret), { code: "28P01" }),
        ),
      },
      {
        stage: "MEDIA_BUCKET_VALIDATE",
        promise: Promise.reject(
          Object.assign(new Error(secret), { startupHttpStatus: 403 }),
        ),
      },
    ],
    (line) => lines.push(line),
    (line) => lines.push(line),
  );
  assert.equal(healthy, false);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /DB_AUTH_FAILED/);
  assert.match(lines[1], /MEDIA_HTTP_403/);
  assert.ok(!lines.join().includes(secret));
});
test("invalid startup URIs and unreplaced placeholders produce safe diagnostic codes", () => {
  const secret = "PRIVATE-not-for-logs";
  const dir = fs.mkdtempSync(path.join(root, ".test-data-"));
  const env = {
    ...process.env,
    DATA_DIR: dir,
    NODE_ENV: "production",
    RENDER: "",
    INITIAL_ADMIN_EMAIL: "",
    INITIAL_ADMIN_PASSWORD: "",
    SUPABASE_URL: "",
    SUPABASE_SERVICE_KEY: "",
    DATABASE_CA_CERT: "",
  };
  try {
    for (const [url, expected] of [
      ["this-is-not-a-uri-" + secret, "CONFIG_DATABASE_URL"],
      [
        "postgresql://postgres.project:[YOUR-PASSWORD]@aws-0-example.pooler.supabase.com:5432/postgres",
        "CONFIG_DATABASE_PLACEHOLDER",
      ],
      [
        "postgresql://postgres.project@aws-0-example.pooler.supabase.com:5432/postgres",
        "CONFIG_DATABASE_PASSWORD_MISSING",
      ],
    ]) {
      const run = spawnSync(process.execPath, ["server.js"], {
        cwd: root,
        env: { ...env, DATABASE_URL: url },
        encoding: "utf8",
        timeout: 5000,
      });
      assert.equal(run.status, 1);
      assert.match(run.stderr, new RegExp(expected));
      assert.ok(!run.stderr.includes(secret));
      assert.ok(!run.stderr.includes("aws-0-example"));
    }
    const malformed = spawnSync(process.execPath, ["server.js"], {
      cwd: root,
      env: {
        ...env,
        DATABASE_URL: "",
        SUPABASE_URL: "https://" + secret + ".invalid/project/not-an-api-base",
        SUPABASE_SERVICE_KEY: "sb_secret_" + secret,
      },
      encoding: "utf8",
      timeout: 5000,
    });
    assert.equal(malformed.status, 1);
    assert.match(malformed.stderr, /CONFIG_MEDIA_URL/);
    assert.ok(!malformed.stderr.includes(secret));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("media authentication failure is distinguishable from database initialization", async () => {
  const http = require("node:http");
  const dir = fs.mkdtempSync(path.join(root, ".test-data-"));
  const secret = "PRIVATE-media-token";
  const fixture = http.createServer((req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: secret }));
  });
  await new Promise((r) => fixture.listen(0, "127.0.0.1", r));
  try {
    const child = spawn(process.execPath, ["server.js"], {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATA_DIR: dir,
        DATABASE_URL: "",
        RENDER: "",
        INITIAL_ADMIN_EMAIL: "",
        INITIAL_ADMIN_PASSWORD: "",
        SUPABASE_URL: "http://127.0.0.1:" + fixture.address().port,
        SUPABASE_SERVICE_KEY: "sb_secret_" + secret,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (c) => (output += c));
    child.stderr.on("data", (c) => (output += c));
    const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
    const [code] = await once(child, "exit");
    clearTimeout(timer);
    assert.equal(code, 1);
    assert.match(output, /Startup check passed \[DATABASE_SCHEMA\]/);
    assert.match(output, /\[MEDIA_BUCKET_LOOKUP\] \[MEDIA_HTTP_401\]/);
    assert.ok(!output.includes(secret));
  } finally {
    await new Promise((r) => fixture.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const { databaseConfig } = require("../database-config");
test("separate database password is passed verbatim and overrides URL credentials safely", () => {
  const host = "aws-0-us-west-2.pooler.supabase.com";
  const base = {
    DATABASE_URL: `postgresql://postgres.example:[YOUR-PASSWORD]@${host}:5432/postgres`,
    SUPABASE_URL: "https://example.supabase.co",
    NODE_ENV: "production",
  };
  // These are synthetic test strings, never real host or database credentials.
  for (const password of [
    "randomLettersAndDigits123456",
    "A@b#c%40:/?&+ test",
    " spaces remain ",
    "percent%40isLiteral",
    "Unicode-\u00e9-\u2603",
  ]) {
    const result = databaseConfig({ ...base, DATABASE_PASSWORD: password });
    const actual = new (require("pg").Client)(result.options)
      .connectionParameters;
    assert.equal(result.passwordSource, "separate");
    assert.equal(actual.password, password);
    assert.equal(actual.host, host);
    assert.equal(actual.user, "postgres.example");
    assert.equal(actual.port, 5432);
    assert.equal(actual.database, "postgres");
    assert.equal(actual.ssl.rejectUnauthorized, true);
    assert.ok(!("connectionString" in result.options));
  }
  const result = databaseConfig({
    ...base,
    DATABASE_URL:
      base.DATABASE_URL +
      "?password=stale&user=wrong&host=wrong.invalid&ssl=0&sslmode=disable",
    DATABASE_PASSWORD: "actualLiteralPassword",
  });
  const actual = new (require("pg").Client)(result.options)
    .connectionParameters;
  assert.equal(actual.password, "actualLiteralPassword");
  assert.equal(actual.user, "postgres.example");
  assert.equal(actual.host, host);
  assert.equal(actual.ssl.rejectUnauthorized, true);
  assert.throws(
    () => databaseConfig({ ...base, DATABASE_PASSWORD: "" }),
    (e) => e.code === "CONFIG_DATABASE_PASSWORD_MISSING",
  );
});
test("database password URL mode still decodes exactly once and validates project identity", () => {
  const password = "example!%@/:?#encoded";
  const base = {
    DATABASE_URL:
      "postgresql://postgres.example:" +
      encodeURIComponent(password) +
      "@aws-0-us-west-2.pooler.supabase.com:5432/postgres",
    SUPABASE_URL: "https://example.supabase.co",
    NODE_ENV: "production",
  };
  const result = databaseConfig(base);
  assert.equal(result.passwordSource, "url");
  assert.equal(
    new (require("pg").Client)(result.options).connectionParameters.password,
    password,
  );
  for (const changed of [
    base.DATABASE_URL.replace("postgres.example", "postgres.wrong"),
    base.DATABASE_URL.replace("postgres.example", "postgres"),
  ])
    assert.throws(
      () => databaseConfig({ ...base, DATABASE_URL: changed }),
      (e) => e.code === "CONFIG_DATABASE_PROJECT_MISMATCH",
    );
  assert.throws(
    () =>
      databaseConfig({
        ...base,
        DATABASE_URL:
          "postgresql://postgres:pw@db.wrong.supabase.co:5432/postgres",
      }),
    (e) => e.code === "CONFIG_DATABASE_PROJECT_MISMATCH",
  );
  const safe = describeStartupFailure("DATABASE_CONFIG", {
    code: "CONFIG_DATABASE_PROJECT_MISMATCH",
    message: password,
  });
  assert.equal(safe.code, "CONFIG_DATABASE_PROJECT_MISMATCH");
  assert.ok(!safe.reason.includes(password));
});

const { validateHostSetup } = require("../startup-diagnostics");
test("host setup accepts Quizzes, preserves the password and logs no values", () => {
  const lines = [];
  const email = "private-test-account@example.test";
  const password = require("crypto").randomBytes(24).toString("base64") + " ";
  const values = validateHostSetup(
    {
      INITIAL_ADMIN_EMAIL: "  " + email.toUpperCase() + "  ",
      INITIAL_ADMIN_PASSWORD: password,
      ORGANIZATION_NAME: "  Quizzes  ",
    },
    (x) => lines.push(x),
  );
  assert.equal(values.email, email);
  assert.equal(values.password, password);
  assert.equal(values.organization, "Quizzes");
  assert.deepEqual(lines.slice(1), [
    "Host setup check [INITIAL_ADMIN_EMAIL]: OK",
    "Host setup check [INITIAL_ADMIN_PASSWORD]: OK",
    "Host setup check [ORGANIZATION_NAME]: OK",
  ]);
  assert.ok(!lines.join().includes(email));
  assert.ok(!lines.join().includes(password));
  assert.ok(!lines.join().includes("Quizzes"));
});
test("host setup failures name the exact variable without exposing any values", () => {
  const base = {
    INITIAL_ADMIN_EMAIL: "private-test-account@example.test",
    INITIAL_ADMIN_PASSWORD: "test-password-long-enough",
    ORGANIZATION_NAME: "Quizzes",
  };
  const cases = [
    ["INITIAL_ADMIN_EMAIL", undefined, "HOST_EMAIL_MISSING"],
    ["INITIAL_ADMIN_EMAIL", "   ", "HOST_EMAIL_MISSING"],
    ["INITIAL_ADMIN_EMAIL", "not-an-address", "HOST_EMAIL_INVALID"],
    [
      "INITIAL_ADMIN_EMAIL",
      "x".repeat(250) + "@example.test",
      "HOST_EMAIL_TOO_LONG",
    ],
    ["INITIAL_ADMIN_PASSWORD", undefined, "HOST_PASSWORD_MISSING"],
    ["INITIAL_ADMIN_PASSWORD", "", "HOST_PASSWORD_MISSING"],
    ["INITIAL_ADMIN_PASSWORD", "x".repeat(11), "HOST_PASSWORD_TOO_SHORT"],
    ["INITIAL_ADMIN_PASSWORD", "x".repeat(129), "HOST_PASSWORD_TOO_LONG"],
    ["ORGANIZATION_NAME", undefined, "HOST_ORGANIZATION_MISSING"],
    ["ORGANIZATION_NAME", " \n ", "HOST_ORGANIZATION_MISSING"],
    ["ORGANIZATION_NAME", "x".repeat(121), "HOST_ORGANIZATION_TOO_LONG"],
  ];
  for (const [field, value, code] of cases) {
    const lines = [];
    assert.throws(
      () =>
        validateHostSetup({ ...base, [field]: value }, (x) => lines.push(x)),
      (err) => {
        assert.equal(err.code, code);
        const safe = describeStartupFailure("HOST_SETUP", err);
        assert.equal(safe.code, code);
        assert.ok(safe.reason.includes(field));
        return true;
      },
    );
    assert.equal(lines.length, 4);
    assert.ok(!lines.join().includes(base.INITIAL_ADMIN_EMAIL));
    assert.ok(!lines.join().includes(base.INITIAL_ADMIN_PASSWORD));
  }
  for (const length of [12, 128])
    assert.doesNotThrow(() =>
      validateHostSetup(
        { ...base, INITIAL_ADMIN_PASSWORD: "x".repeat(length) },
        () => {},
      ),
    );
});
test("startup reports all host checks and the specific error when an initial field is missing", () => {
  const base = {
    ...process.env,
    NODE_ENV: "production",
    RENDER: "",
    DATABASE_URL: "",
    DATABASE_PASSWORD: "",
    SUPABASE_URL: "",
    SUPABASE_SERVICE_KEY: "",
    INITIAL_ADMIN_EMAIL: "private-fixture@example.test",
    INITIAL_ADMIN_PASSWORD: "private-fixture-long-password",
    ORGANIZATION_NAME: "Quizzes",
  };
  for (const [field, value, code] of [
    ["INITIAL_ADMIN_EMAIL", "", "HOST_EMAIL_MISSING"],
    ["INITIAL_ADMIN_PASSWORD", "", "HOST_PASSWORD_MISSING"],
    ["INITIAL_ADMIN_PASSWORD", "short-test", "HOST_PASSWORD_TOO_SHORT"],
    ["ORGANIZATION_NAME", "", "HOST_ORGANIZATION_MISSING"],
  ]) {
    const dir = fs.mkdtempSync(path.join(root, ".test-data-"));
    try {
      const result = spawnSync(process.execPath, ["server.js"], {
        cwd: root,
        env: { ...base, DATA_DIR: dir, [field]: value },
        encoding: "utf8",
        timeout: 10000,
      });
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        new RegExp("\\[HOST_SETUP\\] \\[" + code + "\\]"),
      );
      assert.match(result.stdout, /Host setup validation v2/);
      assert.equal((result.stdout.match(/Host setup check/g) || []).length, 3);
      assert.ok(!result.stdout.includes(base.INITIAL_ADMIN_EMAIL));
      assert.ok(!result.stdout.includes(base.INITIAL_ADMIN_PASSWORD));
      assert.ok(!result.stderr.includes(base.INITIAL_ADMIN_PASSWORD));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});
