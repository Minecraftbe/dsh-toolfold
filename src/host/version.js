/**
 * dsh-toolfold — version-range helpers (host side, zero dependencies).
 *
 * The single source of truth for the supported DSH product range is this
 * package's own `engines.dsh` field (an npm-style range such as
 * ">=0.1.2-rc.1 <0.1.3 || >=0.1.5-rc.1 <0.1.6"). The build stamps that
 * field into the host artifact via tsdown `define` (__DSH_ENGINES__, see
 * tsdown.config.mjs) and the host half judges the running DSH with the
 * matcher below — no range is hardcoded anywhere, so widening support is
 * a one-line package.json edit + rebuild.
 *
 * Supported range grammar (the subset npm engines ranges actually use):
 *   range      := branch ("||" branch)*
 *   branch     := comparator ((" " | ",") comparator)*
 *   comparator := (">=" | "<=" | ">" | "<" | "=" | "==")? version
 * A bare version means "=". Anything else (caret/tilde/x-ranges, hyphen
 * ranges, junk) invalidates its branch; a range with no valid branch
 * matches nothing and the caller reports 'unknown' instead of crying wolf.
 *
 * Prerelease gating follows npm semver: a prerelease running version only
 * satisfies a branch that names a prerelease on the same
 * [major, minor, patch] tuple (e.g. 0.1.5-rc.1 satisfies
 * ">=0.1.5-rc.1 <0.1.6", but 0.1.3-rc.1 does NOT satisfy
 * ">=0.1.2-rc.1 <0.1.3").
 */

/** Parse "v1.2.3-rc.4+build" into comparable parts; null on junk. */
export function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(value))
  if (!match) return null
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] === undefined ? null : match[4].split('.'),
  }
}

/** Compare two parsed versions (semver precedence, prerelease-aware): -1/0/1. */
export function compareParsed(a, b) {
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
 * Parse one "||" branch into comparators; null when the branch is unusable.
 * The operator may be separated from its version by whitespace (npm
 * semver tolerates ">= 1.2.3"), so comparators are matched globally and
 * the gaps between matches must contain only whitespace/commas — anything
 * else invalidates the branch.
 */
function parseBranch(text) {
  const src = String(text).trim()
  if (src === '') return null
  const re = /(>=|<=|>|<|==|=)?\s*(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)/g
  const comps = []
  let pos = 0
  let m
  while ((m = re.exec(src)) !== null) {
    if (m[0] === '') {
      re.lastIndex++
      continue
    }
    if (!/^[\s,]*$/.test(src.slice(pos, m.index))) return null
    const v = parseVersion(m[2])
    if (v === null) return null
    comps.push({ op: m[1] === undefined || m[1] === '==' ? '=' : m[1], v })
    pos = m.index + m[0].length
  }
  if (!/^[\s,]*$/.test(src.slice(pos))) return null
  return comps.length === 0 ? null : comps
}

/** Parse a full range string into its valid branches; [] when unusable. */
export function parseEnginesRange(rangeStr) {
  if (typeof rangeStr !== 'string') return []
  const branches = []
  for (const part of rangeStr.split('||')) {
    const comps = parseBranch(part.trim())
    if (comps !== null) branches.push(comps)
  }
  return branches
}

function testComp(op, cmp) {
  switch (op) {
    case '>=': return cmp >= 0
    case '<=': return cmp <= 0
    case '>': return cmp > 0
    case '<': return cmp < 0
    default: return cmp === 0 // '='
  }
}

function sameCore(a, b) {
  return a.core[0] === b.core[0] && a.core[1] === b.core[1] && a.core[2] === b.core[2]
}

/** npm semver prerelease gate for one branch. */
function gateOk(comps, ver) {
  if (ver.pre === null) return true
  return comps.some((c) => c.v.pre !== null && sameCore(c.v, ver))
}

/** True when the parsed version satisfies at least one branch. */
export function satisfiesEngines(parsed, branches) {
  for (const comps of branches) {
    let ok = true
    for (const c of comps) {
      if (!testComp(c.op, compareParsed(parsed, c.v))) {
        ok = false
        break
      }
    }
    if (ok && gateOk(comps, parsed)) return true
  }
  return false
}

/** Lowest lower bound across all branches (>=, >, =); null when unbounded. */
function lowestFloor(branches) {
  let floor = null
  for (const comps of branches) {
    for (const c of comps) {
      if (c.op === '>=' || c.op === '>' || c.op === '=') {
        if (floor === null || compareParsed(c.v, floor) < 0) floor = c.v
      }
    }
  }
  return floor
}

/**
 * Judge a running version against a raw engines range string:
 * 'ok' | 'old' | 'new' | 'unknown'. Never throws. Below every supported
 * floor → 'old'; outside anywhere else (including between "||" gaps) →
 * 'new'; unusable input on either side → 'unknown' (fail silent, never
 * false-alarm).
 */
export function compatFor(version, rangeStr) {
  const parsed = parseVersion(version)
  if (parsed === null) return 'unknown'
  const branches = parseEnginesRange(rangeStr)
  if (branches.length === 0) return 'unknown'
  if (satisfiesEngines(parsed, branches)) return 'ok'
  const floor = lowestFloor(branches)
  if (floor !== null && compareParsed(parsed, floor) < 0) return 'old'
  return 'new'
}
