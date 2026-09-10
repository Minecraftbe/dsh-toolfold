/**
 * dsh-toolfold — HOST half.
 *
 * Registers the `toolfold` settings namespace in the DSH settings service
 * (persisted in `~/.dsh/settings.yaml`, the same document every product and
 * family plugin uses) and serves the browser half through one same-origin
 * JSON route:
 *
 *   GET  /api/dsh-toolfold/settings → { ok, value: { value, revision, writable } }
 *   POST /api/dsh-toolfold/settings → body { op: 'set'|'unset', field, value?,
 *                                      expectedRevision? }
 *                                   → { ok, value: { value, revision, writable } }
 *
 * Every success response additionally carries `dsh: { version, state, range }` —
 * the running DSH product version, its compatibility with the supported
 * range ('ok' | 'old' | 'new' | 'unknown'), and the raw `engines.dsh`
 * requirement the verdict was judged against. DSH does not enforce
 * `engines.dsh` anywhere, so the host half reports the mismatch itself
 * and the settings card warns the user (once-only console warning +
 * hover-tip icon quoting the live range).
 *
 * The browser half prefers the official `settingsScope` transport when the
 * deployment exposes this namespace, then this route, then browser
 * localStorage as a degraded fallback. `value` is always the fully resolved
 * section (schema defaults + composition base + the user's settings.yaml
 * overrides), so the client never re-implements the resolution.
 *
 * The same package also declares `dsh.bundle.patch` (see cordis.patch.yml),
 * which makes `dsh plugin --profile <name> add <this package>` install AND
 * mount both halves in one command.
 */
import z from 'schemastery'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compatFor } from './version.js'

export const name = 'toolfold'
export const inject = ['settings', 'webServer']

// Plain namespace id. Since DSH 0.1.2-rc.1 the settings service owns namespace
// validation (lowercase hyphenated) and @deepseek-ai/dsh-settings no longer
// ships the settingsNamespace() helper, so a bare string is the contract.
const NS = 'toolfold'
const API_PATH = '/api/dsh-toolfold/settings'
const FIELDS = ['enabled', 'durMs', 'thinkMode', 'keepThink', 'thinkAuto', 'splitThink', 'stats']
// thinkAuto/keepThink are DEPRECATED aliases for thinkMode (kept validated so
// old sections, old clients, and downgraded plugin versions keep working;
// the engine only reads the resolved thinkMode below).

const SCHEMA = z.object({
  enabled: z.boolean().default(true),
  durMs: z.number().step(10).min(0).max(2000).default(240),
  // No .default(): an unset thinkMode must stay unset so the snapshot can
  // derive it from the deprecated keys (a default would mask them).
  thinkMode: z.union([z.const('auto'), z.const('keep'), z.const('hide')]),
  keepThink: z.boolean().default(false),
  thinkAuto: z.boolean().default(true),
  splitThink: z.boolean().default(true),
  stats: z.boolean().default(false),
})

/**
 * Resolve the canonical think mode for one section. An explicitly set,
 * valid thinkMode wins; otherwise derive it from the deprecated keys so
 * pre-merge preferences survive the upgrade; default 'auto'. Total —
 * never throws. (Client twin: resolveThinkMode in src/client/settings.js.)
 */
function resolveThinkMode(section) {
  var mode = section !== undefined && section !== null ? section.thinkMode : undefined
  if (mode === 'keep' || mode === 'hide' || mode === 'auto') return mode
  if (section !== undefined && section !== null && section.thinkAuto === false) {
    return section.keepThink === true ? 'keep' : 'hide'
  }
  return 'auto'
}

