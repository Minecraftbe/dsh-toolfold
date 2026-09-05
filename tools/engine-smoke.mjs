/**
 * engine-smoke.mjs — headless smoke test + micro-benchmark for the folding
 * engine, running the REAL lib/client.js source against jsdom.
 *
 * What it verifies:
 *   1. a run of tool calls folds into a bar, and settled thinking SPLITS
 *      one call sequence into independent bars (rows hidden, bars in place);
 *   2. keepThink toggling keeps the think row visible between the bars;
 *   3. streaming text mutations are ignored with ZERO passes (skip counter);
 *   4. tool-content mutations only refresh the affected bar clone;
 *   5. expand / collapse round-trip;
 *   6. row-level churn drives merge passes;
 *   7. dispose restores the DOM and leaves no live observers.
 *
 * It also prints measured engine cost per mutation class (via the opt-in
 * stats counters), i.e. hard numbers for the "near-zero performance cost"
 * claim.
 *
 * Usage: node tools/engine-smoke.mjs
 * Requires jsdom (resolved from the dsh workspace checkout).
 */
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// Resolved from the dsh workspace checkout (jsdom is not a dependency here).
const { JSDOM } = require('D:/Applications/deepseek-harness/dsh/node_modules/jsdom');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = (win) => new Promise((resolve) => win.requestAnimationFrame(resolve));
const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log('  \u2713 ' + name);
  } else {
    failures += 1;
    console.error('  \u2717 ' + name + (detail !== undefined ? ' \u2014 ' + detail : ''));
  }
}

const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
  url: 'http://127.0.0.1/',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
});
const { window } = dom;
const { document } = window;

// ---- Synthetic chat flow, mounted BEFORE the plugin boots. ----
function makeRow(kind, key) {
  const row = document.createElement('div');
  row.setAttribute('data-chat-flow-kind', kind);
  row.setAttribute('data-chat-flow-key', key);
  return row;
}
const flow = document.createElement('div');
flow.setAttribute('data-chat-flow', '');
document.body.appendChild(flow);

const t1 = makeRow('tool-call', 'k1');
const t2 = makeRow('tool-call', 'k2');
const thinkRow = makeRow('assistant-step', 'k-think');
const think = document.createElement('div');
think.setAttribute('data-variant', 'think');
think.setAttribute('data-state', 'ok');
thinkRow.appendChild(think);
const t3 = makeRow('tool-call', 'k3');
const t4 = makeRow('tool-call', 'k4');
for (const [t, name] of [[t1, 'read'], [t2, 'write'], [t3, 'bash'], [t4, 'grep']]) {
  const disc = document.createElement('div');
  disc.setAttribute('data-disclosure-row', '');
  disc.textContent = name + ' \u2014 initial';
  t.appendChild(disc);
}
flow.append(t1, t2, thinkRow, t3, t4);

// ---- Module loader shim + boot the plugin. ----
let plugin = null;
window.__ModuleLoader__ = {
  load(spec) {
    plugin = spec.factory(() => { throw new Error('require is not available in the harness'); });
  },
};
vm.runInContext(readFileSync(join(root, 'lib', 'client.js'), 'utf8'), dom.getInternalVMContext());
check('plugin loaded from lib/client.js', plugin !== null && typeof plugin.apply === 'function');

const disposers = [];
const ctx = {
  effect(fn) {
    const dispose = fn();
    if (typeof dispose === 'function') disposers.push(dispose);
  },
  timeout(cb, ms) {
    const id = window.setTimeout(cb, ms);
    return () => window.clearTimeout(id);
  },
  interval(cb, ms) {
    const id = window.setInterval(cb, ms);
    return () => window.clearInterval(id);
  },
  get() { return undefined; },
};
plugin.apply(ctx);
await nextFrame(window); // deferred bootInit
await nextFrame(window); // initial merge pass
await nextTick();

const store = window.__toolfoldSettings;
check('settings store exposed', store !== undefined && typeof store.update === 'function');

