/**
 * 桌面载荷：从发到 npm 的那个应用包 tarball 组装桌面版要带的应用（ADR 0051 决定 3，docs/proposals/desktop-distribution.md 4.1）。
 * 不另外构建：载荷里的 `app/` 就是 tarball 的内容，加上按目标平台装好的外部依赖（`SERVER_EXTERNALS`，ADR 0036）。桌面壳用随包的
 * Bun 运行 `app/server/main.js`，Web 根是 `app/web`（docs/specs/runtime/desktop-shell.md 输出 4）。
 *
 * 输入是 `release:smoke` 写的发布清单（`dist/release/release-manifest.json`），不是裸 tarball：先核对应用包 tarball 的 SHA-256
 * 等于清单，载荷清单里的提交取自发布清单，发布流水线用同一份清单核对，发出去的桌面包与 npm 包是同一批字节。
 *
 * 依赖闭包：先 `bun install --lockfile-only` 按目标平台写出锁文件，锁里的每个包都要在仓库根 `bun.lock` 里有同名同版本、完整性
 * 哈希相同的条目，再按这份锁 `--frozen-lockfile` 安装。比的是完整性哈希而不是版本号：同版本内容被换、依赖链将来带进别的第三方包，
 * 都会被拦下。分两步是因为带 `--production` 时 Bun 1.4.4 不写锁文件（加了 `--lockfile-only` 也不写）；写锁那一步不带它，
 * 应用包没有 devDependencies，锁的内容一样。`--backend copyfile`：载荷里不能是指向本机全局缓存的硬链接。
 *
 * 用法：`bun scripts/desktop-payload.ts <release-manifest.json> <输出目录> [--os win32] [--cpu x64]`（缺省本机平台）。从 registry
 * 装依赖，直连慢时整条命令前加 `prox`。输出目录只在不存在、为空或者是上次生成的载荷时清空重建。
 */

