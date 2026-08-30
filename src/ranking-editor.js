(function initRankingEditor(globalScope) {
  "use strict";

  const POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
  const EDITABLE_FIELDS = new Set(["tier", "notes", "adp"]);

  function cleanText(value, maximum = 300) {
    return String(value == null ? "" : value).trim().slice(0, maximum);
  }

  function clonePlayers(players) {
    return players.map((player) => ({ ...player }));
  }

  function normalizePlayers(players) {
    const seen = new Set();
    return (Array.isArray(players) ? players : [])
      .filter((player) => {
        const id = cleanText(player?.sleeper_id, 80);
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .sort((left, right) => Number(left.rank || 9999) - Number(right.rank || 9999))
      .map((player, index) => ({
        rank: index + 1,
        player: cleanText(player.player, 100),
        position: POSITIONS.has(cleanText(player.position, 5).toUpperCase())
          ? cleanText(player.position, 5).toUpperCase()
          : "",
        team: cleanText(player.team, 5).toUpperCase(),
        sleeper_id: cleanText(player.sleeper_id, 80),
        adp: player.adp == null || !Number.isFinite(Number(player.adp)) ? null : Math.max(0, Number(player.adp)),
        tier: player.tier == null || !Number.isFinite(Number(player.tier))
          ? null
          : Math.max(1, Math.trunc(Number(player.tier))),
        notes: cleanText(player.notes, 300),
      }));
  }

  function createEditorState(profile, options = {}) {
    if (!profile || typeof profile !== "object" || !profile.id) throw new TypeError("A ranking profile is required");
    return {
      profile_id: profile.id,
      players: normalizePlayers(profile.players),
      undo_stack: [],
      redo_stack: [],
      history_limit: Math.max(1, Math.min(200, Number(options.historyLimit) || 60)),
      revision: 0,
      last_action: "loaded",
    };
  }

  function samePlayers(left, right) {
    if (left.length !== right.length) return false;
    return left.every((player, index) => (
      player.rank === right[index].rank
      && player.sleeper_id === right[index].sleeper_id
      && player.tier === right[index].tier
      && player.notes === right[index].notes
      && player.adp === right[index].adp
    ));
  }

  function commit(state, nextPlayers, action) {
    const normalized = normalizePlayers(nextPlayers.map((player, index) => ({
      ...player,
      rank: index + 1,
    })));
    if (samePlayers(state.players, normalized)) return state;
    const undoStack = [...state.undo_stack, clonePlayers(state.players)].slice(-state.history_limit);
    return {
      ...state,
      players: normalized,
      undo_stack: undoStack,
      redo_stack: [],
      revision: state.revision + 1,
      last_action: cleanText(action, 80) || "edited",
    };
  }

  function movePlayer(state, sleeperId, targetRank) {
    const id = cleanText(sleeperId, 80);
    const sourceIndex = state.players.findIndex((player) => player.sleeper_id === id);
    if (sourceIndex < 0 || !state.players.length) return state;
    const targetIndex = Math.max(0, Math.min(state.players.length - 1, Math.trunc(Number(targetRank) || 1) - 1));
    if (sourceIndex === targetIndex) return state;
    const next = clonePlayers(state.players);
    const [player] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, player);
    return commit(state, next, `moved ${id} to ${targetIndex + 1}`);
  }

  function moveBefore(state, sleeperId, targetSleeperId) {
    const sourceId = cleanText(sleeperId, 80);
    const targetId = cleanText(targetSleeperId, 80);
    if (!sourceId || !targetId || sourceId === targetId) return state;
    const sourceIndex = state.players.findIndex((player) => player.sleeper_id === sourceId);
    const targetIndex = state.players.findIndex((player) => player.sleeper_id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return state;
    const next = clonePlayers(state.players);
    const [player] = next.splice(sourceIndex, 1);
    const adjustedTarget = next.findIndex((candidate) => candidate.sleeper_id === targetId);
    next.splice(adjustedTarget, 0, player);
    return commit(state, next, `moved ${sourceId} before ${targetId}`);
  }

  function moveBy(state, sleeperId, delta) {
    const player = state.players.find((candidate) => candidate.sleeper_id === cleanText(sleeperId, 80));
    if (!player) return state;
    return movePlayer(state, player.sleeper_id, player.rank + Math.trunc(Number(delta) || 0));
  }

  function updatePlayerFields(state, sleeperId, updates) {
    const id = cleanText(sleeperId, 80);
    if (!state.players.some((player) => player.sleeper_id === id)) return state;
    const allowed = {};
    for (const [field, value] of Object.entries(updates || {})) {
      if (!EDITABLE_FIELDS.has(field)) continue;
      if (field === "notes") allowed.notes = cleanText(value, 300);
      if (field === "tier") allowed.tier = value == null || value === ""
        ? null
        : Math.max(1, Math.trunc(Number(value) || 1));
      if (field === "adp") allowed.adp = value == null || value === ""
        ? null
        : Math.max(0, Number(value) || 0);
    }
    const next = state.players.map((player) => player.sleeper_id === id ? { ...player, ...allowed } : { ...player });
    return commit(state, next, `updated ${id}`);
  }

  function undo(state) {
    if (!state.undo_stack.length) return state;
    const previous = state.undo_stack[state.undo_stack.length - 1];
    return {
      ...state,
      players: clonePlayers(previous),
      undo_stack: state.undo_stack.slice(0, -1),
      redo_stack: [...state.redo_stack, clonePlayers(state.players)].slice(-state.history_limit),
      revision: state.revision + 1,
      last_action: "undo",
    };
  }

  function redo(state) {
    if (!state.redo_stack.length) return state;
    const next = state.redo_stack[state.redo_stack.length - 1];
    return {
      ...state,
      players: clonePlayers(next),
      undo_stack: [...state.undo_stack, clonePlayers(state.players)].slice(-state.history_limit),
      redo_stack: state.redo_stack.slice(0, -1),
      revision: state.revision + 1,
      last_action: "redo",
    };
  }

  function normalizeSearch(value) {
    return cleanText(value, 120).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function filteredPlayers(state, options = {}) {
    const position = cleanText(options.position, 5).toUpperCase();
    const query = normalizeSearch(options.query);
    return state.players.filter((player) => {
      if (position && position !== "ALL" && player.position !== position) return false;
      if (!query) return true;
      const haystack = normalizeSearch(`${player.player} ${player.position} ${player.team} ${player.sleeper_id} ${player.notes}`);
      return haystack.includes(query);
    });
  }

  function validateEditorState(state) {
    const errors = [];
    if (!state || typeof state !== "object") return ["editor state must be an object"];
    if (!state.profile_id) errors.push("profile_id is required");
    const ids = new Set();
    (state.players || []).forEach((player, index) => {
      if (player.rank !== index + 1) errors.push("ranks must remain contiguous");
      if (!player.sleeper_id || ids.has(player.sleeper_id)) errors.push("player ids must remain unique");
      ids.add(player.sleeper_id);
    });
    return [...new Set(errors)];
  }

  const api = {
    createEditorState,
    filteredPlayers,
    moveBefore,
    moveBy,
    movePlayer,
    normalizePlayers,
    redo,
    undo,
    updatePlayerFields,
    validateEditorState,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.SDCCRankingEditor = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
