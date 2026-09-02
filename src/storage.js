(function initStorage(globalScope) {
  "use strict";

  const STORAGE_KEY = "sleeperDraftCommandCenter";
  const STORAGE_VERSION = 1;
  const MAX_STATE_BYTES = 6 * 1024 * 1024;
  const MAX_CATALOG_CACHE_BYTES = 3 * 1024 * 1024;
  const MAX_DRAFT_PICKS = 1600;
  const FORMATS = new Set(["one_qb", "superflex", "best_ball", "custom"]);
  const SOURCES = new Set(["public_adp", "paste", "csv", "json", "manual"]);
  const POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
  const TABS = new Set(["shortlist", "board", "room", "roster", "manual", "offline"]);
  const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

  class UnsupportedStorageVersionError extends Error {
    constructor(version) {
      super(`Storage schema ${version} is newer than supported schema ${STORAGE_VERSION}`);
      this.name = "UnsupportedStorageVersionError";
      this.code = "UNSUPPORTED_STORAGE_VERSION";
      this.version = version;
    }
  }

  class StorageBudgetError extends Error {
    constructor(bytes, maximum = MAX_STATE_BYTES) {
      super(`Local state is too large (${bytes} bytes; limit ${maximum})`);
      this.name = "StorageBudgetError";
      this.code = "STORAGE_BUDGET_EXCEEDED";
      this.bytes = bytes;
      this.maximum = maximum;
    }
  }

  function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function serializedBytes(value) {
    const serialized = JSON.stringify(value);
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(serialized).byteLength;
    if (typeof Buffer !== "undefined") return Buffer.byteLength(serialized, "utf8");
    return unescape(encodeURIComponent(serialized)).length;
  }

  function assertStateBudget(state, maximum = MAX_STATE_BYTES) {
    const bytes = serializedBytes(state);
    if (bytes > maximum) throw new StorageBudgetError(bytes, maximum);
    return bytes;
  }

  function cleanString(value, maximum = 80) {
    return String(value == null ? "" : value).trim().slice(0, maximum);
  }

  function cleanId(value, fallback = "") {
    const cleaned = cleanString(value, 80).replace(/[^A-Za-z0-9._-]+/g, "-");
    const result = cleaned.replace(/^-+|-+$/g, "");
    return result && !RESERVED_KEYS.has(result.toLowerCase()) ? result : fallback;
  }

  function integerInRange(value, minimum, maximum, fallback = null) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
    return parsed;
  }

  function numberAtLeast(value, minimum, fallback = null) {
    if (value == null || value === "") return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
  }

  function nullableTimestamp(value) {
    const text = cleanString(value, 40);
    return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : null;
  }

  function uniqueStrings(values, maximum = 1000) {
    const seen = new Set();
    const result = [];
    for (const value of Array.isArray(values) ? values : []) {
      const text = cleanString(value, 80);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      result.push(text);
      if (result.length >= maximum) break;
    }
    return result;
  }

  function createDefaultState() {
    return {
      schema_version: STORAGE_VERSION,
      user: { username: "", user_id: "" },
      ranking_profiles: [],
      draft_sessions: {},
      settings: {
        active_ranking_profile_id: null,
        last_draft_id: null,
        theme: "command_center",
        dock: "right",
        poll_interval_ms: 300,
      },
    };
  }

  function normalizePlayer(raw, index, warnings, context) {
    if (!isObject(raw)) {
      warnings.push(`${context}: dropped non-object player at index ${index}`);
      return null;
    }
    const player = cleanString(raw.player ?? raw.name ?? raw.full_name, 100);
    const sleeperId = cleanString(raw.sleeper_id ?? raw.sleeperId ?? raw.player_id, 80);
    const position = cleanString(raw.position, 5).toUpperCase();
    if (!player || !sleeperId || !POSITIONS.has(position)) {
      warnings.push(`${context}: dropped incomplete player at index ${index}`);
      return null;
    }
    return {
      rank: integerInRange(raw.rank, 1, 1000, index + 1),
      player,
      position,
      team: cleanString(raw.team, 5).toUpperCase(),
      sleeper_id: sleeperId,
      adp: numberAtLeast(raw.adp ?? raw.sleeper_adp, 0, null),
      tier: integerInRange(raw.tier ?? raw.overall_tier, 1, 1000, null),
      notes: cleanString(raw.notes, 300),
    };
  }

  function normalizePlayers(rawPlayers, warnings, context) {
    const candidates = (Array.isArray(rawPlayers) ? rawPlayers : []).slice(0, 1000);
    const bySleeperId = new Map();
    candidates.forEach((raw, index) => {
      const player = normalizePlayer(raw, index, warnings, context);
      if (!player) return;
      if (bySleeperId.has(player.sleeper_id)) {
        warnings.push(`${context}: dropped duplicate player ${player.sleeper_id}`);
        return;
      }
      bySleeperId.set(player.sleeper_id, player);
    });
    return [...bySleeperId.values()]
      .sort((left, right) => left.rank - right.rank || left.player.localeCompare(right.player))
      .map((player, index) => ({ ...player, rank: index + 1 }));
  }

  function normalizeLeagueSettings(raw) {
    const source = isObject(raw) ? raw : {};
    const scoringSource = isObject(source.scoring) ? source.scoring : {};
    const scoring = {};
    for (const [key, value] of Object.entries(scoringSource).slice(0, 150)) {
      const name = cleanString(key, 60);
      const number = Number(value);
      if (name && !RESERVED_KEYS.has(name.toLowerCase()) && Number.isFinite(number)) {
        scoring[name] = number;
      }
    }
    return {
      teams: integerInRange(source.teams, 2, 32, null),
      roster_positions: (Array.isArray(source.roster_positions) ? source.roster_positions : [])
        .slice(0, 40)
        .map((position) => cleanString(position, 30).toUpperCase())
        .filter(Boolean),
      scoring,
    };
  }

  function normalizeProfile(raw, index, warnings) {
    if (!isObject(raw)) {
      warnings.push(`profiles: dropped non-object profile at index ${index}`);
      return null;
    }
    const id = cleanId(raw.id ?? raw.profile_id, `profile-${index + 1}`);
    const format = FORMATS.has(raw.format) ? raw.format : "custom";
    const source = SOURCES.has(raw.source) ? raw.source : "manual";
    return {
      id,
      name: cleanString(raw.name, 80) || `Ranking profile ${index + 1}`,
      format,
      source,
      created_at: nullableTimestamp(raw.created_at ?? raw.createdAt),
      updated_at: nullableTimestamp(raw.updated_at ?? raw.updatedAt),
      league_settings: normalizeLeagueSettings(raw.league_settings ?? raw.leagueSettings),
      players: normalizePlayers(raw.players, warnings, `profile ${id}`),
    };
  }

  function normalizeProfiles(rawProfiles, warnings) {
    const profiles = [];
    const seen = new Set();
    (Array.isArray(rawProfiles) ? rawProfiles : []).slice(0, 50).forEach((raw, index) => {
      const profile = normalizeProfile(raw, index, warnings);
      if (!profile) return;
      if (seen.has(profile.id)) {
        warnings.push(`profiles: dropped duplicate profile ${profile.id}`);
        return;
      }
      seen.add(profile.id);
      profiles.push(profile);
    });
    return profiles;
  }

  function normalizeManualPick(raw, index, warnings, context) {
    if (!isObject(raw)) {
      warnings.push(`${context}: dropped non-object manual pick at index ${index}`);
      return null;
    }
    const pickNumber = integerInRange(raw.pick_no ?? raw.pickNo, 1, MAX_DRAFT_PICKS, null);
    const draftSlot = integerInRange(raw.draft_slot ?? raw.draftSlot, 1, 32, null);
    const playerId = cleanString(raw.player_id ?? raw.playerId, 80);
    if (pickNumber == null || draftSlot == null || !playerId) {
      warnings.push(`${context}: dropped incomplete manual pick at index ${index}`);
      return null;
    }
    const metadata = isObject(raw.metadata) ? raw.metadata : {};
    return {
      pick_no: pickNumber,
      draft_slot: draftSlot,
      roster_id: integerInRange(raw.roster_id ?? raw.rosterId, 1, Number.MAX_SAFE_INTEGER, null),
      picked_by: cleanString(raw.picked_by ?? raw.pickedBy, 80),
      player_id: playerId,
      metadata: {
        first_name: cleanString(metadata.first_name ?? metadata.firstName, 50),
        last_name: cleanString(metadata.last_name ?? metadata.lastName, 80),
        position: cleanString(metadata.position, 5).toUpperCase(),
        team: cleanString(metadata.team, 5).toUpperCase(),
      },
    };
  }

  function normalizeManualPicks(rawPicks, warnings, context) {
    const byPickNumber = new Map();
    (Array.isArray(rawPicks) ? rawPicks : []).slice(0, MAX_DRAFT_PICKS).forEach((raw, index) => {
      const pick = normalizeManualPick(raw, index, warnings, context);
      if (!pick) return;
      if (byPickNumber.has(pick.pick_no)) {
        warnings.push(`${context}: replaced duplicate manual pick ${pick.pick_no}`);
      }
      byPickNumber.set(pick.pick_no, pick);
    });
    return [...byPickNumber.values()].sort((left, right) => left.pick_no - right.pick_no);
  }

  function normalizeCachedPick(raw, index, warnings, context) {
    if (!isObject(raw)) {
      warnings.push(`${context}: dropped non-object cached pick at index ${index}`);
      return null;
    }
    const pickNumber = integerInRange(raw.pick_no ?? raw.pickNo, 1, MAX_DRAFT_PICKS, null);
    const playerId = cleanString(raw.player_id ?? raw.playerId ?? raw.metadata?.player_id, 80);
    if (pickNumber == null || !playerId) {
      warnings.push(`${context}: dropped incomplete cached pick at index ${index}`);
      return null;
    }
    const metadata = isObject(raw.metadata) ? raw.metadata : {};
    return {
      pick_no: pickNumber,
      draft_slot: integerInRange(raw.draft_slot ?? raw.draftSlot, 1, 32, null),
      roster_id: integerInRange(raw.roster_id ?? raw.rosterId, 1, Number.MAX_SAFE_INTEGER, null),
      picked_by: cleanString(raw.picked_by ?? raw.pickedBy, 80),
      player_id: playerId,
      metadata: {
        first_name: cleanString(metadata.first_name ?? metadata.firstName, 50),
        last_name: cleanString(metadata.last_name ?? metadata.lastName, 80),
        position: cleanString(metadata.position, 5).toUpperCase(),
        team: cleanString(metadata.team, 5).toUpperCase(),
      },
    };
  }

  function normalizeCachedPicks(rawPicks, warnings, context) {
    const byPickNumber = new Map();
    (Array.isArray(rawPicks) ? rawPicks : []).slice(0, MAX_DRAFT_PICKS).forEach((raw, index) => {
      const pick = normalizeCachedPick(raw, index, warnings, context);
      if (!pick) return;
      byPickNumber.set(pick.pick_no, pick);
    });
    return [...byPickNumber.values()].sort((left, right) => left.pick_no - right.pick_no);
  }

  function normalizeDraftConfig(raw) {
    const source = isObject(raw) ? raw : {};
    const format = FORMATS.has(source.format) ? source.format : "custom";
    const rounds = integerInRange(source.rounds, 1, 50, null);
    const reversal = integerInRange(source.reversal_round ?? source.reversalRound, 0, 50, 0);
    const tradedPicks = [];
    const seenTradedPicks = new Set();
    const rawTradedPicks = source.traded_picks ?? source.tradedPicks;
    for (const candidate of (Array.isArray(rawTradedPicks) ? rawTradedPicks : []).slice(0, MAX_DRAFT_PICKS)) {
      const round = integerInRange(candidate?.round, 1, rounds || 50, null);
      const rosterId = integerInRange(candidate?.roster_id ?? candidate?.rosterId, 1, Number.MAX_SAFE_INTEGER, null);
      const ownerId = integerInRange(candidate?.owner_id ?? candidate?.ownerId, 1, Number.MAX_SAFE_INTEGER, null);
      const key = `${round}:${rosterId}`;
      if (!round || !rosterId || !ownerId || seenTradedPicks.has(key)) continue;
      seenTradedPicks.add(key);
      tradedPicks.push({ round, roster_id: rosterId, owner_id: ownerId });
    }
    return {
      name: cleanString(source.name, 80) || "Draft room",
      type: source.type === "snake" ? "snake" : "snake",
      status: cleanString(source.status, 30) || "unknown",
      format,
      teams: integerInRange(source.teams, 2, 32, null),
      rounds,
      reversal_round: reversal === 0 || (rounds != null && reversal >= 3 && reversal <= rounds) ? reversal : 0,
      pick_timer: integerInRange(source.pick_timer ?? source.pickTimer, 0, 86400, null),
      user_slot: integerInRange(source.user_slot ?? source.userSlot, 1, 32, null),
      user_roster_id: integerInRange(source.user_roster_id ?? source.userRosterId, 1, Number.MAX_SAFE_INTEGER, null),
      traded_picks: tradedPicks,
      roster_positions: (Array.isArray(source.roster_positions) ? source.roster_positions : [])
        .slice(0, 40)
        .map((position) => cleanString(position, 30).toUpperCase())
        .filter(Boolean),
      scoring: normalizeLeagueSettings({ scoring: source.scoring }).scoring,
    };
  }

  function normalizeSession(raw, draftId, warnings) {
    const source = isObject(raw) ? raw : {};
    const cleanDraftId = cleanId(source.draft_id ?? source.draftId ?? draftId);
    if (!cleanDraftId) {
      warnings.push(`sessions: dropped session with invalid draft id ${draftId}`);
      return null;
    }
    const ui = isObject(source.ui) ? source.ui : {};
    return {
      draft_id: cleanDraftId,
      league_id: cleanString(source.league_id ?? source.leagueId, 80),
      ranking_profile_id: cleanId(
        source.ranking_profile_id ?? source.profileId,
        "",
      ) || null,
      mode: source.mode === "manual" ? "manual" : "live",
      manual_picks: normalizeManualPicks(
        source.manual_picks ?? source.picks,
        warnings,
        `session ${cleanDraftId}`,
      ),
      cached_live_picks: normalizeCachedPicks(
        source.cached_live_picks ?? source.cachedLivePicks,
        warnings,
        `session ${cleanDraftId}`,
      ),
      draft_config: normalizeDraftConfig(source.draft_config ?? source.draftConfig),
      pinned_player_ids: uniqueStrings(source.pinned_player_ids ?? source.pinnedPlayerIds),
      ui: {
        fullscreen: Boolean(ui.fullscreen ?? source.fullscreen),
        dock: (ui.dock ?? source.dock) === "left" ? "left" : "right",
        active_tab: TABS.has(ui.active_tab ?? ui.activeTab)
          ? (ui.active_tab ?? ui.activeTab)
          : "shortlist",
      },
      last_synced_at: nullableTimestamp(source.last_synced_at ?? source.lastSyncedAt),
      updated_at: nullableTimestamp(source.updated_at ?? source.updatedAt),
    };
  }

  function normalizeSessions(rawSessions, warnings) {
    const sessions = {};
    const entries = isObject(rawSessions) ? Object.entries(rawSessions).slice(0, 100) : [];
    for (const [draftId, raw] of entries) {
      const session = normalizeSession(raw, draftId, warnings);
      if (!session) continue;
      sessions[session.draft_id] = session;
    }
    return sessions;
  }

  function normalizeV1(raw, warnings) {
    const profiles = normalizeProfiles(raw.ranking_profiles, warnings);
    const profileIds = new Set(profiles.map((profile) => profile.id));
    const sessions = normalizeSessions(raw.draft_sessions, warnings);
    for (const session of Object.values(sessions)) {
      if (session.ranking_profile_id && !profileIds.has(session.ranking_profile_id)) {
        warnings.push(`session ${session.draft_id}: cleared missing ranking profile ${session.ranking_profile_id}`);
        session.ranking_profile_id = null;
      }
    }
    const settings = isObject(raw.settings) ? raw.settings : {};
    let activeProfileId = cleanId(settings.active_ranking_profile_id, "") || null;
    if (activeProfileId && !profileIds.has(activeProfileId)) {
      warnings.push(`settings: cleared missing active profile ${activeProfileId}`);
      activeProfileId = null;
    }
    return {
      schema_version: STORAGE_VERSION,
      user: {
        username: cleanString(raw.user?.username, 50),
        user_id: cleanString(raw.user?.user_id, 80),
      },
      ranking_profiles: profiles,
      draft_sessions: sessions,
      settings: {
        active_ranking_profile_id: activeProfileId,
        last_draft_id: cleanId(settings.last_draft_id, "") || null,
        theme: "command_center",
        dock: settings.dock === "left" ? "left" : "right",
        poll_interval_ms: Number(settings.poll_interval_ms) === 1500
          ? 300
          : integerInRange(settings.poll_interval_ms, 250, 60000, 300),
      },
    };
  }

  function migrateV0(raw, warnings) {
    warnings.push("storage: migrated legacy schema 0 to schema 1");
    const manualDrafts = raw.manualDrafts ?? raw.manual_drafts ?? {};
    const rankingProfiles = raw.ranking_profiles ?? raw.rankings ?? raw.profiles ?? [];
    return normalizeV1({
      schema_version: STORAGE_VERSION,
      user: {
        username: raw.username ?? raw.user?.username,
        user_id: raw.userId ?? raw.user_id ?? raw.user?.user_id,
      },
      ranking_profiles: rankingProfiles,
      draft_sessions: manualDrafts,
      settings: {
        active_ranking_profile_id: raw.activeProfileId ?? raw.settings?.activeProfileId,
        last_draft_id: raw.lastDraftId ?? raw.settings?.lastDraftId,
        dock: raw.dock ?? raw.settings?.dock,
        poll_interval_ms: raw.pollIntervalMs ?? raw.settings?.pollIntervalMs,
      },
    }, warnings);
  }

  function migrateState(raw) {
    const warnings = [];
    if (raw == null) {
      return { state: createDefaultState(), warnings, from_version: null, to_version: STORAGE_VERSION };
    }
    if (!isObject(raw)) {
      warnings.push("storage: reset non-object record");
      return { state: createDefaultState(), warnings, from_version: null, to_version: STORAGE_VERSION };
    }
    const version = raw.schema_version;
    if (Number.isInteger(version) && version > STORAGE_VERSION) {
      throw new UnsupportedStorageVersionError(version);
    }
    if (version === STORAGE_VERSION) {
      return {
        state: normalizeV1(raw, warnings),
        warnings,
        from_version: STORAGE_VERSION,
        to_version: STORAGE_VERSION,
      };
    }
    if (version == null || version === 0) {
      return {
        state: migrateV0(raw, warnings),
        warnings,
        from_version: 0,
        to_version: STORAGE_VERSION,
      };
    }
    warnings.push(`storage: reset invalid schema version ${String(version)}`);
    return { state: createDefaultState(), warnings, from_version: null, to_version: STORAGE_VERSION };
  }

  function validateState(state) {
    const errors = [];
    if (!isObject(state) || state.schema_version !== STORAGE_VERSION) {
      return ["schema_version must be 1"];
    }
    if (!isObject(state.user)) errors.push("user must be an object");
    if (!Array.isArray(state.ranking_profiles)) errors.push("ranking_profiles must be an array");
    if (!isObject(state.draft_sessions)) errors.push("draft_sessions must be an object");
    if (!isObject(state.settings)) errors.push("settings must be an object");
    const profileIds = new Set();
    for (const profile of state.ranking_profiles || []) {
      if (!profile.id || profileIds.has(profile.id)) errors.push("profile ids must be unique");
      profileIds.add(profile.id);
      (profile.players || []).forEach((player, index) => {
        if (player.rank !== index + 1) errors.push(`profile ${profile.id} ranks must be contiguous`);
      });
    }
    for (const [draftId, session] of Object.entries(state.draft_sessions || {})) {
      if (session.draft_id !== draftId) errors.push(`session ${draftId} key must match draft_id`);
      if (session.ranking_profile_id && !profileIds.has(session.ranking_profile_id)) {
        errors.push(`session ${draftId} ranking profile must exist`);
      }
      const pickNumbers = new Set();
      for (const pick of session.manual_picks || []) {
        if (pickNumbers.has(pick.pick_no)) errors.push(`session ${draftId} manual picks must be unique`);
        pickNumbers.add(pick.pick_no);
      }
      const cachedPickNumbers = new Set();
      for (const pick of session.cached_live_picks || []) {
        if (cachedPickNumbers.has(pick.pick_no)) errors.push(`session ${draftId} cached picks must be unique`);
        cachedPickNumbers.add(pick.pick_no);
      }
      if (session.draft_config?.teams != null && session.draft_config.user_slot > session.draft_config.teams) {
        errors.push(`session ${draftId} user slot must fit the draft`);
      }
    }
    return errors;
  }

  function publicRankingPack(profile) {
    const warnings = [];
    const normalized = normalizeProfile(profile, 0, warnings);
    if (!normalized) throw new TypeError("A ranking profile object is required");
    if (!normalized.players.length) throw new TypeError("A ranking profile needs at least one valid player");
    return {
      schema_version: 1,
      name: normalized.name,
      format: normalized.format,
      players: normalized.players.map((player) => ({
        rank: player.rank,
        player: player.player,
        position: player.position,
        team: player.team,
        sleeper_id: player.sleeper_id,
        adp: player.adp,
        tier: player.tier,
        notes: player.notes,
      })),
    };
  }

  const api = {
    MAX_CATALOG_CACHE_BYTES,
    MAX_DRAFT_PICKS,
    MAX_STATE_BYTES,
    STORAGE_KEY,
    STORAGE_VERSION,
    StorageBudgetError,
    UnsupportedStorageVersionError,
    assertStateBudget,
    createDefaultState,
    migrateState,
    publicRankingPack,
    serializedBytes,
    validateState,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.SDCCStorage = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
