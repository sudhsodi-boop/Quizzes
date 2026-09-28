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
  const oldTrack = await player
    .locator("#playerMusic audio")
    .getAttribute("src");
  await player
    .locator("#playerMusic audio")
    .evaluate((el) => el.dispatchEvent(new Event("error")));
  await expect
    .poll(() => player.locator("#playerMusic audio").getAttribute("src"))
    .not.toBe(oldTrack);
  await expect
    .poll(() =>
      player.locator("#playerMusic audio").evaluate((el) => !el.paused),
    )
    .toBe(true);

  await expect(page.locator("#playerCount")).toHaveText("1");
  await page.getByRole("button", { name: "Start question" }).click();
  await expect(player.locator("#playerTitle")).toHaveText(
    "Which option is correct?",
  );
  await expect(player.locator("#playerMedia img")).toBeVisible();
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect
    .poll(() =>
      page
        .locator(".game-stage")
        .evaluate((el) => el.scrollHeight <= el.clientHeight + 2),
    )
    .toBe(true);
  await expect
    .poll(() =>
      player
        .locator(".participant-card")
        .evaluate((el) => el.scrollHeight <= el.clientHeight + 2),
    )
    .toBe(true);
  await page.screenshot({
    path: "test-artifacts/v07-host-question-1366.png",
    fullPage: false,
  });
  await player.screenshot({
    path: "test-artifacts/v07-player-question-mobile.png",
    fullPage: false,
  });
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
  await expect(page.locator("#hostQuestion")).toHaveText(
    "Which option is correct?",
  );
  await expect(page.locator("#hostOptions .is-correct")).toHaveCount(1);
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
  await expect(page.getByRole("button", { name: "Next round" })).toBeVisible();
  await page.getByRole("button", { name: "Next round" }).click();
  await expect(player.locator("#playerTitle")).toContainText("Round 2");
  await page.getByRole("button", { name: "Start this round" }).click();
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

  // New document import, explicit review, and default sound on both screens.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('.nav-item[data-view="dashboard"]').click();
  const beforeImport = await page.evaluate(
    async () => (await (await fetch("/api/quizzes")).json()).length,
  );
  for (const extension of ["docx", "pdf"]) {
    await page
      .locator("[data-import]")
      .filter({ visible: true })
      .first()
      .click();
    await page
      .locator("#documentFile")
      .setInputFiles(
        require("path").join(
          __dirname,
          "fixtures",
          "import-example." + extension,
        ),
      );
    await page.locator("#importSubmit").click();
    await expect(page.locator("#importReview")).toBeVisible();
    await expect(page.locator(".question-card")).toHaveCount(4);
    await expect(page.locator("#importSummary")).toContainText(
      "0 need a correct answer",
    );
    await expect(
      page.locator('[data-field="correctChoice"]').first(),
    ).toHaveValue("2");
    // Import has not persisted a quiz or exposed source text to the library.
    expect(
      await page.evaluate(
        async () => (await (await fetch("/api/quizzes")).json()).length,
      ),
    ).toBe(beforeImport);
    await page.getByRole("button", { name: "Back to library" }).click();
  }
  await page.locator("[data-import]").filter({ visible: true }).first().click();
  await page
    .locator("#documentText")
    .fill(
      "Title: Community Game Night\n1. Which planet is red?\nA) Venus\nB) Mars\nC) Saturn\nD) Neptune\n2. Choose True or False.\nAnswer: False",
    );
  await page.locator("#importSubmit").click();
  await expect(page.locator("#importSummary")).toContainText(
    "1 need a correct answer",
  );
  await expect(
    page.locator('[data-field="correctChoice"]').first(),
  ).toHaveValue("");
  await page.locator('[data-field="correctChoice"]').first().fill("2");
  await page.getByRole("button", { name: "Save quiz", exact: true }).click();
  await expect(page.locator("#editor")).toBeVisible(); // Explicit review acknowledgement required.
  await page.locator("#importReviewed").check();
  await page.getByRole("button", { name: "Save quiz", exact: true }).click();
  const importedCard = page
    .locator(".library-card")
    .filter({ hasText: "Community Game Night" });
  await expect(importedCard).toBeVisible();
  const savedImport = await page.evaluate(async () =>
    (await (await fetch("/api/quizzes")).json()).find(
      (q) => q.title === "Community Game Night",
    ),
  );
  expect(savedImport._importReport).toBeUndefined();
  expect(savedImport.music).toBe("");
  expect(savedImport.rounds[0].questions[0].correct).toBe(1);
  // Count generated notes, not just UI labels, to verify the default sequencer runs.
  const countNotes = () => {
    window.__quizzesNotes = 0;
    const original = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) {
      window.__quizzesNotes++;
      return original.apply(this, args);
    };
  };
  await page.evaluate(countNotes);
  await importedCard.getByRole("button", { name: "Host game" }).click();
  await expect
    .poll(() => page.evaluate(() => QuizzesSound.status().state))
    .toBe("running");
  await expect
    .poll(() => page.evaluate(() => window.__quizzesNotes))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => QuizzesSound.status().custom)).toBe(false);
  const newCode = await page.locator("#hostCode").textContent();
  await player.goto("/join?code=" + newCode);
  await player.evaluate(countNotes);
  await player.getByLabel("Your nickname").fill("Soundtrack player");
  await player.getByRole("button", { name: "Join game" }).click();
  await expect(player.locator("#playerTitle")).toHaveText("You’re in!");
  await expect
    .poll(() => player.evaluate(() => QuizzesSound.status().state))
    .toBe("running");
  await expect
    .poll(() => player.evaluate(() => window.__quizzesNotes))
    .toBeGreaterThan(0);
  const denied = await player.request.post("/api/quiz-import", {
    headers: { Origin: "http://localhost:4182", "X-File-Name": "private.txt" },
    data: "1. Private question\nAnswer: yes",
  });
  expect(denied.status()).toBe(401);
  await expect(player.locator("#playerSound .sound-toggle")).toBeHidden();
  await expect(player.locator("#playerSound .sound-volume")).toBeHidden();
  await page.locator("#hostSound .sound-toggle").click();
  await expect
    .poll(() => player.evaluate(() => QuizzesSound.status().muted))
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => QuizzesSound.status().muted))
    .toBe(true);
  await page.locator("#hostSound .sound-toggle").click();
  await expect
    .poll(() => player.evaluate(() => QuizzesSound.status().muted))
    .toBe(false);
  await page.screenshot({
    path: "test-artifacts/classic-host-lobby.png",
    animations: "disabled",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Start question" }).click();
  await expect(player.locator("#playerOptions button")).toHaveCount(4);
  expect(await player.evaluate(() => QuizzesSound.status().phase)).toBe(
    "question",
  );
  await expect(player.locator(".answer-shape").first()).toBeVisible();
  await page.screenshot({
    path: "test-artifacts/classic-host-question.png",
    animations: "disabled",
    fullPage: true,
  });
  await player.screenshot({
    path: "test-artifacts/classic-player-question.png",
    animations: "disabled",
    fullPage: true,
  });
  await player.getByRole("button", { name: "B Mars", exact: true }).click();
  await page.getByRole("button", { name: "Reveal answers" }).click();
  await expect(player.locator("#playerHint")).toContainText(
    "Correct answer: Mars",
  );
  expect(await player.evaluate(() => QuizzesSound.status().phase)).toBe(
    "results",
  );
  await page.getByRole("button", { name: "Next question" }).click();
  await player.getByRole("button", { name: "B False", exact: true }).click();
  await page.getByRole("button", { name: "Reveal answers" }).click();
  await page.getByRole("button", { name: "Finish & save results" }).click();
  await expect(player.locator(".podium-place")).toHaveCount(1);
  await expect
    .poll(() => player.evaluate(() => QuizzesSound.status().phase), {
      timeout: 7000,
    })
    .toBe("idle");
  await player.screenshot({
    path: "test-artifacts/classic-player-podium.png",
    animations: "disabled",
    fullPage: true,
  });
  expect(
    await player.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  // v0.5: multi-answer editing, bulk round assignment, publication and private friend signup.
  await page.locator("#closeGame").click();
  await page.locator('.nav-item[data-view="quizzes"]').click();
  await page
    .locator(".library-card")
    .filter({ hasText: "Community Game Night" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await page.locator("#quizTitle").fill("Round tools and 24h");
  await page.locator(".round-title").first().fill("Easy");
  await page
    .locator(".question-card")
    .first()
    .locator('[data-field="text"]')
    .fill("Choose prime numbers");
  await page
    .locator(".question-card")
    .first()
    .locator('[data-field="type"]')
    .selectOption("multi");
  await page
    .locator(".question-card")
    .first()
    .locator('[data-field="options"]')
    .fill("2\n4\n3\n6");
  await page
    .locator(".question-card")
    .first()
    .locator('[data-field="options"]')
    .blur();
  for (const checkbox of await page
    .locator(".question-card")
    .first()
    .locator("[data-correct-index]")
    .all())
    await checkbox.uncheck();
  await page
    .locator(".question-card")
    .first()
    .locator('[data-correct-index="0"]')
    .check();
  await page
    .locator(".question-card")
    .first()
    .locator('[data-correct-index="2"]')
    .check();
  await page
    .locator(".question-card")
    .nth(1)
    .locator(".question-select")
    .check();
  await page.locator("#bulkRound").selectOption("new");
  await page.locator("#moveSelected").click();
  await expect(page.locator(".round-section")).toHaveCount(2);
  await page.locator(".round-title").nth(1).fill("Challenge");
  await page.locator("#musicFile").setInputFiles({
    name: "independent-music.wav",
    mimeType: "audio/wav",
    buffer: wav,
  });
  await expect(page.locator("#musicPreview audio")).toBeVisible();
  await page.screenshot({
    path: "test-artifacts/v05-round-editor.png",
    animations: "disabled",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Save quiz", exact: true }).click();
  const newCard = page
    .locator(".library-card")
    .filter({ hasText: "Round tools and 24h" });
  await expect(newCard).toContainText("2 rounds · 2 questions");
  await newCard.getByRole("button", { name: "Publish 24h" }).click();
  const publication = page
    .locator(".publication-card")
    .filter({ hasText: "Round tools and 24h" });
  await expect(publication).toBeVisible();
  const publishedLink = await publication.locator("input").inputValue();
  const asyncContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const asyncPlayer = await asyncContext.newPage();
  asyncPlayer.on("pageerror", (err) => errors.push(err.message));
  await asyncPlayer.clock.install();
  await asyncPlayer.goto(publishedLink);
  await asyncPlayer
    .locator("#independentApp")
    .getByLabel("Your nickname", { exact: true })
    .fill("After-school participant");
  await asyncPlayer.getByRole("button", { name: "Start my attempt" }).click();
  await expect(
    asyncPlayer.getByRole("heading", { name: "Choose prime numbers" }),
  ).toBeVisible();
  await asyncPlayer.locator('input[name="option"][value="0"]').check();
  await expect
    .poll(() =>
      asyncPlayer.locator("#publishedBackground").evaluate((a) => !a.paused),
    )
    .toBe(true);
  const beforeExtension = await asyncPlayer
    .locator(".publication-deadline")
    .textContent();
  await publication.getByRole("button", { name: "Extend time" }).click();
  await page.getByRole("button", { name: "Save new deadline" }).click();
  await expect(page.locator("#extendDialog")).not.toBeVisible();
  await asyncPlayer.clock.fastForward(30001);
  await expect(asyncPlayer.locator(".publication-deadline")).not.toHaveText(
    beforeExtension,
  );
  await expect(
    asyncPlayer.locator('input[name="option"][value="0"]'),
  ).toBeChecked();
  const trackSource = await asyncPlayer
    .locator("#publishedBackground")
    .getAttribute("src");
  await asyncPlayer
    .locator("#publishedBackground")
    .evaluate((a) => a.dispatchEvent(new Event("error")));
  await expect
    .poll(() => asyncPlayer.locator("#publishedBackground").getAttribute("src"))
    .not.toBe(trackSource);
  await expect
    .poll(() =>
      asyncPlayer.locator("#publishedBackground").evaluate((a) => !a.paused),
    )
    .toBe(true);

  await asyncPlayer.getByRole("button", { name: "Submit answer" }).click();
  await expect(asyncPlayer.locator(".answer-feedback")).toContainText(
    "Correct answers:",
  );
  await expect(asyncPlayer.locator(".answer-feedback")).toContainText("500");
  await expect(asyncPlayer.locator("#publishedAnswer")).toHaveCount(0);
  await asyncPlayer.getByRole("button", { name: "Next question" }).click();
  await asyncPlayer.reload();
  await expect(
    asyncPlayer.getByRole("heading", { name: "Choose True or False." }),
  ).toBeVisible();
  await asyncPlayer.getByLabel("False", { exact: true }).check();
  await asyncPlayer.getByRole("button", { name: "Submit answer" }).click();
  await expect(asyncPlayer.locator(".answer-feedback")).toContainText(
    "Correct answer:",
  );
  await asyncPlayer.clock.fastForward(30001);
  await expect(asyncPlayer.locator(".answer-feedback")).toBeVisible();
  await asyncPlayer
    .getByRole("button", { name: "See my results & leaderboard" })
    .click();
  await expect(asyncPlayer.locator(".completed-leaderboard")).toContainText(
    "After-school participant",
  );
  await expect(
    asyncPlayer.getByRole("heading", {
      name: "All done, After-school participant!",
    }),
  ).toBeVisible();
  await expect(asyncPlayer.locator(".final-score")).toContainText("1,500");
  await asyncPlayer.screenshot({
    path: "test-artifacts/v07-self-paced-leaderboard.png",
    fullPage: true,
  });
  await publication.getByRole("button", { name: "View results" }).click();
  await expect(page.locator("#publicationResults")).toContainText(
    "After-school participant",
  );
  await expect(page.locator("#publicationResults")).toContainText("1500");
  await page.locator("#closePublicationDialog").click();
  await publication.getByRole("button", { name: "Close now" }).click();
  await expect(publication).toContainText("Closed");
  await asyncPlayer.getByRole("button", { name: "Refresh results" }).click();
  await expect(
    asyncPlayer.getByRole("heading", { name: "Your result: 1500 points" }),
  ).toBeVisible();
  await asyncPlayer.screenshot({
    path: "test-artifacts/v05-self-paced-result.png",
    animations: "disabled",
    fullPage: true,
  });
  await page.locator('.nav-item[data-view="settings"]').click();
  await page.locator("#createInvite").click();
  await expect(page.locator("#inviteLink")).toBeVisible();
  const friendContext = await browser.newContext();
  const friendPage = await friendContext.newPage();
  friendPage.on("pageerror", (err) => errors.push(err.message));
  await friendPage.goto(await page.locator("#inviteLink").inputValue());
  await friendPage
    .getByLabel("Workspace name")
    .fill("Friend private workspace");
  await friendPage
    .locator("#friendSignup")
    .getByLabel("Email", { exact: true })
    .fill("friend-browser@example.test");
  await friendPage
    .locator("#friendSignup")
    .getByLabel("Password", { exact: true })
    .fill(crypto.randomBytes(20).toString("hex"));
  await friendPage
    .getByRole("button", { name: "Create private workspace" })
    .click();
  await expect(
    friendPage.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await friendPage.locator('.nav-item[data-view="quizzes"]').click();
  await expect(friendPage.locator(".library-card")).toHaveCount(0);
  await expect(friendPage.locator(".publication-card")).toHaveCount(0);
  await page.locator('.nav-item[data-view="quizzes"]').click();
  await newCard.getByRole("button", { name: "Host game" }).click();
  await expect(page.locator("#hostCode")).toHaveText(/^QZ[A-F0-9]{6}$/);
  const roundCode = await page.locator("#hostCode").textContent();
  await player.goto("/join?code=" + roundCode);
  await player.getByLabel("Your nickname").fill("Round fan");
  await player.getByRole("button", { name: "Join game" }).click();
  await expect(page.locator("#playerCount")).toHaveText("1");
  await page.getByRole("button", { name: "Start question" }).click();
  await expect(player.locator("#playerRound")).toContainText("Round 1: Easy");
  await expect(player.locator("#playerRound")).toContainText("Last question");
  await page.locator("#toggleLeaderboard").click();
  await expect(player.locator("#playerLeaderboard")).toBeVisible();
  await expect(player.locator("#playerOptions")).toBeHidden();
  await expect(player.locator("#playerTitle")).toBeHidden();
  await expect(player.locator("#answerStatus")).toBeHidden();
  await expect(page.locator("#hostLeaderboard")).toBeHidden();
  await expect(page.locator("#hostQuestion")).toBeVisible();
  await player.screenshot({
    path: "test-artifacts/v07-live-leaderboard-mobile.png",
    fullPage: true,
  });
  await player.reload();
  await expect(player.locator("#playerLeaderboard")).toBeVisible();
  await expect(player.locator("#playerTitle")).toBeHidden();
  await page.locator("#toggleLeaderboard").click();
  await expect(player.locator("#playerLeaderboard")).toBeHidden();
  await expect(player.locator("#playerOptions")).toBeVisible();
  await player.locator("#playerOptions button").nth(0).click();
  await player.locator("#playerOptions button").nth(2).click();
  await player.locator("#submitMulti").click();
  await expect(player.locator("#answerStatus")).toContainText("Answer locked");
  await page.getByRole("button", { name: "Reveal answers" }).click();
  await expect(player.locator("#playerLeaderboard")).toBeVisible();
  await expect(player.locator("#playerOptions .is-correct")).toHaveCount(2);
  await page.getByRole("button", { name: "Next round" }).click();
  await expect(player.locator("#playerTitle")).toHaveText("Round 2: Challenge");
  await page.screenshot({
    path: "test-artifacts/v05-round-transition.png",
    animations: "disabled",
    fullPage: false,
  });
  await page.getByRole("button", { name: "Start this round" }).click();
  await player.getByRole("button", { name: "B False", exact: true }).click();
  await page.getByRole("button", { name: "Reveal answers" }).click();
  await page.getByRole("button", { name: "Finish & save results" }).click();
  expect(
    await asyncPlayer.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  // v0.6 administrator view and deliberate deletion of saved results.
  await page.locator("#closeGame").click();
  await friendPage.evaluate(async () => {
    const q = {
      title: "Friend lesson",
      description: "For admin oversight",
      music: "",
      rounds: [
        {
          title: "",
          questions: [
            {
              type: "choice",
              text: "Can the administrator review this?",
              options: ["Yes", "No"],
              correct: 0,
              seconds: 20,
              points: 1000,
              media: "",
            },
          ],
        },
      ],
    };
    const r = await fetch("/api/quizzes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(q),
    });
    if (!r.ok) throw Error("Unable to create test lesson");
  });
  await friendPage.reload();
  await friendPage.locator('.nav-item[data-view="settings"]').click();
  await expect(friendPage.locator("#workspacePrivacyNotice")).toContainText(
    "administrator",
  );
  await expect(friendPage.locator("#oversightPanel")).toBeHidden();
  await page.locator('.nav-item[data-view="settings"]').click();
  await expect(page.locator("#oversightPanel")).toBeVisible();
  await page.locator("#refreshOversight").click();
  await page.locator("#oversightWorkspace").selectOption({
    label: "Friend private workspace · friend-browser@example.test",
  });
  await expect(page.locator("#oversightContent")).toContainText(
    "Friend lesson",
  );
  await page.locator("#oversightContent summary").first().click();
  await expect(page.locator("#oversightContent")).toContainText(
    "Can the administrator review this?",
  );
  await expect(page.locator("#oversightContent")).not.toContainText(
    "After-school participant",
  );
  await page.locator("#oversightPanel").screenshot({
    path: "test-artifacts/v06-admin-oversight.png",
    animations: "disabled",
  });
  await page.locator('.nav-item[data-view="reports"]').click();
  const reportsBefore = await page
    .locator("#reportList .report-detail")
    .count();
  await page.locator("#reportList summary").first().click();
  await page.locator("[data-delete-report]").first().click();
  await expect(page.locator("#reportList .report-detail")).toHaveCount(
    reportsBefore - 1,
  );
  await page.locator("#clearReports").click();
  await expect(page.locator("#reportList .report-detail")).toHaveCount(0);
  await page.locator('.nav-item[data-view="quizzes"]').click();
  await publication.getByRole("button", { name: "Delete results" }).click();
  await expect(publication).toHaveCount(0);
  await expect(newCard).toBeVisible();
  await asyncPlayer.reload();
  await expect(
    asyncPlayer.getByRole("heading", { name: "Unable to open quiz" }),
  ).toBeVisible();
  // v0.7 real six-option, image question across desktop, tablet and phone viewports.
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 240;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#eef4ff";
    ctx.fillRect(0, 0, 640, 240);
    ctx.fillStyle = "#3566bc";
    ctx.font = "bold 72px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("2   3   5   7", 320, 145);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    const uploaded = await fetch("/api/media", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": "Numbers.png",
      },
      body: blob,
    }).then((r) => r.json());
    const q = {
      title: "Community challenge",
      description: "Six answers, one clear screen",
      music: "",
      rounds: [
        {
          title: "Numbers & patterns",
          questions: [
            {
              type: "multi",
              text: "Look at the numbers in the picture. Which of the following numbers are prime?",
              options: ["Two", "Three", "Four", "Five", "Six", "Seven"],
              correctAnswers: [0, 1, 3, 5],
              seconds: 120,
              points: 1000,
              media: uploaded.url,
              mediaType: uploaded.mime,
            },
          ],
        },
      ],
    };
    const response = await fetch("/api/quizzes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(q),
    });
    if (!response.ok) throw Error("Could not create layout fixture");
  });
  await page.reload();
  await page.locator('.nav-item[data-view="quizzes"]').click();
  await page
    .locator(".library-card")
    .filter({ hasText: "Community challenge" })
    .getByRole("button", { name: "Host game" })
    .click();
  await expect(page.locator("#hostCode")).toHaveText(/^QZ[A-F0-9]{6}$/);
  const layoutCode = await page.locator("#hostCode").textContent();
  await player.goto("/join?code=" + layoutCode);
  await player.getByLabel("Your nickname").fill("Layout player");
  await player.getByRole("button", { name: "Join game" }).click();
  await expect(page.locator("#playerCount")).toHaveText("1");
  await page.getByRole("button", { name: "Start question" }).click();
  await expect(player.locator("#playerOptions button")).toHaveCount(6);
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(
        () =>
          page
            .locator(".game-stage")
            .evaluate((el) => el.scrollHeight <= el.clientHeight + 2),
        { message: JSON.stringify(viewport) },
      )
      .toBe(true);
    await expect
      .poll(() =>
        page
          .locator(".game-room")
          .evaluate((el) => el.scrollHeight <= el.clientHeight + 2),
      )
      .toBe(true);
    expect(
      await page
        .locator("#hostQuestion")
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(20);
    await page.screenshot({
      path: `test-artifacts/v07-host-six-options-${viewport.width}.png`,
      fullPage: false,
    });
  }
  await expect
    .poll(() =>
      player
        .locator(".participant-card")
        .evaluate((el) => el.scrollHeight <= el.clientHeight + 2),
    )
    .toBe(true);
  await player.screenshot({
    path: "test-artifacts/v07-player-six-options-mobile.png",
    fullPage: false,
  });
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 768, height: 1024 },
  ]) {
    await player.setViewportSize(viewport);
    await expect
      .poll(() =>
        player
          .locator(".participant-card")
          .evaluate((el) => el.scrollHeight <= el.clientHeight + 2),
      )
      .toBe(true);
  }
  await page.locator("#toggleLeaderboard").click();
  await expect(player.locator("#playerLeaderboard")).toBeVisible();
  await expect(player.locator("#playerMedia")).toBeHidden();
  await expect(player.locator("#submitMulti")).toBeHidden();
  await expect(page.locator("#hostMedia")).toBeVisible();
  await expect(page.locator("#hostLeaderboard")).toBeHidden();
  // Long content and browser zoom preserve access instead of clipping text.
  await page.evaluate(() => {
    document.querySelector("#hostQuestion").textContent =
      "A very long question with essential information. ".repeat(20);
    document
      .querySelectorAll("#hostOptions .answer-copy")
      .forEach(
        (el) =>
          (el.textContent =
            "A detailed answer option with important context. ".repeat(5)),
      );
    window.dispatchEvent(new Event("resize"));
  });
  await page.setViewportSize({ width: 683, height: 384 });
  await expect
    .poll(() =>
      page
        .locator(".game-stage")
        .evaluate((el) => el.scrollHeight > el.clientHeight),
    )
    .toBe(true);
  expect(
    await page
      .locator(".game-stage")
      .evaluate((el) => getComputedStyle(el).overflowY),
  ).toBe("auto");
  await page.locator("#endGame").click();
  await expect(page.locator("#nextQuestion")).toBeDisabled();
  await expect(page.locator("#hostResults .leaderboard")).toHaveCount(0);
  await asyncContext.close();
  await friendContext.close();
  expect(errors).toEqual([]);
  await context.close();
});
