(function initDraftSession(globalScope, factory) {
  "use strict";
  const Storage = typeof module !== "undefined" && module.exports
    ? require("./storage.js")
    : globalScope.SDCCStorage;
  const DraftOrder = typeof module !== "undefined" && module.exports
    ? require("./draft-order.js")
    : globalScope.SDCCDraftOrder;
  const api = factory(Storage, DraftOrder);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.SDCCDraftSession = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (Storage, DraftOrder) => {
  "use strict";

  if (!Storage || !DraftOrder) throw new Error("Storage and draft order engines are required");

  function cleanText(value, maximum = 100) {
    return String(value == null ? "" : value).trim().slice(0, maximum);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeState(raw) {
    const { state } = Storage.migrateState(raw);
    const errors = Storage.validateState(state);
    if (errors.length) throw new TypeError(errors[0]);
    return state;
  }

  function requireDraftId(value) {
    const draftId = cleanText(value, 80);
    if (!/^[A-Za-z0-9._-]+$/.test(draftId)) throw new TypeError("Draft ID is invalid");
    return draftId;
  }

  function requireProfile(state, profileId) {
    const profile = state.ranking_profiles.find((candidate) => candidate.id === profileId);
    if (!profile || !profile.players.length) throw new TypeError("A non-empty ranking profile is required");
    return profile;
  }

  function configFromContext(context = {}) {
    const teams = DraftOrder.asInteger(context.teams);
    const rounds = DraftOrder.asInteger(context.rounds);
    if (DraftOrder.validateDraftConfig({ settings: {
      teams,
      rounds,
      reversal_round: context.reversal_round || 0,
    } }).length) throw new TypeError("Draft configuration needs valid teams, rounds, and reversal settings");
    return {
      name: cleanText(context.name, 80) || "Draft room",
      type: "snake",
      status: cleanText(context.status, 30) || "unknown",
      format: ["one_qb", "superflex", "best_ball", "custom"].includes(context.format) ? context.format : "custom",
      teams,
      rounds,
      reversal_round: DraftOrder.normalizeReversalRound(context.reversal_round, rounds),
      pick_timer: DraftOrder.asInteger(context.pick_timer),
      user_slot: DraftOrder.asInteger(context.user_slot),
      user_roster_id: DraftOrder.asInteger(context.user_roster_id),
      roster_positions: (Array.isArray(context.roster_positions) ? context.roster_positions : []).slice(0, 40),
      scoring: clone(context.scoring || {}),
    };
  }

  function upsertSession(rawState, options = {}) {
    const state = normalizeState(rawState);
    const draftId = requireDraftId(options.draftId ?? options.draft_id);
    const profileId = cleanText(options.profileId ?? options.ranking_profile_id, 80)
      || state.settings.active_ranking_profile_id;
    requireProfile(state, profileId);
    const existing = state.draft_sessions[draftId] || null;
    if (!existing && Object.keys(state.draft_sessions).length >= 100) {
      throw new TypeError("The 100-session limit has been reached");
    }
    const now = options.now || new Date().toISOString();
    const nextSession = {
      draft_id: draftId,
      league_id: cleanText(options.leagueId ?? options.league_id ?? existing?.league_id, 80),
      ranking_profile_id: profileId,
      mode: options.mode === "manual" ? "manual" : "live",
      manual_picks: clone(existing?.manual_picks || []),
      cached_live_picks: clone(existing?.cached_live_picks || []),
      draft_config: configFromContext(options.context ?? existing?.draft_config),
      pinned_player_ids: clone(existing?.pinned_player_ids || []),
      ui: {
        fullscreen: true,
        dock: existing?.ui?.dock || state.settings.dock,
        active_tab: existing?.ui?.active_tab || "shortlist",
      },
      last_synced_at: existing?.last_synced_at || null,
      updated_at: now,
    };
    return normalizeState({
      ...state,
      draft_sessions: { ...state.draft_sessions, [draftId]: nextSession },
      settings: {
        ...state.settings,
        active_ranking_profile_id: profileId,
        last_draft_id: draftId,
      },
    });
  }

  function requireSession(state, draftId) {
    const session = state.draft_sessions[requireDraftId(draftId)];
    if (!session) throw new TypeError("Draft session was not found");
    return session;
  }

  function draftFromSession(session) {
    const config = session?.draft_config || {};
    const slotMap = {};
    if (config.user_slot && config.user_roster_id) slotMap[String(config.user_slot)] = config.user_roster_id;
    return {
      draft_id: session?.draft_id,
      league_id: session?.league_id,
      type: "snake",
      status: config.status,
      settings: {
        teams: config.teams,
        rounds: config.rounds,
        reversal_round: config.reversal_round,
        pick_timer: config.pick_timer,
      },
      draft_order: {},
      slot_to_roster_id: slotMap,
    };
  }

  function userFromSession(state, session) {
    return {
      user_id: state.user.user_id,
      slot: session.draft_config.user_slot,
      roster_id: session.draft_config.user_roster_id,
    };
  }

  function cacheLivePicks(rawState, draftId, picks, now = new Date().toISOString()) {
    const state = normalizeState(rawState);
    const session = requireSession(state, draftId);
    return normalizeState({
      ...state,
      draft_sessions: {
        ...state.draft_sessions,
        [session.draft_id]: {
          ...session,
          cached_live_picks: clone(Array.isArray(picks) ? picks : []),
          last_synced_at: now,
          updated_at: now,
        },
      },
    });
  }

  function recordManualPick(rawState, draftId, player, now = new Date().toISOString()) {
    const state = normalizeState(rawState);
    const session = requireSession(state, draftId);
    const profile = requireProfile(state, session.ranking_profile_id);
    const rankedPlayer = profile.players.find((candidate) => candidate.sleeper_id === player?.sleeper_id);
    if (!rankedPlayer) throw new TypeError("Manual pick must come from the active ranking profile");
    const draft = draftFromSession(session);
    const effective = DraftOrder.mergeDraftPicks(session.cached_live_picks, session.manual_picks);
    const pickNumber = DraftOrder.currentPickNumber(effective, draft.settings.teams, draft.settings.rounds);
    if (pickNumber > draft.settings.teams * draft.settings.rounds) throw new TypeError("The draft is complete");
    const pick = DraftOrder.manualPickForPlayer(rankedPlayer, pickNumber, draft, userFromSession(state, session));
    return {
      state: normalizeState({
        ...state,
        draft_sessions: {
          ...state.draft_sessions,
          [session.draft_id]: {
            ...session,
            manual_picks: [...session.manual_picks, pick],
            updated_at: now,
          },
        },
      }),
      pick,
    };
  }

  function undoEffectiveManualPick(rawState, draftId, now = new Date().toISOString()) {
    const state = normalizeState(rawState);
    const session = requireSession(state, draftId);
    const effectiveManual = DraftOrder.mergeDraftPicks(session.cached_live_picks, session.manual_picks)
      .filter((pick) => pick.source === "manual")
      .sort((left, right) => right.pick_no - left.pick_no);
    const removed = effectiveManual[0] || null;
    if (!removed) return { state, removed: null };
    const manualPicks = session.manual_picks.filter((pick) => !(
      pick.pick_no === removed.pick_no && pick.player_id === removed.player_id
    ));
    return {
      state: normalizeState({
        ...state,
        draft_sessions: {
          ...state.draft_sessions,
          [session.draft_id]: { ...session, manual_picks: manualPicks, updated_at: now },
        },
      }),
      removed,
    };
  }

  function togglePinnedPlayer(rawState, draftId, playerId, now = new Date().toISOString()) {
    const state = normalizeState(rawState);
    const session = requireSession(state, draftId);
    const id = cleanText(playerId, 80);
    if (!id) throw new TypeError("Player ID is required");
    const pinned = new Set(session.pinned_player_ids);
    if (pinned.has(id)) pinned.delete(id);
    else pinned.add(id);
    return normalizeState({
      ...state,
      draft_sessions: {
        ...state.draft_sessions,
        [session.draft_id]: {
          ...session,
          pinned_player_ids: [...pinned],
          updated_at: now,
        },
      },
    });
  }

  function setSessionMode(rawState, draftId, mode, now = new Date().toISOString()) {
    const state = normalizeState(rawState);
    const session = requireSession(state, draftId);
    if (!['live', 'manual'].includes(mode)) throw new TypeError("Draft mode must be live or manual");
    return normalizeState({
      ...state,
      draft_sessions: {
        ...state.draft_sessions,
        [session.draft_id]: { ...session, mode, updated_at: now },
      },
    });
  }

  function removeSession(rawState, draftId) {
    const state = normalizeState(rawState);
    const id = requireDraftId(draftId);
    if (!state.draft_sessions[id]) return state;
    const sessions = { ...state.draft_sessions };
    delete sessions[id];
    return normalizeState({
      ...state,
      draft_sessions: sessions,
      settings: {
        ...state.settings,
        last_draft_id: state.settings.last_draft_id === id ? null : state.settings.last_draft_id,
      },
    });
  }

  return {
    cacheLivePicks,
    configFromContext,
    draftFromSession,
    recordManualPick,
    removeSession,
    setSessionMode,
    togglePinnedPlayer,
    undoEffectiveManualPick,
    upsertSession,
    userFromSession,
  };
});
