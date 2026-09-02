#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const Storage = require("../src/storage.js");

const ROOT = path.resolve(__dirname, "..");

function player(index = 1) {
  return {
    rank: index,
    player: `Fixture Player ${index}`,
    position: index % 2 ? "WR" : "RB",
    team: "DET",
    sleeper_id: `fixture-player-${index}`,
    adp: index,
    tier: 1,
    notes: "",
  };
}

function fixtureState() {
  return Storage.migrateState({
    schema_version: 1,
    user: { username: "fixture-user", user_id: "fixture-user-id" },
    ranking_profiles: [{
      id: "fixture-profile",
      name: "Fixture board",
      format: "one_qb",
      source: "manual",
      league_settings: {
        teams: 2,
        roster_positions: ["QB", "RB", "WR", "TE", "FLEX", "BN"],
        scoring: { rec: 0.5 },
      },
      players: Array.from({ length: 20 }, (_value, index) => player(index + 1)),
    }],
    draft_sessions: {},
    settings: { active_ranking_profile_id: "fixture-profile", poll_interval_ms: 1000 },
  }).state;
}

function session() {
  return {
    draft_id: "gate-draft",
    league_id: "gate-league",
    ranking_profile_id: "fixture-profile",
    mode: "live",
    draft_config: {
      name: "Gate room",
      type: "snake",
      status: "drafting",
      format: "one_qb",
      teams: 2,
      rounds: 2,
      user_slot: 1,
      user_roster_id: 101,
      roster_positions: ["QB", "RB", "WR", "TE", "FLEX", "BN"],
      scoring: { rec: 0.5 },
    },
  };
}

async function setRoot(page, state) {
  await page.evaluate(({ key, value }) => new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  }), { key: Storage.STORAGE_KEY, value: state });
}

async function readRoot(page) {
  return page.evaluate((key) => new Promise((resolve) => {
    chrome.storage.local.get([key], (values) => resolve(values[key]));
  }), Storage.STORAGE_KEY);
}

async function commitFrom(page, base, next) {
  return page.evaluate(({ baseState, nextState }) => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "SDCC_COMMIT_STATE", base: baseState, next: nextState }, resolve);
  }), { baseState: base, nextState: next });
}

