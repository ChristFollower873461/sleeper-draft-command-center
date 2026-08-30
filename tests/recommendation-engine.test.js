const test = require("node:test");
const assert = require("node:assert/strict");

const DraftOrder = require("../src/draft-order.js");
const Engine = require("../src/recommendation-engine.js");
const Storage = require("../src/storage.js");

function player(rank, id, position, options = {}) {
  return {
    rank,
    player: options.name || `${position} Player ${rank}`,
    position,
    team: options.team || "TST",
    sleeper_id: id,
    adp: options.adp ?? rank,
    tier: options.tier ?? Math.ceil(rank / 4),
    notes: "",
  };
}

function profile(format, players, rosterPositions) {
  return {
    id: `${format}-profile`,
    name: `${format} fixture`,
    format,
    source: "manual",
    created_at: null,
    updated_at: null,
    league_settings: {
      teams: 4,
      roster_positions: rosterPositions || [],
      scoring: {},
    },
    players,
  };
}

function draft({ teams = 4, rounds = 17, reversal = 0, slot = 1 } = {}) {
  return {
    settings: { teams, rounds, reversal_round: reversal },
    draft_order: { coach: slot },
    slot_to_roster_id: Object.fromEntries(
      Array.from({ length: teams }, (_value, index) => [index + 1, 100 + index + 1]),
    ),
  };
}

function pick(pickNumber, teams, position, id, options = {}) {
  const draftSlot = DraftOrder.slotForPickNumber(pickNumber, teams, options.reversal || 0);
  return {
    pick_no: pickNumber,
    draft_slot: draftSlot,
    roster_id: 100 + draftSlot,
    picked_by: draftSlot === 1 ? "coach" : `user-${draftSlot}`,
    player_id: id,
    metadata: {
      first_name: position,
      last_name: String(pickNumber),
      position,
      team: options.team || "OTH",
    },
  };
}

test("one-QB construction suppresses an early excess quarterback", () => {
  const players = [
    player(1, "qb-one", "QB"),
    player(2, "rb-one", "RB"),
    player(3, "wr-one", "WR"),
    player(4, "qb-two", "QB"),
    player(5, "te-one", "TE"),
  ];
  const picks = [pick(1, 4, "QB", "qb-one")];
  const state = Engine.makeDraftState(profile("one_qb", players), draft(), picks, [], { user_id: "coach" });
  const recommendations = Engine.chooseRecommendations(state);

  assert.equal(state.counts.QB, 1);
  assert.notEqual(recommendations[0].player.position, "QB");
  assert.ok(recommendations.some((row) => ["RB", "WR"].includes(row.player.position)));
});

test("superflex construction elevates quarterback when the roster has none", () => {
  const players = [
    player(1, "rb-gone", "RB"),
    player(2, "wr-gone", "WR"),
    player(3, "rb-two", "RB"),
    player(4, "wr-two", "WR"),
    player(5, "qb-target", "QB", { adp: 10 }),
    player(6, "te-one", "TE"),
  ];
  const roster = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPER_FLEX", "BN", "BN", "BN", "BN"];
  const picks = [
    pick(1, 4, "RB", "rb-gone"),
    pick(2, 4, "WR", "other-2"),
    pick(3, 4, "RB", "other-3"),
    pick(4, 4, "WR", "other-4"),
    pick(5, 4, "RB", "other-5"),
    pick(6, 4, "WR", "other-6"),
    pick(7, 4, "TE", "other-7"),
    pick(8, 4, "WR", "wr-gone"),
  ];
  const state = Engine.makeDraftState(profile("superflex", players, roster), draft(), picks, [], { user_id: "coach" });
  const recommendations = Engine.chooseRecommendations(state);

  assert.equal(state.decision_round, 3);
  assert.equal(state.targets.QB, 2);
  assert.equal(state.counts.QB, 0);
  assert.equal(recommendations[0].player.sleeper_id, "qb-target");
});

test("best-ball roster without specialist slots blocks kicker and defense", () => {
  const players = [
    player(1, "k-one", "K"),
    player(2, "def-one", "DEF"),
    player(3, "wr-one", "WR"),
    player(4, "rb-one", "RB"),
  ];
  const state = Engine.makeDraftState(profile("best_ball", players), draft(), [], [], { user_id: "coach" });
  const recommendations = Engine.chooseRecommendations(state);

  assert.equal(state.targets.K, 0);
  assert.equal(state.targets.DEF, 0);
  assert.ok(recommendations.every((row) => !["K", "DEF"].includes(row.player.position)));
});