// The settings card's chrome must live in its OWN style tag (plugin-life),
// separate from the engine's folding tag — disabling the engine must never
// strip the always-mounted card's styles.
const cardStyleTag = document.querySelector('style[data-plugin-css="dsh-toolfold/card"]');
const engineStyleTag = document.querySelector('style[data-plugin-css="dsh-toolfold/style"]');
check('card chrome style tag mounted at boot', cardStyleTag !== null);
check('card chrome tag carries the .ccxCard rules',
  cardStyleTag !== null && cardStyleTag.textContent.includes('.ccxCard{'));
check('card chrome carries the .ccxWarn mismatch rules',
  cardStyleTag !== null && cardStyleTag.textContent.includes('.ccxWarn'));
check('engine style tag mounted at boot', engineStyleTag !== null);

// ---- 1. Initial folding. ----
const bars = flow.querySelectorAll('.ccxBar');
let bar = bars[0];
let bar2 = bars[1];
check('settled think separates the calls into two runs', bars.length === 2, 'bars=' + bars.length);
check('bar1 sits before the first row', bar !== null && bar.nextElementSibling === t1);
check('bar2 sits after the think row', bar2 !== null && bar2.nextElementSibling === t3);
check('first block rows hidden when collapsed', [t1, t2].every((t) => t.classList.contains('ccxMerged')));
check('second block rows hidden when collapsed', [t3, t4].every((t) => t.classList.contains('ccxMerged')));
check('think row is NOT merged into any bar', !thinkRow.classList.contains('ccxMerged'));
check('think row hidden as empty step (keepThink off)', thinkRow.classList.contains('ccxEmpty'));

// ---- 1b. DSH settings bridge (official scope → host route → localStorage). ----
const bridge = window.__toolfoldBridge;
check('settings bridge exposed', bridge !== undefined && typeof bridge.write === 'function');
check('no host transport in harness → local status', bridge.status() === 'local');

// Fake the host half's route: GET serves a DSH-backed section, writes echo
// the new resolved section back (exactly the lib/index.js protocol).
const bridgeCalls = [];
window.fetch = (url, init) => {
  bridgeCalls.push({ url, init });
  const method = init === undefined ? 'GET' : init.method;
  if (method === 'GET') {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({
      ok: true, value: { value: { durMs: 500, keepThink: true, splitThink: true, stats: false }, revision: 3, writable: true },
    }) });
  }
  const body = JSON.parse(init.body);
  const value = { durMs: body.op === 'set' && body.field === 'durMs' ? body.value : 500, keepThink: true, splitThink: true, stats: false };
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, value: { value, revision: 4, writable: true } }) });
};
await bridge.load();
check('DSH route read adopts the host section',
  store.getSnapshot().durMs === 500 && store.getSnapshot().keepThink === true,
  JSON.stringify(store.getSnapshot()));
check('DSH-backed status after route read', bridge.status() === 'dsh');
bridge.write('durMs', 700);
await sleep(30);
check('write went through the host route (POST with field)',
  bridgeCalls.some((c) => c.init !== undefined && c.init.method === 'POST' && c.init.body.indexOf('"durMs"') !== -1));
check('optimistic local update applied immediately', store.getSnapshot().durMs === 700);
check('host write response adopted', store.getSnapshot().durMs === 700 && store.getSnapshot().keepThink === true);

// ---- 1b2. DSH version-mismatch reporting (the route's `dsh` field). ----
check('compat unknown before the first host report', bridge.compat().state === 'unknown');
const consoleWarns = [];
window.console.warn = (message) => { consoleWarns.push(String(message)); };
const fakeRoute = (dshInfo) => (url, init) => {
  const method = init === undefined ? 'GET' : init.method;
  const value = { durMs: 500, keepThink: true, splitThink: true, stats: false };
  const body = { ok: true, value: { value, revision: 5, writable: true } };
  if (dshInfo !== undefined) body.dsh = dshInfo;
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
};
window.fetch = fakeRoute({ version: '0.1.1-rc.1', state: 'old' });
await bridge.load();
check('old host report flips compat to old',
  bridge.compat().state === 'old' && bridge.compat().version === '0.1.1-rc.1',
  JSON.stringify(bridge.compat()));
