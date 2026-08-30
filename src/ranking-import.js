(function initRankingImport(globalScope) {
  "use strict";

  const MAX_BYTES = 2 * 1024 * 1024;
  const MAX_PLAYERS = 1000;
  const FORMATS = new Set(["one_qb", "superflex", "best_ball", "custom"]);
  const POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

  class RankingImportError extends Error {
    constructor(message, options = {}) {
      super(message);
      this.name = "RankingImportError";
      this.code = options.code || "IMPORT_ERROR";
      this.row = options.row ?? null;
    }
  }

  function cleanText(value, maximum = 300) {
    return String(value == null ? "" : value).trim().slice(0, maximum);
  }

  function byteLength(value) {
    const text = String(value == null ? "" : value);
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
    return Buffer.byteLength(text, "utf8");
  }

  function assertInputSize(text) {
    if (byteLength(text) > MAX_BYTES) {
      throw new RankingImportError("Ranking import exceeds the 2 MiB limit", { code: "IMPORT_TOO_LARGE" });
    }
  }

  function detectDelimiter(line) {
    const candidates = [",", "\t", ";"];
    let best = ",";
    let count = -1;
    for (const candidate of candidates) {
      const matches = [...line].filter((character) => character === candidate).length;
      if (matches > count) {
        best = candidate;
        count = matches;
      }
    }
    return best;
  }

  function parseDelimited(text, delimiter) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    const source = String(text).replace(/^\uFEFF/, "");
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (quoted) {
        if (character === '"' && source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else if (character === '"') {
          quoted = false;
        } else {
          field += character;
        }
      } else if (character === '"' && field.length === 0) {
        quoted = true;
      } else if (character === delimiter) {
        row.push(field);
        field = "";
      } else if (character === "\n") {
        row.push(field.replace(/\r$/, ""));
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += character;
      }
    }
    if (quoted) {
      throw new RankingImportError("CSV contains an unclosed quoted field", { code: "MALFORMED_CSV" });
    }
    if (field.length || row.length) {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
    }
    return rows.filter((values) => values.some((value) => cleanText(value)));
  }

  function normalizeHeader(value) {
    return cleanText(value, 80).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  }

  function firstValue(raw, names) {
    for (const name of names) {
      const value = raw[name];
      if (value != null && cleanText(value)) return value;
    }
    return "";
  }

  function numeric(value, minimum = 0) {
    if (value == null || cleanText(value) === "") return null;
    const result = Number(value);
    return Number.isFinite(result) && result >= minimum ? result : null;
  }

  function normalizedCandidate(raw, index) {
    const positionValue = cleanText(firstValue(raw, ["position", "pos"]), 5).toUpperCase();
    const position = positionValue === "DST" ? "DEF" : positionValue;
    const sleeperId = cleanText(firstValue(raw, ["sleeper_id", "sleeperid", "player_id", "playerid", "id"]), 80);
    const name = cleanText(firstValue(raw, ["player", "name", "full_name", "fullname", "player_name"]), 100);
    if (!name && !sleeperId) {
      throw new RankingImportError(`Row ${index + 1} needs a player name or Sleeper ID`, {
        code: "MISSING_PLAYER",
        row: index + 1,
      });
    }
    return {
      input_index: index,
      rank: Math.max(1, Math.trunc(numeric(firstValue(raw, ["rank", "overall_rank", "overall"]), 1) || index + 1)),
      raw_name: name,
      position: POSITIONS.has(position) ? position : "",
      team: cleanText(firstValue(raw, ["team", "team_abbr", "nfl_team"]), 5).toUpperCase(),
      sleeper_id: sleeperId,
      adp: numeric(firstValue(raw, ["adp", "sleeper_adp", "average_draft_position"]), 0),
      tier: numeric(firstValue(raw, ["tier", "overall_tier"]), 1),
      notes: cleanText(firstValue(raw, ["notes", "note", "comment"]), 300),
    };
  }

  function capCandidates(candidates) {
    if (candidates.length > MAX_PLAYERS) {
      throw new RankingImportError("Ranking import exceeds the 1,000-player limit", {
        code: "TOO_MANY_PLAYERS",
      });
    }
    return candidates;
  }

  function parseCsv(text) {
    assertInputSize(text);
    const firstLine = String(text).replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] || "";
    const rows = parseDelimited(text, detectDelimiter(firstLine));
    if (rows.length < 2) {
      throw new RankingImportError("CSV needs a header and at least one player row", { code: "EMPTY_IMPORT" });
    }
    const headers = rows[0].map(normalizeHeader);
    if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length) {
      throw new RankingImportError("CSV contains duplicate column names", { code: "DUPLICATE_HEADERS" });
    }
    const records = rows.slice(1).map((values) => Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""]),
    ));
    return {
      kind: "csv",
      candidates: capCandidates(records.map(normalizedCandidate)),
      warnings: [],
      profile: {},
    };
  }

  function parseJson(text) {
    assertInputSize(text);
    let raw;
    try {
      raw = JSON.parse(String(text));
    } catch (_error) {
      throw new RankingImportError("JSON could not be parsed", { code: "MALFORMED_JSON" });
    }
    const warnings = [];
    let rows;
    let profile = {};
    if (Array.isArray(raw)) {
      rows = raw;
    } else if (raw && typeof raw === "object" && Array.isArray(raw.players)) {
      if (raw.schema_version != null && raw.schema_version !== 1) {
        throw new RankingImportError(`Ranking schema ${String(raw.schema_version)} is unsupported`, {
          code: "UNSUPPORTED_SCHEMA",
        });
      }
      const allowed = new Set(["schema_version", "name", "format", "players"]);
      const ignored = Object.keys(raw).filter((key) => !allowed.has(key));
      if (ignored.length) warnings.push(`Ignored profile fields: ${ignored.join(", ")}`);
      rows = raw.players;
      profile = {
        name: cleanText(raw.name, 80),
        format: FORMATS.has(raw.format) ? raw.format : "",
      };
    } else {
      throw new RankingImportError("JSON needs a players array", { code: "MALFORMED_JSON" });
    }
    if (!rows.length) throw new RankingImportError("JSON contains no players", { code: "EMPTY_IMPORT" });
    return {
      kind: "json",
      candidates: capCandidates(rows.map((row, index) => normalizedCandidate(row || {}, index))),
      warnings,
      profile,
    };
  }

  function parsePasteLine(line, index) {
    const withoutRank = cleanText(line, 500).replace(/^\s*\d{1,4}\s*[.)#:-]\s*/, "");
    const parts = withoutRank.split(/\s*(?:\||\t|,)\s*/).filter(Boolean);
    let name = cleanText(parts[0], 100);
    let position = cleanText(parts[1], 5).toUpperCase();
    let team = cleanText(parts[2], 5).toUpperCase();
    const suffix = name.match(/^(.*?)\s+\(?((?:QB|RB|WR|TE|K|DEF|DST))\)?\s+([A-Z]{2,3})$/i);
    if (suffix) {
      name = cleanText(suffix[1], 100);
      position = suffix[2].toUpperCase();
      team = suffix[3].toUpperCase();
    }
    return normalizedCandidate({ rank: index + 1, player: name, position, team }, index);
  }

  function parsePaste(text) {
    assertInputSize(text);
    const lines = String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) throw new RankingImportError("Paste contains no players", { code: "EMPTY_IMPORT" });
    return {
      kind: "paste",
      candidates: capCandidates(lines.map(parsePasteLine)),
      warnings: [],
      profile: {},
    };
  }

  function parseInput(kind, text) {
    if (kind === "csv") return parseCsv(text);
    if (kind === "json") return parseJson(text);
    if (kind === "paste") return parsePaste(text);
    throw new RankingImportError(`Unsupported import kind: ${String(kind)}`, { code: "UNSUPPORTED_KIND" });
  }

  const api = {
    MAX_BYTES,
    MAX_PLAYERS,
    RankingImportError,
    byteLength,
    parseCsv,
    parseInput,
    parseJson,
    parsePaste,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.SDCCRankingImport = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

