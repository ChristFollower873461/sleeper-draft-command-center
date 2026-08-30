const test = require("node:test");
const assert = require("node:assert/strict");

const Context = require("../src/draft-context.js");

function draft(overrides = {}) {
  return {
    draft_id: "draft-fixture",
    league_id: "league-fixture",
    type: "snake",
    status: "drafting",
    settings: { teams: 12, rounds: 17, pick_timer: 120 },
    draft_order: { coach: 7 },
    slot_to_roster_id: Object.fromEntries(Array.from({ length: 12 }, (_value, index) => [index + 1, 100 + index + 1])),
    metadata: { name: "Fixture draft", scoring_type: "half_ppr" },
    ...overrides,
  };
}

test("one-QB league context uses league roster and scoring truth", () => {
  const result = Context.normalizeDraftContext({
    draft: draft(),
    league: {
      league_id: "league-fixture",
      name: "Fixture League",
      total_rosters: 12,
      roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN"],
      scoring_settings: { rec: 1, pass_td: 4 },
    },
    user: { user_id: "coach" },
  });

  assert.equal(result.format, "one_qb");
  assert.equal(result.scoring_label, "PPR");
  assert.equal(result.user_slot, 7);
  assert.equal(result.user_roster_id, 107);
  assert.equal(result.name, "Fixture League");
  assert.deepEqual(result.warnings, []);
});

test("superflex can be detected from a starter or two quarterback slots", () => {
  const fromRoster = Context.normalizeDraftContext({
    draft: draft(),
    league: { roster_positions: ["QB", "RB", "WR", "TE", "SUPER_FLEX", "BN"] },
  });
  assert.equal(fromRoster.format, "superflex");

  const fromSettings = Context.normalizeDraftContext({
    draft: draft({ settings: { teams: 10, rounds: 18, slots_qb: 2, slots_rb: 2, slots_wr: 3, slots_bn: 10 } }),
  });
  assert.equal(fromSettings.format, "superflex");
  assert.equal(fromSettings.roster_positions.filter((position) => position === "QB").length, 2);
});

test("best ball flag wins over roster-shape inference", () => {
  const result = Context.normalizeDraftContext({
    draft: draft({ settings: { teams: 12, rounds: 18, best_ball: 1 } }),
    league: { roster_positions: ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "SUPER_FLEX", "BN"] },
  });
  assert.equal(result.format, "best_ball");
});

test("mock draft uses profile fallback and direct user slot without league data", () => {
  const result = Context.normalizeDraftContext({
    draft: draft({ league_id: null, draft_order: null, slot_to_roster_id: null }),
    profile: { format: "custom", league_settings: { roster_positions: [], scoring: { rec: 0.5 } } },
    user: { user_id: "coach", slot: 4 },
  });
  assert.equal(result.format, "custom");
  assert.equal(result.user_slot, 4);
  assert.equal(result.user_roster_id, null);
  assert.equal(result.scoring_label, "Half PPR");
});

test("roster ownership resolves slot when draft order has no user", () => {
  const result = Context.normalizeDraftContext({
    draft: draft({ draft_order: null }),
    rosters: [{ roster_id: 105, owner_id: "coach" }],
    user: { user_id: "coach" },
  });
  assert.equal(result.user_roster_id, 105);
  assert.equal(result.user_slot, 5);
});

test("third-round reversal is preserved and invalid reversal is warned away", () => {
  const accepted = Context.normalizeDraftContext({
    draft: draft({ settings: { teams: 12, rounds: 17, reversal_round: 3 } }),
  });
  assert.equal(accepted.reversal_round, 3);
  assert.equal(accepted.engine_draft.settings.reversal_round, 3);

  const rejected = Context.normalizeDraftContext({
    draft: draft({ settings: { teams: 12, rounds: 2, reversal_round: 3 } }),
  });
  assert.equal(rejected.reversal_round, 0);
  assert.match(rejected.warnings[0], /reversal/);
});

test("unsupported draft types and malformed dimensions fail explicitly", () => {
  const auction = Context.normalizeDraftContext({ draft: draft({ type: "auction" }) });
  assert.equal(auction.supported, false);
  assert.match(auction.warnings[0], /not supported/);

  assert.throws(
    () => Context.normalizeDraftContext({ draft: { settings: { teams: 1, rounds: 0 } } }),
    (error) => error instanceof Context.DraftContextError && error.errors.length === 2,
  );
});

test("profile context is cloned and receives detected league settings", () => {
  const profile = { id: "profile", format: "one_qb", league_settings: {}, players: [] };
  const context = Context.normalizeDraftContext({
    draft: draft(),
    league: { roster_positions: ["QB", "SUPER_FLEX", "RB", "WR"], scoring_settings: { rec: 1 } },
  });
  const adapted = Context.profileForContext(profile, context);
  assert.equal(adapted.format, "superflex");
  assert.deepEqual(adapted.league_settings.scoring, { rec: 1 });
  adapted.league_settings.roster_positions.push("BN");
  assert.equal(context.roster_positions.includes("BN"), false);
});
