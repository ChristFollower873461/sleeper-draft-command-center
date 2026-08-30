const test = require("node:test");
const assert = require("node:assert/strict");

const Matcher = require("../src/player-matcher.js");

const catalog = [
  { sleeper_id: "qb-1", player: "Josh Example", position: "QB", team: "BUF", aliases: [] },
  { sleeper_id: "de-1", player: "Josh Example", position: "DE", team: "JAX", aliases: [] },
  { sleeper_id: "rb-1", player: "Bijan Sample Jr.", position: "RB", team: "ATL", aliases: ["bijansample"] },
  { sleeper_id: "wr-1", player: "Amon-Ra Fiction", position: "WR", team: "DET", aliases: [] },
  { sleeper_id: "PHI", player: "PHI Defense", position: "DEF", team: "PHI", aliases: ["Philadelphia Eagles"] },
].filter((player) => ["QB", "RB", "WR", "TE", "K", "DEF"].includes(player.position));

test("normalization handles suffixes, punctuation, accents, and legacy teams", () => {
  assert.equal(Matcher.normalizeName("Bijan Sample Jr."), "bijan sample");
  assert.equal(Matcher.normalizeName("Amon-Ra Fiction"), "amon ra fiction");
  assert.equal(Matcher.normalizeTeam("JAC"), "JAX");
  assert.equal(Matcher.normalizeTeam("OAK"), "LVR");
});

test("exact Sleeper ID and exact name-position matches resolve automatically", () => {
  const result = Matcher.matchCandidates([
    { input_index: 0, rank: 1, raw_name: "wrong text", sleeper_id: "rb-1", position: "", team: "" },
    { input_index: 1, rank: 2, raw_name: "Josh Example", sleeper_id: "", position: "QB", team: "BUF" },
  ], catalog);

  assert.deepEqual(result.rows.map((row) => row.selected_sleeper_id), ["rb-1", "qb-1"]);
  assert.equal(result.counts.matched, 2);
});

test("defense nicknames and codes match the correct team defense", () => {
  assert.equal(Matcher.defenseTeamFromName("Philadelphia Eagles D/ST"), "PHI");
  const result = Matcher.matchCandidates([
    { input_index: 0, rank: 1, raw_name: "Philadelphia Eagles", position: "DEF", team: "" },
  ], catalog);
  assert.equal(result.rows[0].selected_sleeper_id, "PHI");
});

test("fuzzy typo resolves only with a confident margin", () => {
  const result = Matcher.matchCandidates([
    { input_index: 0, rank: 1, raw_name: "Amon Ra Fictin", position: "WR", team: "DET" },
  ], catalog);
  assert.equal(result.rows[0].status, "matched");
  assert.equal(result.rows[0].selected_sleeper_id, "wr-1");
});

test("same-name rows stay ambiguous without enough identity context", () => {
  const ambiguousCatalog = [
    { sleeper_id: "one", player: "Jordan Same", position: "QB", team: "SEA", aliases: [] },
    { sleeper_id: "two", player: "Jordan Same", position: "RB", team: "CHI", aliases: [] },
  ];
  const result = Matcher.matchCandidates([
    { input_index: 0, rank: 1, raw_name: "Jordan Same", position: "", team: "" },
  ], ambiguousCatalog);
  assert.equal(result.rows[0].status, "ambiguous");
  assert.equal(result.rows[0].candidates.length, 2);
});

test("duplicate assignments mark every conflicting row for review", () => {
  const result = Matcher.matchCandidates([
    { input_index: 0, rank: 1, raw_name: "Bijan Sample", position: "RB", team: "ATL" },
    { input_index: 1, rank: 2, raw_name: "Bijan Sample Jr", position: "RB", team: "ATL" },
  ], catalog);
  assert.deepEqual(result.rows.map((row) => row.status), ["duplicate", "duplicate"]);
  assert.equal(result.counts.duplicate, 2);
});

test("manual resolution clears ambiguity and finalizes contiguous public rows", () => {
  const rows = Matcher.matchCandidates([
    { input_index: 0, rank: 3, raw_name: "Unknown", position: "", team: "", adp: 10, tier: 2, notes: "target" },
    { input_index: 1, rank: 1, raw_name: "Amon Ra Fiction", position: "WR", team: "DET", adp: 2 },
  ], catalog).rows;
  const resolved = Matcher.resolveRow(rows, 0, "rb-1", catalog);
  const players = Matcher.finalizeMatches(resolved, catalog);

  assert.deepEqual(players.map((player) => player.sleeper_id), ["wr-1", "rb-1"]);
  assert.deepEqual(players.map((player) => player.rank), [1, 2]);
  assert.equal(players[1].notes, "target");
});

test("finalization refuses unresolved rows unless omission is explicit", () => {
  const rows = Matcher.matchCandidates([
    { input_index: 0, rank: 1, raw_name: "No Such Player", position: "", team: "" },
  ], catalog).rows;
  assert.throws(() => Matcher.finalizeMatches(rows, catalog), /need review/);
  assert.throws(() => Matcher.finalizeMatches(rows, catalog, { omitUnresolved: true }), /No matched players/);
});

test("large imports use a bounded fuzzy candidate pool", () => {
  const largeCatalog = Array.from({ length: 5000 }, (_value, index) => ({
    sleeper_id: `player-${index}`,
    player: `Player ${index} Example`,
    position: index % 5 ? "WR" : "RB",
    team: "DET",
  }));
  const rows = Array.from({ length: 400 }, (_value, index) => ({
    input_index: index,
    rank: index + 1,
    raw_name: `Plyer ${index} Example`,
    position: index % 5 ? "WR" : "RB",
    team: "DET",
  }));
  const started = performance.now();
  const result = Matcher.matchCandidates(rows, largeCatalog);
  const elapsed = performance.now() - started;

  assert.equal(result.rows.length, rows.length);
  assert.ok(elapsed < 4000, `matching took ${Math.round(elapsed)} ms`);
});
