/**
 * 桌面版安装版与便携版的冒烟（docs/specs/runtime/desktop-shell.md 的“验收与 Smoke”；发布流水线 `.github/workflows/release.yml`
 * 的 `desktop` 作业）。在 Windows 的登录桌面会话里用仓库的 Bun 运行（`bun desktop/scripts/smoke-windows.ts`，在 `packages/neuro-book` 下）：
 *
 *   --setup <NeuroBook-win-x64-Setup.zip> | --portable <NeuroBook-win-x64-portable.zip>
 *   --evidence <目录>        成败都写：日志、version.json、进程列表、页面截图
 *   [--identifier <标识>]    包的应用标识，缺省正式标识；本机验证用测试标识，不碰正式安装（便携版按它找通道根）
 *   [--state-root <目录>]    安装版设 NBOOK_STATE_ROOT（本机验证不碰缺省状态根）；CI 不给，用缺省
 *   [--work <目录>]          解压与作品放在这里，缺省系统临时目录
 *
 * 步骤：准备假模型端点与一部作品 → 装或解压 → 带调试端口起启动器、连上页面 → 打开作品、让 Agent 跑一条 shell 命令
 * → WM_CLOSE 关窗、核对服务端有序以 0 停止 →（安装版）再启动一次，窗口经“启动时打开”的路由直接进刚才那部作品，再关
 * → 卸载（安装版，作品与设置都还在）或核对便携版没碰别处。
 * 退出码：0 通过；1 失败（失败的步骤与原因在 stderr，证据在 --evidence）；2 用法错误。
 */

