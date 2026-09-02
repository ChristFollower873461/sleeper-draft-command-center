(function initializeDraftCommandCenter() {
  "use strict";

  const Storage = globalThis.SDCCStorage;
  const StateClient = globalThis.SDCCStateClient;
  const Api = globalThis.SDCCSleeperApi;
  const DraftOrder = globalThis.SDCCDraftOrder;
  const Context = globalThis.SDCCDraftContext;
  const Sessions = globalThis.SDCCDraftSession;
  const Runtime = globalThis.SDCCDraftRuntime;
  const Render = globalThis.SDCCDraftRender;

  const app = {
    state: Storage.createDefaultState(),
    draftId: null,
    context: null,
    rosters: [],
    runtime: null,
    liveCapable: false,
    activeTab: "shortlist",
    boardQuery: "",
    boardPosition: "ALL",
    manualQuery: "",
    lastPickSignature: "",
    pollTimer: null,
    polling: false,
    pollQueued: false,
    metadataRefreshing: false,
    lastMetadataRefresh: 0,
    writeChain: Promise.resolve(),
    writeSequence: 0,
  };

  const elements = {
    syncStatus: document.querySelector("#sync-status"),
    liveMode: document.querySelector("#live-mode"),
    manualMode: document.querySelector("#manual-mode"),
    signalMode: document.querySelector("#signal-mode"),
    signalPick: document.querySelector("#signal-pick"),
    signalTurn: document.querySelector("#signal-turn"),
    signalBuild: document.querySelector("#signal-build"),
    roomSignals: document.querySelector("#room-signals"),
    message: document.querySelector("#runtime-message"),
    content: document.querySelector("#runtime-content"),
    roomKicker: document.querySelector("#room-kicker"),
    roomName: document.querySelector("#room-name"),
    roomMeta: document.querySelector("#room-meta"),
    refresh: document.querySelector("#refresh-room"),
    undo: document.querySelector("#undo-manual"),
    shortlistClock: document.querySelector("#shortlist-clock"),
    recommendationList: document.querySelector("#recommendation-list"),
    pinnedCount: document.querySelector("#pinned-count"),
    pinnedList: document.querySelector("#pinned-list"),
    boardSearch: document.querySelector("#board-search"),
    boardCount: document.querySelector("#board-count"),
    boardRows: document.querySelector("#draft-board-rows"),
    boardEmpty: document.querySelector("#draft-board-empty"),
    runSignal: document.querySelector("#run-signal"),
    aheadTeamCount: document.querySelector("#ahead-team-count"),
    demandList: document.querySelector("#demand-list"),
    tierList: document.querySelector("#tier-list"),
    fallerCount: document.querySelector("#faller-count"),
    fallerList: document.querySelector("#faller-list"),
    recentPicks: document.querySelector("#recent-picks"),
    rosterTotal: document.querySelector("#roster-total"),
    positionCounts: document.querySelector("#position-counts"),
    rosterList: document.querySelector("#roster-list"),
    manualPickState: document.querySelector("#manual-pick-state"),
    manualForm: document.querySelector("#manual-pick-form"),
    manualSearch: document.querySelector("#manual-player-search"),
    recordManual: document.querySelector("#record-manual-pick"),
    manualCandidate: document.querySelector("#manual-candidate"),
    manualHistoryCount: document.querySelector("#manual-history-count"),
    manualHistory: document.querySelector("#manual-history"),
    decisionLabel: document.querySelector("#decision-label"),
    decisionDetail: document.querySelector("#decision-detail"),
    sidebarTotal: document.querySelector("#sidebar-total"),
    sidebarCounts: document.querySelector("#sidebar-counts"),
    sidebarRun: document.querySelector("#sidebar-run"),
    sidebarRecent: document.querySelector("#sidebar-recent"),
    manualSetupDialog: document.querySelector("#manual-setup-dialog"),
    manualSetupForm: document.querySelector("#manual-setup-form"),
    manualProfile: document.querySelector("#manual-profile"),
    manualRoomName: document.querySelector("#manual-room-name"),
    manualFormat: document.querySelector("#manual-format"),
    manualTeams: document.querySelector("#manual-teams"),
    manualRounds: document.querySelector("#manual-rounds"),
    manualSlot: document.querySelector("#manual-slot"),
    manualReversal: document.querySelector("#manual-reversal"),
  };

  async function writeState(nextState) {
    const migrated = Storage.migrateState(nextState);
    const errors = Storage.validateState(migrated.state);
    if (errors.length) throw new Error(`Local state is invalid: ${errors[0]}`);
    Storage.assertStateBudget(migrated.state);
    const base = app.state;
    const snapshot = app.state;
    const nextSnapshot = migrated.state;
    const sequence = ++app.writeSequence;
    app.state = nextSnapshot;
    const operation = app.writeChain.then(() => StateClient.commitState(base, nextSnapshot));
    app.writeChain = operation;
    try {
      const committed = await operation;
      if (sequence === app.writeSequence) app.state = committed.state;
      return committed.warnings;
    } catch (error) {
      if (sequence === app.writeSequence) {
        try {
          app.state = (await StateClient.getState()).state;
        } catch (_reloadError) {
          app.state = snapshot;
        }
        app.writeChain = Promise.resolve();
      }
      throw error;
    }
  }

  function node(tag, className = "", text = "") {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== "") result.textContent = text;
    return result;
  }

  function setSync(message, kind = "") {
    elements.syncStatus.textContent = message;
    elements.syncStatus.title = message;
    elements.syncStatus.className = `sync-status${kind ? ` ${kind}` : ""}`;
  }

  function showMessage(title, copy = "", kind = "", actions = []) {
    stopPolling();
    elements.content.hidden = true;
    elements.message.hidden = false;
    elements.message.className = `runtime-message${kind ? ` ${kind}` : ""}`;
    const code = node("span", "stage-code", "Draft runtime");
    const heading = node("h1", "", title);
    const children = [code, heading];
    if (copy) children.push(node("p", "", copy));
    if (actions.length) {
      const actionRow = node("div", "message-actions");
      for (const action of actions) {
        if (action.href) {
          const link = node("a", action.primary ? "primary-button secondary-link" : "secondary-link", action.label);
          link.href = action.href;
          actionRow.append(link);
        } else {
          const button = node("button", action.primary ? "primary-button" : "secondary-button", action.label);
          button.type = "button";
          button.addEventListener("click", action.onClick);
          actionRow.append(button);
        }
      }
      children.push(actionRow);
    }
    elements.message.replaceChildren(...children);
  }

  function activeProfile(profileId = null) {
    const id = profileId || app.state.settings.active_ranking_profile_id;
    return app.state.ranking_profiles.find((profile) => profile.id === id)
      || app.state.ranking_profiles[0]
      || null;
  }

  function formatLabel(format) {
    return ({ one_qb: "One QB", superflex: "Superflex", best_ball: "Best ball", custom: "Custom" })[format] || "Custom";
  }

  function roomSession() {
    return app.draftId ? app.state.draft_sessions[app.draftId] || null : null;
  }

  function rebuildRuntime() {
    if (!app.draftId || !app.context || !roomSession()) return;
    app.runtime = Runtime.makeRuntimeState(app.state, app.draftId, {
      context: app.context,
      rosters: app.rosters,
    });
    renderRuntime();
  }

  function renderMode() {
    const manual = app.runtime.session.mode === "manual";
    document.body.classList.toggle("manual-mode", manual);
    for (const button of [elements.liveMode, elements.manualMode]) {
      const active = button.dataset.mode === app.runtime.session.mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    elements.liveMode.disabled = !app.liveCapable;
    elements.recordManual.disabled = !manual || app.runtime.state.complete;
  }

  function renderSignals() {
    const { state, session, context } = app.runtime;
    const manual = session.mode === "manual";
    elements.signalMode.textContent = manual ? "MANUAL / LOCAL" : "LIVE / READ ONLY";
    elements.signalPick.textContent = state.complete
      ? "COMPLETE"
      : DraftOrder.formatPick(state.current_pick, state.teams);
    elements.signalTurn.textContent = state.complete
      ? "DONE"
      : state.on_clock
        ? "ON CLOCK"
        : state.decision_pick
          ? `${state.picks_away} AWAY / ${DraftOrder.formatPick(state.decision_pick, state.teams)}`
          : "SLOT PENDING";
    elements.signalBuild.textContent = `${formatLabel(context.format)} / SLOT ${context.user_slot || "-"}`;
    for (const signal of elements.roomSignals.querySelectorAll("[data-room-signal]")) signal.classList.remove("on-clock");
    if (state.on_clock) elements.roomSignals.querySelector('[data-room-signal="turn"]').classList.add("on-clock");
  }

  function renderHeading() {
    const { context, state, profile } = app.runtime;
    elements.roomKicker.textContent = `${app.runtime.session.mode === "manual" ? "Manual" : "Sleeper"} / ${context.status}`;
    elements.roomName.textContent = context.name;
    elements.roomMeta.textContent = `${state.teams} teams / ${state.rounds} rounds / ${context.scoring_label} / ${profile.name}${state.reversal_round ? ` / 3RR at round ${state.reversal_round}` : ""}`;
    const effectiveManual = app.runtime.effective_picks.some((pick) => pick.source === "manual");
    elements.undo.disabled = !effectiveManual;
    elements.refresh.disabled = !app.liveCapable || app.runtime.session.mode !== "live";
  }

  function renderShortlist() {
    const { state } = app.runtime;
    elements.shortlistClock.textContent = state.complete
      ? "Draft complete"
      : state.on_clock
        ? "On clock now"
        : state.decision_pick
          ? `${state.picks_away} picks to decision`
          : "Draft slot pending";
    Render.renderRecommendations(elements.recommendationList, app.runtime);
    Render.renderPinned(elements.pinnedList, app.runtime);
    elements.pinnedCount.textContent = String(app.runtime.pinned.length);
  }

  function boardPlayers() {
    return Runtime.filterAvailable(app.runtime, { query: app.boardQuery, position: app.boardPosition });
  }

  function renderBoard() {
    const players = boardPlayers();
    Render.renderBoard(elements.boardRows, players, app.runtime);
    elements.boardCount.textContent = `${players.length} available`;
    elements.boardEmpty.hidden = players.length > 0;
  }

  function renderRoom() {
    const { state } = app.runtime;
    elements.runSignal.textContent = state.run_signal
      ? `${state.run_signal.position} ${state.run_signal.kind} x${state.run_signal.count}`
      : "No position run";
    elements.aheadTeamCount.textContent = String(state.ahead_slots.length);
    elements.fallerCount.textContent = String(state.fallers.length);
    Render.renderDemand(elements.demandList, state);
    Render.renderTiers(elements.tierList, state);
    Render.renderFallers(elements.fallerList, state);
    Render.renderRecent(elements.recentPicks, app.runtime);
  }

  function renderRoster() {
    elements.rosterTotal.textContent = `${app.runtime.state.selected.length} selected`;
    Render.renderRoster(elements.positionCounts, elements.rosterList, app.runtime);
  }

  function manualCandidate() {
    return Runtime.firstManualCandidate(app.runtime, app.manualQuery, "ALL");
  }

  function renderManual() {
    const { state, session } = app.runtime;
    elements.manualPickState.textContent = state.complete
      ? "Complete"
      : `Next ${DraftOrder.formatPick(state.current_pick, state.teams)}`;
    elements.manualHistoryCount.textContent = String(session.manual_picks.length);
    elements.manualForm.hidden = state.complete;
    elements.manualCandidate.hidden = state.complete;
    if (!state.complete) Render.renderManualCandidate(elements.manualCandidate, manualCandidate());
    Render.renderManualHistory(elements.manualHistory, app.runtime);
  }

  function renderSidebar() {
    const { state } = app.runtime;
    if (state.complete) {
      elements.decisionLabel.textContent = "Draft complete";
      elements.decisionDetail.textContent = `${state.selected.length} players on your roster.`;
    } else if (state.on_clock) {
      elements.decisionLabel.textContent = "You are on the clock";
      elements.decisionDetail.textContent = app.runtime.recommendations[0]
        ? `${app.runtime.recommendations[0].player.player} leads the current decision set.`
        : "No eligible recommendation is available.";
    } else if (state.decision_pick) {
      elements.decisionLabel.textContent = `${state.picks_away} picks away`;
      elements.decisionDetail.textContent = `Next decision at ${DraftOrder.formatPick(state.decision_pick, state.teams)}.`;
    } else {
      elements.decisionLabel.textContent = "Draft slot pending";
      elements.decisionDetail.textContent = "The board remains available while Sleeper assigns the slot.";
    }
    elements.sidebarTotal.textContent = String(state.selected.length);
    Render.renderSidebarCounts(elements.sidebarCounts, state);
    elements.sidebarRun.textContent = state.run_signal ? `${state.run_signal.position} x${state.run_signal.count}` : "Quiet";
    Render.renderSidebarRecent(elements.sidebarRecent, app.runtime);
  }

  function renderRuntime() {
    if (!app.runtime) return;
    elements.message.hidden = true;
    elements.content.hidden = false;
    renderMode();
    renderSignals();
    renderHeading();
    renderShortlist();
    renderBoard();
    renderRoom();
    renderRoster();
    renderManual();
    renderSidebar();
    activateTab(app.activeTab, false);
  }

  function activateTab(tab, persist = true) {
    const allowed = new Set(["shortlist", "board", "room", "roster", "manual"]);
    app.activeTab = allowed.has(tab) ? tab : "shortlist";
    for (const button of document.querySelectorAll("[data-runtime-tab]")) {
      const active = button.dataset.runtimeTab === app.activeTab;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    for (const panel of document.querySelectorAll("[data-runtime-panel]")) {
      const active = panel.dataset.runtimePanel === app.activeTab;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    }
    if (persist && roomSession()) persistActiveTab();
  }

  async function persistActiveTab() {
    try {
      const session = roomSession();
      await writeState({
        ...app.state,
        draft_sessions: {
          ...app.state.draft_sessions,
          [app.draftId]: { ...session, ui: { ...session.ui, active_tab: app.activeTab } },
        },
      });
    } catch (error) {
      setSync(error.message, "error");
    }
  }

  async function loadLiveDraft(draftId, restartPolling = true) {
    stopPolling();
    app.draftId = draftId;
    app.liveCapable = true;
    setSync("Reading Sleeper...", "waiting");
    try {
      const existing = app.state.draft_sessions[draftId] || null;
      const profile = activeProfile(existing?.ranking_profile_id);
      if (!profile) throw new Error("Create a ranking profile before opening a draft");
      const bundle = await Api.fetchDraftBundle(draftId, { timeoutMs: 5000, cacheBust: true });
      const context = Context.normalizeDraftContext({
        draft: bundle.draft,
        league: bundle.league,
        rosters: bundle.rosters,
        traded_picks: bundle.traded_picks,
        user: app.state.user,
        profile,
      });
      if (!context.supported) throw new Error(context.warnings[0]);
      let nextState = Sessions.upsertSession(app.state, {
        draftId,
        leagueId: context.league_id,
        profileId: profile.id,
        mode: existing?.mode || "live",
        context,
      });
      nextState = Sessions.cacheLivePicks(nextState, draftId, bundle.picks);
      await writeState(nextState);
      app.context = context;
      app.rosters = bundle.rosters;
      app.lastMetadataRefresh = Date.now();
      app.lastPickSignature = Runtime.pickSignature(bundle.picks);
      app.activeTab = roomSession().ui.active_tab;
      rebuildRuntime();
      setSync(`Live / ${app.runtime.state.live_pick_count} posted`, "online");
      if (restartPolling && roomSession().mode === "live" && !app.runtime.state.complete) schedulePoll();
    } catch (error) {
      const saved = app.state.draft_sessions[draftId];
      if (saved?.draft_config?.teams && saved?.draft_config?.rounds) {
        app.context = Runtime.contextFromSession(saved);
        app.rosters = [];
        app.activeTab = saved.ui.active_tab;
        app.lastPickSignature = Runtime.pickSignature(saved.cached_live_picks);
        rebuildRuntime();
        setSync("Offline / cached picks", "offline");
      } else {
        showMessage("Draft could not load", error.message || "Sleeper did not return a usable draft.", "error", [
          { label: "Back to setup", href: "setup.html#ready" },
          { label: "Create manual room", primary: true, onClick: openManualSetup },
        ]);
        setSync("Draft unavailable", "error");
      }
    }
  }

  function stopPolling() {
    clearTimeout(app.pollTimer);
    app.pollTimer = null;
  }

  function schedulePoll() {
    stopPolling();
    const delay = Runtime.livePollDelay(
      app.state.settings.poll_interval_ms,
      app.context?.status,
      document.hidden,
    );
    app.pollTimer = setTimeout(refreshLivePicks, delay);
  }

  async function refreshLiveMetadata() {
    if (app.metadataRefreshing || !app.draftId || roomSession()?.mode !== "live") return;
    app.metadataRefreshing = true;
    app.lastMetadataRefresh = Date.now();
    try {
      const profile = activeProfile(roomSession()?.ranking_profile_id);
      const bundle = await Api.fetchDraftMetadataBundle(app.draftId, {
        timeoutMs: 5000,
        cacheBust: true,
      });
      const context = Context.normalizeDraftContext({
        draft: bundle.draft,
        league: bundle.league,
        rosters: bundle.rosters,
        traded_picks: bundle.traded_picks,
        user: app.state.user,
        profile,
      });
      const previous = JSON.stringify({
        status: app.context?.status,
        slot: app.context?.user_slot,
        roster: app.context?.user_roster_id,
        trades: app.context?.traded_picks,
      });
      const next = JSON.stringify({
        status: context.status,
        slot: context.user_slot,
        roster: context.user_roster_id,
        trades: context.traded_picks,
      });
      app.context = context;
      app.rosters = bundle.rosters;
      if (previous !== next) rebuildRuntime();
    } catch (_error) {
      // Posted picks remain authoritative if slower room metadata is unavailable.
    } finally {
      app.metadataRefreshing = false;
    }
  }

  async function refreshLivePicks() {
    if (!app.draftId || roomSession()?.mode !== "live") return;
    if (app.polling) {
      app.pollQueued = true;
      return;
    }
    app.polling = true;
    if (Date.now() - app.lastMetadataRefresh >= 30000) refreshLiveMetadata();
    try {
      const picks = await Api.fetchDraftPicks(app.draftId, { timeoutMs: 2200, cacheBust: true });
      const signature = Runtime.pickSignature(picks);
      if (signature !== app.lastPickSignature) {
        const persisted = writeState(Sessions.cacheLivePicks(app.state, app.draftId, picks));
        app.lastPickSignature = signature;
        rebuildRuntime();
        await persisted;
      }
      setSync(`Live / ${app.runtime.state.live_pick_count} posted`, "online");
    } catch (_error) {
      const cached = roomSession()?.cached_live_picks || [];
      app.lastPickSignature = Runtime.pickSignature(cached);
      rebuildRuntime();
      setSync("Offline / cached picks", "offline");
    } finally {
      app.polling = false;
      if (app.pollQueued) {
        app.pollQueued = false;
        app.pollTimer = setTimeout(refreshLivePicks, 0);
      } else if (roomSession()?.mode === "live" && !app.runtime?.state.complete) {
        schedulePoll();
      }
    }
  }

  async function switchMode(mode) {
    if (!app.runtime || mode === app.runtime.session.mode) return;
    if (mode === "live" && !app.liveCapable) return;
    try {
      await writeState(Sessions.setSessionMode(app.state, app.draftId, mode));
      if (mode === "live") {
        await loadLiveDraft(app.draftId);
      } else {
        stopPolling();
        rebuildRuntime();
        setSync("Manual / local", "waiting");
      }
    } catch (error) {
      setSync(error.message, "error");
    }
  }

  async function recordPlayer(playerId) {
    if (!app.runtime || app.runtime.session.mode !== "manual") return;
    const player = app.runtime.state.available.find((candidate) => candidate.sleeper_id === playerId);
    if (!player) return;
    try {
      const result = Sessions.recordManualPick(app.state, app.draftId, player);
      await writeState(result.state);
      app.manualQuery = "";
      elements.manualSearch.value = "";
      rebuildRuntime();
      setSync(`Saved ${DraftOrder.formatPick(result.pick.pick_no, app.runtime.state.teams)}`, "waiting");
    } catch (error) {
      setSync(error.message, "error");
    }
  }

  async function undoManualPick() {
    if (!app.runtime) return;
    try {
      const result = Sessions.undoEffectiveManualPick(app.state, app.draftId);
      if (!result.removed) {
        setSync("No effective manual pick to undo", "waiting");
        return;
      }
      await writeState(result.state);
      rebuildRuntime();
      setSync(`Removed ${DraftOrder.formatPick(result.removed.pick_no, app.runtime.state.teams)}`, "waiting");
    } catch (error) {
      setSync(error.message, "error");
    }
  }

  async function togglePin(playerId) {
    if (!app.runtime) return;
    try {
      await writeState(Sessions.togglePinnedPlayer(app.state, app.draftId, playerId));
      rebuildRuntime();
      setSync(app.runtime.session.mode === "manual" ? "Manual / local" : `Live / ${app.runtime.state.live_pick_count} posted`, app.runtime.session.mode === "manual" ? "waiting" : "online");
    } catch (error) {
      setSync(error.message, "error");
    }
  }

  function populateManualProfiles() {
    elements.manualProfile.replaceChildren();
    for (const profile of app.state.ranking_profiles.filter((candidate) => candidate.players.length)) {
      elements.manualProfile.append(new Option(`${profile.name} / ${profile.players.length}`, profile.id));
    }
    const selected = activeProfile();
    if (selected) {
      elements.manualProfile.value = selected.id;
      elements.manualFormat.value = selected.format;
      elements.manualRounds.value = String(Math.max(1, selected.league_settings.roster_positions.length || 17));
    }
  }

  function openManualSetup() {
    if (!app.state.ranking_profiles.some((profile) => profile.players.length)) {
      showMessage("A ranking profile is required", "Build or import a board before creating a manual room.", "error", [
        { label: "Open setup", href: "setup.html#board", primary: true },
      ]);
      return;
    }
    populateManualProfiles();
    elements.manualSetupDialog.showModal();
  }

  async function createManualRoom(event) {
    event.preventDefault();
    if (event.submitter?.value !== "create") {
      elements.manualSetupDialog.close();
      if (!app.runtime) showNoDraft();
      return;
    }
    try {
      const profile = activeProfile(elements.manualProfile.value);
      const teams = Number(elements.manualTeams.value);
      const rounds = Number(elements.manualRounds.value);
      const slot = Number(elements.manualSlot.value);
      const reversal = Number(elements.manualReversal.value);
      const format = elements.manualFormat.value;
      if (!profile) throw new Error("Select a ranking profile");
      const context = {
        name: elements.manualRoomName.value.trim() || "Manual draft",
        status: "manual",
        format,
        teams,
        rounds,
        reversal_round: reversal,
        pick_timer: null,
        user_slot: slot,
        user_roster_id: slot,
        roster_positions: Context.defaultRosterPositions(format, rounds),
        scoring: profile.league_settings.scoring || {},
      };
      const draftId = `manual-${Date.now().toString(36)}`;
      await writeState(Sessions.upsertSession(app.state, {
        draftId,
        profileId: profile.id,
        mode: "manual",
        context,
      }));
      app.draftId = draftId;
      app.context = Runtime.contextFromSession(roomSession());
      app.rosters = [];
      app.liveCapable = false;
      app.activeTab = "shortlist";
      history.replaceState(null, "", `draft.html?draft_id=${encodeURIComponent(draftId)}&mode=manual`);
      elements.manualSetupDialog.close();
      rebuildRuntime();
      setSync("Manual / local", "waiting");
    } catch (error) {
      setSync(error.message, "error");
    }
  }

  function showNoDraft() {
    showMessage("Choose a draft room", "Open a selected Sleeper draft or start a local manual room.", "", [
      { label: "Back to setup", href: "setup.html#ready" },
      { label: "Create manual room", primary: true, onClick: openManualSetup },
    ]);
    setSync("No room selected", "waiting");
  }

  function bindEvents() {
    elements.liveMode.addEventListener("click", () => switchMode("live"));
    elements.manualMode.addEventListener("click", () => switchMode("manual"));
    elements.refresh.addEventListener("click", () => loadLiveDraft(app.draftId));
    elements.undo.addEventListener("click", undoManualPick);
    for (const button of document.querySelectorAll("[data-runtime-tab]")) {
      button.addEventListener("click", () => activateTab(button.dataset.runtimeTab));
    }
    elements.boardSearch.addEventListener("input", () => {
      app.boardQuery = elements.boardSearch.value;
      if (app.runtime) renderBoard();
    });
    for (const button of document.querySelectorAll("[data-board-position]")) {
      button.addEventListener("click", () => {
        app.boardPosition = button.dataset.boardPosition;
        for (const candidate of document.querySelectorAll("[data-board-position]")) {
          const active = candidate === button;
          candidate.classList.toggle("active", active);
          candidate.setAttribute("aria-pressed", String(active));
        }
        if (app.runtime) renderBoard();
      });
    }
    elements.manualSearch.addEventListener("input", () => {
      app.manualQuery = elements.manualSearch.value;
      if (app.runtime) Render.renderManualCandidate(elements.manualCandidate, manualCandidate());
    });
    elements.manualForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const player = manualCandidate();
      if (player) recordPlayer(player.sleeper_id);
    });
    document.addEventListener("click", (event) => {
      const action = event.target.closest("[data-player-action]");
      if (!action) return;
      if (action.dataset.playerAction === "pin") togglePin(action.dataset.playerId);
      if (action.dataset.playerAction === "record") recordPlayer(action.dataset.playerId);
    });
    elements.manualProfile.addEventListener("change", () => {
      const profile = activeProfile(elements.manualProfile.value);
      if (profile) elements.manualFormat.value = profile.format;
    });
    elements.manualSetupForm.addEventListener("submit", createManualRoom);
    document.addEventListener("visibilitychange", () => {
      if (roomSession()?.mode !== "live" || app.runtime?.state.complete) return;
      if (document.hidden) schedulePoll();
      else refreshLivePicks();
    });
    window.addEventListener("online", () => refreshLivePicks());
    window.addEventListener("pagehide", stopPolling);
  }

  async function initialize() {
    bindEvents();
    try {
      app.state = (await StateClient.getState()).state;
      if (!app.state.ranking_profiles.some((profile) => profile.players.length)) {
        showMessage("A ranking profile is required", "Build or import a board before opening the command center.", "error", [
          { label: "Open setup", href: "setup.html#board", primary: true },
        ]);
        setSync("Board required", "error");
        return;
      }
      const params = new URLSearchParams(location.search);
      const manualRequested = params.get("mode") === "manual";
      const explicitDraftId = params.get("draft_id");
      const requestedId = explicitDraftId || (manualRequested ? null : app.state.settings.last_draft_id);
      if (!requestedId) {
        showNoDraft();
        if (manualRequested) openManualSetup();
        return;
      }
      app.draftId = requestedId;
      const saved = app.state.draft_sessions[requestedId] || null;
      const localOnly = requestedId.startsWith("manual-");
      if (saved && (localOnly || saved.mode === "manual" || manualRequested)) {
        if (manualRequested && saved.mode !== "manual") {
          await writeState(Sessions.setSessionMode(app.state, requestedId, "manual"));
        }
        app.context = Runtime.contextFromSession(roomSession());
        app.rosters = [];
        app.liveCapable = !localOnly;
        app.activeTab = roomSession().ui.active_tab;
        rebuildRuntime();
        setSync("Manual / local", "waiting");
      } else {
        await loadLiveDraft(requestedId);
      }
    } catch (error) {
      showMessage("Command center could not load", error.message, "error", [
        { label: "Back to setup", href: "setup.html#ready", primary: true },
      ]);
      setSync("Runtime error", "error");
    }
  }

  initialize();
})();
