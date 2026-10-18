---
type: ImplementationNote
title: pnpm no-save script dependencies
description: Fork contract and implementation boundary for installing script dependencies through pnpm's shared virtual store.
resource: /doc/pnpm/README.md
status: implementation-in-progress
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
  `virtualStoreType: global` (with its compatible boolean alias).
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

The implementation's focused tests belong in `test/deps.test.js`; build through
the upstream `npm run build` command. The fork itself need not migrate its build
toolchain to pnpm to use pnpm for script dependencies. The local npm-installed
build dependencies were privately copied from the generated zx checkout; its
unrelated edits were not copied.

Upstream references: [CLI install behavior](../../docs/cli.md#--install) and
[dependency parser and installers](../../src/deps.ts).
