const test = require("node:test");
const assert = require("node:assert/strict");

const Storage = require("../src/storage.js");
const StateMerge = require("../src/state-merge.js");

function normalized(raw) {
  return Storage.migrateState(raw).state;
}

function baseState() {
  return normalized({
    schema_version: 1,
    user: { username: "example", user_id: "user-1" },
    ranking_profiles: [{
      id: "profile-a",
      name: "Board A",
      format: "one_qb",
      source: "manual",
      players: [{ rank: 1, player: "Example Player", position: "WR", team: "DET", sleeper_id: "player-1" }],
    }],
    draft_sessions: {},
    settings: { active_ranking_profile_id: "profile-a" },
  });
}

test("three-way merge preserves independent profile and draft-session changes", () => {
  const base = baseState();
  const current = normalized({
    ...base,
    ranking_profiles: base.ranking_profiles.map((profile) => ({ ...profile, name: "Updated board" })),
  });
  const next = normalized({
    ...base,
    draft_sessions: {
      "draft-a": {
        draft_id: "draft-a",
        ranking_profile_id: "profile-a",
        mode: "manual",
        draft_config: { name: "Room", teams: 12, rounds: 17, user_slot: 3 },
      },
    },
    settings: { ...base.settings, last_draft_id: "draft-a" },
  });

  const merged = StateMerge.mergeState(current, base, next);
  assert.equal(merged.ranking_profiles[0].name, "Updated board");
  assert.equal(merged.draft_sessions["draft-a"].draft_id, "draft-a");
  assert.equal(merged.settings.last_draft_id, "draft-a");
});

test("three-way merge rejects divergent edits to the same profile", () => {
  const base = baseState();
  const current = normalized({ ...base, ranking_profiles: [{ ...base.ranking_profiles[0], name: "Window one" }] });
  const next = normalized({ ...base, ranking_profiles: [{ ...base.ranking_profiles[0], name: "Window two" }] });

  assert.throws(
    () => StateMerge.mergeState(current, base, next),
    (error) => error.code === "STATE_CONFLICT" && error.conflicts.includes("ranking_profiles.profile-a"),
  );
});