async function run() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdcc-gate6-"));
  const browserErrors = [];
  const apiRequests = [];
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: process.env.SDCC_HEADED !== "1",
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
  });

  try {
    context.on("page", (page) => {
      page.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
      });
    });
    context.on("serviceworker", (worker) => {
      worker.on("close", () => undefined);
    });

    await context.route("https://sleeper.com/**", (route) => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body><main><h1>Fixture Sleeper draft</h1></main></body></html>",
    }));
    await context.route("https://api.sleeper.app/**", async (route) => {
      const request = route.request();
      apiRequests.push({ method: request.method(), headers: request.headers(), url: request.url() });
      const pathname = new URL(request.url()).pathname;
      let body;
      if (pathname === "/v1/draft/gate-draft") {
        body = {
          draft_id: "gate-draft",
          league_id: "gate-league",
          type: "snake",
          status: "drafting",
          settings: { teams: 2, rounds: 2, pick_timer: 30 },
          draft_order: { "fixture-user-id": 1, other: 2 },
          slot_to_roster_id: { 1: 101, 2: 102 },
          metadata: { name: "Gate room", scoring_type: "half_ppr" },
        };
      } else if (pathname === "/v1/draft/gate-draft/picks") body = [];
      else if (pathname === "/v1/draft/gate-draft/traded_picks") body = [];
      else if (pathname === "/v1/league/gate-league") {
        body = {
          league_id: "gate-league",
          name: "Gate room",
          total_rosters: 2,
          roster_positions: ["QB", "RB", "WR", "TE", "FLEX", "BN"],
          scoring_settings: { rec: 0.5 },
        };
      } else if (pathname === "/v1/league/gate-league/rosters") {
        body = [{ roster_id: 101, owner_id: "fixture-user-id" }, { roster_id: 102, owner_id: "other" }];
      } else {
        await route.fulfill({ status: 404, contentType: "application/json", body: "null" });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));
    const worker = context.serviceWorkers()[0];
    const installedPage = context.pages().find((page) => page.url().startsWith("chrome-extension://"));
    const extensionUrl = worker?.url() || installedPage?.url() || "";
    assert.ok(extensionUrl, "clean unpacked extension must load");
    const extensionId = new URL(extensionUrl).host;
    const setupUrl = `chrome-extension://${extensionId}/extension/setup.html`;

    const setupA = await context.newPage();
    await setupA.goto(setupUrl);
    await setRoot(setupA, "corrupt-root");
    await setupA.reload();
    await setupA.waitForFunction(() => document.querySelector("#global-message")?.textContent.includes("reset non-object"));

    await setRoot(setupA, { schema_version: Storage.STORAGE_VERSION + 1 });
    await setupA.reload();
    await setupA.waitForFunction(() => document.querySelector("#global-message")?.textContent.includes("newer than supported"));

    const base = fixtureState();
    await setRoot(setupA, base);
    await setupA.reload();
    const setupB = await context.newPage();
    await setupB.goto(setupUrl);

    const profileNext = Storage.migrateState({
      ...base,
      ranking_profiles: base.ranking_profiles.map((profile) => ({ ...profile, name: "Concurrent board" })),
    }).state;
    const sessionNext = Storage.migrateState({
      ...base,
      draft_sessions: { "gate-draft": session() },
      settings: { ...base.settings, last_draft_id: "gate-draft" },
    }).state;
    const [profileResponse, sessionResponse] = await Promise.all([
      commitFrom(setupA, base, profileNext),
      commitFrom(setupB, base, sessionNext),
    ]);
    assert.equal(profileResponse.ok, true);
    assert.equal(sessionResponse.ok, true);
    const merged = await readRoot(setupA);
    assert.equal(merged.ranking_profiles[0].name, "Concurrent board");
    assert.equal(merged.draft_sessions["gate-draft"].draft_id, "gate-draft");

    const sleeperPage = await context.newPage();
    await sleeperPage.goto("https://sleeper.com/draft/nfl/gate-draft");
    await sleeperPage.locator("#sdcc-draft-launcher").waitFor({ state: "visible" });
    const pagesBeforeSynthetic = context.pages().length;
    await sleeperPage.evaluate(() => document.querySelector("#sdcc-draft-launcher").click());
    await sleeperPage.waitForTimeout(250);
    assert.equal(context.pages().length, pagesBeforeSynthetic, "synthetic click must not open a tab");

    const opened = context.waitForEvent("page");
    await sleeperPage.click("#sdcc-draft-launcher");
    const draftPage = await opened;
    await draftPage.waitForLoadState("domcontentloaded");
    await draftPage.waitForFunction(() => document.querySelector("#sync-status")?.textContent.startsWith("Live / 0"));
    assert.match(draftPage.url(), new RegExp(`^chrome-extension://${extensionId}/extension/draft\\.html\\?draft_id=gate-draft`));

    assert.ok(apiRequests.length >= 4, "live draft must read its public dependencies");
    assert.ok(apiRequests.every((request) => request.method === "GET"), "all Sleeper requests must be GET");
    assert.ok(apiRequests.every((request) => !request.headers.cookie && !request.headers.authorization), "Sleeper requests must omit credentials");
    assert.deepEqual(browserErrors, []);

    process.stdout.write(`${JSON.stringify({
      clean_install: true,
      corrupt_state_recovery: true,
      future_state_refusal: true,
      concurrent_profile_and_session_merge: true,
      synthetic_launcher_blocked: true,
      trusted_launcher_opened_once: true,
      sleeper_requests: apiRequests.length,
      get_only_without_credentials: true,
      browser_errors: browserErrors,
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
