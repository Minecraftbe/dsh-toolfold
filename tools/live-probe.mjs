/**
 * live-probe.mjs — headless probe of the REAL DSH Web GUI with the plugin
 * running: boots the page, activates the folding engine against the real
 * conversation DOM, enables the opt-in stats meter, then samples an idle
 * window and reports the plugin's actual cost plus page-level long tasks.
 *
 * READ-ONLY: it never sends messages, clicks chat controls, or starts agent
 * work. Run it briefly and it closes the browser afterwards.
 *
 * Usage: node tools/live-probe.mjs [url]
 * Requires playwright (devDependency — `pnpm install` provides it) and a
 * local Chrome binary (CHROME_PATH overrides the platform default below).
 */
import { createRequire } from 'module';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = dirname(fileURLToPath(import.meta.url));
const bodySrc = readFileSync(join(here, '..', 'lib', 'dynamic-body.js'), 'utf8');

/**
 * Resolve the browser binary: explicit CHROME_PATH wins, otherwise take
 * the first platform default that exists. No bundled browsers are
 * downloaded — the probe drives the machine's real Chrome.
 */
function resolveChrome() {
  if (process.env.CHROME_PATH !== undefined && process.env.CHROME_PATH !== '') return process.env.CHROME_PATH;
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : process.platform === 'win32'
      ? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // keep looking
    }
  }
  throw new Error('no Chrome binary found — set CHROME_PATH to its location');
}

const url = process.argv[2] || 'http://127.0.0.1:3080';
const WINDOW_MS = 8000;

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  headless: true,
  pipe: false,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (err) => errors.push('pageerror: ' + String(err).slice(0, 300)));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('console.error: ' + msg.text().slice(0, 300));
});

console.log('loading ' + url + ' …');
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => errors.push('goto: ' + e.message));

