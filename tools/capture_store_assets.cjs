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
const OUTPUT = path.join(ROOT, "store-assets");
const USER_ID = "store-demo-user";
const DRAFT_ID = "store-demo-draft";
const LEAGUE_ID = "store-demo-league";
const USERNAME = "draftpilot";
const TEAMS = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE",
  "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
  "LV", "LAC", "LAR", "MIA", "MIN", "NE", "NO", "NYG",
  "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS",
];
const FIRST_NAMES = [
  "Ari", "Blake", "Cameron", "Drew", "Eli", "Finn", "Grant", "Hayes",
  "Isaac", "Jalen", "Kai", "Luca", "Micah", "Nico", "Owen", "Parker",
];
const LAST_NAMES = [
  "Mercer", "Sutton", "Reed", "Barrett", "Stone", "Ellis", "Hayes", "Monroe",
  "West", "Bennett", "Pierce", "Vaughn", "Brooks", "Foster", "Cole", "Rhodes",
];
const POSITIONS = ["WR", "RB", "WR", "RB", "QB", "TE", "WR", "RB", "WR", "TE", "QB", "WR"];

function player(index) {
  const firstName = FIRST_NAMES[(index - 1) % FIRST_NAMES.length];
  const lastName = LAST_NAMES[Math.floor((index - 1) / FIRST_NAMES.length)];
  const position = POSITIONS[(index - 1) % POSITIONS.length];
  const team = TEAMS[(index * 7) % TEAMS.length];
  const playerId = `demo-player-${String(index).padStart(3, "0")}`;
  return {
    player_id: playerId,
    first_name: firstName,
    last_name: lastName,
    full_name: `${firstName} ${lastName}`,
    search_full_name: `${firstName}${lastName}`.toLowerCase(),
    position,
    fantasy_positions: [position],
    team,
    search_rank: index,
    active: true,
  };
}

function catalogFixture() {
  return Object.fromEntries(
    Array.from({ length: 256 }, (_value, index) => {
      const current = player(index + 1);
      return [current.player_id, current];
    }),
  );
}

function projectionFixture() {
  return Array.from({ length: 256 }, (_value, index) => ({
    player_id: player(index + 1).player_id,
    last_modified: Date.UTC(2026, 7, 29, 16, 0, 0),
    stats: {
      adp_half_ppr: index + 1.4,
      adp_ppr: index + 1.7,
      adp_std: index + 1.1,
      adp_2qb: player(index + 1).position === "QB" ? Math.max(1, (index + 1) / 3) : index + 13,
    },
  }));
}

function draftFixture() {
  return {
    draft_id: DRAFT_ID,
    league_id: LEAGUE_ID,
    type: "snake",
    status: "drafting",
    settings: { teams: 12, rounds: 16, pick_timer: 90, reversal_round: 0 },
    draft_order: Object.fromEntries(
      Array.from({ length: 12 }, (_value, index) => [index === 6 ? USER_ID : `demo-owner-${index + 1}`, index + 1]),
    ),
    slot_to_roster_id: Object.fromEntries(Array.from({ length: 12 }, (_value, index) => [index + 1, 501 + index])),
    metadata: { name: "Saturday Night Draft", scoring_type: "half_ppr" },
  };
}

function leagueFixture() {
  return {
    league_id: LEAGUE_ID,
    name: "Saturday Night Draft",
    total_rosters: 12,
    roster_positions: ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN", "BN", "BN", "BN", "BN"],
    scoring_settings: { rec: 0.5, pass_td: 4 },
  };
}

function pickFixture(pickNumber) {
  const selected = player(pickNumber);
  const draftSlot = DraftOrder.slotForPickNumber(pickNumber, 12, 0);
  return {
    pick_no: pickNumber,
    draft_slot: draftSlot,
    roster_id: 500 + draftSlot,
    picked_by: draftSlot === 7 ? USER_ID : `demo-owner-${draftSlot}`,
    player_id: selected.player_id,
    metadata: {
      first_name: selected.first_name,
      last_name: selected.last_name,
      position: selected.position,
      team: selected.team,
      player_id: selected.player_id,
    },
  };
}

