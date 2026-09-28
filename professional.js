"use strict";
// Host-only enhancements. No private draft data is stored in browser persistence.
(() => {
  if (participantMode || independentMode) return;
  let session = null,
    saveTimer = null,
    historyTimer = null,
    applying = false,
    recovery = null;
  let pendingRecovery = null,
    generation = 0;
  const status = (text) => ($("#draftStatus").textContent = text);
  const snapshot = () => {
    collectDraft();
    const doc = structuredClone(draft);
    doc._reviewed = $("#importReviewed").checked;
    return JSON.stringify(doc);
  };
  function updateButtons() {
    $("#studioUndo").disabled = !session || session.cursor <= 0;
    $("#studioRedo").disabled =
      !session || session.cursor >= session.history.length - 1;
  }
  function capture() {
    clearTimeout(historyTimer);
    if (!session || applying || !draft || currentView !== "editor") return;
    const text = snapshot();
    if (session.history[session.cursor] === text) return;
    session.history.splice(session.cursor + 1);
    session.history.push(text);
    while (
      session.history.length > 30 ||
      (session.history.length > 2 &&
        session.history.reduce((n, s) => n + s.length, 0) > 8 * 1024 * 1024)
    )
      session.history.shift();
    session.cursor = session.history.length - 1;
    updateButtons();
  }
  function changed() {
    if (!session || applying || !dirty || currentView !== "editor") return;
    clearTimeout(historyTimer);
    historyTimer = setTimeout(capture, 350);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveDraft().catch(() => {}), 2000);
    if (!session.paused)
      status("Unsaved quiz edits · Private recovery draft pending…");
  }
  async function saveDraft() {
    clearTimeout(saveTimer);
    capture();
    const s = session;
    if (!s || !account || !dirty) return;
    if (s.ownerId !== account.id)
      throw Error("Sign in to the original workspace to recover these edits.");
    if (s.paused)
      throw Error(
        "Recovery saving is paused. Resolve the draft conflict or make a separate copy.",
      );
    if (s.loading) {
      await s.loading;
      if (s !== session) return;
    }
    if (s.paused)
      throw Error(
        "Choose whether to restore the existing recovery draft first.",
      );
    const text = snapshot();
    if (s.saving) {
      await s.saving;
      if (s === session && text !== s.lastSaved) return saveDraft();
      return;
    }
    if (s.lastSaved === text) return;
    status("Saving private recovery draft…");
    s.saving = (async () => {
      try {
        const row = await api("/api/editor-drafts/" + s.key, {
          method: "PUT",
          body: JSON.stringify({
            version: s.version,
            document: JSON.parse(text),
          }),
        });
        s.version = row.version;
        s.lastSaved = text;
        if (s === session)
          status(
            "Recovery draft saved · Save quiz to make these changes official.",
          );
      } catch (err) {
        if (s === session) {
          if (err.status === 409) s.paused = true;
          status(
            (err.status === 409
              ? "Conflict — "
              : "Recovery draft NOT saved — ") + err.message,
          );
        }
        throw err;
      } finally {
        s.saving = null;
      }
    })();
    return s.saving;
  }
  function reset() {
    generation++;
    clearTimeout(saveTimer);
    clearTimeout(historyTimer);
    session = null;
    $("#roundEditor").replaceChildren();
    $("#questionNavigator").replaceChildren();
    $("#quizTitle").value = "";
    $("#quizDescription").value = "";
    $("#importSource").textContent = "";
    recovery = null;
    pendingRecovery = null;
    rehearsalDocument = null;
    rehearsalWindow?.postMessage(
      { type: "quizzes:rehearsal-clear" },
      location.origin,
    );
    rehearsalWindow = null;
    window.ProfessionalHost?.reset();
    $("#draftRecoveryPrompt").hidden = true;
    $("#draftRecoveryList").replaceChildren();
    $("#draftRecoveryDialog").close();
    updateButtons();
  }
  function restore(row) {
    if (
      currentView === "editor" &&
      dirty &&
      !confirm(
        "Open this recovery draft? Current unsaved edits remain in their recovery draft if saving succeeded.",
      )
    )
      return;
    pendingRecovery = row;
    draft = structuredClone(row.document);
    openEditor();
    dirty = true;
    $("#importReviewed").checked = !!row.document._reviewed;
    status("Recovered private draft · Review it, then Save quiz when ready.");
    $("#draftRecoveryDialog").close();
  }
  function opened() {
    generation++;
    clearTimeout(saveTimer);
    clearTimeout(historyTimer);
    $("#draftRecoveryPrompt").hidden = true;
    const restored = pendingRecovery;
    pendingRecovery = null;
    const s = (session = {
      ownerId: account?.id,
      key: restored?.key || draft.id || "new-" + crypto.randomUUID(),
      version: restored?.version || 0,
      history: [snapshot()],
      cursor: 0,
      lastSaved: restored ? JSON.stringify(restored.document) : null,
      paused: false,
      saving: null,
      loading: null,
    });
    updateButtons();
    status(
      "Quiz changes need Save · Private recovery activates when you edit.",
    );
    if (restored || !draft.id) return;
    s.loading = (async () => {
      try {
        const row = await api("/api/editor-drafts/" + s.key);
        if (s !== session) return;
        s.version = row.version;
        s.paused = true;
        recovery = row;
        const prompt = $("#draftRecoveryPrompt");
        prompt.hidden = false;
        prompt.innerHTML =
          '<span>A private recovery draft exists for this quiz.</span><button type="button" class="secondary-btn" id="restoreCurrentDraft">Restore draft</button><button type="button" class="text-btn" id="discardCurrentDraft">Keep saved quiz</button>';
        $("#restoreCurrentDraft").onclick = () => restore(row);
        $("#discardCurrentDraft").onclick = async () => {
          if (
            !confirm(
              "Delete this recovery draft and continue with the saved quiz?",
            )
          )
            return;
          try {
            await api("/api/editor-drafts/" + s.key, {
              method: "DELETE",
              body: JSON.stringify({ version: s.version }),
            });
            if (s !== session) return;
            s.version = 0;
            s.paused = false;
            s.lastSaved = null;
            recovery = null;
            prompt.hidden = true;
            status("Recovery draft removed. Your saved quiz is unchanged.");
            if (dirty) changed();
          } catch (err) {
            status(err.message);
          }
        };
        status(
          "Recovery available · Restore it, keep the saved quiz, or make a separate copy.",
        );
      } catch (err) {
        if (err.status !== 404 && s === session) {
          s.paused = true;
          status("Could not check recovery drafts. " + err.message);
        }
      } finally {
        s.loading = null;
      }
    })();
  }
  async function saved() {
    clearTimeout(saveTimer);
    clearTimeout(historyTimer);
    const s = session;
    session = null;
    updateButtons();
    if (s?.saving) await s.saving.catch(() => {});
    if (s?.version) {
      try {
        await api("/api/editor-drafts/" + s.key, {
          method: "DELETE",
          body: JSON.stringify({ version: s.version }),
        });
      } catch {
        showToast(
          "Quiz saved. A changed recovery draft was kept; review it in Recover drafts.",
        );
      }
    }
    status("Quiz saved.");
  }
  function travel(direction) {
    if (!session || uploadCount) return;
    capture();
    const target = session.cursor + direction;
    if (target < 0 || target >= session.history.length) return;
    applying = true;
    const index = Math.max(
      0,
      draft.rounds.flatMap((r) => r.questions).indexOf(activeEditorQuestion),
    );
    session.cursor = target;
    draft = JSON.parse(session.history[target]);
    $("#quizTitle").value = draft.title;
    $("#quizDescription").value = draft.description || "";
    $("#importReviewed").checked = !!draft._reviewed;
    activeEditorQuestion =
      draft.rounds.flatMap((r) => r.questions)[index] ||
      draft.rounds[0]?.questions[0];
    dirty = true;
    renderEditor();
    applying = false;
    updateButtons();
    changed();
  }
  $("#studioUndo").onclick = () => travel(-1);
  $("#studioRedo").onclick = () => travel(1);
  $("#saveDraftCopy").onclick = () => {
    capture();
    const copy = structuredClone(draft);
    delete copy.id;
    delete copy._revision;
    copy.title = (copy.title + " — copy").slice(0, 120);
    draft = copy;
    openEditor();
    dirty = true;
    changed();
    showToast("Editing a separate draft. Choose Save quiz to create it.");
  };
  $("#editorForm").addEventListener("input", changed);
  $("#editorForm").addEventListener("change", () => queueMicrotask(changed));
  document.addEventListener("keydown", (event) => {
    if (
      currentView !== "editor" ||
      !session ||
      (!event.ctrlKey && !event.metaKey) ||
      event.altKey ||
      $("#editorForm").inert
    )
      return;
    if (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y") {
      event.preventDefault();
      travel(event.shiftKey || event.key.toLowerCase() === "y" ? 1 : -1);
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (
      document.visibilityState === "hidden" &&
      currentView === "editor" &&
      dirty
    )
      saveDraft().catch(() => {});
  });
  async function listDrafts() {
    $("#draftRecoveryDialog").showModal();
    $("#draftRecoveryList").textContent = "Loading your private drafts…";
    try {
      const rows = await api("/api/editor-drafts");
      $("#draftRecoveryList").innerHTML = rows.length
        ? rows
            .map(
              (r) =>
                `<article class="recovery-row"><div><b>${e(r.title)}</b><small>${e(new Date(r.updated).toLocaleString())} · private recovery</small></div><button class="secondary-btn" data-recover="${e(r.key)}">Recover</button><button class="text-btn" data-remove-draft="${e(r.key)}" data-version="${r.version}">Delete</button></article>`,
            )
            .join("")
        : "<p>No recovery drafts. Your saved quizzes are in the library.</p>";
    } catch (err) {
      $("#draftRecoveryList").textContent = err.message;
    }
  }
  $("#recoverDrafts").onclick = listDrafts;
  $("#closeDraftRecovery").onclick = () => $("#draftRecoveryDialog").close();
  $("#draftRecoveryList").onclick = async (event) => {
    const b = event.target.closest("button");
    if (!b) return;
    try {
      if (b.dataset.recover)
        restore(await api("/api/editor-drafts/" + b.dataset.recover));
      if (
        b.dataset.removeDraft &&
        confirm("Delete this recovery draft? The saved quiz is not deleted.")
      ) {
        await api("/api/editor-drafts/" + b.dataset.removeDraft, {
          method: "DELETE",
          body: JSON.stringify({ version: Number(b.dataset.version) }),
        });
        await listDrafts();
      }
    } catch (err) {
      showToast(err.message);
    }
  };
  window.Studio = {
    opened,
    changed,
    saved,
    reset,
    authChanged(next) {
      if (session && next && session.ownerId !== next.id) {
        reset();
        draft = null;
        dirty = false;
        showView("dashboard", true);
      }
    },
    beforeSave: async () => {
      capture();
      await saveDraft();
    },
  };

  // Rehearsal runs entirely in a separate browser window: no room, attempts or reports.
  let rehearsalWindow = null,
    rehearsalDocument = null;
  function rehearse(q) {
    if (!q?.rounds?.some((r) => r.questions?.length))
      return showToast("Add a question before previewing.");
    rehearsalDocument = structuredClone(q);
    rehearsalWindow = window.open("/rehearsal", "quizzes-rehearsal");
    if (!rehearsalWindow)
      showToast("Allow popups for this site to open the rehearsal.");
  }
  $("#rehearseDraft").onclick = () => {
    collectDraft();
    rehearse(draft);
  };
  document.addEventListener("click", (event) => {
    const b = event.target.closest("[data-rehearse]");
    if (b) rehearse(quizzes.find((q) => q.id === b.dataset.rehearse));
  });
  window.addEventListener("message", (event) => {
    if (
      event.origin !== location.origin ||
      event.source !== rehearsalWindow ||
      event.data?.type !== "quizzes:rehearsal-ready" ||
      !account
    )
      return;
    rehearsalWindow.postMessage(
      { type: "quizzes:rehearsal-document", document: rehearsalDocument },
      location.origin,
    );
  });

  let consoleState = null,
    qrCode = null;
  function connections() {
    if (!game) return;
    const players = game.participants || [];
    $("#consoleConnections").textContent =
      `${players.length} joined · ${players.filter((p) => p.connected).length} connected · ${players.filter((p) => !p.connected).length} disconnected`;
  }
  function renderConsole() {
    if (!consoleState) return;
    $("#consoleNext").textContent =
      consoleState.next?.text || "Last question — final rankings are next.";
    $("#consoleNextRound").textContent = consoleState.next?.round || "";
    $("#consoleNotes").textContent =
      consoleState.currentNotes || "No private notes for this question.";
    const i = consoleState.image;
    $("#consoleImages").textContent = i
      ? `${i.ready} ready · ${i.failed} failed · ${i.slow} over 3 seconds · ${i.reported} reports received. Unreported devices may still be loading or disconnected.`
      : "No image question active.";
    connections();
    if (game?.code && qrCode !== game.code) {
      qrCode = game.code;
      const qr = qrcode(0, "M");
      qr.addData(joinURL());
      qr.make();
      $("#consoleQR").innerHTML = qr.createSvgTag({
        scalable: true,
        margin: 4,
      });
      $("#consoleQR svg").setAttribute("aria-label", "Scan to join this game");
    }
  }
  $("#toggleConsole").onclick = () => {
    const show = $("#hostConsole").hidden;
    $("#hostConsole").hidden = !show;
    $("#gameModal").classList.toggle("console-open", show);
    $("#toggleConsole").setAttribute("aria-expanded", String(show));
    renderConsole();
    scheduleLiveFit();
  };
  $("#openProjector").onclick = () => {
    if (!game || !consoleState?.displayToken)
      return showToast("Wait for the room to connect.");
    const url = new URL("/display", location.origin);
    url.hash = new URLSearchParams({
      code: game.code,
      token: consoleState.displayToken,
    }).toString();
    const opened = window.open(url.href, "quizzes-projector");
    if (opened) opened.opener = null;
    else showToast("Allow popups to open the projector window.");
  };
  window.ProfessionalHost = {
    message(m) {
      if (m.type === "host_console") {
        consoleState = m;
        requestAnimationFrame(renderConsole);
      }
    },
    connections,
    reset() {
      consoleState = null;
      qrCode = null;
      $("#consoleQR").replaceChildren();
      $("#consoleNotes").textContent = "";
      $("#consoleNext").textContent = "";
      $("#consoleNextRound").textContent = "";
      $("#consoleImages").textContent = "";
    },
  };
})();