const boot = await page.evaluate(async () => {
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    if (typeof window.__toolfoldSettings !== 'undefined') {
      return {
        ms: Date.now() - t0,
        title: document.title,
        bodyLen: document.body ? document.body.innerHTML.length : 0,
      };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { ms: -1, title: document.title, bodyLen: document.body ? document.body.innerHTML.length : 0 };
});

console.log('plugin boot:', JSON.stringify(boot));
if (boot.ms < 0) {
  // Dynamic plugins are session-bound: this tab landed on the session list,
  // so join the (read-only) live session by opening its row.
  console.log('plugin not present yet — joining the live session row …');
  try {
    await page.getByText('编写dsh插件实现工具调用收起').first().click({ timeout: 10000 });
  } catch (err) {
    console.log('session row click failed:', String(err).slice(0, 200));
  }
  const boot2 = await page.evaluate(async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      if (typeof window.__toolfoldSettings !== 'undefined') {
        return {
          ms: Date.now() - t0,
          flows: document.querySelectorAll('[data-chat-flow]').length,
          bars: document.querySelectorAll('.ccxBar').length,
        };
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return { ms: -1, flows: 0, bars: 0 };
  });
  console.log('after joining session:', JSON.stringify(boot2));
  if (boot2.ms < 0) {
    // The plugin push may only happen at connection time: reload the page
    // while bound to the session URL and wait again.
    const boundUrl = page.url();
    console.log('reloading with session-bound URL:', boundUrl);
    await page.goto(boundUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => errors.push('goto2: ' + e.message));
    const boot3 = await page.evaluate(async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 30000) {
        if (typeof window.__toolfoldSettings !== 'undefined') {
          return {
            ms: Date.now() - t0,
            flows: document.querySelectorAll('[data-chat-flow]').length,
            bars: document.querySelectorAll('.ccxBar').length,
          };
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      return { ms: -1, flows: 0, bars: 0 };
    });
    console.log('after reload:', JSON.stringify(boot3));
    if (boot3.ms < 0) {
      // The dynamic-plugin push never reaches secondary connections, so
      // mount the engine manually from the exact deployed body, exactly as
      // the runner would (async function body + closure symbols). This runs
      // against the REAL conversation DOM in THIS tab only; the user's tab
      // is untouched.
      console.log('injecting engine from lib/dynamic-body.js …');
      const injected = await page.evaluate((src) => {
        const traps = ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'fetch', 'require']
          .map((name) => () => { throw new Error(name + ' trapped in dynamic client'); });
        const factory = new Function(
          'React', 'console', 'styles', 'host', 'harness',
          'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'fetch', 'require', 'process', 'Buffer',
          'return (async () => { ' + src + '\n })()',
        );
        const ctx = {
          effect(fn) {
            const dispose = fn();
            if (typeof dispose === 'function') window.__tfDispose = dispose;
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
        return factory(null, console, { insert() { return () => {}; }, count: 0 },
          { call: () => null }, {}, ...traps, undefined, undefined)
          .then((plugin) => plugin.apply(ctx))
          .then(() => ({ ok: true }))
          .catch((err) => ({ ok: false, error: String(err) }));
      }, bodySrc);
      console.log('injection:', JSON.stringify(injected));
      const boot4 = await page.evaluate(async () => {
        const t0 = Date.now();
        while (Date.now() - t0 < 20000) {
          if (typeof window.__toolfoldSettings !== 'undefined'
            && document.querySelectorAll('.ccxBar').length > 0) {
            return {
              ms: Date.now() - t0,
              flows: document.querySelectorAll('[data-chat-flow]').length,
              bars: document.querySelectorAll('.ccxBar').length,
              merged: document.querySelectorAll('[data-chat-flow-kind].ccxMerged').length,
            };
          }
          await new Promise((r) => setTimeout(r, 200));
        }
        return { ms: -1, flows: 0, bars: 0, merged: 0 };
      });
      console.log('after manual injection:', JSON.stringify(boot4));
      if (boot4.ms < 0) {
        const diag = await page.evaluate(() => ({
          hasModuleLoader: typeof window.__ModuleLoader__,
          flows: document.querySelectorAll('[data-chat-flow]').length,
          bars: document.querySelectorAll('.ccxBar').length,
          visibleText: (document.body ? document.body.innerText : '').slice(0, 300),
        }));
        console.log('diagnostics:', JSON.stringify(diag, null, 2));
        console.log('page errors:', errors.slice(0, 5));
        await browser.close();
        process.exit(1);
      }
      boot.ms = boot4.ms;
    } else {
      boot.ms = boot3.ms;
    }
  } else {
    boot.ms = boot2.ms;
  }
}

// Wait for the conversation DOM to render.
const dom = await page.evaluate(async () => {
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    const flows = document.querySelectorAll('[data-chat-flow]').length;
    if (flows > 0) {
      return {
        flows,
        rows: document.querySelectorAll('[data-chat-flow-kind]').length,
        toolRows: document.querySelectorAll('[data-chat-flow-kind="tool-call"]').length,
        bars: document.querySelectorAll('.ccxBar').length,
      };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { flows: 0, rows: 0, toolRows: 0, bars: 0 };
});
console.log('conversation DOM:', JSON.stringify(dom));

// Enable stats (the engine resets counters at enable time) and sample an
// idle window: this measures the plugin's steady-state cost on the real page.
await page.evaluate(() => window.__toolfoldSettings.update({ stats: true }));
await page.waitForTimeout(WINDOW_MS);
const result = await page.evaluate(() => {
  const s = window.__toolfoldSettings.stats;
  return {
    elapsedMs: Date.now() - s.start,
    stats: {
      obs: s.obs, obsMs: +s.obsMs.toFixed(2),
      refresh: s.refresh, refreshMs: +s.refreshMs.toFixed(2),
      pass: s.pass, passMs: +s.passMs.toFixed(2),
      scan: s.scan, scanMs: +s.scanMs.toFixed(2),
      clone: s.clone, cloneMs: +s.cloneMs.toFixed(2),
      skip: s.skip,
    },
    dom: {
      flows: document.querySelectorAll('[data-chat-flow]').length,
      bars: document.querySelectorAll('.ccxBar').length,
      merged: document.querySelectorAll('[data-chat-flow-kind].ccxMerged').length,
      rows: document.querySelectorAll('[data-chat-flow-kind]').length,
    },
  };
});
console.log('idle window result:', JSON.stringify(result, null, 2));

// CPU profile over a short window: which functions actually burn the page's
// main thread (top self-time). This separates plugin cost from product cost.
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.start');
await page.waitForTimeout(5000);
const { profile } = await cdp.send('Profiler.stop');
const selfTime = new Map();
for (const sample of profile.samples) {
  const node = profile.nodes.find((n) => n.id === sample);
  if (node && node.callFrame) {
    const f = node.callFrame;
    const key = (f.functionName || '(anonymous)') + ' @ ' + (f.url || 'inline');
    selfTime.set(key, (selfTime.get(key) || 0) + 1);
  }
}
const sorted = [...selfTime.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log('top self-time functions (5s sample, sample count):');
for (const [name, count] of sorted) console.log('  ' + String(count).padStart(6) + '  ' + name);

// Page-level long tasks (main-thread jank indicator), buffered + 5s live.
const longTasks = await page.evaluate(
  (windowMs) => new Promise((resolve) => {
    if (typeof PerformanceObserver === 'undefined') { resolve(null); return; }
    const tasks = [];
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) tasks.push(Math.round(entry.duration));
    });
    try {
      obs.observe({ type: 'longtask', buffered: true });
    } catch { resolve(null); return; }
    setTimeout(() => {
      obs.disconnect();
      resolve({ count: tasks.length, durationsMs: tasks.slice(-20) });
    }, windowMs);
  }),
  WINDOW_MS,
);
console.log('long tasks (page-wide, last window):', JSON.stringify(longTasks));

if (errors.length > 0) {
  console.log('page errors observed:', errors.slice(0, 8));
}

await browser.close();
console.log('probe finished');