// Supported DSH product range: read from this package's own `engines.dsh`
// at startup — that field is the single source of truth, so widening
// support is a package.json edit with no code change. DSH itself never
// validates that field, so this host half reports the running version +
// state to the settings card. `lib/index.js` lives one level below the
// package root while `src/host/index.js` lives two levels below it, so
// both layouts are probed and the hit must belong to `dsh-toolfold`.
// Cached; null when unreadable (the report then stays 'unknown' — fail
// silent, never false-alarm).
let cachedEnginesRange
function ownEnginesRange() {
  if (cachedEnginesRange !== undefined) return cachedEnginesRange
  cachedEnginesRange = null
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    for (const rel of ['../package.json', '../../package.json']) {
      try {
        const pkg = JSON.parse(readFileSync(resolve(here, rel), 'utf8'))
        const range = pkg && pkg.name === 'dsh-toolfold' && pkg.engines !== null && typeof pkg.engines === 'object'
          ? pkg.engines.dsh
          : undefined
        if (typeof range === 'string' && range.trim() !== '') {
          cachedEnginesRange = range.trim()
          break
        }
      } catch {
        // Try the next layout.
      }
    }
  } catch {
    // No module URL (bundled oddly): stay unknown.
  }
  return cachedEnginesRange
}

/**
 * The @deepseek-ai/dsh version this process was launched from: process.argv[1]
 * is the CLI's entry, and module resolution from that file reaches the
 * @deepseek-ai/dsh package.json it belongs to. Null when undetectable
 * (workers, dev launchers without a resolvable package).
 */
let cachedDshVersion
function dshVersion() {
  if (cachedDshVersion !== undefined) return cachedDshVersion
  cachedDshVersion = null
  try {
    const entry = process.argv && process.argv[1]
    if (!entry) return cachedDshVersion
    const req = createRequire(resolve(entry))
    const pkgPath = req.resolve('@deepseek-ai/dsh/package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    if (pkg && pkg.name === '@deepseek-ai/dsh' && typeof pkg.version === 'string' && pkg.version !== '') {
      cachedDshVersion = pkg.version
    }
  } catch (error) {
    // Not launched from a resolvable @deepseek-ai/dsh: stay unknown.
  }
  return cachedDshVersion
}

/**
 * Running DSH vs the supported range (see ./version.js): the report the
 * settings card renders its warning icon from. `range` is the raw
 * `engines.dsh` string so the card can quote the live requirement instead
 * of hardcoding it: { version, state: 'ok'|'old'|'new'|'unknown', range }.
 */
function dshCompat() {
  const version = dshVersion()
  const range = ownEnginesRange()
  if (version === null || range === null) return { version, state: 'unknown', range }
  return { version, state: compatFor(version, range), range }
}

/** Write one JSON response. */
function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Read a JSON request body (bounded). */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new Error('body-too-large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid-json'))
      }
    })
    req.on('error', reject)
  })
}

export function apply(ctx) {
  // Fiber-scoped registration: removed when this plugin is stopped/removed.
  ctx.settings.register(NS, SCHEMA, { base: {} })

  /** Current resolved section + revision + writability, as one JSON view. */
  const snapshot = () => {
    let value = ctx.settings.get(NS)
    let revision
    for (const descriptor of ctx.settings.describe()) {
      if (descriptor.ns === NS) {
        value = descriptor.value
        revision = descriptor.revision
        break
      }
    }
    return {
      ok: true,
      value: {
        value: { ...value, thinkMode: resolveThinkMode(value) },
        ...(revision === undefined ? {} : { revision }),
        writable: ctx.settings.writable,
      },
    }
  }

  const handler = (req, res) => {
    if (req.method === 'GET') {
      try {
        json(res, 200, { ...snapshot(), dsh: dshCompat() })
      } catch (error) {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
      return
    }
    if (req.method === 'POST') {
      readJsonBody(req).then((body) => {
        const field = String(body?.field ?? '')
        if (!FIELDS.includes(field)) {
          json(res, 400, { ok: false, error: 'invalid-field' })
          return
        }
        const op = body?.op === 'unset' ? 'unset' : 'set'
        const ops = op === 'unset'
          ? [{ op: 'unset', path: [field] }]
          : [{ op: 'set', path: [field], value: body.value }]
        const expectedRevision = typeof body?.expectedRevision === 'number' ? body.expectedRevision : undefined
        return ctx.settings.mutate(NS, ops, expectedRevision)
          .then(() => json(res, 200, { ...snapshot(), dsh: dshCompat() }))
          .catch((error) => json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) }))
      }, (error) => {
        json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      })
      return
    }
    json(res, 405, { ok: false, error: 'method-not-allowed' })
  }

  ctx.effect(() => {
    const dispose = ctx.webServer.register({ kind: 'exact', path: API_PATH, handler })
    return () => dispose()
  })
}
