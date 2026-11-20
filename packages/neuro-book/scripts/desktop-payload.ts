/**
 * 桌面载荷：从发到 npm 的那个应用包 tarball 组装桌面版要带的应用（ADR 0051 决定 3，docs/proposals/desktop-distribution.md 4.1）。
 * 不另外构建：载荷里的 `app/` 就是 tarball 的内容，加上按目标平台装好的外部依赖（`SERVER_EXTERNALS`，ADR 0036）。桌面壳用随包的
 * Bun 运行 `app/server/main.js`，Web 根是 `app/web`（docs/specs/runtime/desktop-shell.md 输出 4）。
 *
 * 输入是 `release:smoke` 写的发布清单（`dist/release/release-manifest.json`），不是裸 tarball：先核对应用包 tarball 的 SHA-256
 * 等于清单，载荷清单里的提交取自发布清单，发布流水线用同一份清单核对，发出去的桌面包与 npm 包是同一批字节。
 *
 * 依赖闭包：先 `bun install --lockfile-only` 按目标平台写出锁文件，再按这份锁 `--frozen-lockfile` 安装。锁里的每个包都要落在
 * “应用包声明的依赖在仓库根 `bun.lock` 里的传递闭包”之内、完整性哈希相同：比的是哈希而不是版本号，同版本内容被换会被拦下；
 * 基准是闭包而不是整个根锁，依赖链将来带进仓库别处用到的第三方包（根锁里有，但不是应用的依赖）同样会被拦下。分两步是因为带 `--production` 时 Bun 1.4.4 不写锁文件（加了 `--lockfile-only` 也不写）；写锁那一步不带它，
 * 应用包没有 devDependencies，锁的内容一样。`--backend copyfile`：载荷里不能是指向本机全局缓存的硬链接。
 *
 * 用法：`bun scripts/desktop-payload.ts <release-manifest.json> <输出目录> [--os win32] [--cpu x64]`（缺省本机平台）。从 registry
 * 装依赖，直连慢时整条命令前加 `prox`。输出目录只在不存在、为空或者是上次生成的载荷时清空重建。
 */

import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync} from "node:fs";
import {mkdir, readdir, readFile, rename, rm, stat, writeFile} from "node:fs/promises";
import {basename, dirname, join, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";

import {APP_NAME, clearGenerated} from "./pack-app";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const MARKER = ".nbook-desktop-payload";
const OWNER = "neuro-book desktop payload";
/** 包目录里算作许可文件的名字。 */
const LICENSE_FILE = /^(licen[cs]e|copying)([.-][\w.-]+)?$/iu;

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

type LockEntry = readonly [spec: string, registry?: unknown, meta?: {dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>}, integrity?: unknown];

function lockEntries(lockText: string): Record<string, LockEntry> {
    return (Bun.JSONC.parse(lockText) as {packages?: Record<string, LockEntry>}).packages ?? {};
}

/** `名@版本` 里的名字（作用域包的名字本身带 `@`）。 */
function nameOf(spec: string): string {
    return spec.slice(0, spec.lastIndexOf("@"));
}

/** 锁文件里来自 registry 的包：`名@版本` → 完整性哈希（没有 sha512 的记为空串）。工作区包（`名@workspace:…`）不算。 */
export function lockedPackages(lockText: string): Map<string, string> {
    const result = new Map<string, string>();
    for (const [spec, , , integrity] of Object.values(lockEntries(lockText))) {
        if (spec.includes("@workspace:")) continue;
        result.set(spec, typeof integrity === "string" && integrity.startsWith("sha512-") ? integrity : "");
    }
    return result;
}

/** 锁的键是安装路径上的包名用 `/` 连起来（`a/@scope/b` 是装在 a 下面的 @scope/b），拆回包名的列表。 */
function keyPath(key: string): string[] {
    const parts = key.split("/");
    const names: string[] = [];
    for (let index = 0; index < parts.length; index += 1) names.push(parts[index]?.startsWith("@") === true ? `${parts[index] ?? ""}/${parts[(index += 1)] ?? ""}` : (parts[index] ?? ""));
    return names;
}

/**
 * 根锁里从 `roots`（应用包声明的依赖：名 → 精确版本）出发的传递闭包，`名@版本` → 完整性哈希。依赖按安装路径就近解析（先找装在
 * 依赖方下面的，再逐级往上，最后是顶层），与 Bun 读锁的规则相同；可选依赖（各平台的原生插件）也算进去。根锁里找不到的依赖抛出。
 */
export function lockClosure(lockText: string, roots: Readonly<Record<string, string>>): Map<string, string> {
    const entries = lockEntries(lockText);
    const result = new Map<string, string>();
    const queue: string[] = [];
    for (const [name, version] of Object.entries(roots)) {
        const key = Object.keys(entries).filter((candidate) => entries[candidate]?.[0] === `${name}@${version}`).sort((a, b) => a.length - b.length)[0];
        if (key === undefined) throw new Error(`应用包的依赖 ${name}@${version} 不在仓库根的 bun.lock 里`);
        queue.push(key);
    }
    const seen = new Set<string>();
    for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
        if (seen.has(key)) continue;
        seen.add(key);
        const [spec, , meta, integrity] = entries[key] as LockEntry;
        result.set(spec, typeof integrity === "string" && integrity.startsWith("sha512-") ? integrity : "");
        const path = keyPath(key);
        for (const dependency of Object.keys({...meta?.dependencies, ...meta?.optionalDependencies})) {
            let resolved: string | undefined;
            for (let depth = path.length; depth >= 0 && resolved === undefined; depth -= 1) {
                const candidate = [...path.slice(0, depth), dependency].join("/");
                if (entries[candidate] !== undefined) resolved = candidate;
            }
            if (resolved === undefined) throw new Error(`仓库根的 bun.lock 里找不到 ${nameOf(spec)} 依赖的 ${dependency}`);
            queue.push(resolved);
        }
    }
    return result;
}