import {randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {mkdir, readdir, readFile, stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {parseArgs} from "node:util";

import type {Page} from "@playwright/test";

import {fakeEndpoint, localModelSettings, type FakeEndpoint} from "../../src/plugins/agent/testing/endpoint";
import {cleanUp, closeApp, installFromSetup, killUnder, OFFICIAL_IDENTIFIER, readBaseline, seedState, startApp, uninstall, uninstallLeftover, webViewData, type Installed, type Seeded} from "./smoke/app";
import {baselineProblems, lineCount, logEntries, orderlyStopProblems} from "./smoke/facts";
import {channelRoot, collectEvidence, connectPage, defaultStateRoot, freePort, run, skipFirstRun, SmokeFailure} from "./smoke/windows";

class UsageError extends Error {}

type Options = {setup?: string; portable?: string; evidence: string; identifier: string; stateRoot?: string; work: string};

function parseOptions(argv: readonly string[]): Options {
    let values: Record<string, string | undefined>;
    try {
        ({values} = parseArgs({args: [...argv], options: {setup: {type: "string"}, portable: {type: "string"}, evidence: {type: "string"}, identifier: {type: "string"}, "state-root": {type: "string"}, work: {type: "string"}}}));
    } catch (error) {
        throw new UsageError((error as Error).message);
    }
    if ((values.setup === undefined) === (values.portable === undefined) || values.evidence === undefined) throw new UsageError("用法：bun desktop/scripts/smoke-windows.ts --setup <zip> | --portable <zip> --evidence <目录> [--identifier <标识>] [--state-root <目录>] [--work <目录>]");
    if (values.portable !== undefined && values["state-root"] !== undefined) throw new UsageError("便携版的状态根是程序目录下的 data\\，不收 --state-root");
    return {setup: values.setup, portable: values.portable, evidence: values.evidence, identifier: values.identifier ?? OFFICIAL_IDENTIFIER, stateRoot: values["state-root"], work: values.work ?? join(tmpdir(), `nbook-smoke-${randomUUID().slice(0, 8)}`)};
}

const step = (line: string) => console.log(line);

/** 工具结果的文字：内容可能是字符串，也可能是分段数组（OpenAI 兼容的两种写法）。 */
function textOf(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.map((part) => (typeof part === "object" && part !== null && "text" in part ? String((part as {text: unknown}).text) : "")).join("");
    return "";
}

/**
 * 打开作品，经命令面板把对话带到前面，让 Agent 跑一条 shell 命令（端点回一次 shell 调用；页面要批准时同意一次）。
 * 通过的判据是端点收到的下一次请求里这次调用的结果：输出那一行紧跟着 `[退出码 0]`（nb-harness 的 shell 工具的结果格式）。
 * 只看“含随机串”不够：命令参数本身就含它，工具出错时也可能复述参数。
 */
async function runAgentCommand(page: Page, endpoint: FakeEndpoint, seeded: Seeded): Promise<void> {
    await page.goto(new URL(`/?project=${encodeURIComponent(seeded.projectName)}`, page.url()).href);
    await page.locator("[data-explorer-row]").first().waitFor({timeout: 60_000});
    // 新状态根上第一次打开：向导在作品页上也会出现（书架上没来得及写记录就导航过来了），先跳过它。
    await skipFirstRun(page, step);
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("打开对话");
    await page.keyboard.press("Enter");
    const input = page.getByRole("textbox", {name: "消息输入框"});
    await input.waitFor({timeout: 30_000});
    const marker = `nb-smoke-${randomUUID().slice(0, 8)}`;
    const done = `跑完了 ${marker.slice(-4)}`;
    endpoint.script({tool: "shell", args: {command: `echo ${marker}`}}, done);
    await input.click();
    await page.keyboard.type("跑一条命令");
    await page.keyboard.press("Enter");
    // 要不要批准随作品与角色的权限设置变（新作品的写作助手不问就跑 shell）；问了就同意一次，没问就直接等结果。
    const allow = page.locator('[data-approval-decision="allow"]');
    const finished = page.getByText(done);
    await allow.or(finished).first().waitFor({timeout: 60_000});
    if (await allow.isVisible()) {
        await allow.click();
        await page.locator("[data-approval-submit]").click();
    }
    await finished.waitFor({timeout: 60_000});
    const results = endpoint.requests.flatMap((request) => request.messages).filter((message) => message.role === "tool").map((message) => textOf(message.content));
    if (!results.some((text) => text.includes(`${marker}\n[退出码 0]`))) throw new SmokeFailure(`shell 工具的结果里没有“${marker}”紧跟“[退出码 0]”：${JSON.stringify(results).slice(0, 500)}`);
    step("✓ 作品打开，Agent 跑了一条 shell 命令（退出码 0）");
}

/** 一次启动到关闭：起、连页面、跑命令、关窗，再按这次启动之后的日志核对服务端有序以 0 停止。 */
async function launchUseClose(options: {launcher: string; programDir: string; webViewData: string; stateRoot: string; envStateRoot?: string; endpoint: FakeEndpoint; seeded: Seeded; evidence: string}): Promise<void> {
    const logFile = join(options.stateRoot, "logs", "desktop", "shell.log");
    const cursor = existsSync(logFile) ? lineCount(await readFile(logFile, "utf8")) : 0;
    const port = freePort();
    await startApp(options.launcher, options.webViewData, {cdpPort: port, stateRoot: options.envStateRoot});
    const {browser, page} = await connectPage(port, options.webViewData);
    try {
        step("✓ 启动：经调试端口连上产品页面");
        try {
            await runAgentCommand(page, options.endpoint, options.seeded);
        } catch (error) {
            await page.screenshot({path: join(options.evidence, "page.png")}).catch(() => undefined);
            throw error;
        }
    } finally {
        // 断开调试连接，不关浏览器：关的是用户那条路（WM_CLOSE）。
        await browser.close().catch(() => undefined);
    }
    await closeApp(options.programDir, step);
    const entries = logEntries(await readFile(logFile, "utf8"), cursor);
    const problems = orderlyStopProblems(entries);
    const exit = entries.filter((entry) => entry.event === "exit").at(-1);
    if (exit?.detail !== "0") problems.push(`壳的最后一条退出记录是 ${exit?.detail ?? "没有"}，不是 0`);
    if (existsSync(join(options.stateRoot, "logs", "desktop", "unclean-stop.json"))) problems.push("状态根下有 unclean-stop.json");
    if (problems.length > 0) throw new SmokeFailure(problems.join("\n"));
    step("✓ 服务端经停止路径以 0 停完，壳以 0 退出，没有异常标记");
}

/**
 * 再启动一次（desktop-shell.md 输出 9、projects.md 的“启动时打开”）：第一个窗口加载 resume 路由，302 到上次打开的作品。
 * 这是唯一碰得到真实壳与真实 WebView2 处理 302 的地方（e2e 用模拟壳，直接打开服务端地址）。判据是窗口的地址带
 * `project=<短名>` 且作品的资源管理器画出来了；之后照常关窗、核对有序停止。
 */
async function relaunchResumes(options: {launcher: string; programDir: string; webViewData: string; stateRoot: string; envStateRoot?: string; seeded: Seeded; evidence: string}): Promise<void> {
    const logFile = join(options.stateRoot, "logs", "desktop", "shell.log");
    const cursor = existsSync(logFile) ? lineCount(await readFile(logFile, "utf8")) : 0;
    const port = freePort();
    await startApp(options.launcher, options.webViewData, {cdpPort: port, stateRoot: options.envStateRoot});
    const {browser, page} = await connectPage(port, options.webViewData);
    try {
        try {
            await page.waitForURL((url) => url.searchParams.get("project") === options.seeded.projectName, {timeout: 60_000});
            await page.locator("[data-explorer-row]").first().waitFor({timeout: 60_000});
        } catch (error) {
            await page.screenshot({path: join(options.evidence, "page-relaunch.png")}).catch(() => undefined);
            throw new SmokeFailure(`再启动时没有直接进上次的作品（地址 ${page.url()}）：${error instanceof Error ? error.message : String(error)}`);
        }
        step("✓ 再启动：窗口直接进了上次打开的作品");
    } finally {
        await browser.close().catch(() => undefined);
    }
    await closeApp(options.programDir, step);
    const problems = orderlyStopProblems(logEntries(await readFile(logFile, "utf8"), cursor));
    if (problems.length > 0) throw new SmokeFailure(problems.join("\n"));
}

/**
 * 顶层清单与登记、设置的内容：便携版不该碰缺省状态根，也不在通道根下建状态文件。`ignore` 里的顶层项不比：
 * 便携版的 WebView2 浏览器数据按 Spec 留在本机、在通道根的 `WebView2\` 下（desktop-shell 的“已知限制”）。
 */
async function rootSnapshot(root: string, ignore: readonly string[] = []): Promise<string> {
    // 不存在与只有 ignore 里的项算同一种：便携版第一次运行会建出只放 WebView2 数据的通道根。
    const names = existsSync(root) ? (await readdir(root)).filter((name) => !ignore.includes(name)).sort() : [];
    const files = await Promise.all(["projects.json", "settings.json"].map(async (name) => (existsSync(join(root, name)) ? `${name}=${(await readFile(join(root, name), "utf8")).length}:${String((await stat(join(root, name))).mtimeMs)}` : `${name}=无`)));
    return `${names.join(",")} | ${files.join(" ")}`;
}

async function findProgramRoot(dir: string): Promise<string> {
    for (const name of await readdir(dir)) {
        if (name === "NeuroBook.portable") return dir;
        const nested = join(dir, name, "NeuroBook.portable");
        if (existsSync(nested)) return dirname(nested);
    }
    throw new SmokeFailure(`${dir} 里没有便携标记 NeuroBook.portable`);
}

async function smokeSetup(options: Options & {setup: string}, endpoint: FakeEndpoint): Promise<void> {
    const stateRoot = options.stateRoot ?? defaultStateRoot();
    const evidence = join(options.evidence, "installed");
    await mkdir(evidence, {recursive: true});
    let installed: Installed | null = null;
    try {
        installed = await installFromSetup(options.setup, options.identifier, options.work, step);
        const seeded = await seedState(stateRoot, options.work, localModelSettings(endpoint.baseUrl));
        await launchUseClose({launcher: installed.launcher, programDir: installed.appDir, webViewData: webViewData(installed), stateRoot, envStateRoot: options.stateRoot, endpoint, seeded, evidence});
        await relaunchResumes({launcher: installed.launcher, programDir: installed.appDir, webViewData: webViewData(installed), stateRoot, envStateRoot: options.stateRoot, seeded, evidence});
        const before = await readBaseline(stateRoot, seeded);
        await collectEvidence(evidence, {"version.json": join(installed.appDir, "Resources", "version.json")});
        await uninstall(installed, step);
        const problems = baselineProblems(before, await readBaseline(stateRoot, seeded));
        if (problems.length > 0) throw new SmokeFailure(`卸载之后数据变了：${problems.join("；")}`);
        step("✓ 卸载之后作品登记、模型设置与那一章都还在");
    } finally {
        const done = installed;
        await cleanUp([
            // 先存证据：进程列表要在结束进程之前拍。
            ["存证据", () => collectEvidence(evidence, {logs: join(stateRoot, "logs", "desktop"), "setup.out.txt": join(options.work, `setup-${options.identifier}.out.txt`), "setup.err.txt": join(options.work, `setup-${options.identifier}.err.txt`)})],
            ["结束应用进程", () => (done === null ? undefined : killUnder(done.appDir))],
            ["卸载残留的安装", () => uninstallLeftover(done)],
        ]);
    }
}

async function smokePortable(options: Options & {portable: string}, endpoint: FakeEndpoint): Promise<void> {
    const evidence = join(options.evidence, "portable");
    await mkdir(evidence, {recursive: true});
    const defaultRoot = defaultStateRoot();
    const channel = channelRoot(options.identifier);
    const snapshotChannel = () => rootSnapshot(channel, ["WebView2"]);
    const before = {defaultRoot: await rootSnapshot(defaultRoot), channel: await snapshotChannel()};
    const dir = join(options.work, "portable");
    await mkdir(dir, {recursive: true});
    let programRoot: string | null = null;
    try {
        const extracted = await run(["tar", "-xf", options.portable, "-C", dir]);
        if (extracted.code !== 0) throw new SmokeFailure(`解压 ${options.portable} 失败：${extracted.stderr}`);
        programRoot = await findProgramRoot(dir);
        const launcher = join(programRoot, "bin", "launcher.exe");
        for (const required of [launcher, join(programRoot, "bin", "bun.exe"), join(programRoot, "Resources", "version.json"), join(programRoot, "Resources", "app", "neurobook", "server", "main.js")]) {
            if (!existsSync(required)) throw new SmokeFailure(`便携包里缺 ${required.slice(programRoot.length + 1)}`);
        }
        step(`✓ 解压便携包：${programRoot}`);
        const stateRoot = join(programRoot, "data");
        const seeded = await seedState(stateRoot, options.work, localModelSettings(endpoint.baseUrl));
        await launchUseClose({launcher, programDir: programRoot, webViewData: webViewData({channel}), stateRoot, endpoint, seeded, evidence});
        const after = {defaultRoot: await rootSnapshot(defaultRoot), channel: await snapshotChannel()};
        const problems: string[] = [];
        if (!existsSync(join(stateRoot, "logs", "desktop", "shell.log"))) problems.push("程序目录下的 data\\ 里没有壳的日志：状态根不在程序目录下");
        if (after.defaultRoot !== before.defaultRoot) problems.push(`缺省状态根变了：${before.defaultRoot} → ${after.defaultRoot}`);
        if (after.channel !== before.channel) problems.push(`通道根（${channel}，WebView2 之外）变了：${before.channel} → ${after.channel}`);
        if (problems.length > 0) throw new SmokeFailure(problems.join("\n"));
        step("✓ 便携版的数据在程序目录下的 data\\，缺省状态根与通道根（WebView2 的浏览器数据之外）没有变");
    } finally {
        const root = programRoot;
        if (root !== null) {
            await cleanUp([
                ["存证据", () => collectEvidence(evidence, {logs: join(root, "data", "logs", "desktop"), "version.json": join(root, "Resources", "version.json")})],
                ["结束应用进程", () => killUnder(root)],
            ]);
        }
    }
}

async function main(argv: readonly string[]): Promise<void> {
    const options = parseOptions(argv);
    await mkdir(options.work, {recursive: true});
    await mkdir(options.evidence, {recursive: true});
    const endpoint = fakeEndpoint();
    try {
        if (options.setup !== undefined) await smokeSetup({...options, setup: options.setup}, endpoint);
        else await smokePortable({...options, portable: options.portable as string}, endpoint);
        console.log(`${options.setup !== undefined ? "安装版" : "便携版"}冒烟通过`);
    } finally {
        endpoint.stop();
    }
}

if (import.meta.main) {
    try {
        await main(Bun.argv.slice(2));
    } catch (error) {
        console.error(error instanceof SmokeFailure || error instanceof UsageError ? `冒烟失败：${error.message}` : error);
        process.exitCode = error instanceof UsageError ? 2 : 1;
    }
}
