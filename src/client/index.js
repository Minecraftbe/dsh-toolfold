/**
 * dsh-toolfold — CLIENT half (browser), entry module.
 *
 * Source layout mirrors the official client-modules architecture: modular
 * sources under src/client/, bundled by tsdown into the loader artifact
 * (lib/client.js) and the dynamic-runner body (lib/dynamic-body.js). See
 * tsdown.config.mjs for the two wrapper faces; the plugin object below is
 * shared verbatim by both.
 */
const { createSettingsStore } = require('./settings.js');
const { createSettingsBridge } = require('./bridge.js');
const { CARD_STYLE_ID, cardCss } = require('./styles.js');
const { installCollapseEngine } = require('./engine.js');
const { SettingsCard } = require('./card.js');
const { acquireReact } = require('./react-env.js');

var plugin = {
  name: 'toolfold',
  // Declared so the fiber waits for the slots service and `ctx.slots` is
  // available in apply — the documented dynamic-package pattern. `timer`
  // is the Cordis timer service: browser timer globals (setTimeout /
  // setInterval / clearTimeout / clearInterval) are shadowed by teaching
  // traps in the dynamic client environment, so every engine timer goes
  // through ctx.timeout / ctx.interval disposers.
  inject: ['slots', 'timer'],
  apply: function (ctx) {
    if (typeof document === 'undefined') return;
    var settings = createSettingsStore();
    // Diagnostic/test hook: the settings store (and its live stats
    // counters) is reachable as window.__toolfoldSettings.
    if (typeof window !== 'undefined') window.__toolfoldSettings = settings;
    // DSH settings bridge: official settingsScope → host route →
    // localStorage (see the createSettingsBridge doc above).
    var bridge = createSettingsBridge(ctx, settings);
    if (typeof window !== 'undefined') window.__toolfoldBridge = bridge;
    var timers = {
      after: function (callback, delay) { return ctx.timeout(callback, delay); },
      every: function (callback, delay) { return ctx.interval(callback, delay); },
      cancel: function (handle) {
        if (handle !== undefined && handle !== null) handle();
      }
    };
    ctx.effect(function () {
      // The settings card's chrome lives in its OWN style tag (cardCss),
      // created here for the plugin's whole life and removed only when
      // this plugin stops. The engine's folding rules are a separate
      // tag it owns, so the master switch below can dispose the engine
      // without stripping the always-mounted card's styles.
      var cardTag = null;
      if (typeof document !== 'undefined' && document.head !== null) {
        cardTag = document.createElement('style');
        cardTag.setAttribute('data-plugin', 'dsh-toolfold');
        cardTag.setAttribute('data-plugin-css', CARD_STYLE_ID);
        cardTag.textContent = cardCss;
        document.head.appendChild(cardTag);
      }
      // Master switch: with `enabled` off the engine is fully removed
      // (bars, injected styles and classes, observers, timers) and the
      // chat returns to the product's default view; flipping it back on
      // re-installs the engine over the SAME store, so every other
      // preference still applies. The settings card stays mounted either
      // way — the switch must always be reachable to re-enable.
      var engineInstalled = false;
      var offEngine = null;
      function syncEngine() {
        var on = settings.getSnapshot().enabled !== false;
        if (on && !engineInstalled) {
          offEngine = installCollapseEngine(document, settings, timers);
          engineInstalled = true;
        } else if (!on && engineInstalled) {
          offEngine();
          offEngine = null;
          engineInstalled = false;
        }
      }
      syncEngine();
      var offSync = settings.subscribe(function () { syncEngine(); });
      return function () {
        offSync();
        if (engineInstalled) {
          offEngine();
          engineInstalled = false;
          offEngine = null;
        }
        bridge.dispose();
        if (cardTag !== null && cardTag.parentNode !== null) {
          cardTag.parentNode.removeChild(cardTag);
        }
      };
    });
    // Probe the host-backed tiers once; the official scope subscribe
    // above and this call both converge on the same adoptSection path.
    void bridge.load();
    // The settings card needs the channel-provided React instance (loader
    // module table / dynamic-runner closure); with none available the card is
    // simply not registered — the folding engine never needs React.
    if (acquireReact() === null) return;
    var slots = ctx.slots;
    if (slots === undefined) return;
    try {
      // Generator form, exactly like the product's own entries; slots.inject
      // waits for the declaration and re-runs on redeclaration, so the card
      // appears whenever Settings → 插件 is open while this plugin runs.
      slots.inject('settings.plugin.item', function* () {
        yield slots.register(
          {
            name: 'settings.plugin.item',
            key: 'toolfold',
            id: 'toolfold',
            order: 30,
            label: '工具折叠',
            inject: function () {
              return {
                hooks: { ccxSettings: settings },
                setEnabled: function (on) { bridge.write('enabled', on); },
                setDur: function (ms) { bridge.write('durMs', ms); },
                setThinkMode: function (mode) { bridge.write('thinkMode', mode); },
                setSplitThink: function (on) { bridge.write('splitThink', on); },
                setStats: function (on) { bridge.write('stats', on); },
                stats: function () { return settings.stats; },
                bridgeStatus: function () { return bridge.status(); },
                compat: function () { return bridge.compat(); },
                tick: function (cb, ms) { return ctx.interval(cb, ms); },
                cancelTick: function (handle) {
                  if (handle !== undefined && handle !== null) handle();
                }
              };
            }
          },
          SettingsCard
        );
      });
    } catch (err) {
      // console.error mirrors into the load report, so a registration
      // failure is visible instead of silently vanishing.
      console.error('toolfold settings card failed to register:', err);
    }
  }
};

module.exports = plugin;