window.fetch = fakeRoute({ version: '0.1.1-rc.1', state: 'old' });
await bridge.load();
check('mismatch console warning fires exactly once', consoleWarns.length === 1, 'warns=' + consoleWarns.length);
window.fetch = fakeRoute({ version: '0.2.0', state: 'new' });
await bridge.load();
check('newer host flips compat to new without a second warning',
  bridge.compat().state === 'new' && consoleWarns.length === 1,
  JSON.stringify(bridge.compat()));
window.fetch = fakeRoute({ version: '0.1.2-rc.1', state: 'ok' });
await bridge.load();
check('in-range report clears the mismatch state', bridge.compat().state === 'ok' && consoleWarns.length === 1);
// Restore defaults so the timing-sensitive collapse checks below stay valid.
store.update({ durMs: 240, thinkAuto: false, keepThink: false });

// ---- 1c. keepThink on → think row stays visible between the two bars. ----
store.update({ keepThink: true });
await nextFrame(window);
await nextFrame(window);
await nextTick();
check('keepThink on keeps think row visible between bars',
  !thinkRow.classList.contains('ccxEmpty') && !thinkRow.classList.contains('ccxMerged'));
check('bars still split around the visible think', flow.querySelectorAll('.ccxBar').length === 2);
store.update({ keepThink: false });
await nextFrame(window);
await nextFrame(window);
await nextTick();
check('keepThink off hides the think row again', thinkRow.classList.contains('ccxEmpty'));
// Back on the DEFAULT auto rule (this flow has no official turn-process chip,
// so auto hides thinking — even while keepThink is on).
store.update({ thinkAuto: true, keepThink: true });
await nextFrame(window);
await nextFrame(window);
await nextTick();
check('auto rule hides thinking even with keepThink on (no official chip)',
  thinkRow.classList.contains('ccxEmpty'));
store.update({ thinkAuto: true, keepThink: false });
await nextFrame(window);
await nextFrame(window);
await nextTick();
check('auto rule baseline stays hidden', thinkRow.classList.contains('ccxEmpty'));

// ---- 1d. splitThink off → the original merge: one bar across the think. ----
store.update({ splitThink: false });
await nextFrame(window);
await nextFrame(window);
await nextTick();
check('merge mode folds the whole sequence into one bar',
  flow.querySelectorAll('.ccxBar').length === 1);
check('all four calls hidden under the merged bar',
  [t1, t2, t3, t4].every((t) => t.classList.contains('ccxMerged')));
check('think row folds WITH the merged run', thinkRow.classList.contains('ccxMerged'));
store.update({ splitThink: true });
await nextFrame(window);
await nextFrame(window);
await nextTick();
check('split mode restored: two bars again', flow.querySelectorAll('.ccxBar').length === 2);
check('think row no longer merged after split restored', !thinkRow.classList.contains('ccxMerged'));
// The 1d toggle rebuilt bar2 (merge mode removed it), so re-query before
// the later sections rely on the bar references.
const barsNow = flow.querySelectorAll('.ccxBar');
bar = barsNow[0];
bar2 = barsNow[1];

// ---- 2. Streaming must be ignored (zero-cost path). ----
store.update({ stats: true });
await sleep(60); // let the settings-triggered pass settle before baselining

// jsdom floor: a parallel observer measures bare record iteration on the SAME
// real deliveries, isolating jsdom's MutationRecord/NodeList access cost.
// jsdom's DOM proxies are ~10-30x slower than a real browser's native DOM, so
// the engine overhead above this floor is what a browser would experience.
let floorMs = 0;
let floorNodes = 0;
const floorObserver = new window.MutationObserver((records) => {
  const t0 = performance.now();
  let count = 0;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.type === 'childList') count += r.addedNodes.length;
  }
  floorMs += performance.now() - t0;
  floorNodes += count;
});
floorObserver.observe(think, { childList: true, subtree: true });

const s0 = store.stats;
const skip0 = s0.skip;
const obs0 = s0.obsMs;
const refresh0 = s0.refresh;
const pass0 = s0.pass;
const floor0 = floorMs;

