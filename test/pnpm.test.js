// Copyright 2026 Google LLC
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

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { describe, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { $, fs, path, tmpdir } from '../build/index.js'
import { installDeps, parseDeps } from '../build/deps.cjs'

const cli = fileURLToPath(new URL('../build/cli.js', import.meta.url))
const statePath = (cwd) => path.join(cwd, 'node_modules', '.zx-install')
const pkgPath = (cwd, name) =>
  path.join(cwd, 'node_modules', name, 'package.json')
const temp = (t) => {
  const dir = tmpdir()
  t.after(() => fs.remove(dir))
  return dir
}

describe('pnpm no-save installer', () => {
  test('links identical dependencies to one shared virtual store', async (t) => {
    const a = temp(t)
    const b = temp(t)
    await installDeps({ 'is-number': '7.0.0' }, a)
    await installDeps({ 'is-number': '7.0.0' }, b)
    const dependency = (dir) => path.dirname(pkgPath(dir, 'is-number'))
    assert((await fs.lstat(dependency(a))).isSymbolicLink())
    const target = await fs.realpath(dependency(a))
    assert.equal(target, await fs.realpath(dependency(b)))
    assert(path.relative(a, target).startsWith('..'))
    assert.deepEqual(await fs.readdir(a), ['node_modules'])
    assert.deepEqual(await fs.readdir(b), ['node_modules'])
    assert(await fs.pathExists(path.join(statePath(a), 'pnpm-lock.yaml')))
  })

  test('preserves root manifests, locks, and enclosing workspace config', async (t) => {
    const cwd = temp(t)
    const originals = {
      'package.json':
        '{"private":true,"dependencies":{"not-to-install":"0.0.0"}}\n',
      'package-lock.json': 'not a lockfile: leave these exact bytes alone\n',
      'pnpm-lock.yaml': 'not a pnpm lockfile either\n',
      'pnpm-workspace.yaml':
        'packages: ["not-a-project"]\nnodeLinker: hoisted\n',
    }
    for (const [name, contents] of Object.entries(originals)) {
      await fs.writeFile(path.join(cwd, name), contents)
    }
    await installDeps({ 'is-number': '7.0.0' }, cwd)
    for (const [name, contents] of Object.entries(originals)) {
      assert.equal(await fs.readFile(path.join(cwd, name), 'utf8'), contents)
    }
    assert.equal(
      (await fs.readJson(pkgPath(cwd, 'is-number'))).version,
      '7.0.0'
    )
    assert(
      (await fs.lstat(path.dirname(pkgPath(cwd, 'is-number')))).isSymbolicLink()
    )
  })

  test('accumulates dependencies and lets pnpm update requested versions', async (t) => {
    const cwd = temp(t)
    await installDeps({ 'is-number': '7.0.0' }, cwd)
    await fs.writeFile(path.join(cwd, 'node_modules', 'keep-me'), 'untouched')
    await installDeps({ 'is-odd': '3.0.1' }, cwd)
    await installDeps({ 'is-number': '6.0.0' }, cwd)
    assert.equal(
      (await fs.readJson(pkgPath(cwd, 'is-number'))).version,
      '6.0.0'
    )
    assert.equal((await fs.readJson(pkgPath(cwd, 'is-odd'))).version, '3.0.1')
    assert.equal(
      await fs.readFile(path.join(cwd, 'node_modules', 'keep-me'), 'utf8'),
      'untouched'
    )
    assert.deepEqual(
      (await fs.readJson(path.join(statePath(cwd), 'package.json')))
        .dependencies,
      { 'is-number': '6.0.0', 'is-odd': '3.0.1' }
    )
  })

  test('runs the original script, relative imports, and version comments', async (t) => {
    const launch = temp(t)
    const cwd = path.join(temp(t), 'script directory')
    await fs.ensureDir(cwd)
    await fs.writeFile(
      path.join(cwd, 'helper.mjs'),
      'export default "relative"'
    )
    const script = path.join(cwd, 'script.mjs')
    const content = `import isNumber from 'is-number' // @7.0.0
import helper from './helper.mjs'
const getPackage = require
console.log(JSON.stringify({ helper, number: isNumber(42), url: import.meta.url, dir: __dirname, cwd: process.cwd(), version: getPackage('is-number/package.json').version }))`
    assert.deepEqual(parseDeps(content), { 'is-number': '7.0.0' })
    await fs.writeFile(script, content)
    const out = await $({ cwd: launch })`node ${cli} --install ${script}`
    assert.deepEqual(JSON.parse(out.stdout.trim().split('\n').at(-1)), {
      helper: 'relative',
      number: true,
      url: pathToFileURL(script).href,
      dir: cwd,
      cwd: launch,
      version: '7.0.0',
    })
    assert(!(await fs.pathExists(path.join(launch, 'node_modules'))))
    // A second invocation reuses the persistent pnpm importer and dependency.
    const before = await fs.realpath(path.dirname(pkgPath(cwd, 'is-number')))
    await $({ cwd: launch })`node ${cli} -i ${script}`
    assert.equal(
      await fs.realpath(path.dirname(pkgPath(cwd, 'is-number'))),
      before
    )
  })

  test('eval and stdin install beside their cwd without retaining temp scripts', async (t) => {
    const cwd = temp(t)
    const run = $({ cwd })
    const code = `import isNumber from 'is-number' /* @7.0.0 */; console.log(isNumber(42))`
    assert.match((await run`node ${cli} -i -e ${code}`).stdout, /true/)
    const stdin = run`node ${cli} --install -`
    stdin.stdin.end(code)
    assert.match((await stdin).stdout, /true/)
    assert.deepEqual(await fs.readdir(cwd), ['node_modules'])
  })

  test('passes the registry and never runs a script after failed installation', async (t) => {
    const cwd = temp(t)
    const requested = []
    const server = createServer((req, res) => {
      requested.push(req.url)
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{"error":"not found"}')
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise((resolve) => server.close(resolve)))
    const registry = `http://127.0.0.1:${server.address().port}`
    const marker = path.join(cwd, 'ran')
    const code = `import 'zx-no-save-missing-package'; await fs.writeFile(${JSON.stringify(marker)}, 'bad')`
    const out = await $({
      cwd,
    })`node ${cli} -i --registry=${registry} -e ${code}`.nothrow()
    assert.notEqual(out.exitCode, 0)
    assert(requested.some((url) => url.includes('zx-no-save-missing-package')))
    assert(!(await fs.pathExists(marker)))
    assert(!(await fs.pathExists(path.join(statePath(cwd), 'install.lock'))))
    assert(!(await fs.pathExists(path.join(cwd, 'package.json'))))
  })

  test('does not take over an existing pnpm-managed tree', async (t) => {
    const cwd = temp(t)
    const modules = path.join(cwd, 'node_modules', '.modules.yaml')
    await fs.outputFile(modules, 'existing importer metadata')
    await assert.rejects(
      installDeps({ 'is-number': '7.0.0' }, cwd),
      /already managed by another pnpm importer/
    )
    assert.equal(
      await fs.readFile(modules, 'utf8'),
      'existing importer metadata'
    )
    assert(!(await fs.pathExists(statePath(cwd))))
  })

  test('does not overwrite unrecognized private state or steal a lock', async (t) => {
    const cwd = temp(t)
    const manifest = path.join(statePath(cwd), 'package.json')
    await fs.outputFile(manifest, '{"name":"someone-else"}')
    await assert.rejects(
      installDeps({ 'is-number': '7.0.0' }, cwd),
      /Refusing to overwrite/
    )
    assert.equal(await fs.readFile(manifest, 'utf8'), '{"name":"someone-else"}')
    const lock = path.join(statePath(cwd), 'install.lock')
    assert(!(await fs.pathExists(lock)))
    await fs.mkdir(lock)
    await assert.rejects(
      installDeps({ 'is-number': '7.0.0' }, cwd),
      /Another zx dependency install/
    )
    assert(await fs.pathExists(lock))
  })

  test('rejects pnpm versions without the supported external modules layout', async (t) => {
    const cwd = temp(t)
    const bin = path.join(cwd, 'bin')
    await fs.outputFile(path.join(bin, 'pnpm'), '#!/bin/sh\necho 11.19.0\n')
    await fs.chmod(path.join(bin, 'pnpm'), 0o755)
    const out = await $({
      cwd,
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      },
    })`${process.execPath} ${cli} -i -e 'import "is-number"'`.nothrow()
    assert.notEqual(out.exitCode, 0)
    assert.match(out.stderr, /requires pnpm 11.20.0 or newer/)
    assert(!(await fs.pathExists(path.join(statePath(cwd), 'install.lock'))))
  })

  test('retains explicit npm selection through CLI and environment', async (t) => {
    const cwd = temp(t)
    const code = `import isNumber from 'is-number' /* @7.0.0 */; console.log(isNumber(42))`
    const run = $({ cwd })
    assert.match(
      (await run`node ${cli} -i --installer=npm -e ${code}`).stdout,
      /true/
    )
    assert.match(
      (
        await $({
          cwd,
          env: { ...process.env, ZX_INSTALLER: 'npm' },
        })`node ${cli} -i -e ${code}`
      ).stdout,
      /true/
    )
    assert(!(await fs.pathExists(statePath(cwd))))
    assert(!(await fs.pathExists(path.join(cwd, 'package.json'))))
    assert(!(await fs.pathExists(path.join(cwd, 'package-lock.json'))))
  })
})
