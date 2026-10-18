---
type: ImplementationNote
title: pnpm no-save script dependencies
description: Fork contract and implementation boundary for installing script dependencies through pnpm's shared virtual store.
resource: /doc/pnpm/README.md
status: implemented
generated:
  at: 2026-10-18
  by: model:openai/gpt-6.1-sol#xhigh
sources:
  - resource: opencode://ses_eae9fc4d3fferZZ75EQBhzFMTL
    title: Implementing and verifying the pnpm no-save shared-store installer in a separate first-party fork
  - resource: https://pnpm.io/settings/node-modules
    title: pnpm modulesDir, isolated linker, and global virtual store settings
  - resource: /src/deps.ts
    title: Upstream installer interface and inline version parsing
  - resource: /src/cli.ts
    title: Original-path script execution and install dispatch
---

# pnpm no-save script dependencies

This fork makes `zx --install script.mjs` use pnpm. Imports and trailing
`@version` comments retain their existing meaning; unversioned imports request
`latest`. `--installer=npm` selects the original npm installer. The same selection
is available through `ZX_INSTALLER` and the fourth `installDeps()` argument.

## Layout and ownership

The script still runs at its original path, with ordinary `node_modules` beside
it. Relative imports, `import.meta.url`, and zx's existing eval/stdin behavior
are unchanged. There is no script relocation or custom dependency linker.

pnpm needs a manifest, and `pnpm add --no-save` is not supported by pnpm 12.7.0.
Instead, zx keeps its own importer in `node_modules/.zx-install/`:

- A private `package.json` records accumulated script dependencies.
- `pnpm-workspace.yaml` isolates this importer from enclosing workspaces and
  sets **absolute** `modulesDir`, `nodeLinker: isolated`, and
  `virtualStoreType: global` (with its compatible boolean alias). It disables
  `preferFrozenLockfile`: pnpm 12.7.0's frozen fast path otherwise updates the
  private manifest while incorrectly relinking under the importer instead of
  the external modules directory. The version-change regression test catches
  this; pnpm's normal resolver/linker handles it correctly.
- pnpm owns resolution, its private lockfile, dependency links, and bin links.
  `pnpm add --save-exact` updates requested versions and preserves earlier
  dependencies in the private importer. zx does not prune old script imports.

No user-facing `package.json`, `package-lock.json`, `pnpm-lock.yaml`, or workspace
file is created or modified. The private state, dependencies, and pnpm cache
persist. Identical graphs share pnpm's global virtual store; package files are
materialized there once rather than once per script directory.

This is a script importer, not a replacement for a project's normal install.
An existing project manifest and lockfiles are left alone. Existing unmanaged
modules are left to pnpm's normal collision handling, but zx refuses to take
over a pnpm-managed `node_modules` that belongs to another importer. Install
through that project's own package manager and run zx without `--install`, or
use a separate script directory. Do not alternate project pnpm installs with
zx's private importer against the same `node_modules`.

## Operational boundaries

- pnpm must be available on `PATH` and support the global virtual store
  (pnpm 10.12.1 or newer). Initial probes used installed pnpm 12.7.0 and 11.20.0.
- pnpm's standard build approval policy applies. zx does not grant packages
  permission to run dependency lifecycle scripts.
- `--registry` is passed to pnpm. User/global pnpm authentication and settings
  apply; enclosing project workspace configuration is deliberately not loaded.
- A fail-fast install lock serializes use of the private importer. A killed
  process may leave `node_modules/.zx-install/install.lock`; remove it manually
  only after ensuring no install is running.
- pnpm errors stop execution; zx never runs the script after a failed install.

## Verification

Focused tests in `test/pnpm.test.js` and the existing `test/deps.test.js` pass
(20 tests) with Node 26.6.0 and pnpm 12.7.0. They cover shared-store targets,
byte-preserved root manifests/lockfiles, enclosing workspace isolation, retained
dependencies, changed versions, original script paths and relative imports,
eval/stdin, reruns, registry failures, importer ownership, install locks,
minimum pnpm versions, and explicit npm selection. `test:types`, `test:license`,
changed-file formatting, and `test:size` also pass. Size budgets were refreshed
with the upstream `build:size-limit` script for the added installer and README
notice; no runtime dependency was added.

Build through the upstream `npm run build` command. Its `test:unit` invocation
uses `--experimental-transform-types`, removed by local Node 26; the full suite
was instead run with installed Node 24.10.0. That run had 267 passes, eight
failures, and one skip: five color-sensitive log assertions, two existing
`chalk.level` export expectations, and one nonstandard-extension error-text
expectation. The six log/extension failures reproduce against the original
generated checkout, whose original build also exposes `chalk.level` as
`undefined`. `FORCE_COLOR=3` makes the five log tests pass. These unrelated
upstream/environment issues are not changed by this fork.

The fork itself need not migrate its build toolchain to pnpm to use pnpm for
script dependencies. Local npm-installed build dependencies were privately
copied from the generated zx checkout; its unrelated edits were not copied.

Upstream references: [CLI install behavior](../../docs/cli.md#--install) and
[dependency parser and installers](../../src/deps.ts).
