const test = require("node:test");
const assert = require("node:assert/strict");

const Api = require("../src/sleeper-api.js");

function response(data, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    async json() { return data; },
  };
}

function mappedFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (!routes.has(url)) return response({ message: "missing fixture" }, { ok: false, status: 404 });
    return routes.get(url);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test("only approved Sleeper HTTPS origins can be fetched with GET", async () => {
  assert.throws(() => Api.approvedUrl("https://example.com/v1/user/test"), (error) => error.code === "BLOCKED_ORIGIN");
  assert.throws(() => Api.approvedUrl("http://api.sleeper.app/v1/state/nfl"), (error) => error.code === "BLOCKED_ORIGIN");

  const fetchImpl = mappedFetch(new Map([
    ["https://api.sleeper.app/v1/state/nfl", response({ season: "2026" })],
  ]));
  await Api.fetchJson("https://api.sleeper.app/v1/state/nfl", { fetchImpl });
  assert.equal(fetchImpl.calls[0].options.method, "GET");
  assert.equal(fetchImpl.calls[0].options.credentials, "omit");
});

test("username discovery resolves public identity, leagues, and drafts", async () => {
  const routes = new Map([
    ["https://api.sleeper.app/v1/user/coach", response({
      user_id: "user-1", username: "coach", display_name: "Coach",
    })],
    ["https://api.sleeper.app/v1/user/user-1/leagues/nfl/2026", response([
      { league_id: "league-1", name: "Public fixture league", status: "pre_draft" },
    ])],
    ["https://api.sleeper.app/v1/user/user-1/drafts/nfl/2026", response([
      { draft_id: "draft-1", league_id: "league-1", start_time: 200 },
      { draft_id: "draft-2", league_id: null, created: 100 },
    ])],
  ]);
  const result = await Api.discoverUser("coach", {
    state: { season: "2026", league_season: "2026" },
    fetchImpl: mappedFetch(routes),
  });

  assert.equal(result.user.user_id, "user-1");
  assert.equal(result.leagues.length, 1);
  assert.equal(result.drafts[0].league.name, "Public fixture league");
  assert.equal(result.drafts[1].league, null);
});

test("missing users and malformed collections fail explicitly", async () => {
  await assert.rejects(
    Api.resolveUser("nobody", { fetchImpl: async () => response(null) }),
    (error) => error.code === "EMPTY_RESPONSE",
  );
  await assert.rejects(
    Api.fetchUserDrafts("user-1", "2026", { fetchImpl: async () => response({}) }),
    (error) => error.code === "MALFORMED_RESPONSE",
  );
  await assert.rejects(
    Api.fetchJson("https://api.sleeper.app/v1/state/nfl", {
      fetchImpl: async () => response({}, { ok: false, status: 429 }),
    }),
    (error) => error.code === "HTTP_ERROR" && error.retryable === true,
  );
});

test("draft bundle joins a draft, picks, league, and rosters with GET requests", async () => {
  const urls = [];
  const fetchImpl = async (url, options) => {
    urls.push([new URL(url).pathname, options.method]);
    const pathname = new URL(url).pathname;
    const body = pathname === "/v1/draft/draft-one"
      ? { draft_id: "draft-one", league_id: "league-one", settings: { teams: 12, rounds: 17 } }
      : pathname === "/v1/draft/draft-one/picks"
        ? [{ pick_no: 1, player_id: "player-one" }]
        : pathname === "/v1/league/league-one"
          ? { league_id: "league-one", roster_positions: ["QB", "RB", "WR"] }
          : [{ roster_id: 1, owner_id: "coach" }];
    return response(body);
  };
  const bundle = await Api.fetchDraftBundle("draft-one", { fetchImpl });
  assert.equal(bundle.draft.draft_id, "draft-one");
  assert.equal(bundle.picks.length, 1);
  assert.equal(bundle.league.league_id, "league-one");
  assert.equal(bundle.rosters[0].owner_id, "coach");
  assert.deepEqual(urls, [
    ["/v1/draft/draft-one", "GET"],
    ["/v1/draft/draft-one/picks", "GET"],
    ["/v1/league/league-one", "GET"],
    ["/v1/league/league-one/rosters", "GET"],
  ]);
});

