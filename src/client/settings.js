// ------------------------------------------------------------------
// Settings. View preferences, persisted in localStorage; shared by the
// folding engine and the settings card through one snapshot store.
// ------------------------------------------------------------------
var SETTINGS_KEY = 'dsh-toolfold.settings.v1';
/** Pre-rename key; migrated once so existing preferences survive. */
var LEGACY_SETTINGS_KEY = 'dsh-codex-collapse.settings.v1';
var DEFAULT_SETTINGS = { enabled: true, durMs: 240, thinkMode: 'auto', splitThink: true, stats: false };

/**
 * Resolve the canonical think mode for one raw section. An explicitly set,
 * valid thinkMode wins; otherwise derive it from the deprecated thinkAuto /
 * keepThink keys so pre-merge preferences survive the upgrade; default
 * 'auto'. Total — never throws. (Host twin: resolveThinkMode in
 * src/host/index.js.)
 */
function resolveThinkMode(section) {
  var mode = section !== undefined && section !== null ? section.thinkMode : undefined;
  if (mode === 'keep' || mode === 'hide' || mode === 'auto') return mode;
  if (section !== undefined && section !== null && section.thinkAuto === false) {
    return section.keepThink === true ? 'keep' : 'hide';
  }
  return 'auto';
}

/** Next canonical think mode for a patch: explicit valid value wins, else
 * derive from legacy patch keys (old-host sections), else keep current so
 * unrelated patches (e.g. {}) never reset it. */
function nextThinkMode(patch, current) {
  if (patch.thinkMode === 'keep' || patch.thinkMode === 'hide' || patch.thinkMode === 'auto') return patch.thinkMode;
  if (patch.thinkAuto !== undefined || patch.keepThink !== undefined) {
    return resolveThinkMode({ thinkMode: undefined, thinkAuto: patch.thinkAuto, keepThink: patch.keepThink });
  }
  return current;
}

function loadSettings() {
  var base = { enabled: true, durMs: DEFAULT_SETTINGS.durMs, thinkMode: DEFAULT_SETTINGS.thinkMode, splitThink: DEFAULT_SETTINGS.splitThink, stats: false };
  if (typeof localStorage === 'undefined') return base;
  var raw = null;
  try {
    raw = localStorage.getItem(SETTINGS_KEY);
    if (raw === null) {
      var legacy = localStorage.getItem(LEGACY_SETTINGS_KEY);
      if (legacy !== null) {
        raw = legacy;
        localStorage.setItem(SETTINGS_KEY, legacy);
        localStorage.removeItem(LEGACY_SETTINGS_KEY);
      }
    }
  } catch (err) {
    return base;
  }
  if (raw === null) return base;
  try {
    var parsed = JSON.parse(raw);
    var dur = Number(parsed.durMs);
    return {
      enabled: parsed.enabled !== false,
      durMs: Number.isFinite(dur) ? Math.max(0, Math.min(2000, Math.round(dur))) : DEFAULT_SETTINGS.durMs,
      thinkMode: resolveThinkMode(parsed),
      splitThink: parsed.splitThink !== false,
      stats: parsed.stats === true
    };
  } catch (err) {
    return base;
  }
}

/** Minimal SnapshotStore: stable getSnapshot until update replaces it. */
function createSettingsStore() {
  var snapshot = loadSettings();
  var listeners = [];
  return {
    getSnapshot: function () { return snapshot; },
    subscribe: function (listener) {
      listeners.push(listener);
      return function () {
        var index = listeners.indexOf(listener);
        if (index !== -1) listeners.splice(index, 1);
      };
    },
    update: function (patch) {
      snapshot = {
        enabled: patch.enabled === undefined ? snapshot.enabled : patch.enabled === true,
        durMs: patch.durMs === undefined ? snapshot.durMs : patch.durMs,
        thinkMode: nextThinkMode(patch, snapshot.thinkMode),
        splitThink: patch.splitThink === undefined ? snapshot.splitThink : patch.splitThink === true,
        stats: patch.stats === undefined ? snapshot.stats : patch.stats
      };
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(snapshot));
        } catch (err) { /* storage full/blocked: settings stay in-memory */ }
      }
      for (var i = 0; i < listeners.length; i++) listeners[i]();
    }
  };
}

module.exports = { createSettingsStore, resolveThinkMode };

