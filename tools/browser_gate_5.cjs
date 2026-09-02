#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const Storage = require("../src/storage.js");
const DraftOrder = require("../src/draft-order.js");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.resolve(ROOT, "..", "exports", "sleeper-draft-command-center-qa", "gate-5");

function positionFor(index, format) {
  if (format === "superflex") {
    const first = ["RB", "WR", "TE", "RB", "QB", "QB"];
    return first[index - 1] || ["WR", "RB", "QB", "TE"][index % 4];
  }
  return ["QB", "RB", "WR", "TE", "WR", "RB"][(index - 1) % 6];
}

function player(index, format) {
  const padded = String(index).padStart(3, "0");
  const prefix = format === "superflex" ? "Flex" : "One";
  return {
    rank: index,
    player: `${prefix} Player ${padded}`,
    position: positionFor(index, format),
    team: `T${String(((index - 1) % 32) + 1).padStart(2, "0")}`,
    sleeper_id: `${format}-player-${padded}`,
    adp: index + 0.4,
    tier: Math.ceil(index / 10),
    notes: index === 25 ? "Fixture target" : "",
  };
}

function profile(format) {
  return {
    id: `${format}-profile`,
    name: format === "superflex" ? "Superflex Fixture" : "One QB Fixture",
    format,
    source: "manual",
    created_at: "2026-08-29T20:00:00.000Z",
    updated_at: "2026-08-29T20:00:00.000Z",
    league_settings: {
      teams: 4,
      roster_positions: format === "superflex"
        ? ["QB", "RB", "WR", "TE", "SUPER_FLEX", "BN", "BN"]
        : ["QB", "RB", "WR", "TE", "FLEX", "BN", "BN"],
      scoring: { rec: 0.5, pass_td: 4 },
    },
    players: Array.from({ length: 250 }, (_value, index) => player(index + 1, format)),
  };
}

function fixtureState() {
  return Storage.migrateState({
    schema_version: 1,
    user: { username: "fixturecoach", user_id: "fixture-coach" },
    ranking_profiles: [profile("one_qb"), profile("superflex")],
    draft_sessions: {},
    settings: { active_ranking_profile_id: "one_qb-profile", poll_interval_ms: 1000 },
  }).state;
}

function draftFixture(format) {
  const superflex = format === "superflex";
  return {
    draft_id: superflex ? "live-superflex" : "live-one-qb",
    league_id: superflex ? "league-superflex" : "league-one-qb",
    type: "snake",
    status: "drafting",
    settings: { teams: 4, rounds: 4, pick_timer: 30, reversal_round: superflex ? 3 : 0 },
    draft_order: { "fixture-coach": 1, "other-2": 2, "other-3": 3, "other-4": 4 },
    slot_to_roster_id: { 1: 101, 2: 102, 3: 103, 4: 104 },
    metadata: { name: superflex ? "Superflex Live Fixture" : "One QB Live Fixture", scoring_type: "half_ppr" },
  };
}

function leagueFixture(format) {
  const superflex = format === "superflex";
  return {
    league_id: superflex ? "league-superflex" : "league-one-qb",
    name: superflex ? "Superflex Live Fixture" : "One QB Live Fixture",
    total_rosters: 4,
    roster_positions: superflex
      ? ["QB", "RB", "WR", "TE", "SUPER_FLEX", "BN", "BN"]
      : ["QB", "RB", "WR", "TE", "FLEX", "BN", "BN"],
    scoring_settings: { rec: 0.5, pass_td: 4 },
  };
}

function pickFixture(pickNumber, format, playerIndex = pickNumber) {
  const draftSlot = DraftOrder.slotForPickNumber(pickNumber, 4, format === "superflex" ? 3 : 0);
  const selected = player(playerIndex, format);
  const words = selected.player.split(" ");
  return {
    pick_no: pickNumber,
    draft_slot: draftSlot,
    roster_id: 100 + draftSlot,
    picked_by: draftSlot === 1 ? "fixture-coach" : `other-${draftSlot}`,
    player_id: selected.sleeper_id,
    metadata: {
      first_name: words.slice(0, -1).join(" "),
      last_name: words.at(-1),
      position: selected.position,
      team: selected.team,
      player_id: selected.sleeper_id,
    },
  };
}

function completePicks(format, swapFive = false) {
  return Array.from({ length: 16 }, (_value, index) => {
    const pickNumber = index + 1;
    if (swapFive && pickNumber === 5) return pickFixture(5, format, 6);
    if (swapFive && pickNumber === 6) return pickFixture(6, format, 5);
    return pickFixture(pickNumber, format);
  });
}

