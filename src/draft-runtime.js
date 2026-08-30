(function initDraftRuntime(globalScope, factory) {
  "use strict";
  const Context = typeof module !== "undefined" && module.exports
    ? require("./draft-context.js")
    : globalScope.SDCCDraftContext;
  const Sessions = typeof module !== "undefined" && module.exports
    ? require("./draft-session.js")
    : globalScope.SDCCDraftSession;
  const Engine = typeof module !== "undefined" && module.exports
    ? require("./recommendation-engine.js")
    : globalScope.SDCCRecommendationEngine;
  const api = factory(Context, Sessions, Engine);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.SDCCDraftRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (Context, Sessions, Engine) => {
  "use strict";

  if (!Context || !Sessions || !Engine) throw new Error("Draft context, session, and recommendation engines are required");

  function normalizeSearch(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function contextFromSession(session) {
    const config = session?.draft_config || {};
    return {
      draft_id: session?.draft_id || "",
      league_id: session?.league_id || "",
      name: config.name || "Draft room",
      status: config.status || "unknown",
      type: "snake",
      supported: true,
      teams: config.teams,
      rounds: config.rounds,
      reversal_round: config.reversal_round || 0,
      pick_timer: config.pick_timer,
      format: config.format || "custom",
      roster_positions: [...(config.roster_positions || [])],
      scoring: { ...(config.scoring || {}) },
      scoring_label: Context.scoringLabel(config.scoring || {}),
      reception_points: Number(config.scoring?.rec ?? 0),
      user_slot: config.user_slot,
      user_roster_id: config.user_roster_id,
      warnings: [],
      engine_draft: Sessions.draftFromSession(session),
    };
  }

  function pickSignature(picks) {
    return (Array.isArray(picks) ? picks : [])
      .map((pick) => `${Number(pick?.pick_no) || 0}:${String(pick?.player_id ?? pick?.metadata?.player_id ?? "")}`)
      .sort()
      .join("|");
  }

  function makeRuntimeState(storageState, draftId, options = {}) {
    const session = storageState?.draft_sessions?.[draftId];
    if (!session) throw new TypeError("Draft session was not found");
    const profile = storageState.ranking_profiles.find((candidate) => candidate.id === session.ranking_profile_id);
    if (!profile) throw new TypeError("Draft session ranking profile was not found");
    const context = options.context || contextFromSession(session);
    const adaptedProfile = Context.profileForContext(profile, context);
    const livePicks = Array.isArray(options.livePicks) ? options.livePicks : session.cached_live_picks;
    const user = options.user || Sessions.userFromSession(storageState, session);
    const recovered = Engine.recoverDraftState(
      adaptedProfile,
      context.engine_draft || Sessions.draftFromSession(session),
      livePicks,
      session.manual_picks,
      options.rosters || [],
      user,
    );
    const recommendations = Engine.chooseRecommendations(recovered.state, options.recommendationLimit || 4);
    const pinnedIds = new Set(session.pinned_player_ids);
    const pinned = recovered.state.available.filter((player) => pinnedIds.has(player.sleeper_id));
    return {
      draft_id: draftId,
      session,
      context,
      profile,
      adapted_profile: adaptedProfile,
      effective_picks: recovered.effective_picks,
      state: recovered.state,
      recommendations,
      pinned,
    };
  }

  function filterAvailable(runtime, options = {}) {
    const query = normalizeSearch(options.query);
    const position = String(options.position || "ALL").toUpperCase();
    return runtime.state.available.filter((player) => {
      if (position !== "ALL" && player.position !== position) return false;
      if (!query) return true;
      return normalizeSearch(`${player.player} ${player.team} ${player.position} ${player.notes} ${player.sleeper_id}`).includes(query);
    });
  }

  function firstManualCandidate(runtime, query = "", position = "ALL") {
    return filterAvailable(runtime, { query, position })[0] || null;
  }

  return {
    contextFromSession,
    filterAvailable,
    firstManualCandidate,
    makeRuntimeState,
    normalizeSearch,
    pickSignature,
  };
});
