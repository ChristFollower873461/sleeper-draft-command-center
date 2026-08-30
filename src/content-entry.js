(function initializeDraftPageBridge() {
  "use strict";

  const LAUNCHER_ID = "sdcc-draft-launcher";
  let lastPath = "";

  function draftIdFromPath(pathname) {
    const match = String(pathname || "").match(/^\/draft\/(?:nfl\/)?([A-Za-z0-9._-]+)/);
    return match?.[1] || null;
  }

  function mountLauncher() {
    if (lastPath === window.location.pathname) return;
    lastPath = window.location.pathname;
    document.getElementById(LAUNCHER_ID)?.remove();
    const draftId = draftIdFromPath(lastPath);
    if (!draftId || !document.body) return;
    const button = document.createElement("button");
    button.id = LAUNCHER_ID;
    button.type = "button";
    button.textContent = "Open Command Center";
    button.setAttribute("aria-label", "Open Sleeper Draft Command Center for this draft");
    button.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      if (navigator.userActivation && !navigator.userActivation.isActive) return;
      chrome.runtime.sendMessage({ type: "SDCC_OPEN_DRAFT_CENTER", draftId });
    });
    document.body.append(button);
  }

  mountLauncher();
  window.addEventListener("popstate", mountLauncher);
  const observer = new MutationObserver(mountLauncher);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "SDCC_PAGE_STATUS") {
      sendResponse({
        ready: true,
        path: window.location.pathname,
      });
    }
  });
})();