// Typical streaming: 200 deliveries, each appending 100 text nodes (20,000
// nodes total) into the think block.
for (let b = 0; b < 200; b++) {
  for (let i = 0; i < 100; i++) think.appendChild(document.createTextNode('x'));
  await nextTick();
}
await sleep(60); // let rAF settle
const s1 = store.stats;
check('streaming deliveries ignored (skip counter grew)',
  s1.skip - skip0 >= 100, 'skip delta=' + (s1.skip - skip0));
check('no engine refresh ran for streaming', s1.refresh === refresh0, 'refresh delta=' + (s1.refresh - refresh0));
check('no merge pass ran for streaming', s1.pass === pass0, 'pass delta=' + (s1.pass - pass0));
const aCost = s1.obsMs - obs0;
const aFloor = floorMs - floor0;
const aOverhead = Math.max(0, aCost - aFloor);
console.log('  \u2139 20,000 streaming text nodes (200 deliveries): ' + aCost.toFixed(2)
  + ' ms engine time incl. jsdom access (' + ((aCost / 20000) * 1000).toFixed(3) + ' \u00b5s/node)');
console.log('  \u2139 same deliveries, bare record iteration (jsdom floor): ' + aFloor.toFixed(2)
  + ' ms (' + ((aFloor / 20000) * 1000).toFixed(3) + ' \u00b5s/node)');
console.log('  \u2139 engine overhead above floor: ' + aOverhead.toFixed(2)
  + ' ms (' + ((aOverhead / 20000) * 1000).toFixed(3) + ' \u00b5s/node; real browsers pay ~10-30x less)');
check('streaming classification overhead bounded (<100ms even under jsdom)',
  aOverhead < 100, aOverhead.toFixed(2) + ' ms');
check('rows stay folded after streaming',
  [t1, t2, t3, t4].every((t) => t.classList.contains('ccxMerged')));

// Worst case: one giant synchronous batch (React big-commit analogue).
const obsW = store.stats.obsMs;
const floorW = floorMs;
for (let i = 0; i < 20000; i++) think.appendChild(document.createTextNode('y'));
await sleep(60);
const wCost = store.stats.obsMs - obsW;
const wOverhead = Math.max(0, wCost - (floorMs - floorW));
console.log('  \u2139 20,000 text nodes in ONE batch: ' + wCost.toFixed(2) + ' ms incl. jsdom access, '
  + wOverhead.toFixed(2) + ' ms above floor (' + ((wOverhead / 20000) * 1000).toFixed(3) + ' \u00b5s/node)');

// ---- 3. Tool-content streaming refreshes only the bar clone. ----
const obs1 = store.stats.obsMs;
const refresh1 = store.stats.refresh;
const clone0 = store.stats.clone;
for (let b = 0; b < 50; b++) {
  for (let i = 0; i < 10; i++) {
    const el = document.createElement('span');
    el.textContent = 'out' + b + '-' + i;
    t4.querySelector('[data-disclosure-row]').appendChild(el);
  }
  await nextTick();
}
await sleep(250); // clone throttle (120ms) + rAF
const s2 = store.stats;
check('content batches classified', s2.obsMs > obs1, (s2.obsMs - obs1).toFixed(2) + ' ms');
check('bar clone refreshed from last call', s2.clone > clone0, 'clone delta=' + (s2.clone - clone0));
check('content went through refresh, not merge passes',
  s2.refresh > refresh1 && s2.pass === pass0,
  'refresh delta=' + (s2.refresh - refresh1) + ', pass delta=' + (s2.pass - pass0));
check('bar2 shows last call content', bar2.textContent.indexOf('out') !== -1);

// ---- 4. Expand / collapse round-trip (bar1 covers t1+t2 only). ----
bar.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(80);
check('expand removes ccxMerged from the first block only',
  [t1, t2].every((t) => !t.classList.contains('ccxMerged'))
  && [t3, t4].every((t) => t.classList.contains('ccxMerged')));