async function assertNoPageOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  assert.ok(metrics.documentWidth <= metrics.viewport + 1, `${label}: document overflow ${JSON.stringify(metrics)}`);
  assert.ok(metrics.bodyWidth <= metrics.viewport + 1, `${label}: body overflow ${JSON.stringify(metrics)}`);
  return metrics;
}

async function waitForRuntime(page) {
  await page.waitForFunction(() => document.querySelector("#runtime-content")?.hidden === false);
}

async function selectActiveProfile(page, profileId) {
  await page.evaluate(({ key, profileId }) => new Promise((resolve) => {
    chrome.storage.local.get([key], (values) => {
      values[key].settings.active_ranking_profile_id = profileId;
      chrome.storage.local.set({ [key]: values[key] }, resolve);
    });
  }), { key: Storage.STORAGE_KEY, profileId });
}

async function createManualRoom(page, extensionId, options) {
  await page.goto(`chrome-extension://${extensionId}/extension/draft.html?mode=manual`);
  await page.locator("#manual-setup-dialog").waitFor({ state: "visible" });
  await page.selectOption("#manual-profile", options.profileId);
  await page.fill("#manual-room-name", options.name);
  await page.selectOption("#manual-format", options.format);
  await page.fill("#manual-teams", "2");
  await page.fill("#manual-rounds", "2");
  await page.fill("#manual-slot", "1");
  await page.fill("#manual-reversal", "0");
  await page.click('#manual-setup-form button[value="create"]');
  await page.locator("#manual-setup-dialog").waitFor({ state: "hidden" });
  await waitForRuntime(page);
  await page.click('[data-runtime-tab="manual"]');
  await page.waitForFunction(() => document.querySelector('[data-runtime-panel="manual"]')?.hidden === false);
}

async function recordManualBoard(page, names) {
  for (const [index, name] of names.entries()) {
    await page.fill("#manual-player-search", name);
    await page.locator("#manual-player-search").press("Enter");
    if (index < names.length - 1) {
      await page.waitForFunction(
        (expected) => document.querySelector("#signal-pick")?.textContent === expected,
        DraftOrder.formatPick(index + 2, 2),
      );
    } else {
      await page.waitForFunction(() => document.querySelector("#signal-pick")?.textContent === "COMPLETE");
    }
  }
}

