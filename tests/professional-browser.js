const { expect } = require("@playwright/test");
module.exports = async function professionalBrowser({ page, browser, errors }) {
  page.setDefaultTimeout(10000);
  console.log("Professional browser: start");
  await page.setViewportSize({ width: 1440, height: 1000 });
  const request = async (path, method = "GET", body) =>
    page.evaluate(
      async ({ path, method, body }) => {
        const r = await fetch(path, {
          method,
          headers: { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const value = await r.json();
        if (!r.ok) throw Error(JSON.stringify(value));
        return value;
      },
      { path, method, body },
    );
  const image = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 240;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#e6def3";
    ctx.fillRect(0, 0, 640, 240);
    ctx.fillStyle = "#523786";
    ctx.font = "bold 36px sans-serif";
    ctx.fillText("Participant image test", 110, 130);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    const response = await fetch("/api/media", {
      method: "POST",
      headers: {
        "Content-Type": "image/png",
        "X-File-Name": "studio-image-test.png",
      },
      body: blob,
    });
    if (!response.ok) throw Error("Fixture upload failed");
    return response.json();
  });
  const q = await request("/api/quizzes", "POST", {
    title: "Professional hosting rehearsal",
    description: "Browser test fixture",
    rounds: [
      {
        title: "Numbers",
        questions: [
          {
            type: "multi",
            text: "Choose the prime numbers",
            options: ["Two", "Four", "Three", "Six"],
            correctAnswers: [0, 2],
            seconds: 30,
            points: 1000,
            media: image.url,
            mediaType: image.mime,
            notes: "PRIVATE NOTE: announce partial credit.",
          },
        ],
      },
      {
        title: "Colors",
        questions: [
          {
            type: "text",
            text: "NEXT PRIVATE PREVIEW: name the blue color",
            accepted: ["blue"],
            seconds: 30,
            points: 1000,
            notes: "PRIVATE NEXT NOTE",
          },
        ],
      },
    ],
  });
  console.log("Professional browser: fixture/reload");
  await page.reload();
  await page.locator('.sidebar [data-view="quizzes"]').click();
  const card = page
    .locator(".library-card")
    .filter({ hasText: "Professional hosting rehearsal" });
  await card.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator("#quizSettings summary").click();
  await page.locator("#quizTitle").fill("Unpublished rehearsal changes");
  await expect(page.locator("#studioUndo")).toBeEnabled();
  await page.locator("#studioUndo").click();
  await expect(page.locator("#quizTitle")).toHaveValue(
    "Professional hosting rehearsal",
  );
  await page.locator("#studioRedo").click();
  await expect(page.locator("#quizTitle")).toHaveValue(
    "Unpublished rehearsal changes",
  );
  await expect(page.locator("#draftStatus")).toContainText(
    "Recovery draft saved",
    { timeout: 10000 },
  );
  expect((await request("/api/quizzes")).find((x) => x.id === q.id).title).toBe(
    "Professional hosting rehearsal",
  );
  await page.reload();
  await page.locator('.sidebar [data-view="quizzes"]').click();
  await page.locator("#recoverDrafts").click();
  const recovery = page
    .locator(".recovery-row")
    .filter({ hasText: "Unpublished rehearsal changes" });
  await recovery.getByRole("button", { name: "Recover", exact: true }).click();
  await expect(page.locator("#quizTitle")).toHaveValue(
    "Unpublished rehearsal changes",
  );
  await page.screenshot({
    path: "test-artifacts/v09-studio-recovery.png",
    fullPage: true,
    animations: "disabled",
  });
  console.log("Professional browser: draft recovery passed");
  const before = {
    reports: await request("/api/reports"),
    publications: await request("/api/publications"),
    quizzes: await request("/api/quizzes"),
  };
  const popupEvent = page.waitForEvent("popup");
  await page.locator("#rehearseDraft").click();
  const rehearsal = await popupEvent;
  rehearsal.on("pageerror", (err) => errors.push(err.message));
  const writes = [];
  rehearsal.on("request", (r) => {
    if (r.url().includes("/api/")) writes.push(r.url());
  });
  let rehearsalSockets = 0;
  rehearsal.on("websocket", () => rehearsalSockets++);
  await expect(rehearsal.locator("#rehearsalTitle")).toHaveText(
    "Unpublished rehearsal changes",
  );
  await rehearsal.locator("#rehearsalAdvance").click();
  await expect(rehearsal.locator("#rehearsalStage")).toContainText(
    "Choose the prime numbers",
  );
  await rehearsal.locator('#rehearsalPlayer [data-choice="0"]').click();
  await rehearsal.locator("#rehearsalSubmit").click();
  await expect(rehearsal.locator("#rehearsalPlayerStatus")).toContainText(
    "Answer locked",
  );
  await rehearsal.locator("#rehearsalAdvance").click();
  await expect(rehearsal.locator("#rehearsalStage")).toContainText(
    "Leaderboard",
  );
  const partial = Number(
    (await rehearsal.locator(".rehearsal-score strong").textContent()).replace(
      /\D/g,
      "",
    ),
  );
  expect(partial).toBeGreaterThan(400);
  expect(partial).toBeLessThanOrEqual(500);
  await rehearsal.locator("#rehearsalAdvance").click();
  await expect(rehearsal.locator("#rehearsalStage")).toContainText(
    "Round 2: Colors",
  );
  await rehearsal.locator("#rehearsalAdvance").click();
  await rehearsal.locator("#rehearsalText").fill("BLUE");
  await rehearsal.locator("#rehearsalSubmit").click();
  await rehearsal.locator("#rehearsalSound").click();
  await expect(rehearsal.locator("#rehearsalSoundStatus")).toContainText(
    "Confirm you can hear",
  );
  await rehearsal.screenshot({
    path: "test-artifacts/v09-rehearsal.png",
    fullPage: true,
    animations: "disabled",
  });
  await rehearsal.locator("#rehearsalAdvance").click();
  await rehearsal.locator("#rehearsalAdvance").click();
  await expect(rehearsal.locator("#rehearsalStage")).toContainText(
    "Final rankings",
  );
  expect(writes).toEqual([]);
  expect(rehearsalSockets).toBe(0);
  expect(await request("/api/reports")).toEqual(before.reports);
  expect(await request("/api/publications")).toEqual(before.publications);
  expect(await request("/api/quizzes")).toEqual(before.quizzes);
  console.log("Professional browser: rehearsal passed");
  await page.getByRole("button", { name: "Save quiz", exact: true }).click();
  await expect(page.locator("#quizzes")).toHaveClass(/active-view/);
  expect(
    (await request("/api/editor-drafts")).some((d) => d.key === q.id),
  ).toBe(false);
  const changed = page
    .locator(".library-card")
    .filter({ hasText: "Unpublished rehearsal changes" });
  await changed
    .getByRole("button", { name: "Host game ↗", exact: true })
    .click();
  await expect(page.locator("#hostCode")).toHaveText(/^QZ/);
  await page.locator("#toggleConsole").click();
  await expect(page.locator("#hostConsole")).toBeVisible();
  const displayEvent = page.waitForEvent("popup");
  await page.locator("#openProjector").click();
  const display = await displayEvent;
  display.on("pageerror", (err) => errors.push(err.message));
  await expect(display.locator("#displayConnection")).toContainText(
    "Connected",
  );
  await expect(display.locator("#displayQR svg")).toBeVisible();
  expect(await display.evaluate(() => window.opener === null)).toBe(true);
  const code = await page.locator("#hostCode").textContent();
  const phoneContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    phone = await phoneContext.newPage();
  phone.on("pageerror", (err) => errors.push(err.message));
  await phone.route("**/media/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
  await phone.goto("/join?code=" + code);
  await phone.locator("#playerNameInput").fill("Professional phone test");
  await phone.locator("#joinGameBtn").click();
  await expect(phone.locator("#playerQuestion")).toBeVisible();
  await page.locator("#nextQuestion").click();
  await expect(display.locator("#displayStage")).toContainText(
    "Choose the prime numbers",
  );
  await expect(phone.locator("#playerTimer")).toHaveText(/\d+s/);
  await expect(page.locator("#consoleImages")).toContainText("1 ready");
  await expect(display.locator(".display-media img")).toBeVisible();
  await expect(display.locator(".display-media img")).toHaveJSProperty(
    "complete",
    true,
  );
  await expect(page.locator("#consoleNotes")).toContainText("PRIVATE NOTE");
  await expect(page.locator("#consoleNext")).toContainText(
    "NEXT PRIVATE PREVIEW",
  );
  expect(await display.locator("body").textContent()).not.toContain("PRIVATE");
  expect(await phone.locator("body").textContent()).not.toContain(
    "PRIVATE NOTE",
  );
  await expect(page.locator("#hostTimer")).toHaveText(/\d+s/);
  await page.screenshot({
    path: "test-artifacts/v09-private-host.png",
    animations: "disabled",
  });
  await display.screenshot({
    path: "test-artifacts/v09-projector.png",
    animations: "disabled",
  });
  const fit = await display
    .locator("#displayStage")
    .evaluate((el) => ({ height: el.clientHeight, content: el.scrollHeight }));
  expect(fit.content).toBeLessThanOrEqual(fit.height + 3);
  await display.reload();
  await expect(display.locator("#displayStage")).toContainText(
    "Choose the prime numbers",
  );
  await page.locator("#nextQuestion").click();
  await expect(display.locator("#displayStage")).toContainText("Leaderboard");
  await page.locator("#endGame").click();
  await expect(display.locator("#displayStage")).toContainText(
    "Celebrate your winners",
  );
  await page.locator("#closeGame").click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(rehearsal.locator("#rehearsalPlayer")).toContainText(
    "Host signed out",
  );
  expect(await rehearsal.locator("body").textContent()).not.toContain(
    "PRIVATE NOTE",
  );
  await expect(display.locator("#displayStage")).toContainText(
    "Display link unavailable",
    { timeout: 10000 },
  );
  await phoneContext.close();
  await display.close();
  await rehearsal.close();
};
