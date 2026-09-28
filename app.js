"use strict";
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const escapeHTML = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const e = escapeHTML;
const participantMode = location.pathname === "/join";
const independentMode = ["/play", "/invite"].includes(location.pathname);
const sound = window.QuizzesSound;
sound.configure((state) => send("set_music", state));
let multiSelection = new Set();
$("#openAppNote").hidden = window.self === window.top;
let account = null,
  setup = false,
  privateSetupRequired = false,
  quizzes = [],
  reports = [],
  draft = null,
  dirty = false,
  uploadCount = 0;
let socket = null,
  game = null,
  liveQuestion = null,
  locked = false,
  answerPending = false,
  offset = 0,
  reconnectTimer = null,
  manualClose = false,
  clockSent = 0;
let currentView = "dashboard";
const resumeKey = participantMode ? "quizzes-player" : "quizzes-host";
function savedConnection() {
  try {
    return JSON.parse(sessionStorage.getItem(resumeKey));
  } catch {
    return null;
  }
}
function storeConnection(x) {
  sessionStorage.setItem(resumeKey, JSON.stringify(x));
}
function forgetConnection() {
  sessionStorage.removeItem(resumeKey);
}
let toastTimer;
function showToast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 5000);
}
async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.body && typeof options.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  const value = await res.json();
  if (!res.ok) {
    if (res.status === 401 && !participantMode && url !== "/api/login") {
      account = null;
      $("#authButton").textContent = "Host sign in";
    }
    throw Object.assign(Error(value.error || "Request failed"), {
      status: res.status,
    });
  }
  return value;
}
function showView(id, force = false) {
  if (
    currentView === "editor" &&
    dirty &&
    !force &&
    id !== "editor" &&
    !confirm("Leave without saving your changes?")
  )
    return;
  currentView = id;
  $$(".view").forEach((v) => v.classList.toggle("active-view", v.id === id));
  $$("[data-view]").forEach((n) =>
    n.classList.toggle("active", n.dataset.view === id),
  );
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$$("[data-view]").forEach((el) =>
  el.addEventListener("click", () => showView(el.dataset.view)),
);
function requireHost() {
  if (account) return true;
  openAuth();
  return false;
}
function openAuth() {
  const enabled = setup;
  $("#authTitle").textContent = enabled
    ? "Make this space yours"
    : "Welcome back";
  $("#orgField").hidden = !enabled;
  $("#organizationInput").required = enabled;
  $("#passwordInput").minLength = enabled ? 12 : 1;
  $("#passwordInput").autocomplete = enabled
    ? "new-password"
    : "current-password";
  $("#submitAuth").textContent = enabled ? "Create host account" : "Sign in";
  $("#authNote").textContent = enabled
    ? "Private preview setup: the first account becomes this workspace’s host. Use a unique password (12+ characters). Do not share this preview until setup is complete."
    : privateSetupRequired
      ? "First create your host account inside the private Quizzes Live App preview in Arena. Then return to this link and sign in with that account."
      : "Sign in to create quizzes and host your community.";
  $("#authStatus").textContent = "";
  $("#authModal").classList.add("open");
  $("#emailInput").focus();
}
$("#closeAuth").onclick = () => $("#authModal").classList.remove("open");
$("#authButton").onclick = async () => {
  if (!account) return openAuth();
  if (
    game &&
    game.status !== "ended" &&
    !confirm("Signing out disconnects you as host. Continue?")
  )
    return;
  try {
    await api("/api/logout", { method: "POST" });
    manualClose = true;
    sound.stop();
    socket?.close();
    forgetConnection();
    game = null;
    account = null;
    quizzes = [];
    reports = [];
    $("#gameModal").classList.remove("open");
    $("#returnToGame").hidden = true;
    $("#authButton").textContent = "Host sign in";
    $("#orgName").textContent = "Your organization";
    renderWorkspace();
    showView("dashboard", true);
    showToast("Signed out");
  } catch (err) {
    showToast(err.message);
  }
};
$("#authForm").onsubmit = async (event) => {
  event.preventDefault();
  $("#submitAuth").disabled = true;
  $("#authStatus").textContent = "";
  try {
    const email = $("#emailInput").value;
    const password = $("#passwordInput").value;
    if (setup) {
      await api("/api/setup", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          organization: $("#organizationInput").value,
        }),
      });
      setup = false;
    }
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    $("#passwordInput").value = "";
    await initializeHost();
    if (!account)
      throw Error(
        "Please open the live preview in a new tab to allow secure sign-in cookies.",
      );
    $("#authModal").classList.remove("open");
    showToast("Welcome to your workspace");
  } catch (err) {
    $("#authStatus").textContent = err.message;
  } finally {
    $("#submitAuth").disabled = false;
  }
};
async function loadWorkspace() {
  const ownerId = account?.id;
  const storage = await api("/api/storage-status");
  $("#storageSummary").textContent = storage.persistentCloud
    ? "PostgreSQL database and private Supabase media. Stored outside the app server."
    : "Local SQLite and media files. Use persistent cloud storage before deploying on a free host.";
  const workspaceData = await Promise.all([
    api("/api/quizzes"),
    api("/api/reports"),
  ]);
  if (account?.id !== ownerId) return;
  [quizzes, reports] = workspaceData;
  renderWorkspace();
}
function renderWorkspace() {
  $("#workspacePrivacyNotice").hidden = !account;
  document.dispatchEvent(new Event("quizzes:workspace"));
  const sessions = reports.length,
    players = reports.reduce((n, r) => n + r.players, 0),
    points = reports.reduce(
      (n, r) => n + r.leaderboard.reduce((sum, p) => sum + p.score, 0),
      0,
    );
  $("#stats").innerHTML = [
    ["▤", "Saved quizzes", quizzes.length, "purple"],
    ["◒", "Completed sessions", sessions, "blue"],
    ["♧", "Player participations", players, "yellow"],
    ["✦", "Community points", points, "green"],
  ]
    .map(
      ([icon, label, n, color]) =>
        `<div class="stat-card"><div class="stat-icon ${color}">${icon}</div><span class="stat-label">${label}</span><b>${n.toLocaleString()}</b><small class="muted">${account ? "From your saved workspace" : "Sign in to see your data"}</small></div>`,
    )
    .join("");
  $("#recentQuizzes").innerHTML = quizzes.length
    ? quizzes
        .slice(0, 3)
        .map(
          (q) =>
            `<div class="quiz-row"><div class="quiz-thumb violet">✦</div><div class="quiz-info"><b>${e(q.title)}</b><span>${summary(q)}</span></div><button class="text-btn" data-launch="${q.id}">Host ↗</button></div>`,
        )
        .join("")
    : `<div class="empty-state">${account ? "Your first quiz starts here." : "Your private workspace is one sign-in away."}</div>`;
  $("#library").innerHTML =
    `<button class="create-tile" data-new><span class="new-plus">＋</span><b>Start a new quiz</b><span>Make it your own</span></button>` +
    quizzes
      .map(
        (q) =>
          `<article class="library-card"><div class="quiz-thumb violet">✦</div><b>${e(q.title)}</b><span>${summary(q)}</span><p class="muted quiz-description">${e(q.description || "A new moment for your community.")}</p><div class="button-row"><button class="primary-btn" data-launch="${q.id}">Host game ↗</button><button class="secondary-btn" data-publish="${q.id}">Publish 24h</button><button class="secondary-btn" data-edit="${q.id}">Edit</button><button class="text-btn" data-delete="${q.id}" aria-label="Delete ${e(q.title)}">Delete</button></div></article>`,
      )
      .join("");
  $("#clearReports").disabled = !account || !reports.length;
  $("#reportList").innerHTML = reports.length
    ? reports
        .map(
          (r) =>
            `<details class="panel report-detail"><summary><div><b>${e(r.title)}</b><p class="muted">${e(new Date(r.ended).toLocaleString())} · ${r.players} players · ${r.questionsPlayed}/${r.questionCount} questions</p></div><span class="pill">VIEW RESULTS ↓</span></summary><p class="muted">${e(r.reason)} · Code ${e(r.code)}</p>${leaderboardHTML(r.leaderboard)}<button class="outline-btn" data-export="${r.id}">Download CSV</button> <button class="text-btn" data-delete-report="${r.id}">Delete report</button></details>`,
        )
        .join("")
    : `<div class="panel empty-state"><h2>Every gathering has a story.</h2><p>${account ? "No saved reports. Completed live games appear here." : "Sign in to see your organization’s reports."}</p></div>`;
  $("#organizationSetting").textContent = account
    ? `${account.organization} · ${account.email}`
    : "Sign in to manage your workspace.";
}
function summary(q) {
  return `${q.rounds.length} round${q.rounds.length === 1 ? "" : "s"} · ${q.rounds.reduce((n, r) => n + r.questions.length, 0)} questions`;
}
function leaderboardHTML(rows) {
  return rows.length
    ? `<ol class="leaderboard">${rows.map((p) => `<li><b class="rank">${p.rank}</b><span>${e(p.name)}</span><strong>${p.score.toLocaleString()} <small>pts</small></strong></li>`).join("")}</ol>`
    : '<p class="muted">No participants in this session.</p>';
}
document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.hasAttribute("data-new")) {
    if (requireHost()) newQuiz();
  }
  if (button.dataset.edit) {
    editQuiz(quizzes.find((q) => q.id === button.dataset.edit));
  }
  if (button.dataset.launch) {
    if (requireHost()) launchQuiz(button.dataset.launch);
  }
  if (
    button.dataset.delete &&
    confirm("Delete this quiz? Completed reports will be kept.")
  ) {
    try {
      await api("/api/quizzes/" + button.dataset.delete, { method: "DELETE" });
      await loadWorkspace();
      showToast("Quiz deleted");
    } catch (err) {
      showToast(err.message);
    }
  }
  if (
    button.dataset.deleteReport &&
    confirm(
      "Permanently delete this saved report? This cannot be undone. Your saved quiz is kept; existing backup files are not changed.",
    )
  ) {
    try {
      await api("/api/reports/" + button.dataset.deleteReport, {
        method: "DELETE",
      });
      await loadWorkspace();
      showToast("Report deleted");
    } catch (err) {
      showToast(err.message);
    }
  }
  if (button.dataset.export)
    exportReport(reports.find((r) => r.id === button.dataset.export));
});
$("#launchBtn").onclick = () => {
  if (requireHost()) showView("quizzes");
};
$("#clearReports").onclick = async () => {
  if (
    !requireHost() ||
    !confirm(
      "Permanently delete ALL saved live reports in your workspace? This cannot be undone. Saved quizzes, self-paced publications and existing backups are kept.",
    )
  )
    return;
  try {
    await api("/api/reports", { method: "DELETE" });
    await loadWorkspace();
    showToast("Saved live reports deleted");
  } catch (err) {
    showToast(err.message);
  }
};
$("#refreshReports").onclick = async () => {
  if (!requireHost()) return;
  try {
    await loadWorkspace();
    showToast("Reports refreshed");
  } catch (err) {
    showToast(err.message);
  }
};
function exportReport(r) {
  const quote = (value) =>
    '"' +
    String(value)
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replace(/"/g, '""') +
    '"';
  const rows = [
    ["Quiz", "Ended", "Rank", "Nickname", "Score"],
    ...r.leaderboard.map((p) => [
      r.title,
      new Date(r.ended).toISOString(),
      p.rank,
      p.name,
      p.score,
    ]),
  ];
  const blob = new Blob(
    ["\ufeff" + rows.map((row) => row.map(quote).join(",")).join("\r\n")],
    { type: "text/csv;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `quizzes-${r.code}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function blankQuestion() {
  return {
    type: "choice",
    text: "",
    options: ["", "", "", ""],
    correct: 0,
    accepted: [""],
    seconds: 20,
    points: 1000,
    media: "",
    mediaType: "",
  };
}
function newQuiz() {
  if (
    dirty &&
    currentView === "editor" &&
    !confirm("Discard your unsaved quiz?")
  )
    return;
  draft = {
    title: "",
    description: "",
    music: "",
    rounds: [{ title: "Round 1", questions: [blankQuestion()] }],
  };
  openEditor();
}
function editQuiz(q) {
  if (!requireHost() || !q) return;
  draft = structuredClone(q);
  openEditor();
}
function openEditor() {
  dirty = false;
  const report = draft._importReport;
  $("#importReview").hidden = !report;
  $("#importReviewed").disabled = !report;
  $("#importReviewed").required = !!report;
  $("#importReviewed").checked = false;
  if (report) {
    $("#importSummary").textContent =
      `${report.recognized} questions extracted · ${report.needsAnswers} need a correct answer. Review all questions before saving.`;
    $("#importWarnings").innerHTML = report.warnings
      .map((w) => `<li>${e(w)}</li>`)
      .join("");
    $("#importSource").textContent = report.sourceText;
  }
  $("#editorHeading").textContent = draft.id
    ? "Edit your quiz"
    : "Create your quiz";
  $("#quizTitle").value = draft.title;
  $("#quizDescription").value = draft.description;
  $("#saveStatus").textContent = "";
  renderEditor();
  showView("editor", true);
}
function mediaHTML(url, type) {
  if (!url) return "";
  return type?.startsWith("image/")
    ? `<img class="question-media" src="${e(url)}" alt="Question image">`
    : `<audio controls preload="metadata" src="${e(url)}" class="question-audio"></audio>`;
}
function renderEditor() {
  $("#bulkRound").innerHTML =
    draft.rounds
      .map(
        (r, i) => `<option value="${i}">${e(roundTitle(i, r.title))}</option>`,
      )
      .join("") + '<option value="new">＋ New round</option>';
  $("#musicPreview").innerHTML = draft.music
    ? `<audio controls preload="metadata" src="${e(draft.music)}"></audio>`
    : '<span class="muted">♬ Original Quizzes soundtrack · plays by default</span>';
  $("#roundEditor").innerHTML = draft.rounds
    .map(
      (r, ri) =>
        `<section class="round-section" data-round="${ri}"><div class="round-heading"><span class="round-number">${String(ri + 1).padStart(2, "0")}</span><label>Round name · optional<input class="round-title" value="${e(r.title)}" maxlength="100" placeholder="e.g. Easy — leave blank for Round ${ri + 1}"></label><button type="button" class="text-btn" data-remove-round="${ri}">Remove round</button></div>${r.questions.map((q, qi) => `<article class="panel question-card" data-ri="${ri}" data-qi="${qi}"><div class="question-card-head"><label class="select-question"><input type="checkbox" class="question-select"> Select Q${qi + 1}</label><label class="assign-label">Round<select data-assign-round>${draft.rounds.map((round, index) => `<option value="${index}" ${index === ri ? "selected" : ""}>${e(roundTitle(index, round.title))}</option>`).join("")}<option value="new">＋ New round</option></select></label><div class="button-row"><button type="button" class="text-btn" data-move="-1" ${qi === 0 ? "disabled" : ""}>↑ Move up</button><button type="button" class="text-btn" data-remove-question>Remove</button></div></div><div class="editor-columns"><div><label>Question<input data-field="text" value="${e(q.text)}" maxlength="1000" required placeholder="What would you like to ask?"></label><div class="editor-grid"><label>Answer type<select data-field="type"><option value="choice" ${q.type === "choice" ? "selected" : ""}>Multiple choice</option><option value="multi" ${q.type === "multi" ? "selected" : ""}>Multiple correct answers</option><option value="boolean" ${q.type === "boolean" ? "selected" : ""}>True / false</option><option value="text" ${q.type === "text" ? "selected" : ""}>Fill in the blank</option></select></label><label>Time · seconds<input type="number" data-field="seconds" min="5" max="120" value="${q.seconds}" required></label><label>Maximum points<input type="number" data-field="points" min="100" max="5000" value="${q.points}" required></label></div>${q.type === "text" ? `<label>Accepted answers · one per line<textarea data-field="accepted" required placeholder="stronger\nbetter together">${e((q.accepted || []).join("\n"))}</textarea></label><p class="muted">Ignores capitalization and extra spaces. Add spelling alternatives explicitly.</p>` : q.type === "boolean" ? `<label>Correct answer<select data-field="correct" required><option value="" ${q.correct < 0 ? "selected" : ""}>Select correct answer</option><option value="0" ${q.correct === 0 ? "selected" : ""}>True</option><option value="1" ${q.correct === 1 ? "selected" : ""}>False</option></select></label>` : `<label>Answer choices · one per line (2–6)<textarea data-field="options" rows="4" required>${e((q.options || []).join("\n"))}</textarea></label>${q.type === "multi" ? `<fieldset class="multi-correct"><legend>Correct answers · select all that apply</legend>${(q.options || []).map((option, i) => `<label><input type="checkbox" data-correct-index="${i}" ${(q.correctAnswers || []).includes(i) ? "checked" : ""}> ${e(option || `Option ${i + 1}`)}</label>`).join("")}</fieldset><p class="muted">Partial credit: correct fraction minus wrong fraction, minimum zero.</p>` : `<label>Correct choice number (1 is the first line)<input type="number" data-field="correctChoice" min="1" max="6" required value="${Number(q.correct) >= 0 ? Number(q.correct) + 1 : ""}"></label>`}`}</div><div class="media-editor"><label>Question image or audio · optional<input type="file" class="question-file" accept="image/png,image/jpeg,image/gif,image/webp,audio/mpeg,audio/wav,audio/ogg"></label><p class="muted">PNG, JPEG, GIF, WebP, MP3, WAV, OGG · up to 10 MB</p><div class="media-preview">${mediaHTML(q.media, q.mediaType)}</div>${q.media ? '<button class="text-btn" type="button" data-remove-media>Remove media</button>' : '<div class="media-placeholder">A picture, a sound, a new way to ask.</div>'}</div></div></article>`).join("")}<button type="button" class="outline-btn" data-add-question="${ri}">＋ Add question</button></section>`,
    )
    .join("");
}
function collectDraft() {
  if (!draft) return;
  draft.title = $("#quizTitle").value;
  draft.description = $("#quizDescription").value;
  $$(".round-section").forEach((section) => {
    const r = draft.rounds[Number(section.dataset.round)];
    r.title = $(".round-title", section).value;
    $$(".question-card", section).forEach((card) => {
      const q = r.questions[Number(card.dataset.qi)];
      $$("[data-field]", card).forEach((input) => {
        const f = input.dataset.field;
        if (["options", "accepted"].includes(f))
          q[f] = input.value.split("\n").map((x) => x.trim());
        else if (f === "correctChoice")
          q.correct = input.value === "" ? -1 : Number(input.value) - 1;
        else if (f === "correct")
          q.correct = input.value === "" ? -1 : Number(input.value);
        else
          q[f] = ["seconds", "points", "correct"].includes(f)
            ? Number(input.value)
            : input.value;
      });
      if (q.type === "multi")
        q.correctAnswers = $$("[data-correct-index]:checked", card).map(
          (input) => Number(input.dataset.correctIndex),
        );
    });
  });
}
$("#editorForm").addEventListener("input", () => (dirty = true));
$("#roundEditor").addEventListener("change", (event) => {
  if (event.target.classList.contains("round-title")) {
    collectDraft();
    $$("#bulkRound option, [data-assign-round] option").forEach((option) => {
      if (option.value !== "new")
        option.textContent = roundTitle(
          Number(option.value),
          draft.rounds[Number(option.value)]?.title,
        );
    });
  }
  if (event.target.matches("[data-assign-round]")) {
    const card = event.target.closest(".question-card");
    moveQuestions(
      [{ ri: Number(card.dataset.ri), qi: Number(card.dataset.qi) }],
      event.target.value,
    );
    return;
  }
  if (event.target.dataset.field === "options") {
    collectDraft();
    const card = event.target.closest(".question-card");
    if (
      draft.rounds[card.dataset.ri].questions[card.dataset.qi].type === "multi"
    )
      renderEditor();
  }
  if (event.target.dataset.field === "type") {
    collectDraft();
    const card = event.target.closest(".question-card");
    const q = draft.rounds[card.dataset.ri].questions[card.dataset.qi];
    q.options =
      q.type === "boolean"
        ? ["True", "False"]
        : q.options?.length >= 2
          ? q.options
          : ["", "", "", ""];
    q.correctAnswers = q.correctAnswers || [Math.max(0, q.correct || 0)];
    q.correct = 0;
    q.accepted = q.accepted || [""];
    renderEditor();
  }
  if (event.target.classList.contains("question-file"))
    uploadQuestion(event.target);
});
$("#roundEditor").addEventListener("click", (event) => {
  const b = event.target.closest("button");
  if (!b) return;
  collectDraft();
  const card = b.closest(".question-card");
  const ri = Number(card?.dataset.ri),
    qi = Number(card?.dataset.qi);
  if (b.hasAttribute("data-add-question"))
    draft.rounds[Number(b.dataset.addQuestion)].questions.push(blankQuestion());
  else if (b.hasAttribute("data-remove-round")) {
    if (draft.rounds.length === 1) return showToast("Keep at least one round.");
    if (!confirm("Remove this round and its questions?")) return;
    draft.rounds.splice(Number(b.dataset.removeRound), 1);
  } else if (b.hasAttribute("data-remove-question")) {
    if (draft.rounds[ri].questions.length === 1)
      return showToast("Each round needs at least one question.");
    draft.rounds[ri].questions.splice(qi, 1);
  } else if (b.hasAttribute("data-move")) {
    const qs = draft.rounds[ri].questions;
    [qs[qi - 1], qs[qi]] = [qs[qi], qs[qi - 1]];
  } else if (b.hasAttribute("data-remove-media")) {
    draft.rounds[ri].questions[qi].media = "";
    draft.rounds[ri].questions[qi].mediaType = "";
  } else return;
  dirty = true;
  renderEditor();
});
$("#addRound").onclick = () => {
  collectDraft();
  if (draft.rounds.length >= 20) return showToast("Maximum 20 rounds.");
  draft.rounds.push({
    title: `Round ${draft.rounds.length + 1}`,
    questions: [blankQuestion()],
  });
  dirty = true;
  renderEditor();
};
$("#cancelEdit").onclick = () => showView("quizzes");
$("#removeMusic").onclick = () => {
  collectDraft();
  draft.music = "";
  dirty = true;
  renderEditor();
};
async function upload(file) {
  if (file.size > 10 * 1024 * 1024)
    throw Error("Please choose a file smaller than 10 MB.");
  uploadCount++;
  $("#saveQuiz").disabled = true;
  try {
    return await api("/api/media", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
      },
      body: file,
    });
  } finally {
    uploadCount--;
    $("#saveQuiz").disabled = uploadCount > 0;
  }
}
async function uploadQuestion(input) {
  const file = input.files[0];
  if (!file) return;
  const card = input.closest(".question-card");
  input.disabled = true;
  try {
    const m = await upload(file);
    if (!card.isConnected)
      return showToast(
        "The editor changed during upload. Please attach the file again.",
      );
    collectDraft();
    const q = draft.rounds[card.dataset.ri].questions[card.dataset.qi];
    q.media = m.url;
    q.mediaType = m.mime;
    dirty = true;
    renderEditor();
    showToast("Media attached — save the quiz to keep your changes");
  } catch (err) {
    showToast(err.message);
  } finally {
    input.disabled = false;
  }
}
$("#musicFile").onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const m = await upload(file);
    if (!m.mime.startsWith("audio/"))
      throw Error("Background music must be an audio file.");
    collectDraft();
    draft.music = m.url;
    dirty = true;
    renderEditor();
    showToast("Custom soundtrack attached");
  } catch (err) {
    showToast(err.message);
  } finally {
    event.target.value = "";
  }
};
$("#editorForm").onsubmit = async (event) => {
  event.preventDefault();
  if (uploadCount) return showToast("Please wait for your uploads to finish.");
  collectDraft();
  if (draft.rounds.some((r) => !r.questions.length)) {
    draft.rounds = draft.rounds.filter((r) => r.questions.length);
    renderEditor();
  }
  if (
    draft.rounds.some((r) =>
      r.questions.some((q) => q.type === "multi" && !q.correctAnswers?.length),
    )
  )
    return showToast("Select correct answers for every multi-answer question.");
  $("#saveQuiz").disabled = true;
  $("#saveStatus").textContent = "Saving…";
  try {
    const q = await api("/api/quizzes" + (draft.id ? "/" + draft.id : ""), {
      method: draft.id ? "PUT" : "POST",
      body: JSON.stringify(draft),
    });
    draft = q;
    dirty = false;
    await loadWorkspace();
    showView("quizzes", true);
    showToast("Quiz saved — ready for your next gathering");
  } catch (err) {
    $("#saveStatus").textContent = err.message;
  } finally {
    $("#saveQuiz").disabled = false;
  }
};
$("#passwordForm").onsubmit = async (event) => {
  event.preventDefault();
  if (!requireHost()) return;
  const form = event.target;
  if (!confirm("Change your password and sign out all host sessions?")) return;
  try {
    await api("/api/password", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    form.reset();
    manualClose = true;
    socket?.close();
    forgetConnection();
    location.reload();
  } catch (err) {
    showToast(err.message);
  }
};
window.addEventListener("beforeunload", (event) => {
  if (dirty && currentView === "editor") {
    event.preventDefault();
    event.returnValue = "";
  }
});
function connectionText(text) {
  $(participantMode ? "#playerConnection" : "#hostConnection").textContent =
    text;
}
function send(type, data = {}) {
  if (socket?.readyState !== WebSocket.OPEN) {
    showToast("Reconnecting — please wait.");
    return false;
  }
  socket.send(JSON.stringify({ type, ...data }));
  return true;
}
function openSocket(initial) {
  clearTimeout(reconnectTimer);
  manualClose = false;
  if (socket) {
    const old = socket;
    old.onclose = null;
    old.close();
  }
  socket = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/live`,
  );
  connectionText("Connecting to the live room…");
  socket.onopen = () => {
    connectionText("Connected · answers and timers are synchronized");
    clockSent = Date.now();
    send("ping");
    if (initial) send(initial.type, initial);
  };
  socket.onmessage = (event) => {
    try {
      handleMessage(JSON.parse(event.data));
    } catch (err) {
      console.error("Rendering error", err);
      showToast("Unable to update this screen. Reload to reconnect.");
    }
  };
  socket.onerror = () =>
    connectionText("Connection unavailable. Check your internet connection.");
  socket.onclose = (event) => {
    sound.stop();
    if (manualClose) return;
    connectionText(
      event.code === 4000
        ? "Session moved to another tab."
        : "Disconnected. Reconnecting…",
    );
    if (event.code === 4000) {
      forgetConnection();
      return;
    }
    const saved = savedConnection();
    if (saved && game?.status !== "ended")
      reconnectTimer = setTimeout(
        () =>
          openSocket({
            type: participantMode ? "resume_player" : "resume_host",
            ...saved,
          }),
        2000,
      );
    else {
      connectionText("Disconnected. Join or launch a game to try again.");
      $("#joinGameBtn").disabled = false;
    }
  };
}
function launchQuiz(id) {
  sound.enable();
  if (game && game.status !== "ended") {
    showToast("Finish your current game before launching another.");
    $("#gameModal").classList.add("open");
    scheduleLiveFit();
    return;
  }
  forgetConnection();
  game = null;
  $("#gameModal").classList.add("open");
  $("#gameTitle").textContent = "Creating your game…";
  $("#hostQuestion").textContent = "Opening the room…";
  $("#hostOptions").innerHTML = "";
  $("#hostResults").innerHTML = "";
  $("#hostCode").textContent = "—";
  $("#nextQuestion").disabled = true;
  openSocket({ type: "create_game", quizId: id });
}
function loadGameMusic(url) {
  const container = $(participantMode ? "#playerMusic" : "#lobbyMusic");
  container.innerHTML = url
    ? `<label class="music-control">Custom soundtrack <audio hidden loop preload="metadata" src="${e(url)}"></audio></label>`
    : "";
  sound.setTrack($("audio", container));
}
let lastMusicRefresh = 0;
window.addEventListener("quiz:refresh-music", () => {
  if (game && Date.now() - lastMusicRefresh > 60000) {
    lastMusicRefresh = Date.now();
    send("refresh_music");
  }
});
function handleMessage(m) {
  if (m.serverNow) offset = m.serverNow - Date.now();
  if (m.type === "music_refreshed") {
    loadGameMusic(m.music);
    return;
  }
  if (m.game?.musicState) sound.setRemote(m.game.musicState);
  if (m.type === "music_control") {
    if (game) game.musicState = m.musicState;
    sound.setRemote(m.musicState);
    return;
  }
  if (m.type === "leaderboard_control") {
    if (game) game.leaderboardVisible = m.visible;
    showLiveLeaderboard(m.visible, m.leaderboard);
    return;
  }
  if (m.type === "round_intro") {
    game = m.game;
    renderRoundIntro();
    return;
  }
  if (m.type === "clock") {
    offset = m.serverNow - (Date.now() + clockSent) / 2;
    return;
  }
  if (m.type === "error") {
    showToast(m.message);
    if (answerPending) {
      answerPending = false;
      locked = false;
      lockAnswers();
      $("#answerStatus").textContent = m.message;
    }
    if (participantMode) {
      $("#joinStatus").textContent = m.message;
      $("#joinGameBtn").disabled = false;
      if (!game) {
        forgetConnection();
        manualClose = true;
        socket?.close();
      }
    } else if (!game) {
      forgetConnection();
      manualClose = true;
      socket?.close();
      $("#gameModal").classList.remove("open");
    }
    return;
  }
  if (["game_created", "host_resumed", "joined"].includes(m.type)) {
    game = m.game;
    liveQuestion = m.question;
    locked = !!m.answered;
    if (m.type === "joined") {
      storeConnection({ code: game.code, playerToken: m.playerToken });
      $("#joinPanel").hidden = true;
      $("#playerQuestion").hidden = false;
    } else {
      if (m.hostToken)
        storeConnection({ code: game.code, hostToken: m.hostToken });
      $("#gameModal").classList.add("open");
      $("#returnToGame").hidden = false;
      $("#gameTitle").textContent = game.title;
      $("#hostCode").textContent = game.code;
      $("#previewPlayer").href = joinURL();
    }
    loadGameMusic(m.music);
    if (game.status === "question") renderQuestion();
    else if (game.status === "results") {
      // Reconstruct the question before applying results after a reconnect/reload.
      if (liveQuestion) renderQuestion();
      renderResults(m.result);
    } else if (game.status === "ended") renderEnded(m.leaderboard);
    else if (game.status === "round_intro") renderRoundIntro();
    else renderLobby();
    renderPlayers();
    if (game.leaderboardVisible && game.status !== "ended")
      showLiveLeaderboard(true, m.visibleLeaderboard || []);
    return;
  }
  if (m.type === "participants_updated") {
    game = m.game;
    renderPlayers();
    if (game.leaderboardVisible && game.status !== "ended")
      showLiveLeaderboard(
        true,
        [...game.participants]
          .sort((a, b) => b.score - a.score)
          .map((p, i) => ({ ...p, rank: i + 1 })),
      );
    return;
  }
  if (m.type === "question_started") {
    answerPending = false;
    connectionText("Connected · answers and timers are synchronized");
    game = m.game;
    liveQuestion = m.question;
    locked = false;
    renderQuestion();
    renderPlayers();
    return;
  }
  if (m.type === "answer_received") {
    answerPending = false;
    locked = true;
    lockAnswers();
    $("#answerStatus").textContent =
      "Answer locked in. Results arrive when the timer ends.";
    return;
  }
  if (m.type === "question_ended") {
    game = m.game;
    renderResults(m);
    renderPlayers();
    return;
  }
  if (m.type === "game_ended") {
    game = m.game;
    renderEnded(m.leaderboard);
    renderPlayers();
    forgetConnection();
    if (!participantMode)
      loadWorkspace().catch((err) => showToast(err.message));
    return;
  }
  if (m.type === "host_offline") connectionText(m.message);
  if (m.type === "host_online")
    connectionText("Host reconnected · ready to continue.");
}
function joinURL() {
  return `${location.origin}/join?code=${encodeURIComponent(game.code)}`;
}
function stopQuestionAudio() {
  $$("#hostMedia audio, #playerMedia audio").forEach((audio) => audio.pause());
  sound.resetDuck();
}
function renderLobby() {
  stopQuestionAudio();
  sound.setPhase("lobby");
  setGameStyle("lobby");
  showLiveLeaderboard(false, []);
  $("#submitMulti").hidden = true;
  if (participantMode) {
    $("#playerRound").textContent = "WELCOME TO " + game.code;
    $("#playerTitle").textContent = "You’re in!";
    $("#playerHint").textContent =
      game.title + " · Waiting for your host to start.";
    $("#playerOptions").innerHTML = "";
    $("#playerMedia").innerHTML = "";
    $("#playerResults").innerHTML = "";
    $("#textAnswerForm").hidden = true;
    $("#answerStatus").textContent =
      "Get comfortable. Your next question is on its way.";
  } else {
    $("#hostRound").textContent = "LOBBY";
    $("#hostQuestionNumber").textContent = `${game.total} QUESTIONS`;
    $("#hostQuestion").textContent = "Ready when you are.";
    $("#hostHint").textContent =
      "Share the join link, then start the first question.";
    $("#hostMedia").innerHTML = "";
    $("#hostOptions").innerHTML = "";
    $("#hostResults").innerHTML = "";
    $("#nextQuestion").textContent = "Start question →";
    $("#nextQuestion").disabled = false;
  }
}
function renderQuestion() {
  multiSelection = new Set();
  showLiveLeaderboard(false, []);
  $("#submitMulti").hidden = !participantMode || liveQuestion?.type !== "multi";
  stopQuestionAudio();
  sound.setPhase("question");
  setGameStyle("question");
  const q = liveQuestion;
  if (!q) return;
  const prefix = participantMode ? "player" : "host";
  $(`#${prefix}Round`).textContent =
    `${q.roundLabel || roundTitle(q.roundIndex, q.round)}${q.lastInRound ? " · Last question of this round" : ""}`;
  $(`#${prefix}${participantMode ? "Title" : "Question"}`).textContent = q.text;
  $(`#${prefix}Hint`).textContent =
    q.type === "text"
      ? "Type your answer and lock it in."
      : q.type === "multi"
        ? "Select all correct answers, then submit. Wrong selections reduce partial credit."
        : "Choose one answer.";
  $(`#${prefix}Media`).innerHTML = mediaHTML(q.media, q.mediaType);
  $(`#${prefix}Results`).innerHTML = "";
  const options = $(`#${prefix}Options`);
  options.innerHTML = "";
  if (q.type !== "text") {
    q.options.forEach((option, i) => {
      const button = document.createElement(participantMode ? "button" : "div");
      button.className = participantMode
        ? "p-answer"
        : `answer ${["purple", "yellow", "green", "blue"][i % 4]}-answer`;
      button.dataset.answer = i;
      button.setAttribute(
        "aria-label",
        String.fromCharCode(65 + i) + " " + option,
      );
      button.innerHTML = `<span class="answer-shape" aria-hidden="true">${["▲", "◆", "●", "■", "⬟", "★"][i]}</span><span class="answer-copy">${e(option)}</span>`;
      if (participantMode)
        button.onclick = () => {
          if (q.type !== "multi") return submitAnswer(i, button);
          if (locked) return;
          if (multiSelection.has(i)) multiSelection.delete(i);
          else multiSelection.add(i);
          button.classList.toggle("selected", multiSelection.has(i));
          button.setAttribute("aria-pressed", String(multiSelection.has(i)));
          lockAnswers();
        };
      options.append(button);
    });
  }
  if (participantMode) {
    $("#textAnswerForm").hidden = q.type !== "text";
    $("#textAnswer").value = "";
    $("#answerStatus").textContent = locked
      ? "Your answer is locked in."
      : "Your first submission is final.";
    lockAnswers();
  } else {
    $("#hostQuestionNumber").textContent =
      `QUESTION ${q.index + 1} OF ${q.total} · UP TO ${q.points} POINTS`;
    $("#nextQuestion").textContent = "Reveal answers";
    $("#nextQuestion").disabled = false;
  }
}
function lockAnswers() {
  const disabled = locked || game?.status !== "question";
  $("#submitMulti").disabled = disabled || !multiSelection.size;
  $$(
    "#playerOptions button, #textAnswerForm input, #textAnswerForm button",
  ).forEach((b) => (b.disabled = disabled));
}
function submitAnswer(answer, button) {
  if (locked || game?.status !== "question") return;
  locked = true;
  answerPending = true;
  lockAnswers();
  button?.classList.add("selected");
  $("#answerStatus").textContent = "Sending your answer…";
  if (!send("submit_answer", { questionId: liveQuestion.id, answer })) {
    answerPending = false;
    locked = false;
    lockAnswers();
    $("#answerStatus").textContent =
      "Not sent. Please wait for the connection and try again.";
  }
}
$("#textAnswerForm").onsubmit = (event) => {
  event.preventDefault();
  submitAnswer($("#textAnswer").value);
};
function renderResults(result) {
  stopQuestionAudio();
  sound.setPhase("results");
  setGameStyle("results");
  const prefix = participantMode ? "player" : "host";
  $(`#${prefix}Hint`).textContent =
    (result?.roundEnded ? `${result.roundLabel} complete! · ` : "") +
    "Correct answer: " +
    (result?.correct || "—");
  if (liveQuestion?.type !== "text") {
    $$(`#${prefix}Options [data-answer]`).forEach((tile) => {
      tile.classList.toggle(
        "is-correct",
        (result?.correctIndices || []).includes(Number(tile.dataset.answer)),
      );
    });
  }
  $(`#${prefix}Results`).innerHTML = "";
  $("#submitMulti").hidden = true;
  showLiveLeaderboard(!!result?.leaderboardVisible, result?.leaderboard || []);
  if (participantMode) {
    $("#textAnswerForm").hidden = true;
    locked = true;
    lockAnswers();
    $("#answerStatus").textContent =
      "Nice work. Your host will start the next question.";
    if (!liveQuestion) $("#playerTitle").textContent = "Round results";
  } else {
    if (!liveQuestion) {
      $("#hostQuestion").textContent = "Round results";
      $("#hostQuestionNumber").textContent =
        `QUESTION ${game.index + 1} OF ${game.total}`;
    }
    $("#nextQuestion").textContent =
      game.index + 1 >= game.total
        ? "Finish & save results"
        : result?.roundEnded
          ? "Next round →"
          : "Next question →";
    $("#nextQuestion").disabled = false;
  }
}
function renderEnded(rows) {
  showLiveLeaderboard(false, []);
  $("#submitMulti").hidden = true;
  stopQuestionAudio();
  sound.setPhase("ended");
  setGameStyle("ended");
  connectionText("Session complete · thank you for playing.");
  const prefix = participantMode ? "player" : "host";
  $(`#${prefix}Round`).textContent = "THAT’S A WRAP";
  $(`#${prefix}${participantMode ? "Title" : "Question"}`).textContent =
    "A moment worth sharing.";
  $(`#${prefix}Hint`).textContent =
    "Thank you for playing. Here are the final results.";
  $(`#${prefix}Options`).innerHTML = "";
  $(`#${prefix}Media`).innerHTML = "";
  $(`#${prefix}Results`).innerHTML =
    podiumHTML(rows || []) + leaderboardHTML(rows || []);
  if (!participantMode) {
    $("#hostQuestion").textContent = "Final leaderboard";
    $("#hostHint").textContent =
      "Announce your winners! Results have been saved in Reports.";
  }
  if (participantMode) {
    $("#textAnswerForm").hidden = true;
    $("#answerStatus").textContent =
      "Your host has saved this session’s results.";
  } else {
    $("#nextQuestion").disabled = true;
    $("#nextQuestion").textContent = "Results saved ✓";
    $("#returnToGame").hidden = true;
  }
}
function renderPlayers() {
  if (!game || participantMode) return;
  $("#playerCount").textContent = game.participants.length;
  $("#answeredCount").textContent =
    game.status === "question"
      ? `${game.participants.filter((p) => p.answered).length} / ${game.participants.length} answered`
      : `${game.participants.filter((p) => p.connected).length} connected`;
}
setInterval(() => {
  if (!game) return;
  const remaining =
    game.status === "question"
      ? Math.max(0, Math.ceil((game.deadline - Date.now() - offset) / 1000))
      : 0;
  sound.remaining(remaining);
  $(participantMode ? "#playerTimer" : "#hostTimer").classList.toggle(
    "timer-urgent",
    game.status === "question" && remaining <= 5,
  );
  const text =
    game.status === "question"
      ? Math.max(0, Math.ceil((game.deadline - Date.now() - offset) / 1000)) +
        "s"
      : ["lobby", "round_intro"].includes(game.status)
        ? "READY"
        : game.status === "ended"
          ? "FINISHED"
          : "RESULTS";
  $(participantMode ? "#playerTimer" : "#hostTimer").textContent = text;
  if (
    participantMode &&
    game.status === "question" &&
    game.deadline <= Date.now() + offset
  ) {
    locked = true;
    lockAnswers();
  }
}, 150);
$("#nextQuestion").onclick = () => {
  if (!game) return;
  sound.enable();
  if (game.status === "question") {
    if (confirm("End the timer now and reveal the correct answer?"))
      send("reveal_answers");
  } else send("next_question");
};
$("#endGame").onclick = () => {
  if (game?.status === "ended") {
    minimizeGame();
    return;
  }
  if (game && confirm("End this game and save everyone’s results?"))
    send("end_game");
};
function minimizeGame() {
  if (document.fullscreenElement === $("#gameModal"))
    document.exitFullscreen().catch(() => {});
  $("#gameModal").classList.remove("open");
}
$("#closeGame").onclick = minimizeGame;
$("#returnToGame").onclick = () => {
  $("#gameModal").classList.add("open");
  scheduleLiveFit();
};
$("#copyJoin").onclick = async () => {
  if (!game) return;
  try {
    await navigator.clipboard.writeText(joinURL());
    showToast("Join link copied — share it with your players");
  } catch {
    showToast("Copy the link from Open player view.");
  }
};
$("#joinPanel").onsubmit = (event) => {
  event.preventDefault();
  sound.enable();
  $("#joinStatus").textContent = "Connecting…";
  $("#joinGameBtn").disabled = true;
  forgetConnection();
  game = null;
  openSocket({
    type: "join_game",
    code: $("#joinCodeInput").value.trim().toUpperCase(),
    name: $("#playerNameInput").value.trim(),
  });
};
$("#leavePlayer").onclick = () => {
  if (
    game?.status !== "ended" &&
    !confirm(
      "Leave this game? Your nickname and score will stay in the host’s report.",
    )
  )
    return;
  manualClose = true;
  sound.stop();
  clearTimeout(reconnectTimer);
  forgetConnection();
  socket?.close();
  game = null;
  $("#playerMedia").innerHTML = "";
  $("#playerQuestion").hidden = true;
  delete $("#participantApp").dataset.phase;
  $("#joinPanel").hidden = false;
  $("#joinGameBtn").disabled = false;
  $("#joinStatus").textContent = "";
  connectionText("Ready for your next game.");
};
async function initializeHost() {
  const session = await api("/api/session");
  account = session.user;
  privateSetupRequired = !!session.privateSetupRequired;
  setup = session.setupRequired && session.setupEnabled;
  if (account) {
    $("#authButton").textContent = "Sign out";
    $("#orgName").textContent = account.organization;
    await loadWorkspace();
    const saved = savedConnection();
    if (saved && !game) openSocket({ type: "resume_host", ...saved });
  } else {
    renderWorkspace();
    if (session.setupRequired && !session.setupEnabled)
      showToast(
        privateSetupRequired
          ? "First create your host account in the private Arena preview, then sign in here."
          : "Host account setup is required. See README for the private admin setup command.",
      );
  }
}
$("#today").textContent = new Date()
  .toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })
  .toUpperCase();