test("kicker and defense unlock late and respect one-player limits", () => {
  const players = [
    player(1, "k-one", "K"),
    player(2, "def-one", "DEF"),
    player(3, "wr-one", "WR"),
    player(4, "rb-one", "RB"),
  ];
  const roster = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN"];
  const early = Engine.makeDraftState(profile("one_qb", players, roster), draft(), [], [], { user_id: "coach" });
  assert.ok(Engine.chooseRecommendations(early).every((row) => !["K", "DEF"].includes(row.player.position)));

  const latePicks = Array.from({ length: 56 }, (_value, index) => {
    const pickNumber = index + 1;
    const positionByRound = ["QB", "RB", "WR", "TE"];
    return pick(pickNumber, 4, positionByRound[index % positionByRound.length], `taken-${pickNumber}`);
  });
  const late = Engine.makeDraftState(profile("one_qb", players, roster), draft(), latePicks, [], { user_id: "coach" });
  const lateRecommendations = Engine.chooseRecommendations(late);
  assert.equal(late.decision_round, 15);
  assert.ok(lateRecommendations.some((row) => row.player.position === "K"));
  assert.ok(lateRecommendations.some((row) => row.player.position === "DEF"));

  latePicks[52] = pick(53, 4, "K", "k-one");
  const afterKicker = Engine.makeDraftState(profile("one_qb", players, roster), draft(), latePicks, [], { user_id: "coach" });
  assert.ok(Engine.chooseRecommendations(afterKicker).every((row) => row.player.position !== "K"));
});

test("room state exposes run, demand, tier cliff, and ADP faller signals", () => {
  const players = [
    player(1, "falling-qb", "QB", { adp: 1, tier: 1 }),
    player(8, "rb-one", "RB", { adp: 8, tier: 1 }),
    player(15, "rb-two", "RB", { adp: 15, tier: 2 }),
    player(9, "wr-one", "WR", { adp: 9, tier: 1 }),
  ];
  const picks = [
    pick(1, 4, "RB", "taken-1"),
    pick(2, 4, "WR", "taken-2"),
    pick(3, 4, "WR", "taken-3"),
    pick(4, 4, "WR", "taken-4"),
    pick(5, 4, "WR", "taken-5"),
  ];
  const state = Engine.makeDraftState(profile("superflex", players), draft({ slot: 1 }), picks, [], { user_id: "coach" });

  assert.deepEqual(state.run_signal, { position: "WR", count: 4, kind: "streak" });
  assert.equal(state.fallers[0].player.sleeper_id, "falling-qb");
  assert.ok(state.tier_signals.some((signal) => signal.position === "RB" && signal.remaining === 1));
  assert.ok(state.ahead_slots.length > 0);
});

test("saved manual state recovers without live API picks and live data later wins", () => {
  const players = [
    player(1, "manual-one", "RB"),
    player(2, "live-two", "WR"),
    player(3, "next-three", "QB"),
  ];
  const draftData = draft({ rounds: 3 });
  const manualOne = DraftOrder.manualPickForPlayer(players[0], 1, draftData, { user_id: "coach", slot: 1 });
  const stored = Storage.migrateState({
    schema_version: 1,
    user: { username: "coach", user_id: "coach" },
    ranking_profiles: [profile("one_qb", players)],
    draft_sessions: {
      "draft-one": {
        draft_id: "draft-one",
        ranking_profile_id: "one_qb-profile",
        mode: "manual",
        manual_picks: [manualOne],
      },
    },
    settings: { active_ranking_profile_id: "one_qb-profile" },
  }).state;
  const recovered = Engine.recoverDraftState(
    stored.ranking_profiles[0],
    draftData,
    [],
    stored.draft_sessions["draft-one"].manual_picks,
    [],
    { user_id: "coach" },
  );
  assert.equal(recovered.state.current_pick, 2);
  assert.equal(recovered.state.selected[0].sleeper_id, "manual-one");

  const posted = pick(1, 4, "WR", "live-two");
  const reconciled = Engine.recoverDraftState(
    stored.ranking_profiles[0],
    draftData,
    [posted],
    stored.draft_sessions["draft-one"].manual_picks,
    [],
    { user_id: "coach" },
  );
  assert.equal(reconciled.effective_picks.length, 1);
  assert.equal(reconciled.effective_picks[0].player_id, "live-two");
  assert.equal(reconciled.effective_picks[0].source, "live");
});

test("completed and malformed drafts are explicit", () => {
  const players = [player(1, "only-player", "QB")];
  const completePicks = Array.from({ length: 4 }, (_value, index) => pick(index + 1, 2, "QB", `taken-${index}`));
  const completeDraft = draft({ teams: 2, rounds: 2 });
  const complete = Engine.makeDraftState(profile("one_qb", players), completeDraft, completePicks, [], { user_id: "coach" });
  assert.equal(complete.complete, true);
  assert.deepEqual(Engine.chooseRecommendations(complete), []);

  assert.throws(
    () => Engine.makeDraftState({ players: [] }, { settings: { teams: 1, rounds: 0 } }),
    (error) => error instanceof Engine.DraftEngineInputError && error.errors.length >= 2,
  );
});