import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync} from "node:fs";
import {mkdir, readdir, readFile, rename, rm, stat, writeFile} from "node:fs/promises";
import {dirname, join, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";

import {APP_NAME, clearGenerated} from "./pack-app";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const MARKER = ".nbook-desktop-payload";
const OWNER = "neuro-book desktop payload";
/** 包目录里算作许可文件的名字。 */
const LICENSE_FILE = /^(licen[cs]e|copying)(\.[\w.-]+)?$/iu;

/** `release:smoke` 写的发布清单里用到的部分（`scripts/release/manifest.ts` 的 `ReleaseManifest`）。 */
export interface ReleaseManifestLike {
    readonly commit: string;
    readonly packages: ReadonlyArray<{readonly name: string; readonly version: string; readonly tarball: string; readonly sha256: string}>;
}

export interface PayloadOptions {
    readonly releaseManifest: string;
    readonly outDir: string;
    readonly os: string;
    readonly cpu: string;
    /** 对照用的锁文件，缺省仓库根的 `bun.lock`。 */
    readonly rootLock?: string;
}

export interface PayloadManifest {
    readonly schema: 1;
    readonly product: string;
    readonly version: string;
    readonly commit: string;
    readonly bun: string;
    readonly target: {readonly os: string; readonly cpu: string};
    readonly tarball: {readonly name: string; readonly sha256: string};
    readonly dependencies: Readonly<Record<string, {readonly version: string; readonly integrity: string}>>;
    readonly files: ReadonlyArray<{readonly path: string; readonly size: number; readonly sha256: string}>;
}

async function sha256(path: string): Promise<string> {
    return createHash("sha256").update(await readFile(path)).digest("hex");
}

/** 发布清单里的应用包：tarball 的绝对路径（相对清单所在目录）与它该有的摘要。tarball 不在或摘要不同时抛出。 */
export async function appTarball(manifestPath: string, manifest: ReleaseManifestLike): Promise<{path: string; version: string; sha256: string}> {
    const entry = manifest.packages.find((item) => item.name === APP_NAME);
    if (entry === undefined) throw new Error(`发布清单 ${manifestPath} 里没有 ${APP_NAME}`);
    const path = resolve(dirname(manifestPath), entry.tarball);
    if (!existsSync(path)) throw new Error(`发布清单里的 ${entry.tarball} 不存在：先跑 release:smoke`);
    const actual = await sha256(path);
    if (actual !== entry.sha256) throw new Error(`${entry.tarball} 的 SHA-256 是 ${actual}，与发布清单的 ${entry.sha256} 不同：tarball 在冒烟之后被换过`);
    return {path, version: entry.version, sha256: actual};
}

/** 锁文件里的包：`名@版本` → 完整性哈希。工作区自己的包（没有完整性哈希）不算。 */
export function lockedPackages(lockText: string): Map<string, string> {
    const lock = Bun.JSONC.parse(lockText) as {packages?: Record<string, readonly unknown[]>};
    const result = new Map<string, string>();
    for (const entry of Object.values(lock.packages ?? {})) {
        const [spec, , , integrity] = entry;
        if (typeof spec === "string" && typeof integrity === "string" && integrity.startsWith("sha512-")) result.set(spec, integrity);
    }
    return result;
}

/** 载荷锁里每个包对照根锁：根锁里没有、或完整性哈希不同的列出来，空表示通过。 */
export function lockMismatches(payload: ReadonlyMap<string, string>, root: ReadonlyMap<string, string>): string[] {
    return [...payload].flatMap(([spec, integrity]) => {
        const expected = root.get(spec);
        if (expected === undefined) return [`${spec} 不在仓库根的 bun.lock 里`];
        return expected === integrity ? [] : [`${spec} 的完整性哈希与仓库根的 bun.lock 不同`];
    });
}

/** 目录下的全部文件（不跟符号链接），路径用 `/`、按路径排序。 */
export async function listFiles(root: string): Promise<Array<{path: string; size: number; sha256: string}>> {
    const files: Array<{path: string; size: number; sha256: string}> = [];
    const walk = async (directory: string): Promise<void> => {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) await walk(path);
            else if (entry.isFile()) files.push({path: relative(root, path).split(sep).join("/"), size: (await stat(path)).size, sha256: await sha256(path)});
            else throw new Error(`${relative(root, path)} 不是普通文件或目录：载荷里不放符号链接`);
        }
    };
    await walk(root);
    return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** `node_modules` 下每个包目录（含 `@scope/name`）。 */
async function installedPackageDirectories(nodeModules: string): Promise<string[]> {
    const result: string[] = [];
    for (const entry of await readdir(nodeModules, {withFileTypes: true})) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        if (entry.name.startsWith("@")) {
            for (const scoped of await readdir(join(nodeModules, entry.name), {withFileTypes: true})) {
                if (scoped.isDirectory()) result.push(join(nodeModules, entry.name, scoped.name));
            }
        } else {
            result.push(join(nodeModules, entry.name));
        }
    }
    return result;
}

function bunInstall(cwd: string, args: readonly string[]): void {
    const result = spawnSync("bun", ["install", ...args], {cwd, encoding: "utf8"});
    if (result.status !== 0) throw new Error(`bun install ${args.join(" ")} 失败（退出码 ${String(result.status)}）：\n${result.stderr}${result.stdout}`);
}

