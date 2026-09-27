"use strict";
// Deterministic extraction of existing questions. No external AI or document storage.
const { Worker } = require("node:worker_threads");
const path = require("node:path");
const MAX_TEXT = 200000;
function issue(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
function parseQuizText(source, title = "Imported quiz", styleMode = "auto") {
  if (typeof source !== "string" || source.length > MAX_TEXT)
    throw issue(
      "Use at most 200,000 characters. Split longer documents into smaller quizzes.",
    );
  const lines = source
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
  const warnings = [];
  const groups = [];
  const all = [];
  const keys = [];
  let group = null,
    current = null,
    keyMode = false,
    ignored = 0;
  const norm = (x) => String(x).trim().toLowerCase().replace(/[.!]$/, "");
  function add(text, number) {
    if (all.length >= 200)
      throw issue(
        "This document contains more than 200 questions. Split it into smaller quizzes.",
      );
    if (!group) {
      group = { title: "Round 1", items: [] };
      groups.push(group);
    }
    current = { text, number, choices: [], answers: [], marked: [], notes: [] };
    group.items.push(current);
    all.push(current);
  }
  for (const rawLine of lines) {
    let line = rawLine;
    const style = new Set();
    const marker = line.match(/^\[\[fmt:([a-z,]+)\]\]\s*/);
    if (marker) {
      marker[1].split(",").forEach((k) => style.add(k));
      line = line.slice(marker[0].length);
    }
    if (/^\*\*.*\*\*$/.test(line) || /^[A-Fa-f][).:]\s+\*\*.*\*\*$/.test(line))
      style.add("bold");
    line = line.replace(/\*\*(.*?)\*\*/g, "$1");
    if (/^answer\s*key\s*:?$/i.test(line)) {
      keyMode = true;
      current = null;
      continue;
    }
    if (keyMode) {
      const k = line.match(/^(\d{1,3})[.):\-]\s*(.+)$/);
      if (k) keys.push([k[1], k[2]]);
      else ignored++;
      continue;
    }
    const heading = line.match(/^(?:quiz\s*title|title):\s*(.+)$/i);
    if (heading && !all.length) {
      title = heading[1];
      continue;
    }
    if (/^(?:round|section)\s+\d+(?:\s*[:.\-–—]\s*.*)?$/i.test(line)) {
      if (groups.length >= 20) throw issue("Maximum 20 rounds per quiz.");
      group = { title: line.slice(0, 100), items: [] };
      groups.push(group);
      current = null;
      continue;
    }
    const answer = line.match(
      /^(?:correct\s*(?:answers?|options?)|answers?|ans|accepted\s*answers?)\s*[:=\-]\s*(.*)$/i,
    );
    if (answer && current) {
      current.answers.push(answer[1]);
      continue;
    }
    const option = line.match(
      /^([*✓✔]?)[ \t]*(?:\(([A-Fa-f])\)|([A-Fa-f])[).:\-])\s+(.+)$/,
    );
    if (option && current) {
      let text = option[4];
      const marked =
        !!option[1] || /\s*(?:[✓✔]|\(correct\)|\[correct\]|\*)$/i.test(text);
      text = text
        .replace(/\s*(?:[✓✔]|\(correct\)|\[correct\]|\*)$/i, "")
        .trim();
      current.choices.push({
        label: (option[2] || option[3]).toUpperCase(),
        text,
        format: [...style],
      });
      if (marked) current.marked.push(current.choices.length - 1);
      continue;
    }
    const question =
      line.match(/^(?:Q(?:uestion)?\s*)?(\d{1,3})[).:\-]\s*(.+)$/i) ||
      line.match(/^Question\s*:\s*(.+)$/i);
    if (question) {
      add(
        question.length === 3 ? question[2] : question[1],
        question.length === 3 ? question[1] : null,
      );
      continue;
    }
    // An unnumbered paragraph ending in ? can start a question. Explicit numbering is more reliable.
    if (
      line.endsWith("?") &&
      (!current || current.choices.length || current.answers.length)
    ) {
      add(line, null);
      continue;
    }
    if (current && !current.answers.length) {
      if (current.choices.length) current.choices.at(-1).text += " " + line;
      else current.text += " " + line;
    } else ignored++;
  }
  if (!all.length)
    throw issue(
      "No structured questions were found. Use numbered questions, A) / B) choices and Answer: B. Scanned PDFs need OCR first; see the sample format.",
    );
  for (const [number, answer] of keys) {
    const matches = all.filter((q) => q.number === number);
    if (matches.length === 1) matches[0].answers.push(answer);
    else
      warnings.push(
        `Answer-key entry ${number} could not be matched uniquely. Check repeated question numbers across rounds.`,
      );
  }
  let needsAnswers = 0;
  function convert(item, index) {
    const q = {
      type: "text",
      text: item.text,
      seconds: 20,
      points: 1000,
      media: "",
      mediaType: "",
      accepted: [],
      correct: -1,
      options: [],
    };
    const answers = item.answers.map((x) => x.trim()).filter(Boolean);
    if (item.choices.length) {
      q.type = "choice";
      q.options = item.choices.map((o) => o.text);
      const lookup = (a) => {
        const exact = item.choices
          .map((o, i) => (norm(o.text) === norm(a) ? i : -1))
          .filter((i) => i >= 0);
        if (exact.length === 1) return [exact[0]];
        if (/^[A-F](?:\s*(?:,|and|&|\+|\/|;)\s*[A-F])+[.]?$/i.test(a))
          return a
            .match(/\b[A-F]\b/gi)
            .map((l) =>
              item.choices.findIndex((o) => o.label === l.toUpperCase()),
            );
        const letter = a.match(/^\(?([A-F])\)?[).:]?(?:\s+(.+))?$/i);
        return [
          letter
            ? item.choices.findIndex(
                (o) =>
                  o.label === letter[1].toUpperCase() &&
                  (!letter[2] || norm(o.text) === norm(letter[2])),
              )
            : -1,
        ];
      };
      const sets = answers.map((a) =>
        [...new Set(lookup(a))].sort((a, b) => a - b),
      );
      let selected = [];
      const marked = [...new Set(item.marked)].sort((a, b) => a - b);
      if (sets.length) {
        if (
          sets.every(
            (a) =>
              a.every((i) => i >= 0) &&
              JSON.stringify(a) === JSON.stringify(sets[0]),
          ) &&
          (!marked.length || JSON.stringify(marked) === JSON.stringify(sets[0]))
        )
          selected = sets[0];
      } else if (marked.length) selected = marked;
      else if (styleMode !== "marks") {
        const candidates = item.choices
          .map((o, i) =>
            o.format.some((f) => styleMode === "auto" || styleMode === f)
              ? i
              : -1,
          )
          .filter((i) => i >= 0);
        if (candidates.length && candidates.length < item.choices.length) {
          selected = candidates;
          warnings.push(
            `Question ${index + 1}: answer inferred from formatting (${styleMode}). Confirm the formatting really marks correct answers.`,
          );
        } else if (candidates.length)
          warnings.push(
            `Question ${index + 1}: every option uses that formatting, so it cannot identify the answer.`,
          );
      }
      if (
        new Set(item.choices.map((o) => o.label)).size !== item.choices.length
      )
        selected = [];
      if (selected.length === 1) q.correct = selected[0];
      else if (selected.length > 1) {
        q.type = "multi";
        q.correctAnswers = selected;
      }
      if (q.options.length < 2 || q.options.length > 6)
        warnings.push(`Question ${index + 1}: use 2–6 answer options.`);
      if (q.options.some((o) => o.length > 200))
        warnings.push(
          `Question ${index + 1}: shorten answer options to 200 characters.`,
        );
      if (
        q.type !== "multi" &&
        q.options.length === 2 &&
        norm(q.options[0]) === "true" &&
        norm(q.options[1]) === "false"
      )
        q.type = "boolean";
    } else if (
      (answers.length && answers.every((a) => /^(true|false)$/i.test(a))) ||
      /true\s*(?:\/|or)\s*false/i.test(item.text)
    ) {
      q.type = "boolean";
      q.options = ["True", "False"];
      const unique = [...new Set(answers.map(norm))];
      if (unique.length === 1 && ["true", "false"].includes(unique[0]))
        q.correct = unique[0] === "true" ? 0 : 1;
    } else {
      // Conflicting repeated Answer lines are not silently merged. Use | for alternatives.
      if (new Set(answers.map(norm)).size === 1)
        q.accepted = answers[0]
          .split("|")
          .map((s) => s.trim())
          .filter(Boolean);
    }
    if (
      (q.type === "text" && !q.accepted.length) ||
      (q.type !== "text" && q.type !== "multi" && q.correct < 0)
    ) {
      needsAnswers++;
      warnings.push(
        `Question ${index + 1}: choose the correct answer; the key was missing, conflicting or unclear.`,
      );
    }
    if (q.text.length > 1000)
      warnings.push(
        `Question ${index + 1}: shorten the question to 1,000 characters.`,
      );
    return q;
  }
  let n = 0;
  const rounds = groups
    .filter((g) => g.items.length)
    .map((g) => ({
      title: g.title,
      questions: g.items.map((item) => convert(item, n++)),
    }));
  if (ignored)
    warnings.push(
      `${ignored} heading, note or unrecognized line(s) were not used. Compare the extracted source with your draft.`,
    );
  if (title.length > 120) {
    title = title.slice(0, 120);
    warnings.push("Quiz title was shortened to 120 characters.");
  }
  return {
    quiz: {
      title: title.trim() || "Imported quiz",
      description: "",
      music: "",
      rounds,
    },
    warnings,
    recognized: all.length,
    needsAnswers,
    sourceText: source.replace(/^\[\[fmt:[a-z,]+\]\]\s*/gm, ""),
  };
}
let importing = false;
async function importDocument(buffer, extension, title, styleMode = "auto") {
  if (buffer.length > 5 * 1024 * 1024)
    throw issue("Maximum document size is 5 MB.", 413);
  if (!["txt", "pdf", "docx"].includes(extension))
    throw issue(
      "Upload a text PDF, .docx or UTF-8 .txt file. Old .doc files and scans are not supported.",
    );
  if (importing)
    throw issue(
      "Another document is being processed. Please try again shortly.",
      429,
    );
  importing = true;
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, "quiz-import-worker.js"), {
        workerData: { buffer, extension, title, styleMode },
        resourceLimits: {
          maxOldGenerationSizeMb: 128,
          maxYoungGenerationSizeMb: 16,
        },
        stdout: true,
        stderr: true,
      });
      // Discard parser logs: malformed documents may contain private text.
      worker.stdout.resume();
      worker.stderr.resume();
      let settled = false;
      const finish = (err, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.terminate();
        err ? reject(err) : resolve(value);
      };
      const timer = setTimeout(
        () =>
          finish(
            issue(
              "This document took too long to process. Try a smaller document or paste the questions as text.",
            ),
          ),
        15000,
      );
      worker.on("message", (m) =>
        m.error ? finish(issue(m.error)) : finish(null, m.result),
      );
      worker.on("error", () =>
        finish(
          issue(
            "Unable to read this document safely. Try a smaller file or paste its text.",
          ),
        ),
      );
      worker.on("exit", () => {
        if (!settled)
          finish(
            issue(
              "Document processing stopped. Try a smaller file or paste its text.",
            ),
          );
      });
    });
  } finally {
    importing = false;
  }
}
module.exports = { parseQuizText, importDocument, MAX_TEXT };