check('bar shows expanded label', bar.textContent.indexOf('\u5df2\u5c55\u5f00') !== -1);
bar.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(700); // collapse duration (2 rows * 45ms + 240ms) + cleanup timer
check('collapse re-applies ccxMerged to the first block', [t1, t2].every((t) => t.classList.contains('ccxMerged')));
// The second bar still folds its own block.
check('second block still folded after first-block round-trip', [t3, t4].every((t) => t.classList.contains('ccxMerged')));

// ---- 5. Row-level churn drives merge passes. ----
const pass1 = store.stats.pass;
for (let b = 0; b < 100; b++) {
  const r = makeRow('tool-call', 'k-new-' + b);
  flow.appendChild(r);
  await nextTick();
}
await sleep(80);
check('row adds ran merge passes', store.stats.pass > pass1, 'pass delta=' + (store.stats.pass - pass1));

// ---- 5b. Collapse a run that keeps GROWING (streaming newest info). ----
// The model appends more calls to the run BOTH before and while it
// collapses. Rows added after the bar was created but before the collapse
// (stale toggle closure) and rows added while the collapse animates must
// all join the cascade, and the finish timer must wait for the last one —
// otherwise they snap shut with the merge ("runs briefly, then suddenly
// collapses").
const flowG = document.createElement('div');
flowG.setAttribute('data-chat-flow', '');
document.body.appendChild(flowG);
const g1 = makeRow('tool-call', 'g1');
const g2 = makeRow('tool-call', 'g2');
const g3 = makeRow('tool-call', 'g3');
for (const [t, name] of [[g1, 'g1'], [g2, 'g2'], [g3, 'g3']]) {
  const disc = document.createElement('div');
  disc.setAttribute('data-disclosure-row', '');
  disc.textContent = name + ' \u2014 initial';
  t.appendChild(disc);
}
flowG.append(g1, g2, g3);
await nextFrame(window); // discover the new flow
await nextFrame(window); // pass
await nextTick();
const gbar = flowG.querySelector('.ccxBar');
check('growth-flow bar created', gbar !== null);
// The run grows BEFORE the collapse: the bar was created with a 3-row
// snapshot, so a stale toggle closure would animate only those 3 rows.
const g4 = makeRow('tool-call', 'g4');
const disc4 = document.createElement('div');
disc4.setAttribute('data-disclosure-row', '');
disc4.textContent = 'g4 \u2014 streamed before collapse';
g4.appendChild(disc4);
flowG.appendChild(g4);
await nextFrame(window); // pass folds g4 into the run
await nextFrame(window);
await nextTick();
check('run grew past the bar-creation snapshot',
  gbar._ccxRun !== undefined && gbar._ccxRun.rows.length === 4,
  'rows=' + (gbar._ccxRun !== undefined ? gbar._ccxRun.rows.length : 'n/a'));
gbar.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); // expand
await sleep(80);
check('growth run expanded', [g1, g2, g3, g4].every((t) => !t.classList.contains('ccxMerged')));
gbar.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); // collapse
await sleep(30);
check('collapse animates the CURRENT run, not the creation snapshot',
  [g1, g2, g3, g4].every((t) => t.classList.contains('ccxCollapsing')),
  [g1, g2, g3, g4].map((t) => t.classList.contains('ccxCollapsing')).join(','));
// The model appends a NEW call while the collapse is animating.
const g5 = makeRow('tool-call', 'g5');
const disc5 = document.createElement('div');
disc5.setAttribute('data-disclosure-row', '');
disc5.textContent = 'g5 \u2014 streamed mid-collapse';
g5.appendChild(disc5);
flowG.appendChild(g5);
await nextFrame(window); // observer sees the add \u2192 full pass
await nextFrame(window);
await nextTick();
check('row added mid-collapse joins the cascade (no snap)',
  g5.classList.contains('ccxCollapsing'), 'g5 collapsing=' + g5.classList.contains('ccxCollapsing'));
// Wait out the extended finish timer, then everything merges together.
await sleep(900);
check('grown run merges after the extended collapse',
  [g1, g2, g3, g4, g5].every((t) => t.classList.contains('ccxMerged')),
  [g1, g2, g3, g4, g5].map((t) => t.classList.contains('ccxMerged')).join(','));
