import {spawn, type ChildProcess} from "node:child_process";
import {createHash, randomBytes} from "node:crypto";
import {lstat, readdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {dirname, join, relative, resolve} from "node:path";
import {NbdevError, systemErrorCode} from "../core/errors.js";

/**
 * 前端构建：产物不入库，`panel serve` 发现输入变了就先构建。
 * - 输入（`.build-hash` 的内容）：面板的 `src/web/`、`vite.config.ts`、`tsconfig.web.json`、`package.json`，编进网页的工作区包的整个包目录
 *   （`PANEL_SOURCE_PACKAGES`：面板直接用它们的源码与主题，样式由面板自己的 Tailwind 编译，不依赖它们的任何产物），以及根 `bun.lock`。
 *   与“代码已更新”提示比较的路径一致（见 state.ts 的 `CODE_PATHS`，由同一份清单生成）。
 * - 输出到临时目录，成功后改名替换 `dist/web`：正在跑的面板的 `index.html` 不会指向已被删掉的资源。
 * - 失败时有旧产物就用旧的（`/api/meta` 标出），没有就报 `build_failed`。
 */

export const BUILD_HASH_FILE = ".build-hash";

/** 面板网页编进去的工作区包（`packages/` 下的目录名）。面板的网页新依赖一个工作区包时加在这里，改它就会重建、会提示代码已更新。 */
export const PANEL_SOURCE_PACKAGES = ["nb-ui", "nb-layout"] as const;

async function walk(dir: string, files: string[], skip: ReadonlySet<string>): Promise<void> {
    let entries;
    try {
        entries = await readdir(dir, {withFileTypes: true});
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") return;
        throw error;
    }
    for (const entry of entries) {
        if (skip.has(entry.name)) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path, files, skip);
        else if (entry.isFile()) files.push(path);
    }
}

export async function computeBuildHash(packageRoot: string, repoRoot: string): Promise<string> {
    const files: string[] = [];
    await walk(join(packageRoot, "src", "web"), files, new Set(["node_modules"]));
    // 整个包目录都算：与 state.ts 的 CODE_PATHS 按整棵树比较保持一致，面板自己不读 dist/ 里的产物。
    // nb-ui 的 Nuxt 生成目录与 playground 不进面板。
    for (const name of PANEL_SOURCE_PACKAGES) await walk(join(repoRoot, "packages", name), files, new Set(["node_modules", ".nuxt", ".output", "playground"]));
    files.push(join(packageRoot, "vite.config.ts"), join(packageRoot, "tsconfig.web.json"), join(packageRoot, "package.json"), join(repoRoot, "bun.lock"));
    const hash = createHash("sha256");
    for (const file of files.sort()) {
        hash.update(relative(repoRoot, file)).update("\0");
        try {
            hash.update(await readFile(file));
        } catch (error) {
            if (systemErrorCode(error) !== "ENOENT") throw error;
            hash.update("<missing>");
        }
        hash.update("\n");
    }
    return hash.digest("hex");
}

async function exists(path: string): Promise<boolean> {
    try {
        await lstat(path);
        return true;
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") return false;
        throw error;
    }
}

export type BuildResult = {built: boolean; failed: string | null};

/** 运行中的构建子进程；面板收口时结束它。 */
let running: ChildProcess | null = null;

export function stopRunningBuild(): void {
    if (running && running.exitCode === null && running.signalCode === null) running.kill("SIGTERM");
}

function runVite(packageRoot: string, outDir: string, log: (line: string) => void): Promise<string | null> {
    // vite 的 exports 不导出 bin/：从它的 package.json 所在目录找命令行入口。
    let vite: string;
    try {
        vite = join(dirname(createRequire(join(packageRoot, "package.json")).resolve("vite/package.json")), "bin", "vite.js");
    } catch (error) {
        return Promise.resolve(`找不到 vite（先在仓库根运行 bun install）：${error instanceof Error ? error.message : String(error)}`);
    }
    return new Promise((resolvePromise) => {
        const child = spawn(process.execPath, [vite, "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "warn"], {cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"]});
        running = child;
        let output = "";
        const collect = (chunk: Buffer) => {
            const text = chunk.toString("utf8");
            output = `${output}${text}`.slice(-4_000);
            for (const line of text.split("\n")) if (line.trim() !== "") log(`vite：${line}`);
        };
        child.stdout!.on("data", collect);
        child.stderr!.on("data", collect);
        child.on("error", (error) => resolvePromise(`无法启动 vite：${error.message}`));
        child.on("close", (code, signal) => {
            running = null;
            resolvePromise(code === 0 ? null : `vite build 失败（${signal ?? `退出码 ${code}`}）：${output.trim().slice(-1_000)}`);
        });
    });
}

/** 产物与输入一致就不构建；否则构建到临时目录再改名替换。 */
export async function ensureWebBuild(options: {packageRoot: string; repoRoot: string; distDir: string; force?: boolean; log: (line: string) => void}): Promise<BuildResult> {
    const {packageRoot, repoRoot, distDir, log} = options;
    const hash = await computeBuildHash(packageRoot, repoRoot);
    const current = await readFile(join(distDir, BUILD_HASH_FILE), "utf8").catch((error: unknown) => {
        if (systemErrorCode(error) === "ENOENT") return null;
        throw error;
    });
    const haveOld = await exists(join(distDir, "index.html"));
    if (!options.force && haveOld && current?.trim() === hash) return {built: false, failed: null};
    const temporary = resolve(`${distDir}.tmp-${randomBytes(4).toString("hex")}`);
    log("前端的输入变了，开始构建");
    const failure = await runVite(packageRoot, temporary, log);
    if (failure !== null) {
        await rm(temporary, {recursive: true, force: true});
        if (haveOld) {
            log(`前端构建失败，继续用旧的产物：${failure}`);
            return {built: false, failed: failure};
        }
        throw new NbdevError("build_failed", `前端构建失败，也没有旧的产物可用：${failure}`);
    }
    await writeFile(join(temporary, BUILD_HASH_FILE), `${hash}\n`);
    const old = `${distDir}.old-${randomBytes(4).toString("hex")}`;
    if (await exists(distDir)) await rename(distDir, old);
    await rename(temporary, distDir);
    await rm(old, {recursive: true, force: true});
    log("前端构建完成");
    return {built: true, failed: null};
}
