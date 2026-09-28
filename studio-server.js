"use strict";
const crypto = require("node:crypto");
// Private, incomplete editor drafts. Never used as a live/publication snapshot.
module.exports = ({ db, json, data, fail, owns, isSiteAdmin, rate }) =>
  async function studio(req, res, p, admin) {
    const match = p.match(/^\/api\/editor-drafts(?:\/([a-zA-Z0-9-]{1,64}))?$/);
    if (!match) return false;
    const key = match[1];
    const get = () =>
      db
        .prepare("SELECT * FROM editor_drafts WHERE owner_id=? AND draft_key=?")
        .get(admin.id, key);
    if (!key && req.method === "GET") {
      const rows = await db
        .prepare(
          "SELECT draft_key,version,updated,document FROM editor_drafts WHERE owner_id=? ORDER BY updated DESC",
        )
        .all(admin.id);
      json(
        res,
        200,
        rows.map((r) => ({
          key: r.draft_key,
          version: Number(r.version),
          updated: Number(r.updated),
          title: JSON.parse(r.document).title || "Untitled draft",
          workspace: JSON.parse(r.document)._oversightLabel || null,
        })),
      );
      return true;
    }
    if (!key) fail("Choose a draft.");
    if (req.method === "GET") {
      const row = await get();
      if (!row) fail("Draft not found.", 404);
      json(res, 200, {
        key,
        version: Number(row.version),
        updated: Number(row.updated),
        document: JSON.parse(row.document),
      });
      return true;
    }
    if (!["PUT", "DELETE"].includes(req.method))
      fail("Action not available.", 405);
    rate("draft:" + admin.id, 120, 60000);
    const x = await data(req);
    if (!Number.isSafeInteger(x.version) || x.version < 0)
      fail("Invalid draft version.");
    if (req.method === "DELETE") {
      await db.withTransaction(async (tx) => {
        await tx
          .prepare(
            "SELECT id FROM admins WHERE id=?" +
              (db.kind === "postgres" ? " FOR UPDATE" : ""),
          )
          .get(admin.id);
        const changed = await tx
          .prepare(
            "DELETE FROM editor_drafts WHERE owner_id=? AND draft_key=? AND version=?",
          )
          .run(admin.id, key, x.version);
        if (
          !changed.changes &&
          (await tx
            .prepare(
              "SELECT version FROM editor_drafts WHERE owner_id=? AND draft_key=?",
            )
            .get(admin.id, key))
        )
          fail(
            "This draft changed in another tab. Refresh the draft list.",
            409,
          );
      });
      json(res, 200, { ok: true });
      return true;
    }
    const doc = x.document;
    if (
      !doc ||
      typeof doc !== "object" ||
      JSON.stringify(doc).length > 500000 ||
      typeof doc.title !== "string" ||
      doc.title.length > 120 ||
      !Array.isArray(doc.rounds) ||
      doc.rounds.length > 20
    )
      fail("Invalid or oversized draft.");
    let contentOwner = admin.id;
    if (doc._oversightOwner !== undefined) {
      if (
        !isSiteAdmin(admin) ||
        typeof doc._oversightOwner !== "string" ||
        !/^[a-f0-9-]{36}$/.test(doc._oversightOwner) ||
        !doc.id
      )
        fail("Administrator oversight access required.", 403);
      contentOwner = doc._oversightOwner;
      if (
        typeof doc._oversightLabel !== "string" ||
        doc._oversightLabel.length > 120
      )
        fail("Invalid workspace label.");
    }
    if (
      doc.id &&
      (doc.id !== key || !(await owns("quizzes", doc.id, contentOwner)))
    )
      fail("Quiz not found.", 404);
    if (!doc.id && !/^new-[a-f0-9-]{36}$/.test(key))
      fail("Invalid new draft key.");
    if (
      doc.description !== undefined &&
      (typeof doc.description !== "string" || doc.description.length > 1000)
    )
      fail("Invalid description.");
    if (
      doc._revision !== undefined &&
      (!Number.isSafeInteger(doc._revision) || doc._revision < 0)
    )
      fail("Invalid quiz revision.");
    if (doc._reviewed !== undefined && typeof doc._reviewed !== "boolean")
      fail("Invalid review status.");
    if (doc._importReport !== undefined) {
      const r = doc._importReport;
      if (
        !r ||
        typeof r !== "object" ||
        !Array.isArray(r.warnings) ||
        r.warnings.some((w) => typeof w !== "string") ||
        typeof r.sourceText !== "string" ||
        !Number.isFinite(r.recognized) ||
        !Number.isFinite(r.needsAnswers)
      )
        fail("Invalid import review.");
    }
    const references = new Map();
    const addMedia = (value, kind) => {
      if (!value) return;
      if (typeof value !== "string" || !/^\/media\/[a-f0-9-]{36}$/.test(value))
        fail("Invalid draft media.");
      const id = value.slice(7);
      references.set(id, references.get(id) || kind || "any");
    };
    addMedia(doc.music, "audio");
    let count = 0;
    for (const round of doc.rounds) {
      if (
        !round ||
        typeof round.title !== "string" ||
        round.title.length > 100 ||
        !Array.isArray(round.questions)
      )
        fail("Invalid draft round.");
      for (const q of round.questions) {
        if (
          ++count > 200 ||
          !q ||
          !["choice", "multi", "boolean", "text"].includes(q.type) ||
          typeof q.text !== "string" ||
          q.text.length > 1000
        )
          fail("Invalid draft question.");
        for (const name of ["seconds", "points"])
          if (
            q[name] !== undefined &&
            (!Number.isFinite(q[name]) || q[name] < 0 || q[name] > 1000000)
          )
            fail("Invalid draft timing or points.");
        if (
          q.correct !== undefined &&
          (!Number.isInteger(q.correct) || q.correct < -1 || q.correct > 5)
        )
          fail("Invalid draft correct answer.");
        if (
          q.mediaType !== undefined &&
          (typeof q.mediaType !== "string" || q.mediaType.length > 100)
        )
          fail("Invalid draft media type.");
        for (const name of ["options", "accepted"])
          if (
            q[name] !== undefined &&
            (!Array.isArray(q[name]) ||
              q[name].length > (name === "options" ? 6 : 20) ||
              q[name].some((v) => typeof v !== "string" || v.length > 500))
          )
            fail("Invalid draft answers.");
        if (q.type !== "text" && !Array.isArray(q.options))
          fail("Draft answer choices required.");
        if (
          q.correctAnswers !== undefined &&
          (!Array.isArray(q.correctAnswers) ||
            q.correctAnswers.length > 6 ||
            q.correctAnswers.some(
              (v) => !Number.isInteger(v) || v < 0 || v > 5,
            ))
        )
          fail("Invalid draft keys.");
        if (
          q.notes !== undefined &&
          (typeof q.notes !== "string" || q.notes.length > 1000)
        )
          fail("Invalid private notes.");
        addMedia(q.media);
      }
    }
    if (references.size) {
      const ids = [...references.keys()];
      const media = await db
        .prepare(
          "SELECT m.id,m.mime FROM media m JOIN ownership o ON o.kind='media' AND o.item_id=m.id AND o.owner_id=? WHERE m.id IN (" +
            ids.map(() => "?").join(",") +
            ")",
        )
        .all(contentOwner, ...ids);
      if (
        media.length !== ids.length ||
        media.some(
          (m) =>
            references.get(m.id) === "audio" && !m.mime.startsWith("audio/"),
        )
      )
        fail("Draft media is not in your workspace.");
    }
    let nextVersion;
    const document = JSON.stringify(doc),
      updated = Date.now();
    await db.withTransaction(async (tx) => {
      // Lock the owner, serializing both creation quotas and versions on PostgreSQL.
      await tx
        .prepare(
          "SELECT id FROM admins WHERE id=?" +
            (db.kind === "postgres" ? " FOR UPDATE" : ""),
        )
        .get(admin.id);
      const existing = await tx
        .prepare(
          "SELECT version FROM editor_drafts WHERE owner_id=? AND draft_key=?",
        )
        .get(admin.id, key);
      if (Number(existing?.version || 0) !== x.version)
        fail(
          "Draft changed in another tab. Recover that version or save this work as a separate quiz.",
          409,
        );
      nextVersion = existing ? x.version + 1 : crypto.randomInt(1, 2 ** 47);
      if (!existing) {
        const rows = await tx
          .prepare("SELECT draft_key FROM editor_drafts WHERE owner_id=?")
          .all(admin.id);
        if (rows.length >= 20)
          fail(
            "You have 20 recovery drafts. Remove an older draft in Recover drafts.",
            409,
          );
        await tx
          .prepare(
            "INSERT INTO editor_drafts (owner_id,draft_key,version,updated,document) VALUES (?,?,?,?,?)",
          )
          .run(admin.id, key, nextVersion, updated, document);
      } else {
        const changed = await tx
          .prepare(
            "UPDATE editor_drafts SET version=?,updated=?,document=? WHERE owner_id=? AND draft_key=? AND version=?",
          )
          .run(nextVersion, updated, document, admin.id, key, x.version);
        if (!changed.changes)
          fail("Draft changed while saving. Recover the newer version.", 409);
      }
    });
    json(res, 200, { key, version: nextVersion, updated });
    return true;
  };