/** 载荷锁里每个包对照基准（根锁里应用依赖的闭包）：不在闭包里、没有完整性哈希、哈希不同的列出来，空表示通过。 */
export function lockMismatches(payload: ReadonlyMap<string, string>, closure: ReadonlyMap<string, string>): string[] {
    return [...payload].flatMap(([spec, integrity]) => {
        const expected = closure.get(spec);
        if (expected === undefined) return [`${spec} 不在应用包依赖于仓库根 bun.lock 的闭包里`];
        if (integrity === "" || expected === "") return [`${spec} 没有 sha512 完整性哈希`];
        return expected === integrity ? [] : [`${spec} 的完整性哈希与仓库根的 bun.lock 不同`];
    });
}

/**
 * 路径里有非 ASCII 字符的文件。Windows 的桌面包由 Hutch 调系统自带的 `tar.exe`（bsdtar）打，它在英文代码页的 runner 上处理
 * 不了这样的文件名，整个构建失败、日志里只有一行“command failed: tar.exe”（2026-11-20，内置表情包的中文文件名）。
 * 在组装载荷时就拦下来，写清是哪些文件；要显示中文名的，文件名用 ASCII、显示名写进各自的清单（例如表情包的 `stickers.json`）。
 */
export function nonAsciiPaths(files: ReadonlyArray<{readonly path: string}>): string[] {
    return files.map((file) => file.path).filter((path) => /[^\x20-\x7e]/u.test(path));
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

/** `node_modules` 下每个包目录（含 `@scope/name`，也含装在别的包自己 `node_modules` 里的），交回包名与目录。 */
async function installedPackages(nodeModules: string): Promise<Array<{name: string; directory: string}>> {
    const result: Array<{name: string; directory: string}> = [];
    const visit = async (directory: string, name: string): Promise<void> => {
        result.push({name, directory});
        if (existsSync(join(directory, "node_modules"))) await walk(join(directory, "node_modules"));
    };
    const walk = async (modules: string): Promise<void> => {
        for (const entry of await readdir(modules, {withFileTypes: true})) {
            if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
            if (!entry.name.startsWith("@")) {
                await visit(join(modules, entry.name), entry.name);
                continue;
            }
            for (const scoped of await readdir(join(modules, entry.name), {withFileTypes: true})) {
                if (scoped.isDirectory()) await visit(join(modules, entry.name, scoped.name), `${entry.name}/${scoped.name}`);
            }
        }
    };
    await walk(nodeModules);
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
    const payloadLock = lockedPackages(await readFile(join(app, "bun.lock"), "utf8"));
    const declared = (JSON.parse(await readFile(join(app, "package.json"), "utf8")) as {dependencies?: Record<string, string>}).dependencies ?? {};
    const mismatches = lockMismatches(payloadLock, lockClosure(await readFile(options.rootLock ?? join(repoRoot, "bun.lock"), "utf8"), declared));
    if (mismatches.length > 0) throw new Error(`载荷的依赖与仓库根的 bun.lock 对不上：\n${mismatches.join("\n")}`);
    bunInstall(app, ["--production", "--frozen-lockfile", "--linker=hoisted", "--backend=copyfile", ...platform]);

    const nodeModules = join(app, "node_modules");
    const nativeName = `pi-natives-${options.os}-${options.cpu}`;
    const natives = existsSync(join(nodeModules, "@oh-my-pi")) ? (await readdir(join(nodeModules, "@oh-my-pi"))).filter((name) => name.startsWith("pi-natives-")) : [];
    if (natives.length !== 1 || natives[0] !== nativeName) throw new Error(`载荷里的原生插件应当只有 @oh-my-pi/${nativeName}，实际是 ${natives.join("、") || "没有"}`);
    // 清单只列实际装上的包（锁文件还列着别的平台的原生插件）；每个都要有许可文件、在锁里有完整性哈希。
    const unlicensed: string[] = [];
    const dependencies: Record<string, {version: string; integrity: string}> = {};
    for (const {name, directory} of (await installedPackages(nodeModules)).sort((a, b) => (a.directory < b.directory ? -1 : 1))) {
        if (!(await readdir(directory)).some((file) => LICENSE_FILE.test(file))) unlicensed.push(name);
        const {version} = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as {version: string};
        const integrity = payloadLock.get(`${name}@${version}`);
        if (integrity === undefined) throw new Error(`装上的 ${name}@${version} 不在载荷的锁文件里`);
        dependencies[relative(nodeModules, directory).split(sep).join("/")] = {version, integrity};
    }
    if (unlicensed.length > 0) throw new Error(`这些依赖没有许可文件，不能随载荷分发：${unlicensed.join("、")}`);
    const manifest: PayloadManifest = {
        schema: 1,
        product: APP_NAME,
        version: tarball.version,
        commit: release.commit,
        bun: Bun.version,
        target: {os: options.os, cpu: options.cpu},
        tarball: {name: basename(tarball.path), sha256: tarball.sha256},
        dependencies,
        files: await listFiles(app),
    };
    const unportable = nonAsciiPaths(manifest.files);
    if (unportable.length > 0) throw new Error(`载荷里这些文件的路径有非 ASCII 字符，Windows 打包用的 tar.exe 处理不了：\n${unportable.join("\n")}`);
    await writeFile(join(outDir, "payload-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
}

if (import.meta.main) {
    const usage = "用法：bun scripts/desktop-payload.ts <release-manifest.json> <输出目录> [--os win32] [--cpu x64]";
    const parsed = (() => {
        try {
            return parseArgs({allowPositionals: true, options: {os: {type: "string"}, cpu: {type: "string"}}});
        } catch (error) {
            console.error(`${error instanceof Error ? error.message : String(error)}\n${usage}`);
            return process.exit(2);
        }
    })();
    const [releaseManifest, outDir, ...extra] = parsed.positionals;
    if (releaseManifest === undefined || outDir === undefined || extra.length > 0) {
        console.error(usage);
        process.exit(2);
    }
    const manifest = await assembleDesktopPayload({releaseManifest, outDir, os: parsed.values.os ?? process.platform, cpu: parsed.values.cpu ?? process.arch});
    console.log(`桌面载荷已组装：${resolve(outDir)}（${manifest.target.os}-${manifest.target.cpu}，${String(manifest.files.length)} 个文件）`);
}