async function run() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdcc-gate5-"));
  const browserErrors = [];
  const expectedNetworkErrors = [];
  let apiOffline = false;
  let oneQbPicks = Array.from({ length: 4 }, (_value, index) => pickFixture(index + 1, "one_qb"));
  let superflexPicks = Array.from({ length: 4 }, (_value, index) => pickFixture(index + 1, "superflex"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: process.env.SDCC_HEADED !== "1",
    viewport: { width: 1366, height: 900 },
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
  });

  try {
    await context.route("https://api.sleeper.app/**", async (route) => {
      if (apiOffline) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "fixture offline" }) });
        return;
      }
      const pathname = new URL(route.request().url()).pathname;
      const superflex = pathname.includes("superflex");
      let body;
      if (pathname === "/v1/draft/live-one-qb") body = draftFixture("one_qb");
      else if (pathname === "/v1/draft/live-superflex") body = draftFixture("superflex");
      else if (pathname === "/v1/draft/live-one-qb/picks") body = oneQbPicks;
      else if (pathname === "/v1/draft/live-superflex/picks") body = superflexPicks;
      else if (pathname.endsWith("/traded_picks")) body = [];
      else if (pathname === "/v1/league/league-one-qb") body = leagueFixture("one_qb");
      else if (pathname === "/v1/league/league-superflex") body = leagueFixture("superflex");
      else if (pathname.endsWith("/rosters")) {
        body = [
          { roster_id: 101, owner_id: "fixture-coach" },
          { roster_id: 102, owner_id: "other-2" },
          { roster_id: 103, owner_id: "other-3" },
          { roster_id: 104, owner_id: "other-4" },
        ];
      } else {
        await route.fulfill({ status: 404, contentType: "application/json", body: "null" });
        return;
      }
      assert.equal(route.request().method(), "GET");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await context.route("https://sleeper.com/**", (route) => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body><main><h1>Fixture Sleeper Room</h1></main></body></html>",
    }));

    await new Promise((resolve) => setTimeout(resolve, 1200));
    const worker = context.serviceWorkers()[0] || null;
    const installedPage = context.pages().find((candidate) => candidate.url().startsWith("chrome-extension://")) || null;
    const extensionUrl = worker?.url() || installedPage?.url() || "";
    if (!extensionUrl) throw new Error("Unpacked extension did not load");
    const extensionId = new URL(extensionUrl).host;
    const page = await context.newPage();
    function captureConsole(message) {
      if (message.type() !== "error") return;
      const text = message.text();
      if (/503 \(Service Unavailable\)/.test(text)) expectedNetworkErrors.push(text);
      else browserErrors.push(`console: ${text}`);
    }
    for (const candidate of [page]) {
      candidate.on("console", captureConsole);
      candidate.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));
    }

    await page.goto(`chrome-extension://${extensionId}/extension/editor.html`);
    await page.evaluate(({ key, state }) => new Promise((resolve) => chrome.storage.local.set({ [key]: state }, resolve)), {
      key: Storage.STORAGE_KEY,
      state: fixtureState(),
    });

    await page.goto(`chrome-extension://${extensionId}/extension/draft.html?draft_id=live-one-qb`);
    await waitForRuntime(page);
    await page.waitForFunction(() => document.querySelector("#sync-status")?.textContent.startsWith("Live / 4"));
    assert.equal(await page.locator("#signal-pick").textContent(), "2.01");
    assert.match(await page.locator("#signal-build").textContent(), /One QB/);
    assert.equal(await page.locator('[data-player-action="record"]:visible').count(), 0);
    assert.notEqual(await page.locator(".recommendation-card").first().locator(".position-badge").textContent(), "QB");
    await assertNoPageOverflow(page, "one-QB live desktop");
    await page.screenshot({ path: path.join(OUTPUT, "01-one-qb-live-shortlist.png"), fullPage: false });

    await page.click('[data-runtime-tab="room"]');
    assert.equal(await page.locator("#recent-picks .recent-pick").count(), 4);
    await page.screenshot({ path: path.join(OUTPUT, "02-one-qb-room-intelligence.png"), fullPage: false });

    await page.click("#manual-mode");
    await page.waitForFunction(() => document.body.classList.contains("manual-mode"));
    await page.click('[data-runtime-tab="manual"]');
    await page.fill("#manual-player-search", "One Player 005");
    await page.locator("#manual-player-search").press("Enter");
    await page.waitForFunction(() => document.querySelector("#signal-pick")?.textContent === "2.02");
    assert.equal(await page.locator("#manual-history .recent-pick").count(), 1);

    await page.reload();
    await waitForRuntime(page);
    assert.equal(await page.locator("#signal-pick").textContent(), "2.02");
    assert.equal(await page.locator("#manual-history .recent-pick").count(), 1);
    await page.click("#undo-manual");
    await page.waitForFunction(() => document.querySelector("#signal-pick")?.textContent === "2.01");
    await page.fill("#manual-player-search", "One Player 005");
    await page.locator("#manual-player-search").press("Enter");
    await page.waitForFunction(() => document.querySelector("#signal-pick")?.textContent === "2.02");

    oneQbPicks = [...oneQbPicks, pickFixture(5, "one_qb", 6)];
    await page.click("#live-mode");
    await page.waitForFunction(() => !document.body.classList.contains("manual-mode") && document.querySelector("#sync-status")?.textContent.startsWith("Live / 5"));
    assert.equal(await page.locator("#signal-pick").textContent(), "2.02");
    await page.click('[data-runtime-tab="board"]');
    await page.fill("#board-search", "One Player 005");
    assert.equal(await page.locator("#draft-board-rows .draft-board-row").count(), 1);
    assert.match(await page.locator("#draft-board-rows .draft-player-name strong").textContent(), /005/);

    apiOffline = true;
    await page.click("#refresh-room");
    await page.waitForFunction(() => document.querySelector("#sync-status")?.textContent === "Offline / cached picks");
    assert.equal(await page.locator("#signal-pick").textContent(), "2.02");
    apiOffline = false;
    await page.click("#refresh-room");
    await page.waitForFunction(() => document.querySelector("#sync-status")?.textContent.startsWith("Live / 5"));

    oneQbPicks = completePicks("one_qb", true);
    await page.waitForFunction(() => document.querySelector("#signal-pick")?.textContent === "COMPLETE", null, { timeout: 5000 });
    assert.match(await page.locator("#decision-label").textContent(), /complete/i);

    await selectActiveProfile(page, "superflex-profile");
    const sfPage = await context.newPage();
    sfPage.on("console", captureConsole);
    sfPage.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));
    await sfPage.goto(`chrome-extension://${extensionId}/extension/draft.html?draft_id=live-superflex`);
    await waitForRuntime(sfPage);
    await sfPage.waitForFunction(() => document.querySelector("#sync-status")?.textContent.startsWith("Live / 4"));
    assert.match(await sfPage.locator("#signal-build").textContent(), /Superflex/);
    assert.equal(await sfPage.locator(".recommendation-card").first().locator(".position-badge").textContent(), "QB");
    assert.match(await sfPage.locator("#room-meta").textContent(), /3RR at round 3/);
    await sfPage.setViewportSize({ width: 390, height: 844 });
    const liveMobile = await assertNoPageOverflow(sfPage, "superflex live mobile");
    await sfPage.screenshot({ path: path.join(OUTPUT, "03-superflex-live-mobile.png"), fullPage: false });
    superflexPicks = completePicks("superflex");
    await sfPage.waitForFunction(() => document.querySelector("#signal-pick")?.textContent === "COMPLETE", null, { timeout: 5000 });

    const manualOne = await context.newPage();
    manualOne.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));
    await createManualRoom(manualOne, extensionId, {
      profileId: "one_qb-profile", name: "One QB Manual Fixture", format: "one_qb",
    });
    await recordManualBoard(manualOne, ["One Player 001", "One Player 002", "One Player 003", "One Player 004"]);
    assert.equal(await manualOne.locator("#signal-pick").textContent(), "COMPLETE");
    await manualOne.reload();
    await waitForRuntime(manualOne);
    assert.equal(await manualOne.locator("#signal-pick").textContent(), "COMPLETE");
    await manualOne.click("#undo-manual");
    await manualOne.waitForFunction(() => document.querySelector("#signal-pick")?.textContent === "2.02");
    await manualOne.fill("#manual-player-search", "One Player 004");
    await manualOne.locator("#manual-player-search").press("Enter");
    await manualOne.waitForFunction(() => document.querySelector("#signal-pick")?.textContent === "COMPLETE");
    await manualOne.screenshot({ path: path.join(OUTPUT, "04-one-qb-manual-complete.png"), fullPage: false });

    const manualSf = await context.newPage();
    manualSf.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));
    await createManualRoom(manualSf, extensionId, {
      profileId: "superflex-profile", name: "Superflex Manual Fixture", format: "superflex",
    });
    await recordManualBoard(manualSf, ["Flex Player 001", "Flex Player 002", "Flex Player 003", "Flex Player 004"]);
    assert.equal(await manualSf.locator("#signal-pick").textContent(), "COMPLETE");
    await manualSf.setViewportSize({ width: 390, height: 844 });
    const manualMobile = await assertNoPageOverflow(manualSf, "superflex manual mobile");
    await manualSf.screenshot({ path: path.join(OUTPUT, "05-superflex-manual-mobile.png"), fullPage: false });

    const sleeperPage = await context.newPage();
    await sleeperPage.goto("https://sleeper.com/draft/nfl/live-one-qb");
    await sleeperPage.locator("#sdcc-draft-launcher").waitFor({ state: "visible" });
    const openedPromise = context.waitForEvent("page");
    await sleeperPage.click("#sdcc-draft-launcher");
    const launchedPage = await openedPromise;
    await launchedPage.waitForLoadState("domcontentloaded");
    assert.match(launchedPage.url(), new RegExp(`^chrome-extension://${extensionId}/extension/draft\\.html\\?draft_id=live-one-qb`));

    assert.ok(expectedNetworkErrors.length >= 1, "the deliberate Sleeper outage must reach Chromium");
    assert.deepEqual(browserErrors, []);
    const result = {
      extension_id_present: Boolean(extensionId),
      complete_drafts: ["one_qb_live", "superflex_live", "one_qb_manual", "superflex_manual"],
      manual_reload_and_undo: true,
      live_over_manual_precedence: true,
      api_outage_cached_recovery: true,
      superflex_qb_priority: true,
      third_round_reversal: true,
      sleeper_launcher: true,
      expected_dependency_errors: expectedNetworkErrors.length,
      live_mobile: liveMobile,
      manual_mobile: manualMobile,
      screenshots: fs.readdirSync(OUTPUT).sort(),
      browser_errors: browserErrors,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
