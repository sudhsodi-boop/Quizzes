const { test, expect } = require("@playwright/test");
const crypto = require("crypto");
test("Host editor and a separate mobile player complete a saved multimedia quiz", async ({
  page,
  browser,
}) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("dialog", (d) => d.accept());
  await page.goto("/");
  await page.getByRole("button", { name: "Host sign in" }).click();
  const password = crypto.randomBytes(20).toString("hex");
  await page
    .getByLabel("Organization name", { exact: true })
    .fill("Community test organization");
  await page.getByLabel("Email", { exact: true }).fill("browser@example.test");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create host account" }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "＋ Create quiz" }).first().click();
  await page
    .getByLabel("Quiz title", { exact: true })
    .fill("Browser test gathering");
  await page
    .getByLabel("Description", { exact: true })
    .fill("One choice, one truth, one shared word.");
  let cards = page.locator(".question-card");
  await cards
    .first()
    .locator('[data-field="text"]')
    .fill("Which option is correct?");
  await cards
    .first()
    .locator('[data-field="options"]')
    .fill("First option\nSecond option");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6sGkAAAAASUVORK5CYII=",
    "base64",
  );
  await cards
    .first()
    .locator("input[type=file]")
    .setInputFiles({ name: "image.png", mimeType: "image/png", buffer: png });
  await expect(cards.first().locator(".question-media")).toBeVisible();
  // A small valid PCM WAV fixture for music upload/playback controls.
  const wav = Buffer.alloc(44 + 8000);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(8000, 40);
  wav.fill(128, 44);
  await page
    .locator("#musicFile")
    .setInputFiles({ name: "music.wav", mimeType: "audio/wav", buffer: wav });
  await expect(page.locator("#musicPreview audio")).toBeVisible();
  await page
    .getByRole("button", { name: "＋ Add question", exact: true })
    .click();
  await cards.nth(1).locator('[data-field="type"]').selectOption("boolean");
  await cards.nth(1).locator('[data-field="text"]').fill("Everyone can help.");
  await cards.nth(1).locator("input[type=file]").setInputFiles({
    name: "question.wav",
    mimeType: "audio/wav",
    buffer: wav,
  });
  await expect(cards.nth(1).locator("audio")).toBeVisible();
  await page.getByRole("button", { name: "＋ Add round", exact: true }).click();
  await cards.nth(2).locator('[data-field="type"]').selectOption("text");
  await cards
    .nth(2)
    .locator('[data-field="text"]')
    .fill("Together we are ____.");
  await cards
    .nth(2)
    .locator('[data-field="accepted"]')
    .fill("stronger\nbetter together");
  await page.getByRole("button", { name: "Save quiz", exact: true }).click();
  await expect(page.locator("#quizzes")).toBeVisible();
  await expect(
    page.locator(".library-card").filter({ hasText: "Browser test gathering" }),
  ).toContainText("2 rounds · 3 questions");
  await page.reload();
  await page.locator('.nav-item[data-view="quizzes"]').click();
  const quiz = page
    .locator(".library-card")
    .filter({ hasText: "Browser test gathering" });
  await quiz.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator(".question-card")).toHaveCount(3);
  await expect(page.locator(".question-media")).toBeVisible();
  await page.getByRole("button", { name: "Back to library" }).click();
  await quiz.getByRole("button", { name: "Host game" }).click();
  await expect(page.locator("#hostCode")).toHaveText(/^QZ[A-F0-9]{6}$/);
  const code = await page.locator("#hostCode").textContent();
  await page.locator("#lobbyMusic audio").evaluate((audio) => audio.play());
  await expect
    .poll(() =>
      page.locator("#lobbyMusic audio").evaluate((audio) => audio.paused),
    )
    .toBe(false);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const player = await context.newPage();
  player.on("pageerror", (err) => errors.push(err.message));
  await player.goto(`/join?code=${code}`);
  await player.getByLabel("Your nickname").fill("Mobile player");
  await player.getByRole("button", { name: "Join game" }).click();
  await expect(player.locator("#playerTitle")).toHaveText("You’re in!");
  await expect(page.locator("#playerCount")).toHaveText("1");
  await page.getByRole("button", { name: "Start question" }).click();
  await expect(player.locator("#playerTitle")).toHaveText(
    "Which option is correct?",
  );
  await expect(player.locator("#playerMedia img")).toBeVisible();
  await player.getByRole("button", { name: "A First option" }).click();
  await expect(player.locator("#answerStatus")).toContainText(
    "Answer locked in",
  );
  await player.reload();
  await expect(player.locator("#playerOptions button").first()).toBeDisabled();
  await page.getByRole("button", { name: "Reveal answers" }).click();
  await expect(player.locator("#playerHint")).toContainText(
    "Correct answer: First option",
  );
  await page.reload();
  await expect(page.locator("#gameModal")).toBeVisible();
  await page.getByRole("button", { name: "Next question" }).click();
  await expect(player.locator("#playerTitle")).toHaveText("Everyone can help.");
  await expect(player.locator("#playerMedia audio")).toBeVisible();
  await player.locator("#playerMedia audio").evaluate((audio) => audio.play());
  await expect
    .poll(() =>
      player.locator("#playerMedia audio").evaluate((audio) => audio.paused),
    )
    .toBe(false);
  await player.getByRole("button", { name: "A True" }).click();
  await page.getByRole("button", { name: "Reveal answers" }).click();
  await expect(
    page.getByRole("button", { name: "Next question" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next question" }).click();
  await expect(player.locator("#textAnswerForm")).toBeVisible();
  await player.locator("#textAnswer").fill("  STRONGER  ");
  await player.getByRole("button", { name: "Lock in answer" }).click();
  await expect(player.locator("#answerStatus")).toContainText(
    "Answer locked in",
  );
  await page.getByRole("button", { name: "Reveal answers" }).click();
  await page.getByRole("button", { name: "Finish & save results" }).click();
  await expect(player.locator("#playerTitle")).toHaveText(
    "A moment worth sharing.",
  );
  await expect(
    page.getByRole("button", { name: "Results saved" }),
  ).toBeDisabled();
  await page.locator("#closeGame").click();
  await page.locator('.nav-item[data-view="reports"]').click();
  await page.locator(".report-detail summary").click();
  await expect(page.locator(".report-detail")).toContainText("Mobile player");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  expect((await download).suggestedFilename()).toContain("quizzes-");
  await page.screenshot({
    path: "test-artifacts/host-reports.png",
    fullPage: true,
  });
  await player.screenshot({
    path: "test-artifacts/player-results.png",
    fullPage: true,
  });
  expect(
    await player.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Quizzes", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.screenshot({
    path: "test-artifacts/mobile-dashboard.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator("#recoveryCodeForm input").fill(password);
  const recoveryDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download recovery code", exact: true })
    .click();
  const recoveryFile = await recoveryDownload;
  const recoveryText = require("fs").readFileSync(
    await recoveryFile.path(),
    "utf8",
  );
  const recoveryCode = /One-time recovery code: (\S+)/.exec(recoveryText)[1];
  await expect(page.locator("#recoveryCodeStatus")).toContainText("Downloaded");
  await page.locator("#backupForm input").fill(password);
  const backupDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download backup ZIP" }).click();
  expect((await backupDownload).suggestedFilename()).toContain(
    "quizzes-private-backup",
  );
  await expect(page.locator("#backupStatus")).toContainText("Downloaded");
  await page.locator("#authButton").click();
  await page.getByRole("button", { name: "Host sign in", exact: true }).click();
  await page.locator("#openRecovery").click();
  await page
    .locator("#recoverForm input[name=email]")
    .fill("browser@example.test");
  await page.locator("#recoverForm input[name=code]").fill(recoveryCode);
  const replacementPassword = crypto.randomBytes(20).toString("hex");
  await page
    .locator("#recoverForm input[name=password]")
    .fill(replacementPassword);
  await page
    .getByRole("button", { name: "Reset password", exact: true })
    .click();
  await expect(page.locator("#authModal")).toBeVisible();
  await page.locator("#emailInput").fill("browser@example.test");
  await page.locator("#passwordInput").fill(replacementPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});
