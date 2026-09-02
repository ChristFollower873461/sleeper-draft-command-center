const test = require("node:test");
const assert = require("node:assert/strict");

const Storage = require("../src/storage.js");
const Sessions = require("../src/draft-session.js");

function players() {
  return ["QB", "RB", "WR", "TE", "WR", "RB"].map((position, index) => ({
    rank: index + 1,
    player: `Draft Player ${index + 1}`,
    position,
    team: `T${index + 1}`,
    sleeper_id: `player-${index + 1}`,
    adp: index + 1,
    tier: 1,
    notes: "",
  }));
}

function baseState() {
  return Storage.migrateState({
    schema_version: 1,
    user: { username: "coach", user_id: "coach-id" },
    ranking_profiles: [{
      id: "profile-one",
      name: "Fixture board",
      format: "one_qb",
      source: "manual",
      league_settings: { teams: 4, roster_positions: ["QB", "RB", "WR", "TE", "BN", "BN"], scoring: { rec: 0.5 } },
      players: players(),
    }],
    draft_sessions: {},
    settings: { active_ranking_profile_id: "profile-one" },
  }).state;
}

function context(overrides = {}) {
  return {
    name: "Fixture room",
    status: "drafting",
    format: "one_qb",
    teams: 4,
    rounds: 3,
    reversal_round: 0,
    pick_timer: 120,
    user_slot: 1,
    user_roster_id: 101,
    traded_picks: [{ round: 2, roster_id: 102, owner_id: 101 }],
    roster_positions: ["QB", "RB", "WR", "TE", "BN", "BN"],
    scoring: { rec: 0.5 },
    ...overrides,
  };
}

test("session creation stores bounded config and preserves existing progress", () => {
  let state = Sessions.upsertSession(baseState(), {
    draftId: "draft-one", leagueId: "league-one", profileId: "profile-one", mode: "live", context: context(),
    now: "2026-08-29T20:00:00.000Z",
  });
  state = Sessions.togglePinnedPlayer(state, "draft-one", "player-2");
  state = Sessions.upsertSession(state, {
    draftId: "draft-one", leagueId: "league-one", profileId: "profile-one", mode: "manual",
    context: context({ status: "paused" }), now: "2026-08-29T20:05:00.000Z",
  });
  const session = state.draft_sessions["draft-one"];
  assert.equal(session.mode, "manual");
  assert.equal(session.draft_config.status, "paused");
  assert.deepEqual(session.draft_config.traded_picks, [{ round: 2, roster_id: 102, owner_id: 101 }]);
  assert.deepEqual(session.pinned_player_ids, ["player-2"]);
  assert.equal(state.settings.last_draft_id, "draft-one");
});

test("manual record fills the next missing effective pick and live cache later wins", () => {
  let state = Sessions.upsertSession(baseState(), {
    draftId: "draft-one", profileId: "profile-one", mode: "manual", context: context(),
  });
  state = Sessions.cacheLivePicks(state, "draft-one", [
    { pick_no: 1, draft_slot: 1, roster_id: 101, picked_by: "coach-id", player_id: "player-1", metadata: { position: "QB" } },
    { pick_no: 3, draft_slot: 3, roster_id: 103, picked_by: "other", player_id: "other-3", metadata: { position: "WR" } },
  ]);
  const recorded = Sessions.recordManualPick(state, "draft-one", players()[1]);
  assert.equal(recorded.pick.pick_no, 2);
  assert.equal(recorded.pick.draft_slot, 2);
  assert.equal(recorded.pick.player_id, "player-2");
  state = Sessions.cacheLivePicks(recorded.state, "draft-one", [
    { pick_no: 1, draft_slot: 1, player_id: "player-1", metadata: {} },
    { pick_no: 2, draft_slot: 2, player_id: "live-player", metadata: {} },
    { pick_no: 3, draft_slot: 3, player_id: "other-3", metadata: {} },
  ]);
  assert.equal(state.draft_sessions["draft-one"].manual_picks.length, 1);
  assert.equal(state.draft_sessions["draft-one"].cached_live_picks[1].player_id, "live-player");
});

test("undo removes only the latest manual pick that remains effective", () => {
  let state = Sessions.upsertSession(baseState(), {
    draftId: "draft-one", profileId: "profile-one", mode: "manual", context: context(),
  });
  state = Sessions.recordManualPick(state, "draft-one", players()[0]).state;
  state = Sessions.recordManualPick(state, "draft-one", players()[1]).state;
  state = Sessions.cacheLivePicks(state, "draft-one", [
    { pick_no: 2, draft_slot: 2, player_id: "posted-over-manual", metadata: {} },
  ]);
  const undone = Sessions.undoEffectiveManualPick(state, "draft-one");
  assert.equal(undone.removed.pick_no, 1);
  assert.deepEqual(undone.state.draft_sessions["draft-one"].manual_picks.map((pick) => pick.pick_no), [2]);
  const noEffectiveManual = Sessions.undoEffectiveManualPick(undone.state, "draft-one");
  assert.equal(noEffectiveManual.removed, null);
  assert.equal(noEffectiveManual.state.draft_sessions["draft-one"].manual_picks.length, 1);
});

test("pinning is reversible and session removal clears the last draft", () => {
  let state = Sessions.upsertSession(baseState(), {
    draftId: "manual-one", profileId: "profile-one", mode: "manual", context: context(),
  });
  state = Sessions.togglePinnedPlayer(state, "manual-one", "player-4");
  assert.deepEqual(state.draft_sessions["manual-one"].pinned_player_ids, ["player-4"]);
  state = Sessions.togglePinnedPlayer(state, "manual-one", "player-4");
  assert.deepEqual(state.draft_sessions["manual-one"].pinned_player_ids, []);
  state = Sessions.removeSession(state, "manual-one");
  assert.deepEqual(state.draft_sessions, {});
  assert.equal(state.settings.last_draft_id, null);
});

test("invalid session inputs fail without mutating source state", () => {
  const state = baseState();
  assert.throws(
    () => Sessions.upsertSession(state, { draftId: "bad/id", profileId: "profile-one", context: context() }),
    /Draft ID is invalid/,
  );
  assert.throws(
    () => Sessions.upsertSession(state, { draftId: "draft-one", profileId: "missing", context: context() }),
    /ranking profile/,
  );
  assert.deepEqual(state.draft_sessions, {});
});
