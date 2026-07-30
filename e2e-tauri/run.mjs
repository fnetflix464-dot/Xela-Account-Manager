#!/usr/bin/env node
// Tauri E2E harness, replacing Playwright's Electron (_electron) driver
// from e2e/entry-form.spec.js. Playwright can't drive a Tauri window the
// way it does Electron - Tauri's webview (WebKitGTK/WebView2/WKWebView)
// doesn't expose the Chrome DevTools Protocol Playwright's _electron
// relies on. The standard Tauri approach instead: tauri-driver speaks
// the W3C WebDriver protocol to the OS webview (WebKitWebDriver on
// Linux), and any WebDriver client can drive it - this uses
// webdriverio directly in standalone mode (no @wdio/cli test runner)
// to keep the harness a single plain script.
//
// Usage: node e2e-tauri/run.mjs
// Requires: the release binary already built through the Tauri CLI
// (npm run tauri:build -- --no-bundle - plain `cargo build --release`
// is not enough, see note below), tauri-driver on PATH
// (`cargo install tauri-driver --locked`), and on Linux, the
// webkit2gtk-driver system package (provides WebKitWebDriver).
//
// Verified end-to-end: this harness drives the real compiled binary
// through vault creation, category/folder/entry creation, and adding a
// field, then checks the field row's label/Hidden-checkbox/remove-button
// don't overlap - the same regression e2e/entry-form.spec.js checked
// under Electron. Two non-obvious things worth knowing if this ever
// breaks again:
// - The WebDriver capabilities must NOT include `browserName` - the
//   official Tauri example omits it entirely; WebKitWebDriver rejects
//   an explicit value during capability matching.
// - A binary built via plain `cargo build --release` (bypassing the
//   Tauri CLI) loaded devUrl (localhost:3000) instead of the embedded
//   frontendDist and failed with "connection refused" in the webview -
//   always build through `tauri build`/`tauri dev` for this to work.

import { spawn } from 'child_process';
import { remote } from 'webdriverio';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const binaryPath = path.join(repoRoot, 'src-tauri', 'target', 'release', 'xela-account-manager');
const driverPort = 39871;
// tauri-driver also opens a second, internal port to talk to the native
// WebKitWebDriver process (--native-port, defaults to 4445) - this
// sandbox has port 4445 reserved/intercepted for something unrelated
// (confirmed: a plain TCP bind to 127.0.0.1:4445 fails with EADDRINUSE
// even with nothing visibly listening), which silently broke capability
// negotiation until both ports were moved off it.
const nativePort = 39872;

function waitForPort(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tryConnect = () => {
      const socket = new net.Socket();
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`tauri-driver did not open port ${port} in time`));
        else setTimeout(tryConnect, 200);
      });
      socket.connect(port, '127.0.0.1');
    };
    tryConnect();
  });
}

async function main() {
  if (!fs.existsSync(binaryPath)) {
    console.error(`Release binary not found at ${binaryPath}.`);
    console.error('Build it first: npm run react-build && (cd src-tauri && cargo build --release)');
    process.exit(1);
  }

  // Isolate this run's vault data the same way the old Electron E2E test
  // used a throwaway --user-data-dir: Tauri's app_data_dir() resolution
  // on Linux goes through XDG_DATA_HOME, so overriding it here keeps the
  // test from ever touching a real vault on the machine running it.
  const xdgDataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xela-e2e-tauri-'));

  console.log('Starting tauri-driver...');
  // tauri-driver's TauriOptions capability only accepts application/args
  // (see its server.rs) - no per-session env passthrough. It spawns
  // WebKitWebDriver, which in turn spawns our app binary, and neither
  // hop clears the environment, so setting XDG_DATA_HOME here cascades
  // all the way down to isolate this run's vault.xam/backups/quickunlock.dat.
  // detached so tauri-driver becomes its own process group leader - we can
  // then SIGKILL the whole group (tauri-driver + WebKitWebDriver + the app
  // binary it launches) instead of orphaning descendants that outlive a
  // plain driver.kill() on just the immediate child.
  const driver = spawn('tauri-driver', ['--port', String(driverPort), '--native-port', String(nativePort)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, XDG_DATA_HOME: xdgDataHome },
    detached: true,
  });
  driver.stdout.on('data', (d) => process.env.E2E_VERBOSE && console.log(`[tauri-driver] ${d}`));
  driver.stderr.on('data', (d) => console.error(`[tauri-driver] ${d}`));
  const killDriverGroup = () => {
    try {
      process.kill(-driver.pid, 'SIGKILL');
    } catch {
      // already gone
    }
  };
  process.on('exit', killDriverGroup);
  process.on('SIGINT', () => {
    killDriverGroup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    killDriverGroup();
    process.exit(143);
  });

  await waitForPort(driverPort, 10_000);

  const client = await remote({
    hostname: '127.0.0.1',
    port: driverPort,
    path: '/',
    logLevel: 'error',
    capabilities: {
      // No browserName - the official Tauri WebDriver example omits it
      // entirely; WebKitWebDriver rejected an explicit value here during
      // capability matching.
      'tauri:options': {
        application: binaryPath,
      },
    },
  });

  let failed = false;
  try {
    await runScenario(client);
    console.log('PASS: entry field editor renders without overlapping elements');
  } catch (err) {
    failed = true;
    console.error('FAIL:', err.message);
    try {
      const png = await client.takeScreenshot();
      const outPath = path.join(repoRoot, 'test-results', 'tauri-e2e-failure.png');
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, Buffer.from(png, 'base64'));
      console.error(`Screenshot saved to ${outPath}`);
    } catch {
      // best-effort only
    }
  } finally {
    await client.deleteSession().catch(() => {});
    killDriverGroup();
    fs.rmSync(xdgDataHome, { recursive: true, force: true });
  }

  process.exit(failed ? 1 : 0);
}

