const test = require("node:test");
const assert = require("node:assert/strict");

const DraftOrder = require("../src/draft-order.js");

test("normal snake order maps a turn in both directions", () => {
  const picks = DraftOrder.userPickNumbers(9, 12, 4, 0);
  assert.deepEqual(picks, [9, 16, 33, 40]);
  assert.deepEqual(
    picks.map((pick) => DraftOrder.slotForPickNumber(pick, 12, 0)),
    [9, 9, 9, 9],
  );
});

test("third-round reversal repeats the round-two direction before alternating", () => {
  assert.deepEqual(DraftOrder.userPickNumbers(1, 12, 6, 3), [1, 24, 36, 37, 60, 61]);
  for (let round = 1; round <= 6; round += 1) {
    for (let slot = 1; slot <= 12; slot += 1) {
      const pick = DraftOrder.pickNumberForRound(round, slot, 12, 3);
      assert.equal(DraftOrder.slotForPickNumber(pick, 12, 3), slot);
    }
  }
});

test("current pick is the first missing number and draft completion is explicit", () => {
  assert.equal(DraftOrder.currentPickNumber([{ pick_no: 1 }, { pick_no: 3 }], 12, 2), 2);
  const complete = Array.from({ length: 24 }, (_value, index) => ({ pick_no: index + 1 }));
  assert.equal(DraftOrder.currentPickNumber(complete, 12, 2), 25);
  assert.equal(DraftOrder.formatPick(16, 12), "2.04");
});

test("live picks override manual picks by pick number and player identity", () => {
  const live = [
    { pick_no: 1, player_id: "live-one" },
    { pick_no: 3, player_id: "confirmed-player" },
  ];
  const manual = [
    { pick_no: 1, player_id: "manual-one" },
    { pick_no: 2, player_id: "confirmed-player" },
    { pick_no: 4, player_id: "manual-four" },
    { pick_no: 5, player_id: "manual-four" },
  ];
  assert.deepEqual(
    DraftOrder.mergeDraftPicks(live, manual).map((pick) => [pick.pick_no, pick.player_id, pick.source]),
    [[1, "live-one", "live"], [3, "confirmed-player", "live"], [4, "manual-four", "manual"]],
  );
});

test("manual pick uses third-round-reversal slot ownership and metadata", () => {
  const draft = {
    settings: { teams: 12, rounds: 17, reversal_round: 3 },
    slot_to_roster_id: { 1: 101 },
  };
  const player = {
    sleeper_id: "sample-player",
    player: "Sample Receiver",
    position: "WR",
    team: "TST",
  };
  const pick = DraftOrder.manualPickForPlayer(player, 36, draft, { user_id: "coach", slot: 1 });
  assert.equal(pick.draft_slot, 1);
  assert.equal(pick.roster_id, 101);
  assert.equal(pick.picked_by, "coach");
  assert.deepEqual(
    pick.metadata,
    {
      player_id: "sample-player",
      first_name: "Sample",
      last_name: "Receiver",
      position: "WR",
      team: "TST",
    },
  );
});

test("undo removes the highest manual pick without mutating input", () => {
  const original = [{ pick_no: 1, player_id: "one" }, { pick_no: 3, player_id: "three" }];
  const result = DraftOrder.undoLatestManualPick(original);
  assert.deepEqual(result.picks, [{ pick_no: 1, player_id: "one" }]);
  assert.equal(result.removed.player_id, "three");
  assert.equal(original.length, 2);
});

test("invalid dimensions and reversal settings fail safely", () => {
  assert.equal(DraftOrder.pickNumberForRound(1, 1, 1), null);
  assert.deepEqual(DraftOrder.userPickNumbers(13, 12, 17), []);
  assert.deepEqual(
    DraftOrder.validateDraftConfig({ settings: { teams: 12, rounds: 17, reversal_round: 2 } }),
    ["reversal_round must be 0 or a round from 3 through the final round"],
  );
});