test("draft bundle skips league calls for standalone mocks", async () => {
  const paths = [];
  const fetchImpl = async (url) => {
    const pathname = new URL(url).pathname;
    paths.push(pathname);
    return response(pathname.endsWith("/picks") ? [] : { draft_id: "mock-one", settings: { teams: 10, rounds: 15 } });
  };
  const bundle = await Api.fetchDraftBundle("mock-one", { fetchImpl });
  assert.equal(bundle.league, null);
  assert.deepEqual(bundle.rosters, []);
  assert.deepEqual(paths, ["/v1/draft/mock-one", "/v1/draft/mock-one/picks"]);
});

test("player catalog normalizes skill players and team defenses", () => {
  const catalog = Api.normalizeCatalog({
    "101": {
      player_id: "101", first_name: "Example", last_name: "Runner", position: "RB",
      team: "ATL", search_rank: 12, active: true,
    },
    PHI: { player_id: "PHI", position: "DEF", team: "PHI", active: true },
    coach: { player_id: "coach", position: "OL", active: true },
  });

  assert.equal(catalog.length, 2);
  assert.equal(catalog[0].player, "Example Runner");
  assert.equal(catalog[1].player, "PHI Defense");
  assert.ok(catalog[1].aliases.includes("PHI D/ST"));
});

test("ADP format key follows superflex, dynasty, and reception scoring", () => {
  assert.equal(Api.adpKeyFor({ format: "superflex" }), "adp_2qb");
  assert.equal(Api.adpKeyFor({ format: "one_qb", receptionPoints: 1 }), "adp_ppr");
  assert.equal(Api.adpKeyFor({ format: "one_qb", receptionPoints: 0 }), "adp_std");
  assert.equal(Api.adpKeyFor({ format: "superflex", dynasty: true }), "adp_dynasty_2qb");
});

test("starter board uses fresh format ADP and excludes specialists in best ball", () => {
  const catalog = [
    { sleeper_id: "qb", player: "Quarter Back", position: "QB", team: "BUF", search_rank: 30, active: true },
    { sleeper_id: "rb", player: "Running Back", position: "RB", team: "ATL", search_rank: 1, active: true },
    { sleeper_id: "k", player: "Kicker One", position: "K", team: "DAL", search_rank: 2, active: true },
    { sleeper_id: "def", player: "PHI Defense", position: "DEF", team: "PHI", search_rank: 3, active: true },
  ];
  const now = Date.parse("2026-08-29T12:00:00Z");
  const projections = [
    { player_id: "qb", last_modified: now - 3600000, stats: { adp_2qb: 1, adp_half_ppr: 25 } },
    { player_id: "rb", last_modified: now - 3600000, stats: { adp_2qb: 5, adp_half_ppr: 1 } },
  ];
  const result = Api.buildStarterBoard(catalog, projections, {
    format: "best_ball", limit: 2, generatedAt: now, receptionPoints: 0.5,
  });

  assert.deepEqual(result.players.map((player) => player.sleeper_id), ["rb", "qb"]);
  assert.ok(result.players.every((player) => !["K", "DEF"].includes(player.position)));
  assert.equal(result.baseline.source, "sleeper_public_adp");
  assert.equal(result.baseline.stale, false);
  assert.equal(result.baseline.complete, true);
});

test("starter board falls back to public search order and reports stale coverage", () => {
  const catalog = [
    { sleeper_id: "two", player: "Second", position: "WR", team: "SEA", search_rank: 2, active: true },
    { sleeper_id: "one", player: "First", position: "RB", team: "MIA", search_rank: 1, active: true },
  ];
  const result = Api.buildStarterBoard(catalog, [], {
    format: "one_qb", limit: 2, generatedAt: "2026-08-29T12:00:00Z",
  });

  assert.deepEqual(result.players.map((player) => player.sleeper_id), ["one", "two"]);
  assert.equal(result.baseline.source, "sleeper_search_rank");
  assert.equal(result.baseline.adp_coverage, 0);
  assert.equal(result.baseline.stale, true);
});
