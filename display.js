"use strict";
(() => {
  const $ = (s) => document.querySelector(s),
    escape = (v) =>
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
  const params = new URLSearchParams(location.hash.slice(1));
  const code = params.get("code"),
    displayToken = params.get("token");
  let socket,
    game,
    question,
    result,
    rows = [],
    board = false,
    offset = 0,
    retry,
    stopped = false,
    pingAt = 0;
  const symbols = ["▲", "◆", "●", "■", "⬟", "★"];
  function fit() {
    const root = $("#displayStage");
    root.style.setProperty(
      "--display-question",
      innerWidth >= 1600 ? "60px" : "48px",
    );
    root.style.setProperty(
      "--display-answer",
      innerWidth >= 1600 ? "36px" : "30px",
    );
    for (let i = 0; i <= 12; i++) {
      root.style.setProperty(
        "--display-media",
        Math.max(120, innerHeight * 0.38 - i * 24) + "px",
      );
      if (root.scrollHeight <= root.clientHeight + 2) return;
    }
    root.style.setProperty("--display-question", "36px");
    root.style.setProperty("--display-answer", "28px");
    // Content stays scrollable instead of clipping at high zoom or extreme length.
  }
  function ranking() {
    return `<div class="display-standings"><div class="eyebrow">${game.status === "ended" ? "FINAL RESULTS" : "LIVE STANDINGS"}</div><h1>${game.status === "ended" ? "Celebrate your winners" : "Leaderboard"}</h1>${rows.length ? `<ol>${rows.map((p) => `<li><b>${Number(p.rank)}</b><span>${escape(p.name)}</span><strong>${Number(p.score).toLocaleString()} <small>pts</small></strong></li>`).join("")}</ol>` : "<p>No participants yet.</p>"}</div>`;
  }
  function render() {
    if (!game) return;
    $("#displayTitle").textContent = game.title;
    $("#displayCode").textContent = "Join · " + game.code;
    $("#displayCount").textContent =
      `${game.participants.length} joined · ${game.participants.filter((p) => p.answered).length} answered`;
    const stage = $("#displayStage");
    if (game.status === "ended" || board) stage.innerHTML = ranking();
    else if (["round_intro", "last_question_intro"].includes(game.status)) {
      const last = game.status === "last_question_intro";
      stage.innerHTML = `<section class="projector-lobby round-announcement"><div class="eyebrow">${last ? "ROUND FINALE" : "NEXT ROUND"}</div><h1>${last ? "Last question of " : ""}${escape(game.upcomingRound)}</h1><p>${last ? "Make this one count!" : "A fresh round. A new chance to climb."}</p><p class="muted">The host will start the question. No timer is running yet.</p></section>`;
    } else if (game.status === "lobby") {
      const join = new URL("/join", location.origin);
      join.searchParams.set("code", game.code);
      stage.innerHTML = `<section class="projector-lobby"><div class="eyebrow">${game.status === "lobby" ? "YOUR SEAT IS WAITING" : "NEXT ROUND"}</div><h1>${escape(game.status === "lobby" ? game.title : game.upcomingRound)}</h1><p>Join with your phone. Enter your code and nickname together.</p><div class="projector-invite"><div id="displayQR" class="join-qr"></div><div><small>GAME CODE</small><strong>${escape(game.code)}</strong><p>${escape(join.origin + "/join")}</p></div></div><p class="muted">The host will start when ready.</p></section>`;
      const qr = qrcode(0, "M");
      qr.addData(join.href);
      qr.make();
      $("#displayQR").innerHTML = qr.createSvgTag({
        scalable: true,
        margin: 4,
      });
    } else if (question) {
      stage.innerHTML = `<section class="display-question"><div class="display-meta"><span>${escape(question.roundLabel)}</span><span>QUESTION ${question.index + 1} / ${question.total}</span><b id="displayTimer" role="timer"></b></div><h1>${escape(question.text)}</h1><div class="display-media">${question.media && question.mediaType?.startsWith("image/") ? `<img loading="eager" fetchpriority="high" decoding="async" src="${escape(question.media)}" alt="Question image">` : question.media ? "<p>Audio question · Listen to the host.</p>" : ""}</div><div class="display-options">${(question.options || []).map((o, i) => `<div class="display-option tile-${i} ${game.status === "results" && result?.correctIndices?.includes(i) ? "display-correct" : ""}"><span aria-hidden="true">${symbols[i]}</span><span>${escape(o)}</span></div>`).join("")}</div><p class="display-instruction">${game.status === "results" ? "Correct answer: " + escape(result?.correct || "") : question.type === "multi" ? "Select all correct answers, then submit on your device." : question.type === "text" ? "Type your answer on your device." : "Choose your answer on your device."}</p></section>`;
      $(".display-media img")?.addEventListener("load", fit, { once: true });
      tick();
    }
    requestAnimationFrame(fit);
  }
  function tick() {
    const el = $("#displayTimer");
    if (el && game)
      el.textContent =
        game.status === "question"
          ? Math.max(
              0,
              Math.ceil((game.deadline - Date.now() - offset) / 1000),
            ) + "s"
          : "RESULTS";
  }
  function connect() {
    if (stopped) return;
    socket = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/live`,
    );
    socket.onopen = () => {
      pingAt = Date.now();
      socket.send(JSON.stringify({ type: "ping" }));
      socket.send(JSON.stringify({ type: "join_display", code, displayToken }));
    };
    socket.onmessage = (event) => {
      const m = JSON.parse(event.data);
      if (m.type === "clock") {
        offset = m.serverNow - (Date.now() + pingAt) / 2;
        return;
      }
      if (m.type === "error") {
        stopped = true;
        $("#displayStage").textContent = m.message;
        socket.close();
        return;
      }
      if (m.type === "host_offline") {
        $("#displayConnection").textContent =
          "Host disconnected · waiting for reconnection";
        return;
      }
      if (m.type === "host_online") {
        $("#displayConnection").textContent = "Host connected";
        return;
      }
      if (m.type === "display_joined") {
        game = m.game;
        question = m.question;
        result = m.result;
        rows = m.leaderboard || m.visibleLeaderboard || [];
        board = game.leaderboardVisible;
        if (m.serverNow) offset = m.serverNow - Date.now();
        $("#displayConnection").textContent = "Connected · audience display";
        render();
        return;
      }
      if (m.type === "leaderboard_control") {
        board = m.visible;
        rows = m.leaderboard || [];
        render();
        return;
      }
      if (m.game) game = m.game;
      if (m.type === "question_started") {
        question = m.question;
        result = null;
        board = false;
        render();
      } else if (m.type === "question_ended") {
        result = m;
        rows = m.leaderboard || [];
        board = m.leaderboardVisible;
        render();
      } else if (m.type === "game_ended") {
        board = true;
        rows = m.leaderboard || [];
        render();
      } else if (["round_intro", "last_question_intro"].includes(m.type)) {
        board = false;
        question = null;
        render();
      } else if (m.type === "participants_updated") {
        $("#displayCount").textContent =
          `${game.participants.length} joined · ${game.participants.filter((p) => p.answered).length} answered`;
        if (board) {
          rows = [...game.participants]
            .sort((a, b) => b.score - a.score)
            .map((p, i) => ({ ...p, rank: i + 1 }));
          render();
        }
      }
    };
    socket.onclose = () => {
      if (stopped) return;
      $("#displayConnection").textContent =
        "Disconnected · reconnecting. The display may be out of date.";
      clearTimeout(retry);
      retry = setTimeout(connect, 2000);
    };
  }
  $("#displayFullscreen").onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      $("#displayConnection").textContent =
        "Use your browser's fullscreen command.";
    }
  };
  window.addEventListener("resize", fit);
  document.fonts?.ready.then(fit);
  setInterval(tick, 150);
  if (
    !/^QZ[A-F0-9]{6}$/.test(code || "") ||
    !/^[a-f0-9]{64}$/.test(displayToken || "")
  )
    $("#displayStage").textContent =
      "Open Projector from the signed-in host's live room.";
  else connect();
})();
