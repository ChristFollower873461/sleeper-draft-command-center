const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Storage = require("../src/storage.js");
const Profiles = require("../src/profile-manager.js");
const Editor = require("../src/ranking-editor.js");
const StateMerge = require("../src/state-merge.js");

const clone = (value) => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(setImmediate);

// Only the DOM, timers and storage transport are synthetic. The complete editor
// script and its storage/profile/editor/merge modules execute unchanged.
class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.className = "";
    this.value = "";
    this.disabled = false;
    this.inert = false;
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      toggle: (name, force) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        const enabled = force ?? !names.has(name);
        if (enabled) names.add(name); else names.delete(name);
        this.className = [...names].join(" ");
        return enabled;
      },
      add: (...names) => names.forEach((name) => this.classList.toggle(name, true)),
      remove: (...names) => names.forEach((name) => this.classList.toggle(name, false)),
    };
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "class") this.className = String(value);
    if (name === "value") this.value = String(value);
    if (name.startsWith("data-")) this.dataset[this.dataKey(name)] = String(value);
  }
  dataKey(name) { return name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); }
  getAttribute(name) {
    if (name === "class") return this.className;
    if (name.startsWith("data-")) return this.dataset[this.dataKey(name)] ?? null;
    return this.attributes[name] ?? null;
  }
  append(...nodes) {
    for (const node of nodes) {
      if (node.tag === "fragment") this.append(...node.children);
      else { node.parentElement = this; this.children.push(node); }
    }
  }
  replaceChildren(...nodes) {
    for (const node of this.children) node.parentElement = null;
    this.children = [];
    this.append(...nodes);
  }
  set textContent(value) { this.replaceChildren(); this.text = String(value); }
  get textContent() { return (this.text || "") + this.children.map((node) => node.textContent).join(""); }
  matches(selector) {
    if (selector.startsWith("#")) return this.getAttribute("id") === selector.slice(1);
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    const attribute = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    if (attribute) {
      const actual = this.getAttribute(attribute[1]);
      return attribute[2] === undefined ? actual !== null : actual === attribute[2];
    }
    return this.tag === selector;
  }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
    return null;
  }
  querySelectorAll(selector) {
    const alternatives = selector.split(",").map((part) => part.trim().split(/\s+/));
    const matches = (node, parts) => {
      if (!node.matches(parts.at(-1))) return false;
      let ancestor = node.parentElement;
      for (let index = parts.length - 2; index >= 0; index--) {
        while (ancestor && !ancestor.matches(parts[index])) ancestor = ancestor.parentElement;
        if (!ancestor) return false;
        ancestor = ancestor.parentElement;
      }
      return true;
    };
    const result = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (alternatives.some((parts) => matches(child, parts))) result.push(child);
        visit(child);
      }
    };
    visit(this);
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  emit(type, properties = {}) {
    const event = { target: this, preventDefault() {}, ...properties };
    // Deliberately dispatch even to disabled controls: verify the source's
    // event guards as well as the separately asserted native control state.
    return Promise.all((this.listeners.get(type) || []).map((listener) => listener(event)));
  }
  focus() {}
  select() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
}

function documentFixture() {
  const document = new Element("document");
  const stack = [document];
  const html = fs.readFileSync(path.join(__dirname, "../extension/editor.html"), "utf8");
  for (const match of html.matchAll(/<(\/?)([a-z][a-z0-9-]*)([^>]*)>/gi)) {
    const [, closing, tag, attributes] = match;
    if (closing) { stack.pop(); continue; }
    const node = new Element(tag);
    for (const attribute of attributes.matchAll(/([\w-]+)(?:="([^"]*)"|='([^']*)'|=([^\s>]+))?/g)) {
      node.setAttribute(attribute[1], attribute[2] ?? attribute[3] ?? attribute[4] ?? "");
    }
    stack.at(-1).append(node);
    if (!["meta", "link", "input", "br", "hr", "img"].includes(tag)) stack.push(node);
  }
  document.createElement = (tag) => new Element(tag);
  document.createDocumentFragment = () => new Element("fragment");
  return document;
}

