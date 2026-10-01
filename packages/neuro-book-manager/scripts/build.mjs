import {copyFile, mkdir, readFile, rm} from "node:fs/promises";
import {createRequire} from "node:module";
import {dirname, resolve} from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const outdir = resolve(packageRoot, "dist");
export const blessedTerminfoNames = ["linux", "windows-ansi", "xterm", "xterm-256color"];

export async function createBlessedRuntimePlugin(packageJsonPath) {
    const requireFromPackage = createRequire(packageJsonPath);
    const blessedPackageRoot = dirname(requireFromPackage.resolve("blessed/package.json"));
    const blessedTputPath = requireFromPackage.resolve("blessed/lib/tput.js");
    const blessedTerminfoBase64 = Object.fromEntries(await Promise.all(blessedTerminfoNames.map(async (name) => [
        name,
        (await readFile(resolve(blessedPackageRoot, "usr", name))).toString("base64"),
    ])));
    const blessedTerminfoSource = `Tput.prototype._useVt102Cap = function() {
  return this.injectTermcap('vt102');
};

Tput.prototype._useXtermCap = function() {
  return this.injectTermcap(__dirname + '/../usr/xterm.termcap');
};

Tput.prototype._useXtermInfo = function() {
  return this.injectTerminfo(__dirname + '/../usr/xterm');
};

Tput.prototype._useInternalInfo = function(name) {
  name = path.basename(name);
  return this.injectTerminfo(__dirname + '/../usr/' + name);
};

Tput.prototype._useInternalCap = function(name) {
  name = path.basename(name);
  return this.injectTermcap(__dirname + '/../usr/' + name + '.termcap');
};`;
    const blessedTerminfoReplacement = `const embeddedTerminfo = Object.fromEntries(Object.entries(${JSON.stringify(blessedTerminfoBase64)})
  .map(function(entry) { return [entry[0], Buffer.from(entry[1], "base64")]; }));

Tput.prototype._useVt102Cap = function() {
  return this.injectTermcap("vt102");
};

Tput.prototype._useXtermCap = function() {
  return this._useXtermInfo();
};

Tput.prototype._useXtermInfo = function() {
  return this._useInternalInfo("xterm");
};

Tput.prototype._useInternalInfo = function(name) {
  name = path.basename(name);
  if (!embeddedTerminfo[name]) throw new Error("Embedded terminfo not found: " + name);
  return this.inject(this.compile(this.parseTerminfo(embeddedTerminfo[name], name)));
};

Tput.prototype._useInternalCap = function(name) {
  throw new Error("Embedded termcap not found: " + path.basename(name));
};`;
    return {
        name: "manager-blessed-runtime-assets",
        setup(build) {
            build.onLoad({filter: /[\\/]blessed[\\/]lib[\\/]tput\.js$/u}, async (args) => {
                if (resolve(args.path) !== resolve(blessedTputPath)) return undefined;
                const source = await readFile(args.path, "utf8");
                const first = source.indexOf(blessedTerminfoSource);
                if (first < 0 || source.indexOf(blessedTerminfoSource, first + 1) >= 0) {
                    throw new Error("blessed terminfo fallback源码与Manager构建合同不一致。");
                }
                return {
                    contents: source.replace(blessedTerminfoSource, blessedTerminfoReplacement),
                    loader: "js",
                };
            });
        },
    };
}

export async function buildManager() {
    await rm(outdir, {recursive: true, force: true});
    await mkdir(outdir, {recursive: true});
    const result = await Bun.build({
        entrypoints: [
            resolve(packageRoot, "src", "neuro-book.ts"),
            resolve(packageRoot, "src", "schema.ts"),
            resolve(packageRoot, "src", "runtime-projection.ts"),
            resolve(packageRoot, "src", "product-control.ts"),
            resolve(packageRoot, "src", "desktop-installation-entry.ts"),
            resolve(packageRoot, "src", "desktop-uac-client-entry.ts"),
            resolve(packageRoot, "src", "product-runtime-verifier-entry.ts"),
            resolve(packageRoot, "src", "installation-entry.ts"),
            resolve(packageRoot, "src", "portable.ts"),
        ],
        outdir,
        // 公开入口同时由 Bun Manager 和 Node/Vitest 发布验证消费；target=bun 会把内联 CJS
        // 依赖的 require 降级为只在 Bun 可调用的 import.meta.require。
        target: "node",
        format: "esm",
        naming: "[name].mjs",
        plugins: [await createBlessedRuntimePlugin(resolve(packageRoot, "package.json"))],
        minify: true,
    });
    if (!result.success) {
        for (const log of result.logs) {
            console.error(log);
        }
        process.exit(1);
    }
    await copyFile(resolve(packageRoot, "..", "..", "LICENSE"), resolve(outdir, "LICENSE"));
}

if (import.meta.main) await buildManager();