check('no leftover collapse classes', ![g1, g2, g3, g4, g5].some((t) => t.classList.contains('ccxCollapsing')));

// ---- 5c. Answer text arriving in an emptied think-only row resurrects it. ----
// The think settles first; the row holds nothing but it, so the engine hides
// the whole row (ccxEmpty). The answer then streams into the SAME row as a
// single appended text node. It must un-hide the row instead of streaming
// invisibly into display:none — the "blank hole where the think was".
const flowR = document.createElement('div');
flowR.setAttribute('data-chat-flow', '');
document.body.appendChild(flowR);
const rr = makeRow('assistant-step', 'k-resurrect');
const rThink = document.createElement('div');
rThink.setAttribute('data-variant', 'think');
rThink.setAttribute('data-state', 'ok');
rThink.textContent = 'settled reasoning';
const rBody = document.createElement('div');
rr.append(rThink, rBody);
flowR.appendChild(rr);
await nextFrame(window); // discover the new flow
await nextFrame(window); // pass
await nextTick();
check('think-only row hidden once the think settles', rr.classList.contains('ccxEmpty'));
rBody.appendChild(document.createTextNode('The streamed answer starts here.'));
await nextFrame(window); // fast path classifies the add -> rows pass
await nextFrame(window);
await nextTick();
check('answer text un-hides the emptied row (no blank hole)',
  !rr.classList.contains('ccxEmpty'),
  'ccxEmpty=' + rr.classList.contains('ccxEmpty'));
// Text still landing inside the hidden think must NOT resurrect the row.
const rr2 = makeRow('assistant-step', 'k-resurrect-2');
const th2 = document.createElement('div');
th2.setAttribute('data-variant', 'think');
th2.setAttribute('data-state', 'ok');
rr2.appendChild(th2);
flowR.appendChild(rr2);
await nextFrame(window); // pass empties rr2
await nextFrame(window);
await nextTick();
check('second think-only row hidden', rr2.classList.contains('ccxEmpty'));
th2.appendChild(document.createTextNode('tail tokens after settle'));
await nextFrame(window);
await nextFrame(window);
await nextTick();
check('think-internal tail tokens do not resurrect the row', rr2.classList.contains('ccxEmpty'));

// ---- 5ca. Hidden think WRAPPER collapses with the think root. ----
// The product's assistant body is a gap:16px flex column whose items are the
// think wrapper and the answer block. Hiding only the think root would leave
// the wrapper as a 0-height flex item that still pins the answer 16px below
// the row top (the "blank band under the folded think"): the engine must
// hide the wrapper in lockstep, and restore it while the think stays visible.
const flowW = document.createElement('div');
flowW.setAttribute('data-chat-flow', '');
document.body.appendChild(flowW);
const wrapRow = makeRow('assistant-step', 'k-wrap');
const thinkWrap = document.createElement('div');
const wrapThink = document.createElement('div');
wrapThink.setAttribute('data-variant', 'think');
wrapThink.setAttribute('data-state', 'ok');
wrapThink.textContent = 'settled reasoning that must fully collapse';
const wrapBody = document.createElement('div');
wrapBody.textContent = 'The answer that must sit at the row top.';
// Mimic the product: think nested in a wrapper, answer as its sibling.
thinkWrap.appendChild(wrapThink);
wrapRow.append(thinkWrap, wrapBody);
flowW.appendChild(wrapRow);
await nextFrame(window); // discover the new flow
await nextFrame(window); // pass
await nextTick();
check('settled-think row with prose stays visible', !wrapRow.classList.contains('ccxEmpty'));
check('hidden think wrapper gets ccxWrapGone',
  thinkWrap.classList.contains('ccxWrapGone'),
  'wrapGone=' + thinkWrap.classList.contains('ccxWrapGone'));
