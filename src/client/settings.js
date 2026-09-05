// ------------------------------------------------------------------
// Settings. View preferences, persisted in localStorage; shared by the
// folding engine and the settings card through one snapshot store.
// ------------------------------------------------------------------
var SETTINGS_KEY = 'dsh-toolfold.settings.v1';
/** Pre-rename key; migrated once so existing preferences survive. */
var LEGACY_SETTINGS_KEY = 'dsh-codex-collapse.settings.v1';
var DEFAULT_SETTINGS = { enabled: true, durMs: 240, keepThink: false, thinkAuto: true, splitThink: true, stats: false };

function loadSettings() {
  var base = { enabled: true, durMs: DEFAULT_SETTINGS.durMs, keepThink: DEFAULT_SETTINGS.keepThink, thinkAuto: DEFAULT_SETTINGS.thinkAuto, splitThink: DEFAULT_SETTINGS.splitThink, stats: false };
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
      keepThink: parsed.keepThink === true,
      thinkAuto: parsed.thinkAuto !== false,
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
        keepThink: patch.keepThink === undefined ? snapshot.keepThink : patch.keepThink,
        thinkAuto: patch.thinkAuto === undefined ? snapshot.thinkAuto : patch.thinkAuto === true,
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

module.exports = { createSettingsStore };

