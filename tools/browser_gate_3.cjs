#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.resolve(ROOT, "..", "exports", "sleeper-draft-command-center-qa", "gate-3");

function playerFixture(index) {
  const positions = ["RB", "WR", "QB", "TE", "K", "DEF"];
  const position = positions[(index - 1) % positions.length];
  const team = `T${String(((index - 1) % 32) + 1).padStart(2, "0")}`;
  return {
    player_id: `fixture-${String(index).padStart(3, "0")}`,
    first_name: "Fixture",
    last_name: `Player ${String(index).padStart(3, "0")}`,
    full_name: `Fixture Player ${String(index).padStart(3, "0")}`,
    search_full_name: `fixtureplayer${String(index).padStart(3, "0")}`,
    position,
    fantasy_positions: [position],
    team,
    search_rank: index,
    active: true,
  };
}

function fixtures() {
  const catalog = {};
  const projections = [];
  for (let index = 1; index <= 320; index += 1) {
    const player = playerFixture(index);
    catalog[player.player_id] = player;
    projections.push({
      player_id: player.player_id,
      last_modified: Date.now() - 60 * 60 * 1000,
      stats: {
        adp_half_ppr: index,
        adp_ppr: index + 0.1,
        adp_std: index + 0.2,
        adp_2qb: player.position === "QB" ? Math.max(1, index / 3) : index + 12,
      },
    });
  }
  return { catalog, projections };
}

function textRows(start = 1, end = 250) {
  return Array.from({ length: end - start + 1 }, (_value, offset) => {
    const player = playerFixture(start + offset);
    return `${player.full_name} | ${player.position} | ${player.team}`;
  });
}

async function waitForStep(page, step) {
  await page.locator(`[data-step-panel="${step}"]`).waitFor({ state: "visible" });
}

async function openBoard(page, source, name) {
  await page.click('.stage-nav [data-step="board"]');
  await waitForStep(page, "board");
  await page.fill("#profile-name-input", name);
  await page.click(`[data-source="${source}"]`);
}

