#!/usr/bin/env node
/**
 * One-click install / uninstall of dsh-toolfold into a dsh profile through
 * the official plugin CLI:
 *
 *   dsh plugin --profile <name> add <this-package>
 *
 * which installs the package with pnpm and — seeing the package's
 * `dsh.bundle.patch` declaration — automatically appends `dsh-toolfold` to
 * the profile's `dsh.profile.bundles` stack. No profile file edits.
 *
 * Usage:
 *   node scripts/install-dsh.cjs            # install (default profile: web)
 *   node scripts/install-dsh.cjs uninstall  # remove
 *   DSH_PROFILE=headless node scripts/install-dsh.cjs
 *
 * After install, restart the dsh process: bundle layers are composed at boot.
 */
const { spawnSync } = require('node:child_process')
const { join } = require('node:path')

const profile = process.env.DSH_PROFILE || 'web'
const uninstall = process.argv.includes('uninstall')
// Forward slashes keep the spec unambiguous when cmd/PowerShell re-quotes it.
const pkgSpec = join(__dirname, '..').replace(/\\/g, '/')
// `pnpm add` takes a path spec; `pnpm remove` takes the dependency NAME.
const target = uninstall ? 'dsh-toolfold' : pkgSpec

/** Run one dsh CLI invocation; on Windows go through PowerShell so the dsh.ps1 / pnpm.ps1 shims resolve. */
function runDsh(args) {
  const quoted = args.map((arg) => "'" + String(arg).replace(/'/g, "''") + "'").join(' ')
  const result = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `dsh ${quoted}`], { stdio: 'inherit' })
    : spawnSync('dsh', args, { stdio: 'inherit' })
  if (result.error !== undefined) {
    console.error(`dsh CLI not found on PATH (${result.error.message}); install pnpm and put the dsh launcher on PATH`)
    return 127
  }
  return result.status ?? 1
}

const verb = uninstall ? 'remove' : 'add'
const status = runDsh(['plugin', '--profile', profile, verb, target])
if (status !== 0) {
  console.error(`dsh plugin ${verb} failed (exit ${status})`)
  process.exit(status)
}
if (uninstall) {
  console.log(`dsh-toolfold removed from profile "${profile}". Restart dsh to unload it.`)
} else {
  console.log(`dsh-toolfold installed into profile "${profile}" and added to dsh.profile.bundles.`)
  console.log('Restart dsh (the GUI process) to activate — bundle layers are composed at boot.')
}
