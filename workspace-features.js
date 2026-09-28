"use strict";
const crypto = require("node:crypto");
const { grade, solution, roundLabel } = require("./quiz-rules");
module.exports = function workspaceFeatures({
  db,
  user,
  requireUser,
  owns,
  isSiteAdmin,
  hash,
  passwordHash,
  cookie,
  json,
  data,
  fail,
  bounded,
  rate,
  peer,
  saveQuizEdit,
  uploadMedia,
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
    if (host && (isSiteAdmin(host) || (await owns("media", id, host.id))))
      return true;
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
  function publicationSettings(pub) {
    const settings = JSON.parse(pub.document).publicationSettings || {};
    return {
      timerEnabled: settings.timerEnabled === true,
      randomizeAnswers: settings.randomizeAnswers === true,
    };
  }
  function answerOrder(q, index, settings, progress) {
    const order = (q.options || []).map((_, i) => i);
    if (!settings.randomizeAnswers || !progress.shuffleSeed) return order;
    const bytes = crypto
      .createHmac("sha256", progress.shuffleSeed)
      .update(String(index))
      .digest();
    for (let i = order.length - 1; i > 0; i--) {
      const j = bytes[i] % (i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  }
  function startAttemptQuestion(pub, progress) {
    const q = flat(pub)[progress.answers.length];
    progress.deadline =
      publicationSettings(pub).timerEnabled && q
        ? Math.min(Date.now() + q.seconds * 1000, Number(pub.closes))
        : 0;
  }
  function recordAnswer(
    pub,
    progress,
    answer,
    skipped = false,
    timedOut = false,
  ) {
    const questions = flat(pub),
      index = progress.answers.length,
      q = questions[index];
    const credit = skipped || timedOut ? 0 : grade(q, answer);
    const points = Math.round(q.points * credit);
    progress.answers.push({
      index,
      answer: skipped || timedOut ? null : answer,
      credit,
      points,
      timedOut,
    });
    progress.score += points;
    progress.completed = progress.answers.length === questions.length;
    progress.deadline = 0;
  }
  async function saveProgress(tx, attempt, progress) {
    attempt.document = JSON.stringify(progress);
    await tx
      .prepare("UPDATE attempts SET document=?,updated=? WHERE id=?")
      .run(attempt.document, Date.now(), attempt.id);
  }
  async function settleExpired(tx, pub, attempt) {
    if (
      !attempt ||
      Number(pub.closes) <= Date.now() ||
      !publicationSettings(pub).timerEnabled
    )
      return;
    const progress = JSON.parse(attempt.document);
    if (
      !progress.completed &&
      progress.deadline &&
      Date.now() >= progress.deadline
    ) {
      recordAnswer(pub, progress, null, true, true);
      await saveProgress(tx, attempt, progress);
    }
  }
  async function publicState(pub, attempt, tx = db) {
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
      music: !closed ? mediaURL(quiz.music) : "",
      serverNow: Date.now(),
      settings: publicationSettings(pub),
    };
    if (state) {
      result.attempt = {
        name: attempt.name,
        cursor: state.answers.length,
        completed: state.completed,
        closed,
        score: state.score,
      };
      result.awaitingNext =
        !closed &&
        !state.completed &&
        result.settings.timerEnabled &&
        !state.deadline;
      if (!closed && !state.completed && !result.awaitingNext) {
        const index = state.answers.length,
          q = questions[index];
        result.question = safeQuestion(q, index);
        result.question.options = answerOrder(
          q,
          index,
          result.settings,
          state,
        ).map((i) => q.options[i]);
        result.question.seconds = q.seconds;
        result.question.deadline = state.deadline || null;
      }
      {
        // Never reveal unsubmitted questions while a publication is open.
        result.solutions = questions
          .slice(0, closed ? questions.length : state.answers.length)
          .map((q, i) => ({
            ...safeQuestion(q, i),
            correct: solution(q),
            yourAnswer: state.answers[i]?.answer ?? null,
            pointsEarned: state.answers[i]?.points || 0,
            credit: state.answers[i]?.credit || 0,
            timedOut: state.answers[i]?.timedOut === true,
          }));
      }
    }
    if (state?.completed) {
      const rows = await tx
        .prepare(
          "SELECT id,name,document,updated FROM attempts WHERE publication_id=? ORDER BY updated ASC,id ASC",
        )
        .all(pub.id);
      // Public rankings contain nicknames and scores only, never another person's answers or tokens.
      let previousScore = null,
        rank = 0;
      result.leaderboard = rows
        .map((row) => ({ ...row, progress: JSON.parse(row.document) }))
        .filter((row) => row.progress.completed)
        .sort((a, b) => b.progress.score - a.progress.score)
        .map((row, index) => {
          if (row.progress.score !== previousScore) rank = index + 1;
          previousScore = row.progress.score;
          return {
            rank,
            name: row.name,
            score: row.progress.score,
            isYou: row.id === attempt.id,
          };
        });
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
    if (p.startsWith("/api/oversight")) {
      const host = await requireUser(req);
      if (!isSiteAdmin(host)) fail("Site administrator access required.", 403);
      const edit = p.match(
        /^\/api\/oversight\/workspaces\/([a-f0-9-]+)\/quizzes\/([a-f0-9-]+)(\/media)?$/,
      );
      if (edit) {
        const owner = await db
          .prepare("SELECT id,organization FROM admins WHERE id=?")
          .get(edit[1]);
        if (!owner || !(await owns("quizzes", edit[2], owner.id)))
          fail("Quiz not found.", 404);
        const stored = await db
          .prepare("SELECT document FROM quizzes WHERE id=?")
          .get(edit[2]);
        if (!stored) fail("Quiz not found.", 404);
        if (edit[3]) {
          if (req.method !== "POST") fail("Action not available.", 405);
          await uploadMedia(req, res, owner.id, host.id);
          return true;
        }
        if (req.method === "GET")
          return send(res, {
            ...JSON.parse(stored.document),
            _oversightOwner: owner.id,
            _oversightLabel: owner.organization,
          });
        if (req.method === "PUT") {
          rate("oversight-edit:" + host.id, 120, 60000);
          await saveQuizEdit(req, res, owner.id, edit[2], host, true);
          return true;
        }
        fail(
          "Deleting or creating another host's quiz is not available in admin oversight.",
          405,
        );
      }
      if (req.method !== "GET")
        fail("This oversight action is view-only.", 405);
      if (p === "/api/oversight/workspaces")
        return send(
          res,
          await db
            .prepare("SELECT id,email,organization FROM admins ORDER BY email")
            .all(),
        );
      const match = p.match(/^\/api\/oversight\/workspaces\/([a-f0-9-]+)$/);
      if (!match) fail("Not found.", 404);
      const owner = await db
        .prepare("SELECT id,email,organization FROM admins WHERE id=?")
        .get(match[1]);
      if (!owner) fail("Workspace not found.", 404);
      const result = { owner };
      for (const kind of ["quizzes", "reports"])
        result[kind] = (
          await db
            .prepare(
              "SELECT document FROM " +
                kind +
                " WHERE id IN (SELECT item_id FROM ownership WHERE kind=? AND owner_id=?)",
            )
            .all(kind, owner.id)
        ).map((r) => JSON.parse(r.document));
      result.publications = (
        await db
          .prepare(
            "SELECT id,document,created,closes FROM publications WHERE owner_id=? ORDER BY created DESC",
          )
          .all(owner.id)
      ).map((r) => ({
        id: r.id,
        title: JSON.parse(r.document).title,
        created: Number(r.created),
        closes: Number(r.closes),
      }));
      return send(res, result);
    }
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
          closes = x.closes ?? created + 24 * 60 * 60 * 1000;
        if (
          !Number.isSafeInteger(closes) ||
          closes <= created ||
          closes > created + 365 * 24 * 60 * 60 * 1000
        )
          fail("Choose a future closing time, no more than one year from now.");
        for (const key of ["timerEnabled", "randomizeAnswers"])
          if (x[key] !== undefined && typeof x[key] !== "boolean")
            fail("Invalid publication option.");
        const snapshot = JSON.parse(row.document);
        snapshot.publicationSettings = {
          timerEnabled: x.timerEnabled === true,
          randomizeAnswers: x.randomizeAnswers === true,
        };
        await db
          .prepare("INSERT INTO publications VALUES (?,?,?,?,?)")
          .run(id, host.id, JSON.stringify(snapshot), created, closes);
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
            settings: publicationSettings(row),
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
      /^\/api\/publications\/([a-f0-9]{32})(?:\/(close|results|extend))?$/,
    );
    if (own) {
      const host = await requireUser(req),
        pub = await getPub(own[1]);
      if (
        pub.owner_id !== host.id &&
        !(own[2] === "results" && req.method === "GET" && isSiteAdmin(host))
      )
        fail("Published quiz not found.", 404);
      if (
        (["close", "extend"].includes(own[2]) && req.method === "POST") ||
        (!own[2] && req.method === "DELETE")
      ) {
        const x = req.method === "POST" ? await data(req) : {};
        let closes;
        await db.withTransaction(async (tx) => {
          const current = await tx
            .prepare("SELECT * FROM publications WHERE id=?" + lock)
            .get(pub.id);
          if (!current || current.owner_id !== host.id)
            fail("Published quiz not found.", 404);
          const now = Date.now();
          if (req.method === "DELETE") {
            if (Number(current.closes) > now)
              fail("Close this publication before deleting its results.", 409);
            await tx
              .prepare("DELETE FROM attempts WHERE publication_id=?")
              .run(pub.id);
            await tx.prepare("DELETE FROM publications WHERE id=?").run(pub.id);
          } else {
            if (own[2] === "extend") {
              if (Number(current.closes) <= now)
                fail(
                  "Closed quizzes cannot be reopened. Publish a new quiz to accept new attempts.",
                  409,
                );
              if (
                !Number.isSafeInteger(x.closes) ||
                x.closes <= Number(current.closes) ||
                x.closes > now + 365 * 24 * 60 * 60 * 1000
              )
                fail(
                  "Choose a later deadline, no more than one year from now.",
                );
              closes = x.closes;
            } else closes = Math.min(now, Number(current.closes));
            await tx
              .prepare("UPDATE publications SET closes=? WHERE id=?")
              .run(closes, pub.id);
          }
        });
        return send(res, { ok: true, closes });
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
      /^\/api\/published\/([a-f0-9]{32})(?:\/(join|answer|next))?$/,
    );
    if (!match) {
      if (p.startsWith("/api/published/"))
        fail("Published quiz not found.", 404);
      return false;
    }
    const id = match[1],
      b = browser(req);
    if (req.method === "GET" && !match[2]) {
      let state;
      await db.withTransaction(async (tx) => {
        const pub = await tx
          .prepare("SELECT * FROM publications WHERE id=?" + lock)
          .get(id);
        if (!pub) fail("Published quiz not found.", 404);
        const attempt = b
          ? await tx
              .prepare(
                "SELECT * FROM attempts WHERE publication_id=? AND browser_hash=?",
              )
              .get(id, hash(b))
          : null;
        await settleExpired(tx, pub, attempt);
        state = await publicState(pub, attempt, tx);
      });
      const headers = b
        ? {}
        : {
            "Set-Cookie": cookie(
              req,
              crypto.randomBytes(32).toString("hex"),
              180 * 24 * 60 * 60,
            ).replace("quizzes_session=", "quizzes_attempt="),
          };
      return send(res, state, 200, headers);
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
              shuffleSeed: crypto.randomBytes(16).toString("hex"),
            }),
            updated: Date.now(),
          };
          const progress = JSON.parse(attempt.document);
          startAttemptQuestion(pub, progress);
          attempt.document = JSON.stringify(progress);
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
        await settleExpired(tx, pub, attempt);
      } else if (match[2] === "next") {
        if (!attempt) fail("Join the quiz first.", 403);
        await settleExpired(tx, pub, attempt);
        const progress = JSON.parse(attempt.document);
        if (progress.completed || x.index !== progress.answers.length)
          fail("Progress changed. Reload to resume.", 409);
        // Idempotent: another tab or retry must not reset a running question's timer.
        if (publicationSettings(pub).timerEnabled && !progress.deadline) {
          startAttemptQuestion(pub, progress);
          await saveProgress(tx, attempt, progress);
        }
      } else if (match[2] === "answer") {
        if (!attempt) fail("Join the quiz first.", 403);
        const progress = JSON.parse(attempt.document),
          questions = flat(pub),
          settings = publicationSettings(pub);
        if (progress.completed || x.index !== progress.answers.length)
          fail(
            "This question was already submitted or changed. Reload to resume.",
            409,
          );
        if (settings.timerEnabled && !progress.deadline)
          fail("Press Next question to start this question.", 409);
        const q = questions[progress.answers.length];
        const timedOut =
          settings.timerEnabled && Date.now() >= progress.deadline;
        let answer = x.answer;
        if (!timedOut && x.skip !== true && q.type !== "text") {
          const order = answerOrder(q, x.index, settings, progress);
          const mapIndex = (i) => {
            if (!Number.isInteger(i) || i < 0 || i >= order.length)
              fail("Choose a valid answer.");
            return order[i];
          };
          if (q.type === "multi") {
            if (!Array.isArray(answer) || answer.length > order.length)
              fail("Choose valid answers.");
            answer = answer.map(mapIndex);
          } else answer = mapIndex(answer);
        }
        recordAnswer(pub, progress, answer, x.skip === true, timedOut);
        await saveProgress(tx, attempt, progress);
      } else fail("Action not found.", 404);
      state = await publicState(pub, attempt, tx);
    });
    return send(res, state);
  }
  return { handle, mediaURL, mediaAccess };
};
