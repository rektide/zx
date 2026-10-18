"use strict";
const {
  __export,
  __toCommonJS,
  __async
} = require('./esblib.cjs');


// src/deps.ts
var deps_exports = {};
__export(deps_exports, {
  installDeps: () => installDeps,
  parseDeps: () => parseDeps
});
module.exports = __toCommonJS(deps_exports);
var import_node_module = require("module");
var import_index = require("./index.cjs");
var import_vendor = require("./vendor.cjs");
function installDeps(dependencies, prefix, registry, installerType = "pnpm") {
  return __async(this, null, function* () {
    const installer = installers[installerType];
    const packages = Object.entries(dependencies).map(
      ([name, version]) => `${name}@${version}`
    );
    if (packages.length === 0) return;
    if (!installer) {
      throw new import_index.Fail(
        `Unsupported installer type: ${installerType}. Supported types: ${Object.keys(installers).join(", ")}`
      );
    }
    yield (0, import_index.spinner)(
      `${installerType} i ${packages.join(" ")}`,
      () => installer({ packages, prefix, registry })
    );
  });
}
var installers = {
  npm: (_0) => __async(null, [_0], function* ({ packages, prefix, registry }) {
    const flags = [
      "--no-save",
      "--no-audit",
      "--no-fund",
      prefix && `--prefix=${prefix}`,
      registry && `--registry=${registry}`
    ].filter(Boolean);
    yield import_index.$`npm install ${flags} ${packages}`.nothrow();
  }),
  pnpm: (_0) => __async(null, [_0], function* ({ packages, prefix, registry }) {
    var _a;
    const modulesDir = import_index.path.resolve(prefix || import_index.$.cwd || ".", "node_modules");
    const stateDir = import_index.path.join(modulesDir, ".zx-install");
    const manifestPath = import_index.path.join(stateDir, "package.json");
    if (!(yield import_index.fs.pathExists(manifestPath)) && (yield import_index.fs.pathExists(import_index.path.join(modulesDir, ".modules.yaml")))) {
      throw new import_index.Fail(
        "node_modules is already managed by another pnpm importer. Install with the project package manager and run zx without --install, or use a separate script directory."
      );
    }
    yield import_index.fs.ensureDir(stateDir);
    const lock = import_index.path.join(stateDir, "install.lock");
    try {
      yield import_index.fs.mkdir(lock);
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      throw new import_index.Fail(
        `Another zx dependency install holds ${lock}. If the installer was killed, remove this lock only after checking that no install is running.`
      );
    }
    try {
      if (yield import_index.fs.pathExists(manifestPath)) {
        const manifest = yield import_index.fs.readJson(manifestPath);
        if (manifest.name !== "zx-script-dependencies" || manifest.private !== true) {
          throw new import_index.Fail(
            `Refusing to overwrite an unrecognized ${manifestPath}`
          );
        }
      } else {
        yield import_index.fs.writeJson(manifestPath, {
          name: "zx-script-dependencies",
          private: true
        });
      }
      yield import_index.fs.writeFile(
        import_index.path.join(stateDir, "pnpm-workspace.yaml"),
        import_index.YAML.stringify({
          packages: [],
          modulesDir,
          nodeLinker: "isolated",
          virtualStoreType: "global",
          enableGlobalVirtualStore: true,
          // pnpm 12's frozen fast path ignores modulesDir when relinking.
          preferFrozenLockfile: false
        })
      );
      const run = (0, import_index.$)({ cwd: stateDir });
      const version = (yield run`pnpm --version`.quiet().nothrow(false)).stdout;
      const [major, minor, patch] = ((_a = version.trim().match(/^(\d+)\.(\d+)\.(\d+)/)) == null ? void 0 : _a.slice(1).map(Number)) || [];
      if (!(major > 10 || major === 10 && (minor > 12 || minor === 12 && patch >= 1))) {
        throw new import_index.Fail("The pnpm installer requires pnpm 10.12.1 or newer");
      }
      const flags = [registry && `--registry=${registry}`].filter(Boolean);
      yield run`pnpm add --save-exact ${flags} ${packages}`.nothrow(false);
    } finally {
      yield import_index.fs.rmdir(lock);
    }
  })
};
var builtins = new Set(import_node_module.builtinModules);
var nameRe = new RegExp("^(?<name>(@[a-z\\d-~][\\w-.~]*\\/)?[a-z\\d-~][\\w-.~]*)\\/?.*$", "i");
var versionRe = new RegExp("^@(?<version>[~^]?(v?[\\dx*]+([-.][\\d*a-z-]+)*))", "i");
function parseDeps(content) {
  return (0, import_vendor.depseek)(content + "\n", { comments: true }).reduce((m, { type, value }, i, list) => {
    if (type === "dep") {
      const meta = list[i + 1];
      const name = parsePackageName(value);
      const version = (meta == null ? void 0 : meta.type) === "comment" && parseVersion(meta == null ? void 0 : meta.value.trim()) || "latest";
      if (name) m[name] = version;
    }
    return m;
  }, {});
}
function parsePackageName(path2) {
  var _a, _b;
  if (!path2 || path2.includes(":")) return;
  const name = (_b = (_a = nameRe.exec(path2)) == null ? void 0 : _a.groups) == null ? void 0 : _b.name;
  if (name && !builtins.has(name)) return name;
}
function parseVersion(line) {
  var _a, _b;
  return ((_b = (_a = versionRe.exec(line)) == null ? void 0 : _a.groups) == null ? void 0 : _b.version) || "latest";
}
/* c8 ignore next 100 */
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  installDeps,
  parseDeps
});