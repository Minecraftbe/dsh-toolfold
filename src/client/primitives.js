/**
 * Product icon bridge (chevron-down 14).
 *
 * The web shell seeds every client bundle's `require` with a frozen module
 * table that includes `@deepseek-ai/dsh-client-ui-primitives` — the same
 * `IconChevronDownOutline14` the product's own plugin cards render. That
 * table is a runtime surface, not a build dependency, so this module never
 * imports it statically (tsdown keeps the specifier external via
 * `deps.neverBundle`): `acquireChevronDown` tries the live component and
 * falls back to a pixel-identical inline SVG carrying the official path
 * data. Either way the settings card's chevron is the official artwork,
 * never a font-dependent text glyph.
 *
 * Resolution is lazy AND cached: the harness's throwing `require`, the
 * dynamic-runner body (no `require` at all), and headless tests all land
 * on the fallback without ever breaking module load.
 */
var CHEVRON_DOWN_PATH = 'M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z';

var cachedChevron = null;

function tryOfficialChevron() {
  try {
    if (typeof require !== 'function') return null;
    var prim = require('@deepseek-ai/dsh-client-ui-primitives');
    if (prim !== null && typeof prim === 'object'
      && typeof prim.IconChevronDownOutline14 === 'function') {
      return prim.IconChevronDownOutline14;
    }
  } catch (err) {
    // No product table here (harness, dynamic body, tests, old DSH):
    // the fallback below is pixel-identical, so just use it.
  }
  return null;
}

/**
 * Resolve the chevron-down component for the given React instance:
 * the product's own icon when the channel provides it, else the inline
 * fallback. Never throws; safe to call at card-render time only (module
 * load must stay side-effect free for the harness).
 */
function acquireChevronDown(React) {
  if (cachedChevron !== null) return cachedChevron;
  var Official = tryOfficialChevron();
  if (Official !== null) {
    cachedChevron = Official;
    return cachedChevron;
  }
  cachedChevron = function FallbackChevronDown(props) {
    var p = props !== null && typeof props === 'object' ? props : {};
    var size = p.size === undefined ? 14 : p.size;
    return React.createElement('svg', {
      width: size,
      height: size,
      viewBox: '0 0 14 14',
      fill: 'none',
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': true,
      className: p.className,
    }, React.createElement('path', { d: CHEVRON_DOWN_PATH, fill: 'currentColor' }));
  };
  return cachedChevron;
}

module.exports = { acquireChevronDown, CHEVRON_DOWN_PATH };