if (independentMode) {
  $("#hostApp").hidden = true;
  $("#participantApp").hidden = true;
} else if (participantMode) {
  $("#hostApp").hidden = true;
  $("#participantApp").hidden = false;
  $("#joinCodeInput").value =
    new URLSearchParams(location.search).get("code") || "";
  const saved = savedConnection();
  if (
    saved &&
    (!$("#joinCodeInput").value ||
      $("#joinCodeInput").value.toUpperCase() === saved.code)
  ) {
    openSocket({ type: "resume_player", ...saved });
  }
} else {
  renderWorkspace();
  initializeHost().catch((err) => showToast(err.message));
}

// Recovery-code reset and portable backups do not need an email service.
function downloadPrivate(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("#openRecovery").onclick = () => {
  $("#authModal").classList.remove("open");
  $("#recoverModal").classList.add("open");
  $("#recoverStatus").textContent = "";
};
$("#closeRecover").onclick = () => {
  $("#recoverModal").classList.remove("open");
  openAuth();
};
$("#recoverForm").onsubmit = async (event) => {
  event.preventDefault();
  const form = event.target;
  const button = $("button[type=submit]", form);
  button.disabled = true;
  $("#recoverStatus").textContent = "Resetting…";
  try {
    await api("/api/recover", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    form.reset();
    $("#recoverModal").classList.remove("open");
    openAuth();
    showToast("Password reset. Sign in, then download a new recovery code.");
  } catch (err) {
    $("#recoverStatus").textContent = err.message;
  } finally {
    button.disabled = false;
  }
};
$("#recoveryCodeForm").onsubmit = async (event) => {
  event.preventDefault();
  if (!requireHost()) return;
  const form = event.target;
  const button = $("button[type=submit]", form);
  button.disabled = true;
  try {
    const result = await api("/api/recovery-code", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    downloadPrivate(
      new Blob(
        [
          `PRIVATE — Quizzes account recovery\nHost email: ${result.email}\nOne-time recovery code: ${result.code}\n\nKeep this in your password manager. Never share it in chat. It can reset your host password. Generating a new code, changing your password, or using this code invalidates it.\n`,
        ],
        { type: "text/plain" },
      ),
      "quizzes-private-recovery.txt",
    );
    form.reset();
    $("#recoveryCodeStatus").textContent =
      "Downloaded. Store it securely; the previous code is now invalid.";
  } catch (err) {
    $("#recoveryCodeStatus").textContent = err.message;
  } finally {
    button.disabled = false;
  }
};
$("#backupForm").onsubmit = async (event) => {
  event.preventDefault();
  if (!requireHost()) return;
  const form = event.target;
  const button = $("button[type=submit]", form);
  button.disabled = true;
  $("#backupStatus").textContent = "Preparing your backup. Keep this tab open…";
  try {
    const response = await fetch("/api/backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    if (!response.ok)
      throw Error((await response.json()).error || "Backup failed");
    const blob = await response.blob();
    downloadPrivate(
      blob,
      `quizzes-private-backup-${new Date().toISOString().slice(0, 10)}.zip`,
    );
    form.reset();
    $("#backupStatus").textContent =
      "Downloaded. Keep this ZIP private and test restoring it before relying on it.";
  } catch (err) {
    $("#backupStatus").textContent = "Backup failed: " + err.message;
  } finally {
    button.disabled = false;
  }
};

function setGameStyle(phase) {
  $("#gameModal").dataset.phase = phase;
  $("#participantApp").dataset.phase = phase;
  scheduleLiveFit();
}
function podiumHTML(rows) {
  if (!rows.length) return "";
  const top = rows.slice(0, 3);
  return `<div class="podium" aria-label="Top three players">${[
    top[1],
    top[0],
    top[2],
  ]
    .filter(Boolean)
    .map(
      (p) =>
        `<div class="podium-place place-${p.rank}"><span aria-hidden="true">${p.rank === 1 ? "♛" : "★"}</span><b>${e(p.name)}</b><small>${Number(p.score).toLocaleString()} pts</small><strong>${p.rank}</strong></div>`,
    )
    .join(
      "",
    )}</div><div class="celebration" aria-hidden="true">✦ · ✧ · ★ · ✦ · ✧</div>`;
}
document.addEventListener("click", (event) => {
  if (!event.target.closest("[data-import]")) return;
  if (!requireHost()) return;
  $("#importStatus").textContent = "";
  $("#importDialog").showModal();
});
$("#closeImport").onclick = () => $("#importDialog").close();
$("#documentFile").onchange = () => {
  if ($("#documentFile").files.length) $("#documentText").value = "";
};
$("#documentText").oninput = () => {
  $("#documentFile").value = "";
};
$("#importForm").onsubmit = async (event) => {
  event.preventDefault();
  const file = $("#documentFile").files[0];
  const text = $("#documentText").value;
  if (!file && !text.trim()) {
    $("#importStatus").textContent =
      "Choose a document or paste some questions first.";
    return;
  }
  if (file && file.size > 5 * 1024 * 1024) {
    $("#importStatus").textContent = "Maximum file size is 5 MB.";
    return;
  }
  $("#importSubmit").disabled = true;
  $("#importStatus").textContent = "Reading your document…";
  try {
    const result = await api("/api/quiz-import", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(file?.name || "Imported quiz.txt"),
        "X-Answer-Style": $("#answerStyle").value,
      },
      body: file || new Blob([text], { type: "text/plain" }),
    });
    if (
      dirty &&
      currentView === "editor" &&
      !confirm("Replace your unsaved draft with the imported quiz?")
    )
      return;
    draft = result.quiz;
    draft._importReport = {
      recognized: result.recognized,
      needsAnswers: result.needsAnswers,
      warnings: result.warnings,
      sourceText: result.sourceText,
    };
    $("#importDialog").close();
    openEditor();
    dirty = true;
    showToast(
      `${result.recognized} questions extracted. Review the draft before saving.`,
    );
  } catch (err) {
    $("#importStatus").textContent = err.message;
  } finally {
    $("#importSubmit").disabled = false;
  }
};

function roundTitle(index, title) {
  const clean = String(title || "")
    .replace(/^round\s*\d+\s*[:.\-–—]?\s*/i, "")
    .trim();
  return `Round ${index + 1}${clean ? ": " + clean : ""}`;
}
function moveQuestions(selection, target) {
  collectDraft();
  if (!selection.length)
    return showToast("Select one or more questions first.");
  if (target === "new") {
    if (draft.rounds.length >= 20) return showToast("Maximum 20 rounds.");
    draft.rounds.push({ title: "", questions: [] });
    target = draft.rounds.length - 1;
  }
  target = Number(target);
  const destination = draft.rounds[target];
  if (!destination) return;
  const moving = selection
    .filter((s) => s.ri !== target)
    .map((s) => ({ ...s, q: draft.rounds[s.ri]?.questions[s.qi] }))
    .filter((s) => s.q);
  if (!moving.length) return;
  if (
    destination.questions.length === 1 &&
    !destination.questions[0].text &&
    !destination.questions[0].media
  )
    destination.questions = [];
  for (const item of [...moving].sort((a, b) => b.ri - a.ri || b.qi - a.qi))
    draft.rounds[item.ri].questions.splice(item.qi, 1);
  destination.questions.push(...moving.map((s) => s.q));
  dirty = true;
  renderEditor();
}
$("#moveSelected").onclick = () =>
  moveQuestions(
    $$(".question-select:checked").map((input) => {
      const card = input.closest(".question-card");
      return { ri: Number(card.dataset.ri), qi: Number(card.dataset.qi) };
    }),
    $("#bulkRound").value,
  );
$("#submitMulti").onclick = () =>
  submitAnswer([...multiSelection].sort((a, b) => a - b));
function showLiveLeaderboard(visible, rows) {
  // One focused standings screen on both devices; never a score sidebar beside a question.
  const panel = $(participantMode ? "#playerLeaderboard" : "#hostLeaderboard");
  const wasVisible = !panel.hidden;
  const show = !!visible && game?.status !== "ended";
  panel.hidden = !show;
  const questionArea = $(
    participantMode ? "#playerQuestion" : "#gameModal .stage-question",
  );
  questionArea.classList.toggle("leaderboard-only", show);
  panel.innerHTML = show
    ? '<div class="eyebrow">LIVE STANDINGS</div><h2 tabindex="-1">Leaderboard</h2><p class="muted">' +
      (participantMode
        ? "Total points · Your host will continue shortly."
        : "Total points · Announce the standings, then continue the quiz.") +
      "</p>" +
      leaderboardHTML(rows || [])
    : "";
  if (show) {
    stopQuestionAudio();
    if (participantMode && !wasVisible)
      $("h2", panel).focus({ preventScroll: true });
  }
  $("#toggleLeaderboard").textContent =
    game?.status === "ended"
      ? "Final leaderboard shown"
      : show
        ? "Hide leaderboard"
        : "Show leaderboard";
  $("#toggleLeaderboard").disabled = game?.status === "ended";
  $("#toggleLeaderboard").setAttribute(
    "aria-pressed",
    String(show || game?.status === "ended"),
  );
  scheduleLiveFit();
}
$("#toggleLeaderboard").onclick = () => {
  if (game) send("set_leaderboard", { visible: !game.leaderboardVisible });
};
function renderRoundIntro() {
  stopQuestionAudio();
  sound.setPhase("lobby");
  setGameStyle("round_intro");
  showLiveLeaderboard(false, []);
  $("#submitMulti").hidden = true;
  const prefix = participantMode ? "player" : "host";
  $(`#${prefix}Round`).textContent = "NEXT ROUND";
  $(`#${prefix}${participantMode ? "Title" : "Question"}`).textContent =
    game.upcomingRound;
  $(`#${prefix}Hint`).textContent =
    "Get ready! The host will start the first question.";
  for (const id of ["Options", "Media", "Results"])
    $(`#${prefix}${id}`).innerHTML = "";
  $("#textAnswerForm").hidden = true;
  $("#hostQuestionNumber").textContent = "ROUND BREAK";
  renderPlayers();
  if (participantMode)
    $("#answerStatus").textContent = "A fresh round. A new chance to climb.";
  else {
    $("#nextQuestion").textContent = "Start this round →";
    $("#nextQuestion").disabled = false;
  }
}

// Fit typical live questions to the available viewport without clipping content.
// At the readable minimum, exceptionally long content may scroll rather than become unreadable.
let liveFitFrame = 0;
function scheduleLiveFit() {
  cancelAnimationFrame(liveFitFrame);
  liveFitFrame = requestAnimationFrame(fitLiveScreen);
}
function fitLiveScreen() {
  const root = participantMode ? $("#participantApp") : $("#gameModal");
  if (!game || (!participantMode && !root.classList.contains("open"))) return;
  const surface = participantMode ? $(".participant-card") : $(".game-stage");
  root.style.setProperty("--live-question", "40px");
  root.style.setProperty("--live-option", "24px");
  root.style.setProperty("--live-media", "200px");
  root.style.setProperty("--live-gap", "14px");
  if (
    game.status === "ended" ||
    !$(participantMode ? "#playerLeaderboard" : "#hostLeaderboard").hidden
  )
    return;
  for (let step = 0; step <= 12; step++) {
    root.style.setProperty(
      "--live-question",
      `${Math.max(20, 40 - step * 2)}px`,
    );
    root.style.setProperty("--live-option", `${Math.max(16, 24 - step)}px`);
    root.style.setProperty(
      "--live-media",
      `${Math.max(72, 200 - step * 12)}px`,
    );
    root.style.setProperty("--live-gap", `${Math.max(6, 14 - step)}px`);
    if (surface.scrollHeight <= surface.clientHeight + 2) break;
  }
}
window.addEventListener("resize", scheduleLiveFit);
document.addEventListener("fullscreenchange", () => {
  $("#fullscreenGame").textContent = document.fullscreenElement
    ? "Exit full screen"
    : "Full screen";
  scheduleLiveFit();
});
document.addEventListener(
  "load",
  (event) => {
    if (event.target.matches?.("#hostMedia img, #playerMedia img"))
      scheduleLiveFit();
  },
  true,
);
$("#fullscreenGame").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $("#gameModal").requestFullscreen();
  } catch {
    showToast(
      "Full screen is unavailable here. You can use your browser's full-screen mode.",
    );
  }
};