function dimensions(filePath) {
  const bytes = fs.readFileSync(filePath);
  assert.equal(bytes.toString("ascii", 1, 4), "PNG", `${filePath} must be a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function extensionIdFor(context) {
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const worker = context.serviceWorkers()[0] || null;
  const installedPage = context.pages().find((candidate) => candidate.url().startsWith("chrome-extension://")) || null;
  const extensionUrl = worker?.url() || installedPage?.url() || "";
  if (!extensionUrl) throw new Error("Unpacked extension did not load");
  return new URL(extensionUrl).host;
}

function listenForErrors(page, errors) {
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
}

async function capturePromo(context) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 440, height: 280 });
  const icon = fs.readFileSync(path.join(ROOT, "assets", "brand", "icon-master.png")).toString("base64");
  await page.setContent(`<!doctype html>
    <html><head><style>
      * { box-sizing: border-box; }
      html, body { width: 440px; height: 280px; margin: 0; overflow: hidden; }
      body { background: #071012; color: #f4f7f7; font-family: Arial, Helvetica, sans-serif; }
      main { position: relative; display: grid; grid-template-columns: 118px 1fr; align-items: center; width: 100%; height: 100%; padding: 30px; border: 2px solid #1f3539; }
      main::before { content: ""; position: absolute; inset: 0 0 auto; height: 7px; background: #5ff7da; }
      img { width: 100px; height: 100px; border-radius: 22px; }
      .copy { padding-left: 22px; }
      .eyebrow { color: #5ff7da; font: 700 11px/1.2 monospace; text-transform: uppercase; }
      h1 { margin: 9px 0 10px; font-size: 27px; line-height: 1.03; letter-spacing: 0; }
      p { margin: 0; max-width: 235px; color: #a8b8bb; font-size: 14px; line-height: 1.42; }
      .signal { display: flex; gap: 6px; margin-top: 17px; }
      .signal span { display: block; height: 5px; background: #5ff7da; }
      .signal span:nth-child(1) { width: 52px; }
      .signal span:nth-child(2) { width: 30px; background: #ffbd59; }
      .signal span:nth-child(3) { width: 70px; }
    </style></head><body><main>
      <img alt="" src="data:image/png;base64,${icon}">
      <div class="copy">
        <div class="eyebrow">Your board. Your call.</div>
        <h1>Sleeper Draft<br>Command Center</h1>
        <p>Personal rankings with live, read-only draft context.</p>
        <div class="signal"><span></span><span></span><span></span></div>
      </div>
    </main></body></html>`);
  await page.screenshot({ path: path.join(OUTPUT, "promo-small-440x280.png") });
  await page.close();
}

async function run() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdcc-store-assets-"));
  const errors = [];
  const catalog = catalogFixture();
  const projections = projectionFixture();
  const picks = Array.from({ length: 13 }, (_value, index) => pickFixture(index + 1));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: process.env.SDCC_HEADED !== "1",
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
  });

  try {
    await context.route("https://api.sleeper.app/**", async (route) => {
      assert.equal(route.request().method(), "GET");
      const pathname = new URL(route.request().url()).pathname;
      let body;
      if (pathname === "/v1/state/nfl") body = { season: "2026", league_season: "2026", previous_season: "2025", season_type: "regular" };
      else if (pathname === `/v1/user/${USERNAME}`) body = { user_id: USER_ID, username: USERNAME, display_name: "Draft Pilot" };
      else if (pathname === `/v1/user/${USER_ID}/leagues/nfl/2026`) body = [leagueFixture()];
      else if (pathname === `/v1/user/${USER_ID}/drafts/nfl/2026`) body = [draftFixture()];
      else if (pathname === "/v1/players/nfl") body = catalog;
      else if (pathname === `/v1/draft/${DRAFT_ID}`) body = draftFixture();
      else if (pathname === `/v1/draft/${DRAFT_ID}/picks`) body = picks;
      else if (pathname === `/v1/league/${LEAGUE_ID}`) body = leagueFixture();
      else if (pathname === `/v1/league/${LEAGUE_ID}/rosters`) {
        body = Array.from({ length: 12 }, (_value, index) => ({ roster_id: 501 + index, owner_id: index === 6 ? USER_ID : `demo-owner-${index + 1}` }));
      } else {
        await route.fulfill({ status: 404, contentType: "application/json", body: "null" });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await context.route("https://api.sleeper.com/**", async (route) => {
      assert.equal(route.request().method(), "GET");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(projections) });
    });

    const extensionId = await extensionIdFor(context);
    const page = await context.newPage();
    listenForErrors(page, errors);
    await page.goto(`chrome-extension://${extensionId}/extension/setup.html`);
    await page.fill("#username", USERNAME);
    await page.click('#identity-form button[type="submit"]');
    await page.waitForFunction(() => document.querySelector("#identity-drafts")?.textContent === "1");
    await page.click('[data-next-step="board"]');
    await page.fill("#profile-name-input", "Sunday League Board");
    await page.click('[data-source="paste"]');
    const rankedList = Array.from({ length: 250 }, (_value, index) => {
      const current = player(index + 1);
      return `${current.full_name} | ${current.position} | ${current.team}`;
    }).join("\n");
    await page.fill("#paste-rankings", rankedList);
    await page.click("#parse-paste");
    await page.locator('[data-step-panel="review"]').waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelector("#count-matched")?.textContent === "250");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(OUTPUT, "01-import-review-1280x800.png") });

    await page.click("#save-profile");
    await page.locator('[data-step-panel="ready"]').waitFor({ state: "visible" });
    await page.evaluate(({ key }) => new Promise((resolve) => {
      chrome.storage.local.get([key], (values) => {
        const state = values[key];
        const profile = state.ranking_profiles.find((candidate) => candidate.id === state.settings.active_ranking_profile_id);
        profile.players = profile.players.map((current, index) => ({
          ...current,
          adp: index + 1.4,
          tier: Math.ceil((index + 1) / 12),
          notes: index === 5 ? "Priority target" : index === 31 ? "Stack partner" : index === 87 ? "Late value" : "",
        }));
        chrome.storage.local.set({ [key]: state }, resolve);
      });
    }), { key: Storage.STORAGE_KEY });

    await page.goto(`chrome-extension://${extensionId}/extension/editor.html`);
    await page.waitForFunction(() => document.querySelectorAll(".ranking-row").length === 250);
    await page.screenshot({ path: path.join(OUTPUT, "02-ranking-editor-1280x800.png") });

    await page.goto(`chrome-extension://${extensionId}/extension/draft.html?draft_id=${DRAFT_ID}`);
    await page.waitForFunction(() => document.querySelector("#runtime-content")?.hidden === false);
    await page.waitForFunction(() => document.querySelector("#sync-status")?.textContent.startsWith("Live / 13"));
    await page.screenshot({ path: path.join(OUTPUT, "03-live-draft-1280x800.png") });
    await capturePromo(context);

    const expectedDimensions = {
      "01-import-review-1280x800.png": { width: 1280, height: 800 },
      "02-ranking-editor-1280x800.png": { width: 1280, height: 800 },
      "03-live-draft-1280x800.png": { width: 1280, height: 800 },
      "promo-small-440x280.png": { width: 440, height: 280 },
    };
    for (const [name, expected] of Object.entries(expectedDimensions)) {
      assert.deepEqual(dimensions(path.join(OUTPUT, name)), expected, `${name} has the wrong dimensions`);
    }
    assert.deepEqual(errors, []);
    process.stdout.write(`${JSON.stringify({ assets: expectedDimensions, fictional_data_only: true, browser_errors: errors }, null, 2)}\n`);
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
