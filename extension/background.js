"use strict";

importScripts("../src/storage.js", "../src/state-merge.js");

const Storage = globalThis.SDCCStorage;
const StateMerge = globalThis.SDCCStateMerge;
const EXTENSION_PAGES = new Set([
  "/extension/setup.html",
  "/extension/editor.html",
  "/extension/draft.html",
  "/extension/popup.html",
]);
const launchTimes = new Map();
let commitQueue = Promise.resolve();

function storageGet(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([key], (values) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(values[key]);
    });
  });
}

function storageSet(key, value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function parsedSenderUrl(sender) {
  try {
    return new URL(sender?.url || sender?.tab?.url || "");
  } catch (_error) {
    return null;
  }
}

function isExtensionPage(sender) {
  if (sender?.id !== chrome.runtime.id) return false;
  const url = parsedSenderUrl(sender);
  return Boolean(url && url.protocol === "chrome-extension:" && url.host === chrome.runtime.id && EXTENSION_PAGES.has(url.pathname));
}

function draftIdFromSleeperPath(pathname) {
  const match = String(pathname || "").match(/^\/draft\/(?:nfl\/)?([A-Za-z0-9._-]+)/);
  return match?.[1] || null;
}

function isSleeperDraftSender(sender, draftId) {
  if (sender?.id !== chrome.runtime.id) return false;
  const url = parsedSenderUrl(sender);
  return Boolean(url && url.origin === "https://sleeper.com" && draftIdFromSleeperPath(url.pathname) === draftId);
}

function launchIsThrottled(sender, draftId) {
  const source = sender?.tab?.id == null ? parsedSenderUrl(sender)?.href || "extension" : `tab-${sender.tab.id}`;
  const key = `${source}:${draftId}`;
  const now = Date.now();
  const throttled = now - (launchTimes.get(key) || 0) < 1000;
  launchTimes.set(key, now);
  if (launchTimes.size > 200) launchTimes.delete(launchTimes.keys().next().value);
  return throttled;
}

function errorResponse(error) {
  return {
    ok: false,
    code: error?.code || "BACKGROUND_ERROR",
    error: error?.message || "Extension operation failed",
    details: error?.conflicts || null,
  };
}

async function commitState(base, next) {
  const rawCurrent = await storageGet(Storage.STORAGE_KEY);
  const current = Storage.migrateState(rawCurrent).state;
  const merged = StateMerge.mergeState(current, base, next);
  Storage.assertStateBudget(merged);
  await storageSet(Storage.STORAGE_KEY, merged);
  return merged;
}

function restrictStorageAccess() {
  if (!chrome.storage.local.setAccessLevel) return;
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch((error) => {
    console.error("Could not restrict extension storage access", error);
  });
}

restrictStorageAccess();

chrome.runtime.onInstalled.addListener((details) => {
  restrictStorageAccess();
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SDCC_COMMIT_STATE") {
    if (!isExtensionPage(sender)) {
      sendResponse({ ok: false, code: "UNAUTHORIZED_SENDER", error: "State commits require an extension page" });
      return false;
    }
    const operation = commitQueue.then(() => commitState(message.base, message.next));
    commitQueue = operation.catch(() => undefined);
    operation.then(
      (state) => sendResponse({ ok: true, state, warnings: [] }),
      (error) => sendResponse(errorResponse(error)),
    );
    return true;
  }

  if (message?.type === "SDCC_OPEN_WORKSPACE") {
    if (!isExtensionPage(sender)) {
      sendResponse({ ok: false, error: "Unauthorized workspace request" });
      return false;
    }
    if (message.target === "editor") {
      chrome.tabs.create({ url: chrome.runtime.getURL("extension/editor.html") });
    } else {
      chrome.runtime.openOptionsPage();
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "SDCC_OPEN_DRAFT_CENTER") {
    const draftId = String(message.draftId || "").trim();
    if (!/^[A-Za-z0-9._-]+$/.test(draftId)) {
      sendResponse({ ok: false, error: "Invalid draft ID" });
      return false;
    }
    if (!isExtensionPage(sender) && !isSleeperDraftSender(sender, draftId)) {
      sendResponse({ ok: false, error: "Unauthorized draft request" });
      return false;
    }
    if (launchIsThrottled(sender, draftId)) {
      sendResponse({ ok: false, error: "Draft launcher request was throttled" });
      return false;
    }
    const url = chrome.runtime.getURL(`extension/draft.html?draft_id=${encodeURIComponent(draftId)}`);
    chrome.tabs.create({ url });
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
