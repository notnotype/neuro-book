/**
 * macOS 桌面包的取证冒烟（w00046 t23；`.github/workflows/desktop-macos-build.yml` 的“取证”步骤）：在 GitHub 的 macOS runner 上把 DMG
 * 里的应用拷出来、带一个全新的状态根启动、等壳写出日志、截一张整屏图，把日志与截图放进证据目录。
 *
 *   bun desktop/scripts/smoke-macos.ts --dmg <NeuroBook-macos-arm64.dmg> --evidence <目录> [--work <目录>]
 *
 * 它不是通过或失败的判据：WKWebView 没有调试端口，页面里的事无从核对，能核对的只有壳自己的日志（窗口外框的种类、Dock 常驻等），
 * 所以只取证。新状态根上第一次打开时首次启动向导会盖住页面，截图里能看到的是红绿灯、标题栏与向导的遮罩，足够量红绿灯的位置与
 * 留位。退出码：0 取到了证据（不代表应用正常）；1 连应用都没拷出来或没启动；2 用法错误。
 */

import {existsSync} from "node:fs";
import {cp, mkdir, mkdtemp, readdir, readFile, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {parseArgs} from "node:util";

const SHELL_LOG_WAIT_MS = 120_000;
/** 壳日志出现 `start` 之后再等这么久，让页面加载完、红绿灯就位再截图。 */
const SETTLE_MS = 25_000;

class UsageError extends Error {}

function options(argv: readonly string[]): {dmg: string; evidence: string; work: string | null} {
    try {
        const {values} = parseArgs({args: [...argv], options: {dmg: {type: "string"}, evidence: {type: "string"}, work: {type: "string"}}});
        if (values.dmg === undefined || values.evidence === undefined) throw new UsageError("缺 --dmg 或 --evidence");
        return {dmg: values.dmg, evidence: values.evidence, work: values.work ?? null};
    } catch (error) {
        throw error instanceof UsageError ? error : new UsageError((error as Error).message);
    }
}

/** 跑一条命令，成败都把输出交回；不抛错（取证要尽量多拿）。 */
async function run(command: readonly string[]): Promise<{code: number; output: string}> {
    const child = Bun.spawn([...command], {stdout: "pipe", stderr: "pipe"});
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return {code, output: `${out}${err}`};
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<number> {
    const {dmg, evidence, work: workOption} = options(process.argv.slice(2));
    await mkdir(evidence, {recursive: true});
    const work = workOption ?? (await mkdtemp(join(tmpdir(), "nbook-macos-smoke-")));
    const notes: string[] = [];
    const note = (line: string): void => {
        notes.push(line);
        console.log(line);
    };
    const flush = (): Promise<void> => writeFile(join(evidence, "notes.txt"), `${notes.join("\n")}\n`);

    // 挂载、把 .app 拷出来、卸载。
    const mount = join(work, "mnt");
    await mkdir(mount, {recursive: true});
    const attach = await run(["hdiutil", "attach", "-nobrowse", "-readonly", "-mountpoint", mount, dmg]);
    note(`hdiutil attach exit=${String(attach.code)} ${attach.output.trim().slice(0, 400)}`);
    if (attach.code !== 0) {
        await flush();
        return 1;
    }
    const apps = (await readdir(mount)).filter((name) => name.endsWith(".app"));
    note(`DMG 里的应用：${apps.join(", ") || "（没有）"}`);
    const app = join(work, "NeuroBook.app");
    if (apps[0] !== undefined) await cp(join(mount, apps[0]), app, {recursive: true});
    note(`hdiutil detach exit=${String((await run(["hdiutil", "detach", mount])).code)}`);
    if (!existsSync(app)) {
        await flush();
        return 1;
    }
    // 下载来的包带隔离属性，runner 上没有人点“允许”：去掉它。
    note(`xattr 去隔离 exit=${String((await run(["xattr", "-dr", "com.apple.quarantine", app])).code)}`);

    const stateRoot = join(work, "state");
    await mkdir(stateRoot, {recursive: true});
    const opened = await run(["open", "-n", app, "--env", `NBOOK_STATE_ROOT=${stateRoot}`]);
    note(`open exit=${String(opened.code)} ${opened.output.trim().slice(0, 400)}`);

    const logFile = join(stateRoot, "logs", "desktop", "shell.log");
    const deadline = Date.now() + SHELL_LOG_WAIT_MS;
    let started = false;
    while (Date.now() < deadline) {
        if (existsSync(logFile) && (await readFile(logFile, "utf8")).includes(" start version=")) {
            started = true;
            break;
        }
        await sleep(1_000);
    }
    note(started ? "壳日志里有 start" : `${String(SHELL_LOG_WAIT_MS / 1000)} 秒内壳没有写出 start`);
    await sleep(SETTLE_MS);

    const shot = await run(["screencapture", "-x", join(evidence, "screen.png")]);
    note(`screencapture exit=${String(shot.code)} ${shot.output.trim().slice(0, 200)}`);
    // 窗口列表（名字、位置、大小）：红绿灯的位置在图上量，窗口本身的位置在这里。
    const windows = await run(["osascript", "-e", 'tell application "System Events" to get {name, position, size} of every window of (every process whose name contains "NeuroBook" or name contains "launcher" or name contains "bun")']);
    note(`窗口 exit=${String(windows.code)} ${windows.output.trim().slice(0, 600)}`);
    note(`进程：${(await run(["sh", "-c", "ps -axo pid,comm | grep -i -E 'neurobook|launcher|bun' | grep -v grep"])).output.trim()}`);

    if (existsSync(join(stateRoot, "logs"))) await cp(join(stateRoot, "logs"), join(evidence, "logs"), {recursive: true});
    await flush();
    return started ? 0 : 1;
}

main().then(
    (code) => process.exit(code),
    (error: unknown) => {
        console.error(error instanceof UsageError ? `用法错误：${error.message}` : error);
        process.exit(error instanceof UsageError ? 2 : 1);
    },
);
