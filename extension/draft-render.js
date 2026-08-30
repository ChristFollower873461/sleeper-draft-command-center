(function initDraftRenderer(globalScope) {
  "use strict";

  const DraftOrder = globalScope.SDCCDraftOrder;
  const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

  function element(tag, className = "", text = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== "") node.textContent = text;
    return node;
  }

  function positionBadge(position) {
    const badge = element("span", "position-badge", position || "-");
    badge.dataset.position = position || "";
    return badge;
  }

  function empty(container, message) {
    const row = element("p", "empty-state", message);
    container.replaceChildren(row);
  }

  function pinButton(player, pinned) {
    const button = element("button", `pin-button${pinned ? " pinned" : ""}`, pinned ? "\u2605" : "\u2606");
    button.type = "button";
    button.dataset.playerAction = "pin";
    button.dataset.playerId = player.sleeper_id;
    button.title = pinned ? "Unpin player" : "Pin player";
    button.setAttribute("aria-label", `${pinned ? "Unpin" : "Pin"} ${player.player}`);
    button.setAttribute("aria-pressed", String(pinned));
    return button;
  }

  function recordButton(player, compact = false) {
    const button = element("button", `record-button${compact ? " compact-record" : ""}`);
    button.type = "button";
    button.dataset.playerAction = "record";
    button.dataset.playerId = player.sleeper_id;
    button.title = `Record ${player.player} as the next pick`;
    button.setAttribute("aria-label", `Record ${player.player} as the next pick`);
    button.append(element("span", "record-symbol", "+"), element("span", "record-label", "Record"));
    return button;
  }

  function renderRecommendations(container, runtime) {
    if (!runtime.recommendations.length) {
      empty(container, runtime.state.complete ? "This draft is complete." : "No recommendation is available for this build.");
      return;
    }
    const pinned = new Set(runtime.session.pinned_player_ids);
    const fragment = document.createDocumentFragment();
    for (const [index, recommendation] of runtime.recommendations.entries()) {
      const player = recommendation.player;
      const card = element("article", `recommendation-card${index === 0 ? " preferred" : ""}`);
      const role = element("span", "recommendation-role", recommendation.role);
      const identity = element("div", "recommendation-player");
      identity.append(element("strong", "", player.player), positionBadge(player.position));
      const reason = element("p", "recommendation-reason", recommendation.reason);
      const actions = element("div", "recommendation-actions");
      const detail = element("span", "section-state", `#${player.rank} / ADP ${player.adp ?? "-"}`);
      const buttons = element("div", "draft-row-actions");
      buttons.append(pinButton(player, pinned.has(player.sleeper_id)));
      if (runtime.session.mode === "manual") buttons.append(recordButton(player));
      actions.append(detail, buttons);
      card.append(role, identity, reason, actions);
      fragment.append(card);
    }
    container.replaceChildren(fragment);
  }

  function compactPlayerRow(player, runtime) {
    const row = element("div", "compact-player");
    const identity = element("div", "draft-player-name");
    identity.append(element("strong", "", player.player), element("small", "", `${player.team || "FA"} / #${player.rank}`));
    row.append(positionBadge(player.position), identity, pinButton(player, true));
    return row;
  }

  function renderPinned(container, runtime) {
    if (!runtime.pinned.length) {
      empty(container, "No available players are pinned.");
      return;
    }
    container.replaceChildren(...runtime.pinned.map((player) => compactPlayerRow(player, runtime)));
  }

  function renderBoard(container, players, runtime) {
    const pinned = new Set(runtime.session.pinned_player_ids);
    const fragment = document.createDocumentFragment();
    for (const player of players) {
      const row = element("div", "draft-board-row");
      row.dataset.playerId = player.sleeper_id;
      row.setAttribute("role", "row");
      const rank = element("span", "draft-rank", String(player.rank));
      const identity = element("div", "draft-player-name");
      identity.append(element("strong", "", player.player), element("small", "", `${player.team || "FA"}${player.notes ? ` / ${player.notes}` : ""}`));
      const actions = element("div", "draft-row-actions");
      actions.append(pinButton(player, pinned.has(player.sleeper_id)));
      if (runtime.session.mode === "manual") actions.append(recordButton(player, true));
      row.append(
        rank,
        identity,
        positionBadge(player.position),
        element("span", "draft-number", player.adp == null ? "-" : String(player.adp)),
        element("span", "draft-number", player.tier == null ? "-" : String(player.tier)),
        actions,
      );
      fragment.append(row);
    }
    container.replaceChildren(fragment);
  }

  function signalRow(label, detail, value) {
    const row = element("div", "signal-row");
    const copy = element("div");
    copy.append(element("strong", "", label), element("small", "", detail));
    row.append(copy, element("span", "signal-value", value));
    return row;
  }

  function renderDemand(container, state) {
    const rows = POSITIONS
      .map((position) => ({ position, count: state.ahead_demand[position] || 0 }))
      .filter((row) => row.count > 0)
      .sort((left, right) => right.count - left.count);
    if (!rows.length) return empty(container, "No clear position demand ahead.");
    container.replaceChildren(...rows.map((row) => signalRow(
      row.position,
      `${state.ahead_slots.length} unique teams before your turn`,
      String(row.count),
    )));
  }

  function renderTiers(container, state) {
    const rows = [...state.tier_signals].sort((left, right) => right.urgency - left.urgency).slice(0, 6);
    if (!rows.length) return empty(container, "No tier signals are available.");
    container.replaceChildren(...rows.map((row) => signalRow(
      `${row.position} tier ${row.tier}`,
      row.next ? `Next gap ${row.rank_gap ?? 0}` : "Last ranked tier",
      `${row.remaining} left`,
    )));
  }

  function renderFallers(container, state) {
    const rows = state.fallers.slice(0, 8);
    if (!rows.length) return empty(container, "No player is four picks past ADP.");
    container.replaceChildren(...rows.map((row) => signalRow(
      row.player.player,
      `${row.player.position} / ADP ${row.player.adp ?? "-"}`,
      `+${row.fall}`,
    )));
  }

  function recentPickRow(pick, teams) {
    const row = element("div", "recent-pick");
    row.append(
      element("code", "", DraftOrder.formatPick(pick.pick_no, teams)),
      element("strong", "", pick.player),
      positionBadge(pick.position),
      element("span", `source-label ${pick.source === "manual" ? "manual" : ""}`, pick.source || "live"),
    );
    return row;
  }

  function renderRecent(container, runtime, limit = 10) {
    const picks = runtime.state.recent_picks.slice(0, limit);
    if (!picks.length) return empty(container, "No picks have been recorded.");
    container.replaceChildren(...picks.map((pick) => recentPickRow(pick, runtime.state.teams)));
  }

  function renderRoster(countContainer, listContainer, runtime) {
    countContainer.replaceChildren(...POSITIONS.map((position) => {
      const cell = element("div", "position-count");
      cell.append(element("span", "", position), element("strong", "", `${runtime.state.counts[position] || 0}/${runtime.state.targets[position] || 0}`));
      return cell;
    }));
    if (!runtime.state.selected.length) return empty(listContainer, "No players are assigned to your roster yet.");
    listContainer.replaceChildren(...runtime.state.selected.map((player) => {
      const row = element("div", "roster-player");
      row.append(
        element("code", "", DraftOrder.formatPick(player.pick_no, runtime.state.teams)),
        positionBadge(player.position),
        element("strong", "", player.player),
        element("span", "draft-number", player.team || "FA"),
      );
      return row;
    }));
  }

  function renderManualCandidate(container, player) {
    if (!player) return empty(container, "No available player matches the current search.");
    const row = element("div", "compact-player");
    const identity = element("div", "draft-player-name");
    identity.append(element("strong", "", player.player), element("small", "", `${player.team || "FA"} / rank ${player.rank} / ADP ${player.adp ?? "-"}`));
    row.append(positionBadge(player.position), identity, recordButton(player));
    container.replaceChildren(row);
  }

  function manualPickName(pick) {
    return [pick.metadata?.first_name, pick.metadata?.last_name].filter(Boolean).join(" ") || pick.player_id;
  }

  function renderManualHistory(container, runtime) {
    const liveNumbers = new Set(runtime.session.cached_live_picks.map((pick) => pick.pick_no));
    const picks = [...runtime.session.manual_picks].sort((left, right) => right.pick_no - left.pick_no);
    if (!picks.length) return empty(container, "No manual picks have been recorded.");
    container.replaceChildren(...picks.map((pick) => {
      const row = element("div", "recent-pick");
      const overridden = liveNumbers.has(pick.pick_no);
      row.append(
        element("code", "", DraftOrder.formatPick(pick.pick_no, runtime.state.teams)),
        element("strong", "", manualPickName(pick)),
        positionBadge(pick.metadata?.position || ""),
        element("span", `source-label ${overridden ? "" : "manual"}`, overridden ? "posted" : "manual"),
      );
      return row;
    }));
  }

  function renderSidebarCounts(container, state) {
    container.replaceChildren(...POSITIONS.map((position) => {
      const cell = element("div", "sidebar-count");
      cell.append(element("span", "", position), element("strong", "", `${state.counts[position] || 0}/${state.targets[position] || 0}`));
      return cell;
    }));
  }

  function renderSidebarRecent(container, runtime) {
    const picks = runtime.state.recent_picks.slice(0, 4);
    if (!picks.length) return empty(container, "Room is empty.");
    container.replaceChildren(...picks.map((pick) => {
      const row = element("div");
      row.append(element("strong", "", pick.player), element("small", "", `${DraftOrder.formatPick(pick.pick_no, runtime.state.teams)} / ${pick.position || "-"}`));
      return row;
    }));
  }

  const api = {
    empty,
    renderBoard,
    renderDemand,
    renderFallers,
    renderManualCandidate,
    renderManualHistory,
    renderPinned,
    renderRecent,
    renderRecommendations,
    renderRoster,
    renderSidebarCounts,
    renderSidebarRecent,
    renderTiers,
  };

  globalScope.SDCCDraftRender = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
