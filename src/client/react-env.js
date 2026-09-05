/**
 * React bridge between the two delivery channels.
 *
 * The source graph never imports React statically. Each channel provides its
 * own React instance and the build wrapper (intro) stamps it here before the
 * plugin's apply() runs:
 *
 *   - installed loader channel: the factory's `require('react')` resolves
 *     through the web shell's module table (the product's real React — the
 *     settings card uses hooks, so instance identity matters);
 *   - dynamic-runner channel (code.client body in a live GUI session): React
 *     arrives as the runner's closure parameter.
 *
 * Headless harnesses (engine-smoke, live-probe without a card) provide
 * neither, stay null, and simply never register the settings card.
 */
function acquireReact() {
  if (typeof globalThis !== 'undefined'
    && globalThis !== null
    && globalThis.__dshToolfoldReact != null) {
    return globalThis.__dshToolfoldReact;
  }
  return null;
}

module.exports = { acquireReact };