// Streaming think (state running) must keep its wrapper visible.
const flowW2 = document.createElement('div');
flowW2.setAttribute('data-chat-flow', '');
document.body.appendChild(flowW2);
const runRow = makeRow('assistant-step', 'k-wrap-running');
const runWrap = document.createElement('div');
const runThink = document.createElement('div');
runThink.setAttribute('data-variant', 'think');
runThink.setAttribute('data-state', 'running');
runThink.textContent = 'thinking\u2026';
const runBody = document.createElement('div');
runBody.textContent = 'answer placeholder';
runWrap.appendChild(runThink);
runRow.append(runWrap, runBody);
flowW2.appendChild(runRow);
await nextFrame(window);
await nextFrame(window);
await nextTick();
check('running think keeps its wrapper visible', !runWrap.classList.contains('ccxWrapGone'));
runThink.setAttribute('data-state', 'ok'); // settles now
await nextFrame(window); // attribute flip \u2192 think reason
await nextFrame(window);
await nextTick();
check('newly settled think hides its wrapper too', runWrap.classList.contains('ccxWrapGone'));
// Manual keepThink semantics (自动跟随 off): keepThink on must bring the
// wrapper back (think visible again).
store.update({ thinkAuto: false, keepThink: true });
await nextFrame(window);
await nextFrame(window);
await nextTick();
check('keepThink on restores the hidden think wrapper',
  !thinkWrap.classList.contains('ccxWrapGone') && !runWrap.classList.contains('ccxWrapGone'),
  'thinkWrapGone=' + thinkWrap.classList.contains('ccxWrapGone')
    + ', runWrapGone=' + runWrap.classList.contains('ccxWrapGone'));
store.update({ thinkAuto: false, keepThink: false });
await nextFrame(window);
await nextFrame(window);
await nextTick();
check('keepThink off hides the think wrapper again', thinkWrap.classList.contains('ccxWrapGone'));

// ---- 5e. 思考自动跟随官方折叠 (DSH Compact transcript). ----
// With the product's official turn-process fold active in a flow, auto mode
// preserves settled thinking; once the official markers disappear (the view
// is back to Normal), auto falls back to hiding settled thinking again.
store.update({ thinkAuto: true, keepThink: false });
await nextFrame(window);
await nextFrame(window);
await nextTick();
const flowO = document.createElement('div');
flowO.setAttribute('data-chat-flow', '');
document.body.appendChild(flowO);
const oChip = makeRow('turn-process', 'k-chip-o');
oChip.textContent = '3 次工具调用 · 2 条消息'; // foldable chip label
const oThinkRow = makeRow('assistant-step', 'k-othink');
const oThink = document.createElement('div');
oThink.setAttribute('data-variant', 'think');
oThink.setAttribute('data-state', 'ok');
oThink.textContent = 'settled reasoning under the official chip';
oThinkRow.appendChild(oThink);
oThinkRow.setAttribute('data-turn-process-member', '');
const oAnswer = makeRow('assistant-step', 'k-oanswer');
oAnswer.textContent = 'the final answer';
flowO.append(oChip, oThinkRow, oAnswer);
await nextFrame(window);
await nextFrame(window);
await nextTick();
check('auto + official chip keeps settled thinking visible',
  !oThinkRow.classList.contains('ccxEmpty'),
  'ccxEmpty=' + oThinkRow.classList.contains('ccxEmpty'));
// Back to Normal: the product removes the member marker and empties the chip
// (one commit); auto must hide the settled thinking again.
oThinkRow.removeAttribute('data-turn-process-member');
oChip.textContent = '';
await nextFrame(window); // attribute flip -> rows pass (chip emptied same commit)
await nextFrame(window);
await nextTick();
check('auto without the official fold hides settled thinking again',
  oThinkRow.classList.contains('ccxEmpty'),
  'ccxEmpty=' + oThinkRow.classList.contains('ccxEmpty'));

