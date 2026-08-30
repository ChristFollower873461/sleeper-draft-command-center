(function initDraftContext(globalScope) {
  "use strict";

  const FORMATS = new Set(["one_qb", "superflex", "best_ball", "custom"]);
  const SLOT_FIELDS = [
    ["QB", ["slots_qb"]],
    ["RB", ["slots_rb"]],
    ["WR", ["slots_wr"]],
    ["TE", ["slots_te"]],
    ["FLEX", ["slots_flex"]],
    ["SUPER_FLEX", ["slots_super_flex", "slots_superflex", "slots_sf"]],
    ["K", ["slots_k"]],
    ["DEF", ["slots_def", "slots_dst"]],
    ["BN", ["slots_bn", "slots_bench"]],
  ];

  class DraftContextError extends Error {
    constructor(errors) {
      super(`Draft context is invalid: ${errors.join("; ")}`);
      this.name = "DraftContextError";
      this.code = "INVALID_DRAFT_CONTEXT";
      this.errors = errors;
    }
  }

  function cleanText(value, maximum = 100) {
    return String(value == null ? "" : value).trim().slice(0, maximum);
  }

  function integer(value, minimum, maximum, fallback = null) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
  }

  function enabled(value) {
    return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
  }

  function safeNumberRecord(raw, limit = 150) {
    const result = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
    for (const [key, value] of Object.entries(raw).slice(0, limit)) {
      const name = cleanText(key, 60);
      const number = Number(value);
      if (name && !["__proto__", "constructor", "prototype"].includes(name.toLowerCase()) && Number.isFinite(number)) {
        result[name] = number;
      }
    }
    return result;
  }

  function rosterFromDraftSettings(settings = {}) {
    const roster = [];
    for (const [position, fields] of SLOT_FIELDS) {
      const count = fields.reduce((found, field) => found ?? integer(settings[field], 0, 40), null) ?? 0;
      for (let index = 0; index < count; index += 1) roster.push(position);
    }
    return roster;
  }

  function defaultRosterPositions(format, rounds = 17) {
    const starters = format === "superflex"
      ? ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPER_FLEX", "K", "DEF"]
      : format === "best_ball"
        ? ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "FLEX"]
        : ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"];
    const total = integer(rounds, 1, 50, 17);
    return [...starters, ...Array(Math.max(0, total - starters.length)).fill("BN")];
  }

  function normalizeRosterPositions(draft, league, profile) {
    const supplied = league?.roster_positions
      || draft?.roster_positions
      || profile?.league_settings?.roster_positions;
    if (Array.isArray(supplied) && supplied.length) {
      return supplied.slice(0, 40).map((position) => cleanText(position, 30).toUpperCase()).filter(Boolean);
    }
    return rosterFromDraftSettings(draft?.settings || {});
  }

  function scoringFromMetadata(metadata = {}) {
    const type = cleanText(metadata.scoring_type ?? metadata.scoring, 30).toLowerCase();
    if (["ppr", "full_ppr", "full-ppr"].includes(type)) return { rec: 1 };
    if (["half_ppr", "half-ppr", "half"].includes(type)) return { rec: 0.5 };
    if (["standard", "std", "non_ppr", "non-ppr"].includes(type)) return { rec: 0 };
    return {};
  }

  function normalizeScoring(draft, league, profile) {
    const supplied = safeNumberRecord(
      league?.scoring_settings
      || draft?.scoring_settings
      || profile?.league_settings?.scoring,
    );
    const fallback = scoringFromMetadata(draft?.metadata || {});
    return Object.hasOwn(supplied, "rec") ? supplied : { ...fallback, ...supplied };
  }

  function detectFormat(draft, league, rosterPositions, profile) {
    const explicit = cleanText(draft?.metadata?.format ?? league?.metadata?.format, 30).toLowerCase();
    if (FORMATS.has(explicit)) return explicit;
    if (
      enabled(draft?.settings?.best_ball)
      || enabled(league?.settings?.best_ball)
      || enabled(draft?.metadata?.best_ball)
      || enabled(league?.metadata?.best_ball)
    ) return "best_ball";
    const positions = rosterPositions.map((position) => position.toUpperCase());
    if (positions.includes("SUPER_FLEX") || positions.filter((position) => position === "QB").length >= 2) {
      return "superflex";
    }
    if (!positions.length && FORMATS.has(profile?.format)) return profile.format;
    return "one_qb";
  }

  function scoringLabel(scoring) {
    const reception = Number(scoring?.rec ?? 0);
    if (reception >= 0.75) return "PPR";
    if (reception >= 0.25) return "Half PPR";
    if (Object.keys(scoring || {}).length) return "Standard";
    return "Scoring unavailable";
  }

  function normalizeSlotMap(raw, teams) {
    const map = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return map;
    for (const [slotValue, rosterValue] of Object.entries(raw).slice(0, 32)) {
      const slot = integer(slotValue, 1, teams);
      const rosterId = integer(rosterValue, 1, Number.MAX_SAFE_INTEGER);
      if (slot && rosterId) map[String(slot)] = rosterId;
    }
    return map;
  }

  function normalizeDraftOrder(raw, teams) {
    const order = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return order;
    for (const [userId, slotValue] of Object.entries(raw).slice(0, 64)) {
      const id = cleanText(userId, 80);
      const slot = integer(slotValue, 1, teams);
      if (id && slot && !["__proto__", "constructor", "prototype"].includes(id.toLowerCase())) order[id] = slot;
    }
    return order;
  }

  function rosterIdForUser(rosters, userId) {
    const target = cleanText(userId, 80);
    const roster = (Array.isArray(rosters) ? rosters : []).find((candidate) => (
      cleanText(candidate?.owner_id, 80) === target
      || (Array.isArray(candidate?.co_owners) && candidate.co_owners.some((id) => cleanText(id, 80) === target))
    ));
    return integer(roster?.roster_id, 1, Number.MAX_SAFE_INTEGER);
  }

  function reverseSlot(slotMap, rosterId) {
    const entry = Object.entries(slotMap).find(([, candidate]) => Number(candidate) === Number(rosterId));
    return entry ? integer(entry[0], 1, 32) : null;
  }

  function normalizeDraftContext(input = {}) {
    const draft = input.draft && typeof input.draft === "object" ? input.draft : {};
    const league = input.league && typeof input.league === "object" ? input.league : null;
    const profile = input.profile && typeof input.profile === "object" ? input.profile : null;
    const settings = draft.settings && typeof draft.settings === "object" ? draft.settings : {};
    const rawSlotCount = Object.keys(draft.slot_to_roster_id || {}).length;
    const teams = integer(settings.teams ?? draft.teams ?? league?.total_rosters ?? rawSlotCount, 2, 32);
    const rounds = integer(settings.rounds ?? draft.rounds, 1, 50);
    const errors = [];
    const warnings = [];
    if (!teams) errors.push("teams must be an integer from 2 through 32");
    if (!rounds) errors.push("rounds must be an integer from 1 through 50");
    if (errors.length) throw new DraftContextError(errors);

    const type = cleanText(draft.type, 20).toLowerCase() || "snake";
    const supported = type === "snake";
    if (!supported) warnings.push(`draft type ${type} is not supported by the v1 snake engine`);
    const rawReversal = integer(settings.reversal_round ?? draft.reversal_round, 0, 50, 0);
    const reversalRound = rawReversal === 0 || (rawReversal >= 3 && rawReversal <= rounds) ? rawReversal : 0;
    if (rawReversal && !reversalRound) warnings.push("invalid third-round reversal setting was ignored");

    const rosterPositions = normalizeRosterPositions(draft, league, profile);
    const scoring = normalizeScoring(draft, league, profile);
    const format = detectFormat(draft, league, rosterPositions, profile);
    const slotToRosterId = normalizeSlotMap(draft.slot_to_roster_id, teams);
    const draftOrder = normalizeDraftOrder(draft.draft_order, teams);
    const userId = cleanText(input.user?.user_id ?? input.user?.userId, 80);
    const explicitSlot = integer(input.user?.slot ?? input.user?.user_slot, 1, teams);
    const directSlot = integer(draftOrder[userId], 1, teams);
    const ownedRosterId = integer(input.user?.roster_id ?? input.user?.rosterId, 1, Number.MAX_SAFE_INTEGER)
      ?? rosterIdForUser(input.rosters, userId);
    const userSlot = explicitSlot ?? directSlot ?? reverseSlot(slotToRosterId, ownedRosterId);
    const userRosterId = ownedRosterId ?? (userSlot ? slotToRosterId[String(userSlot)] || null : null);
    if (userId && !userSlot) warnings.push("the connected Sleeper user has no assigned draft slot yet");

    const dynasty = Number(league?.settings?.type) === 2
      || cleanText(draft?.metadata?.type, 20).toLowerCase() === "dynasty";
    const name = cleanText(league?.name ?? draft?.metadata?.name, 80) || "Sleeper draft";
    return {
      draft_id: cleanText(draft.draft_id ?? input.draft_id, 80),
      league_id: cleanText(draft.league_id ?? league?.league_id, 80),
      name,
      status: cleanText(draft.status, 30) || "unknown",
      type,
      supported,
      teams,
      rounds,
      reversal_round: reversalRound,
      pick_timer: integer(settings.pick_timer, 0, 86400),
      format,
      dynasty,
      roster_positions: rosterPositions,
      scoring,
      scoring_label: scoringLabel(scoring),
      reception_points: Number(scoring.rec ?? 0),
      draft_order: draftOrder,
      slot_to_roster_id: slotToRosterId,
      user_slot: userSlot,
      user_roster_id: userRosterId,
      warnings,
      engine_draft: {
        ...draft,
        type,
        draft_order: draftOrder,
        slot_to_roster_id: slotToRosterId,
        settings: { ...settings, teams, rounds, reversal_round: reversalRound },
      },
    };
  }

  function profileForContext(profile, context) {
    if (!profile || typeof profile !== "object") throw new TypeError("A ranking profile is required");
    if (!context || typeof context !== "object") throw new TypeError("A draft context is required");
    return {
      ...profile,
      format: context.format || profile.format,
      league_settings: {
        teams: context.teams,
        roster_positions: [...(context.roster_positions || [])],
        scoring: { ...(context.scoring || {}) },
      },
    };
  }

  const api = {
    DraftContextError,
    defaultRosterPositions,
    detectFormat,
    normalizeDraftContext,
    normalizeRosterPositions,
    normalizeScoring,
    profileForContext,
    rosterFromDraftSettings,
    rosterIdForUser,
    scoringLabel,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.SDCCDraftContext = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
