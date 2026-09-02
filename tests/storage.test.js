const test = require("node:test");
const assert = require("node:assert/strict");

const Storage = require("../src/storage.js");

test("state byte budget accepts bounded data and rejects oversized data", () => {
  assert.ok(Storage.assertStateBudget({ value: "small" }) < Storage.MAX_STATE_BYTES);
  assert.throws(
    () => Storage.assertStateBudget({ value: "x".repeat(Storage.MAX_STATE_BYTES) }),
    (error) => error.code === "STORAGE_BUDGET_EXCEEDED",
  );
});

function samplePlayer(overrides = {}) {
  return {
    rank: 1,
    player: "Sample Quarter",
    position: "QB",
    team: "TST",
    sleeper_id: "sample-qb",
    adp: 2.5,
    tier: 1,
    notes: "Fictional fixture",
    ...overrides,
  };
}

function sampleProfile(overrides = {}) {
  return {
    id: "profile-one",
    name: "Sample Superflex",
    format: "superflex",
    source: "manual",
    created_at: "2026-08-29T00:00:00.000Z",
    updated_at: "2026-08-29T00:00:00.000Z",
    league_settings: {
      teams: 12,
      roster_positions: ["QB", "RB", "WR", "TE", "SUPER_FLEX"],
      scoring: { pass_td: 4, rec: 0.5 },
    },
    players: [samplePlayer()],
    ...overrides,
  };
}

test("fresh storage creates a valid isolated schema 1 record", () => {
  const first = Storage.migrateState(null);
  const second = Storage.migrateState(null);

  assert.deepEqual(first.state, Storage.createDefaultState());
  assert.deepEqual(Storage.validateState(first.state), []);
  first.state.settings.dock = "left";
  assert.equal(second.state.settings.dock, "right");
});

test("current storage normalizes unknown and corrupt fields deterministically", () => {
  const result = Storage.migrateState({
    schema_version: 1,
    user: { username: "  coach  ", user_id: "user-1", password: "discard" },
    ranking_profiles: [{
      ...sampleProfile(),
      private_source_rank: 4,
      players: [
        samplePlayer({ rank: 9 }),
        samplePlayer({ rank: 2, sleeper_id: "sample-qb" }),
        { rank: 3, player: "Broken", position: "XX", sleeper_id: "broken" },
      ],
    }],
    draft_sessions: {},
    settings: {
      active_ranking_profile_id: "missing-profile",
      last_draft_id: "draft-1",
      dock: "middle",
      poll_interval_ms: 10,
      unknown: true,
    },
    unknown: true,
  });

  assert.equal(result.state.user.username, "coach");
  assert.equal(Object.hasOwn(result.state.user, "password"), false);
  assert.equal(Object.hasOwn(result.state.ranking_profiles[0], "private_source_rank"), false);
  assert.equal(result.state.ranking_profiles[0].players.length, 1);
  assert.equal(result.state.ranking_profiles[0].players[0].rank, 1);
  assert.equal(result.state.settings.active_ranking_profile_id, null);
  assert.equal(result.state.settings.dock, "right");
  assert.equal(result.state.settings.poll_interval_ms, 300);
  assert.ok(result.warnings.length >= 3);
  assert.deepEqual(Storage.validateState(result.state), []);
});

test("legacy schema 0 migrates account, profile, and manual draft state", () => {
  const result = Storage.migrateState({
    username: "draft-coach",
    userId: "user-7",
    rankings: [{
      id: "legacy-profile",
      name: "Legacy Board",
      format: "one_qb",
      players: [samplePlayer({ sleeperId: "legacy-qb", sleeper_id: undefined })],
    }],
    manualDrafts: {
      "draft-7": {
        profileId: "legacy-profile",
        mode: "manual",
        fullscreen: true,
        picks: [{
          pickNo: 1,
          draftSlot: 1,
          rosterId: 8,
          pickedBy: "user-7",
          playerId: "legacy-qb",
          metadata: { firstName: "Sample", lastName: "Quarter", position: "QB", team: "TST" },
        }],
      },
    },
    activeProfileId: "legacy-profile",
    lastDraftId: "draft-7",
    dock: "left",
  });

  assert.equal(result.from_version, 0);
  assert.equal(result.to_version, 1);
  assert.equal(result.state.user.username, "draft-coach");
  assert.equal(result.state.ranking_profiles[0].players[0].sleeper_id, "legacy-qb");
  assert.equal(result.state.draft_sessions["draft-7"].manual_picks[0].pick_no, 1);
  assert.equal(result.state.draft_sessions["draft-7"].ui.fullscreen, true);
  assert.equal(result.state.settings.active_ranking_profile_id, "legacy-profile");
  assert.ok(result.warnings.includes("storage: migrated legacy schema 0 to schema 1"));
  assert.deepEqual(Storage.validateState(result.state), []);
});

test("non-object storage recovers with an explicit warning", () => {
  const result = Storage.migrateState("not an object");
  assert.deepEqual(result.state, Storage.createDefaultState());
  assert.deepEqual(result.warnings, ["storage: reset non-object record"]);
});

test("future storage versions refuse to downgrade", () => {
  assert.throws(
    () => Storage.migrateState({ schema_version: 2 }),
    (error) => (
      error instanceof Storage.UnsupportedStorageVersionError
      && error.code === "UNSUPPORTED_STORAGE_VERSION"
      && error.version === 2
    ),
  );
});

