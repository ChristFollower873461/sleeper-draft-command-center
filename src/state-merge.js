(function initStateMerge(globalScope, factory) {
  "use strict";
  const api = factory(
    typeof module !== "undefined" && module.exports
      ? require("./storage.js")
      : globalScope.SDCCStorage,
  );
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.SDCCStateMerge = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function stateMergeFactory(Storage) {
  "use strict";

  const ABSENT = Symbol("absent");

  class StateConflictError extends Error {
    constructor(conflicts) {
      super(`Local state changed in another window (${conflicts.join(", ")})`);
      this.name = "StateConflictError";
      this.code = "STATE_CONFLICT";
      this.conflicts = conflicts;
    }
  }

  function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function deepEqual(left, right) {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
      return left.every((value, index) => deepEqual(value, right[index]));
    }
    if (!isObject(left) || !isObject(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (!deepEqual(leftKeys, rightKeys)) return false;
    return leftKeys.every((key) => deepEqual(left[key], right[key]));
  }

  function valueAt(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key) ? object[key] : ABSENT;
  }

  function mergeValue(base, current, next, path, conflicts) {
    if (deepEqual(next, base)) return current;
    if (deepEqual(current, base) || deepEqual(current, next)) return next;
    conflicts.push(path);
    return current;
  }

  function mergeFields(base, current, next, path, conflicts) {
    const result = {};
    const keys = new Set([
      ...Object.keys(base || {}),
      ...Object.keys(current || {}),
      ...Object.keys(next || {}),
    ]);
    for (const key of keys) {
      const value = mergeValue(
        valueAt(base, key),
        valueAt(current, key),
        valueAt(next, key),
        `${path}.${key}`,
        conflicts,
      );
      if (value !== ABSENT) result[key] = value;
    }
    return result;
  }

  function mergeKeyedArray(base, current, next, path, conflicts) {
    const baseMap = new Map((base || []).map((item) => [item.id, item]));
    const currentMap = new Map((current || []).map((item) => [item.id, item]));
    const nextMap = new Map((next || []).map((item) => [item.id, item]));
    const merged = new Map();
    const ids = new Set([...baseMap.keys(), ...currentMap.keys(), ...nextMap.keys()]);
    for (const id of ids) {
      const value = mergeValue(
        baseMap.has(id) ? baseMap.get(id) : ABSENT,
        currentMap.has(id) ? currentMap.get(id) : ABSENT,
        nextMap.has(id) ? nextMap.get(id) : ABSENT,
        `${path}.${id}`,
        conflicts,
      );
      if (value !== ABSENT) merged.set(id, value);
    }
    const order = [
      ...(current || []).map((item) => item.id),
      ...(next || []).map((item) => item.id),
    ];
    return [...new Set(order)].filter((id) => merged.has(id)).map((id) => merged.get(id));
  }

  function mergeKeyedObject(base, current, next, path, conflicts) {
    const result = {};
    const keys = new Set([
      ...Object.keys(base || {}),
      ...Object.keys(current || {}),
      ...Object.keys(next || {}),
    ]);
    for (const key of keys) {
      const value = mergeValue(
        valueAt(base, key),
        valueAt(current, key),
        valueAt(next, key),
        `${path}.${key}`,
        conflicts,
      );
      if (value !== ABSENT) result[key] = value;
    }
    return result;
  }

  function normalizedState(raw) {
    const migrated = Storage.migrateState(raw);
    const errors = Storage.validateState(migrated.state);
    if (errors.length) throw new TypeError(`Local state is invalid: ${errors[0]}`);
    Storage.assertStateBudget(migrated.state);
    return migrated.state;
  }

  function mergeState(currentRaw, baseRaw, nextRaw) {
    const current = normalizedState(currentRaw);
    const base = normalizedState(baseRaw);
    const next = normalizedState(nextRaw);
    const conflicts = [];
    const candidate = {
      schema_version: Storage.STORAGE_VERSION,
      user: mergeFields(base.user, current.user, next.user, "user", conflicts),
      ranking_profiles: mergeKeyedArray(
        base.ranking_profiles,
        current.ranking_profiles,
        next.ranking_profiles,
        "ranking_profiles",
        conflicts,
      ),
      draft_sessions: mergeKeyedObject(
        base.draft_sessions,
        current.draft_sessions,
        next.draft_sessions,
        "draft_sessions",
        conflicts,
      ),
      settings: mergeFields(base.settings, current.settings, next.settings, "settings", conflicts),
    };
    if (conflicts.length) throw new StateConflictError(conflicts);
    return normalizedState(candidate);
  }

  return {
    StateConflictError,
    deepEqual,
    mergeState,
  };
});
