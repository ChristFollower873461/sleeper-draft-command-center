const test = require("node:test");
const assert = require("node:assert/strict");

const Storage = require("../src/storage.js");
const Sessions = require("../src/draft-session.js");
const Runtime = require("../src/draft-runtime.js");

function player(rank, position, id = `${position.toLowerCase()}-${rank}`) {
  return { rank, player: `${position} Player ${rank}`, position, team: rank % 2 ? "AAA" : "BBB", sleeper_id: id, adp: rank + 2, tier: Math.ceil(rank / 3), notes: rank === 5 ? "Priority" : "" };
}

function stateWithProfile(format = "one_qb") {
  const players = [
    player(1, "QB"), player(2, "RB"), player(3, "WR"), player(4, "TE"),
    player(5, "WR"), player(6, "RB"), player(7, "QB"), player(8, "TE"),
  ];
  return Storage.migrateState({
    schema_version: 1,
    user: { username: "coach", user_id: "coach" },
    ranking_profiles: [{
      id: "profile", name: "Runtime board", format, source: "manual",
      league_settings: { teams: 4, roster_positions: [], scoring: { rec: 0.5 } }, players,
    }],
    draft_sessions: {},
    settings: { active_ranking_profile_id: "profile" },
  }).state;
}

function context(format = "one_qb") {
  return {
    name: "Runtime room", status: "drafting", format, teams: 4, rounds: 4,
    reversal_round: 0, user_slot: 1, user_roster_id: 101,
    roster_positions: format === "superflex"
      ? ["QB", "RB", "WR", "TE", "SUPER_FLEX", "BN", "BN"]
      : ["QB", "RB", "WR", "TE", "FLEX", "BN", "BN"],
    scoring: { rec: 0.5 },
  };
}

function createRuntimeState(format = "one_qb") {
  return Sessions.upsertSession(stateWithProfile(format), {
    draftId: "draft", profileId: "profile", mode: "manual", context: context(format),
  });
}

test("runtime reconstructs one-QB room truth from cached and manual picks", () => {
  let state = createRuntimeState();
  state = Sessions.cacheLivePicks(state, "draft", [
    { pick_no: 1, draft_slot: 1, roster_id: 101, picked_by: "coach", player_id: "qb-1", metadata: { position: "QB" } },
  ]);
  state = Sessions.recordManualPick(state, "draft", state.ranking_profiles[0].players[1]).state;
  state = Sessions.togglePinnedPlayer(state, "draft", "wr-5");
  const runtime = Runtime.makeRuntimeState(state, "draft");
  assert.equal(runtime.state.current_pick, 3);
  assert.deepEqual(runtime.state.selected.map((row) => row.sleeper_id), ["qb-1"]);
  assert.equal(runtime.pinned[0].sleeper_id, "wr-5");
  assert.ok(runtime.recommendations.every((row) => row.player.position !== "QB"));
});

test("runtime applies superflex context without mutating stored profile", () => {
  const state = createRuntimeState("one_qb");
  const liveContext = Runtime.contextFromSession({
    ...state.draft_sessions.draft,
    draft_config: { ...state.draft_sessions.draft.draft_config, format: "superflex", roster_positions: ["QB", "SUPER_FLEX", "RB", "WR", "TE", "BN"] },
  });
  const runtime = Runtime.makeRuntimeState(state, "draft", { context: liveContext });
  assert.equal(runtime.adapted_profile.format, "superflex");
  assert.equal(runtime.state.targets.QB, 2);
  assert.equal(state.ranking_profiles[0].format, "one_qb");
});

test("available filtering and first manual candidate share normalized search", () => {
  const runtime = Runtime.makeRuntimeState(createRuntimeState(), "draft");
  assert.deepEqual(Runtime.filterAvailable(runtime, { position: "WR" }).map((row) => row.sleeper_id), ["wr-3", "wr-5"]);
  assert.equal(Runtime.firstManualCandidate(runtime, "priority").sleeper_id, "wr-5");
  assert.equal(Runtime.firstManualCandidate(runtime, "missing"), null);
});