/** Mirrors e2e/entry-form.spec.js's scenario: create a vault, a category,
 * a folder, an entry, add a field, and confirm the field row's label/
 * Hidden-checkbox/remove-button don't visually overlap. */
async function runScenario(client) {
  const byPlaceholder = async (placeholder) =>
    client.$(`//input[@placeholder="${placeholder}"] | //textarea[@placeholder="${placeholder}"]`);
  const byText = async (text) => client.$(`//*[normalize-space(text())="${text}"]`);
  const byRoleButtonName = async (name) => client.$(`//button[normalize-space(text())="${name}"]`);
  // Observed: folder names in the sidebar tree render lower-cased even
  // though the category name right above them keeps its typed case - cause
  // not root-caused (no text-transform/small-caps rule found in src/styles,
  // so it may be elsewhere); match case-insensitively here rather than
  // assert on it, since this test's job is the field-editor layout, not
  // sidebar casing.
  const lower = (xpathText) => `translate(${xpathText}, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')`;

  await client.waitUntil(async () => (await (await byPlaceholder('Enter a strong password')).isExisting()), {
    timeout: 15_000,
    timeoutMsg: 'Login screen never appeared',
  });

  await (await byPlaceholder('Enter a strong password')).setValue('correct-horse-battery-staple');
  await (await byPlaceholder('Confirm your password')).setValue('correct-horse-battery-staple');
  await (await byRoleButtonName('Create Password')).click();

  await client.waitUntil(async () => (await (await client.$('[title="New Category"]')).isExisting()), {
    timeout: 15_000,
    timeoutMsg: 'Main app shell never appeared after vault creation',
  });

  await (await client.$('[title="New Category"]')).click();
  await (await byPlaceholder('e.g. Personal, Work')).setValue('Test Category');
  await (await byRoleButtonName('OK')).click();

  const sidebar = await client.$('.categories-list');
  await (await sidebar.$('//*[normalize-space(text())="Test Category"]')).click({ button: 'right' });
  await (await byText('New Folder')).click();
  await (await byPlaceholder('e.g. Documents')).setValue('Test Folder');
  await (await byRoleButtonName('OK')).click();
  await (await sidebar.$(`//*[${lower('normalize-space(text())')}="test folder"]`)).click();

  await (await byRoleButtonName('New Entry')).click();
  await (await byPlaceholder('e.g. GitHub, Chase Checking')).setValue('Test Entry');
  await (await byRoleButtonName('Create')).click();

  await (await byRoleButtonName('Add Field')).click();
  await (await byPlaceholder('e.g. PIN, Security Question')).setValue('Test Field');
  await (await byRoleButtonName('Add')).click();

  const labelDisplays = await client.$$('.field-label-display');
  const hiddenCheckboxes = await client.$$('.hidden-checkbox');
  const removeButtons = await client.$$('.btn-remove-field');
  const labelDisplay = labelDisplays[labelDisplays.length - 1];
  const hiddenCheckbox = hiddenCheckboxes[hiddenCheckboxes.length - 1];
  const removeButton = removeButtons[removeButtons.length - 1];

  const rectOf = async (el) => {
    const [{ x, y }, { width, height }] = await Promise.all([el.getLocation(), el.getSize()]);
    return { x, y, width, height };
  };
  const [labelBox, checkboxBox, removeBox] = await Promise.all([
    rectOf(labelDisplay),
    rectOf(hiddenCheckbox),
    rectOf(removeButton),
  ]);

  const rectsOverlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

  for (const [nameA, boxA, nameB, boxB] of [
    ['field label', labelBox, 'Hidden checkbox', checkboxBox],
    ['Hidden checkbox', checkboxBox, 'remove button', removeBox],
    ['field label', labelBox, 'remove button', removeBox],
  ]) {
    if (rectsOverlap(boxA, boxB)) {
      throw new Error(`${nameA} ${JSON.stringify(boxA)} overlaps ${nameB} ${JSON.stringify(boxB)}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
