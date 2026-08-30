(function initSleeperApi(globalScope) {
  "use strict";

  const API_ORIGIN = "https://api.sleeper.app";
  const DATA_ORIGIN = "https://api.sleeper.com";
  const ALLOWED_ORIGINS = new Set([API_ORIGIN, DATA_ORIGIN]);
  const POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
  const DEFAULT_TIMEOUT_MS = 12000;

  class SleeperApiError extends Error {
    constructor(message, options = {}) {
      super(message);
      this.name = "SleeperApiError";
      this.code = options.code || "SLEEPER_API_ERROR";
      this.status = options.status ?? null;
      this.retryable = Boolean(options.retryable);
    }
  }

  function cleanText(value, maximum = 120) {
    return String(value == null ? "" : value).trim().slice(0, maximum);
  }

  function safeSegment(value, label) {
    const text = cleanText(value, 100);
    if (!text || !/^[A-Za-z0-9._-]+$/.test(text)) {
      throw new SleeperApiError(`${label} is invalid`, { code: "INVALID_INPUT" });
    }
    return encodeURIComponent(text);
  }

  function approvedUrl(value) {
    const url = value instanceof URL ? value : new URL(String(value));
    if (!ALLOWED_ORIGINS.has(url.origin) || url.protocol !== "https:") {
      throw new SleeperApiError("Blocked non-Sleeper API origin", { code: "BLOCKED_ORIGIN" });
    }
    return url;
  }

  async function fetchJson(value, options = {}) {
    const url = approvedUrl(value);
    const fetchImpl = options.fetchImpl || globalScope?.fetch;
    if (typeof fetchImpl !== "function") {
      throw new SleeperApiError("Fetch is unavailable", { code: "FETCH_UNAVAILABLE" });
    }
    const timeoutMs = Number.isFinite(options.timeoutMs)
      ? Math.max(250, Math.min(60000, options.timeoutMs))
      : DEFAULT_TIMEOUT_MS;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(url.toString(), {
        method: "GET",
        credentials: "omit",
        cache: options.cache || "no-store",
        signal: controller?.signal,
        headers: { Accept: "application/json" },
      });
      if (!response || !response.ok) {
        const status = Number(response?.status) || null;
        throw new SleeperApiError(`Sleeper request failed${status ? ` (${status})` : ""}`, {
          code: "HTTP_ERROR",
          status,
          retryable: status === 429 || status == null || status >= 500,
        });
      }
      const data = await response.json();
      if (data == null) {
        throw new SleeperApiError("Sleeper returned an empty response", { code: "EMPTY_RESPONSE" });
      }
      return data;
    } catch (error) {
      if (error instanceof SleeperApiError) throw error;
      const timedOut = error?.name === "AbortError";
      throw new SleeperApiError(timedOut ? "Sleeper request timed out" : "Sleeper request failed", {
        code: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
        retryable: true,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function appUrl(path) {
    return approvedUrl(`${API_ORIGIN}${path}`);
  }

  async function fetchNflState(options = {}) {
    const state = await fetchJson(appUrl("/v1/state/nfl"), options);
    const season = cleanText(state.season ?? state.league_season, 4);
    if (!/^\d{4}$/.test(season)) {
      throw new SleeperApiError("NFL state did not include a valid season", { code: "MALFORMED_RESPONSE" });
    }
    return { ...state, season };
  }

  async function resolveUser(username, options = {}) {
    const user = await fetchJson(appUrl(`/v1/user/${safeSegment(username, "Username")}`), options);
    const userId = cleanText(user.user_id, 80);
    if (!userId) {
      throw new SleeperApiError("Sleeper user was not found", { code: "USER_NOT_FOUND", status: 404 });
    }
    return {
      user_id: userId,
      username: cleanText(user.username ?? username, 50),
      display_name: cleanText(user.display_name ?? user.username ?? username, 80),
      avatar: cleanText(user.avatar, 100),
    };
  }

  async function fetchUserLeagues(userId, season, options = {}) {
    const data = await fetchJson(
      appUrl(`/v1/user/${safeSegment(userId, "User ID")}/leagues/nfl/${safeSegment(season, "Season")}`),
      options,
    );
    if (!Array.isArray(data)) {
      throw new SleeperApiError("League response was malformed", { code: "MALFORMED_RESPONSE" });
    }
    return data;
  }

  async function fetchUserDrafts(userId, season, options = {}) {
    const data = await fetchJson(
      appUrl(`/v1/user/${safeSegment(userId, "User ID")}/drafts/nfl/${safeSegment(season, "Season")}`),
      options,
    );
    if (!Array.isArray(data)) {
      throw new SleeperApiError("Draft response was malformed", { code: "MALFORMED_RESPONSE" });
    }
    return data;
  }

  async function discoverUser(username, options = {}) {
    const state = options.state || await fetchNflState(options);
    const user = await resolveUser(username, options);
    const season = cleanText(options.season || state.league_season || state.season, 4);
    const [leagues, drafts] = await Promise.all([
      fetchUserLeagues(user.user_id, season, options),
      fetchUserDrafts(user.user_id, season, options),
    ]);
    const leagueById = new Map(leagues.map((league) => [String(league.league_id), league]));
    const normalizedDrafts = drafts
      .filter((draft) => draft && draft.draft_id)
      .map((draft) => ({
        ...draft,
        league: draft.league_id ? leagueById.get(String(draft.league_id)) || null : null,
      }))
      .sort((left, right) => Number(right.start_time || right.created || 0) - Number(left.start_time || left.created || 0));
    return { state, season, user, leagues, drafts: normalizedDrafts };
  }

  async function fetchDraft(draftId, options = {}) {
    return fetchJson(appUrl(`/v1/draft/${safeSegment(draftId, "Draft ID")}`), options);
  }

  async function fetchDraftPicks(draftId, options = {}) {
    const picks = await fetchJson(appUrl(`/v1/draft/${safeSegment(draftId, "Draft ID")}/picks`), options);
    if (!Array.isArray(picks)) {
      throw new SleeperApiError("Draft picks response was malformed", { code: "MALFORMED_RESPONSE" });
    }
    return picks;
  }

  async function fetchLeague(leagueId, options = {}) {
    const league = await fetchJson(appUrl(`/v1/league/${safeSegment(leagueId, "League ID")}`), options);
    if (!league || typeof league !== "object" || Array.isArray(league) || !cleanText(league.league_id, 80)) {
      throw new SleeperApiError("League response was malformed", { code: "MALFORMED_RESPONSE" });
    }
    return league;
  }

  async function fetchLeagueRosters(leagueId, options = {}) {
    const rosters = await fetchJson(
      appUrl(`/v1/league/${safeSegment(leagueId, "League ID")}/rosters`),
      options,
    );
    if (!Array.isArray(rosters)) {
      throw new SleeperApiError("League rosters response was malformed", { code: "MALFORMED_RESPONSE" });
    }
    return rosters;
  }

  async function fetchDraftBundle(draftId, options = {}) {
    const draft = await fetchDraft(draftId, options);
    const leagueId = cleanText(draft?.league_id, 80);
    const [picks, league, rosters] = await Promise.all([
      fetchDraftPicks(draftId, options),
      leagueId ? fetchLeague(leagueId, options) : Promise.resolve(null),
      leagueId ? fetchLeagueRosters(leagueId, options) : Promise.resolve([]),
    ]);
    return { draft, picks, league, rosters };
  }

  function playerName(raw, playerId) {
    const first = cleanText(raw.first_name, 50);
    const last = cleanText(raw.last_name, 80);
    const full = cleanText(raw.full_name, 100) || [first, last].filter(Boolean).join(" ");
    if (full) return full;
    const team = cleanText(raw.team ?? playerId, 5).toUpperCase();
    return team ? `${team} Defense` : "Unknown player";
  }

  function normalizeCatalog(rawCatalog) {
    if (!rawCatalog || typeof rawCatalog !== "object" || Array.isArray(rawCatalog)) {
      throw new SleeperApiError("Player directory was malformed", { code: "MALFORMED_RESPONSE" });
    }
    return Object.entries(rawCatalog)
      .map(([key, raw]) => {
        if (!raw || typeof raw !== "object") return null;
        const sleeperId = cleanText(raw.player_id ?? key, 80);
        let position = cleanText(raw.position ?? raw.fantasy_positions?.[0], 5).toUpperCase();
        if (position === "DST") position = "DEF";
        if (!sleeperId || !POSITIONS.has(position)) return null;
        const team = cleanText(raw.team ?? (position === "DEF" ? sleeperId : ""), 5).toUpperCase();
        const name = playerName(raw, sleeperId);
        const aliases = [
          raw.search_full_name,
          raw.full_name,
          [raw.first_name, raw.last_name].filter(Boolean).join(" "),
          position === "DEF" ? `${team} D/ST` : "",
          position === "DEF" ? `${team} Defense` : "",
        ].map((value) => cleanText(value, 100)).filter(Boolean);
        return {
          sleeper_id: sleeperId,
          player: name,
          position,
          team,
          search_rank: Number.isFinite(Number(raw.search_rank)) ? Number(raw.search_rank) : null,
          aliases: [...new Set(aliases)],
          active: raw.active !== false,
        };
      })
      .filter(Boolean);
  }

  async function fetchPlayerCatalog(options = {}) {
    const raw = await fetchJson(appUrl("/v1/players/nfl?active=true"), {
      ...options,
      cache: options.cache || "default",
    });
    return normalizeCatalog(raw);
  }

  function adpKeyFor(options = {}) {
    const format = cleanText(options.format, 20);
    const dynasty = Boolean(options.dynasty);
    const reception = Number(options.receptionPoints ?? options.scoring?.rec ?? 0.5);
    if (dynasty) {
      if (format === "superflex") return "adp_dynasty_2qb";
      if (reception >= 0.75) return "adp_dynasty_ppr";
      if (reception >= 0.25) return "adp_dynasty_half_ppr";
      return "adp_dynasty_std";
    }
    if (format === "superflex") return "adp_2qb";
    if (reception >= 0.75) return "adp_ppr";
    if (reception >= 0.25) return "adp_half_ppr";
    return "adp_std";
  }

  function projectionsUrl(season) {
    const url = approvedUrl(`${DATA_ORIGIN}/projections/nfl/${safeSegment(season, "Season")}`);
    url.searchParams.set("season_type", "regular");
    for (const position of POSITIONS) url.searchParams.append("position[]", position);
    url.searchParams.set("order_by", "half_ppr");
    return url;
  }

  async function fetchAdp(season, options = {}) {
    const data = await fetchJson(projectionsUrl(season), options);
    if (!Array.isArray(data)) {
      throw new SleeperApiError("ADP response was malformed", { code: "MALFORMED_RESPONSE" });
    }
    return data;
  }

  function numericAdp(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 && number < 900 ? number : null;
  }

  function buildStarterBoard(catalog, projections, options = {}) {
    if (!Array.isArray(catalog) || catalog.length === 0) {
      throw new SleeperApiError("A player catalog is required", { code: "MALFORMED_CATALOG" });
    }
    const limit = Math.max(1, Math.min(1000, Number(options.limit) || 250));
    const format = cleanText(options.format, 20) || "one_qb";
    const adpKey = adpKeyFor(options);
    const projectionMap = new Map();
    let latestUpdate = 0;
    for (const projection of Array.isArray(projections) ? projections : []) {
      const playerId = cleanText(projection?.player_id, 80);
      const adp = numericAdp(projection?.stats?.[adpKey]);
      if (playerId && adp != null) projectionMap.set(playerId, adp);
      latestUpdate = Math.max(latestUpdate, Number(projection?.last_modified || projection?.updated_at || 0));
    }
    const allowedPositions = format === "best_ball"
      ? new Set(["QB", "RB", "WR", "TE"])
      : POSITIONS;
    const rows = catalog
      .filter((player) => player.active !== false && allowedPositions.has(player.position))
      .map((player) => {
        const adp = projectionMap.get(player.sleeper_id) ?? null;
        const fallback = Number.isFinite(player.search_rank) && player.search_rank > 0
          ? player.search_rank
          : 10000;
        return { ...player, adp, sort_value: adp ?? fallback };
      })
      .sort((left, right) => left.sort_value - right.sort_value || left.player.localeCompare(right.player))
      .slice(0, limit)
      .map((player, index) => ({
        rank: index + 1,
        player: player.player,
        position: player.position,
        team: player.team,
        sleeper_id: player.sleeper_id,
        adp: player.adp,
        tier: Math.floor(index / 12) + 1,
        notes: "",
      }));
    const generatedAt = options.generatedAt ? new Date(options.generatedAt) : new Date();
    const sourceDate = latestUpdate ? new Date(latestUpdate) : null;
    const ageMs = sourceDate && Number.isFinite(sourceDate.getTime())
      ? Math.max(0, generatedAt.getTime() - sourceDate.getTime())
      : null;
    const adpCount = rows.filter((player) => player.adp != null).length;
    return {
      players: rows,
      baseline: {
        source: adpCount > 0 ? "sleeper_public_adp" : "sleeper_search_rank",
        adp_key: adpKey,
        generated_at: generatedAt.toISOString(),
        source_updated_at: sourceDate && Number.isFinite(sourceDate.getTime()) ? sourceDate.toISOString() : null,
        age_hours: ageMs == null ? null : Math.round((ageMs / 3600000) * 10) / 10,
        stale: ageMs == null || ageMs > 7 * 24 * 3600000,
        adp_coverage: rows.length ? Math.round((adpCount / rows.length) * 1000) / 1000 : 0,
        complete: rows.length === limit,
      },
    };
  }

  const api = {
    API_ORIGIN,
    DATA_ORIGIN,
    SleeperApiError,
    adpKeyFor,
    approvedUrl,
    buildStarterBoard,
    discoverUser,
    fetchAdp,
    fetchDraft,
    fetchDraftBundle,
    fetchDraftPicks,
    fetchJson,
    fetchNflState,
    fetchLeague,
    fetchLeagueRosters,
    fetchPlayerCatalog,
    fetchUserDrafts,
    fetchUserLeagues,
    normalizeCatalog,
    projectionsUrl,
    resolveUser,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.SDCCSleeperApi = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