async function workspace() {
  let stored = Storage.createDefaultState();
  for (const id of ["alpha", "beta", "gamma"]) {
    stored = Profiles.addProfile(stored, {
      id, name: `Synthetic ${id}`, format: "one_qb", now: "2026-10-18T00:00:00Z",
      players: [{ rank: 1, player: "Synthetic Player", position: "QB", team: "TST",
        sleeper_id: "synthetic-player", adp: 1, tier: 1, notes: `${id} original` }],
    });
  }
  stored = Profiles.setActiveProfile(stored, "alpha");
  const document = documentFixture();
  const timers = new Map();
  const commits = [];
  let timerId = 0;
  const stateClient = {
    getState: async () => ({ state: clone(stored), warnings: [] }),
    commitState: (base, next) => new Promise((resolve, reject) => {
      const entry = { base: clone(base), next: clone(next), done: false };
      entry.succeed = () => {
        assert.equal(entry.done, false, "commit must settle only once");
        entry.done = true;
        stored = clone(StateMerge.mergeState(stored, entry.base, entry.next));
        resolve({ state: clone(stored), warnings: [] });
      };
      entry.fail = () => { entry.done = true; reject(new Error("Synthetic storage write failed")); };
      commits.push(entry);
    }),
  };
  const context = vm.createContext({
    SDCCStorage: Storage, SDCCProfileManager: Profiles, SDCCRankingEditor: Editor,
    SDCCStateClient: stateClient, document, window: new Element("window"),
    Option: function Option(text, value) {
      const option = new Element("option"); option.textContent = text; option.value = value; return option;
    },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension/editor.js"), "utf8"), context,
    { filename: "extension/editor.js" });
  await settle();
  const find = (selector) => {
    const element = document.querySelector(selector);
    assert.ok(element, `rendered element ${selector}`);
    return element;
  };
  assert.equal(find("#profile-select").value, "alpha", "complete editor initialization");
  assert.equal(commits.length, 0);
  return {
    find, commits,
    stored: () => clone(stored),
    note: () => find(".notes-input").value,
    select: (id) => { const select = find("#profile-select"); select.value = id; return select.emit("change"); },
    edit: async (notes) => {
      const target = find(".notes-input"); target.value = notes;
      await find("#ranking-rows").emit("change", { target });
    },
    autosave: async () => {
      for (const [id, timer] of [...timers]) {
        if (timer.delay === 500) { timers.delete(id); timer.callback(); }
      }
      await settle();
    },
    finish: async (index, success = true) => {
      assert.ok(commits[index], `commit ${index} started`);
      if (success) commits[index].succeed(); else commits[index].fail();
      await settle();
    },
  };
}

function storedNote(state, id = "alpha") {
  return state.ranking_profiles.find((profile) => profile.id === id).players[0].notes;
}

function assertAvailable(app) {
  assert.equal(app.find("#profile-select").disabled, false);
  assert.equal(app.find(".notes-input").disabled, false);
  assert.equal(app.find("#new-profile").disabled, false);
  assert.equal(app.find(".editor-shell").inert, false);
}

test("a pending profile commit rejects overlapping transitions and late editor events", async () => {
  const app = await workspace();
  const switching = app.select("beta");
  await settle();
  assert.equal(app.commits.length, 1);
  const disabled = app.find(".notes-input").disabled;
  await app.edit("must not enter the pending transition");
  const overlapping = app.select("gamma");
  await settle();
  await app.find("#new-profile").emit("click");
  // A buggy second transition is left deferred too; checking its admission
  // does not depend on a lucky order in which the transport completes writes.
  assert.equal(app.commits.length, 1, "only the first profile transition may commit");
  await overlapping;
  assert.notEqual(app.find("#profile-dialog").open, true, "no new profile dialog during switch");
  assert.equal(disabled, true);
  assert.equal(app.find(".editor-shell").inert, true);
  assert.equal(app.find(".editor-shell").getAttribute("aria-busy"), "true");
  await app.finish(0);
  await switching;
  assert.equal(app.find("#profile-select").value, "beta");
  assert.equal(app.note(), "beta original");
  assert.equal(storedNote(app.stored()), "alpha original");
  await app.autosave();
  assert.equal(app.commits.length, 1, "blocked edit must not schedule another save");
  assertAvailable(app);
});

test("a late editor event cannot enter undo history while a profile commit is pending", async () => {
  const app = await workspace();
  const switching = app.select("beta");
  await settle();
  await app.edit("blocked event must not become an undo snapshot");
  await app.finish(0, false);
  await switching;
  await app.edit("allowed edit after failure");
  await app.find("#undo-ranking").emit("click");
  assert.equal(app.note(), "alpha original", "undo must not reveal a draft admitted during the switch");
  await app.autosave();
  await app.finish(1);
  assert.equal(storedNote(app.stored()), "alpha original");
  assertAvailable(app);
});

test("a pre-switch edit is saved before committing the new active profile", async () => {
  const app = await workspace();
  await app.edit("keep this pre-switch draft");
  const switching = app.select("beta");
  await settle();
  assert.equal(app.commits.length, 1);
  assert.equal(app.commits[0].next.settings.active_ranking_profile_id, "alpha");
  assert.equal(storedNote(app.commits[0].next), "keep this pre-switch draft");
  await app.finish(0);
  assert.equal(app.commits.length, 2);
  assert.equal(app.commits[1].next.settings.active_ranking_profile_id, "beta");
  await app.finish(1);
  await switching;
  assert.equal(storedNote(app.stored()), "keep this pre-switch draft");
  assert.equal(app.note(), "beta original");
  assertAvailable(app);
});

test("failed pending autosaves retain the draft, unlock controls and allow an explicit retry", async () => {
  const app = await workspace();
  await app.edit("keep this failed-save draft");
  await app.autosave();
  assert.equal(app.commits.length, 1);
  const switching = app.select("beta");
  await settle();
  await app.finish(0, false);
  // flushSave queues one retry behind the already-pending autosave. Both
  // writes fail here so the transition really cannot persist its draft.
  assert.equal(app.commits.length, 2);
  await app.finish(1, false);
  await switching;
  assert.equal(app.find("#profile-select").value, "alpha");
  assert.equal(app.note(), "keep this failed-save draft");
  assert.equal(storedNote(app.stored()), "alpha original");
  assert.match(app.find("#save-state").textContent, /Finish saving/);
  assertAvailable(app);
  const retry = app.select("beta");
  await settle();
  assert.equal(storedNote(app.commits[2].next), "keep this failed-save draft");
  await app.finish(2);
  await app.finish(3);
  await retry;
  assert.equal(storedNote(app.stored()), "keep this failed-save draft");
  assert.equal(app.find("#profile-select").value, "beta");
  assertAvailable(app);
});

test("an active-profile commit failure restores the original editor and permits saving and retry", async () => {
  const app = await workspace();
  const switching = app.select("beta");
  await settle();
  await app.finish(0, false);
  await switching;
  assert.equal(app.find("#profile-select").value, "alpha");
  assert.equal(app.stored().settings.active_ranking_profile_id, "alpha");
  assert.equal(app.note(), "alpha original");
  assert.match(app.find("#save-state").textContent, /Synthetic storage write failed/);
  assertAvailable(app);
  await app.edit("saved after transition failure");
  await app.autosave();
  await app.finish(1);
  const retry = app.select("beta");
  await settle();
  await app.finish(2);
  await retry;
  assert.equal(storedNote(app.stored()), "saved after transition failure");
  assert.equal(app.find("#profile-select").value, "beta");
  assertAvailable(app);
});
