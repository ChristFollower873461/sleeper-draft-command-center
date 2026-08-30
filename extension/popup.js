(function initializePopup() {
  "use strict";

  const Storage = globalThis.SDCCStorage;
  const profileName = document.querySelector("#profile-name");
  const profileDetail = document.querySelector("#profile-detail");
  const readinessCode = document.querySelector("#readiness-code");
  const openWorkspace = document.querySelector("#open-workspace");
  const openDraftCenter = document.querySelector("#open-draft-center");
  let workspaceTarget = "setup";
  let lastDraftId = null;

  function getLocal(key) {
    return new Promise((resolve) => chrome.storage.local.get([key], (values) => resolve(values[key])));
  }

  async function render() {
    try {
      const raw = await getLocal(Storage.STORAGE_KEY);
      const { state } = Storage.migrateState(raw);
      const activeId = state.settings.active_ranking_profile_id;
      const profile = state.ranking_profiles.find((candidate) => candidate.id === activeId) || null;
      document.querySelector('[data-signal="identity"]').classList.toggle("ready", Boolean(state.user.user_id));
      document.querySelector('[data-signal="board"]').classList.toggle("ready", Boolean(profile?.players.length));
      document.querySelector('[data-signal="draft"]').classList.toggle("ready", Boolean(state.settings.last_draft_id));
      if (profile) {
        workspaceTarget = "editor";
        profileName.textContent = profile.name;
        profileDetail.textContent = `${profile.players.length} players | ${profile.format.replaceAll("_", " ")}`;
        openWorkspace.textContent = "Edit ranking board";
      }
      const readyCount = [state.user.user_id, profile?.players.length, state.settings.last_draft_id].filter(Boolean).length;
      readinessCode.textContent = `${readyCount}/3 READY`;
      lastDraftId = state.settings.last_draft_id;
      openDraftCenter.hidden = !profile || !lastDraftId;
    } catch (_error) {
      readinessCode.textContent = "CHECK SETUP";
      profileDetail.textContent = "Local state needs attention.";
    }
  }

  openWorkspace.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "SDCC_OPEN_WORKSPACE", target: workspaceTarget });
    window.close();
  });

  openDraftCenter.addEventListener("click", () => {
    if (!lastDraftId) return;
    chrome.runtime.sendMessage({ type: "SDCC_OPEN_DRAFT_CENTER", draftId: lastDraftId });
    window.close();
  });

  render();
})();
