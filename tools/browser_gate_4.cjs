#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const Storage = require("../src/storage.js");
const Profiles = require("../src/profile-manager.js");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.resolve(ROOT, "..", "exports", "sleeper-draft-command-center-qa", "gate-4");

function playerFixture(index, reverseAdp = false) {
  const positions = ["QB", "RB", "WR", "TE", "WR", "RB"];
  const padded = String(index).padStart(3, "0");
  return {
    rank: index,
    player: `Board Player ${padded}`,
    position: positions[(index - 1) % positions.length],
    team: `T${String(((index - 1) % 32) + 1).padStart(2, "0")}`,
    sleeper_id: `board-player-${padded}`,
    adp: reverseAdp ? 251 - index + 0.2 : index + 0.2,
    tier: Math.ceil(index / 12),
    notes: index === 137 ? "Late target" : "",
  };
}

function profilePlayers(reverse = false) {
  const players = Array.from({ length: 250 }, (_value, index) => playerFixture(index + 1, reverse));
  if (!reverse) return players;
  return players.reverse().map((player, index) => ({ ...player, rank: index + 1 }));
}

function fixtureState() {
  let state = Storage.createDefaultState();
  state = Profiles.addProfile(state, {
    id: "alpha-rankings",
    name: "Alpha Rankings",
    format: "one_qb",
    source: "manual",
    players: profilePlayers(false),
    now: "2026-08-29T20:00:00.000Z",
  });
  state = Profiles.addProfile(state, {
    id: "beta-rankings",
    name: "Beta Rankings",
    format: "superflex",
    source: "manual",
    players: profilePlayers(true),
    now: "2026-08-29T20:05:00.000Z",
  });
  return Profiles.setActiveProfile(state, "alpha-rankings");
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

async function rowIds(page, count = 8) {
  return page.locator(".ranking-row").evaluateAll((rows, maximum) => (
    rows.slice(0, maximum).map((row) => row.dataset.playerId)
  ), count);
}

async function waitForSaved(page) {
  await page.waitForFunction(() => document.querySelector("#save-state")?.textContent === "Saved in this browser");
}

async function confirmDelete(page) {
  await page.click("#delete-profile");
  await page.locator("#delete-dialog").waitFor({ state: "visible" });
  await page.click('#delete-form button[value="delete"]');
  await page.locator("#delete-dialog").waitFor({ state: "hidden" });
}

async function run() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdcc-gate4-"));
  const downloadPath = path.join(userDataDir, "exported-ranking-pack.json");
  const browserErrors = [];
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: process.env.SDCC_HEADED !== "1",
    viewport: { width: 1366, height: 900 },
    acceptDownloads: true,
    args: [
      `--disable-extensions-except=${ROOT}`,
      `--load-extension=${ROOT}`,
    ],
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const worker = context.serviceWorkers()[0] || null;
    const installedPage = context.pages().find((candidate) => candidate.url().startsWith("chrome-extension://")) || null;
    const extensionUrl = worker?.url() || installedPage?.url() || "";
    if (!extensionUrl) throw new Error("Unpacked extension did not load");
    const extensionId = new URL(extensionUrl).host;
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));

    await page.goto(`chrome-extension://${extensionId}/extension/editor.html`);
    await page.evaluate(({ key, state }) => new Promise((resolve) => {
      chrome.storage.local.set({ [key]: state }, resolve);
    }), { key: Storage.STORAGE_KEY, state: fixtureState() });
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll(".ranking-row").length === 250);

    assert.equal(await page.locator("#profile-select option").count(), 2);
    assert.equal(await page.locator("#profile-count").textContent(), "250");
    assert.deepEqual(await rowIds(page, 4), [
      "board-player-001", "board-player-002", "board-player-003", "board-player-004",
    ]);
    await assertNoPageOverflow(page, "desktop initial");
    await page.screenshot({ path: path.join(OUTPUT, "01-ranking-editor-desktop.png"), fullPage: false });

    await page.fill("#player-search", "Late target");
    assert.equal(await page.locator(".ranking-row").count(), 1);
    assert.equal(await page.locator(".ranking-row").first().getAttribute("data-player-id"), "board-player-137");
    await page.fill("#player-search", "");
    await page.click('[data-position="QB"]');
    assert.equal(await page.locator(".ranking-row").count(), 42);
    await page.click('[data-position="ALL"]');
    assert.equal(await page.locator(".ranking-row").count(), 250);

    const dragSourceLocator = page.locator('[data-player-id="board-player-006"] .drag-handle');
    await dragSourceLocator.scrollIntoViewIfNeeded();
    const dragSource = await dragSourceLocator.boundingBox();
    const dragTarget = await page.locator('[data-player-id="board-player-003"]').boundingBox();
    assert.ok(dragSource && dragTarget, "drag source and target must be visible");
    await page.mouse.move(dragSource.x + dragSource.width / 2, dragSource.y + dragSource.height / 2);
    await page.mouse.down();
    await page.mouse.move(dragTarget.x + dragTarget.width / 2, dragTarget.y + dragTarget.height / 2, { steps: 8 });
    await page.mouse.up();
    assert.deepEqual(await rowIds(page, 5), [
      "board-player-001", "board-player-002", "board-player-006", "board-player-003", "board-player-004",
    ]);

    await page.locator('[data-player-id="board-player-001"] .drag-handle').focus();
    await page.keyboard.press("Alt+ArrowDown");
    assert.deepEqual(await rowIds(page, 4), [
      "board-player-002", "board-player-001", "board-player-006", "board-player-003",
    ]);

    const rankFive = page.locator('[data-player-id="board-player-005"] .rank-input');
    await rankFive.fill("2");
    await rankFive.press("Enter");
    await rankFive.evaluate((input) => input.blur());
    assert.deepEqual(await rowIds(page, 5), [
      "board-player-002", "board-player-005", "board-player-001", "board-player-006", "board-player-003",
    ]);

    const editedRow = page.locator('[data-player-id="board-player-005"]');
    await editedRow.locator(".adp-input").fill("4.4");
    await editedRow.locator(".adp-input").press("Tab");
    await page.locator('[data-player-id="board-player-005"] .tier-input').fill("9");
    await page.locator('[data-player-id="board-player-005"] .tier-input').press("Tab");
    await page.locator('[data-player-id="board-player-005"] .notes-input').fill("Priority stack partner");
    await page.locator('[data-player-id="board-player-005"] .notes-input').press("Tab");
    assert.equal(await page.locator("#undo-ranking").isEnabled(), true);
    await page.click("#undo-ranking");
    assert.equal(await page.locator('[data-player-id="board-player-005"] .notes-input').inputValue(), "");
    await page.click("#redo-ranking");
    assert.equal(await page.locator('[data-player-id="board-player-005"] .notes-input').inputValue(), "Priority stack partner");
    await waitForSaved(page);

    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll(".ranking-row").length === 250);
    assert.deepEqual(await rowIds(page, 5), [
      "board-player-002", "board-player-005", "board-player-001", "board-player-006", "board-player-003",
    ]);
    assert.equal(await page.locator('[data-player-id="board-player-005"] .tier-input').inputValue(), "9");
    assert.equal(await page.locator('[data-player-id="board-player-005"] .notes-input').inputValue(), "Priority stack partner");

    await page.selectOption("#profile-select", "beta-rankings");
    await page.waitForFunction(() => document.querySelector("#profile-select").value === "beta-rankings");
    assert.equal((await rowIds(page, 1))[0], "board-player-250");
    assert.equal(await page.locator('[data-player-id="board-player-005"] .notes-input').inputValue(), "");
    await page.selectOption("#profile-select", "alpha-rankings");
    await page.waitForFunction(() => document.querySelector("#profile-select").value === "alpha-rankings");
    assert.deepEqual(await rowIds(page, 2), ["board-player-002", "board-player-005"]);

    await page.click("#clone-profile");
    await page.waitForFunction(() => document.querySelectorAll("#profile-select option").length === 3);
    assert.match(await page.locator("#profile-select option:checked").textContent(), /Alpha Rankings copy/);
    await page.click("#rename-profile");
    await page.fill("#profile-name-field", "Alpha Working Copy");
    await page.click('#profile-form button[value="save"]');
    await page.locator("#profile-dialog").waitFor({ state: "hidden" });
    assert.match(await page.locator("#profile-select option:checked").textContent(), /Alpha Working Copy/);

    await page.click("#new-profile");
    await page.fill("#profile-name-field", "Empty Superflex");
    await page.selectOption("#profile-format-field", "superflex");
    await page.click('#profile-form button[value="save"]');
    await page.locator("#profile-dialog").waitFor({ state: "hidden" });
    assert.equal(await page.locator("#profile-select option").count(), 4);
    assert.equal(await page.locator(".ranking-row").count(), 0);
    assert.equal(await page.locator("#export-profile").isDisabled(), true);
    await confirmDelete(page);
    assert.equal(await page.locator("#profile-select option").count(), 3);

    await page.selectOption("#profile-select", "alpha-rankings");
    await page.waitForFunction(() => document.querySelector("#profile-select").value === "alpha-rankings"
      && document.querySelectorAll(".ranking-row").length === 250
      && document.querySelector(".ranking-row")?.dataset.playerId === "board-player-002");
    const downloadPromise = page.waitForEvent("download");
    await page.click("#export-profile");
    const download = await downloadPromise;
    await download.saveAs(downloadPath);
    const exportedPack = JSON.parse(fs.readFileSync(downloadPath, "utf8"));
    assert.deepEqual(Object.keys(exportedPack).sort(), ["format", "name", "players", "schema_version"]);
    assert.equal(exportedPack.players.length, 250);
    assert.equal(exportedPack.players[1].sleeper_id, "board-player-005");
    assert.equal(exportedPack.players[1].notes, "Priority stack partner");

    await confirmDelete(page);
    assert.equal(await page.locator("#profile-select option").count(), 2);
    await page.setInputFiles("#import-file", {
      name: "alpha-rankings.ranking-pack.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(exportedPack)),
    });
    await page.waitForFunction(() => document.querySelectorAll("#profile-select option").length === 3);
    assert.equal(await page.locator("#profile-select option:checked").textContent(), "Alpha Rankings | 250");
    const reimportedPack = await page.evaluate((key) => new Promise((resolve) => {
      chrome.storage.local.get([key], (values) => {
        const state = values[key];
        const id = state.settings.active_ranking_profile_id;
        const profile = state.ranking_profiles.find((candidate) => candidate.id === id);
        resolve({ schema_version: 1, name: profile.name, format: profile.format, players: profile.players });
      });
    }), Storage.STORAGE_KEY);
    assert.deepEqual(reimportedPack, exportedPack);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    const mobileMetrics = await assertNoPageOverflow(page, "mobile editor");
    assert.equal(await page.locator(".ranking-row").count(), 250);
    assert.equal(await page.locator(".ranking-row").first().locator(".more-button").isVisible(), true);
    await page.locator(".ranking-row").first().locator(".more-button").click();
    await page.locator("#player-dialog").waitFor({ state: "visible" });
    await page.fill("#player-tier-field", "7");
    await page.click('#player-form button[value="save"]');
    await page.locator("#player-dialog").waitFor({ state: "hidden" });
    await waitForSaved(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(OUTPUT, "02-ranking-editor-mobile.png"), fullPage: false });

    assert.deepEqual(browserErrors, []);
    const result = {
      extension_id_present: Boolean(extensionId),
      desktop_profile_players: 250,
      search_and_position_filters: true,
      reorder_paths: ["drag", "keyboard", "rank_input"],
      undo_redo: true,
      autosave_reload: true,
      isolated_profiles: true,
      profile_lifecycle: ["create", "clone", "rename", "delete", "import", "export"],
      export_reimport_identical: true,
      mobile: mobileMetrics,
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