export async function assembleDesktopPayload(options: PayloadOptions): Promise<PayloadManifest> {
    const manifestPath = resolve(options.releaseManifest);
    const release = JSON.parse(await readFile(manifestPath, "utf8")) as ReleaseManifestLike;
    if (typeof release.commit !== "string" || !Array.isArray(release.packages)) throw new Error(`${manifestPath} 不是发布清单`);
    const tarball = await appTarball(manifestPath, release);

    const outDir = resolve(options.outDir);
    await clearGenerated(outDir, MARKER, OWNER);
    // 标记先于内容写下：中途失败留下的半成品下次照样能被清掉。
    await mkdir(outDir, {recursive: true});
    await writeFile(join(outDir, MARKER), `${OWNER}\n`);

    const extracted = join(outDir, ".extract");
    await new Bun.Archive(await Bun.file(tarball.path).bytes()).extract(extracted);
    const app = join(outDir, "app");
    await rename(join(extracted, "package"), app);
    await rm(extracted, {recursive: true});

    const platform = [`--os=${options.os}`, `--cpu=${options.cpu}`];
    bunInstall(app, ["--lockfile-only", "--linker=hoisted", ...platform]);
    const lockText = await readFile(join(app, "bun.lock"), "utf8");
    const payloadLock = lockedPackages(lockText);
    const mismatches = lockMismatches(payloadLock, lockedPackages(await readFile(options.rootLock ?? join(repoRoot, "bun.lock"), "utf8")));
    if (mismatches.length > 0) throw new Error(`载荷的依赖与仓库根的 bun.lock 对不上：\n${mismatches.join("\n")}`);
    bunInstall(app, ["--production", "--frozen-lockfile", "--linker=hoisted", "--backend=copyfile", ...platform]);

    const nodeModules = join(app, "node_modules");
    const nativeName = `pi-natives-${options.os}-${options.cpu}`;
    const natives = existsSync(join(nodeModules, "@oh-my-pi")) ? (await readdir(join(nodeModules, "@oh-my-pi"))).filter((name) => name.startsWith("pi-natives-")) : [];
    if (natives.length !== 1 || natives[0] !== nativeName) throw new Error(`载荷里的原生插件应当只有 @oh-my-pi/${nativeName}，实际是 ${natives.join("、") || "没有"}`);
    const unlicensed: string[] = [];
    for (const directory of await installedPackageDirectories(nodeModules)) {
        if (!(await readdir(directory)).some((name) => LICENSE_FILE.test(name))) unlicensed.push(relative(nodeModules, directory));
    }
    if (unlicensed.length > 0) throw new Error(`这些依赖没有许可文件，不能随载荷分发：${unlicensed.join("、")}`);

    const dependencies: Record<string, {version: string; integrity: string}> = {};
    for (const [spec, integrity] of [...payloadLock].sort(([a], [b]) => (a < b ? -1 : 1))) {
        const at = spec.lastIndexOf("@");
        dependencies[spec.slice(0, at)] = {version: spec.slice(at + 1), integrity};
    }
    const manifest: PayloadManifest = {
        schema: 1,
        product: APP_NAME,
        version: tarball.version,
        commit: release.commit,
        bun: Bun.version,
        target: {os: options.os, cpu: options.cpu},
        tarball: {name: relative(dirname(manifestPath), tarball.path).split(sep).join("/"), sha256: tarball.sha256},
        dependencies,
        files: await listFiles(app),
    };
    await writeFile(join(outDir, "payload-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
}

function option(argv: readonly string[], name: string, fallback: string): string {
    const index = argv.indexOf(name);
    if (index === -1) return fallback;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${name} 要跟一个值`);
    return value;
}

if (import.meta.main) {
    const argv = process.argv.slice(2);
    const [releaseManifest, outDir] = argv.filter((arg, index) => !arg.startsWith("--") && !argv[index - 1]?.startsWith("--"));
    if (releaseManifest === undefined || outDir === undefined) {
        console.error("用法：bun scripts/desktop-payload.ts <release-manifest.json> <输出目录> [--os win32] [--cpu x64]");
        process.exit(2);
    }
    const manifest = await assembleDesktopPayload({releaseManifest, outDir, os: option(argv, "--os", process.platform), cpu: option(argv, "--cpu", process.arch)});
    console.log(`桌面载荷已组装：${resolve(outDir)}（${manifest.target.os}-${manifest.target.cpu}，${String(manifest.files.length)} 个文件）`);
}
