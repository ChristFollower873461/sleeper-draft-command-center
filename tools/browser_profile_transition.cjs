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
const OUTPUT = process.env.SDCC_TRANSITION_OUTPUT || null;

function fixtureState() {
  let state = Storage.createDefaultState();
  for (const id of ["alpha", "beta", "gamma"]) {
    state = Profiles.addProfile(state, {
      id, name: `Synthetic ${id}`, format: "one_qb", now: "2026-10-18T00:00:00.000Z",
      players: [1, 2].map((rank) => ({ rank, player: `Synthetic Player ${rank}`, position: "QB", team: "TST", sleeper_id: `synthetic-${rank}`, adp: rank, tier: 1, notes: `${id} original` })),
    });
  }
  return Profiles.setActiveProfile(state, "alpha");
}

async function run() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "sdcc-profile-transition-"));
  const results = [];
  const pageErrors = [];
  const externalRequests = [];
  let context;
  try {
    context = await chromium.launchPersistentContext(path.join(scratch, "browser"), {
      headless: true, channel: "chromium", viewport: { width: 1366, height: 900 },
      args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
    });
    await context.route(/^https?:/, (route) => {
      externalRequests.push(route.request().url());
      return route.abort();
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const base = `chrome-extension://${new URL(worker.url()).host}`;
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.setDefaultTimeout(5000);
    await page.goto(`${base}/extension/editor.html`);
    const state = fixtureState();
    const stored = () => page.evaluate((key) => new Promise((resolve) => chrome.storage.local.get([key], (values) => resolve(values[key]))), Storage.STORAGE_KEY);
    const note = () => page.locator('[data-player-id="synthetic-1"] .notes-input');
    const status = () => page.locator("#save-state").textContent();
    async function reset() {
      await page.evaluate(({ key, state }) => new Promise((resolve) => chrome.storage.local.set({ [key]: state }, resolve)), { key: Storage.STORAGE_KEY, state });
      await page.reload();
      await page.waitForFunction(() => document.querySelector("#save-state").textContent === "Saved in this browser" && document.querySelectorAll(".ranking-row").length === 2);
    }
    async function holdCommit() {
      await page.evaluate(() => {
        const original = SDCCStateClient.commitState;
        const gate = globalThis.transitionTest = { calls: 0, entered: false, failing: false };
        SDCCStateClient.commitState = async (...args) => {
          gate.calls++;
          if (gate.calls === 1) {
            gate.entered = true;
            await new Promise((resolve, reject) => { gate.release = resolve; gate.reject = () => { gate.failing = true; reject(new Error("Synthetic commit failure")); }; });
          }
          if (gate.failing) throw new Error("Synthetic commit failure");
          return original(...args);
        };
      });
    }
    async function waitHeld() { await page.waitForFunction(() => globalThis.transitionTest.entered); }
    async function assertLocked() {
      const locked = await page.evaluate(() => ({
        inert: document.querySelector(".editor-shell").inert,
        enabled: [...document.querySelectorAll(".editor-shell input, .editor-shell select, .editor-shell button, dialog input, dialog select, dialog textarea, dialog button")].filter((control) => !control.disabled).map((control) => control.id || control.className),
      }));
      assert.equal(locked.inert, true);
      assert.deepEqual(locked.enabled, []);
      assert.equal(await page.locator("#save-state").evaluate((el) => el.classList.contains("saving")), true);
    }
    async function assertUnlocked() {
      assert.equal(await page.locator("#profile-select").isEnabled(), true);
      assert.equal(await note().isEnabled(), true);
      assert.equal(await page.locator(".editor-shell").evaluate((el) => el.inert), false);
    }
    async function assertStoredNote(expected) {
      assert.equal((await stored()).ranking_profiles.find((p) => p.id === "alpha").players[0].notes, expected);
    }
    async function attemptOverlaps() {
      await page.evaluate(() => {
        const select = document.querySelector("#profile-select");
        select.value = "gamma";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        const input = document.querySelector(".notes-input");
        input.value = "synthetic blocked edit";
        input.dispatchEvent(new Event("change", { bubbles: true }));
        document.querySelector(".drag-handle").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }));
        for (const id of ["undo-ranking", "redo-ranking", "clone-profile", "new-profile", "rename-profile", "delete-profile", "export-profile"]) {
          document.getElementById(id).dispatchEvent(new Event("click", { bubbles: true }));
        }
        for (const [id, value] of [["profile-form", "save"], ["delete-form", "delete"], ["player-form", "save"]]) {
          const form = document.getElementById(id);
          form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: form.querySelector(`button[value="${value}"]`) }));
        }
        const files = new DataTransfer();
        files.items.add(new File(['{"schema_version":1}'], "synthetic-overlap.json", { type: "application/json" }));
        document.querySelector("#import-file").files = files.files;
        document.querySelector("#import-file").dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.waitForTimeout(30);
      assert.equal(await page.evaluate(() => transitionTest.calls), 1);
    }
    async function test(name, fn) {
      try { await reset(); await fn(); results.push({ name, passed: true }); }
      catch (error) { results.push({ name, passed: false, error: error.message }); }
    }

    await test("ordinary autosave and profile round-trip preserve the edit", async () => {
      await note().fill("synthetic saved note"); await note().press("Tab");
      await page.waitForFunction(() => document.querySelector("#save-state").textContent === "Saved in this browser");
      await assertStoredNote("synthetic saved note");
      await page.selectOption("#profile-select", "beta");
      await page.waitForFunction(() => document.querySelector("#save-state").textContent === "Profile loaded");
      await page.selectOption("#profile-select", "alpha");
      await page.waitForFunction(() => document.querySelector(".notes-input").value === "synthetic saved note");
      await assertUnlocked();
    });

    await test("pending profile commit prevents accepted edits and overlapping actions", async () => {
      await holdCommit();
      const handle = page.locator(".drag-handle").first();
      await handle.evaluate((element) => element.addEventListener("pointerdown", (event) => { globalThis.testPointerId = event.pointerId; }, { once: true }));
      const bounds = await handle.boundingBox();
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 + 15);
      assert.equal(await handle.evaluate((element) => element.hasPointerCapture(testPointerId)), true);
      await page.selectOption("#profile-select", "beta"); await waitHeld();
      const captureReleased = await handle.evaluate((element) => !element.hasPointerCapture(testPointerId));
      await page.mouse.up();
      // On the original source this is a real accepted edit, lost by loadEditor.
      const editable = await note().isEnabled();
      if (editable) { await note().fill("synthetic accepted during switch"); await note().press("Tab"); }
      const lock = page.locator(".editor-shell").evaluate((el) => el.inert);
      if (!editable) await assertLocked();
      if (OUTPUT) await page.screenshot({ path: path.join(OUTPUT, "pending-profile-transition.png") });
      if (!editable) await attemptOverlaps();
      await page.evaluate(() => transitionTest.release());
      await page.waitForFunction(() => document.querySelector("#save-state").textContent === "Profile loaded");
      await page.waitForTimeout(550);
      await assertStoredNote(editable ? "synthetic accepted during switch" : "alpha original");
      assert.equal(await lock, true);
      assert.equal(captureReleased, true);
      assert.equal(await page.locator(".dragging, .drop-target").count(), 0);
      assert.equal((await stored()).settings.active_ranking_profile_id, "beta");
      assert.equal((await stored()).ranking_profiles.length, 3);
      assert.equal(await page.evaluate(() => transitionTest.calls), 1);
      await assertUnlocked();
    });

    await test("already pending autosave failure retains draft and successful retry", async () => {
      await holdCommit();
      await note().fill("synthetic dirty draft"); await note().press("Tab"); await waitHeld();
      await page.selectOption("#profile-select", "beta"); await assertLocked();
      await page.evaluate(() => transitionTest.reject());
      await page.waitForFunction(() => document.querySelector("#save-state").classList.contains("error") && !document.querySelector(".editor-shell").inert);
      assert.match(await status(), /Finish saving/);
      assert.equal(await note().inputValue(), "synthetic dirty draft");
      await assertStoredNote("alpha original"); await assertUnlocked();
      await page.evaluate(() => { transitionTest.failing = false; });
      await page.selectOption("#profile-select", "beta");
      await page.waitForFunction(() => document.querySelector("#save-state").textContent === "Profile loaded");
      await assertStoredNote("synthetic dirty draft"); await assertUnlocked();
    });

    await test("active-profile commit failure restores original profile and retry", async () => {
      await holdCommit(); await page.selectOption("#profile-select", "beta"); await waitHeld(); await assertLocked();
      await page.evaluate(() => transitionTest.reject());
      await page.waitForFunction(() => document.querySelector("#save-state").textContent === "Synthetic commit failure");
      assert.equal(await page.locator("#profile-select").inputValue(), "alpha");
      await assertStoredNote("alpha original"); await assertUnlocked();
      await page.evaluate(() => { transitionTest.failing = false; });
      await page.selectOption("#profile-select", "beta");
      await page.waitForFunction(() => document.querySelector("#save-state").textContent === "Profile loaded");
      assert.equal((await stored()).settings.active_ranking_profile_id, "beta"); await assertUnlocked();
    });

    for (const fail of [false, true]) await test(`pending import text ${fail ? "failure restores controls" : "blocks edits until completion"}`, async () => {
      await page.evaluate(() => {
        const original = File.prototype.text;
        const gate = globalThis.transitionTest = { entered: false };
        File.prototype.text = async function () {
          gate.entered = true;
          await new Promise((resolve, reject) => { gate.release = resolve; gate.reject = () => reject(new Error("Synthetic file read failure")); });
          return original.call(this);
        };
      });
      const pack = Profiles.exportRankingPack(state, "beta");
      await page.setInputFiles("#import-file", { name: "synthetic-pack.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(pack)) });
      await waitHeld(); await assertLocked();
      await page.evaluate((fail) => fail ? transitionTest.reject() : transitionTest.release(), fail);
      await page.waitForFunction(() => !document.querySelector(".editor-shell").inert);
      assert.match(await status(), fail ? /Synthetic file read failure/ : /Imported 2 players/);
      assert.equal((await stored()).ranking_profiles.length, fail ? 3 : 4);
      await assertStoredNote("alpha original"); await assertUnlocked();
    });
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(externalRequests, []);
    const result = { results, passed: results.every((item) => item.passed), pageErrors, externalRequests, storage: "actual Chrome local storage in a newly-created disposable extension profile; synthetic data only", deferredBoundary: "wrapper around the real StateClient.commitState; successful releases still use real extension worker", source: ROOT };
    if (OUTPUT) fs.writeFileSync(path.join(OUTPUT, "browser-result.json"), `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
  } finally {
    if (context) await context.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
