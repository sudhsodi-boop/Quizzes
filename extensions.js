"use strict";
// Private-workspace invitations and persistent, self-paced publications.
(() => {
  let resultForExport = null,
    publicState = null,
    publicationRows = [],
    extendId = null;
  async function copyLink(url) {
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied");
    } catch {
      showToast("Select and copy the displayed link.");
    }
  }
  async function publications() {
    const ownerId = account?.id;
    if (!account) {
      $("#publicationList").innerHTML = "";
      $("#inviteLink").hidden = true;
      $("#inviteLink").value = "";
      $("#inviteStatus").textContent = "";
      $("#publicationResults").innerHTML = "";
      resultForExport = null;
      publicationRows = [];
      extendId = null;
      $("#extendDialog").close();
      $("#publicationDialog").close();
      return;
    }
    try {
      const rows = await api("/api/publications");
      if (account?.id !== ownerId) return;
      publicationRows = rows;
      $("#publicationList").innerHTML = rows.length
        ? rows
            .map(
              (p) =>
                `<article class="publication-card"><div><b>${e(p.title)}</b><p>${Date.now() < p.closes ? "Open until" : "Closed"} ${e(new Date(p.closes).toLocaleString())} · ${p.participants}/100 attempts</p><input readonly aria-label="Published quiz link" value="${e(location.origin + "/play?quiz=" + p.id)}"></div><div class="button-row"><button class="secondary-btn" data-copy-publication="${p.id}">Copy link</button><button class="secondary-btn" data-publication-results="${p.id}">View results</button>${Date.now() < p.closes ? `<button class="secondary-btn" data-extend-publication="${p.id}">Extend time</button><button class="text-btn" data-close-publication="${p.id}">Close now</button>` : `<button class="text-btn" data-delete-publication="${p.id}">Delete results</button>`}</div></article>`,
            )
            .join("")
        : '<p class="muted">Choose Publish 24h on a saved quiz to create your first link.</p>';
    } catch (err) {
      $("#publicationList").textContent = err.message;
    }
  }
  document.addEventListener("quizzes:workspace", publications);
  $("#refreshPublications").onclick = () => {
    if (requireHost()) publications();
  };
  $("#createInvite").onclick = async () => {
    if (!requireHost()) return;
    $("#createInvite").disabled = true;
    try {
      const r = await api("/api/invitations", { method: "POST", body: "{}" });
      const link = location.origin + r.path;
      $("#inviteLink").hidden = false;
      $("#inviteLink").value = link;
      $("#inviteStatus").textContent =
        "Private one-use invitation. Expires " +
        new Date(r.expires).toLocaleString();
      await copyLink(link);
    } catch (err) {
      $("#inviteStatus").textContent = err.message;
    } finally {
      $("#createInvite").disabled = false;
    }
  };
  document.addEventListener("click", async (event) => {
    const b = event.target.closest("button");
    if (!b) return;
    try {
      if (b.dataset.publish) {
        if (
          !requireHost() ||
          !confirm(
            "Publish a snapshot of this quiz for 24 hours? Anyone with the link can attempt it once per browser. Correct answers appear after closing.",
          )
        )
          return;
        b.disabled = true;
        const p = await api("/api/publications", {
          method: "POST",
          body: JSON.stringify({ quizId: b.dataset.publish }),
        });
        await publications();
        await copyLink(location.origin + p.path);
        $("#publicationList").scrollIntoView({ behavior: "smooth" });
      }
      if (b.dataset.copyPublication)
        await copyLink(
          location.origin + "/play?quiz=" + b.dataset.copyPublication,
        );
      if (
        b.dataset.closePublication &&
        confirm(
          "Close this publication now? Participants can no longer submit, and their correct answers will become available.",
        )
      ) {
        await api(
          "/api/publications/" + b.dataset.closePublication + "/close",
          { method: "POST", body: "{}" },
        );
        await publications();
      }
      if (b.dataset.extendPublication) {
        const p = publicationRows.find(
          (p) => p.id === b.dataset.extendPublication,
        );
        if (!p) return;
        extendId = p.id;
        const suggested = new Date(p.closes + 24 * 60 * 60 * 1000);
        $("#extendDeadline").value = new Date(
          suggested.getTime() - suggested.getTimezoneOffset() * 60000,
        )
          .toISOString()
          .slice(0, 16);
        $("#extendCurrent").textContent =
          "Current deadline: " + new Date(p.closes).toLocaleString();
        $("#extendStatus").textContent = "";
        $("#extendDialog").showModal();
      }
      if (
        b.dataset.deletePublication &&
        confirm(
          "Permanently delete this closed publication and all its participant results? The old link will stop working. Your saved quiz and existing backup files are kept.",
        )
      ) {
        await api("/api/publications/" + b.dataset.deletePublication, {
          method: "DELETE",
        });
        resultForExport = null;
        $("#publicationResults").innerHTML = "";
        await publications();
        showToast("Published results deleted");
      }
      if (b.dataset.publicationResults) {
        const viewerId = account?.id;
        const r = await api(
          "/api/publications/" + b.dataset.publicationResults + "/results",
        );
        if (account?.id !== viewerId) return;
        resultForExport = r;
        $("#publicationResults").innerHTML =
          `<h2>${e(r.title)}</h2><p>${r.closed ? "Final results" : "Live progress — not final until closing"} · ${e(new Date(r.closes).toLocaleString())}</p><div class="results-scroll"><table><thead><tr><th>Rank</th><th>Nickname</th><th>Points</th><th>Progress</th><th>Status</th></tr></thead><tbody>${r.leaderboard.map((row) => `<tr><td>${row.rank}</td><td>${e(row.name)}</td><td>${row.score}</td><td>${row.answered}/${r.total}</td><td>${e(row.status)}</td></tr>`).join("")}</tbody></table></div>${r.leaderboard.length ? "" : "<p>No attempts yet.</p>"}`;
        $("#publicationDialog").showModal();
      }
    } catch (err) {
      showToast(err.message);
    } finally {
      if (b.dataset.publish) b.disabled = false;
    }
  });
  $("#closeExtendDialog").onclick = () => $("#extendDialog").close();
  $("#extendPublicationForm").onsubmit = async (event) => {
    event.preventDefault();
    if (!extendId) return;
    const button = $("button[type=submit]", event.target);
    button.disabled = true;
    try {
      await api("/api/publications/" + extendId + "/extend", {
        method: "POST",
        body: JSON.stringify({
          closes: new Date($("#extendDeadline").value).getTime(),
        }),
      });
      $("#extendDialog").close();
      await publications();
      showToast("Deadline extended; the participant link is unchanged");
    } catch (err) {
      $("#extendStatus").textContent = err.message;
    } finally {
      button.disabled = false;
    }
  };
  let oversightGeneration = 0;
  async function loadOversight() {
    const generation = ++oversightGeneration;
    $("#oversightPanel").hidden = !account?.isSiteAdmin;
    $("#oversightContent").innerHTML = "";
    $("#oversightWorkspace").innerHTML = "";
    if (!account?.isSiteAdmin) return;
    try {
      const users = await api("/api/oversight/workspaces");
      if (generation !== oversightGeneration || !account?.isSiteAdmin) return;
      $("#oversightWorkspace").innerHTML =
        '<option value="">Select a workspace…</option>' +
        users
          .map(
            (u) =>
              `<option value="${e(u.id)}">${e(u.organization)} · ${e(u.email)}</option>`,
          )
          .join("");
    } catch (err) {
      if (generation === oversightGeneration)
        $("#oversightContent").textContent = err.message;
    }
  }
  document.addEventListener("quizzes:workspace", loadOversight);
  $("#refreshOversight").onclick = loadOversight;
  $("#oversightWorkspace").onchange = async (event) => {
    const id = event.target.value,
      generation = ++oversightGeneration;
    $("#oversightContent").textContent = id ? "Loading workspace…" : "";
    if (!id) return;
    try {
      const w = await api(
        "/api/oversight/workspaces/" + encodeURIComponent(id),
      );
      if (generation !== oversightGeneration || !account?.isSiteAdmin) return;
      $("#oversightContent").innerHTML =
        `<h3>${e(w.owner.organization)} — read-only</h3><h3>Saved quizzes (${w.quizzes.length})</h3>` +
        w.quizzes
          .map(
            (q) =>
              `<details class="report-detail"><summary>${e(q.title)} · ${e(summary(q))}</summary><p>${e(q.description || "")}</p>${mediaHTML(q.music, "audio/mpeg")}${q.rounds.map((r, ri) => `<h4>${e(roundTitle(ri, r.title))}</h4>${r.questions.map((question, i) => `<div class="solution"><b>${i + 1}. ${e(question.text)}</b>${question.options ? `<p>${question.options.map(e).join(" · ")}</p>` : ""}<p>Correct: ${e(question.type === "text" ? question.accepted.join(" / ") : (question.type === "multi" ? question.correctAnswers : [question.correct]).map((index) => question.options?.[index] ?? (index === 0 ? "True" : "False")).join(" + "))}</p>${mediaHTML(question.media, question.mediaType)}</div>`).join("")}`).join("")}</details>`,
          )
          .join("") +
        `<h3>Completed live reports (${w.reports.length})</h3>` +
        w.reports
          .map(
            (r) =>
              `<details class="report-detail"><summary>${e(r.title)} · ${e(new Date(r.ended).toLocaleString())}</summary>${leaderboardHTML(r.leaderboard)}</details>`,
          )
          .join("") +
        `<h3>Self-paced publications (${w.publications.length})</h3>` +
        w.publications
          .map(
            (p) =>
              `<div class="publication-card"><span>${e(p.title)} · ${Date.now() < p.closes ? "Open until" : "Closed"} ${e(new Date(p.closes).toLocaleString())}</span><button class="secondary-btn" data-publication-results="${p.id}">View results</button></div>`,
          )
          .join("");
    } catch (err) {
      if (generation === oversightGeneration)
        $("#oversightContent").textContent = err.message;
    }
  };
  $("#closePublicationDialog").onclick = () => $("#publicationDialog").close();
  $("#exportPublication").onclick = () => {
    if (!resultForExport) return;
    const r = resultForExport,
      quote = (v) =>
        '"' +
        String(v)
          .replace(/^[=+@\-\t\r]/, "'$&")
          .replace(/"/g, '""') +
        '"';
    const csv = [
      ["Rank", "Nickname", "Points", "Questions answered", "Status"],
      ...r.leaderboard.map((a) => [
        a.rank,
        a.name,
        a.score,
        a.answered,
        a.status,
      ]),
    ]
      .map((row) => row.map(quote).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "quizzes-published-results.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (location.pathname === "/invite") {
    const invite = location.hash.slice(1);
    $("#independentApp").hidden = false;
    $("#independentApp").innerHTML =
      `<div class="independent-brand">Quizzes</div><section class="panel"><h1>Your own quiz workspace</h1><p>Your workspace is separate from other friends. The designated site administrator can view your quizzes and results for oversight.</p><form id="friendSignup"><label>Workspace name<input name="organization" required maxlength="120" autocomplete="organization"></label><label>Email<input name="email" type="email" required maxlength="254" autocomplete="email"></label><label>Password<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label><button class="primary-btn" type="submit">Create private workspace</button><p id="friendStatus" role="status"></p></form><a href="/">Already registered? Host sign in</a></section>`;
    $("#friendSignup").onsubmit = async (event) => {
      event.preventDefault();
      const button = $("button", event.target);
      button.disabled = true;
      try {
        await api("/api/invitations/redeem", {
          method: "POST",
          body: JSON.stringify({
            ...Object.fromEntries(new FormData(event.target)),
            invite,
          }),
        });
        sessionStorage.removeItem("quizzes-host");
        location.replace("/");
      } catch (err) {
        $("#friendStatus").textContent = err.message;
      } finally {
        button.disabled = false;
      }
    };
  }
  if (location.pathname === "/play") {
    const id = new URLSearchParams(location.search).get("quiz");
    $("#independentApp").hidden = false;
    const endpoint = "/api/published/" + encodeURIComponent(id || "");
    const soundtrack = document.createElement("audio");
    soundtrack.id = "publishedBackground";
    soundtrack.hidden = true;
    soundtrack.loop = true;
    soundtrack.preload = "metadata";
    document.body.append(soundtrack);
    let musicURL = "",
      musicRetry = 0,
      polling = false,
      submitting = false,
      actionRevision = 0;
    function soundStatus() {
      const button = $("#enablePublishedSound"),
        status = $("#publishedSoundStatus");
      if (!button) return;
      const playing = !soundtrack.paused && !soundtrack.error;
      button.hidden = playing;
      status.textContent = playing
        ? "Quiz soundtrack playing"
        : "Tap Enable sound if your browser has blocked playback.";
    }
    for (const event of ["play", "pause", "error"])
      soundtrack.addEventListener(event, soundStatus);
    function syncMusic(state, force = false) {
      if (!state.music || state.closed || state.attempt?.completed) {
        sound.stop();
        sound.setTrack(null);
        soundtrack.pause();
        musicURL = "";
        return;
      }
      const expiry = musicURL
        ? Number(new URL(musicURL, location.origin).searchParams.get("until"))
        : 0;
      if (
        force ||
        !musicURL ||
        expiry < (state.serverNow || Date.now()) + 5 * 60 * 1000
      ) {
        musicURL = state.music;
        const position = soundtrack.currentTime || 0;
        soundtrack.src = musicURL;
        soundtrack.addEventListener(
          "loadedmetadata",
          () => {
            if (Number.isFinite(soundtrack.duration) && position > 0)
              soundtrack.currentTime = position % soundtrack.duration;
          },
          { once: true },
        );
        sound.setTrack(soundtrack);
      }
      sound.setPhase("lobby");
      soundStatus();
    }
    async function poll(forceMusic = false) {
      if (polling || submitting) return;
      polling = true;
      const revision = actionRevision;
      try {
        const state = await api(endpoint);
        if (submitting || revision !== actionRevision) return;
        if (
          !publicState ||
          state.closed ||
          state.attempt?.cursor !== publicState.attempt?.cursor ||
          state.attempt?.completed !== publicState.attempt?.completed
        )
          render(state);
        else {
          publicState = state;
          const deadline = $(".publication-deadline", $("#independentApp"));
          if (deadline)
            deadline.textContent =
              "Closes " + new Date(state.closes).toLocaleString();
          syncMusic(state, forceMusic);
        }
      } catch (err) {
        if ($("#attemptStatus")) $("#attemptStatus").textContent = err.message;
        if (forceMusic || err.status === 404) sound.stop();
        if (err.status === 404) {
          publicState = null;
          $("#independentApp").innerHTML =
            `<div class="independent-brand">Quizzes</div><section class="panel"><h1>Quiz unavailable</h1><p>This publication was removed or is no longer available.</p></section>`;
        }
      } finally {
        polling = false;
      }
    }
    window.addEventListener("quiz:refresh-music", () => {
      sound.stop();
      if (Date.now() - musicRetry > 60000) {
        musicRetry = Date.now();
        poll(true);
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && publicState && !publicState.closed) poll();
    });
    async function refresh() {
      try {
        render(await api(endpoint));
      } catch (err) {
        sound.stop();
        $("#independentApp").innerHTML =
          `<div class="independent-brand">Quizzes</div><section class="panel"><h1>Unable to open quiz</h1><p>${e(err.message)}</p><button class="secondary-btn" id="retryPublished">Try again</button></section>`;
        $("#retryPublished").onclick = refresh;
      }
    }
    function render(state) {
      $$("#independentApp audio").forEach((audio) => audio.pause());
      sound.resetDuck();
      publicState = state;
      const a = state.attempt,
        q = state.question;
      let content = "";
      if (state.closed) {
        content = a
          ? `<h2>Your result: ${a.score} points</h2><p>${e(a.name)} · ${a.cursor}/${state.total} questions submitted</p>${state.solutions.map((s, i) => `<details class="solution"><summary>${i + 1}. ${e(s.text)} · ${s.pointsEarned} pts</summary><p><b>Correct answer:</b> ${e(s.correct)}</p><p><b>Your answer:</b> ${e(s.yourAnswer === null ? "Not submitted" : s.type === "text" ? s.yourAnswer : Array.isArray(s.yourAnswer) ? s.yourAnswer.map((index) => s.options[index]).join(" + ") : s.options[s.yourAnswer])}</p></details>`).join("")}`
          : "<h2>This quiz has closed</h2><p>The host is no longer accepting attempts.</p>";
      } else if (!a) {
        content = `<h2>Play at your own pace</h2><p>${state.total} questions · ${state.rounds} rounds. No speed bonus or per-question countdown. Submit before the closing time.</p><form id="publishedJoin"><label>Your nickname<input name="name" required maxlength="30" autocomplete="nickname"></label><button class="primary-btn" type="submit">Start my attempt</button></form><p class="muted">One attempt per browser, using a cookie. Clearing cookies or using another browser can bypass this limit; it does not verify identity. Answers and score are revealed after closing.</p>`;
      } else if (a.completed) {
        content = `<h2>All done, ${e(a.name)}!</h2><p>Your answers have been saved. Return after closing to see your score and correct answers.</p><button id="refreshAttempt" class="secondary-btn">Refresh results</button>`;
      } else {
        content = `<div class="eyebrow">${e(q.round)} · QUESTION ${q.index + 1}/${state.total}</div><h2>${e(q.text)}</h2>${mediaHTML(q.media, q.mediaType)}<form id="publishedAnswer">${q.type === "text" ? '<label>Your answer<input name="answer" required maxlength="200" autocomplete="off"></label>' : `<p>${q.type === "multi" ? "Select all correct options. Correct selections earn proportional points; wrong selections subtract proportional points. Minimum zero." : "Choose one answer."}</p><div class="async-options">${q.options.map((o, i) => `<label><input type="${q.type === "multi" ? "checkbox" : "radio"}" name="option" value="${i}" ${q.type === "multi" ? "" : "required"}><span>${e(o)}</span></label>`).join("")}</div>`}<div class="button-row"><button class="primary-btn" type="submit">Submit & continue</button><button class="text-btn" id="skipPublished" type="button">Skip question</button></div></form><p class="muted">Submitted answers cannot be changed. Your progress is saved after each submission.</p>`;
      }
      $("#independentApp").innerHTML =
        `<div class="independent-brand">Quizzes <span>ON YOUR TIME</span></div><section class="panel"><div class="eyebrow">${state.closed ? "CLOSED" : "SELF-PACED QUIZ"}</div><h1>${e(state.title)}</h1><p>${e(state.description || "")}</p><p class="publication-deadline">${state.closed ? "Closed" : "Closes"} ${e(new Date(state.closes).toLocaleString())}</p>${state.music && !state.closed && !a?.completed ? `<div class="publication-music"><button type="button" class="secondary-btn" id="enablePublishedSound">Enable sound</button><small id="publishedSoundStatus"></small></div>` : ""}${content}<p id="attemptStatus" role="status"></p></section>`;
      syncMusic(state);
      if ($("#enablePublishedSound"))
        $("#enablePublishedSound").onclick = () => {
          sound.enable();
          if (soundtrack.error) poll(true);
        };
      if ($("#refreshAttempt")) $("#refreshAttempt").onclick = refresh;
      if ($("#publishedJoin"))
        $("#publishedJoin").onsubmit = async (event) => {
          event.preventDefault();
          await action("/join", {
            name: new FormData(event.target).get("name"),
          });
        };
      if ($("#publishedAnswer")) {
        $("#publishedAnswer").onsubmit = async (event) => {
          event.preventDefault();
          const form = new FormData(event.target);
          const answer =
            q.type === "text"
              ? form.get("answer")
              : q.type === "multi"
                ? form.getAll("option").map(Number)
                : Number(form.get("option"));
          if (q.type === "multi" && !answer.length) {
            $("#attemptStatus").textContent =
              "Select an option or choose Skip question.";
            return;
          }
          await action("/answer", { index: q.index, answer });
        };
        $("#skipPublished").onclick = () =>
          action("/answer", { index: q.index, skip: true });
      }
    }
    async function action(suffix, payload) {
      if (submitting) return;
      submitting = true;
      actionRevision++;
      if (publicState?.music) sound.enable();
      $$("#independentApp button").forEach((b) => (b.disabled = true));
      try {
        render(
          await api(endpoint + suffix, {
            method: "POST",
            body: JSON.stringify(payload),
          }),
        );
      } catch (err) {
        const message = err.message;
        await refresh();
        if ($("#attemptStatus")) $("#attemptStatus").textContent = message;
      } finally {
        submitting = false;
        $$("#independentApp button").forEach((b) => (b.disabled = false));
      }
    }
    refresh();
    // Metadata-only refresh preserves unsubmitted answers and notices extensions/early closing.
    setInterval(() => {
      if (publicState && !publicState.closed && !document.hidden) poll();
    }, 30000);
  }
})();
