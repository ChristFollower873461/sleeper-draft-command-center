(function initializeRankingWorkspace() {
  "use strict";

  const Storage = globalThis.SDCCStorage;
  const StateClient = globalThis.SDCCStateClient;
  const Editor = globalThis.SDCCRankingEditor;
  const Profiles = globalThis.SDCCProfileManager;
  const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

  const app = {
    state: Storage.createDefaultState(),
    editor: null,
    query: "",
    position: "ALL",
    draggedId: null,
    pointerDrag: null,
    detailPlayerId: null,
    profileDialogMode: null,
    dirty: false,
    saveTimer: null,
    saveChain: Promise.resolve(),
  };

  const elements = {
    saveState: document.querySelector("#save-state"),
    profileSelect: document.querySelector("#profile-select"),
    profileCount: document.querySelector("#profile-count"),
    profileFormat: document.querySelector("#profile-format"),
    profileUpdated: document.querySelector("#profile-updated"),
    undo: document.querySelector("#undo-ranking"),
    redo: document.querySelector("#redo-ranking"),
    newProfile: document.querySelector("#new-profile"),
    cloneProfile: document.querySelector("#clone-profile"),
    renameProfile: document.querySelector("#rename-profile"),
    deleteProfile: document.querySelector("#delete-profile"),
    importProfile: document.querySelector("#import-profile"),
    exportProfile: document.querySelector("#export-profile"),
    importFile: document.querySelector("#import-file"),
    toolbar: document.querySelector(".ranking-toolbar"),
    search: document.querySelector("#player-search"),
    visibleCount: document.querySelector("#visible-count"),
    boardShell: document.querySelector("#board-shell"),
    rows: document.querySelector("#ranking-rows"),
    empty: document.querySelector("#ranking-empty"),
    noProfile: document.querySelector("#no-profile"),
    profileDialog: document.querySelector("#profile-dialog"),
    profileForm: document.querySelector("#profile-form"),
    profileDialogCode: document.querySelector("#profile-dialog-code"),
    profileDialogTitle: document.querySelector("#profile-dialog-title"),
    profileDialogSubmit: document.querySelector("#profile-dialog-submit"),
    profileNameField: document.querySelector("#profile-name-field"),
    profileFormatLabel: document.querySelector("#profile-format-label"),
    profileFormatField: document.querySelector("#profile-format-field"),
    deleteDialog: document.querySelector("#delete-dialog"),
    deleteForm: document.querySelector("#delete-form"),
    deleteProfileName: document.querySelector("#delete-profile-name"),
    playerDialog: document.querySelector("#player-dialog"),
    playerForm: document.querySelector("#player-form"),
    playerDialogName: document.querySelector("#player-dialog-name"),
    playerDialogTeam: document.querySelector("#player-dialog-team"),
    playerRank: document.querySelector("#player-rank-field"),
    playerAdp: document.querySelector("#player-adp-field"),
    playerTier: document.querySelector("#player-tier-field"),
    playerNotes: document.querySelector("#player-notes-field"),
  };

  function setSaveState(message, kind = "") {
    elements.saveState.textContent = message;
    elements.saveState.className = `save-state${kind ? ` ${kind}` : ""}`;
  }

  function activeProfile() {
    const activeId = app.state.settings.active_ranking_profile_id;
    return app.state.ranking_profiles.find((profile) => profile.id === activeId)
      || app.state.ranking_profiles[0]
      || null;
  }

  function formatLabel(format) {
    return ({ one_qb: "One QB", superflex: "Superflex", best_ball: "Best ball", custom: "Custom" })[format] || "Custom";
  }

  function formatTimestamp(value) {
    const date = new Date(value || "");
    if (!Number.isFinite(date.getTime())) return "Not saved";
    return `Saved ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }

  function slug(value) {
    return String(value || "ranking-profile")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 52) || "ranking-profile";
  }

  async function writeState(nextState) {
    const committed = await StateClient.commitState(app.state, nextState);
    app.state = committed.state;
  }

  function loadEditor(profile = activeProfile()) {
    app.editor = profile ? Editor.createEditorState(profile) : null;
    app.dirty = false;
    app.query = "";
    app.position = "ALL";
    elements.search.value = "";
    for (const button of document.querySelectorAll("[data-position]")) {
      const active = button.dataset.position === "ALL";
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  function createElement(tag, className = "", text = "") {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== "") element.textContent = text;
    return element;
  }

  function inputCell(className, type, value, label) {
    const input = createElement("input", `row-input ${className}`);
    input.type = type;
    input.value = value == null ? "" : String(value);
    input.setAttribute("aria-label", label);
    if (type === "number") input.min = className.includes("tier") ? "1" : "0";
    return input;
  }

  function makeRankingRow(player) {
    const row = createElement("div", "ranking-row");
    row.dataset.playerId = player.sleeper_id;
    row.setAttribute("role", "row");

    const dragCell = createElement("div", "drag-cell");
    const handle = createElement("button", "drag-handle");
    handle.type = "button";
    handle.title = "Move player";
    handle.setAttribute("aria-label", `Move ${player.player}`);
    dragCell.append(handle);

    const rank = inputCell("rank-input", "number", player.rank, `Rank for ${player.player}`);
    rank.max = String(app.editor.players.length);

    const identity = createElement("div", "player-identity");
    identity.append(
      createElement("strong", "", player.player),
      createElement("small", "", `${player.team || "FA"} / ${player.sleeper_id}`),
    );

    const positionCell = createElement("div", "position-cell");
    const position = createElement("span", "position-code", player.position);
    position.dataset.position = player.position;
    positionCell.append(position);

    const adpCell = createElement("div", "cell-adp");
    const adp = inputCell("adp-input", "number", player.adp, `ADP for ${player.player}`);
    adp.step = "0.1";
    adpCell.append(adp);

    const tierCell = createElement("div", "cell-tier");
    const tier = inputCell("tier-input", "number", player.tier, `Tier for ${player.player}`);
    tier.step = "1";
    tierCell.append(tier);

    const notesCell = createElement("div", "cell-notes");
    const notes = inputCell("notes-input", "text", player.notes, `Notes for ${player.player}`);
    notes.maxLength = 300;
    notesCell.append(notes);

    const moreCell = createElement("div", "mobile-only");
    const more = createElement("button", "more-button", "...");
    more.type = "button";
    more.dataset.action = "player-details";
    more.title = "Edit player details";
    more.setAttribute("aria-label", `Edit details for ${player.player}`);
    moreCell.append(more);

    row.append(dragCell, rank, identity, positionCell, adpCell, tierCell, notesCell, moreCell);
    return row;
  }

  function renderProfileControls() {
    const profile = activeProfile();
    const activeId = profile?.id || "";
    elements.profileSelect.replaceChildren();
    if (!app.state.ranking_profiles.length) {
      elements.profileSelect.append(new Option("No ranking profiles", ""));
      elements.profileSelect.disabled = true;
    } else {
      elements.profileSelect.disabled = false;
      for (const candidate of app.state.ranking_profiles) {
        elements.profileSelect.append(new Option(`${candidate.name} | ${candidate.players.length}`, candidate.id));
      }
      elements.profileSelect.value = activeId;
    }

    elements.profileCount.textContent = String(app.editor?.players.length || 0);
    elements.profileFormat.textContent = profile ? formatLabel(profile.format) : "No format";
    elements.profileUpdated.textContent = profile ? formatTimestamp(profile.updated_at) : "Not saved";
    elements.undo.disabled = !app.editor?.undo_stack.length;
    elements.redo.disabled = !app.editor?.redo_stack.length;
    for (const control of [elements.cloneProfile, elements.renameProfile, elements.deleteProfile]) {
      control.disabled = !profile;
    }
    elements.exportProfile.disabled = !profile || !app.editor?.players.length;
  }

  function renderBoard(focus = null) {
    renderProfileControls();
    const hasProfile = Boolean(app.editor);
    elements.toolbar.hidden = !hasProfile;
    elements.boardShell.hidden = !hasProfile;
    elements.noProfile.hidden = hasProfile;
    if (!hasProfile) return;

    const players = Editor.filteredPlayers(app.editor, { query: app.query, position: app.position });
    const fragment = document.createDocumentFragment();
    for (const player of players) fragment.append(makeRankingRow(player));
    elements.rows.replaceChildren(fragment);
    elements.visibleCount.textContent = `${players.length} shown`;
    elements.empty.hidden = players.length > 0;

    if (focus?.playerId) {
      const escapedId = globalThis.CSS?.escape ? CSS.escape(focus.playerId) : focus.playerId.replace(/[^A-Za-z0-9_-]/g, "");
      const row = elements.rows.querySelector(`[data-player-id="${escapedId}"]`);
      row?.querySelector(focus.selector || ".drag-handle")?.focus();
    }
  }

  function scheduleSave(message = "Unsaved changes") {
    app.dirty = true;
    clearTimeout(app.saveTimer);
    setSaveState(message, "saving");
    app.saveTimer = setTimeout(() => persistEditor(), 500);
  }

  function persistEditor() {
    clearTimeout(app.saveTimer);
    app.saveTimer = null;
    if (!app.editor || !app.dirty) return app.saveChain;
    app.saveChain = app.saveChain.then(async () => {
      if (!app.editor || !app.dirty) return;
      const snapshot = app.editor;
      const revision = snapshot.revision;
      setSaveState("Saving locally...", "saving");
      const nextState = Profiles.updateProfilePlayers(app.state, snapshot.profile_id, snapshot.players);
      await writeState(nextState);
      if (app.editor?.profile_id === snapshot.profile_id && app.editor.revision === revision) {
        app.dirty = false;
        setSaveState("Saved in this browser", "saved");
        renderProfileControls();
      } else {
        scheduleSave();
      }
    }).catch((error) => {
      app.dirty = true;
      setSaveState(error.message || "Local save failed", "error");
    });
    return app.saveChain;
  }

  async function flushSave() {
    clearTimeout(app.saveTimer);
    app.saveTimer = null;
    if (app.dirty) await persistEditor();
    await app.saveChain;
    if (app.dirty) throw new Error("Finish saving the ranking board before changing profiles");
  }

  function applyEditor(nextEditor, focus = null) {
    if (!nextEditor || nextEditor === app.editor) return;
    app.editor = nextEditor;
    renderBoard(focus);
    scheduleSave(nextEditor.last_action === "undo" || nextEditor.last_action === "redo"
      ? `${nextEditor.last_action[0].toUpperCase()}${nextEditor.last_action.slice(1)} applied`
      : "Unsaved changes");
  }

  async function changeProfile(profileId) {
    if (!profileId || profileId === app.editor?.profile_id) return;
    try {
      await flushSave();
      const nextState = Profiles.setActiveProfile(app.state, profileId);
      await writeState(nextState);
      loadEditor(activeProfile());
      renderBoard();
      setSaveState("Profile loaded", "saved");
    } catch (error) {
      setSaveState(error.message, "error");
      renderProfileControls();
    }
  }

  function setPosition(position) {
    app.position = position;
    for (const button of document.querySelectorAll("[data-position]")) {
      const active = button.dataset.position === position;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    renderBoard();
  }

  function openProfileDialog(mode) {
    const profile = activeProfile();
    app.profileDialogMode = mode;
    const rename = mode === "rename";
    elements.profileDialogCode.textContent = rename ? "Rename profile" : "New profile";
    elements.profileDialogTitle.textContent = rename ? "Rename ranking profile" : "Create ranking profile";
    elements.profileDialogSubmit.textContent = rename ? "Rename" : "Create";
    elements.profileFormatLabel.hidden = rename;
    elements.profileNameField.value = rename ? profile?.name || "" : "My rankings";
    elements.profileFormatField.value = profile?.format || "one_qb";
    elements.profileDialog.showModal();
    elements.profileNameField.focus();
    elements.profileNameField.select();
  }

  async function submitProfileDialog(event) {
    event.preventDefault();
    if (event.submitter?.value !== "save") {
      elements.profileDialog.close();
      return;
    }
    try {
      await flushSave();
      if (app.profileDialogMode === "rename") {
        await writeState(Profiles.renameProfile(app.state, activeProfile().id, elements.profileNameField.value));
      } else {
        await writeState(Profiles.addProfile(app.state, {
          name: elements.profileNameField.value,
          format: elements.profileFormatField.value,
          source: "manual",
          players: [],
        }));
      }
      loadEditor(activeProfile());
      renderBoard();
      elements.profileDialog.close();
      setSaveState(app.profileDialogMode === "rename" ? "Profile renamed" : "Profile created", "saved");
    } catch (error) {
      setSaveState(error.message, "error");
    }
  }

  async function cloneActiveProfile() {
    try {
      await flushSave();
      await writeState(Profiles.cloneProfile(app.state, activeProfile().id));
      loadEditor(activeProfile());
      renderBoard();
      setSaveState("Profile cloned", "saved");
    } catch (error) {
      setSaveState(error.message, "error");
    }
  }

  function openDeleteDialog() {
    const profile = activeProfile();
    if (!profile) return;
    elements.deleteProfileName.textContent = profile.name;
    elements.deleteDialog.showModal();
  }

  async function submitDeleteDialog(event) {
    event.preventDefault();
    if (event.submitter?.value !== "delete") {
      elements.deleteDialog.close();
      return;
    }
    try {
      await flushSave();
      await writeState(Profiles.deleteProfile(app.state, activeProfile().id));
      loadEditor(activeProfile());
      renderBoard();
      elements.deleteDialog.close();
      setSaveState("Profile deleted", "saved");
    } catch (error) {
      setSaveState(error.message, "error");
    }
  }

  async function importProfileFile() {
    const file = elements.importFile.files?.[0];
    if (!file) return;
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error("Ranking pack exceeds the 2 MiB limit");
      const pack = JSON.parse(await file.text());
      await flushSave();
      await writeState(Profiles.importRankingPack(app.state, pack));
      loadEditor(activeProfile());
      renderBoard();
      setSaveState(`Imported ${app.editor.players.length} players`, "saved");
    } catch (error) {
      setSaveState(error instanceof SyntaxError ? "Ranking pack is not valid JSON" : error.message, "error");
    } finally {
      elements.importFile.value = "";
    }
  }

  async function exportActiveProfile() {
    try {
      await flushSave();
      const profile = activeProfile();
      const pack = Profiles.exportRankingPack(app.state, profile.id);
      const blob = new Blob([`${JSON.stringify(pack, null, 2)}\n`], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${slug(profile.name)}.ranking-pack.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSaveState("Public ranking pack exported", "saved");
    } catch (error) {
      setSaveState(error.message, "error");
    }
  }

  function openPlayerDialog(playerId) {
    const player = app.editor?.players.find((candidate) => candidate.sleeper_id === playerId);
    if (!player) return;
    app.detailPlayerId = playerId;
    elements.playerDialogName.textContent = player.player;
    elements.playerDialogTeam.textContent = `${player.position} / ${player.team || "FA"}`;
    elements.playerRank.value = String(player.rank);
    elements.playerRank.max = String(app.editor.players.length);
    elements.playerAdp.value = player.adp == null ? "" : String(player.adp);
    elements.playerTier.value = player.tier == null ? "" : String(player.tier);
    elements.playerNotes.value = player.notes || "";
    elements.playerDialog.showModal();
  }

  function submitPlayerDialog(event) {
    event.preventDefault();
    if (event.submitter?.value !== "save") {
      elements.playerDialog.close();
      return;
    }
    let next = Editor.movePlayer(app.editor, app.detailPlayerId, elements.playerRank.value);
    next = Editor.updatePlayerFields(next, app.detailPlayerId, {
      adp: elements.playerAdp.value,
      tier: elements.playerTier.value,
      notes: elements.playerNotes.value,
    });
    elements.playerDialog.close();
    applyEditor(next);
  }

  function handleRowChange(event) {
    const row = event.target.closest(".ranking-row");
    if (!row || !app.editor) return;
    const id = row.dataset.playerId;
    if (event.target.matches(".rank-input")) {
      applyEditor(Editor.movePlayer(app.editor, id, event.target.value), { playerId: id, selector: ".rank-input" });
    } else if (event.target.matches(".adp-input")) {
      applyEditor(Editor.updatePlayerFields(app.editor, id, { adp: event.target.value }));
    } else if (event.target.matches(".tier-input")) {
      applyEditor(Editor.updatePlayerFields(app.editor, id, { tier: event.target.value }));
    } else if (event.target.matches(".notes-input")) {
      applyEditor(Editor.updatePlayerFields(app.editor, id, { notes: event.target.value }));
    }
  }

  function handleRowKeydown(event) {
    const handle = event.target.closest(".drag-handle");
    if (!handle || !event.altKey || !app.editor) return;
    const row = handle.closest(".ranking-row");
    const id = row.dataset.playerId;
    let next = app.editor;
    if (event.key === "ArrowUp") next = Editor.moveBy(app.editor, id, -1);
    else if (event.key === "ArrowDown") next = Editor.moveBy(app.editor, id, 1);
    else if (event.key === "PageUp") next = Editor.moveBy(app.editor, id, -10);
    else if (event.key === "PageDown") next = Editor.moveBy(app.editor, id, 10);
    else if (event.key === "Home") next = Editor.movePlayer(app.editor, id, 1);
    else if (event.key === "End") next = Editor.movePlayer(app.editor, id, app.editor.players.length);
    else return;
    event.preventDefault();
    applyEditor(next, { playerId: id, selector: ".drag-handle" });
  }

  function clearDropTargets() {
    for (const row of elements.rows.querySelectorAll(".ranking-row")) row.classList.remove("drop-target", "dragging");
  }

  function bindEvents() {
    elements.profileSelect.addEventListener("change", () => changeProfile(elements.profileSelect.value));
    elements.search.addEventListener("input", () => {
      app.query = elements.search.value;
      renderBoard();
    });
    for (const button of document.querySelectorAll("[data-position]")) {
      button.addEventListener("click", () => setPosition(button.dataset.position));
    }
    elements.undo.addEventListener("click", () => applyEditor(Editor.undo(app.editor)));
    elements.redo.addEventListener("click", () => applyEditor(Editor.redo(app.editor)));
    elements.newProfile.addEventListener("click", () => openProfileDialog("new"));
    document.querySelector('[data-empty-action="new"]').addEventListener("click", () => openProfileDialog("new"));
    elements.cloneProfile.addEventListener("click", cloneActiveProfile);
    elements.renameProfile.addEventListener("click", () => openProfileDialog("rename"));
    elements.deleteProfile.addEventListener("click", openDeleteDialog);
    elements.importProfile.addEventListener("click", () => elements.importFile.click());
    elements.importFile.addEventListener("change", importProfileFile);
    elements.exportProfile.addEventListener("click", exportActiveProfile);
    elements.profileForm.addEventListener("submit", submitProfileDialog);
    elements.deleteForm.addEventListener("submit", submitDeleteDialog);
    elements.playerForm.addEventListener("submit", submitPlayerDialog);
    elements.rows.addEventListener("change", handleRowChange);
    elements.rows.addEventListener("keydown", handleRowKeydown);
    elements.rows.addEventListener("click", (event) => {
      const button = event.target.closest('[data-action="player-details"]');
      if (button) openPlayerDialog(button.closest(".ranking-row").dataset.playerId);
    });
    elements.rows.addEventListener("pointerdown", (event) => {
      const handle = event.target.closest(".drag-handle");
      if (!handle || event.button !== 0) return;
      const row = handle.closest(".ranking-row");
      app.pointerDrag = {
        pointerId: event.pointerId,
        playerId: row.dataset.playerId,
        startX: event.clientX,
        startY: event.clientY,
      };
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    elements.rows.addEventListener("pointermove", (event) => {
      if (!app.pointerDrag || app.pointerDrag.pointerId !== event.pointerId) return;
      const distance = Math.hypot(event.clientX - app.pointerDrag.startX, event.clientY - app.pointerDrag.startY);
      if (distance < 5 && !app.draggedId) return;
      app.draggedId = app.pointerDrag.playerId;
      const source = elements.rows.querySelector(`[data-player-id="${app.draggedId}"]`);
      const row = document.elementFromPoint(event.clientX, event.clientY)?.closest(".ranking-row");
      event.preventDefault();
      clearDropTargets();
      source?.classList.add("dragging");
      if (row && row.dataset.playerId !== app.draggedId) row.classList.add("drop-target");
    });
    elements.rows.addEventListener("pointerup", (event) => {
      if (!app.pointerDrag || app.pointerDrag.pointerId !== event.pointerId) return;
      const draggedId = app.draggedId;
      const row = document.elementFromPoint(event.clientX, event.clientY)?.closest(".ranking-row");
      app.pointerDrag = null;
      app.draggedId = null;
      event.preventDefault();
      clearDropTargets();
      if (draggedId && row && row.dataset.playerId !== draggedId) {
        applyEditor(Editor.moveBefore(app.editor, draggedId, row.dataset.playerId), { playerId: draggedId });
      }
    });
    elements.rows.addEventListener("pointercancel", () => {
      app.pointerDrag = null;
      app.draggedId = null;
      clearDropTargets();
    });
    window.addEventListener("beforeunload", () => {
      if (app.dirty) persistEditor();
    });
  }

  async function initialize() {
    bindEvents();
    try {
      const migrated = await StateClient.getState();
      app.state = migrated.state;
      if (app.state.ranking_profiles.length && !app.state.settings.active_ranking_profile_id) {
        await writeState(Profiles.setActiveProfile(app.state, app.state.ranking_profiles[0].id));
      }
      loadEditor(activeProfile());
      renderBoard();
      setSaveState(migrated.warnings.length ? migrated.warnings[0] : "Saved in this browser", migrated.warnings.length ? "error" : "saved");
    } catch (error) {
      setSaveState(`Ranking workspace could not load: ${error.message}`, "error");
      renderBoard();
    }
  }

  initialize();
})();