// ---- 5f. Rows the product itself hides (Compact closed) must not leak
// orphaned fold bars "outside" the official fold. ----
const flowP = document.createElement('div');
flowP.setAttribute('data-chat-flow', '');
document.body.appendChild(flowP);
const pChip = makeRow('turn-process', 'k-chip-p');
pChip.textContent = '2 次工具调用 · 已思考';
const p1 = makeRow('tool-call', 'p1');
const p2 = makeRow('tool-call', 'p2');
for (const [t, name] of [[p1, 'p-read'], [p2, 'p-write']]) {
  const disc = document.createElement('div');
  disc.setAttribute('data-disclosure-row', '');
  disc.textContent = name + ' \u2014 initial';
  t.appendChild(disc);
}
// Product collapsed the turn: the member rows carry hidden="until-found".
p1.setAttribute('hidden', 'until-found');
p2.setAttribute('hidden', 'until-found');
p1.setAttribute('data-turn-process-member', '');
p2.setAttribute('data-turn-process-member', '');
const pAnswer = makeRow('assistant-step', 'k-panswer');
pAnswer.textContent = 'final answer';
flowP.append(pChip, p1, p2, pAnswer);
await nextFrame(window);
await nextFrame(window);
await nextTick();
check('no bar is created for rows the product already hides',
  flowP.querySelector('.ccxBar') === null,
  'bars=' + flowP.querySelectorAll('.ccxBar').length);
check('hidden member rows keep no merge markers',
  !p1.classList.contains('ccxMerged') && !p2.classList.contains('ccxMerged'));
// User expands the official fold: the product removes hidden (rows reveal);
// the engine must fold the two calls into its own bar again.
p1.removeAttribute('hidden');
p2.removeAttribute('hidden');
await nextFrame(window); // attribute flip -> rows pass
await nextFrame(window);
await nextTick();
const pbar = flowP.querySelector('.ccxBar');
check('revealed rows fold into the plugin bar again', pbar !== null);
check('revealed rows hidden under the bar',
  p1.classList.contains('ccxMerged') && p2.classList.contains('ccxMerged'));
// Collapsing the official fold again removes the bar (nothing left over).
p1.setAttribute('hidden', 'until-found');
p2.setAttribute('hidden', 'until-found');
await nextFrame(window);
await nextFrame(window);
await nextTick();
check('re-collapsing removes the plugin bar (no leak outside the fold)',
  flowP.querySelector('.ccxBar') === null,
  'bars=' + flowP.querySelectorAll('.ccxBar').length);

// ---- 5d. Master switch: disabling removes every fold, enabling restores. ----
store.update({ enabled: false });
await nextFrame(window); // store listener disposes the engine synchronously
await nextFrame(window);
await nextTick();
check('disabling removes the bars', flow.querySelector('.ccxBar') === null);
check('disabling removes injected classes',
  [t1, t2, t3, t4, thinkRow].every((t) => !t.classList.contains('ccxMerged') && !t.classList.contains('ccxEmpty')));
check('disabling removes the style tag',
  document.querySelector('style[data-plugin-css="dsh-toolfold/style"]') === null);
check('card chrome style tag survives disabling',
  document.querySelector('style[data-plugin-css="dsh-toolfold/card"]') !== null);
store.update({ enabled: true });
await nextFrame(window); // re-install + boot init
await nextFrame(window); // first pass
await nextFrame(window);
await nextTick();
check('re-enabling refolds both runs', flow.querySelectorAll('.ccxBar').length === 2,
  'bars=' + flow.querySelectorAll('.ccxBar').length);
check('re-enabling hides the think row again', thinkRow.classList.contains('ccxEmpty'));
check('re-enabling restores the engine style tag',
  document.querySelector('style[data-plugin-css="dsh-toolfold/style"]') !== null);
check('card chrome style tag still mounted after re-enable',
  document.querySelector('style[data-plugin-css="dsh-toolfold/card"]') !== null);

// ---- 6. Dispose restores the DOM. ----
disposers[0]();
check('bars removed on dispose', flow.querySelector('.ccxBar') === null);
check('classes removed on dispose',
  [t1, t2, t3, t4, thinkRow].every((t) => !t.classList.contains('ccxMerged')));
check('style tag removed on dispose', document.querySelector('style[data-plugin-css]') === null);
think.appendChild(document.createTextNode('after dispose'));
await sleep(20);
check('no crash after dispose', true);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
