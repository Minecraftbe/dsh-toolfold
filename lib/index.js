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
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'

export const name = 'toolfold'
export const inject = ['settings', 'webServer']

const NS = settingsNamespace('toolfold')
const API_PATH = '/api/dsh-toolfold/settings'
const FIELDS = ['durMs', 'keepThink', 'stats']

const SCHEMA = z.object({
  durMs: z.number().step(10).min(0).max(2000).default(240),
  keepThink: z.boolean().default(false),
  stats: z.boolean().default(false),
})

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
        json(res, 200, snapshot())
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
          .then(() => json(res, 200, snapshot()))
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
