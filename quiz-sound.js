"use strict";
// Original procedural soundtrack: no downloaded audio, external service or copyrighted recording.
window.QuizzesSound = (() => {
  let ctx,
    master,
    noise,
    timer,
    phase = "idle",
    beat = 0,
    next = 0,
    track = null,
    ducked = false,
    lastTick = null,
    finishTimer;
  const isHost = location.pathname !== "/join";
  let volume = 0.3,
    muted = false,
    onHostChange = () => {};
  const active = () =>
    ["lobby", "question", "results", "ended"].includes(phase);
  function update() {
    if (master)
      master.gain.setTargetAtTime(
        muted ? 0 : volume * (ducked ? 0.12 : 1),
        ctx.currentTime,
        0.08,
      );
    if (track) {
      track.volume = volume * (ducked ? 0.12 : 1);
      track.muted = muted;
    }
    document.querySelectorAll("[data-sound-controls]").forEach((root) => {
      const toggle = root.querySelector(".sound-toggle");
      const blocked =
        !ctx ||
        ctx.state !== "running" ||
        (track?.paused && active() && !muted);
      toggle.textContent = blocked
        ? "Enable sound"
        : muted
          ? "Play music for everyone"
          : "Pause music for everyone";
      toggle.hidden = !isHost && !blocked;
      toggle.setAttribute("aria-pressed", String(muted));
      root.querySelector(".sound-volume").hidden = !isHost;
      root.querySelector("input").disabled = !isHost;
      root.querySelector("input").value = Math.round(volume * 100);
      root.querySelector(".sound-state").textContent = muted
        ? "Music paused by host"
        : isHost
          ? "Host controls all devices"
          : "Music controlled by your host";
    });
  }
  function tone(freq, t, duration, gain = 0.1, type = "sine", endFreq) {
    if (!ctx || ctx.state !== "running") return;
    const osc = ctx.createOscillator(),
      envelope = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq)
      osc.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
    envelope.gain.setValueAtTime(0, t);
    envelope.gain.linearRampToValueAtTime(gain, t + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(envelope);
    envelope.connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.015);
    osc.onended = () => {
      osc.disconnect();
      envelope.disconnect();
    };
  }
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function hat(t) {
    const source = ctx.createBufferSource(),
      filter = ctx.createBiquadFilter(),
      gain = ctx.createGain();
    source.buffer = noise;
    filter.type = "highpass";
    filter.frequency.value = 7200;
    gain.gain.setValueAtTime(0.032, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(t);
    source.stop(t + 0.06);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }
  function schedule() {
    if (!ctx || ctx.state !== "running" || !active() || muted || track) return;
    if (next < ctx.currentTime - 0.2) next = ctx.currentTime;
    const duration = 60 / (phase === "question" ? 128 : 112) / 2;
    while (next < ctx.currentTime + 0.15) {
      const root = [48, 53, 57, 55][Math.floor(beat / 16) % 4];
      if (beat % 4 === 0) {
        tone(110, next, 0.15, 0.32, "sine", 40);
        tone(hz(root - 12), next, 0.28, 0.17, "triangle");
      }
      if (beat % 2 === 0)
        tone(
          hz(root + 12 + [0, 7, 12, 4, 7, 14, 12, 7][Math.floor(beat / 2) % 8]),
          next,
          0.2,
          0.075,
          "triangle",
        );
      if (phase === "question" || beat % 2 === 1) hat(next);
      beat++;
      next += duration;
    }
  }
  async function enable() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.connect(ctx.destination);
        noise = ctx.createBuffer(
          1,
          Math.floor(ctx.sampleRate * 0.08),
          ctx.sampleRate,
        );
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        ctx.onstatechange = update;
      }
      await ctx.resume();
      update();
      if (!timer) timer = setInterval(schedule, 90);
      if (track && active() && !muted)
        try {
          await track.play();
        } catch {} // UI offers a deliberate Enable sound action.
      update();
    } catch {
      update();
    }
  }
  function setTrack(element) {
    if (track && track !== element) track.pause();
    track = element || null;
    if (track) {
      track.loop = true;
      track.addEventListener("pause", update);
      track.addEventListener("play", update);
      track.addEventListener("error", () => {
        if (track === element) {
          track = null;
          update();
          window.dispatchEvent(new Event("quiz:refresh-music"));
        }
      });
      if (ctx?.state === "running" && active() && !muted)
        track.play().catch(update);
    }
    update();
  }
  function effect(kind) {
    if (!ctx || ctx.state !== "running") return;
    const notes =
      kind === "finish"
        ? [60, 64, 67, 72, 76, 79, 84]
        : kind === "reveal"
          ? [67, 72, 76]
          : [84];
    notes.forEach((note, i) =>
      tone(hz(note), ctx.currentTime + i * 0.12, 0.22, 0.12, "sine"),
    );
  }
  function setPhase(value) {
    clearTimeout(finishTimer);
    phase = value;
    beat = 0;
    lastTick = null;
    if (ctx) next = ctx.currentTime + 0.03;
    document
      .querySelectorAll("[data-sound-controls]")
      .forEach((el) => (el.dataset.phase = phase));
    if (!active()) {
      track?.pause();
      clearInterval(timer);
      timer = null;
    } else if (ctx?.state === "running") {
      if (!timer) timer = setInterval(schedule, 90);
      if (track && !muted) track.play().catch(update);
    }
    if (value === "results") effect("reveal");
    if (value === "ended") {
      effect("finish");
      finishTimer = setTimeout(() => setPhase("idle"), 4500);
    }
    update();
  }
  function remaining(seconds) {
    if (
      phase === "question" &&
      seconds > 0 &&
      seconds <= 5 &&
      seconds !== lastTick
    ) {
      lastTick = seconds;
      effect("tick");
    }
  }
  document.querySelectorAll("[data-sound-controls]").forEach((root) => {
    root.innerHTML =
      '<button type="button" class="secondary-btn sound-toggle">Enable sound</button><label class="sound-volume">Volume <input aria-label="Sound volume" type="range" min="0" max="100" step="1"></label><small class="sound-state"></small>';
    root.querySelector("button").onclick = async () => {
      if (
        !ctx ||
        ctx.state !== "running" ||
        (track?.paused && active() && !muted)
      ) {
        await enable();
      } else if (isHost) {
        onHostChange({ playing: muted, volume });
      }
    };
    root.querySelector("input").onchange = (event) => {
      if (isHost)
        onHostChange({
          playing: !muted,
          volume: Number(event.target.value) / 100,
        });
    };
  });
  // Make spoken/audio questions intelligible without stopping the soundtrack.
  document.addEventListener(
    "play",
    (event) => {
      if (event.target.matches?.("#hostMedia audio, #playerMedia audio")) {
        ducked = true;
        update();
      }
    },
    true,
  );
  for (const type of ["pause", "ended"])
    document.addEventListener(
      type,
      (event) => {
        if (event.target.matches?.("#hostMedia audio, #playerMedia audio")) {
          ducked = false;
          update();
        }
      },
      true,
    );
  update();
  return {
    enable,
    configure: (callback) => {
      onHostChange = callback;
    },
    setRemote: (state) => {
      if (!state) return;
      muted = !state.playing;
      volume = state.volume;
      if (track) {
        if (muted) track.pause();
        else if (active() && ctx?.state === "running")
          track.play().catch(update);
      }
      update();
    },
    setTrack,
    setPhase,
    remaining,
    stop: () => setPhase("idle"),
    resetDuck: () => {
      ducked = false;
      update();
    },
    status: () => ({
      phase,
      state: ctx?.state || "not-enabled",
      muted,
      volume,
      custom: !!track,
    }),
  };
})();
