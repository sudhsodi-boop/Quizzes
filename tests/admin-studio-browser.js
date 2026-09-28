const { expect } = require("@playwright/test");
module.exports = async ({ page, friendPage, png }) => {
  page.setDefaultTimeout(15000);
  friendPage.setDefaultTimeout(15000);
  console.log("Admin Studio: open full editor");
  const readFriend = () =>
    friendPage.evaluate(() => fetch("/api/quizzes").then((r) => r.json()));
  const original = (await readFriend()).find(
    (q) => q.title === "Friend lesson",
  );
  await page
    .getByRole("button", { name: "Open full Studio · view & edit" })
    .click();
  await expect(page.locator("#editor")).toHaveClass(/active-view/);
  await expect(page.locator("#oversightEditorNotice")).toContainText(
    "Friend private workspace",
  );
  await expect(page.locator("#saveDraftCopy")).toBeDisabled();
  await expect(page.locator(".studio-answer-tiles")).toBeVisible();
  await expect(page.locator('[data-studio-correct="0"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const question = page.locator(".question-card").first();
  await question
    .locator('[data-field="text"]')
    .fill("Administrator updated this complete lesson");
  await question
    .locator("input[type=file]")
    .setInputFiles({
      name: "admin-owner-image.png",
      mimeType: "image/png",
      buffer: png,
    });
  await expect(question.locator(".question-media")).toBeVisible();
  await page
    .locator(".question-card details")
    .evaluateAll((nodes) => nodes.forEach((n) => (n.open = true)));
  await page
    .locator('[data-field="notes"]')
    .fill("Private speaker note entered by administrator");
  await expect(page.locator("#draftStatus")).toContainText(
    "Recovery draft saved",
    { timeout: 10000 },
  );
  expect(
    (await readFriend()).find((q) => q.id === original.id).rounds[0]
      .questions[0].text,
  ).toBe(original.rounds[0].questions[0].text);
  const friendDrafts = await friendPage.evaluate(() =>
    fetch("/api/editor-drafts").then((r) => r.json()),
  );
  expect(friendDrafts.some((d) => d.key === original.id)).toBe(false);
  await page.reload();
  await page.locator('.sidebar [data-view="quizzes"]').click();
  await page.locator("#recoverDrafts").click();
  const row = page
    .locator(".recovery-row")
    .filter({ hasText: "Friend lesson" });
  await expect(row).toContainText("Admin edit: Friend private workspace");
  await row.getByRole("button", { name: "Recover", exact: true }).click();
  await expect(page.locator("#oversightEditorNotice")).toContainText(
    "Friend private workspace",
  );
  await expect(page.locator('[data-field="text"]').first()).toHaveValue(
    "Administrator updated this complete lesson",
  );
  await page.screenshot({
    path: "test-artifacts/admin-full-studio.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Save quiz", exact: true }).click();
  await expect(page.locator("#settings")).toHaveClass(/active-view/);
  await expect(page.locator("#oversightContent")).toContainText(
    "Administrator updated this complete lesson",
  );
  const updated = (await readFriend()).find((q) => q.id === original.id);
  expect(updated._revision).toBe(original._revision + 1);
  expect(updated._lastAdminEdit.email).toBe("browser@example.test");
  expect(updated.rounds[0].questions[0].notes).toBe(
    "Private speaker note entered by administrator",
  );
  expect(updated.rounds[0].questions[0].media).toMatch(/^\/media\//);
  const canSeeMedia = await friendPage.evaluate(
    (url) => fetch(url).then((r) => r.status),
    updated.rounds[0].questions[0].media,
  );
  expect(canSeeMedia).toBe(200);
  const own = await page.evaluate(() =>
    fetch("/api/quizzes").then((r) => r.json()),
  );
  expect(own.some((q) => q.id === original.id)).toBe(false);
  const drafts = await page.evaluate(() =>
    fetch("/api/editor-drafts").then((r) => r.json()),
  );
  expect(drafts.some((d) => d.key === original.id)).toBe(false);
  await friendPage.reload();
  await friendPage.locator('.sidebar [data-view="quizzes"]').click();
  await friendPage
    .locator(".library-card")
    .filter({ hasText: "Friend lesson" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await expect(friendPage.locator("#lastAdminEdit")).toContainText(
    "browser@example.test",
  );
  await expect(friendPage.locator("#oversightEditorNotice")).toBeHidden();
  await friendPage.getByRole("button", { name: "Back to library" }).click();
  await friendPage.locator('.sidebar [data-view="settings"]').click();
  console.log(
    "Admin Studio: editing, uploads, private recovery and owner visibility passed",
  );
};
