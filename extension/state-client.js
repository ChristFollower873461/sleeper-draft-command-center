(function initializeStateClient(globalScope) {
  "use strict";

  const Storage = globalScope.SDCCStorage;

  class StateClientError extends Error {
    constructor(message, code = "STATE_CLIENT_ERROR", details = null) {
      super(message);
      this.name = "StateClientError";
      this.code = code;
      this.details = details;
    }
  }

  function requireExtensionStorage() {
    if (!globalScope.chrome?.storage?.local || !globalScope.chrome?.runtime?.sendMessage) {
      throw new StateClientError("Chrome extension storage is unavailable", "STORAGE_UNAVAILABLE");
    }
  }

  function getValue(key) {
    requireExtensionStorage();
    return new Promise((resolve, reject) => {
      chrome.storage.local.get([key], (values) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new StateClientError(error.message, "STORAGE_READ_FAILED"));
        else resolve(values[key]);
      });
    });
  }

  function setValue(key, value) {
    requireExtensionStorage();
    if (key === Storage.STORAGE_KEY) {
      return Promise.reject(new StateClientError("Root state must use commitState", "DIRECT_STATE_WRITE_BLOCKED"));
    }
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [key]: value }, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new StateClientError(error.message, "STORAGE_WRITE_FAILED"));
        else resolve();
      });
    });
  }

  async function getState() {
    const raw = await getValue(Storage.STORAGE_KEY);
    const migrated = Storage.migrateState(raw);
    const errors = Storage.validateState(migrated.state);
    if (errors.length) throw new StateClientError(`Local state is invalid: ${errors[0]}`, "INVALID_STATE");
    Storage.assertStateBudget(migrated.state);
    return migrated;
  }

  function sendMessage(message) {
    requireExtensionStorage();
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new StateClientError(error.message, "RUNTIME_MESSAGE_FAILED"));
          return;
        }
        if (!response?.ok) {
          reject(new StateClientError(
            response?.error || "Local state commit failed",
            response?.code || "STATE_COMMIT_FAILED",
            response?.details || null,
          ));
          return;
        }
        resolve(response);
      });
    });
  }

  async function commitState(baseRaw, nextRaw) {
    const base = Storage.migrateState(baseRaw).state;
    const migrated = Storage.migrateState(nextRaw);
    const errors = Storage.validateState(migrated.state);
    if (errors.length) throw new StateClientError(`Local state is invalid: ${errors[0]}`, "INVALID_STATE");
    Storage.assertStateBudget(migrated.state);
    const response = await sendMessage({ type: "SDCC_COMMIT_STATE", base, next: migrated.state });
    const committed = Storage.migrateState(response.state).state;
    Storage.assertStateBudget(committed);
    return { state: committed, warnings: [...migrated.warnings, ...(response.warnings || [])] };
  }

  globalScope.SDCCStateClient = {
    StateClientError,
    commitState,
    getState,
    getValue,
    setValue,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
