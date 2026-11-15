/**
 * 两个 Windows 冒烟共用的应用操作：装、起、关、卸，以及往状态根里放一部作品与模型设置。规则在 Spec：
 * docs/specs/runtime/desktop-shell.md（安装、便携标记、关闭与停止、卸载不删数据）与 docs/specs/runtime/desktop-update.md。
 */

import {randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {mkdir, readdir, readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {channelRoot, killTree, launch, postClose, processesUnder, run, SmokeFailure, splitCommand, uninstallEntry, waitFor, webViewProcesses} from "./windows";
import {dataBaseline, type DataBaseline} from "./facts";

export const OFFICIAL_IDENTIFIER = "io.github.notnotype.neurobook";

export type Installed = {identifier: string; channel: string; appDir: string; launcher: string};

/** 应用的 WebView2 浏览器数据：在通道根下（便携版也是，desktop-shell 的已知限制）。 */
export const webViewData = (installed: {channel: string}): string => join(installed.channel, "WebView2");

/**
 * 等这份浏览器数据的 WebView2 进程都退出，30 秒还在就结束它们。它们不在安装目录下，结束应用进程时带不走；还在时下一次启动
 * 会复用这个先起来的浏览器进程，启动时给的调试端口参数就不生效（GitHub runner 上第一次演练：Setup 自己拉起的应用被结束 1 秒后再起，
 * 调试端口 120 秒没起来）。
 */
export async function settleWebView(userDataDir: string): Promise<void> {
    const gone = await waitFor("WebView2 进程退出", async () => (await webViewProcesses(userDataDir)).length === 0, 30_000, 1_000).catch(() => false);
    if (gone === false) for (const entry of await webViewProcesses(userDataDir)) await killTree(entry.pid);
}

/** 解压 Setup.zip、运行里面的 `*-Setup.exe`，等装好。Setup 装完不一定退出、可能自己拉起应用（t01 的 runner 探针），都由这里收掉。 */
export async function installFromSetup(zip: string, identifier: string, work: string, log: (line: string) => void): Promise<Installed> {
    if ((await uninstallEntry(identifier)) !== null) throw new SmokeFailure(`${identifier} 已经装着：冒烟要在没装过的机器上跑，先卸载`);
    const dir = join(work, `setup-${identifier}`);
    await mkdir(dir, {recursive: true});
    const extracted = await run(["tar", "-xf", zip, "-C", dir]);
    if (extracted.code !== 0) throw new SmokeFailure(`解压 ${zip} 失败：${extracted.stderr}`);
    const setup = (await readdir(dir)).find((name) => name.endsWith("-Setup.exe"));
    if (setup === undefined) throw new SmokeFailure(`${zip} 里没有 *-Setup.exe`);
    const channel = channelRoot(identifier);
    const installed: Installed = {identifier, channel, appDir: join(channel, "app"), launcher: join(channel, "app", "bin", "launcher.exe")};
    const child = Bun.spawn([join(dir, setup)], {cwd: dir, stdin: "ignore", stdout: Bun.file(join(work, `setup-${identifier}.out.txt`)), stderr: Bun.file(join(work, `setup-${identifier}.err.txt`))});
    try {
        // 卸载项是安装器最后登记的（t01：先装文件、建快捷方式，再登记卸载项）。
        await waitFor("安装完成（卸载项已登记、启动器在）", async () => (await uninstallEntry(identifier)) !== null && existsSync(installed.launcher), 180_000, 1_000);
    } finally {
        await killTree(child.pid);
        for (const entry of await processesUnder(installed.appDir)) await killTree(entry.pid);
        await settleWebView(webViewData(installed));
    }
    log(`✓ 安装：${installed.appDir}`);
    return installed;
}

/** 安装版的卸载（`--uninstall --quiet --delete-data`，t01 的 runner 探针）；等安装目录与快捷方式都不在。 */
export async function uninstall(installed: Installed, log: (line: string) => void): Promise<void> {
    const entry = await uninstallEntry(installed.identifier);
    if (entry === null) throw new SmokeFailure(`${installed.identifier} 没有卸载项`);
    const [program] = splitCommand(entry.uninstallString);
    if (program === undefined) throw new SmokeFailure(`卸载项的命令是空的：${entry.uninstallString}`);
    const result = await run([program, "--uninstall", "--quiet", "--delete-data"]);
    if (result.code !== 0) throw new SmokeFailure(`卸载失败（退出码 ${String(result.code)}）：${result.stderr}`);
    const shortcuts = [join(process.env.USERPROFILE ?? "", "Desktop", `${entry.displayName}.lnk`), join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Start Menu", "Programs", `${entry.displayName}.lnk`)];
    await waitFor("卸载完成（安装目录、卸载项与快捷方式都不在）", async () => !existsSync(installed.appDir) && (await uninstallEntry(installed.identifier)) === null && shortcuts.every((path) => !existsSync(path)), 120_000, 1_000);
    log("✓ 卸载：安装目录、卸载项与快捷方式都不在");
}

export type Seeded = {projectDir: string; chapterFile: string; projectName: string};

/**
 * 往状态根里放一部作品（目录在 `work` 下，登记进 `projects.json`）与模型设置，合并进已有的文件、不覆盖别的条目。
 * 直接写这两个文件与 e2e 相同（应用里“打开作品”要经应用内的文件夹浏览，脚本驱动不了）；要在应用第一次起来之前写。
 */
export async function seedState(stateRoot: string, work: string, settings: Record<string, unknown>): Promise<Seeded> {
    const id = randomUUID();
    const projectName = `smoke-${id.slice(0, 8)}`;
    const projectDir = join(work, projectName);
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await mkdir(join(projectDir, "正文"), {recursive: true});
    await writeFile(join(projectDir, ".nbook", "project.json"), JSON.stringify({schema: 1, id}));
    const chapterFile = join(projectDir, "正文", "第一章.md");
    await writeFile(chapterFile, `雨越下越大。${id}\n`);
    await mkdir(stateRoot, {recursive: true});
    const projectsFile = join(stateRoot, "projects.json");
    const registry = existsSync(projectsFile) ? (JSON.parse(await readFile(projectsFile, "utf8")) as {schema: number; projects: unknown[]}) : {schema: 1, projects: []};
    registry.projects.push({id, name: projectName, path: projectDir});
    await writeFile(projectsFile, JSON.stringify(registry));
    const settingsFile = join(stateRoot, "settings.json");
    const current = existsSync(settingsFile) ? (JSON.parse(await readFile(settingsFile, "utf8")) as Record<string, unknown>) : {};
    await writeFile(settingsFile, JSON.stringify({...current, ...settings}));
    return {projectDir, chapterFile, projectName};
}

/** 现在的数据基线：作品登记、模型设置、那一章。 */
export async function readBaseline(stateRoot: string, seeded: Seeded): Promise<DataBaseline> {
    const read = async (path: string, fallback: string) => (existsSync(path) ? readFile(path, "utf8") : fallback);
    return dataBaseline(await read(join(stateRoot, "projects.json"), "{}"), await read(join(stateRoot, "settings.json"), "{}"), await read(seeded.chapterFile, ""));
}

/**
 * 起启动器。`cdpPort` 给了时打开 WebView2 的远程调试端口；`stateRoot` 给了时设 `NBOOK_STATE_ROOT`。起之前先等 `webViewData`
 * 这份浏览器数据的 WebView2 进程退出（见 `settleWebView`），否则调试端口参数可能不生效。
 */
export async function startApp(launcher: string, webViewDataDir: string, options: {cdpPort?: number; stateRoot?: string} = {}): Promise<void> {
    await settleWebView(webViewDataDir);
    const env: Record<string, string | undefined> = {...process.env};
    delete env.NBOOK_STATE_ROOT;
    delete env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS;
    if (options.cdpPort !== undefined) env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${String(options.cdpPort)}`;
    if (options.stateRoot !== undefined) env.NBOOK_STATE_ROOT = options.stateRoot;
    launch(launcher, env);
}

/**
 * 像用户点关闭那样关掉 `dir` 下的应用：等它有可见窗口，发 `WM_CLOSE`，等这个目录下的进程都结束（壳的停止截止缺省 90 秒）。
 * 关闭前询问由页面接下；没有未保存的内容与在跑的工作时直接同意。
 */
export async function closeApp(dir: string, log: (line: string) => void): Promise<void> {
    await waitFor("应用有可见窗口", async () => postClose((await processesUnder(dir)).map((entry) => entry.pid)) > 0, 60_000, 1_000);
    await waitFor("应用的进程都结束", async () => (await processesUnder(dir)).length === 0, 120_000, 1_000);
    log("✓ 关窗：WM_CLOSE 之后进程都结束");
}

/**
 * 成功与失败都要做的收尾：按顺序逐项做，一项失败不挡后面的；失败写进 stderr，不遮掉冒烟原来的错误。
 * 顺序由调用方定：先停进程、还原用户数据，再存证据，最后卸载（卸载会删掉通道根里的证据）。
 */
export async function cleanUp(tasks: ReadonlyArray<readonly [string, () => unknown]>): Promise<void> {
    for (const [label, task] of tasks) {
        try {
            await task();
        } catch (error) {
            console.error(`收尾“${label}”失败：${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

/** 失败路径的卸载：卸载项还在就卸（成功路径已经卸过时什么也不做），免得重跑时被“已经装着”挡住。 */
export async function uninstallLeftover(installed: Installed | null): Promise<void> {
    if (installed === null || (await uninstallEntry(installed.identifier)) === null) return;
    await uninstall(installed, (line) => console.error(`（收尾）${line}`));
}

/** 收尾：结束 `dir` 下还在的进程（失败路径，不是被测的关闭）。 */
export async function killUnder(dir: string): Promise<void> {
    for (const entry of await processesUnder(dir)) await killTree(entry.pid);
}
