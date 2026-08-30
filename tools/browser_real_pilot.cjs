#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const Storage = require("../src/storage.js");

const ROOT = path.resolve(__dirname, "..");
const draftId = String(process.env.SDCC_PILOT_DRAFT_ID || "").trim();

function profile() {
  const positions = ["QB", "RB", "WR", "TE"];
  return {
    id: "pilot-profile",
    name: "Clean profile pilot",
    format: "one_qb",
    source: "manual",
    league_settings: {
      teams: 12,
      roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN"],
      scoring: { rec: 0.5 },
    },
    players: Array.from({ length: 250 }, (_value, index) => ({
      rank: index + 1,
      player: `Pilot Player ${String(index + 1).padStart(3, "0")}`,
      position: positions[index % positions.length],
      team: `T${String((index % 32) + 1).padStart(2, "0")}`,
      sleeper_id: `pilot-player-${index + 1}`,
      adp: index + 1,
      tier: Math.floor(index / 12) + 1,
      notes: "",
    })),
  };
}

async function run() {
  if (!/^[A-Za-z0-9._-]+$/.test(draftId)) throw new Error("SDCC_PILOT_DRAFT_ID is required");
  const response = await fetch(`https://api.sleeper.app/v1/draft/${encodeURIComponent(draftId)}`);
  if (!response.ok) throw new Error(`Sleeper pilot draft was unavailable (${response.status})`);
  const draft = await response.json();
  const userId = Object.keys(draft?.draft_order || {})[0] || "pilot-user";
  const state = Storage.migrateState({
    schema_version: 1,
    user: { username: "clean-profile-pilot", user_id: userId },
    ranking_profiles: [profile()],
    draft_sessions: {},
    settings: { active_ranking_profile_id: "pilot-profile", poll_interval_ms: 1000 },
  }).state;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdcc-real-pilot-"));
  const errors = [];
  const requests = [];
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: process.env.SDCC_HEADED !== "1",
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
  });

  try {
    context.on("request", (request) => {
      const url = new URL(request.url());
      if (url.hostname === "api.sleeper.app" || url.hostname === "api.sleeper.com") {
        requests.push({ method: request.method(), hasCookie: Boolean(request.headers().cookie), hasAuthorization: Boolean(request.headers().authorization) });
      }
    });
    context.on("page", (page) => {
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));
    const worker = context.serviceWorkers()[0];
    const installedPage = context.pages().find((page) => page.url().startsWith("chrome-extension://"));
    const extensionUrl = worker?.url() || installedPage?.url() || "";
    assert.ok(extensionUrl, "unpacked extension did not load");
    const extensionId = new URL(extensionUrl).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/extension/setup.html`);
    await page.evaluate(({ key, value }) => new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, resolve);
    }), { key: Storage.STORAGE_KEY, value: state });
    await page.goto(`chrome-extension://${extensionId}/extension/draft.html?draft_id=${encodeURIComponent(draftId)}`);
    await page.waitForFunction(() => document.querySelector("#runtime-content")?.hidden === false, null, { timeout: 15000 });
    const sync = await page.locator("#sync-status").textContent();
    assert.match(sync, /^(Live|Offline)/);
    assert.equal(await page.locator("#runtime-message").isVisible(), false);
    await page.click("#manual-mode");
    await page.waitForFunction(() => document.body.classList.contains("manual-mode"));
    await page.click("#live-mode");
    await page.waitForFunction(() => !document.body.classList.contains("manual-mode"));
    assert.ok(requests.length >= 2, "pilot must reach real Sleeper read endpoints");
    assert.ok(requests.every((request) => request.method === "GET" && !request.hasCookie && !request.hasAuthorization));
    assert.deepEqual(errors, []);

    process.stdout.write(`${JSON.stringify({
      clean_profile: true,
      real_sleeper_draft_loaded: true,
      live_and_manual_modes: true,
      get_only_without_credentials: true,
      browser_errors: errors,
    }, null, 2)}\n`);
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
