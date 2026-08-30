const test = require("node:test");
const assert = require("node:assert/strict");

const Storage = require("../src/storage.js");
const Profiles = require("../src/profile-manager.js");

function player(rank, id = `p-${rank}`) {
  return { rank, player: `Player ${rank}`, position: "WR", team: "TST", sleeper_id: id, adp: rank, tier: 1, notes: "" };
}

function stateWithProfile() {
  const state = Storage.createDefaultState();
  return Profiles.addProfile(state, {
    id: "primary",
    name: "Primary",
    format: "one_qb",
    now: "2026-08-29T12:00:00Z",
    players: [player(1), player(2)],
  });
}

test("create and clone produce isolated profiles and select the new profile", () => {
  let state = stateWithProfile();
  state = Profiles.cloneProfile(state, "primary", {
    id: "clone", name: "Primary", now: "2026-08-29T13:00:00Z",
  });
  assert.equal(state.ranking_profiles.length, 2);
  assert.equal(state.ranking_profiles[1].name, "Primary 2");
  assert.equal(state.settings.active_ranking_profile_id, "clone");
  state.ranking_profiles[1].players[0].notes = "clone only";
  assert.equal(state.ranking_profiles[0].players[0].notes, "");
});

test("rename stays unique and delete clears profile references", () => {
  let state = stateWithProfile();
  state = Profiles.addProfile(state, { id: "second", name: "Second", format: "superflex" });
  state = Profiles.renameProfile(state, "second", "Primary", "2026-08-29T14:00:00Z");
  assert.equal(state.ranking_profiles[1].name, "Primary 2");
  state.draft_sessions = {
    draft: {
      draft_id: "draft", league_id: "", ranking_profile_id: "second", mode: "live",
      manual_picks: [], pinned_player_ids: [], ui: { fullscreen: false, dock: "right", active_tab: "shortlist" }, updated_at: null,
    },
  };
  state = Profiles.deleteProfile(state, "second");
  assert.equal(state.ranking_profiles.length, 1);
  assert.equal(state.settings.active_ranking_profile_id, "primary");
  assert.equal(state.draft_sessions.draft.ranking_profile_id, null);
});

test("player updates affect only the selected profile", () => {
  let state = stateWithProfile();
  state = Profiles.cloneProfile(state, "primary", { id: "clone", name: "Clone" });
  const updated = [player(1), { ...player(2), notes: "changed" }];
  state = Profiles.updateProfilePlayers(state, "clone", updated, "2026-08-29T15:00:00Z");
  assert.equal(state.ranking_profiles.find((profile) => profile.id === "clone").players[1].notes, "changed");
  assert.equal(state.ranking_profiles.find((profile) => profile.id === "primary").players[1].notes, "");
});

test("public export reimports identically without account or draft state", () => {
  let state = stateWithProfile();
  state.user = { username: "local-user", user_id: "local-id" };
  state.settings.last_draft_id = "local-draft";
  const pack = Profiles.exportRankingPack(state, "primary");
  const importedState = Profiles.importRankingPack(Storage.createDefaultState(), pack, {
    id: "imported", now: "2026-08-29T16:00:00Z",
  });
  const importedPack = Profiles.exportRankingPack(importedState, "imported");
  assert.deepEqual(importedPack, pack);
  assert.equal("user" in pack, false);
  assert.equal("draft_sessions" in pack, false);
});

test("import rejects duplicates, invalid positions, and future schemas", () => {
  const base = { schema_version: 1, name: "Pack", format: "one_qb", players: [player(1)] };
  assert.throws(
    () => Profiles.importRankingPack(Storage.createDefaultState(), { ...base, schema_version: 2 }),
    /schema must be 1/,
  );
  assert.throws(
    () => Profiles.importRankingPack(Storage.createDefaultState(), { ...base, players: [player(1), player(2, "p-1")] }),
    /duplicate/,
  );
  assert.throws(
    () => Profiles.importRankingPack(Storage.createDefaultState(), { ...base, players: [{ ...player(1), position: "P" }] }),
    /invalid/,
  );
});