test("manual session normalization keeps one sorted pick per pick number", () => {
  const result = Storage.migrateState({
    schema_version: 1,
    user: {},
    ranking_profiles: [sampleProfile()],
    draft_sessions: {
      "draft-one": {
        draft_id: "draft-one",
        ranking_profile_id: "profile-one",
        mode: "manual",
        manual_picks: [
          { pick_no: 2, draft_slot: 2, player_id: "old", metadata: {} },
          { pick_no: 1, draft_slot: 1, player_id: "first", metadata: {} },
          { pick_no: 2, draft_slot: 2, player_id: "replacement", metadata: {} },
        ],
      },
    },
    settings: { active_ranking_profile_id: "profile-one" },
  });

  assert.deepEqual(
    result.state.draft_sessions["draft-one"].manual_picks.map((pick) => [pick.pick_no, pick.player_id]),
    [[1, "first"], [2, "replacement"]],
  );
});

test("draft sessions retain bounded config and cached live recovery state", () => {
  const result = Storage.migrateState({
    schema_version: 1,
    user: {},
    ranking_profiles: [sampleProfile()],
    draft_sessions: {
      "draft-live": {
        draft_id: "draft-live",
        ranking_profile_id: "profile-one",
        mode: "live",
        draft_config: {
          name: " Live fixture ",
          type: "snake",
          status: "drafting",
          format: "superflex",
          teams: 12,
          rounds: 17,
          reversal_round: 3,
          pick_timer: 120,
          user_slot: 7,
          user_roster_id: 107,
          traded_picks: [{ round: 4, roster_id: 104, owner_id: 107 }],
          roster_positions: ["QB", "SUPER_FLEX", "BN"],
          scoring: { rec: 1, __proto__: 9 },
          ignored: true,
        },
        cached_live_picks: [
          { pick_no: 2, player_id: "second", metadata: { first_name: "Second", position: "WR" } },
          { pick_no: 1, draft_slot: 1, roster_id: 101, picked_by: "coach", player_id: "first", metadata: {} },
          { pick_no: 2, player_id: "replacement", metadata: { team: "TST" } },
        ],
        ui: { active_tab: "manual", fullscreen: true, dock: "right" },
        last_synced_at: "2026-08-29T20:00:00.000Z",
      },
    },
    settings: { active_ranking_profile_id: "profile-one" },
  });
  const session = result.state.draft_sessions["draft-live"];
  assert.equal(session.draft_config.name, "Live fixture");
  assert.equal(session.draft_config.reversal_round, 3);
  assert.equal(session.draft_config.user_slot, 7);
  assert.deepEqual(session.draft_config.traded_picks, [{ round: 4, roster_id: 104, owner_id: 107 }]);
  assert.deepEqual(session.draft_config.scoring, { rec: 1 });
  assert.deepEqual(session.cached_live_picks.map((pick) => [pick.pick_no, pick.player_id]), [[1, "first"], [2, "replacement"]]);
  assert.equal(session.cached_live_picks[1].draft_slot, null);
  assert.equal(session.last_synced_at, "2026-08-29T20:00:00.000Z");
  assert.equal(session.ui.active_tab, "manual");
  assert.equal(Object.hasOwn(session.draft_config, "ignored"), false);
  assert.deepEqual(Storage.validateState(result.state), []);
});

test("public ranking pack strips local and draft identifiers", () => {
  const profile = sampleProfile({
    local_account_id: "local-user",
    draft_id: "draft-private",
    players: [samplePlayer({ internal_note: "discard" })],
  });
  const pack = Storage.publicRankingPack(profile);
  const serialized = JSON.stringify(pack);

  assert.deepEqual(Object.keys(pack), ["schema_version", "name", "format", "players"]);
  assert.equal(serialized.includes("local-user"), false);
  assert.equal(serialized.includes("draft-private"), false);
  assert.equal(serialized.includes("internal_note"), false);
  assert.equal(pack.players[0].sleeper_id, "sample-qb");
});

test("public ranking pack refuses an empty or invalid board", () => {
  assert.throws(
    () => Storage.publicRankingPack(sampleProfile({ players: [] })),
    /at least one valid player/,
  );
});

test("reserved object keys cannot enter session or scoring records", () => {
  const raw = JSON.parse(`{
    "schema_version": 1,
    "user": {},
    "ranking_profiles": [{
      "id": "profile-one",
      "name": "Safe Board",
      "format": "custom",
      "source": "manual",
      "league_settings": {"scoring": {"__proto__": 7, "pass_td": 4}},
      "players": [{"rank": 1, "player": "Safe Player", "position": "QB", "sleeper_id": "safe-qb"}]
    }],
    "draft_sessions": {
      "__proto__": {"draft_id": "__proto__"},
      "draft-safe": {"draft_id": "draft-safe", "ranking_profile_id": "missing"}
    },
    "settings": {}
  }`);
  const result = Storage.migrateState(raw);

  assert.deepEqual(Object.keys(result.state.draft_sessions), ["draft-safe"]);
  assert.equal(result.state.draft_sessions["draft-safe"].ranking_profile_id, null);
  assert.deepEqual(result.state.ranking_profiles[0].league_settings.scoring, { pass_td: 4 });
  assert.equal(Object.getPrototypeOf(result.state.draft_sessions), Object.prototype);
  assert.deepEqual(Storage.validateState(result.state), []);
});
