const test = require("node:test");
const assert = require("node:assert/strict");

const Importer = require("../src/ranking-import.js");

test("CSV parser handles BOM, quoted commas, aliases, and CRLF", () => {
  const result = Importer.parseCsv(
    "\uFEFFrAnK,Name,Pos,Team,Sleeper ID,ADP\r\n1,\"Runner, Example\",RB,ATL,101,14.2\r\n",
  );
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].raw_name, "Runner, Example");
  assert.equal(result.candidates[0].position, "RB");
  assert.equal(result.candidates[0].sleeper_id, "101");
  assert.equal(result.candidates[0].adp, 14.2);
});

test("CSV parser rejects malformed quotes and duplicate headers", () => {
  assert.throws(
    () => Importer.parseCsv('rank,name\n1,"Unclosed'),
    (error) => error.code === "MALFORMED_CSV",
  );
  assert.throws(
    () => Importer.parseCsv("rank,name,Name\n1,A,A"),
    (error) => error.code === "DUPLICATE_HEADERS",
  );
});

test("JSON ranking packs preserve public fields and ignore unknown profile fields", () => {
  const result = Importer.parseJson(JSON.stringify({
    schema_version: 1,
    name: "Fixture board",
    format: "superflex",
    private_note: "discard me",
    players: [{ rank: 1, player: "Passer One", position: "QB", sleeper_id: "qb-1" }],
  }));

  assert.deepEqual(result.profile, { name: "Fixture board", format: "superflex" });
  assert.equal(result.candidates[0].raw_name, "Passer One");
  assert.match(result.warnings[0], /private_note/);
  assert.equal("private_note" in result.profile, false);
});

test("JSON rejects future schemas and non-player objects", () => {
  assert.throws(
    () => Importer.parseJson('{"schema_version":2,"players":[{"player":"A"}]}'),
    (error) => error.code === "UNSUPPORTED_SCHEMA",
  );
  assert.throws(
    () => Importer.parseJson('{"name":"No player list"}'),
    (error) => error.code === "MALFORMED_JSON",
  );
});

test("paste parser supports numbered, delimited, and suffix-position rows", () => {
  const result = Importer.parsePaste([
    "1. Passer One | QB | BUF",
    "Runner Two, RB, ATL",
    "Wide Three (WR) MIA",
  ].join("\n"));

  assert.equal(result.candidates.length, 3);
  assert.deepEqual(
    result.candidates.map((row) => [row.raw_name, row.position, row.team]),
    [["Passer One", "QB", "BUF"], ["Runner Two", "RB", "ATL"], ["Wide Three", "WR", "MIA"]],
  );
});

test("all import paths enforce 2 MiB and 1,000-player bounds", () => {
  assert.throws(
    () => Importer.parsePaste("x".repeat(Importer.MAX_BYTES + 1)),
    (error) => error.code === "IMPORT_TOO_LARGE",
  );
  const rows = Array.from({ length: Importer.MAX_PLAYERS + 1 }, (_value, index) => `Player ${index}`);
  assert.throws(
    () => Importer.parsePaste(rows.join("\n")),
    (error) => error.code === "TOO_MANY_PLAYERS",
  );
});

test("generic parser rejects unsupported kinds and missing identities", () => {
  assert.throws(
    () => Importer.parseInput("xml", "<players />"),
    (error) => error.code === "UNSUPPORTED_KIND",
  );
  assert.throws(
    () => Importer.parseCsv("rank,position\n1,RB"),
    (error) => error.code === "MISSING_PLAYER" && error.row === 1,
  );
});