async function saveCurrentProfile(page, expectedPlayers = 250) {
  await waitForStep(page, "review");
  await page.waitForFunction((count) => Number(document.querySelector("#count-matched").textContent) === count, expectedPlayers);
  assert.equal(await page.locator("#count-needs-review").textContent(), "0");
  await page.click("#save-profile");
  await waitForStep(page, "ready");
  assert.equal(await page.locator("#ready-player-count").textContent(), String(expectedPlayers));
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

async function run() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdcc-gate3-"));
  const browserErrors = [];
  const { catalog, projections } = fixtures();
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: process.env.SDCC_HEADED !== "1",
    viewport: { width: 1366, height: 900 },
    args: [
      `--disable-extensions-except=${ROOT}`,
      `--load-extension=${ROOT}`,
    ],
  });

  try {
    await context.route("https://api.sleeper.app/**", async (route) => {
      const url = new URL(route.request().url());
      let body;
      if (url.pathname === "/v1/state/nfl") {
        body = { season: "2026", league_season: "2026", previous_season: "2025", season_type: "pre" };
      } else if (url.pathname === "/v1/user/fixturecoach") {
        body = { user_id: "fixture-user", username: "fixturecoach", display_name: "Fixture Coach" };
      } else if (url.pathname === "/v1/user/fixture-user/leagues/nfl/2026") {
        body = [{
          league_id: "fixture-league", name: "Fixture League", status: "pre_draft",
          roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN"],
        }];
      } else if (url.pathname === "/v1/user/fixture-user/drafts/nfl/2026") {
        body = [{
          draft_id: "fixture-draft", league_id: "fixture-league", status: "pre_draft",
          start_time: Date.now() + 86400000, settings: { teams: 12, rounds: 16 },
        }];
      } else if (url.pathname === "/v1/players/nfl") {
        body = catalog;
      } else {
        await route.fulfill({ status: 404, contentType: "application/json", body: "null" });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await context.route("https://api.sleeper.com/**", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(projections),
    }));

    await new Promise((resolve) => setTimeout(resolve, 1200));
    const worker = context.serviceWorkers()[0] || null;
    const installedPage = context.pages().find((candidate) => candidate.url().startsWith("chrome-extension://")) || null;
    const extensionUrl = worker?.url() || installedPage?.url() || "";
    if (!extensionUrl) {
      throw new Error(`Unpacked extension did not load. Open pages: ${context.pages().map((candidate) => candidate.url()).join(", ")}`);
    }
    const extensionId = new URL(extensionUrl).host;
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));
    await page.goto(`chrome-extension://${extensionId}/extension/setup.html`);

    await page.fill("#username", "fixturecoach");
    await page.click('#identity-form button[type="submit"]');
    await page.waitForFunction(() => document.querySelector("#identity-drafts").textContent === "1");
    assert.equal(await page.locator("#identity-name").textContent(), "Fixture Coach");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(OUTPUT, "01-identity-desktop.png") });

    await page.click('[data-next-step="board"]');
    await page.fill("#profile-name-input", "Public ADP fixture");
    await page.click("#build-public-board");
    await saveCurrentProfile(page);

    await openBoard(page, "paste", "Paste fixture");
    const pasted = ["Mystery Prospect | RB | T01", ...textRows(2, 250)].join("\n");
    await page.fill("#paste-rankings", pasted);
    await page.click("#parse-paste");
    await waitForStep(page, "review");
    await page.waitForFunction(() => document.querySelector("#count-needs-review").textContent === "1");
    await page.locator("#review-rows tr").first().locator("button").click();
    await page.fill("#resolver-search", "Fixture Player 001");
    await page.locator("#resolver-results .resolver-result").first().click();
    await saveCurrentProfile(page);

    await openBoard(page, "file", "CSV fixture");
    const csv = ["rank,player,position,team,sleeper_id", ...textRows().map((row, index) => {
      const player = playerFixture(index + 1);
      return `${index + 1},${player.full_name},${player.position},${player.team},${player.player_id}`;
    })].join("\n");
    await page.setInputFiles("#ranking-file", {
      name: "rankings-fixture.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
    });
    await page.click("#parse-file");
    await saveCurrentProfile(page);

    await openBoard(page, "file", "JSON fixture");
    const json = JSON.stringify({
      schema_version: 1,
      name: "JSON fixture",
      format: "one_qb",
      players: textRows().map((_row, index) => {
        const player = playerFixture(index + 1);
        return {
          rank: index + 1,
          player: player.full_name,
          position: player.position,
          team: player.team,
          sleeper_id: player.player_id,
          adp: index + 1,
        };
      }),
    });
    await page.setInputFiles("#ranking-file", {
      name: "rankings-fixture.json", mimeType: "application/json", buffer: Buffer.from(json),
    });
    await page.click("#parse-file");
    await waitForStep(page, "review");
    await page.waitForFunction(() => document.querySelector("#count-matched").textContent === "250");
    await page.screenshot({ path: path.join(OUTPUT, "02-review-desktop.png") });
    await saveCurrentProfile(page);

    assert.equal(await page.locator("#active-profile-select option").count(), 4);
    await page.selectOption("#draft-select", "fixture-draft");
    await page.waitForFunction(() => document.querySelector('[data-signal="room"]').classList.contains("ready"));
    await assertNoPageOverflow(page, "desktop ready");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(OUTPUT, "03-ready-desktop.png") });

    await page.reload();
    await page.click('.stage-nav [data-step="ready"]');
    await waitForStep(page, "ready");
    assert.equal(await page.locator("#active-profile-select option").count(), 4);
    assert.equal(await page.locator("#ready-player-count").textContent(), "250");
    assert.equal(await page.locator("#draft-select").inputValue(), "fixture-draft");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('.stage-nav [data-step="identity"]');
    await waitForStep(page, "identity");
    const mobileIdentity = await assertNoPageOverflow(page, "mobile identity");
    await page.screenshot({ path: path.join(OUTPUT, "04-identity-mobile.png") });
    await page.click('.stage-nav [data-step="board"]');
    await waitForStep(page, "board");
    const mobileBoard = await assertNoPageOverflow(page, "mobile board");
    const mobileSticky = await page.evaluate(() => ({
      scrollY: window.scrollY,
      topbarTop: Math.round(document.querySelector(".topbar").getBoundingClientRect().top),
      topbarBottom: Math.round(document.querySelector(".topbar").getBoundingClientRect().bottom),
      navTop: Math.round(document.querySelector(".stage-nav").getBoundingClientRect().top),
      navBottom: Math.round(document.querySelector(".stage-nav").getBoundingClientRect().bottom),
      topbarPosition: getComputedStyle(document.querySelector(".topbar")).position,
      navPosition: getComputedStyle(document.querySelector(".stage-nav")).position,
    }));
    await page.screenshot({ path: path.join(OUTPUT, "05-board-mobile.png") });

    assert.deepEqual(browserErrors, []);
    const result = {
      extension_id_present: Boolean(extensionId),
      profiles_created: 4,
      players_per_profile: 250,
      unmatched_repaired: 1,
      draft_persisted: true,
      mobile_identity: mobileIdentity,
      mobile_board: mobileBoard,
      mobile_sticky: mobileSticky,
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
