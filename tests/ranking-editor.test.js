const test = require("node:test");
const assert = require("node:assert/strict");

const Editor = require("../src/ranking-editor.js");

function profile(count = 6) {
  return {
    id: "editor-fixture",
    players: Array.from({ length: count }, (_value, index) => ({
      rank: index + 1,
      player: `Player ${index + 1}`,
      position: ["QB", "RB", "WR", "TE"][index % 4],
      team: `T${index + 1}`,
      sleeper_id: `p-${index + 1}`,
      adp: index + 1.5,
      tier: Math.floor(index / 2) + 1,
      notes: index === 2 ? "target" : "",
    })),
  };
}

test("move by target rank preserves contiguous unique rows", () => {
  const state = Editor.movePlayer(Editor.createEditorState(profile()), "p-5", 2);
  assert.deepEqual(state.players.map((player) => player.sleeper_id), ["p-1", "p-5", "p-2", "p-3", "p-4", "p-6"]);
  assert.deepEqual(state.players.map((player) => player.rank), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(Editor.validateEditorState(state), []);
});

test("drag-style move before and keyboard-style delta share history", () => {
  let state = Editor.createEditorState(profile());
  state = Editor.moveBefore(state, "p-6", "p-2");
  state = Editor.moveBy(state, "p-1", 2);
  assert.deepEqual(state.players.map((player) => player.sleeper_id), ["p-6", "p-2", "p-1", "p-3", "p-4", "p-5"]);
  assert.equal(state.undo_stack.length, 2);
});

test("tier, notes, and ADP edits are bounded and reversible", () => {
  let state = Editor.createEditorState(profile());
  state = Editor.updatePlayerFields(state, "p-2", { tier: 0, notes: "x".repeat(500), adp: -2, player: "blocked" });
  const edited = state.players.find((player) => player.sleeper_id === "p-2");
  assert.equal(edited.tier, 1);
  assert.equal(edited.notes.length, 300);
  assert.equal(edited.adp, 0);
  assert.equal(edited.player, "Player 2");
  state = Editor.undo(state);
  assert.equal(state.players.find((player) => player.sleeper_id === "p-2").notes, "");
  state = Editor.redo(state);
  assert.equal(state.players.find((player) => player.sleeper_id === "p-2").notes.length, 300);
});

test("new edit after undo clears redo history", () => {
  let state = Editor.movePlayer(Editor.createEditorState(profile()), "p-4", 1);
  state = Editor.undo(state);
  assert.equal(state.redo_stack.length, 1);
  state = Editor.updatePlayerFields(state, "p-1", { tier: 9 });
  assert.equal(state.redo_stack.length, 0);
  assert.equal(Editor.redo(state), state);
});

test("history retains only the configured number of snapshots", () => {
  let state = Editor.createEditorState(profile(), { historyLimit: 2 });
  state = Editor.movePlayer(state, "p-6", 1);
  state = Editor.movePlayer(state, "p-5", 1);
  state = Editor.movePlayer(state, "p-4", 1);
  assert.equal(state.undo_stack.length, 2);
});

test("search and position filters do not mutate ranking order", () => {
  const state = Editor.createEditorState(profile());
  const original = state.players.map((player) => player.sleeper_id);
  assert.deepEqual(Editor.filteredPlayers(state, { position: "WR" }).map((player) => player.sleeper_id), ["p-3"]);
  assert.deepEqual(Editor.filteredPlayers(state, { query: "target" }).map((player) => player.sleeper_id), ["p-3"]);
  assert.deepEqual(state.players.map((player) => player.sleeper_id), original);
});

