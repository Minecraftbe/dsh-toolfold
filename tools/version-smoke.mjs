/**
 * Version-range smoke: the host half judges the running DSH against this
 * package's own `engines.dsh` (the single source of truth), so this probe
 * reads that same field and asserts the verdict matrix — including the
 * regression that started it (0.1.5-rc.1 must be ok, not "new").
 *
 * Usage: node tools/version-smoke.mjs  (or: pnpm test:version)
 */
import { readFileSync } from 'node:fs'
import { compatFor, parseEnginesRange, satisfiesEngines, parseVersion } from '../src/host/version.js'

let failures = 0
function check(name, cond, detail) {
  if (cond) {
    console.log('ok - ' + name)
  } else {
    failures++
    console.error('FAIL - ' + name + (detail !== undefined ? ' :: ' + detail : ''))
  }
}

const RANGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).engines.dsh
check('engines.dsh is a non-empty string', typeof RANGE === 'string' && RANGE !== '', JSON.stringify(RANGE))

// Verdict matrix against the live package.json range.
const cases = [
  ['0.1.2-rc.0', 'old'], // below every floor
  ['0.1.2-rc.1', 'ok'], // first floor, inclusive
  ['0.1.2', 'ok'], // release above a prerelease floor
  ['0.1.3-rc.1', 'new'], // prerelease gate: the 0.1.3 tuple is never named
  ['0.1.3', 'new'], // "||" gap
  ['0.1.4', 'new'], // "||" gap
  ['0.1.5-rc.0', 'new'], // below the second floor but above the first: new, not old
  ['0.1.5-rc.1', 'ok'], // the regression: second floor, inclusive
  ['0.1.5', 'ok'],
  ['0.1.6-rc.1', 'new'], // prerelease past the ceiling
  ['0.1.6', 'new'],
  ['0.2.0', 'new'],
  ['1.0.0', 'new'],
  ['junk', 'unknown'],
  [null, 'unknown'],
]
for (const [version, want] of cases) {
  const got = compatFor(version, RANGE)
  check(`compatFor(${String(version)}) === ${want}`, got === want, `got ${got} (range: ${RANGE})`)
}

// Fail silent, never false-alarm, on unusable input.
check('garbage range judges nothing', compatFor('0.1.5-rc.1', '^^junk') === 'unknown')
check('empty range judges nothing', compatFor('0.1.5-rc.1', '') === 'unknown')
check('missing range judges nothing', compatFor('0.1.5-rc.1', undefined) === 'unknown')

// The matcher still handles the building blocks on their own.
check('single range still works', compatFor('0.1.2', '>=0.1.2-rc.1 <0.1.3') === 'ok')
check('bare version means equality', compatFor('0.1.5-rc.1', '0.1.5-rc.1') === 'ok')
check(
  'comma separators behave like spaces',
  compatFor('0.1.2', '>=0.1.2-rc.1, <0.1.3') === 'ok',
)
const parsed = parseVersion('0.1.5-rc.1')
check(
  'prerelease gate: unnamed tuple does not satisfy',
  satisfiesEngines(parsed, parseEnginesRange('>=0.1.2-rc.1 <0.1.3')) === false,
)

if (failures > 0) {
  console.error(`${failures} FAILURE(S)`)
  process.exit(1)
}
console.log('ALL VERSION CHECKS PASSED')
