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
 * Every success response additionally carries `dsh: { version, state }` — the
 * running DSH product version and its compatibility with the supported range
 * ('ok' | 'old' | 'new' | 'unknown'). DSH does not enforce `engines.dsh`
 * anywhere, so the host half reports the mismatch itself and the settings
 * card warns the user (once-only console warning + hover-tip icon).
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
import { resolve } from 'node:path'

export const name = 'toolfold'
export const inject = ['settings', 'webServer']

// Plain namespace id. Since DSH 0.1.2-rc.1 the settings service owns namespace
// validation (lowercase hyphenated) and @deepseek-ai/dsh-settings no longer
// ships the settingsNamespace() helper, so a bare string is the contract.
const NS = 'toolfold'
const API_PATH = '/api/dsh-toolfold/settings'
const FIELDS = ['enabled', 'durMs', 'keepThink', 'thinkAuto', 'splitThink', 'stats']

const SCHEMA = z.object({
  enabled: z.boolean().default(true),
  durMs: z.number().step(10).min(0).max(2000).default(240),
  keepThink: z.boolean().default(false),
  thinkAuto: z.boolean().default(true),
  splitThink: z.boolean().default(true),
  stats: z.boolean().default(false),
})

// Supported DSH product range. MUST mirror package.json `engines.dsh`
// (">=0.1.2-rc.1 <0.1.3"); DSH itself never validates that field, so this
// host half reports the running version + state to the settings card.
const DSH_MIN = '0.1.2-rc.1'
const DSH_MAX = '0.1.3'

/** Parse "v1.2.3-rc.4+build" into comparable parts; null on junk. */
function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(value))
  if (!match) return null
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] === undefined ? null : match[4].split('.'),
  }
}

/** Compare two parsed versions (semver precedence, prerelease-aware): -1/0/1. */
function compareParsed(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] < b.core[i] ? -1 : 1
  }
  if (a.pre === null && b.pre === null) return 0
  if (a.pre === null) return 1 // a release outranks a prerelease of the same core
  if (b.pre === null) return -1
  const len = Math.max(a.pre.length, b.pre.length)
  for (let i = 0; i < len; i++) {
    const x = a.pre[i]
    const y = b.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) {
      const dx = Number(x)
      const dy = Number(y)
      if (dx !== dy) return dx < dy ? -1 : 1
    } else if (xn !== yn) {
      return xn ? -1 : 1 // numeric prerelease ids sort below alphanumeric
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
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

/** Running DSH vs the supported range: 'ok' | 'old' | 'new' | 'unknown'. */
function dshCompat() {
  const version = dshVersion()
  if (version === null) return { version: null, state: 'unknown' }
  const parsed = parseVersion(version)
  if (parsed === null) return { version, state: 'unknown' }
  const min = parseVersion(DSH_MIN)
  const max = parseVersion(DSH_MAX)
  let state = 'ok'
  if (compareParsed(parsed, min) < 0) state = 'old'
  else if (compareParsed(parsed, max) >= 0) state = 'new'
  return { version, state }
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
        value,
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
