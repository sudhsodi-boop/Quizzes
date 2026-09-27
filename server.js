const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const {
  loadStartupModule,
  checkStartup,
  logStartupFailure,
} = require("./startup-diagnostics");
const {
  db,
  ready: databaseReady,
  passwordHash,
  passwordMatches,
  hash,
} = loadStartupModule("./storage", "DATABASE_CONFIG");
const mediaStore = loadStartupModule("./media-store", "MEDIA_CONFIG");
const { writeBackup } = require("./backup-service");
const { importDocument } = require("./quiz-import");
const PORT = Number(process.env.PORT || 4173);
const games = new Map();
const limits = new Map();
const SESSION_MS = 12 * 60 * 60 * 1000;
const setupEnabled =
  process.env.ALLOW_SETUP === "true" && process.env.NODE_ENV !== "production";
function fail(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
function bounded(value, max, label, required = true) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    fail(`Invalid ${label}`);
  return value.trim();
}
function rate(key, max, windowMs) {
  const now = Date.now();
  let entry = limits.get(key);
  if (!entry || entry.until < now) {
    entry = {
      n: 0,
      until: now + windowMs,
    };
    limits.set(key, entry);
  }
  if (++entry.n > max) fail("Too many attempts. Please try again later.", 429);
}
function peer(req) {
  return process.env.TRUST_PROXY === "1"
    ? String(req.headers["x-forwarded-for"] || req.socket.remoteAddress)
        .split(",")
        .at(-1)
        .trim()
    : req.socket.remoteAddress;
}
function sameOrigin(req) {
  if (!req.headers.origin) return false;
  try {
    return new URL(req.headers.origin).host === req.headers.host;
  } catch {
    return false;
  }
}
function token(req) {
  return (
    (req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("quizzes_session="))
      ?.slice(16) || ""
  );
}
async function user(req) {
  const t = token(req);
  if (!t) return null;
  return await db
    .prepare(
      "SELECT a.id,a.email,a.organization FROM sessions s JOIN admins a ON a.id=s.admin_id WHERE s.token=? AND s.expires>?",
    )
    .get(hash(t), Date.now());
}
async function requireUser(req) {
  const u = await user(req);
  if (!u) fail("Please sign in as a host.", 401);
  return u;
}
function cookie(req, value, maxAge) {
  const secure =
    req.socket.encrypted ||
    (process.env.TRUST_PROXY === "1" &&
      req.headers["x-forwarded-proto"] === "https") ||
    process.env.NODE_ENV === "production";
  return `quizzes_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
function json(res, status, data, extra = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...extra,
  });
  res.end(JSON.stringify(data));
}
async function body(req, max = 1024 * 1024) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > max) fail("File or request is too large.", 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function data(req) {
  try {
    return JSON.parse((await body(req)).toString());
  } catch (e) {
    if (e.status) throw e;
    fail("Invalid JSON");
  }
}
async function validMedia(value, kind) {
  if (!value) return "";
  if (typeof value !== "string" || !/^\/media\/[a-f0-9-]+$/.test(value))
    fail("Invalid media reference");
  const m = await db
    .prepare("SELECT * FROM media WHERE id=?")
    .get(value.split("/").pop());
  if (!m || (kind && !m.mime.startsWith(kind + "/")))
    fail("Media not found or wrong type");
  return value;
}
async function validateQuiz(input, id = crypto.randomUUID()) {
  const q = {
    id,
    title: bounded(input.title, 120, "quiz title"),
    description: bounded(input.description || "", 1000, "description", false),
    music: await validMedia(input.music, "audio"),
    rounds: [],
  };
  if (
    !Array.isArray(input.rounds) ||
    input.rounds.length < 1 ||
    input.rounds.length > 20
  )
    fail("Use 1–20 rounds.");
  let count = 0;
  for (const r of input.rounds) {
    const round = {
      title: bounded(r.title, 100, "round title"),
      questions: [],
    };
    if (!Array.isArray(r.questions) || !r.questions.length)
      fail("Each round needs at least one question.");
    for (const x of r.questions) {
      if (++count > 200) fail("Maximum 200 questions per quiz.");
      if (!["choice", "boolean", "text"].includes(x.type))
        fail("Invalid question type");
      const question = {
        type: x.type,
        text: bounded(x.text, 1000, "question"),
        seconds: Number(x.seconds),
        points: Number(x.points),
        media: await validMedia(x.media),
      };
      question.mediaType = question.media
        ? (
            await db
              .prepare("SELECT mime FROM media WHERE id=?")
              .get(question.media.split("/").pop())
          ).mime
        : "";
      if (
        !Number.isInteger(question.seconds) ||
        question.seconds < 5 ||
        question.seconds > 120
      )
        fail("Timer must be 5–120 seconds.");
      if (
        !Number.isInteger(question.points) ||
        question.points < 100 ||
        question.points > 5000
      )
        fail("Points must be 100–5000.");
      if (x.type === "text") {
        if (
          !Array.isArray(x.accepted) ||
          !x.accepted.length ||
          x.accepted.length > 20
        )
          fail("Add 1–20 accepted answers.");
        question.accepted = x.accepted.map((a) =>
          bounded(a, 200, "accepted answer"),
        );
      } else {
        question.options = x.type === "boolean" ? ["True", "False"] : x.options;
        if (
          !Array.isArray(question.options) ||
          question.options.length < 2 ||
          question.options.length > 6
        )
          fail("Use 2–6 answer choices.");
        question.options = question.options.map((a) =>
          bounded(a, 200, "answer choice"),
        );
        question.correct =
          x.correct === null || x.correct === undefined || x.correct === ""
            ? -1
            : Number(x.correct);
        if (
          !Number.isInteger(question.correct) ||
          question.correct < 0 ||
          question.correct >= question.options.length
        )
          fail("Select a correct answer.");
      }
      round.questions.push(question);
    }
    q.rounds.push(round);
  }
  return q;
}
function sniff(b) {
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString()))
    return "image/gif";
  if (b.subarray(0, 4).toString() === "RIFF") {
    if (b.subarray(8, 12).toString() === "WEBP") return "image/webp";
    if (b.subarray(8, 12).toString() === "WAVE") return "audio/wav";
  }
  if (b.subarray(0, 4).toString() === "OggS") return "audio/ogg";
  if (
    b.subarray(0, 3).toString() === "ID3" ||
    (b[0] === 255 && (b[1] & 224) === 224)
  )
    return "audio/mpeg";
  return null;
}
let setupBusy = false;
const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
  );
  try {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;
    if (!["GET", "HEAD"].includes(req.method) && !sameOrigin(req))
      fail("Request origin not allowed.", 403);
    if (p === "/healthz" && req.method === "GET") {
      await db.prepare("SELECT 1 AS ok").get();
      return json(res, 200, { ok: true });
    }
    if (p === "/api/session" && req.method === "GET")
      return json(res, 200, {
        user: (await user(req)) || null,
        setupRequired: !(await db
          .prepare("SELECT id FROM admins LIMIT 1")
          .get()),
        setupEnabled,
      });
    if (p === "/api/setup" && req.method === "POST") {
      if (!setupEnabled || setupBusy) fail("Web setup is not available.", 403);
      rate("setup:" + peer(req), 5, 15 * 60 * 1000);
      setupBusy = true;
      try {
        if (await db.prepare("SELECT id FROM admins LIMIT 1").get())
          fail("Web setup is not available.", 403);
        const x = await data(req);
        const email = bounded(x.email, 254, "email").toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          fail("Enter a valid email.");
        if (
          typeof x.password !== "string" ||
          x.password.length < 12 ||
          x.password.length > 128
        )
          fail("Use a password with 12–128 characters.");
        const organization = bounded(x.organization, 120, "organization name");
        const password = await passwordHash(x.password);
        await db
          .prepare("INSERT INTO admins VALUES (?,?,?,?)")
          .run(crypto.randomUUID(), email, password, organization);
        return json(res, 201, {
          ok: true,
        });
      } finally {
        setupBusy = false;
      }
    }
    if (p === "/api/recover" && req.method === "POST") {
      rate("recover:" + peer(req), 8, 15 * 60 * 1000);
      const x = await data(req);
      const email = bounded(x.email, 254, "email").toLowerCase();
      const code = bounded(x.code, 100, "recovery code");
      if (
        typeof x.password !== "string" ||
        x.password.length < 12 ||
        x.password.length > 128
      )
        fail("Use a password with 12–128 characters.");
      const encoded = await passwordHash(x.password);
      const adminId = await db.withTransaction(async (tx) => {
        const row = await tx
          .prepare(
            "SELECT r.admin_id FROM recovery_codes r JOIN admins a ON a.id=r.admin_id WHERE r.digest=? AND a.email=?",
          )
          .get(hash(code), email);
        if (!row)
          fail(
            "Email or recovery code is invalid or has already been used.",
            401,
          );
        const used = await tx
          .prepare("DELETE FROM recovery_codes WHERE digest=? AND admin_id=?")
          .run(hash(code), row.admin_id);
        if (!used.changes)
          fail(
            "Email or recovery code is invalid or has already been used.",
            401,
          );
        await tx
          .prepare("UPDATE admins SET password=? WHERE id=?")
          .run(encoded, row.admin_id);
        await tx
          .prepare("DELETE FROM sessions WHERE admin_id=?")
          .run(row.admin_id);
        return row.admin_id;
      });
      for (const ws of wss.clients)
        if (ws.adminId === adminId) ws.close(1000, "Account recovered");
      return json(res, 200, { ok: true }, { "Set-Cookie": cookie(req, "", 0) });
    }
    if (p === "/api/login" && req.method === "POST") {
      rate("login:" + peer(req), 12, 15 * 60 * 1000);
      const x = await data(req);
      const email = bounded(x.email, 254, "email").toLowerCase();
      if (
        typeof x.password !== "string" ||
        !x.password ||
        x.password.length > 128
      )
        fail("Invalid password");
      const password = x.password;
      const admin = await db
        .prepare("SELECT * FROM admins WHERE email=?")
        .get(email);
      const fallback = "00".repeat(16) + ":" + "00".repeat(64);
      const matches = await passwordMatches(
        password,
        admin?.password || fallback,
      );
      if (!admin || !matches) fail("Email or password is incorrect.", 401);
      const t = crypto.randomBytes(32).toString("hex");
      await db
        .prepare("INSERT INTO sessions VALUES (?,?,?)")
        .run(hash(t), admin.id, Date.now() + SESSION_MS);
      return json(
        res,
        200,
        {
          ok: true,
        },
        {
          "Set-Cookie": cookie(req, t, SESSION_MS / 1000),
        },
      );
    }
    if (p === "/api/logout" && req.method === "POST") {
      const t = hash(token(req));
      await db.prepare("DELETE FROM sessions WHERE token=?").run(t);
      for (const ws of wss.clients)
        if (ws.sessionHash === t) ws.close(1000, "Signed out");
      return json(
        res,
        200,
        {
          ok: true,
        },
        {
          "Set-Cookie": cookie(req, "", 0),
        },
      );
    }
    if (p.startsWith("/api/")) {
      const admin = await requireUser(req);
      if (p === "/api/recovery-code" && req.method === "POST") {
        rate("recovery-code:" + admin.id, 5, 15 * 60 * 1000);
        const x = await data(req);
        const stored = await db
          .prepare("SELECT password FROM admins WHERE id=?")
          .get(admin.id);
        if (
          typeof x.password !== "string" ||
          x.password.length > 128 ||
          !(await passwordMatches(x.password, stored.password))
        )
          fail("Current password is incorrect.", 401);
        const code = crypto.randomBytes(24).toString("base64url");
        await db.withTransaction(async (tx) => {
          await tx
            .prepare("DELETE FROM recovery_codes WHERE admin_id=?")
            .run(admin.id);
          await tx
            .prepare("INSERT INTO recovery_codes VALUES (?,?,?)")
            .run(hash(code), admin.id, Date.now());
        });
        return json(res, 200, { code, email: admin.email });
      }
      if (p === "/api/backup" && req.method === "POST") {
        rate("backup:" + admin.id, 3, 60 * 60 * 1000);
        const x = await data(req);
        const stored = await db
          .prepare("SELECT password FROM admins WHERE id=?")
          .get(admin.id);
        if (
          typeof x.password !== "string" ||
          x.password.length > 128 ||
          !(await passwordMatches(x.password, stored.password))
        )
          fail("Current password is incorrect.", 401);
        res.writeHead(200, {
          "Content-Type": "application/zip",
          "Content-Disposition": "attachment; filename=quizzes-backup.zip",
          "Cache-Control": "no-store",
        });
        return await writeBackup(res);
      }
      if (p === "/api/storage-status" && req.method === "GET")
        return json(res, 200, {
          database: db.kind,
          media: mediaStore.remote ? "supabase" : "local",
          persistentCloud: db.kind === "postgres" && mediaStore.remote,
        });
      if (p === "/api/password" && req.method === "POST") {
        rate("password:" + admin.id, 6, 15 * 60 * 1000);
        const x = await data(req);
        const stored = await db
          .prepare("SELECT password FROM admins WHERE id=?")
          .get(admin.id);
        if (
          typeof x.oldPassword !== "string" ||
          x.oldPassword.length > 128 ||
          !(await passwordMatches(x.oldPassword, stored.password))
        )
          fail("Current password is incorrect.", 401);
        if (
          typeof x.password !== "string" ||
          x.password.length < 12 ||
          x.password.length > 128
        )
          fail("Use a password with 12–128 characters.");
        const password = await passwordHash(x.password);
        await db.withTransaction(async (tx) => {
          await tx
            .prepare("UPDATE admins SET password=? WHERE id=?")
            .run(password, admin.id);
          await tx
            .prepare("DELETE FROM sessions WHERE admin_id=?")
            .run(admin.id);
          await tx
            .prepare("DELETE FROM recovery_codes WHERE admin_id=?")
            .run(admin.id);
        });
        for (const ws of wss.clients)
          if (ws.adminId === admin.id) ws.close(1000, "Password changed");
        return json(
          res,
          200,
          {
            ok: true,
          },
          {
            "Set-Cookie": cookie(req, "", 0),
          },
        );
      }
      if (p === "/api/quiz-import" && req.method === "POST") {
        rate("document-import:" + admin.id, 30, 60 * 60 * 1000);
        let filename;
        try {
          filename = decodeURIComponent(
            String(req.headers["x-file-name"] || "questions.txt"),
          );
        } catch {
          fail("Invalid document filename.");
        }
        const extension = filename.split(".").at(-1).toLowerCase();
        const result = await importDocument(
          await body(req, 5 * 1024 * 1024),
          extension,
          filename.replace(/\.[^.]+$/, "").slice(0, 120),
        );
        return json(res, 200, result);
      }
      if (p === "/api/quizzes" && req.method === "GET")
        return json(
          res,
          200,
          (
            await db
              .prepare("SELECT document FROM quizzes ORDER BY updated DESC")
              .all()
          ).map((r) => JSON.parse(r.document)),
        );
      if (p === "/api/quizzes" && req.method === "POST") {
        const q = await validateQuiz(await data(req));
        await db
          .prepare("INSERT INTO quizzes VALUES (?,?,?)")
          .run(q.id, JSON.stringify(q), Date.now());
        return json(res, 201, q);
      }
      const match = p.match(/^\/api\/quizzes\/([a-f0-9-]+)$/);
      if (match) {
        if (
          !(await db.prepare("SELECT id FROM quizzes WHERE id=?").get(match[1]))
        )
          fail("Quiz not found.", 404);
        if (req.method === "PUT") {
          const q = await validateQuiz(await data(req), match[1]);
          await db
            .prepare("UPDATE quizzes SET document=?,updated=? WHERE id=?")
            .run(JSON.stringify(q), Date.now(), q.id);
          return json(res, 200, q);
        }
        if (req.method === "DELETE") {
          await db.prepare("DELETE FROM quizzes WHERE id=?").run(match[1]);
          return json(res, 200, {
            ok: true,
          });
        }
      }
      if (p === "/api/media" && req.method === "POST") {
        rate("upload:" + admin.id, 60, 60 * 60 * 1000);
        const b = await body(req, 10 * 1024 * 1024);
        const mime = sniff(b);
        if (!mime) fail("Upload PNG, JPEG, GIF, WebP, MP3, WAV, or OGG.");
        const id = crypto.randomUUID();
        const name = String(req.headers["x-file-name"] || "Media").slice(
          0,
          240,
        );
        await mediaStore.write(id, b, mime);
        await db
          .prepare("INSERT INTO media VALUES (?,?,?)")
          .run(id, mime, name);
        return json(res, 201, {
          url: "/media/" + id,
          mime,
        });
      }
      if (p === "/api/reports" && req.method === "GET")
        return json(
          res,
          200,
          (
            await db
              .prepare("SELECT document FROM reports ORDER BY ended DESC")
              .all()
          ).map((r) => JSON.parse(r.document)),
        );
      fail("API endpoint not found.", 404);
    }
    if (p.startsWith("/media/")) {
      const id = p.slice(7);
      const m = await db.prepare("SELECT * FROM media WHERE id=?").get(id);
      if (!m) fail("Not found", 404);
      return await mediaStore.serve(req, res, id, m.mime);
    }
    const files = {
      "/": "index.html",
      "/join": "index.html",
      "/index.html": "index.html",
      "/styles.css": "styles.css",
      "/app.js": "app.js",
      "/quiz-sound.js": "quiz-sound.js",
    };
    if (!files[p] || !["GET", "HEAD"].includes(req.method))
      fail("Not found", 404);
    const type = p.endsWith(".css")
      ? "text/css"
      : p.endsWith(".js")
        ? "text/javascript"
        : "text/html";
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(path.join(__dirname, files[p])).pipe(res);
  } catch (e) {
    if (!res.headersSent)
      json(res, e.status || 500, {
        error: e.status ? e.message : "Something went wrong. Please try again.",
      });
    else res.end();
    if (!e.status)
      console.error("A request failed. Check database/media availability.");
  }
});
function send(ws, type, data = {}) {
  if (ws?.readyState === 1)
    ws.send(
      JSON.stringify({
        type,
        ...data,
      }),
    );
}
function broadcast(g, type, data = {}) {
  g.clients.forEach((ws) => send(ws, type, data));
}
function current(g) {
  return g.questions[g.index];
}
function ranking(g) {
  return [...g.players.values()]
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({
      id: p.id,
      rank: i + 1,
      name: p.name,
      score: p.score,
    }));
}
function state(g) {
  return {
    code: g.code,
    title: g.quiz.title,
    status: g.status,
    index: g.index,
    total: g.questions.length,
    deadline: g.deadline,
    participants: [...g.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      answered: p.answered,
      connected: !!p.ws && p.ws.readyState === 1,
    })),
  };
}
function question(g) {
  const q = current(g);
  if (!q) return null;
  return {
    id: `${g.code}:${g.index}`,
    text: q.text,
    type: q.type,
    options: q.options,
    media: q.media,
    mediaType: q.mediaType,
    seconds: q.seconds,
    points: q.points,
    round: q.round,
    roundIndex: q.roundIndex,
    roundCount: g.quiz.rounds.length,
    index: g.index,
    total: g.questions.length,
  };
}
function result(g) {
  const q = current(g);
  return {
    correct: q.type === "text" ? q.accepted.join(" / ") : q.options[q.correct],
    leaderboard: ranking(g),
    stats: g.stats,
  };
}
function finishQuestion(g) {
  if (g.status !== "question") return;
  clearTimeout(g.timer);
  g.status = "results";
  for (const p of g.players.values()) {
    p.score += p.pending || 0;
    p.pending = 0;
  }
  broadcast(g, "question_ended", {
    game: state(g),
    ...result(g),
  });
}
async function endGame(g, reason = "Host ended the game") {
  if (["ended", "ending"].includes(g.status)) return;
  if (g.status === "question") finishQuestion(g);
  clearTimeout(g.timer);
  clearTimeout(g.orphanTimer);
  const previousStatus = g.status;
  g.status = "ending";
  const report = {
    id: g.reportId || (g.reportId = crypto.randomUUID()),
    title: g.quiz.title,
    code: g.code,
    quizSnapshot: g.quiz,
    started: g.created,
    ended: Date.now(),
    reason,
    questionsPlayed: g.index + 1,
    questionCount: g.questions.length,
    players: g.players.size,
    leaderboard: ranking(g),
    answers: g.history,
  };
  try {
    await db
      .prepare("INSERT INTO reports VALUES (?,?,?) ON CONFLICT (id) DO NOTHING")
      .run(report.id, JSON.stringify(report), report.ended);
  } catch (e) {
    g.status = previousStatus;
    throw e;
  }
  g.status = "ended";
  broadcast(g, "game_ended", {
    game: state(g),
    leaderboard: ranking(g),
    reportId: report.id,
  });
  g.expiry = setTimeout(
    () => {
      for (const ws of g.clients) ws.close(1000, "Session finished");
      games.delete(g.code);
    },
    10 * 60 * 1000,
  );
}
async function startQuestion(g) {
  if (!["lobby", "results"].includes(g.status))
    fail("Wait for the current question to finish.");
  if (g.index + 1 >= g.questions.length)
    return await endGame(g, "Quiz completed");
  g.index++;
  g.status = "question";
  g.startedAt = Date.now();
  g.deadline = g.startedAt + current(g).seconds * 1000;
  g.stats = {};
  for (const p of g.players.values()) {
    p.answered = false;
    p.pending = 0;
  }
  broadcast(g, "question_started", {
    game: state(g),
    question: question(g),
  });
  g.timer = setTimeout(() => finishQuestion(g), current(g).seconds * 1000);
}
function sync(ws, g, type, extra = {}) {
  send(ws, type, {
    game: state(g),
    question: g.status === "question" ? question(g) : null,
    result: g.status === "results" ? result(g) : null,
    leaderboard: g.status === "ended" ? ranking(g) : null,
    serverNow: Date.now(),
    ...extra,
  });
}
function normalize(s) {
  return s
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en");
}
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 16384,
});
server.on("upgrade", (req, socket, head) => {
  try {
    if (
      new URL(req.url, "http://localhost").pathname !== "/live" ||
      !sameOrigin(req)
    )
      throw Error();
    rate("connect:" + peer(req), 400, 60000);
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  } catch {
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  }
});
wss.on("connection", (ws, req) => {
  ws.alive = true;
  ws.on("pong", () => (ws.alive = true));
  const handleMessage = async (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (!msg || typeof msg.type !== "string") fail("Invalid message.");
      const now = Date.now();
      if (!ws.rate || ws.rate.until < now)
        ws.rate = {
          n: 0,
          until: now + 60000,
        };
      if (++ws.rate.n > 120) fail("Too many messages.", 429);
      if (msg.type === "ping")
        return send(ws, "clock", {
          serverNow: Date.now(),
        });
      if (msg.type === "create_game") {
        const admin = await requireUser(req);
        if (ws.readyState !== 1) return;
        if (ws.game) fail("Already in a game.");
        if (
          [...games.values()].filter(
            (g) => g.adminId === admin.id && g.status !== "ended",
          ).length >= 3
        )
          fail("End an existing game first (maximum 3).");
        const row = await db
          .prepare("SELECT document FROM quizzes WHERE id=?")
          .get(String(msg.quizId || ""));
        if (ws.readyState !== 1) return;
        if (!row) fail("Choose a saved quiz.");
        const quiz = JSON.parse(row.document);
        let code;
        do {
          code =
            "QZ" +
            crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
        } while (games.has(code));
        const hostToken = crypto.randomBytes(32).toString("hex");
        const g = {
          code,
          quiz,
          adminId: admin.id,
          hostToken,
          host: ws,
          created: Date.now(),
          status: "lobby",
          index: -1,
          deadline: null,
          questions: quiz.rounds.flatMap((r, i) =>
            r.questions.map((q) => ({
              ...q,
              round: r.title,
              roundIndex: i,
            })),
          ),
          clients: new Set([ws]),
          players: new Map(),
          history: [],
          stats: {},
        };
        games.set(code, g);
        ws.game = g;
        ws.role = "host";
        ws.adminId = admin.id;
        ws.sessionHash = hash(token(req));
        return sync(ws, g, "game_created", {
          hostToken,
          music: quiz.music,
        });
      }
      if (msg.type === "resume_host") {
        const admin = await requireUser(req);
        if (ws.readyState !== 1) return;
        const g = games.get(msg.code);
        if (!g || g.adminId !== admin.id || msg.hostToken !== g.hostToken)
          fail("Unable to resume this game.");
        if (g.host && g.host !== ws)
          g.host.close(4000, "Host moved to another connection");
        clearTimeout(g.orphanTimer);
        g.host = ws;
        g.clients.add(ws);
        ws.game = g;
        ws.role = "host";
        ws.adminId = admin.id;
        ws.sessionHash = hash(token(req));
        broadcast(g, "host_online", {});
        return sync(ws, g, "host_resumed", {
          music: g.quiz.music,
        });
      }
      if (msg.type === "join_game" || msg.type === "resume_player") {
        if (ws.game) fail("Already in a game.");
        const g = games.get(
          String(msg.code || "")
            .trim()
            .toUpperCase(),
        );
        if (!g) fail("Game not found. Check the code.");
        let p;
        if (msg.type === "resume_player") {
          p = [...g.players.values()].find(
            (p) => p.resumeToken === msg.playerToken,
          );
          if (!p) fail("This player session has expired. Please join again.");
          if (p.ws && p.ws !== ws)
            p.ws.close(4000, "Player moved to another connection");
        } else {
          if (g.status === "ended") fail("This game has ended.");
          if (g.players.size >= 100) fail("This game is full (100 players).");
          const name = bounded(msg.name, 30, "nickname");
          if (
            [...g.players.values()].some(
              (p) => normalize(p.name) === normalize(name),
            )
          )
            fail("That nickname is taken. Try another.");
          p = {
            id: crypto.randomUUID(),
            name,
            score: 0,
            answered: false,
            pending: 0,
            resumeToken: crypto.randomBytes(32).toString("hex"),
          };
          g.players.set(p.id, p);
        }
        p.ws = ws;
        ws.game = g;
        ws.role = "player";
        ws.playerId = p.id;
        g.clients.add(ws);
        sync(ws, g, "joined", {
          music: g.quiz.music,
          playerId: p.id,
          playerToken: p.resumeToken,
          answered: p.answered,
        });
        return broadcast(g, "participants_updated", {
          game: state(g),
        });
      }
      const g = ws.game;
      if (!g) fail("Join a game first.");
      if (ws.role === "host") {
        const admin = await requireUser(req);
        if (ws.readyState !== 1) return;
        if (admin.id !== g.adminId || g.host !== ws)
          fail("Not authorized.", 403);
        if (msg.type === "start_question" || msg.type === "next_question")
          return await startQuestion(g);
        if (msg.type === "reveal_answers") return finishQuestion(g);
        if (msg.type === "end_game") return await endGame(g);
      }
      if (msg.type === "submit_answer" && ws.role === "player") {
        const p = g.players.get(ws.playerId);
        if (g.status !== "question" || Date.now() >= g.deadline)
          fail("The answer window has closed.");
        if (msg.questionId !== question(g).id)
          fail("This answer belongs to an older question.");
        if (p.answered) fail("Your answer is already locked in.");
        const q = current(g);
        let answer = msg.answer;
        let correct;
        if (q.type === "text") {
          answer = bounded(answer, 200, "answer");
          correct = q.accepted.some((a) => normalize(a) === normalize(answer));
        } else {
          if (
            !Number.isInteger(answer) ||
            answer < 0 ||
            answer >= q.options.length
          )
            fail("Choose a valid answer.");
          correct = answer === q.correct;
        }
        const elapsed = Date.now() - g.startedAt;
        const points = correct
          ? Math.max(
              100,
              Math.round(q.points * (1 - (0.5 * elapsed) / (q.seconds * 1000))),
            )
          : 0;
        p.answered = true;
        p.pending = points;
        g.history.push({
          playerId: p.id,
          questionIndex: g.index,
          answer,
          correct,
          points,
          elapsedMs: elapsed,
        });
        if (q.type !== "text") g.stats[answer] = (g.stats[answer] || 0) + 1;
        send(ws, "answer_received", {
          accepted: true,
        });
        return broadcast(g, "participants_updated", {
          game: state(g),
        });
      }
      fail("Action is not available.");
    } catch (e) {
      send(ws, "error", {
        message:
          e.status || e instanceof SyntaxError
            ? e.message
            : "Unable to complete that action.",
      });
    }
  };
  let messages = Promise.resolve();
  let pending = 0;
  ws.on("message", (raw) => {
    if (++pending > 12) {
      pending--;
      return ws.close(1008, "Too many pending actions");
    }
    messages = messages
      .then(() => handleMessage(raw))
      .catch(() => send(ws, "error", { message: "Unable to process action." }))
      .finally(() => pending--);
  });
  ws.on("close", () => {
    const g = ws.game;
    if (!g) return;
    g.clients.delete(ws);
    if (ws.role === "player") {
      const p = g.players.get(ws.playerId);
      if (p.ws === ws) p.ws = null;
      broadcast(g, "participants_updated", {
        game: state(g),
      });
    }
    if (ws.role === "host" && g.host === ws) {
      g.host = null;
      if (g.status !== "ended") {
        broadcast(g, "host_offline", {
          message: "Host disconnected. They can reconnect to continue.",
        });
        g.orphanTimer = setTimeout(
          () =>
            endGame(g, "Host disconnected for 5 minutes").catch(() =>
              console.error("Could not save a disconnected game report."),
            ),
          5 * 60 * 1000,
        );
      }
    }
  });
});
const heartbeat = setInterval(async () => {
  for (const ws of wss.clients) {
    if (!ws.alive) {
      ws.terminate();
      continue;
    }
    ws.alive = false;
    ws.ping();
  }
  try {
    await db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
  } catch {
    console.error("Session cleanup deferred: database unavailable.");
  }
  for (const [k, v] of limits) if (v.until < Date.now()) limits.delete(k);
}, 30000);
console.log(
  "Quizzes startup diagnostics v1 (credential values are never logged)",
);
checkStartup([
  { stage: "DATABASE_SCHEMA", promise: databaseReady },
  { stage: "MEDIA_BUCKET_VALIDATE", promise: mediaStore.ready },
])
  .then((healthy) => {
    if (!healthy) {
      console.error(
        "Startup stopped. Resolve the failed check(s) above and redeploy; no credentials were logged.",
      );
      process.exit(1);
    }
    server.listen(PORT, "0.0.0.0", () =>
      console.log(
        `Quizzes listening on 0.0.0.0:${PORT} · ${db.kind} · ${mediaStore.remote ? "persistent cloud media" : "local media"}${setupEnabled ? " · private-preview first-run setup enabled" : ""}`,
      ),
    );
  })
  .catch((error) => {
    logStartupFailure("SERVER_STARTUP", error);
    process.exit(1);
  });
server.on("error", (error) => {
  logStartupFailure("SERVER_LISTEN", error);
  process.exit(1);
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(heartbeat);
  for (const g of games.values()) {
    try {
      if (g.status !== "ended") await endGame(g, "Server stopped");
    } catch {
      console.error("Could not save an interrupted game.");
    }
    clearTimeout(g.expiry);
    clearTimeout(g.orphanTimer);
    clearTimeout(g.timer);
  }
  for (const ws of wss.clients) ws.terminate();
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
