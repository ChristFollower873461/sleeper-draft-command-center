#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const extensionRoot = path.resolve(process.env.SDCC_EXTENSION_ROOT || "");

async function run() {
  assert.ok(process.env.SDCC_EXTENSION_ROOT, "SDCC_EXTENSION_ROOT is required");
  assert.ok(fs.existsSync(path.join(extensionRoot, "manifest.json")), "package must contain a root manifest");
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdcc-package-smoke-"));
  const errors = [];
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: process.env.SDCC_HEADED !== "1",
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extensionRoot}`, `--load-extension=${extensionRoot}`],
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const worker = context.serviceWorkers()[0];
    const installedPage = context.pages().find((page) => page.url().startsWith("chrome-extension://"));
    const extensionUrl = worker?.url() || installedPage?.url() || "";
    assert.ok(extensionUrl, "packaged extension did not load");
    const extensionId = new URL(extensionUrl).host;
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`chrome-extension://${extensionId}/extension/setup.html`);
    await page.locator("#identity-title").waitFor({ state: "visible" });
    const manifest = await page.evaluate(() => chrome.runtime.getManifest());
    assert.equal(manifest.name, "Sleeper Draft Command Center");
    assert.deepEqual(errors, []);
    process.stdout.write(`${JSON.stringify({ packaged_install: true, version: manifest.version, browser_errors: errors }, null, 2)}\n`);
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
