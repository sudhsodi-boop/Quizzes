const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseQuizText, importDocument } = require("../quiz-import");
const root = path.join(__dirname, "..");
const sample = fs.readFileSync(
  path.join(root, "Quiz-import-example.txt"),
  "utf8",
);
test("structured importer recognizes rounds, choice, true/false and typed answers", () => {
  const r = parseQuizText(sample);
  assert.equal(r.recognized, 4);
  assert.equal(r.needsAnswers, 0);
  assert.equal(r.quiz.rounds.length, 2);
  const qs = r.quiz.rounds.flatMap((g) => g.questions);
  assert.deepEqual(
    qs.map((q) => q.type),
    ["choice", "boolean", "text", "choice"],
  );
  assert.equal(qs[0].correct, 1);
  assert.equal(qs[1].correct, 0);
  assert.deepEqual(qs[2].accepted, ["together"]);
});
test("unknown, conflicting and multiple correct answers are never guessed", () => {
  for (const key of [
    "",
    "Answer: Z",
    "Answer: A and B",
    "Answer: A\nAnswer: B",
  ]) {
    const r = parseQuizText("1. Pick one\nA) Red\nB) Blue\n" + key);
    assert.equal(r.quiz.rounds[0].questions[0].correct, -1);
    assert.equal(r.needsAnswers, 1);
  }
  const r = parseQuizText("1. Marked conflict\n*A) Red\nB) Blue\nAnswer: B");
  assert.equal(r.needsAnswers, 1);
  const repeated = parseQuizText(
    "Round 1\n1. First\nA) X\nB) Y\nRound 2\n1. Second\nA) X\nB) Y\nAnswer key:\n1. B",
  );
  assert.equal(repeated.needsAnswers, 2);
  assert.match(repeated.warnings.join(), /uniquely/);
});
test("letter, exact text, inline marks and separate answer keys are supported", () => {
  for (const body of [
    "A) Red\nB) Blue\nAnswer: Blue",
    "A) Red\nB) Blue ✓",
    "A) Red\n*B) Blue",
    "A) Red\nB) Blue\nAnswer key:\n1. B",
  ])
    assert.equal(
      parseQuizText("1. Pick one\n" + body).quiz.rounds[0].questions[0].correct,
      1,
    );
  assert.deepEqual(
    parseQuizText("1. A word\nAnswer: hello | hi").quiz.rounds[0].questions[0]
      .accepted,
    ["hello", "hi"],
  );
});
test("import limits reject unsupported layouts and excessive question counts", () => {
  assert.throws(
    () => parseQuizText("A general article without quiz questions."),
    /No structured questions/,
  );
  assert.throws(() => parseQuizText("x".repeat(200001)), /200,000/);
  assert.throws(
    () =>
      parseQuizText(
        Array.from(
          { length: 201 },
          (_, i) => `${i + 1}. Question\nAnswer: test`,
        ).join("\n"),
      ),
    /200 questions/,
  );
});
test("real Word and text PDF files extract into editable drafts in a bounded worker", async () => {
  for (const extension of ["docx", "pdf"]) {
    const r = await importDocument(
      fs.readFileSync(
        path.join(__dirname, "fixtures", "import-example." + extension),
      ),
      extension,
      "Example",
    );
    assert.equal(r.recognized, 4);
    assert.equal(r.needsAnswers, 0);
    assert.equal(r.quiz.rounds[0].questions[0].correct, 1);
  }
  const txt = await importDocument(Buffer.from(sample), "txt", "Example");
  assert.equal(txt.recognized, 4);
});
test("scans, damaged documents, binary text and oversized uploads fail safely", async () => {
  await assert.rejects(
    importDocument(
      fs.readFileSync(path.join(__dirname, "fixtures/no-text.pdf")),
      "pdf",
      "Scan",
    ),
    /No text was found/,
  );
  for (const ext of ["docx", "pdf", "doc"])
    await assert.rejects(
      importDocument(Buffer.from("private-document-content"), ext, "Invalid"),
    );
  await assert.rejects(
    importDocument(Buffer.from("private-document-content"), "docx", "Invalid"),
    (e) => !e.message.includes("private-document-content"),
  );
  await assert.rejects(
    importDocument(Buffer.from([0, 1, 2]), "txt", "Invalid"),
    /UTF-8/,
  );
  await assert.rejects(
    importDocument(Buffer.alloc(5 * 1024 * 1024 + 1), "txt", "Large"),
    (e) => e.status === 413,
  );
});
