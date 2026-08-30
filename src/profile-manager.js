(function initProfileManager(globalScope, factory) {
  "use strict";
  const api = factory(
    typeof module !== "undefined" && module.exports
      ? require("./storage.js")
      : globalScope.SDCCStorage,
  );
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.SDCCProfileManager = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function profileManagerFactory(Storage) {
  "use strict";

  const FORMATS = new Set(["one_qb", "superflex", "best_ball", "custom"]);
  const POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

  function cleanText(value, maximum = 100) {
    return String(value == null ? "" : value).trim().slice(0, maximum);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function safeId(value) {
    return cleanText(value, 60).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "profile";
  }

  function uniqueName(state, requested) {
    const base = cleanText(requested, 80) || "Ranking profile";
    const existing = new Set(state.ranking_profiles.map((profile) => profile.name.toLowerCase()));
    if (!existing.has(base.toLowerCase())) return base;
    let suffix = 2;
    while (existing.has(`${base} ${suffix}`.toLowerCase())) suffix += 1;
    return `${base} ${suffix}`;
  }

  function defaultRoster(format) {
    if (format === "superflex") {
      return ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPER_FLEX", "K", "DEF", ...Array(7).fill("BN")];
    }
    if (format === "best_ball") {
      return ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "FLEX", ...Array(9).fill("BN")];
    }
    return ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", ...Array(7).fill("BN")];
  }

  function deterministicId(state, name, suffix = Date.now().toString(36)) {
    const base = `${safeId(name)}-${safeId(suffix)}`;
    const ids = new Set(state.ranking_profiles.map((profile) => profile.id));
    if (!ids.has(base)) return base;
    let number = 2;
    while (ids.has(`${base}-${number}`)) number += 1;
    return `${base}-${number}`;
  }

  function makeProfile(state, options = {}) {
    if (state.ranking_profiles.length >= 50) throw new TypeError("The 50-profile limit has been reached");
    const format = FORMATS.has(options.format) ? options.format : "custom";
    const name = uniqueName(state, options.name);
    const now = options.now || new Date().toISOString();
    return {
      id: options.id || deterministicId(state, name, options.idSuffix),
      name,
      format,
      source: options.source || "manual",
      created_at: now,
      updated_at: now,
      league_settings: clone(options.league_settings || {
        teams: null,
        roster_positions: defaultRoster(format),
        scoring: {},
      }),
      players: clone(options.players || []),
    };
  }

  function normalizeState(raw) {
    const { state } = Storage.migrateState(raw);
    const errors = Storage.validateState(state);
    if (errors.length) throw new TypeError(errors[0]);
    return state;
  }

  function addProfile(rawState, options = {}) {
    const state = normalizeState(rawState);
    const profile = makeProfile(state, options);
    return normalizeState({
      ...state,
      ranking_profiles: [...state.ranking_profiles, profile],
      settings: { ...state.settings, active_ranking_profile_id: profile.id },
    });
  }

  function cloneProfile(rawState, profileId, options = {}) {
    const state = normalizeState(rawState);
    const source = state.ranking_profiles.find((profile) => profile.id === profileId);
    if (!source) throw new TypeError("Profile to clone was not found");
    return addProfile(state, {
      ...clone(source),
      id: options.id,
      idSuffix: options.idSuffix,
      name: options.name || `${source.name} copy`,
      source: "manual",
      now: options.now,
    });
  }

  function renameProfile(rawState, profileId, requestedName, now = new Date().toISOString()) {
    const state = normalizeState(rawState);
    if (!state.ranking_profiles.some((profile) => profile.id === profileId)) throw new TypeError("Profile to rename was not found");
    const otherProfiles = { ...state, ranking_profiles: state.ranking_profiles.filter((profile) => profile.id !== profileId) };
    const name = uniqueName(otherProfiles, requestedName);
    return normalizeState({
      ...state,
      ranking_profiles: state.ranking_profiles.map((profile) => profile.id === profileId
        ? { ...profile, name, updated_at: now }
        : profile),
    });
  }

  function deleteProfile(rawState, profileId) {
    const state = normalizeState(rawState);
    if (!state.ranking_profiles.some((profile) => profile.id === profileId)) return state;
    const profiles = state.ranking_profiles.filter((profile) => profile.id !== profileId);
    const nextActive = state.settings.active_ranking_profile_id === profileId
      ? profiles[0]?.id || null
      : state.settings.active_ranking_profile_id;
    const sessions = Object.fromEntries(Object.entries(state.draft_sessions).map(([draftId, session]) => [
      draftId,
      session.ranking_profile_id === profileId ? { ...session, ranking_profile_id: null } : session,
    ]));
    return normalizeState({
      ...state,
      ranking_profiles: profiles,
      draft_sessions: sessions,
      settings: { ...state.settings, active_ranking_profile_id: nextActive },
    });
  }

  function setActiveProfile(rawState, profileId) {
    const state = normalizeState(rawState);
    if (profileId && !state.ranking_profiles.some((profile) => profile.id === profileId)) {
      throw new TypeError("Active profile was not found");
    }
    return normalizeState({
      ...state,
      settings: { ...state.settings, active_ranking_profile_id: profileId || null },
    });
  }

  function updateProfilePlayers(rawState, profileId, players, now = new Date().toISOString()) {
    const state = normalizeState(rawState);
    if (!state.ranking_profiles.some((profile) => profile.id === profileId)) throw new TypeError("Profile to update was not found");
    return normalizeState({
      ...state,
      ranking_profiles: state.ranking_profiles.map((profile) => profile.id === profileId
        ? { ...profile, players: clone(players), updated_at: now }
        : profile),
    });
  }

  function strictPack(pack) {
    if (!pack || typeof pack !== "object" || Array.isArray(pack)) throw new TypeError("Ranking pack must be an object");
    if (pack.schema_version !== 1) throw new TypeError("Ranking pack schema must be 1");
    if (!Array.isArray(pack.players) || pack.players.length < 1 || pack.players.length > 1000) {
      throw new TypeError("Ranking pack needs 1 to 1,000 players");
    }
    const ids = new Set();
    pack.players.forEach((player, index) => {
      const id = cleanText(player?.sleeper_id, 80);
      const name = cleanText(player?.player, 100);
      const position = cleanText(player?.position, 5).toUpperCase();
      if (!id || !name || !POSITIONS.has(position)) throw new TypeError(`Ranking pack player ${index + 1} is invalid`);
      if (ids.has(id)) throw new TypeError(`Ranking pack contains duplicate player ${id}`);
      ids.add(id);
    });
    return Storage.publicRankingPack(pack);
  }

  function importRankingPack(rawState, pack, options = {}) {
    const safePack = strictPack(pack);
    return addProfile(rawState, {
      name: options.name || safePack.name,
      format: safePack.format,
      source: "json",
      players: safePack.players,
      now: options.now,
      id: options.id,
      idSuffix: options.idSuffix,
    });
  }

  function exportRankingPack(rawState, profileId) {
    const state = normalizeState(rawState);
    const profile = state.ranking_profiles.find((candidate) => candidate.id === profileId);
    if (!profile) throw new TypeError("Profile to export was not found");
    return Storage.publicRankingPack(profile);
  }

  return {
    addProfile,
    cloneProfile,
    deleteProfile,
    exportRankingPack,
    importRankingPack,
    renameProfile,
    setActiveProfile,
    updateProfilePlayers,
  };
});

