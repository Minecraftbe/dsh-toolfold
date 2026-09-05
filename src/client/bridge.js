// ------------------------------------------------------------------
// DSH settings bridge. The folding engine and the settings card read one
// store; this bridge decides WHERE the store's values come from and go:
// the official settingsScope transport when the deployment exposes the
// namespace, else the host half's route (backed by the DSH settings
// service → ~/.dsh/settings.yaml), else localStorage. `status()` tells
// the card which tier is live.
// ------------------------------------------------------------------
var DSH_API = '/api/dsh-toolfold/settings';

function clampDur(value) {
  var dur = Number(value);
  return Number.isFinite(dur) ? Math.max(0, Math.min(2000, Math.round(dur))) : undefined;
}

/** Merge one fully-resolved DSH section into the local store. */
function adoptSection(store, section) {
  store.update({
    enabled: section.enabled === undefined ? undefined : section.enabled === true,
    durMs: clampDur(section.durMs),
    keepThink: section.keepThink === undefined ? undefined : section.keepThink === true,
    thinkAuto: section.thinkAuto === undefined ? undefined : section.thinkAuto === true,
    splitThink: section.splitThink === undefined ? undefined : section.splitThink === true,
    stats: section.stats === undefined ? undefined : section.stats === true
  });
}

function createSettingsBridge(ctx, store) {
  var scope = null;
  var scopeReady = false;
  var routeOk = false;
  var disposers = [];

  // Version-mismatch report carried by the host route's `dsh` field:
  // 'unknown' until the first host response, then 'ok' | 'old' | 'new'.
  // A mismatch warns ONCE in the console and flips the card's warning
  // icon state (the icon + hover tooltip render from that state).
  var compatState = 'unknown';
  var compatVersion = null;
  var compatWarned = false;
  function setCompat(info) {
    var state = info && (info.state === 'ok' || info.state === 'old' || info.state === 'new') ? info.state : 'unknown';
    var version = info && typeof info.version === 'string' ? info.version : null;
    compatState = state;
    compatVersion = version;
    if (state !== 'ok' && !compatWarned && typeof console !== 'undefined' && typeof console.warn === 'function') {
      compatWarned = true;
      console.warn('[dsh-toolfold] DSH 版本不匹配（当前 ' + (version === null ? '未知' : version) + '）：本插件支持 DSH >=0.1.2-rc.1 <0.1.3，' + (state === 'old' ? '当前版本过旧，请升级 DSH' : '当前版本过新，请等待插件更新') + '。');
    }
    // Nudge store listeners so the settings card re-renders with the
    // warning icon even when the report arrives after first paint.
    store.update({});
  }

  // 1) Official settingsScope transport (settingsScope / webUiSettings).
  var binder = null;
  try {
    if (typeof ctx.get === 'function') {
      binder = ctx.get('webUiSettings') || ctx.get('settingsScope') || null;
    }
  } catch (err) {
    binder = null;
  }
  if (binder !== null && typeof binder.bind === 'function') {
    try {
      scope = binder.bind({ namespace: 'toolfold' });
    } catch (err) {
      scope = null;
    }
  }
  if (scope !== null && typeof scope.subscribe === 'function' && typeof scope.getSnapshot === 'function') {
    disposers.push(scope.subscribe(function () {
      var snap = scope.getSnapshot();
      if (snap === null || typeof snap !== 'object') return;
      if (snap.status === 'ready' && snap.value !== null && typeof snap.value === 'object') {
        scopeReady = true;
        routeOk = false; // the official transport outranks the route
        adoptSection(store, snap.value);
      } else if (snap.status === 'unavailable') {
        scopeReady = false;
        void routeLoad();
      }
    }));
  }

  // 2) The host half's route (registered by lib/index.js).
  function routeLoad() {
    if (typeof fetch !== 'function') return Promise.resolve(false);
    return fetch(DSH_API, { method: 'GET', cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (body) {
        if (body === null || body.ok !== true || body.value === null || typeof body.value !== 'object') {
          routeOk = false;
          return false;
        }
        // Version-mismatch report rides every route response, whichever
        // tier owns the store values (probe-only when the official scope
        // transport is live).
        if (body.dsh !== null && typeof body.dsh === 'object') setCompat(body.dsh);
        if (scopeReady) return false; // the official transport owns the store
        routeOk = true;
        adoptSection(store, body.value.value === undefined ? body.value : body.value.value);
        return true;
      })
      .catch(function () { routeOk = false; return false; });
  }

  function routeWrite(field, value, op) {
    if (typeof fetch !== 'function') return Promise.resolve(false);
    var payload = op === 'unset'
      ? { op: 'unset', field: field }
      : { op: 'set', field: field, value: value };
    return fetch(DSH_API, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (body) {
        if (body === null || body.ok !== true || body.value === null || typeof body.value !== 'object') return false;
        routeOk = true;
        adoptSection(store, body.value.value === undefined ? body.value : body.value.value);
        return true;
      })
      .catch(function () { return false; });
  }

  return {
    /** Apply one field change: optimistic local update, then persist through the live tier. */
    write: function (field, value) {
      var patch = {};
      patch[field] = value;
      store.update(patch);
      if (scopeReady && scope !== null && typeof scope.set === 'function') {
        scope.set(field, value).catch(function () {});
      } else {
        void routeWrite(field, value, 'set');
      }
    },
    unset: function (field) {
      if (scopeReady && scope !== null && typeof scope.unset === 'function') {
        scope.unset(field).catch(function () {});
      } else {
        void routeWrite(field, undefined, 'unset');
      }
    },
    /** 'dsh' when a host-backed tier is live, 'local' otherwise. */
    status: function () { return scopeReady || routeOk ? 'dsh' : 'local'; },
    /** Last host-reported DSH compatibility: { state, version }. */
    compat: function () { return { state: compatState, version: compatVersion }; },
    load: routeLoad,
    dispose: function () {
      for (var i = 0; i < disposers.length; i++) disposers[i]();
    }
  };
}

module.exports = { createSettingsBridge };

