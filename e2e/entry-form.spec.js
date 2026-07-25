// @ts-check
const os = require('os');
const path = require('path');
const fs = require('fs');
const { test, expect, _electron: electron } = require('@playwright/test');

// Launches the actual packaged renderer (build/) against a throwaway
// --user-data-dir, so this never touches a real vault on the machine
// running the test. ELECTRON_RUN_AS_NODE is explicitly cleared - if it's
// set in the parent shell (as it is in some CI/sandboxed environments),
// Electron runs as a plain Node process instead of opening a window.
async function launchApp() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xela-e2e-'));
  // ELECTRON_RUN_AS_NODE must be genuinely absent, not just falsy - some
  // sandboxed/CI shells set it to force any Electron binary launched from
  // them to run as a plain Node process instead of opening a window, and
  // Electron's own check for it treats "present" (even as an empty
  // string) the same as "set", not a JS truthiness check.
  const env = { ...process.env, ELECTRON_IS_DEV: '0' }; // '0' forces build/index.html, not the (unstarted) dev server
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'public', 'electron.js'), `--user-data-dir=${userDataDir}`],
    env,
  });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  return { app, window, userDataDir };
}

test('New Entry field editor: Hidden checkbox never overlaps the remove-field button', async () => {
  const { app, window, userDataDir } = await launchApp();

  try {
    // ---- first-launch setup ----
    await window.getByPlaceholder('Enter a strong password').fill('correct-horse-battery-staple');
    await window.getByPlaceholder('Confirm your password').fill('correct-horse-battery-staple');
    await window.getByRole('button', { name: 'Create Password' }).click();

    // The category/folder name also appears in the panel header once
    // selected, so scope lookups to the sidebar tree to keep locators
    // unambiguous.
    const sidebar = window.locator('.categories-list');

    // ---- create a category ----
    await window.getByTitle('New Category').click();
    await window.getByPlaceholder('e.g. Personal, Work').fill('Test Category');
    await window.getByRole('button', { name: 'OK' }).click();

    // ---- create a folder (entries only live inside folders) ----
    await sidebar.getByText('Test Category').click({ button: 'right' });
    await window.getByText('New Folder', { exact: true }).click();
    await window.getByPlaceholder('e.g. Documents').fill('Test Folder');
    await window.getByRole('button', { name: 'OK' }).click();
    await sidebar.getByText('Test Folder').click();

    // ---- create an entry (opens straight into the field editor) ----
    await window.getByRole('button', { name: 'New Entry' }).click();
    await window.getByPlaceholder('e.g. GitHub, Chase Checking').fill('Test Entry');
    await window.getByRole('button', { name: 'Create' }).click();

    // ---- add a field so there's a Hidden checkbox + remove button to check ----
    await window.getByRole('button', { name: 'Add Field' }).click();
    await window.getByPlaceholder('e.g. PIN, Security Question').fill('Test Field');
    await window.getByRole('button', { name: 'Add', exact: true }).click();

    // All three now share the same header row (label/badge, Hidden
    // checkbox, remove button) - check every pair, not just
    // checkbox-vs-remove-button, since squeezing them onto one row is
    // exactly what caused the original overlap.
    const labelDisplay = window.locator('.field-label-display').last();
    const hiddenCheckbox = window.locator('.hidden-checkbox').last();
    const removeButton = window.locator('.btn-remove-field').last();
    await expect(labelDisplay).toBeVisible();
    await expect(hiddenCheckbox).toBeVisible();
    await expect(removeButton).toBeVisible();

    const labelBox = await labelDisplay.boundingBox();
    const checkboxBox = await hiddenCheckbox.boundingBox();
    const removeBox = await removeButton.boundingBox();
    expect(labelBox).not.toBeNull();
    expect(checkboxBox).not.toBeNull();
    expect(removeBox).not.toBeNull();

    const rectsOverlap = (a, b) =>
      a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

    await window.screenshot({ path: 'test-results/field-row-header.png' });

    for (const [nameA, boxA, nameB, boxB] of [
      ['field label', labelBox, 'Hidden checkbox', checkboxBox],
      ['Hidden checkbox', checkboxBox, 'remove button', removeBox],
      ['field label', labelBox, 'remove button', removeBox],
    ]) {
      expect(
        rectsOverlap(boxA, boxB),
        `${nameA} ${JSON.stringify(boxA)} overlaps ${nameB} ${JSON.stringify(boxB)}`,
      ).toBe(false);
    }
  } finally {
    await app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
