// Copyright 2021 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { builtinModules } from 'node:module'
import { $, spinner, Fail, fs, path, YAML } from './index.ts'
import { depseek } from './vendor.ts'

/**
 * Install script dependencies without changing the project manifest
 * @param dependencies object of dependencies
 * @param prefix path to the directory where dependencies should be installed
 * @param registry custom npm registry URL when installing dependencies
 * @param installerType package manager: pnpm (default) or npm
 */
export async function installDeps(
  dependencies: Record<string, string>,
  prefix?: string,
  registry?: string,
  installerType = 'pnpm'
): Promise<void> {
  const installer = installers[installerType]
  const packages = Object.entries(dependencies).map(
    ([name, version]) => `${name}@${version}`
  )
  if (packages.length === 0) return
  if (!installer) {
    throw new Fail(
      `Unsupported installer type: ${installerType}. Supported types: ${Object.keys(installers).join(', ')}`
    )
  }

  await spinner(`${installerType} i ${packages.join(' ')}`, () =>
    installer({ packages, prefix, registry })
  )
}

type DepsInstaller = (opts: {
  packages: string[]
  registry?: string
  prefix?: string
}) => Promise<void>

const installers: Record<any, DepsInstaller> = {
  npm: async ({ packages, prefix, registry }) => {
    const flags = [
      '--no-save',
      '--no-audit',
      '--no-fund',
      prefix && `--prefix=${prefix}`,
      registry && `--registry=${registry}`,
    ].filter(Boolean)
    await $`npm install ${flags} ${packages}`.nothrow()
  },
  pnpm: async ({ packages, prefix, registry }) => {
    const modulesDir = path.resolve(prefix || $.cwd || '.', 'node_modules')
    const stateDir = path.join(modulesDir, '.zx-install')
    const manifestPath = path.join(stateDir, 'package.json')

    // Never let pnpm purge/recreate a tree belonging to a different importer.
    if (
      !(await fs.pathExists(manifestPath)) &&
      (await fs.pathExists(path.join(modulesDir, '.modules.yaml')))
    ) {
      throw new Fail(
        'node_modules is already managed by another pnpm importer. Install with the project package manager and run zx without --install, or use a separate script directory.'
      )
    }

    await fs.ensureDir(stateDir)
    const lock = path.join(stateDir, 'install.lock')
    try {
      await fs.mkdir(lock)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      throw new Fail(
        `Another zx dependency install holds ${lock}. If the installer was killed, remove this lock only after checking that no install is running.`
      )
    }

    try {
      if (await fs.pathExists(manifestPath)) {
        const manifest = await fs.readJson(manifestPath)
        if (
          manifest.name !== 'zx-script-dependencies' ||
          manifest.private !== true
        ) {
          throw new Fail(
            `Refusing to overwrite an unrecognized ${manifestPath}`
          )
        }
      } else {
        await fs.writeJson(manifestPath, {
          name: 'zx-script-dependencies',
          private: true,
        })
      }

      // The private workspace stops discovery of enclosing user workspaces.
      // Absolute modulesDir is required by pnpm 12 for direct dependency links.
      await fs.writeFile(
        path.join(stateDir, 'pnpm-workspace.yaml'),
        YAML.stringify({
          packages: [],
          modulesDir,
          nodeLinker: 'isolated',
          virtualStoreType: 'global',
          enableGlobalVirtualStore: true,
          // pnpm 12's frozen fast path ignores modulesDir when relinking.
          preferFrozenLockfile: false,
        })
      )
      const run = $({ cwd: stateDir })
      const version = (await run`pnpm --version`.quiet().nothrow(false)).stdout
      const [major, minor] =
        version
          .trim()
          .match(/^(\d+)\.(\d+)\./)
          ?.slice(1)
          .map(Number) || []
      if (!(major > 11 || (major === 11 && minor >= 20))) {
        throw new Fail('The pnpm installer requires pnpm 11.20.0 or newer')
      }

      const flags = [registry && `--registry=${registry}`].filter(Boolean)
      // pnpm adds to its own persistent importer, not the user's manifest.
      // Earlier script dependencies stay installed; pnpm owns all linking.
      await run`pnpm add --save-exact ${flags} ${packages}`.nothrow(false)
    } finally {
      await fs.rmdir(lock)
    }
  },
}

const builtins = new Set(builtinModules)

const nameRe = /^(?<name>(@[a-z\d-~][\w-.~]*\/)?[a-z\d-~][\w-.~]*)\/?.*$/i
const versionRe = /^@(?<version>[~^]?(v?[\dx*]+([-.][\d*a-z-]+)*))/i

export function parseDeps(content: string): Record<string, string> {
  return depseek(content + '\n', { comments: true }).reduce<
    Record<string, string>
  >((m, { type, value }, i, list) => {
    if (type === 'dep') {
      const meta = list[i + 1]
      const name = parsePackageName(value)
      const version =
        (meta?.type === 'comment' && parseVersion(meta?.value.trim())) ||
        'latest'
      if (name) m[name] = version
    }
    return m
  }, {})
}

function parsePackageName(path?: string): string | undefined {
  if (!path || path.includes(':')) return

  const name = nameRe.exec(path)?.groups?.name
  if (name && !builtins.has(name)) return name
}

function parseVersion(line: string) {
  return versionRe.exec(line)?.groups?.version || 'latest'
}
