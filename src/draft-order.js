(function initDraftOrder(globalScope) {
  "use strict";

  function asInteger(value, fallback = null) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : fallback;
  }

  function validDraftDimensions(teams, rounds = 1) {
    return (
      Number.isInteger(teams)
      && teams >= 2
      && teams <= 32
      && Number.isInteger(rounds)
      && rounds >= 1
      && rounds <= 50
    );
  }

  function normalizeReversalRound(value, rounds = 50) {
    const parsed = asInteger(value, 0);
    return parsed >= 3 && parsed <= rounds ? parsed : 0;
  }

  function roundIsReversed(round, reversalRound = 0) {
    let reversed = round % 2 === 0;
    if (reversalRound && round >= reversalRound) reversed = !reversed;
    return reversed;
  }

  function pickNumberForRound(roundValue, slotValue, teamsValue, reversalValue = 0) {
    const round = asInteger(roundValue);
    const slot = asInteger(slotValue);
    const teams = asInteger(teamsValue);
    if (!validDraftDimensions(teams) || !round || round < 1 || round > 50 || !slot || slot < 1 || slot > teams) {
      return null;
    }
    const reversalRound = normalizeReversalRound(reversalValue);
    const withinRound = roundIsReversed(round, reversalRound) ? teams - slot + 1 : slot;
    return (round - 1) * teams + withinRound;
  }

  function slotForPickNumber(pickValue, teamsValue, reversalValue = 0) {
    const pickNumber = asInteger(pickValue);
    const teams = asInteger(teamsValue);
    if (!validDraftDimensions(teams) || !pickNumber || pickNumber < 1) return null;
    const round = Math.ceil(pickNumber / teams);
    if (round > 50) return null;
    const reversalRound = normalizeReversalRound(reversalValue);
    const withinRound = ((pickNumber - 1) % teams) + 1;
    return roundIsReversed(round, reversalRound) ? teams - withinRound + 1 : withinRound;
  }

  function userPickNumbers(slotValue, teamsValue, roundsValue, reversalValue = 0) {
    const slot = asInteger(slotValue);
    const teams = asInteger(teamsValue);
    const rounds = asInteger(roundsValue);
    if (!validDraftDimensions(teams, rounds) || !slot || slot < 1 || slot > teams) return [];
    const reversalRound = normalizeReversalRound(reversalValue, rounds);
    return Array.from({ length: rounds }, (_value, index) => (
      pickNumberForRound(index + 1, slot, teams, reversalRound)
    ));
  }

  function currentPickNumber(picks, teamsValue, roundsValue) {
    const teams = asInteger(teamsValue);
    const rounds = asInteger(roundsValue);
    if (!validDraftDimensions(teams, rounds)) return null;
    const taken = new Set(
      (Array.isArray(picks) ? picks : [])
        .map((pick) => asInteger(pick?.pick_no ?? pick?.pickNo))
        .filter((pick) => pick != null && pick >= 1 && pick <= teams * rounds),
    );
    for (let pick = 1; pick <= teams * rounds; pick += 1) {
      if (!taken.has(pick)) return pick;
    }
    return teams * rounds + 1;
  }

  function formatPick(pickValue, teamsValue) {
    const pickNumber = asInteger(pickValue);
    const teams = asInteger(teamsValue);
    if (!validDraftDimensions(teams) || !pickNumber || pickNumber < 1) return "--";
    const round = Math.ceil(pickNumber / teams);
    const withinRound = ((pickNumber - 1) % teams) + 1;
    return `${round}.${String(withinRound).padStart(2, "0")}`;
  }

  function pickPlayerId(pick) {
    return String(pick?.player_id ?? pick?.playerId ?? pick?.metadata?.player_id ?? "").trim();
  }

  function normalizePick(pick, source) {
    const pickNumber = asInteger(pick?.pick_no ?? pick?.pickNo);
    const playerId = pickPlayerId(pick);
    if (!pickNumber || pickNumber < 1 || !playerId) return null;
    return {
      ...pick,
      pick_no: pickNumber,
      player_id: playerId,
      source,
      manual: source === "manual",
    };
  }

  function mergeDraftPicks(livePicks, manualPicks) {
    const byPickNumber = new Map();
    const livePlayerIds = new Set();
    for (const raw of Array.isArray(livePicks) ? livePicks : []) {
      const pick = normalizePick(raw, "live");
      if (!pick) continue;
      byPickNumber.set(pick.pick_no, pick);
      livePlayerIds.add(pick.player_id);
    }
    const manualPlayerIds = new Set();
    const normalizedManual = (Array.isArray(manualPicks) ? manualPicks : [])
      .map((pick) => normalizePick(pick, "manual"))
      .filter(Boolean)
      .sort((left, right) => left.pick_no - right.pick_no);
    for (const pick of normalizedManual) {
      if (
        byPickNumber.has(pick.pick_no)
        || livePlayerIds.has(pick.player_id)
        || manualPlayerIds.has(pick.player_id)
      ) continue;
      byPickNumber.set(pick.pick_no, pick);
      manualPlayerIds.add(pick.player_id);
    }
    return [...byPickNumber.values()].sort((left, right) => left.pick_no - right.pick_no);
  }

  function manualPickForPlayer(player, pickValue, draft, user = {}) {
    const pickNumber = asInteger(pickValue);
    const teams = asInteger(draft?.settings?.teams ?? draft?.teams, 12);
    const reversalRound = normalizeReversalRound(
      draft?.settings?.reversal_round ?? draft?.reversal_round,
      asInteger(draft?.settings?.rounds ?? draft?.rounds, 50),
    );
    const draftSlot = slotForPickNumber(pickNumber, teams, reversalRound);
    const playerId = String(player?.sleeper_id ?? player?.player_id ?? "").trim();
    if (!pickNumber || !draftSlot || !playerId) {
      throw new TypeError("Manual picks require a valid player, pick number, and draft configuration");
    }
    const userSlot = asInteger(user.slot ?? user.user_slot);
    const userId = String(user.user_id ?? user.userId ?? "").trim();
    const rosterId = asInteger(
      draft?.slot_to_roster_id?.[String(draftSlot)]
        ?? draft?.slot_to_roster_id?.[draftSlot],
      draftSlot,
    );
    const words = String(player.player ?? player.full_name ?? "Unknown player").trim().split(/\s+/);
    const firstName = words.shift() || "Unknown";
    return {
      pick_no: pickNumber,
      draft_slot: draftSlot,
      roster_id: rosterId,
      picked_by: draftSlot === userSlot && userId ? userId : `manual-slot-${draftSlot}`,
      player_id: playerId,
      metadata: {
        player_id: playerId,
        first_name: firstName,
        last_name: words.join(" "),
        position: String(player.position ?? "").toUpperCase(),
        team: String(player.team ?? "").toUpperCase(),
      },
      source: "manual",
      manual: true,
    };
  }

  function undoLatestManualPick(manualPicks) {
    const picks = (Array.isArray(manualPicks) ? manualPicks : []).map((pick) => ({ ...pick }));
    if (!picks.length) return { picks, removed: null };
    let latestIndex = 0;
    for (let index = 1; index < picks.length; index += 1) {
      const current = asInteger(picks[index]?.pick_no ?? picks[index]?.pickNo, 0);
      const latest = asInteger(picks[latestIndex]?.pick_no ?? picks[latestIndex]?.pickNo, 0);
      if (current >= latest) latestIndex = index;
    }
    const [removed] = picks.splice(latestIndex, 1);
    return { picks, removed };
  }

  function validateDraftConfig(draft) {
    const errors = [];
    const teams = asInteger(draft?.settings?.teams ?? draft?.teams);
    const rounds = asInteger(draft?.settings?.rounds ?? draft?.rounds);
    const reversal = asInteger(
      draft?.settings?.reversal_round ?? draft?.reversal_round,
      0,
    );
    if (!validDraftDimensions(teams, rounds)) errors.push("teams must be 2-32 and rounds must be 1-50");
    if (reversal !== 0 && (reversal < 3 || reversal > rounds)) {
      errors.push("reversal_round must be 0 or a round from 3 through the final round");
    }
    return errors;
  }

  const api = {
    asInteger,
    currentPickNumber,
    formatPick,
    manualPickForPlayer,
    mergeDraftPicks,
    normalizeReversalRound,
    pickNumberForRound,
    slotForPickNumber,
    undoLatestManualPick,
    userPickNumbers,
    validateDraftConfig,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.SDCCDraftOrder = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