test("pick signature is order independent and changes with identity", () => {
  const first = [{ pick_no: 2, player_id: "b" }, { pick_no: 1, player_id: "a" }];
  const second = [...first].reverse();
  assert.equal(Runtime.pickSignature(first), Runtime.pickSignature(second));
  assert.notEqual(Runtime.pickSignature(first), Runtime.pickSignature([{ pick_no: 1, player_id: "c" }]));
});

test("live pick corrections refresh the selected roster without waiting for another pick", () => {
  const initial = [{ pick_no: 1, player_id: "qb-1", draft_slot: 1, roster_id: 102 }];
  const corrected = [{ ...initial[0], roster_id: 101 }];
  let state = Sessions.cacheLivePicks(createRuntimeState(), "draft", initial);
  assert.deepEqual(Runtime.makeRuntimeState(state, "draft").state.selected, []);

  // Match the live polling gate: persist and rebuild only when its signature changes.
  if (Runtime.pickSignature(initial) !== Runtime.pickSignature(corrected)) {
    state = Sessions.cacheLivePicks(state, "draft", corrected);
  }

  assert.deepEqual(
    Runtime.makeRuntimeState(state, "draft").state.selected.map((row) => row.sleeper_id),
    ["qb-1"],
  );
});

test("pick signature tracks ownership and player metadata used by the draft engine", () => {
  const pick = {
    pick_no: 1, player_id: "external-player", draft_slot: 1, roster_id: 101,
    round: 1, picked_by: "coach",
    metadata: { first_name: "Example", last_name: "Player", position: "QB", team: "AAA" },
  };
  for (const change of [
    { draft_slot: 2 }, { roster_id: 102 }, { round: 2 }, { picked_by: "other" },
    ...Object.entries({ first_name: "Different", last_name: "Name", position: "RB", team: "BBB" })
      .map(([key, value]) => ({ metadata: { ...pick.metadata, [key]: value } })),
  ]) {
    assert.notEqual(Runtime.pickSignature([pick]), Runtime.pickSignature([{ ...pick, ...change }]));
  }
});

test("pick signature ignores irrelevant timestamps and metadata property order", () => {
  const pick = {
    pick_no: 1, player_id: "qb-1", timestamp: 100,
    metadata: { first_name: "Example", last_name: "Player", position: "QB", team: "AAA" },
  };
  const reordered = {
    ...pick, timestamp: 200,
    metadata: { team: "AAA", position: "QB", last_name: "Player", first_name: "Example" },
  };
  assert.equal(Runtime.pickSignature([pick]), Runtime.pickSignature([reordered]));
});

test("camelCase pick corrections reach the cached roster and player names", () => {
  let pick = {
    pick_no: 1, player_id: "external-player", draft_slot: 2, roster_id: 102,
    pickedBy: "other",
    metadata: { firstName: "Original", lastName: "Player", position: "QB", team: "AAA" },
  };
  let state = Sessions.cacheLivePicks(createRuntimeState(), "draft", [pick]);
  assert.deepEqual(Runtime.makeRuntimeState(state, "draft").state.selected, []);

  for (const [change, expectedName] of [
    [{ pickedBy: "coach" }, "Original Player"],
    [{ metadata: { ...pick.metadata, firstName: "Corrected" } }, "Corrected Player"],
    [{ metadata: { ...pick.metadata, firstName: "Corrected", lastName: "Name" } }, "Corrected Name"],
  ]) {
    const corrected = { ...pick, ...change };
    if (Runtime.pickSignature([pick]) !== Runtime.pickSignature([corrected])) {
      state = Sessions.cacheLivePicks(state, "draft", [corrected]);
    }
    assert.deepEqual(
      Runtime.makeRuntimeState(state, "draft").state.selected.map((row) => row.player),
      [expectedName],
    );
    pick = corrected;
  }

  assert.equal(Runtime.pickSignature([pick]), Runtime.pickSignature([{
    ...pick, picked_by: "coach",
    metadata: { first_name: "Corrected", last_name: "Name", position: "QB", team: "AAA" },
  }]));
});

test("live polling is tight while drafting and backs off when hidden", () => {
  assert.equal(Runtime.livePollDelay(300, "drafting", false), 300);
  assert.equal(Runtime.livePollDelay(300, "pre_draft", false), 1000);
  assert.equal(Runtime.livePollDelay(300, "drafting", true), 2500);
  assert.equal(Runtime.livePollDelay(undefined, "drafting", false), 300);
});
