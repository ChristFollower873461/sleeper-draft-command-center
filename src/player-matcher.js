(function initPlayerMatcher(globalScope) {
  "use strict";

  const TEAM_ALIASES = new Map([
    ["JAC", "JAX"], ["LV", "LVR"], ["OAK", "LVR"], ["SD", "LAC"],
    ["STL", "LAR"], ["WSH", "WAS"], ["ARZ", "ARI"],
  ]);
  const DEFENSE_NAMES = new Map([
    ["cardinals", "ARI"], ["falcons", "ATL"], ["ravens", "BAL"], ["bills", "BUF"],
    ["panthers", "CAR"], ["bears", "CHI"], ["bengals", "CIN"], ["browns", "CLE"],
    ["cowboys", "DAL"], ["broncos", "DEN"], ["lions", "DET"], ["packers", "GB"],
    ["texans", "HOU"], ["colts", "IND"], ["jaguars", "JAX"], ["chiefs", "KC"],
    ["raiders", "LVR"], ["chargers", "LAC"], ["rams", "LAR"], ["dolphins", "MIA"],
    ["vikings", "MIN"], ["patriots", "NE"], ["saints", "NO"], ["giants", "NYG"],
    ["jets", "NYJ"], ["eagles", "PHI"], ["steelers", "PIT"], ["49ers", "SF"],
    ["seahawks", "SEA"], ["buccaneers", "TB"], ["titans", "TEN"], ["commanders", "WAS"],
  ]);
  const MAX_FUZZY_CANDIDATES = 120;
  const MAX_INDEX_POSTINGS = 600;

  function cleanText(value, maximum = 120) {
    return String(value == null ? "" : value).trim().slice(0, maximum);
  }

  function normalizeTeam(value) {
    const team = cleanText(value, 5).toUpperCase();
    return TEAM_ALIASES.get(team) || team;
  }

  function normalizeName(value) {
    return cleanText(value, 120)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "")
      .replace(/\b(d\/st|dst|defense)\b/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function defenseTeamFromName(value) {
    const normalized = normalizeName(value);
    for (const [nickname, team] of DEFENSE_NAMES) {
      if (normalized === nickname || normalized.endsWith(` ${nickname}`)) return team;
    }
    const code = normalized.toUpperCase();
    return /^[A-Z]{2,3}$/.test(code) ? normalizeTeam(code) : "";
  }

  function similarity(leftValue, rightValue) {
    const left = normalizeName(leftValue);
    const right = normalizeName(rightValue);
    if (!left || !right) return 0;
    if (left === right) return 1;
    const previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
      let diagonal = previous[0];
      previous[0] = leftIndex;
      for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
        const above = previous[rightIndex];
        const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
        previous[rightIndex] = Math.min(
          previous[rightIndex] + 1,
          previous[rightIndex - 1] + 1,
          diagonal + cost,
        );
        diagonal = above;
      }
    }
    return 1 - previous[right.length] / Math.max(left.length, right.length);
  }

  function prepareCatalog(catalog) {
    return (Array.isArray(catalog) ? catalog : []).map((player) => {
      const aliases = [player.player, ...(Array.isArray(player.aliases) ? player.aliases : [])]
        .map(normalizeName)
        .filter(Boolean);
      const position = cleanText(player.position, 5).toUpperCase().replace("DST", "DEF");
      const team = normalizeTeam(player.team || (position === "DEF" ? player.sleeper_id : ""));
      if (position === "DEF") {
        aliases.push(normalizeName(`${team} Defense`));
        for (const [nickname, nicknameTeam] of DEFENSE_NAMES) {
          if (nicknameTeam === team) aliases.push(nickname);
        }
      }
      return {
        ...player,
        sleeper_id: cleanText(player.sleeper_id, 80),
        position,
        team,
        normalized_names: [...new Set(aliases)],
      };
    }).filter((player) => player.sleeper_id && player.normalized_names.length);
  }

  function trigrams(value) {
    const normalized = normalizeName(value);
    if (normalized.length < 3) return normalized ? [normalized] : [];
    const values = new Set();
    for (let index = 0; index <= normalized.length - 3; index += 1) {
      values.add(normalized.slice(index, index + 3));
    }
    return [...values];
  }

  function addPosting(index, key, playerIndex) {
    if (!key) return;
    const postings = index.get(key) || [];
    postings.push(playerIndex);
    index.set(key, postings);
  }

  function buildCatalogIndex(preparedCatalog) {
    const byId = new Map();
    const byName = new Map();
    const byToken = new Map();
    const byTrigram = new Map();
    preparedCatalog.forEach((player, playerIndex) => {
      byId.set(player.sleeper_id, playerIndex);
      for (const alias of player.normalized_names) {
        addPosting(byName, alias, playerIndex);
        for (const token of new Set(alias.split(" ").filter((value) => value.length >= 2))) {
          addPosting(byToken, token, playerIndex);
        }
        for (const trigram of trigrams(alias)) addPosting(byTrigram, trigram, playerIndex);
      }
    });
    return { byId, byName, byToken, byTrigram };
  }

  function candidatePlayers(row, preparedCatalog, index) {
    const exactId = cleanText(row.sleeper_id, 80);
    if (exactId && index.byId.has(exactId)) return [preparedCatalog[index.byId.get(exactId)]];

    const rowName = normalizeName(row.raw_name);
    const exactNames = index.byName.get(rowName) || [];
    if (exactNames.length) return [...new Set(exactNames)].map((playerIndex) => preparedCatalog[playerIndex]);

    const scores = new Map();
    const countPostings = (postings, weight) => {
      if (!postings || postings.length > MAX_INDEX_POSTINGS) return;
      for (const playerIndex of postings) scores.set(playerIndex, (scores.get(playerIndex) || 0) + weight);
    };
    for (const token of new Set(rowName.split(" ").filter((value) => value.length >= 2))) {
      countPostings(index.byToken.get(token), 4);
    }
    for (const trigram of trigrams(rowName)) countPostings(index.byTrigram.get(trigram), 1);

    const rowPosition = cleanText(row.position, 5).toUpperCase().replace("DST", "DEF");
    const rowTeam = normalizeTeam(row.team || (rowPosition === "DEF" ? defenseTeamFromName(row.raw_name) : ""));
    const ranked = [...scores.entries()]
      .sort((left, right) => right[1] - left[1] || left[0] - right[0])
      .slice(0, MAX_FUZZY_CANDIDATES)
      .map(([playerIndex]) => preparedCatalog[playerIndex]);
    if (ranked.length) return ranked;

    return preparedCatalog
      .filter((player) => (!rowPosition || player.position === rowPosition) && (!rowTeam || player.team === rowTeam))
      .slice(0, MAX_FUZZY_CANDIDATES);
  }

  function scorePlayer(row, player) {
    if (row.sleeper_id && row.sleeper_id === player.sleeper_id) return 1.2;
    const rowName = normalizeName(row.raw_name);
    const rowTeam = normalizeTeam(row.team || (row.position === "DEF" ? defenseTeamFromName(row.raw_name) : ""));
    const rowPosition = cleanText(row.position, 5).toUpperCase().replace("DST", "DEF");
    let nameScore = 0;
    for (const alias of player.normalized_names) nameScore = Math.max(nameScore, similarity(rowName, alias));
    if (!rowName && rowTeam && player.position === "DEF" && rowTeam === player.team) nameScore = 1;
    if (rowPosition && rowPosition !== player.position) nameScore -= 0.35;
    if (rowTeam && rowTeam !== player.team) nameScore -= 0.12;
    if (rowTeam && rowTeam === player.team) nameScore += 0.04;
    return Math.max(0, nameScore);
  }

  function matchRow(row, preparedCatalog, index) {
    const scores = candidatePlayers(row, preparedCatalog, index)
      .map((player) => ({ player, score: scorePlayer(row, player) }))
      .filter((candidate) => candidate.score >= 0.55)
      .sort((left, right) => right.score - left.score || left.player.player.localeCompare(right.player.player))
      .slice(0, 5);
    const best = scores[0] || null;
    const second = scores[1] || null;
    const exactId = Boolean(row.sleeper_id && best?.player.sleeper_id === row.sleeper_id);
    const confident = best && (exactId || best.score >= 0.9) && (!second || best.score - second.score >= 0.055);
    return {
      ...row,
      status: confident ? "matched" : best ? "ambiguous" : "unmatched",
      selected_sleeper_id: confident ? best.player.sleeper_id : null,
      candidates: scores.map((candidate) => ({
        sleeper_id: candidate.player.sleeper_id,
        player: candidate.player.player,
        position: candidate.player.position,
        team: candidate.player.team,
        score: Math.round(candidate.score * 1000) / 1000,
      })),
    };
  }

  function markDuplicates(rows) {
    const counts = new Map();
    for (const row of rows) {
      if (row.selected_sleeper_id) counts.set(row.selected_sleeper_id, (counts.get(row.selected_sleeper_id) || 0) + 1);
    }
    return rows.map((row) => counts.get(row.selected_sleeper_id) > 1
      ? { ...row, status: "duplicate" }
      : row);
  }

  function matchCandidates(rows, catalog) {
    const prepared = prepareCatalog(catalog);
    const index = buildCatalogIndex(prepared);
    const matchedRows = markDuplicates((Array.isArray(rows) ? rows : []).map((row) => matchRow(row, prepared, index)));
    const counts = { matched: 0, ambiguous: 0, unmatched: 0, duplicate: 0 };
    for (const row of matchedRows) counts[row.status] = (counts[row.status] || 0) + 1;
    return { rows: matchedRows, counts, catalog: prepared };
  }

  function resolveRow(rows, inputIndex, sleeperId, catalog) {
    const prepared = prepareCatalog(catalog);
    const player = prepared.find((candidate) => candidate.sleeper_id === cleanText(sleeperId, 80));
    if (!player) throw new TypeError("Resolved player does not exist in the catalog");
    return markDuplicates(rows.map((row) => row.input_index === inputIndex
      ? {
        ...row,
        status: "matched",
        selected_sleeper_id: player.sleeper_id,
        candidates: [{
          sleeper_id: player.sleeper_id,
          player: player.player,
          position: player.position,
          team: player.team,
          score: 1,
        }, ...row.candidates.filter((candidate) => candidate.sleeper_id !== player.sleeper_id)],
      }
      : row));
  }

  function finalizeMatches(rows, catalog, options = {}) {
    const prepared = prepareCatalog(catalog);
    const byId = new Map(prepared.map((player) => [player.sleeper_id, player]));
    const unresolved = rows.filter((row) => row.status !== "matched" || !row.selected_sleeper_id);
    if (unresolved.length && !options.omitUnresolved) {
      throw new TypeError(`${unresolved.length} ranking rows still need review`);
    }
    const players = rows
      .filter((row) => row.status === "matched" && row.selected_sleeper_id)
      .sort((left, right) => left.rank - right.rank || left.input_index - right.input_index)
      .map((row) => ({ row, player: byId.get(row.selected_sleeper_id) }))
      .filter((entry) => entry.player)
      .map((entry, index) => ({
        rank: index + 1,
        player: entry.player.player,
        position: entry.player.position,
        team: entry.player.team,
        sleeper_id: entry.player.sleeper_id,
        adp: entry.row.adp ?? null,
        tier: entry.row.tier == null ? Math.floor(index / 12) + 1 : Math.trunc(entry.row.tier),
        notes: cleanText(entry.row.notes, 300),
      }));
    if (!players.length) throw new TypeError("No matched players are available to save");
    return players;
  }

  const api = {
    MAX_FUZZY_CANDIDATES,
    buildCatalogIndex,
    defenseTeamFromName,
    finalizeMatches,
    matchCandidates,
    normalizeName,
    normalizeTeam,
    prepareCatalog,
    resolveRow,
    similarity,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.SDCCPlayerMatcher = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
