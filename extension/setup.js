(function initializeSetupWorkspace() {
  "use strict";

  const Storage = globalThis.SDCCStorage;
  const StateClient = globalThis.SDCCStateClient;
  const SleeperApi = globalThis.SDCCSleeperApi;
  const Importer = globalThis.SDCCRankingImport;
  const Matcher = globalThis.SDCCPlayerMatcher;
  const CATALOG_CACHE_KEY = "sdccPublicCatalogCacheV1";
  const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
  const STEPS = ["identity", "board", "review", "ready"];

  const app = {
    state: Storage.createDefaultState(),
    discovery: null,
    catalog: [],
    reviewRows: [],
    source: null,
    baseline: null,
    resolverInputIndex: null,
  };

  const elements = {
    globalMessage: document.querySelector("#global-message"),
    identityForm: document.querySelector("#identity-form"),
    username: document.querySelector("#username"),
    identityReadout: document.querySelector("#identity-readout"),
    identityName: document.querySelector("#identity-name"),
    identitySeason: document.querySelector("#identity-season"),
    identityLeagues: document.querySelector("#identity-leagues"),
    identityDrafts: document.querySelector("#identity-drafts"),
    identityStatus: document.querySelector("#identity-status"),
    profileName: document.querySelector("#profile-name-input"),
    profileFormat: document.querySelector("#profile-format"),
    baselineReadout: document.querySelector("#baseline-readout"),
    buildPublic: document.querySelector("#build-public-board"),
    paste: document.querySelector("#paste-rankings"),
    parsePaste: document.querySelector("#parse-paste"),
    file: document.querySelector("#ranking-file"),
    fileLabel: document.querySelector("#file-label"),
    parseFile: document.querySelector("#parse-file"),
    boardStatus: document.querySelector("#board-status"),
    reviewRows: document.querySelector("#review-rows"),
    reviewEmpty: document.querySelector("#review-empty"),
    reviewSearch: document.querySelector("#review-search"),
    reviewFilter: document.querySelector("#review-filter"),
    reviewStatus: document.querySelector("#review-status"),
    saveProfile: document.querySelector("#save-profile"),
    countMatched: document.querySelector("#count-matched"),
    countNeedsReview: document.querySelector("#count-needs-review"),
    countOmitted: document.querySelector("#count-omitted"),
    activeProfile: document.querySelector("#active-profile-select"),
    draftSelect: document.querySelector("#draft-select"),
    readyPlayerCount: document.querySelector("#ready-player-count"),
    readyFormat: document.querySelector("#ready-format"),
    readyDraftStatus: document.querySelector("#ready-draft-status"),
    readyStatus: document.querySelector("#ready-status"),
    openEditor: document.querySelector("#open-ranking-editor"),
    openCommandCenter: document.querySelector("#open-command-center"),
    openDraft: document.querySelector("#open-sleeper-draft"),
    resolverDialog: document.querySelector("#resolver-dialog"),
    resolverTitle: document.querySelector("#resolver-title"),
    resolverSearch: document.querySelector("#resolver-search"),
    resolverResults: document.querySelector("#resolver-results"),
    omitRow: document.querySelector("#omit-row"),
  };

  function setMessage(message = "", kind = "") {
    elements.globalMessage.textContent = message;
    elements.globalMessage.className = `message-line${kind ? ` ${kind}` : ""}`;
  }

  function setInline(element, message, kind = "") {
    element.textContent = message;
    element.className = `inline-status${kind ? ` ${kind}` : ""}`;
  }

  function errorMessage(error) {
    if (error?.code === "USER_NOT_FOUND" || error?.code === "EMPTY_RESPONSE") return "Sleeper username not found.";
    if (error?.code === "IMPORT_TOO_LARGE") return "Import exceeds the 2 MiB limit.";
    if (error?.message) return error.message;
    return "The operation could not be completed.";
  }

  function setSignal(name, state, label) {
    const signal = document.querySelector(`[data-signal="${name}"]`);
    signal.classList.remove("ready", "warn", "error");
    if (state) signal.classList.add(state);
    signal.querySelector("em").textContent = label;
  }

  function activateStep(step) {
    if (!STEPS.includes(step)) return;
    for (const button of document.querySelectorAll(".stage-nav [data-step]")) {
      const active = button.dataset.step === step;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    }
    for (const panel of document.querySelectorAll("[data-step-panel]")) {
      const active = panel.dataset.stepPanel === step;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    }
    history.replaceState(null, "", `#${step}`);
    document.querySelector(".stage-content").scrollIntoView({ block: "start" });
  }

  function slug(value) {
    return String(value || "profile").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "profile";
  }

  async function writeState(nextState) {
    const committed = await StateClient.commitState(app.state, nextState);
    app.state = committed.state;
    return committed.warnings;
  }

  function rosterPositions(format) {
    if (format === "superflex") {
      return ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPER_FLEX", "K", "DEF", ...Array(7).fill("BN")];
    }
    if (format === "best_ball") {
      return ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "FLEX", ...Array(9).fill("BN")];
    }
    return ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", ...Array(7).fill("BN")];
  }

  function sourceName(source) {
    return ({ public_adp: "Public ADP", paste: "Pasted list", csv: "CSV", json: "JSON" })[source] || "Imported list";
  }

  function renderIdentity() {
    const connected = Boolean(app.state.user.user_id);
    elements.username.value = app.state.user.username || elements.username.value;
    if (connected) {
      elements.identityReadout.hidden = false;
      elements.identityName.textContent = app.discovery?.user.display_name || app.state.user.username;
      elements.identitySeason.textContent = app.discovery?.season || "Reconnect";
      elements.identityLeagues.textContent = String(app.discovery?.leagues.length ?? "-");
      elements.identityDrafts.textContent = String(app.discovery?.drafts.length ?? "-");
      setInline(elements.identityStatus, app.discovery ? "Public profile connected" : "Saved profile available; reconnect to refresh drafts", app.discovery ? "success" : "warn");
      document.querySelector('[data-next-step="board"]').disabled = false;
      setSignal("identity", app.discovery ? "ready" : "warn", app.discovery ? "Linked" : "Saved");
    } else {
      elements.identityReadout.hidden = true;
      setSignal("identity", "", "Open");
    }
  }

  function draftLabel(draft) {
    const leagueName = draft.league?.name || draft.metadata?.name || "Mock draft";
    const status = String(draft.status || "unknown").replaceAll("_", " ");
    return `${leagueName} | ${status}`;
  }

  function renderDrafts() {
    const selected = app.state.settings.last_draft_id || "";
    elements.draftSelect.replaceChildren(new Option("No draft selected", ""));
    for (const draft of app.discovery?.drafts || []) {
      elements.draftSelect.append(new Option(draftLabel(draft), String(draft.draft_id)));
    }
    if (selected && ![...elements.draftSelect.options].some((option) => option.value === selected)) {
      elements.draftSelect.append(new Option(`Saved draft | ${selected}`, selected));
    }
    elements.draftSelect.value = selected;
    renderReadyState();
  }

  function renderProfiles() {
    const activeId = app.state.settings.active_ranking_profile_id || "";
    elements.activeProfile.replaceChildren();
    if (!app.state.ranking_profiles.length) {
      elements.activeProfile.append(new Option("No ranking profiles", ""));
      elements.activeProfile.disabled = true;
    } else {
      elements.activeProfile.disabled = false;
      for (const profile of app.state.ranking_profiles) {
        elements.activeProfile.append(new Option(`${profile.name} | ${profile.players.length}`, profile.id));
      }
      elements.activeProfile.value = activeId || app.state.ranking_profiles[0].id;
    }
    renderReadyState();
  }

  function activeProfile() {
    const id = elements.activeProfile.value || app.state.settings.active_ranking_profile_id;
    return app.state.ranking_profiles.find((profile) => profile.id === id) || null;
  }

  function renderReadyState() {
    const profile = activeProfile();
    const draftId = elements.draftSelect.value || app.state.settings.last_draft_id || "";
    elements.readyPlayerCount.textContent = String(profile?.players.length || 0);
    elements.readyFormat.textContent = profile ? profile.format.replaceAll("_", " ") : "-";
    elements.readyDraftStatus.textContent = draftId ? "Live selected" : "Manual ready";
    elements.openEditor.disabled = !profile;
    elements.openCommandCenter.disabled = !profile || !draftId;
    elements.openDraft.disabled = !draftId;
    if (profile) {
      setInline(elements.readyStatus, draftId ? "Profile and live draft selected" : "Profile saved; no live draft selected", draftId ? "success" : "warn");
      setSignal("board", "ready", `${profile.players.length}`);
    } else {
      setInline(elements.readyStatus, "Save a ranking profile");
      setSignal("board", "", "Open");
    }
    setSignal("room", draftId ? "ready" : profile ? "warn" : "", draftId ? "Live" : profile ? "Manual" : "Open");
  }

  async function connectIdentity(event) {
    event.preventDefault();
    const button = elements.identityForm.querySelector("button");
    const username = elements.username.value.trim();
    button.disabled = true;
    setInline(elements.identityStatus, "Reading Sleeper public profile...");
    setMessage();
    try {
      app.discovery = await SleeperApi.discoverUser(username);
      await writeState({
        ...app.state,
        user: { username: app.discovery.user.username, user_id: app.discovery.user.user_id },
      });
      renderIdentity();
      renderDrafts();
      elements.profileName.value = `${app.discovery.season} rankings`;
      setMessage("Sleeper profile connected. Draft discovery is current.", "success");
    } catch (error) {
      setInline(elements.identityStatus, errorMessage(error), "error");
      setSignal("identity", "error", "Error");
      setMessage(errorMessage(error), "error");
    } finally {
      button.disabled = false;
    }
  }

  async function ensureCatalog() {
    if (app.catalog.length) return app.catalog;
    const cached = await StateClient.getValue(CATALOG_CACHE_KEY);
    const fetchedAt = Date.parse(cached?.fetched_at || "");
    const fresh = Array.isArray(cached?.players)
      && cached.players.length >= 250
      && Number.isFinite(fetchedAt)
      && Date.now() - fetchedAt < CATALOG_TTL_MS;
    if (fresh) {
      app.catalog = cached.players;
      return app.catalog;
    }
    try {
      app.catalog = await SleeperApi.fetchPlayerCatalog();
      const cache = {
        schema_version: 1,
        fetched_at: new Date().toISOString(),
        players: app.catalog,
      };
      if (Storage.serializedBytes(cache) <= Storage.MAX_CATALOG_CACHE_BYTES) {
        await StateClient.setValue(CATALOG_CACHE_KEY, cache);
      } else {
        setMessage("Player directory is ready for this session but is too large to cache.", "warn");
      }
      return app.catalog;
    } catch (error) {
      if (Array.isArray(cached?.players) && cached.players.length >= 250) {
        app.catalog = cached.players;
        setMessage("Sleeper player refresh failed; using the saved directory.", "warn");
        return app.catalog;
      }
      throw error;
    }
  }

  function reviewRowForPlayer(player, index) {
    return {
      input_index: index,
      rank: index + 1,
      raw_name: player.player,
      position: player.position,
      team: player.team,
      sleeper_id: player.sleeper_id,
      adp: player.adp,
      tier: player.tier,
      notes: player.notes,
      status: "matched",
      selected_sleeper_id: player.sleeper_id,
      candidates: [{
        sleeper_id: player.sleeper_id,
        player: player.player,
        position: player.position,
        team: player.team,
        score: 1,
      }],
    };
  }

  async function buildPublicBoard() {
    elements.buildPublic.disabled = true;
    setInline(elements.boardStatus, "Loading Sleeper player and ADP data...");
    setMessage();
    try {
      const catalog = await ensureCatalog();
      const state = app.discovery?.state || await SleeperApi.fetchNflState();
      let projections = [];
      let fallbackReason = "";
      try {
        projections = await SleeperApi.fetchAdp(state.season);
      } catch (error) {
        fallbackReason = errorMessage(error);
      }
      const result = SleeperApi.buildStarterBoard(catalog, projections, {
        format: elements.profileFormat.value,
        limit: 250,
        generatedAt: new Date(),
      });
      app.source = "public_adp";
      app.baseline = result.baseline;
      app.reviewRows = result.players.map(reviewRowForPlayer);
      elements.baselineReadout.textContent = result.baseline.source === "sleeper_public_adp"
        ? `${Math.round(result.baseline.adp_coverage * 100)}% ADP coverage | ${result.baseline.age_hours ?? "?"}h source age`
        : `Player-order fallback${fallbackReason ? ` | ${fallbackReason}` : ""}`;
      setInline(elements.boardStatus, `${result.players.length} players loaded`, result.baseline.stale ? "warn" : "success");
      setSignal("board", "ready", `${result.players.length}`);
      renderReview();
      activateStep("review");
    } catch (error) {
      setInline(elements.boardStatus, errorMessage(error), "error");
      setSignal("board", "error", "Error");
      setMessage(errorMessage(error), "error");
    } finally {
      elements.buildPublic.disabled = false;
    }
  }

  async function prepareImport(parsed) {
    const catalog = await ensureCatalog();
    const matched = Matcher.matchCandidates(parsed.candidates, catalog);
    app.source = parsed.kind;
    app.baseline = null;
    app.reviewRows = matched.rows;
    if (parsed.profile.name) elements.profileName.value = parsed.profile.name;
    if (parsed.profile.format) elements.profileFormat.value = parsed.profile.format;
    setInline(elements.boardStatus, `${parsed.candidates.length} players parsed from ${sourceName(parsed.kind)}`, "success");
    setSignal("board", "ready", `${parsed.candidates.length}`);
    if (parsed.warnings.length) setMessage(parsed.warnings.join(" "), "warn");
    renderReview();
    activateStep("review");
  }

  async function parsePastedList() {
    elements.parsePaste.disabled = true;
    setInline(elements.boardStatus, "Parsing pasted rankings...");
    setMessage();
    try {
      await prepareImport(Importer.parsePaste(elements.paste.value));
    } catch (error) {
      setInline(elements.boardStatus, errorMessage(error), "error");
      setMessage(errorMessage(error), "error");
    } finally {
      elements.parsePaste.disabled = false;
    }
  }

  async function parseRankingFile() {
    const file = elements.file.files?.[0];
    if (!file) return;
    elements.parseFile.disabled = true;
    setInline(elements.boardStatus, `Parsing ${file.name}...`);
    setMessage();
    try {
      if (file.size > Importer.MAX_BYTES) throw new Importer.RankingImportError("Ranking import exceeds the 2 MiB limit", { code: "IMPORT_TOO_LARGE" });
      const extension = file.name.toLowerCase().split(".").pop();
      const kind = extension === "json" || file.type === "application/json" ? "json" : "csv";
      await prepareImport(Importer.parseInput(kind, await file.text()));
    } catch (error) {
      setInline(elements.boardStatus, errorMessage(error), "error");
      setMessage(errorMessage(error), "error");
    } finally {
      elements.parseFile.disabled = false;
    }
  }

  function reconcileRows(rows) {
    const counts = new Map();
    for (const row of rows) {
      if (row.status !== "omitted" && row.selected_sleeper_id) {
        counts.set(row.selected_sleeper_id, (counts.get(row.selected_sleeper_id) || 0) + 1);
      }
    }
    return rows.map((row) => {
      if (row.status === "omitted") return row;
      if (row.selected_sleeper_id && counts.get(row.selected_sleeper_id) > 1) return { ...row, status: "duplicate" };
      if (row.selected_sleeper_id) return { ...row, status: "matched" };
      return { ...row, status: row.candidates.length ? "ambiguous" : "unmatched" };
    });
  }

  function resolvedPlayer(row) {
    if (!row.selected_sleeper_id) return null;
    return app.catalog.find((player) => player.sleeper_id === row.selected_sleeper_id)
      || row.candidates.find((player) => player.sleeper_id === row.selected_sleeper_id)
      || null;
  }

  function createPlayerCell(name, position, team, sleeperId = "") {
    const cell = document.createElement("td");
    cell.className = "player-cell";
    const strong = document.createElement("strong");
    strong.textContent = name || "Unresolved";
    const small = document.createElement("small");
    small.textContent = [position, team, sleeperId].filter(Boolean).join(" / ") || "No identity data";
    cell.append(strong, small);
    return cell;
  }

  function reviewCounts() {
    const counts = { matched: 0, needsReview: 0, omitted: 0 };
    for (const row of app.reviewRows) {
      if (row.status === "matched") counts.matched += 1;
      else if (row.status === "omitted") counts.omitted += 1;
      else counts.needsReview += 1;
    }
    return counts;
  }

  function rowMatchesView(row) {
    const query = Matcher.normalizeName(elements.reviewSearch.value);
    const statusFilter = elements.reviewFilter.value;
    if (statusFilter === "matched" && row.status !== "matched") return false;
    if (statusFilter === "omitted" && row.status !== "omitted") return false;
    if (statusFilter === "needs_review" && ["matched", "omitted"].includes(row.status)) return false;
    if (!query) return true;
    const resolved = resolvedPlayer(row);
    const haystack = Matcher.normalizeName([
      row.raw_name, row.position, row.team, row.sleeper_id,
      resolved?.player, resolved?.position, resolved?.team, resolved?.sleeper_id,
    ].filter(Boolean).join(" "));
    return haystack.includes(query);
  }

  function renderReview() {
    app.reviewRows = reconcileRows(app.reviewRows);
    const counts = reviewCounts();
    elements.countMatched.textContent = String(counts.matched);
    elements.countNeedsReview.textContent = String(counts.needsReview);
    elements.countOmitted.textContent = String(counts.omitted);
    elements.reviewRows.replaceChildren();
    const visibleRows = app.reviewRows.filter(rowMatchesView);
    for (const row of visibleRows) {
      const tr = document.createElement("tr");
      const rank = document.createElement("td");
      rank.textContent = String(row.rank);
      const imported = createPlayerCell(row.raw_name || "Sleeper ID only", row.position, row.team, row.sleeper_id);
      const resolved = resolvedPlayer(row);
      const resolvedCell = createPlayerCell(resolved?.player, resolved?.position, resolved?.team, resolved?.sleeper_id);
      const statusCell = document.createElement("td");
      const status = document.createElement("span");
      status.className = `match-status ${row.status}`;
      status.textContent = row.status.replaceAll("_", " ");
      statusCell.append(status);
      const actionCell = document.createElement("td");
      const action = document.createElement("button");
      action.type = "button";
      action.className = "row-action";
      action.textContent = row.status === "omitted" ? "Restore" : row.status === "matched" ? "Change" : "Resolve";
      action.addEventListener("click", () => {
        if (row.status === "omitted") {
          app.reviewRows = app.reviewRows.map((candidate) => candidate.input_index === row.input_index
            ? { ...candidate, status: candidate.candidates.length ? "ambiguous" : "unmatched" }
            : candidate);
          renderReview();
        } else {
          openResolver(row.input_index);
        }
      });
      actionCell.append(action);
      tr.append(rank, imported, resolvedCell, statusCell, actionCell);
      elements.reviewRows.append(tr);
    }
    elements.reviewEmpty.hidden = visibleRows.length > 0;
    const saveable = counts.matched > 0 && counts.needsReview === 0;
    elements.saveProfile.disabled = !saveable;
    document.querySelector('[data-next-step="review"]').disabled = app.reviewRows.length === 0;
    if (counts.needsReview) {
      setInline(elements.reviewStatus, `${counts.needsReview} rows need a decision`, "warn");
      setSignal("matches", "warn", `${counts.needsReview} open`);
    } else if (app.reviewRows.length) {
      setInline(elements.reviewStatus, `${counts.matched} players ready to save${counts.omitted ? ` / ${counts.omitted} omitted` : ""}`, "success");
      setSignal("matches", "ready", "Clean");
    } else {
      setInline(elements.reviewStatus, "Load a board to begin");
      setSignal("matches", "", "Open");
    }
  }

  function resolverSearchResults(query) {
    const normalized = Matcher.normalizeName(query);
    const row = app.reviewRows.find((candidate) => candidate.input_index === app.resolverInputIndex);
    return app.catalog
      .map((player) => {
        const identityText = `${player.player} ${player.position} ${player.team} ${player.sleeper_id}`;
        let score = Matcher.similarity(normalized, player.player);
        if (normalized && Matcher.normalizeName(identityText).includes(normalized)) score += 0.3;
        if (row?.position && row.position === player.position) score += 0.08;
        if (row?.team && Matcher.normalizeTeam(row.team) === Matcher.normalizeTeam(player.team)) score += 0.06;
        if (row?.sleeper_id === player.sleeper_id) score += 1;
        return { player, score };
      })
      .filter((result) => !normalized || result.score >= 0.35)
      .sort((left, right) => right.score - left.score || left.player.player.localeCompare(right.player.player))
      .slice(0, 30);
  }

  function renderResolverResults() {
    elements.resolverResults.replaceChildren();
    const results = resolverSearchResults(elements.resolverSearch.value);
    for (const result of results) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "resolver-result";
      const identity = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = result.player.player;
      const meta = document.createElement("small");
      meta.textContent = `${result.player.position} / ${result.player.team || "FA"}`;
      identity.append(name, meta);
      const code = document.createElement("code");
      code.textContent = result.player.sleeper_id;
      button.append(identity, code);
      button.addEventListener("click", () => {
        app.reviewRows = reconcileRows(Matcher.resolveRow(
          app.reviewRows,
          app.resolverInputIndex,
          result.player.sleeper_id,
          app.catalog,
        ));
        elements.resolverDialog.close();
        renderReview();
      });
      elements.resolverResults.append(button);
    }
    if (!results.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No Sleeper players match this search.";
      elements.resolverResults.append(empty);
    }
  }

  function openResolver(inputIndex) {
    app.resolverInputIndex = inputIndex;
    const row = app.reviewRows.find((candidate) => candidate.input_index === inputIndex);
    elements.resolverTitle.textContent = row?.raw_name || row?.sleeper_id || "Resolve player";
    elements.resolverSearch.value = row?.raw_name || row?.sleeper_id || "";
    renderResolverResults();
    elements.resolverDialog.showModal();
    elements.resolverSearch.focus();
  }

  async function saveProfile() {
    const counts = reviewCounts();
    if (!app.reviewRows.length || counts.needsReview) return;
    elements.saveProfile.disabled = true;
    setMessage();
    try {
      const consideredRows = app.reviewRows.filter((row) => row.status !== "omitted");
      const players = Matcher.finalizeMatches(consideredRows, app.catalog);
      const name = elements.profileName.value.trim() || `${new Date().getFullYear()} rankings`;
      const format = elements.profileFormat.value;
      const now = new Date().toISOString();
      const id = `${slug(name)}-${Date.now().toString(36)}`;
      const profile = {
        id,
        name,
        format,
        source: app.source || "manual",
        created_at: now,
        updated_at: now,
        league_settings: {
          teams: null,
          roster_positions: rosterPositions(format),
          scoring: {},
        },
        players,
      };
      await writeState({
        ...app.state,
        ranking_profiles: [...app.state.ranking_profiles, profile],
        settings: { ...app.state.settings, active_ranking_profile_id: id },
      });
      renderProfiles();
      setMessage(`${name} saved with ${players.length} players.`, "success");
      activateStep("ready");
    } catch (error) {
      setMessage(errorMessage(error), "error");
      setInline(elements.reviewStatus, errorMessage(error), "error");
    } finally {
      renderReview();
    }
  }

  async function selectActiveProfile() {
    if (!elements.activeProfile.value) return;
    await writeState({
      ...app.state,
      settings: { ...app.state.settings, active_ranking_profile_id: elements.activeProfile.value },
    });
    renderReadyState();
  }

  async function selectDraft() {
    await writeState({
      ...app.state,
      settings: { ...app.state.settings, last_draft_id: elements.draftSelect.value || null },
    });
    renderReadyState();
  }

  function openSelectedDraft() {
    const draftId = elements.draftSelect.value;
    if (!draftId) return;
    const url = `https://sleeper.com/draft/nfl/${encodeURIComponent(draftId)}`;
    if (globalThis.chrome?.tabs?.create) chrome.tabs.create({ url });
    else window.open(url, "_blank", "noopener");
  }

  function openRankingEditor() {
    location.href = globalThis.chrome?.runtime?.getURL
      ? chrome.runtime.getURL("extension/editor.html")
      : "editor.html";
  }

  function openCommandCenter() {
    const draftId = elements.draftSelect.value;
    if (!draftId) return;
    const url = globalThis.chrome?.runtime?.getURL
      ? chrome.runtime.getURL(`extension/draft.html?draft_id=${encodeURIComponent(draftId)}`)
      : `draft.html?draft_id=${encodeURIComponent(draftId)}`;
    if (globalThis.chrome?.tabs?.create) chrome.tabs.create({ url });
    else window.open(url, "_blank", "noopener");
  }

  function setSource(source) {
    for (const button of document.querySelectorAll("[data-source]")) {
      const active = button.dataset.source === source;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    for (const panel of document.querySelectorAll("[data-source-panel]")) {
      const active = panel.dataset.sourcePanel === source;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    }
  }

  function bindEvents() {
    elements.identityForm.addEventListener("submit", connectIdentity);
    elements.buildPublic.addEventListener("click", buildPublicBoard);
    elements.parsePaste.addEventListener("click", parsePastedList);
    elements.parseFile.addEventListener("click", parseRankingFile);
    elements.file.addEventListener("change", () => {
      const file = elements.file.files?.[0];
      elements.fileLabel.textContent = file?.name || "Choose CSV or JSON";
      elements.parseFile.disabled = !file;
    });
    elements.reviewSearch.addEventListener("input", renderReview);
    elements.reviewFilter.addEventListener("change", renderReview);
    elements.saveProfile.addEventListener("click", saveProfile);
    elements.resolverSearch.addEventListener("input", renderResolverResults);
    elements.omitRow.addEventListener("click", () => {
      app.reviewRows = reconcileRows(app.reviewRows.map((row) => row.input_index === app.resolverInputIndex
        ? { ...row, status: "omitted", selected_sleeper_id: null }
        : row));
      elements.resolverDialog.close();
      renderReview();
    });
    elements.activeProfile.addEventListener("change", selectActiveProfile);
    elements.draftSelect.addEventListener("change", selectDraft);
    elements.openEditor.addEventListener("click", openRankingEditor);
    elements.openCommandCenter.addEventListener("click", openCommandCenter);
    elements.openDraft.addEventListener("click", openSelectedDraft);
    for (const button of document.querySelectorAll(".stage-nav [data-step]")) {
      button.addEventListener("click", () => activateStep(button.dataset.step));
    }
    for (const button of document.querySelectorAll("[data-next-step]")) {
      button.addEventListener("click", () => activateStep(button.dataset.nextStep));
    }
    for (const button of document.querySelectorAll("[data-source]")) {
      button.addEventListener("click", () => setSource(button.dataset.source));
    }
  }

  async function initialize() {
    bindEvents();
    try {
      const migrated = await StateClient.getState();
      app.state = migrated.state;
      if (migrated.warnings.length) setMessage(migrated.warnings[0], "warn");
      const year = new Date().getFullYear();
      elements.profileName.value = `My ${year} rankings`;
      renderIdentity();
      renderProfiles();
      renderDrafts();
      renderReview();
      const requestedStep = location.hash.slice(1);
      activateStep(STEPS.includes(requestedStep) ? requestedStep : "identity");
    } catch (error) {
      setMessage(`Local setup could not load: ${errorMessage(error)}`, "error");
      setSignal("identity", "error", "Storage");
    }
  }

  initialize();
})();
