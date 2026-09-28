"use strict";
(() => {
  const $ = (s) => document.querySelector(s),
    e = (v) =>
      String(v ?? "").replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
  let quiz,
    questions = [],
    index = -1,
    phase = "lobby",
    started = 0,
    deadline = 0,
    score = 0,
    answered = false,
    points = 0,
    selected = new Set(),
    board = false;
  const rules = window.QuizzesRules;
  function current() {
    return questions[index];
  }
  function media(q) {
    if (!q.media || !/^\/media\/[a-f0-9-]{36}$/.test(q.media)) return "";
    return q.mediaType?.startsWith("image/")
      ? `<img class="question-media" decoding="async" loading="eager" fetchpriority="high" src="${e(q.media)}" alt="Question image">`
      : `<audio class="question-audio" controls preload="metadata" src="${e(q.media)}"></audio>`;
  }
  function preflight() {
    const warnings = [];
    if (!quiz.title?.trim()) warnings.push("Add a quiz title before saving.");
    for (const [i, q] of questions.entries()) {
      if (!(q.seconds >= 5 && q.seconds <= 120))
        warnings.push(`Question ${i + 1}: set a timer from 5 to 120 seconds.`);
      if (!(q.points >= 100 && q.points <= 5000))
        warnings.push(
          `Question ${i + 1}: set maximum points from 100 to 5000.`,
        );
      if (q.media && !q.mediaType)
        warnings.push(
          `Question ${i + 1}: media type is missing; check or reattach the file.`,
        );
      if (!q.text?.trim())
        warnings.push(`Question ${i + 1}: add question text.`);
      if (q.text?.length > 220 || q.options?.some((o) => o.length > 90))
        warnings.push(
          `Question ${i + 1}: long text—check wrapping at your projector size.`,
        );
      if (q.type === "text" && !q.accepted?.some((x) => x.trim()))
        warnings.push(`Question ${i + 1}: add an accepted answer.`);
      if (
        q.type !== "text" &&
        (q.options?.length < 2 || q.options?.some((x) => !x.trim()))
      )
        warnings.push(`Question ${i + 1}: complete all answer choices.`);
      if (
        q.type === "multi"
          ? !q.correctAnswers?.length
          : q.type !== "text" &&
            !(q.correct >= 0 && q.correct < q.options?.length)
      )
        warnings.push(`Question ${i + 1}: select the correct answer(s).`);
    }
    const seconds = questions.reduce(
      (n, q) => n + (Number(q.seconds) || 20),
      0,
    );
    $("#rehearsalChecks").innerHTML =
      `<li>${questions.length} questions · ${Math.ceil(seconds / 60)} minute(s) of question timers, excluding discussion/breaks.</li>` +
      (warnings.length
        ? warnings
            .slice(0, 15)
            .map((w) => `<li class="preflight-warning">${e(w)}</li>`)
            .join("")
        : "<li>No obvious text/answer-key gaps found. Still review every question and media item.</li>") +
      "<li>Check Gujarati/mixed-language text, image labels and actual phone readability.</li><li>Sound test checks local playback only; participant audio needs its own browser gesture.</li>";
  }
  function reset() {
    if (!quiz) return;
    index = -1;
    phase = "lobby";
    score = 0;
    answered = false;
    points = 0;
    board = false;
    selected = new Set();
    $("#rehearsalMediaStatus").textContent = "";
    render();
  }
  function begin() {
    index++;
    if (index >= questions.length) {
      phase = "ended";
      render();
      return;
    }
    phase = "question";
    started = Date.now();
    deadline = started + (Number(current().seconds) || 20) * 1000;
    answered = false;
    points = 0;
    selected = new Set();
    board = false;
    render();
  }
  function reveal() {
    if (phase !== "question") return;
    phase = "results";
    score += points;
    board =
      index === questions.length - 1 ||
      questions[index + 1].roundIndex !== current().roundIndex;
    render();
  }
  function advance() {
    if (phase === "question") return reveal();
    if (phase === "ended") return reset();
    if (
      phase === "results" &&
      index + 1 < questions.length &&
      questions[index + 1].roundIndex !== current().roundIndex
    ) {
      phase = "round_intro";
      board = false;
      render();
      return;
    }
    const next = questions[index + 1],
      afterNext = questions[index + 2];
    if (
      next &&
      phase !== "last_question_intro" &&
      (!afterNext || afterNext.roundIndex !== next.roundIndex)
    ) {
      phase = "last_question_intro";
      board = false;
      render();
      return;
    }
    begin();
  }
  function submit(answer) {
    if (answered || phase !== "question" || Date.now() >= deadline) return;
    try {
      const credit = rules.grade(current(), answer);
      points = Math.round(
        Math.max(
          100,
          Math.round(
            Number(current().points || 1000) *
              (1 -
                (0.5 * (Date.now() - started)) /
                  ((Number(current().seconds) || 20) * 1000)),
          ),
        ) * credit,
      );
      answered = true;
      $("#rehearsalPlayerStatus").textContent =
        "Answer locked in. Reveal from the host controls.";
      document
        .querySelectorAll("#rehearsalPlayer button, #rehearsalPlayer input")
        .forEach((b) => (b.disabled = true));
    } catch (err) {
      $("#rehearsalPlayerStatus").textContent =
        "Check this draft's answer settings: " + err.message;
    }
  }
  function render() {
    if (!quiz) return;
    document.querySelectorAll("audio").forEach((a) => a.pause());
    const q = current(),
      host = $("#rehearsalStage"),
      player = $("#rehearsalPlayer");
    $("#rehearsalAdvance").disabled = false;
    $("#rehearsalStandings").disabled = phase === "ended";
    $("#rehearsalStandings").textContent = board
      ? "Hide standings"
      : "Show standings";
    $("#rehearsalAdvance").textContent =
      phase === "last_question_intro"
        ? "Start last question"
        : phase === "question"
          ? "Reveal answer"
          : phase === "lobby"
            ? "Start question"
            : phase === "round_intro"
              ? "Start this round"
              : phase === "ended"
                ? "Restart rehearsal"
                : index + 1 === questions.length
                  ? "Finish rehearsal"
                  : "Next question";
    $("#rehearsalNotes").textContent = q?.notes
      ? "Private host note: " + q.notes
      : "Private host notes appear here; never on the real projector.";
    if (board || phase === "ended") {
      host.innerHTML = `<h2>${phase === "ended" ? "Final rankings" : "Leaderboard"}</h2><div class="rehearsal-score">1. Test player <strong>${score.toLocaleString()} pts</strong></div><p>No real scores or reports are saved.</p>`;
      player.innerHTML = `<h2>${phase === "ended" ? "Rehearsal complete" : "Leaderboard"}</h2><p>1. Test player · ${score.toLocaleString()} pts</p>`;
      return;
    }
    if (["round_intro", "last_question_intro"].includes(phase)) {
      const title =
        (phase === "last_question_intro" ? "Last question of " : "") +
        questions[index + 1].roundLabel;
      host.innerHTML = `<div class="eyebrow">ROUND ANNOUNCEMENT</div><h2>${e(title)}</h2><p>The host starts the question when ready. No timer is running yet.</p>`;
      player.innerHTML = `<h2>${e(title)}</h2><p>Get ready! Your question will appear when the host starts it.</p>`;
      return;
    }
    if (phase === "lobby") {
      host.innerHTML = `<div class="eyebrow">${phase === "lobby" ? "LOBBY" : "NEXT ROUND"}</div><h2>${e(phase === "lobby" ? quiz.title : questions[index + 1]?.roundLabel)}</h2><p>One simulated player is ready. No join code is issued.</p>`;
      player.innerHTML =
        "<h2>You’re in!</h2><p>Waiting for your test question.</p>";
      return;
    }
    let solution = "";
    if (phase === "results") {
      try {
        solution = rules.solution(q);
      } catch {
        solution = "Complete the draft answer key.";
      }
    }
    host.innerHTML = `<div class="eyebrow">${e(q.roundLabel)} · ${index + 1}/${questions.length} <b class="rehearsal-timer"></b></div><h2>${e(q.text || "Untitled question")}</h2>${media(q)}<div class="rehearsal-options">${(q.options || []).map((o, i) => `<div class="tile-${i}">${e(o || "Add an answer")}</div>`).join("")}</div><p>${phase === "results" ? "Correct answer: " + e(solution) : "Answer on the simulated phone, then reveal."}</p>`;
    player.innerHTML = `<div class="eyebrow">${index + 1}/${questions.length} · <b class="rehearsal-timer"></b></div><h2>${e(q.text || "Untitled question")}</h2>${media(q)}<div class="rehearsal-options">${q.type === "text" ? '<input id="rehearsalText" aria-label="Test answer" maxlength="200"><button id="rehearsalSubmit" class="primary-btn">Submit answer</button>' : (q.options || []).map((o, i) => `<button data-choice="${i}" class="tile-${i}" ${phase !== "question" || answered ? "disabled" : ""}>${e(o || "Add an answer")}</button>`).join("")}</div>${q.type === "multi" ? '<button id="rehearsalSubmit" class="primary-btn">Submit selected</button>' : ""}<p id="rehearsalPlayerStatus" role="status">${phase === "results" ? "Correct answer: " + e(solution) + " · " + points + " points" : answered ? "Answer locked in." : "Choose an answer."}</p>`;
    document.querySelectorAll("[data-choice]").forEach(
      (b) =>
        (b.onclick = () => {
          const i = Number(b.dataset.choice);
          if (q.type !== "multi") return submit(i);
          if (selected.has(i)) selected.delete(i);
          else selected.add(i);
          b.classList.toggle("selected", selected.has(i));
          b.setAttribute("aria-pressed", String(selected.has(i)));
        }),
    );
    if ($("#rehearsalSubmit")) {
      $("#rehearsalSubmit").disabled = phase !== "question" || answered;
      $("#rehearsalSubmit").onclick = () =>
        submit(q.type === "multi" ? [...selected] : $("#rehearsalText").value);
    }
    const image = $("#rehearsalPlayer img"),
      began = performance.now();
    if (image) {
      $("#rehearsalMediaStatus").textContent =
        "Loading this question image on this computer…";
      image.onload = () =>
        ($("#rehearsalMediaStatus").textContent =
          `Image loaded locally in ${Math.round(performance.now() - began)} ms. This is not a participant-network result.`);
      image.onerror = () =>
        ($("#rehearsalMediaStatus").textContent =
          "Image could not load. Check sign-in and the original attachment before hosting.");
    }
    tick();
  }
  function tick() {
    document
      .querySelectorAll(".rehearsal-timer")
      .forEach(
        (el) =>
          (el.textContent =
            phase === "question"
              ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) + "s"
              : "RESULTS"),
      );
    if (phase === "question" && Date.now() >= deadline) reveal();
  }
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== window.opener)
      return;
    if (event.data?.type === "quizzes:rehearsal-clear") {
      quiz = null;
      questions = [];
      phase = "ended";
      document.querySelectorAll("audio").forEach((a) => a.pause());
      $("#rehearsalTitle").textContent = "Rehearsal closed";
      $("#rehearsalNotes").textContent = "";
      $("#rehearsalChecks").replaceChildren();
      $("#rehearsalMediaStatus").textContent = "";
      $("#rehearsalAdvance").disabled = true;
      $("#rehearsalStandings").disabled = true;
      $("#rehearsalStage").replaceChildren();
      $("#rehearsalPlayer").textContent =
        "Host signed out. Close this rehearsal.";
      return;
    }
    if (event.data?.type !== "quizzes:rehearsal-document") return;
    quiz = event.data.document;
    if (!quiz?.rounds) return;
    questions = quiz.rounds.flatMap((r, i) =>
      r.questions.map((q) => ({
        ...q,
        roundIndex: i,
        roundLabel: rules.roundLabel(i, r.title),
      })),
    );
    $("#rehearsalTitle").textContent = quiz.title || "Untitled draft";
    preflight();
    reset();
  });
  $("#rehearsalAdvance").onclick = advance;
  $("#restartRehearsal").onclick = reset;
  $("#rehearsalStandings").onclick = () => {
    board = !board;
    render();
  };
  $("#rehearsalSound").onclick = async () => {
    try {
      const audio = new (window.AudioContext || window.webkitAudioContext)();
      await audio.resume();
      const oscillator = audio.createOscillator(),
        gain = audio.createGain();
      gain.gain.value = 0.08;
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.2);
      oscillator.onended = () => audio.close();
      $("#rehearsalSoundStatus").textContent =
        "Test tone sent. Confirm you can hear it; browser/device mute still applies.";
    } catch {
      $("#rehearsalSoundStatus").textContent =
        "Audio is blocked. Check browser/device sound settings.";
    }
  };
  setInterval(tick, 150);
  window.opener?.postMessage(
    { type: "quizzes:rehearsal-ready" },
    location.origin,
  );
})();
