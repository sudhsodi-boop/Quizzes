"use strict";
function error(message) {
  return Object.assign(new Error(message), { status: 400 });
}
const normalize = (value) =>
  String(value).normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
function correctIndices(q) {
  return q.type === "multi" ? q.correctAnswers : [q.correct];
}
function grade(q, answer) {
  if (q.type === "text") {
    if (typeof answer !== "string" || !answer.trim() || answer.length > 200)
      throw error("Enter an answer of 1–200 characters.");
    return q.accepted.some((a) => normalize(a) === normalize(answer)) ? 1 : 0;
  }
  if (q.type !== "multi") {
    if (!Number.isInteger(answer) || answer < 0 || answer >= q.options.length)
      throw error("Choose a valid answer.");
    return answer === q.correct ? 1 : 0;
  }
  if (
    !Array.isArray(answer) ||
    !answer.length ||
    answer.length > q.options.length ||
    new Set(answer).size !== answer.length ||
    answer.some((a) => !Number.isInteger(a) || a < 0 || a >= q.options.length)
  )
    throw error("Select one or more different valid answers.");
  const keys = q.correctAnswers;
  const hits = answer.filter((a) => keys.includes(a)).length;
  const wrong = answer.length - hits;
  return Math.max(
    0,
    hits / keys.length - wrong / Math.max(1, q.options.length - keys.length),
  );
}
function roundLabel(index, title) {
  const cleaned = String(title || "")
    .replace(/^round\s*\d+\s*[:.\-–—]?\s*/i, "")
    .trim();
  return `Round ${index + 1}${cleaned ? ": " + cleaned : ""}`;
}
function solution(q) {
  return q.type === "text"
    ? q.accepted.join(" / ")
    : correctIndices(q)
        .map((i) => q.options[i])
        .join(" + ");
}
const quizRules = { grade, correctIndices, roundLabel, solution, normalize };
if (typeof module !== "undefined" && module.exports) module.exports = quizRules;
else window.QuizzesRules = quizRules;
