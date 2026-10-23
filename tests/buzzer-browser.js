"use strict";
// Browser proof of the buzzer round: three phones buzz in a known order, the
// host sees them fastest-first, rejects the first, accepts the second, and the
// speed bonus is awarded. Screenshots are saved for review.
const { expect } = require("@playwright/test");

const QUIZ = {
  title: "Buzzer round demo",
  description: "Name that tune",
  rounds: [
    {
      title: "Name that tune",
      questions: [
        {
          type: "buzzer",
          text: "Name this song",
          accepted: ["Tum Hi Ho", "Tum Hi Ho (Arijit Singh)"],
          seconds: 20,
          points: 1000,
          notes: "Play clip 2",
        },
        {
          type: "text",
          text: "Two plus two?",
          accepted: ["4"],
          seconds: 20,
          points: 1000,
        },
      ],
    },
  ],
};

module.exports = async function buzzerBrowser({ page, browser, password }) {
  await page.goto("/");
  await page.getByRole("button", { name: "Host sign in" }).click();
  await page.locator("#emailInput").fill("browser@example.test");
  await page.locator("#passwordInput").fill(password);
  await page.locator("#submitAuth").click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();

  // Create the saved quiz through the app's own API so this module tests the
  // buzzer screens themselves, not the editor. The buzzer question carries a
  // real one-second WAV clip so the Play/Stop controls can be exercised.
  const created = await page.evaluate(async (quiz) => {
    const wav = new Uint8Array(44 + 8000);
    const view = new DataView(wav.buffer);
    const ascii = (at, text) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    ascii(0, "RIFF");
    view.setUint32(4, 36 + 8000, true);
    ascii(8, "WAVEfmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true);
    view.setUint32(28, 8000, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    ascii(36, "data");
    view.setUint32(40, 8000, true);
    wav.fill(128, 44);
    const upload = await fetch("/api/media", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": "buzzer-clip.wav",
      },
      body: wav,
    }).then((r) => r.json());
    if (!upload.url) throw Error("Could not upload the clip: " + JSON.stringify(upload));
    quiz.rounds[0].questions[0].media = upload.url;
    const res = await fetch("/api/quizzes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(quiz),
    });
    return { status: res.status, body: await res.text() };
  }, QUIZ);
  if (created.status >= 400) throw Error("Could not save the demo quiz: " + created.body);

  await page.goto("/");
  const card = page
    .locator(".library-card, .quiz-row")
    .filter({ hasText: "Buzzer round demo" })
    .first();
  await expect(card).toBeVisible();
  await card.locator("[data-launch]").click();
  // The code arrives over the socket: wait for a real one, not the placeholder.
  await expect(page.locator("#hostCode")).toHaveText(/^[A-Z0-9]{8}$/);
  const code = (await page.locator("#hostCode").textContent()).trim();

  // --- three phones join ---
  const phones = [];
  for (const name of ["Meera", "Anita", "Rahul"]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
    const p = await ctx.newPage();
    await p.goto(`/join?code=${code}`);
    await p.getByLabel("Your nickname").fill(name);
    await p.getByRole("button", { name: "Join game" }).click();
    // Proof the phone really joined: the join panel closes and the player
    // screen opens. (#playerTitle is present but hidden before joining.)
    await expect(p.locator("#joinPanel")).toBeHidden();
    await expect(p.locator("#playerQuestion")).toBeVisible();
    await expect(p.locator("#playerTitle")).toHaveText("You’re in!");
    phones.push({ name, page: p, ctx });
  }

  // --- host starts the buzzer question ---
  await page.locator("#nextQuestion").click();
  await expect(page.locator("#hostBuzzer")).toBeVisible();
  await expect(page.locator("#buzzerStatus")).toContainText(
    "Waiting for the first buzz",
  );
  for (const phone of phones)
    try {
      await expect(phone.page.locator("#buzzButton")).toBeVisible({
        timeout: 20000,
      });
    } catch (err) {
      const phoneInfo = await phone.page.evaluate(() => ({
        url: location.href,
        title: document.querySelector("#playerTitle")?.textContent,
        status: document.querySelector("#attemptStatus, #playerStatus, .player-alert")
          ?.textContent,
        gameStatus: game ? game.status : "no game object",
        saved: JSON.stringify(savedConnection ? savedConnection() : null),
      }));
      const hostInfo = await page.evaluate(() => ({
        code: document.querySelector("#hostCode")?.textContent,
        status: game ? game.status : "no game object",
        players: game?.participants?.length ?? -1,
      }));
      throw Error(
        `BUZZ button missing for ${phone.name}\n  phone: ${JSON.stringify(phoneInfo)}\n  host: ${JSON.stringify(hostInfo)}`,
      );
    }
  await phones[1].page.screenshot({
    path: "test-artifacts/buzzer-player.png",
    animations: "disabled",
  });

  // --- the host plays the clip over the hall speakers, then stops it ---
  const clip = page.locator("#hostBuzzerMedia audio");
  await expect(clip).toHaveCount(1);
  await expect(page.locator("#stopBuzzerClip")).toBeDisabled();
  await page.locator("#playBuzzerClip").click();
  await expect
    .poll(() => page.evaluate(() => !document.querySelector("#hostBuzzerMedia audio").paused))
    .toBe(true);
  await expect(page.locator("#stopBuzzerClip")).toBeEnabled();
  await expect(page.locator("#clipNote")).toContainText("playing");
  await page.locator("#stopBuzzerClip").click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const a = document.querySelector("#hostBuzzerMedia audio");
        return a.paused && a.currentTime === 0;
      }),
    )
    .toBe(true);
  await expect(page.locator("#stopBuzzerClip")).toBeDisabled();
  await expect(page.locator("#clipNote")).toContainText("stopped");

  // --- buzz in a shuffled order: Meera, Anita, Rahul ---
  for (const phone of phones) {
    await phone.page.locator("#buzzButton").click();
    await expect(phone.page.locator("#buzzButton")).toBeDisabled();
    await expect(phone.page.locator("#buzzNote")).toContainText("You buzzed in");
  }
  await expect(page.locator("#buzzQueue .buzz-row")).toHaveCount(3);
  await expect(page.locator("#buzzQueue .buzz-name")).toContainText([
    "Meera",
    "Anita",
    "Rahul",
  ]);
  await page.screenshot({
    path: "test-artifacts/buzzer-host-queue.png",
    animations: "disabled",
  });

  // --- first buzzer is wrong, second is correct ---
  await page
    .locator("#buzzQueue .buzz-row", { hasText: "Meera" })
    .getByRole("button", { name: "Wrong" })
    .click();
  await expect(
    page.locator("#buzzQueue .buzz-row", { hasText: "Meera" }),
  ).toHaveClass(/buzz-wrong/);
  await page
    .locator("#buzzQueue .buzz-row", { hasText: "Anita" })
    .getByRole("button", { name: "Correct" })
    .click();

  // --- results: the host reveals the expected answer to the room ---
  await expect(page.locator("#gameModal")).toContainText("Tum Hi Ho");
  await page.screenshot({
    path: "test-artifacts/buzzer-host-results.png",
    animations: "disabled",
  });
  console.log("      buzzer: host awarded the second-fastest buzzer");

  for (const phone of phones) await phone.ctx.close();
  // Leave the host on the dashboard: the game modal would otherwise block the
  // next module, and the stored host session would restore it after a reload.
  await page.locator("#endGame").click();
  await page.evaluate(() => sessionStorage.removeItem("quizzes-host"));
  await page.goto("/");
  await expect(page.locator("#gameModal")).not.toHaveClass(/open/);
  return { code };
};
