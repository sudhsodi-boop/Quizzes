"use strict";
const crypto = require("node:crypto");
const { grade, solution, roundLabel } = require("./quiz-rules");
module.exports = function workspaceFeatures({
  db,
  user,
  requireUser,
  owns,
  hash,
  passwordHash,
  cookie,
  json,
  data,
  fail,
  bounded,
  rate,
  peer,
}) {
  const signingKey = crypto.randomBytes(32);
  const sig = (id, until) =>
    crypto
      .createHmac("sha256", signingKey)
      .update(id + ":" + until)
      .digest("hex");
  function mediaURL(url) {
    if (!url) return "";
    const id = url.split("/").pop();
    const until = Date.now() + 2 * 60 * 60 * 1000;
    return `/media/${id}?until=${until}&grant=${sig(id, until)}`;
  }
  async function mediaAccess(req, id) {
    const host = await user(req);
    if (host && (await owns("media", id, host.id))) return true;
    const u = new URL(req.url, "http://local");
    const until = Number(u.searchParams.get("until"));
    const grant = u.searchParams.get("grant") || "";
    return (
      until > Date.now() &&
      until < Date.now() + 2 * 60 * 60 * 1000 + 1000 &&
      /^[a-f0-9]{64}$/.test(grant) &&
      crypto.timingSafeEqual(
        Buffer.from(grant, "hex"),
        Buffer.from(sig(id, until), "hex"),
      )
    );
  }
  const send = (res, value, status = 200, headers = {}) => {
    json(res, status, value, headers);
    return true;
  };
  const browser = (req) =>
    (req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => /^quizzes_attempt=[a-f0-9]{64}$/.test(x))
      ?.split("=")[1];
  const lock = db.kind === "postgres" ? " FOR UPDATE" : "";
  function flat(pub) {
    return JSON.parse(pub.document).rounds.flatMap((r, ri) =>
      r.questions.map((q) => ({ ...q, round: roundLabel(ri, r.title) })),
    );
  }
  function safeQuestion(q, index) {
    return {
      index,
      type: q.type,
      text: q.text,
      options: q.options,
      points: q.points,
      round: q.round,
      media: mediaURL(q.media),
      mediaType: q.mediaType,
    };
  }
  function publicState(pub, attempt) {
    const quiz = JSON.parse(pub.document),
      questions = flat(pub),
      closed = Date.now() >= Number(pub.closes);
    const state = attempt ? JSON.parse(attempt.document) : null;
    const result = {
      id: pub.id,
      title: quiz.title,
      description: quiz.description,
      closes: Number(pub.closes),
      closed,
      total: questions.length,
      rounds: quiz.rounds.length,
    };
    if (state) {
      result.attempt = {
        name: attempt.name,
        cursor: state.answers.length,
        completed: state.completed,
        closed,
      };
      if (!closed && !state.completed)
        result.question = safeQuestion(
          questions[state.answers.length],
          state.answers.length,
        );
      if (closed) {
        result.attempt.score = state.score;
        result.solutions = questions.map((q, i) => ({
          ...safeQuestion(q, i),
          correct: solution(q),
          yourAnswer: state.answers[i]?.answer ?? null,
          pointsEarned: state.answers[i]?.points || 0,
        }));
      }
    }
    return result;
  }
  async function getPub(id, tx = db) {
    const pub = await tx
      .prepare("SELECT * FROM publications WHERE id=?")
      .get(id);
    if (!pub) fail("Published quiz not found.", 404);
    return pub;
  }
  async function handle(req, res, p) {
    if (p === "/api/invitations/redeem" && req.method === "POST") {
      rate("redeem:" + peer(req), 8, 15 * 60 * 1000);
      const x = await data(req);
      if (typeof x.invite !== "string" || !/^[a-f0-9]{64}$/.test(x.invite))
        fail("Invitation is invalid or expired.");
      const digest = hash(x.invite),
        invite = await db
          .prepare("SELECT * FROM invitations WHERE digest=?")
          .get(digest);
      if (
        !invite ||
        Number(invite.used) ||
        Number(invite.expires) <= Date.now()
      )
        fail("Invitation is invalid or expired.");
      const email = bounded(x.email, 254, "email").toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        fail("Enter a valid email.");
      if (
        typeof x.password !== "string" ||
        x.password.length < 12 ||
        x.password.length > 128
      )
        fail("Use a 12–128 character password.");
      const org = bounded(x.organization, 120, "workspace name"),
        encoded = await passwordHash(x.password),
        id = crypto.randomUUID(),
        session = crypto.randomBytes(32).toString("hex");
      await db.withTransaction(async (tx) => {
        const row = await tx
          .prepare("SELECT * FROM invitations WHERE digest=?" + lock)
          .get(digest);
        if (!row || Number(row.used) || Number(row.expires) <= Date.now())
          fail("Invitation is invalid or already used.");
        if (await tx.prepare("SELECT id FROM admins WHERE email=?").get(email))
          fail("This email already has an account. Sign in instead.");
        await tx
          .prepare("INSERT INTO admins VALUES (?,?,?,?)")
          .run(id, email, encoded, org);
        await tx
          .prepare("UPDATE invitations SET used=? WHERE digest=?")
          .run(Date.now(), digest);
        await tx
          .prepare("INSERT INTO sessions VALUES (?,?,?)")
          .run(hash(session), id, Date.now() + 12 * 60 * 60 * 1000);
      });
      return send(res, { ok: true }, 201, {
        "Set-Cookie": cookie(req, session, 12 * 60 * 60),
      });
    }
    if (p === "/api/invitations" && req.method === "POST") {
      const host = await requireUser(req);
      rate("invite:" + host.id, 5, 24 * 60 * 60 * 1000);
      const secret = crypto.randomBytes(32).toString("hex"),
        expires = Date.now() + 24 * 60 * 60 * 1000;
      await db
        .prepare("INSERT INTO invitations VALUES (?,?,?,?)")
        .run(hash(secret), host.id, expires, 0);
      return send(res, { path: "/invite#" + secret, expires }, 201);
    }
    if (p === "/api/publications") {
      const host = await requireUser(req);
      if (req.method === "POST") {
        rate("publish:" + host.id, 20, 24 * 60 * 60 * 1000);
        const x = await data(req);
        if (!(await owns("quizzes", String(x.quizId), host.id)))
          fail("Quiz not found.", 404);
        const row = await db
          .prepare("SELECT document FROM quizzes WHERE id=?")
          .get(x.quizId);
        if (!row) fail("Quiz not found.", 404);
        const id = crypto.randomBytes(16).toString("hex"),
          created = Date.now(),
          closes = created + 24 * 60 * 60 * 1000;
        await db
          .prepare("INSERT INTO publications VALUES (?,?,?,?,?)")
          .run(id, host.id, row.document, created, closes);
        return send(res, { id, path: "/play?quiz=" + id, closes }, 201);
      }
      if (req.method === "GET") {
        const rows = await db
          .prepare(
            "SELECT * FROM publications WHERE owner_id=? ORDER BY created DESC",
          )
          .all(host.id);
        const result = [];
        for (const row of rows)
          result.push({
            id: row.id,
            title: JSON.parse(row.document).title,
            created: Number(row.created),
            closes: Number(row.closes),
            participants: Number(
              (
                await db
                  .prepare(
                    "SELECT COUNT(*) AS n FROM attempts WHERE publication_id=?",
                  )
                  .get(row.id)
              ).n,
            ),
          });
        return send(res, result);
      }
    }
    const own = p.match(
      /^\/api\/publications\/([a-f0-9]{32})(?:\/(close|results))?$/,
    );
    if (own) {
      const host = await requireUser(req),
        pub = await getPub(own[1]);
      if (pub.owner_id !== host.id) fail("Published quiz not found.", 404);
      if (own[2] === "close" && req.method === "POST") {
        await db
          .prepare("UPDATE publications SET closes=? WHERE id=?")
          .run(Math.min(Date.now(), Number(pub.closes)), pub.id);
        return send(res, { ok: true });
      }
      if (own[2] === "results" && req.method === "GET") {
        const attempts = await db
          .prepare(
            "SELECT * FROM attempts WHERE publication_id=? ORDER BY updated ASC",
          )
          .all(pub.id);
        const rows = attempts
          .map((a) => {
            const d = JSON.parse(a.document);
            return {
              id: a.id,
              name: a.name,
              score: d.score,
              answered: d.answers.length,
              status: d.completed
                ? "Completed"
                : Date.now() >= Number(pub.closes)
                  ? "Closed incomplete"
                  : "In progress",
              answers: d.answers,
            };
          })
          .sort((a, b) => b.score - a.score)
          .map((a, i) => ({ ...a, rank: i + 1 }));
        return send(res, {
          title: JSON.parse(pub.document).title,
          closes: Number(pub.closes),
          closed: Date.now() >= Number(pub.closes),
          total: flat(pub).length,
          leaderboard: rows,
        });
      }
    }
    const match = p.match(
      /^\/api\/published\/([a-f0-9]{32})(?:\/(join|answer))?$/,
    );
    if (!match) {
      if (p.startsWith("/api/published/"))
        fail("Published quiz not found.", 404);
      return false;
    }
    const id = match[1],
      b = browser(req);
    if (req.method === "GET" && !match[2]) {
      const pub = await getPub(id);
      const attempt = b
        ? await db
            .prepare(
              "SELECT * FROM attempts WHERE publication_id=? AND browser_hash=?",
            )
            .get(id, hash(b))
        : null;
      const headers = b
        ? {}
        : {
            "Set-Cookie": cookie(
              req,
              crypto.randomBytes(32).toString("hex"),
              180 * 24 * 60 * 60,
            ).replace("quizzes_session=", "quizzes_attempt="),
          };
      return send(res, publicState(pub, attempt), 200, headers);
    }
    if (req.method !== "POST") return false;
    if (!b) fail("Allow cookies and reload this page before starting.");
    rate("async:" + hash(b), 500, 60 * 60 * 1000);
    const x = await data(req);
    let state;
    await db.withTransaction(async (tx) => {
      const pub = await tx
        .prepare("SELECT * FROM publications WHERE id=?" + lock)
        .get(id);
      if (!pub) fail("Published quiz not found.", 404);
      if (Number(pub.closes) <= Date.now())
        fail("This quiz has closed. Reload to view your results.", 409);
      let attempt = await tx
        .prepare(
          "SELECT * FROM attempts WHERE publication_id=? AND browser_hash=?",
        )
        .get(id, hash(b));
      if (match[2] === "join") {
        if (!attempt) {
          if (
            Number(
              (
                await tx
                  .prepare(
                    "SELECT COUNT(*) AS n FROM attempts WHERE publication_id=?",
                  )
                  .get(id)
              ).n,
            ) >= 100
          )
            fail("This published quiz has reached its 100-attempt limit.");
          const name = bounded(x.name, 30, "nickname");
          attempt = {
            id: crypto.randomUUID(),
            publication_id: id,
            browser_hash: hash(b),
            name,
            document: JSON.stringify({
              answers: [],
              score: 0,
              completed: false,
            }),
            updated: Date.now(),
          };
          await tx
            .prepare("INSERT INTO attempts VALUES (?,?,?,?,?,?)")
            .run(
              attempt.id,
              id,
              hash(b),
              name,
              attempt.document,
              attempt.updated,
            );
        }
      } else if (match[2] === "answer") {
        if (!attempt) fail("Join the quiz first.", 403);
        const progress = JSON.parse(attempt.document),
          questions = flat(pub);
        if (progress.completed || x.index !== progress.answers.length)
          fail(
            "This question was already submitted or changed. Reload to resume.",
            409,
          );
        const q = questions[progress.answers.length];
        const credit = x.skip === true ? 0 : grade(q, x.answer);
        const points = Math.round(q.points * credit);
        progress.answers.push({
          index: x.index,
          answer: x.skip === true ? null : x.answer,
          credit,
          points,
        });
        progress.score += points;
        progress.completed = progress.answers.length === questions.length;
        attempt.document = JSON.stringify(progress);
        await tx
          .prepare("UPDATE attempts SET document=?,updated=? WHERE id=?")
          .run(attempt.document, Date.now(), attempt.id);
      } else fail("Action not found.", 404);
      state = publicState(pub, attempt);
    });
    return send(res, state);
  }
  return { handle, mediaURL, mediaAccess };
};
