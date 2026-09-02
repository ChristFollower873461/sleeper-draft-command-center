(function initRecommendationEngine(globalScope, factory) {
  "use strict";

  const DraftOrder = typeof module !== "undefined" && module.exports
    ? require("./draft-order.js")
    : globalScope.SDCCDraftOrder;
  const api = factory(DraftOrder);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.SDCCRecommendationEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (DraftOrder) => {
  "use strict";

  if (!DraftOrder) throw new Error("SDCCDraftOrder is required");

  const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];
  const DEFAULT_ROSTERS = {
    one_qb: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "K", "DEF", "BN", "BN", "BN", "BN", "BN", "BN", "BN"],
    superflex: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "SUPER_FLEX", "K", "DEF", "BN", "BN", "BN", "BN", "BN", "BN"],
    best_ball: ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "FLEX", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN"],
    custom: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN", "BN", "BN", "BN", "BN"],
  };

  class DraftEngineInputError extends Error {
    constructor(errors) {
      super(`Invalid draft engine input: ${errors.join("; ")}`);
      this.name = "DraftEngineInputError";
      this.code = "INVALID_DRAFT_ENGINE_INPUT";
      this.errors = errors;
    }
  }

  function asNumber(value, fallback = 0) {
    if (value == null || value === "") return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeName(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function nameKeys(value) {
    const normalized = normalizeName(value);
    return normalized ? [normalized, normalized.replace(/\s+/g, "")] : [];
  }

  function profileRosterPositions(profile) {
    const supplied = profile?.league_settings?.roster_positions;
    const source = Array.isArray(supplied) && supplied.length
      ? supplied
      : DEFAULT_ROSTERS[profile?.format] || DEFAULT_ROSTERS.custom;
    return source.map((position) => String(position || "").toUpperCase()).filter(Boolean);
  }

  function positionCounts(players) {
    const counts = Object.fromEntries(POSITIONS.map((position) => [position, 0]));
    for (const player of Array.isArray(players) ? players : []) {
      const position = String(player?.position || "").toUpperCase();
      if (Object.hasOwn(counts, position)) counts[position] += 1;
    }
    return counts;
  }

  function rosterTargets(profile) {
    const positions = profileRosterPositions(profile);
    const targets = Object.fromEntries(POSITIONS.map((position) => [position, 0]));
    for (const position of positions) {
      if (Object.hasOwn(targets, position)) targets[position] += 1;
    }
    targets.QB += positions.filter((position) => position === "SUPER_FLEX").length;
    return {
      ...targets,
      bench: positions.filter((position) => position === "BN").length,
      total: positions.length,
    };
  }

  function positionLimits(profile) {
    const targets = rosterTargets(profile);
    const bench = targets.bench;
    return {
      QB: targets.QB >= 2 ? Math.min(4, targets.QB + 1) : 2,
      RB: Math.max(targets.RB + Math.max(2, Math.ceil(bench * 0.35)), 4),
      WR: Math.max(targets.WR + Math.max(3, Math.ceil(bench * 0.45)), 5),
      TE: Math.max(targets.TE + (bench >= 5 ? 1 : 0), targets.TE),
      K: targets.K,
      DEF: targets.DEF,
    };
  }

  function specialistRound(state) {
    const specialistSlots = (state.targets.K || 0) + (state.targets.DEF || 0);
    return Math.max(1, state.rounds - specialistSlots - 3);
  }

  function validateInputs(profile, draft) {
    const errors = [];
    if (!profile || !Array.isArray(profile.players) || !profile.players.length) {
      errors.push("ranking profile needs at least one player");
    }
    const seen = new Set();
    for (const [index, player] of (profile?.players || []).entries()) {
      const id = String(player?.sleeper_id || "").trim();
      const position = String(player?.position || "").toUpperCase();
      if (!id || !player?.player || !POSITIONS.includes(position)) {
        errors.push(`player ${index + 1} is incomplete`);
        continue;
      }
      if (seen.has(id)) errors.push(`player ${id} is duplicated`);
      seen.add(id);
    }
    errors.push(...DraftOrder.validateDraftConfig(draft));
    return errors;
  }

  function reverseLookup(object, value) {
    const target = String(value);
    const entry = Object.entries(object || {}).find(([, candidate]) => String(candidate) === target);
    return entry ? DraftOrder.asInteger(entry[0]) : null;
  }

  function userRosterId(rosters, userId) {
    const target = String(userId || "");
    const roster = (Array.isArray(rosters) ? rosters : []).find((row) => (
      String(row?.owner_id || "") === target
      || (Array.isArray(row?.co_owners) && row.co_owners.some((id) => String(id) === target))
    ));
    return roster ? DraftOrder.asInteger(roster.roster_id) : null;
  }

  function draftSlotForUser(draft, rosters, user = {}) {
    const explicit = DraftOrder.asInteger(user.slot ?? user.user_slot);
    if (explicit) return explicit;
    const userId = String(user.user_id ?? user.userId ?? "");
    const direct = draft?.draft_order?.[userId];
    if (direct != null) return DraftOrder.asInteger(direct);
    const rosterId = DraftOrder.asInteger(user.roster_id ?? user.rosterId)
      ?? userRosterId(rosters, userId);
    return rosterId == null ? null : reverseLookup(draft?.slot_to_roster_id, rosterId);
  }

  function playerForPick(pick, playerById) {
    const playerId = String(pick?.player_id ?? pick?.metadata?.player_id ?? "");
    if (playerById.has(playerId)) return playerById.get(playerId);
    const metadata = pick?.metadata || {};
    const fullName = [metadata.first_name, metadata.last_name].filter(Boolean).join(" ")
      || playerId
      || "Unknown player";
    return {
      rank: null,
      player: fullName,
      position: String(metadata.position || "").toUpperCase(),
      team: String(metadata.team || "").toUpperCase(),
      sleeper_id: playerId,
      adp: null,
      tier: null,
    };
  }

  function tierForPlayer(player) {
    return DraftOrder.asInteger(player?.tier)
      ?? Math.max(1, Math.ceil(asNumber(player?.rank, 999) / 12));
  }

  function tierSignals(available) {
    return POSITIONS.map((position) => {
      const pool = (available || [])
        .filter((player) => player.position === position)
        .sort((left, right) => asNumber(left.rank, 999) - asNumber(right.rank, 999));
      if (!pool.length) return null;
      const top = pool[0];
      const tier = tierForPlayer(top);
      const sameTier = pool.filter((player) => tierForPlayer(player) === tier);
      const next = pool.find((player) => tierForPlayer(player) !== tier) || null;
      const rankGap = next ? Math.max(0, asNumber(next.rank) - asNumber(top.rank)) : null;
      const urgency = (sameTier.length === 1 ? 24 : sameTier.length === 2 ? 13 : 4)
        + Math.min(rankGap || 0, 20);
      return {
        position,
        player: top,
        tier,
        remaining: sameTier.length,
        next,
        rank_gap: rankGap,
        urgency,
      };
    }).filter(Boolean);
  }

  function detectPositionRun(recentPicks) {
    const picks = (recentPicks || []).filter((pick) => POSITIONS.includes(pick.position));
    if (!picks.length) return null;
    const latestPosition = picks[0].position;
    let streak = 0;
    for (const pick of picks) {
      if (pick.position !== latestPosition) break;
      streak += 1;
    }
    if (streak >= 2) return { position: latestPosition, count: streak, kind: "streak" };
    const counts = positionCounts(picks.slice(0, 6));
    const [position, count] = Object.entries(counts).sort((left, right) => right[1] - left[1])[0];
    return count >= 3 ? { position, count, kind: "wave" } : null;
  }

  function availablePlayers(players, picks) {
    const pool = Array.isArray(players) ? players : [];
    const playerById = new Map(pool.map((player) => [String(player.sleeper_id), player]));
    const pickedIds = new Set(
      (Array.isArray(picks) ? picks : [])
        .map((pick) => String(pick?.player_id ?? pick?.metadata?.player_id ?? ""))
        .filter(Boolean),
    );
    const pickedNames = new Set();
    for (const pick of Array.isArray(picks) ? picks : []) {
      for (const key of nameKeys(playerForPick(pick, playerById).player)) pickedNames.add(key);
    }
    return pool.filter((player) => (
      !pickedIds.has(String(player.sleeper_id))
      && nameKeys(player.player).every((key) => !pickedNames.has(key))
    ));
  }

  function roomIntelligence(profile, draft, picks, state, playerById, tradedPicks = null) {
    const reversalRound = DraftOrder.normalizeReversalRound(
      draft?.settings?.reversal_round,
      state.rounds,
    );
    const resolved = [...picks]
      .sort((left, right) => asNumber(right.pick_no) - asNumber(left.pick_no))
      .map((pick) => ({
        ...playerForPick(pick, playerById),
        pick_no: asNumber(pick.pick_no),
        draft_slot: DraftOrder.asInteger(pick.draft_slot)
          ?? DraftOrder.slotForPickNumber(pick.pick_no, state.teams, reversalRound),
        source: pick.source || (pick.manual ? "manual" : "live"),
      }));
    const postedPicks = resolved.filter((pick) => pick.pick_no < state.current_pick);
    const aheadPickNumbers = [];
    for (let pick = state.current_pick; pick < (state.decision_pick || state.current_pick); pick += 1) {
      aheadPickNumbers.push(pick);
    }
    const aheadSlots = [...new Set(aheadPickNumbers.map((pick) => {
      const round = Math.ceil(pick / state.teams);
      const slot = DraftOrder.slotForPickNumber(pick, state.teams, reversalRound);
      return DraftOrder.pickOwnerRosterId(round, slot, draft, tradedPicks) ?? slot;
    }))].filter(Boolean);
    const bySlot = new Map();
    for (const pick of resolved) {
      const ownerRosterId = DraftOrder.pickRosterId(pick, draft, tradedPicks) ?? pick.draft_slot;
      if (!bySlot.has(ownerRosterId)) bySlot.set(ownerRosterId, []);
      bySlot.get(ownerRosterId).push(pick);
    }
    const demandTargets = { ...state.targets };
    if ((state.decision_round || 1) < specialistRound(state)) {
      demandTargets.K = 0;
      demandTargets.DEF = 0;
    }
    const aheadDemand = Object.fromEntries(POSITIONS.map((position) => [position, 0]));
    for (const slot of aheadSlots) {
      const counts = positionCounts(bySlot.get(slot) || []);
      for (const position of POSITIONS) {
        if (counts[position] < demandTargets[position]) aheadDemand[position] += 1;
      }
    }
    const fallers = state.available
      .map((player) => ({
        player,
        fall: Math.round((state.current_pick - asNumber(player.adp, player.rank)) * 10) / 10,
      }))
      .filter((row) => row.fall >= 4)
      .sort((left, right) => right.fall - left.fall || left.player.rank - right.player.rank)
      .slice(0, 20);
    return {
      recent_picks: postedPicks.slice(0, 10),
      run_signal: detectPositionRun(postedPicks.slice(0, 8)),
      ahead_pick_numbers: aheadPickNumbers,
      ahead_slots: aheadSlots,
      ahead_demand: aheadDemand,
      tier_signals: tierSignals(state.available),
      fallers,
    };
  }

  function makeDraftState(profile, draft, picks = [], rosters = [], user = {}, tradedPicks = null) {
    const errors = validateInputs(profile, draft);
    if (errors.length) throw new DraftEngineInputError(errors);
    const teams = DraftOrder.asInteger(draft.settings?.teams ?? draft.teams);
    const rounds = DraftOrder.asInteger(draft.settings?.rounds ?? draft.rounds);
    const reversalRound = DraftOrder.normalizeReversalRound(
      draft.settings?.reversal_round ?? draft.reversal_round,
      rounds,
    );
    const slot = draftSlotForUser(draft, rosters, user);
    const userId = String(user.user_id ?? user.userId ?? "");
    const rosterId = DraftOrder.asInteger(user.roster_id ?? user.rosterId)
      ?? userRosterId(rosters, userId)
      ?? DraftOrder.asInteger(draft.slot_to_roster_id?.[String(slot)] ?? draft.slot_to_roster_id?.[slot]);
    const playerById = new Map(
      profile.players.map((player) => [String(player.sleeper_id), {
        ...player,
        position: String(player.position).toUpperCase(),
      }]),
    );
    const selected = picks
      .filter((pick) => (
        (rosterId != null && DraftOrder.pickRosterId(pick, draft, tradedPicks) === rosterId)
        || (userId && String(pick.picked_by || "") === userId)
        || (
          rosterId == null
          && slot != null
          && DraftOrder.asInteger(pick.draft_slot) === slot
        )
      ))
      .sort((left, right) => asNumber(left.pick_no) - asNumber(right.pick_no))
      .map((pick) => ({ ...playerForPick(pick, playerById), pick_no: asNumber(pick.pick_no) }));
    const pickedIds = new Set(picks.map((pick) => String(pick.player_id || pick.metadata?.player_id || "")));
    const available = availablePlayers(profile.players, picks)
      .map((player) => ({ ...player, position: String(player.position).toUpperCase() }))
      .sort((left, right) => asNumber(left.rank, 999) - asNumber(right.rank, 999));
    const currentPick = DraftOrder.currentPickNumber(picks, teams, rounds);
    const ourPicks = DraftOrder.rosterPickNumbers(rosterId, draft, tradedPicks, slot);
    const filledPickNumbers = new Set(picks.map((pick) => asNumber(pick.pick_no)));
    const openOurPicks = ourPicks.filter((pick) => !filledPickNumbers.has(pick));
    const decisionPick = openOurPicks.find((pick) => pick >= currentPick) || null;
    const returnPick = openOurPicks.find((pick) => decisionPick != null && pick > decisionPick) || null;
    const targets = rosterTargets(profile);
    const state = {
      format: profile.format,
      teams,
      rounds,
      reversal_round: reversalRound,
      slot,
      roster_id: rosterId,
      current_pick: currentPick,
      decision_pick: decisionPick,
      return_pick: returnPick,
      decision_round: decisionPick ? Math.ceil(decisionPick / teams) : null,
      picks_away: decisionPick == null ? null : Math.max(0, decisionPick - currentPick),
      on_clock: decisionPick === currentPick,
      selected,
      counts: positionCounts(selected),
      targets,
      limits: positionLimits(profile),
      available,
      picked_ids: pickedIds,
      live_pick_count: Math.max(0, currentPick - 1),
      complete: currentPick > teams * rounds,
    };
    Object.assign(state, roomIntelligence(profile, draft, picks, state, playerById, tradedPicks));
    return state;
  }

  function recoverDraftState(profile, draft, livePicks, manualPicks, rosters, user, tradedPicks = null) {
    const effectivePicks = DraftOrder.mergeDraftPicks(livePicks, manualPicks);
    return {
      effective_picks: effectivePicks,
      state: makeDraftState(profile, draft, effectivePicks, rosters, user, tradedPicks),
    };
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalCdf(value) {
    const sign = value < 0 ? -1 : 1;
    const x = Math.abs(value) / Math.sqrt(2);
    const t = 1 / (1 + 0.3275911 * x);
    const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t)
      * Math.exp(-x * x);
    return 0.5 * (1 + sign * erf);
  }

  function sigmaForAdp(adp) {
    if (adp <= 36) return 4.5;
    if (adp <= 72) return 6;
    if (adp <= 120) return 8;
    if (adp <= 180) return 11;
    if (adp <= 240) return 15;
    return 20;
  }

  function survivalProbability(adpValue, pickValue) {
    const adp = asNumber(adpValue, null);
    const pick = asNumber(pickValue, null);
    if (adp == null || pick == null) return 0.5;
    return clamp(normalCdf((adp - pick) / sigmaForAdp(adp)), 0.01, 0.99);
  }

  function isCorrelated(player, selected) {
    if (!player.team) return false;
    return (selected || []).some((rosterPlayer) => {
      if (rosterPlayer.team !== player.team) return false;
      const positions = new Set([rosterPlayer.position, player.position]);
      return positions.has("QB") && (positions.has("WR") || positions.has("TE"));
    });
  }

  function hardBlocked(player, state) {
    const position = player.position;
    const count = state.counts[position] || 0;
    if (!POSITIONS.includes(position)) return true;
    if (count >= (state.limits[position] || 0)) return true;
    if ((position === "K" || position === "DEF") && state.targets[position] === 0) return true;
    if (
      (position === "K" || position === "DEF")
      && state.decision_round < specialistRound(state)
    ) return true;
    return false;
  }

  function constructionAdjustment(player, state) {
    const position = player.position;
    const count = state.counts[position] || 0;
    const target = state.targets[position] || 0;
    const deficit = Math.max(0, target - count);
    let adjustment = 0;
    if (deficit) adjustment -= deficit * 6 + Math.min(state.decision_round || 1, 10) * 0.7;
    if (count >= target && target > 0) adjustment += (count - target + 1) * 5;
    if (state.format === "one_qb" && position === "QB" && count >= 1) adjustment += 11;
    if (state.format === "superflex" && position === "QB" && count < 2) adjustment -= 5;
    if (position === "TE" && count === 0 && tierForPlayer(player) <= 2) adjustment -= 3;
    return adjustment;
  }

  function roomPressureAdjustment(player, state) {
    const aheadTeams = state.ahead_slots.length;
    const demand = state.ahead_demand[player.position] || 0;
    const tier = state.tier_signals.find((signal) => signal.position === player.position);
    let adjustment = 0;
    if (aheadTeams >= 2 && demand / aheadTeams >= 0.6) adjustment -= 3;
    if (state.run_signal?.position === player.position && state.run_signal.count >= 3) adjustment -= 2;
    if (tier?.remaining === 1 && (tier.rank_gap || 0) >= 6) adjustment -= 4;
    return adjustment;
  }

  function candidateDetails(player, state) {
    if (hardBlocked(player, state)) return null;
    const decisionPick = state.decision_pick || state.current_pick;
    const returnPick = state.return_pick || decisionPick + state.teams;
    const adp = asNumber(player.adp, player.rank);
    const reachChance = survivalProbability(adp, decisionPick);
    const goneByReturn = 1 - survivalProbability(adp, returnPick);
    let score = asNumber(player.rank, 999);
    if (state.picks_away > 3 && reachChance < 0.12) score += 120;
    else if (state.picks_away > 3 && reachChance < 0.25) score += 24;
    score -= goneByReturn * 13;
    score -= Math.min(24, Math.max(0, state.current_pick - adp)) * 0.3;
    score += Math.max(0, adp - decisionPick) * 0.08;
    score += constructionAdjustment(player, state);
    score += roomPressureAdjustment(player, state);
    const correlated = isCorrelated(player, state.selected);
    if (correlated) score -= 3;
    const target = state.targets[player.position] || 0;
    const need = Math.max(0, target - (state.counts[player.position] || 0));
    return {
      player,
      score,
      adp,
      reach_chance: reachChance,
      gone_by_return: goneByReturn,
      adp_fall: Math.max(0, Math.round((state.current_pick - adp) * 10) / 10),
      correlated,
      need,
      ahead_demand: state.ahead_demand[player.position] || 0,
      tier_signal: state.tier_signals.find((signal) => signal.position === player.position) || null,
    };
  }

  function describeCandidate(detail, state) {
    const player = detail.player;
    const pieces = [`Our #${player.rank}`, `${player.position} tier ${tierForPlayer(player)}`];
    if (state.picks_away > 0) pieces.push(`${Math.round(detail.reach_chance * 100)}% to reach turn`);
    pieces.push(`${Math.round(detail.gone_by_return * 100)}% gone by return`);
    if (detail.adp_fall >= 4) pieces.push(`ADP fall ${detail.adp_fall}`);
    if (detail.ahead_demand >= 2) pieces.push(`${detail.ahead_demand} teams ahead need ${player.position}`);
    if (detail.correlated) pieces.push("roster stack");
    return pieces.join(" | ");
  }

  function chooseRecommendations(state, limit = 4) {
    if (!state || state.complete || !state.decision_pick) return [];
    const details = state.available
      .map((player) => candidateDetails(player, state))
      .filter(Boolean)
      .sort((left, right) => left.score - right.score || left.player.rank - right.player.rank);
    if (!details.length) return [];
    const recommendations = [];
    function add(role, detail) {
      if (!detail || recommendations.some((row) => row.player.sleeper_id === detail.player.sleeper_id)) return;
      recommendations.push({ role, ...detail, reason: describeCandidate(detail, state) });
    }
    const preferred = details[0];
    add("PREFERRED", preferred);
    add(
      "TIER PIVOT",
      details.find((detail) => (
        tierForPlayer(detail.player) === tierForPlayer(preferred.player)
        && detail.player.position !== preferred.player.position
      )),
    );
    add(
      "BUILD PIVOT",
      [...details]
        .filter((detail) => detail.player.position !== preferred.player.position)
        .sort((left, right) => right.need - left.need || left.score - right.score)[0],
    );
    const chosen = new Set(recommendations.map((row) => row.player.sleeper_id));
    const correlated = details.find((detail) => detail.correlated && !chosen.has(detail.player.sleeper_id));
    const value = [...details]
      .filter((detail) => !chosen.has(detail.player.sleeper_id))
      .sort((left, right) => (
        (right.adp - right.player.rank + right.gone_by_return * 12)
        - (left.adp - left.player.rank + left.gone_by_return * 12)
      ))[0];
    add(correlated ? "STACK/VALUE" : "VALUE PIVOT", correlated || value);
    for (const detail of details) {
      if (recommendations.length >= limit) break;
      add("NEXT OPTION", detail);
    }
    return recommendations.slice(0, limit);
  }

  return {
    POSITIONS,
    DraftEngineInputError,
    availablePlayers,
    chooseRecommendations,
    detectPositionRun,
    draftSlotForUser,
    makeDraftState,
    normalizeName,
    positionCounts,
    positionLimits,
    recoverDraftState,
    rosterTargets,
    specialistRound,
    survivalProbability,
    tierSignals,
    validateInputs,
  };
});
