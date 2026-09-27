"use strict";
// Private-workspace invitations and persistent, self-paced publications.
(() => {
  let resultForExport = null,
    publicState = null;
  async function copyLink(url) {
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied");
    } catch {
      showToast("Select and copy the displayed link.");
    }
  }
  async function publications() {
    if (!account) {
      $("#publicationList").innerHTML = "";
      $("#inviteLink").hidden = true;
      $("#inviteLink").value = "";
      $("#inviteStatus").textContent = "";
      $("#publicationResults").innerHTML = "";
      resultForExport = null;
      return;
    }
    try {
      const rows = await api("/api/publications");
      $("#publicationList").innerHTML = rows.length
        ? rows
            .map(
              (p) =>
                `<article class="publication-card"><div><b>${e(p.title)}</b><p>${Date.now() < p.closes ? "Open until" : "Closed"} ${e(new Date(p.closes).toLocaleString())} · ${p.participants}/100 attempts</p><input readonly aria-label="Published quiz link" value="${e(location.origin + "/play?quiz=" + p.id)}"></div><div class="button-row"><button class="secondary-btn" data-copy-publication="${p.id}">Copy link</button><button class="secondary-btn" data-publication-results="${p.id}">View results</button>${Date.now() < p.closes ? `<button class="text-btn" data-close-publication="${p.id}">Close now</button>` : ""}</div></article>`,
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
      if (b.dataset.publicationResults) {
        const r = await api(
          "/api/publications/" + b.dataset.publicationResults + "/results",
        );
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
      `<div class="independent-brand">Quizzes</div><section class="panel"><h1>Your own quiz workspace</h1><p>Your quizzes and reports stay separate from the person who invited you.</p><form id="friendSignup"><label>Workspace name<input name="organization" required maxlength="120" autocomplete="organization"></label><label>Email<input name="email" type="email" required maxlength="254" autocomplete="email"></label><label>Password<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label><button class="primary-btn" type="submit">Create private workspace</button><p id="friendStatus" role="status"></p></form><a href="/">Already registered? Host sign in</a></section>`;
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
    async function refresh() {
      try {
        render(await api(endpoint));
      } catch (err) {
        $("#independentApp").innerHTML =
          `<div class="independent-brand">Quizzes</div><section class="panel"><h1>Unable to open quiz</h1><p>${e(err.message)}</p><button class="secondary-btn" id="retryPublished">Try again</button></section>`;
        $("#retryPublished").onclick = refresh;
      }
    }
    function render(state) {
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
        `<div class="independent-brand">Quizzes <span>ON YOUR TIME</span></div><section class="panel"><div class="eyebrow">${state.closed ? "CLOSED" : "24-HOUR QUIZ"}</div><h1>${e(state.title)}</h1><p>${e(state.description || "")}</p><p class="publication-deadline">${state.closed ? "Closed" : "Closes"} ${e(new Date(state.closes).toLocaleString())}</p>${content}<p id="attemptStatus" role="status"></p></section>`;
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
        $$("#independentApp button").forEach((b) => (b.disabled = false));
      }
    }
    refresh();
    setInterval(() => {
      if (
        publicState &&
        !publicState.closed &&
        Date.now() >= publicState.closes
      )
        refresh();
    }, 15000);
  }
})();
