/**
 * 自动更新的冒烟：docs/specs/runtime/desktop-update.md“验收与 Smoke”的场景 1、2（发布流水线 `.github/workflows/release.yml` 的
 * `desktop` 作业；“上一个正式版本到本次”另在 `upgrade-from-previous` 作业）。用两个测试包：A′ 是本次版本，B′ 是补丁号加 1；
 * 都用测试应用标识，更新源构建成本机端口（`NBOOK_UPDATE_BASE_URL`，`desktop/electrobun.config.ts`）。在 Windows 的登录桌面会话里运行：
 *
 *   --setup-a <A′ 的 Setup.zip> --feed-a <A′ 的产物目录> --feed-b <B′ 的产物目录>
 *   --identifier <测试标识> --evidence <目录> [--feed-port <端口，缺省 47819>] [--work <目录>]
 *
 * 状态根用缺省的：设了 NBOOK_STATE_ROOT 的壳只提示、不下载不换上。缺省状态根里原有的 `projects.json`、`settings.json`
 * 先备份、结束时还原（本机验证时那里可能有开发者的数据）。
 *
 * 壳的交接：每一段结束都 WM_CLOSE、等安装目录下的进程都结束（桌面锁随之放下），才进下一段；测试标识隔开安装与通道根，
 * 不隔开缺省状态根上的桌面锁。更新器拉起的新版本不带脚本的环境（换上程序经任务计划程序启动），换上后的第一次启动用
 * UI 自动化读窗口文字取证，之后关掉、由脚本带调试端口重新启动，做页面一侧的检查。
 * 退出码：0 通过；1 失败；2 用法错误。
 */

import {randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {cp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {parseArgs} from "node:util";

import {localModelSettings} from "../../src/plugins/agent/testing/endpoint";
import {closeApp, installFromSetup, killUnder, readBaseline, seedState, startApp, uninstall, type Installed} from "./smoke/app";
import {baselineProblems, lineCount, logEntries, updateChecks} from "./smoke/facts";
import {collectEvidence, connectPage, defaultStateRoot, feedServer, freePort, processesUnder, SmokeFailure, updaterResultFiles, waitFor, windowTexts} from "./smoke/windows";

class UsageError extends Error {}

type Options = {setupA: string; feedA: string; feedB: string; identifier: string; evidence: string; feedPort: number; work: string};

function parseOptions(argv: readonly string[]): Options {
    let values: Record<string, string | undefined>;
    try {
        ({values} = parseArgs({args: [...argv], options: {"setup-a": {type: "string"}, "feed-a": {type: "string"}, "feed-b": {type: "string"}, identifier: {type: "string"}, evidence: {type: "string"}, "feed-port": {type: "string"}, work: {type: "string"}}}));
    } catch (error) {
        throw new UsageError((error as Error).message);
    }
    const {"setup-a": setupA, "feed-a": feedA, "feed-b": feedB, identifier, evidence} = values;
    if (setupA === undefined || feedA === undefined || feedB === undefined || identifier === undefined || evidence === undefined) {
        throw new UsageError("用法：bun desktop/scripts/smoke-update.ts --setup-a <zip> --feed-a <目录> --feed-b <目录> --identifier <测试标识> --evidence <目录> [--feed-port <端口>] [--work <目录>]");
    }
    if (identifier === "io.github.notnotype.neurobook") throw new UsageError("更新冒烟只用测试标识：测试包的更新源是本机端口，不能装成正式安装");
    return {setupA, feedA, feedB, identifier, evidence, feedPort: Number(values["feed-port"] ?? 47819), work: values.work ?? join(tmpdir(), `nbook-smoke-update-${randomUUID().slice(0, 8)}`)};
}

const step = (line: string) => console.log(line);

async function feedVersion(dir: string): Promise<string> {
    const version = (JSON.parse(await readFile(join(dir, "stable-win-x64-update-v2.json"), "utf8")) as {version?: unknown}).version;
    if (typeof version !== "string") throw new SmokeFailure(`${dir} 的 update-v2.json 里没有版本`);
    return version;
}

/** 更新源请求记录里第 `from` 行之后取过的补丁与完整包（状态 200 的 GET）。 */
async function downloads(log: string, from: number): Promise<{patches: number; archives: number}> {
    const lines = existsSync(log) ? (await readFile(log, "utf8")).split("\n").slice(from) : [];
    const ok = lines.filter((line) => / GET \S+ 200 /u.test(line));
    return {patches: ok.filter((line) => /\.patch\?cache=/u.test(line)).length, archives: ok.filter((line) => /\.tar\.zst\?cache=/u.test(line)).length};
}

const linesOf = async (path: string): Promise<number> => (existsSync(path) ? lineCount(await readFile(path, "utf8")) : 0);

async function smoke(options: Options): Promise<void> {
    const [versionA, versionB] = [await feedVersion(options.feedA), await feedVersion(options.feedB)];
    if (Bun.semver.order(versionB, versionA) !== 1) throw new SmokeFailure(`B′（${versionB}）要高于 A′（${versionA}）`);
    const stateRoot = defaultStateRoot();
    const shellLog = join(stateRoot, "logs", "desktop", "shell.log");
    const requests = join(options.work, "feed-requests.log");
    const evidence = join(options.evidence, "update");
    await mkdir(evidence, {recursive: true});
    // 两个源目录各一份副本：换源就是让服务指向另一个目录，不在被服务的目录里换文件。
    const served = {a: join(options.work, "feed-a"), b: join(options.work, "feed-b")};
    await cp(options.feedA, served.a, {recursive: true});
    await cp(options.feedB, served.b, {recursive: true});
    const backups = new Map<string, string | null>();
    for (const name of ["projects.json", "settings.json"]) backups.set(name, existsSync(join(stateRoot, name)) ? await readFile(join(stateRoot, name), "utf8") : null);
    const feed = feedServer(options.feedPort, requests);
    let installed: Installed | null = null;
    try {
        installed = await installFromSetup(options.setupA, options.identifier, options.work, step);
        const appDir = installed.appDir;
        // 模型设置只作数据基线里可认出的值；这个冒烟不调模型。
        const seeded = await seedState(stateRoot, options.work, localModelSettings("http://127.0.0.1:9"));

        // 场景 1：A′ 运行中发现 B′，下载（取补丁），关掉。
        feed.serve(served.b);
        let port = freePort();
        startApp(installed.launcher, {cdpPort: port});
        let connection = await connectPage(port);
        await connection.page.getByText(`NeuroBook ${versionB} 可以更新`).waitFor({timeout: 90_000});
        await connection.page.getByRole("button", {name: "下载"}).first().click();
        await connection.page.getByText("已下载").first().waitFor({timeout: 180_000});
        await connection.browser.close().catch(() => undefined);
        const got = await downloads(requests, 0);
        if (got.patches === 0 || got.archives > 0) throw new SmokeFailure(`下载 B′ 时应当只取补丁：补丁 ${String(got.patches)} 个、完整包 ${String(got.archives)} 个`);
        step(`✓ 场景 1：A′（${versionA}）提示 ${versionB} 可以更新，下载取的是补丁`);
        await closeApp(appDir, step);
        const before = await readBaseline(stateRoot, seeded);

        // 场景 2 后半：已下载 B′ 之后源退回正在运行的 A′；下次打开照样换上 B′。
        feed.serve(served.a);
        startApp(installed.launcher);
        const texts = await waitFor("换上之后 B′ 的窗口里出现“已更新到”", async () => {
            const windows = await windowTexts((await processesUnder(appDir)).map((entry) => entry.pid));
            const all = windows.flatMap((window) => window.texts);
            return all.some((text) => text.includes("已更新到") && text.includes(versionB)) ? all : null;
        }, 240_000, 2_000);
        if (texts.some((text) => text.includes("可以更新"))) throw new SmokeFailure("换上之后还提示“可以更新”");
        const version = (JSON.parse(await readFile(join(appDir, "Resources", "version.json"), "utf8")) as {version?: unknown}).version;
        if (version !== versionB) throw new SmokeFailure(`换上之后安装目录里的版本是 ${String(version)}，不是 ${versionB}`);
        step(`✓ 场景 1、2 后半：源退回 A′ 之后打开，换上 ${versionB}，窗口里是“已更新到”，没有“可以更新”`);
        await closeApp(appDir, step);

        // 场景 2 前半：B′ 上源是 A′（更低）：检查过、不提示、不下载。检查只在启动时与每 24 小时做，所以重新启动一次。
        const logCursor = await linesOf(shellLog);
        const requestCursor = await linesOf(requests);
        port = freePort();
        startApp(installed.launcher, {cdpPort: port});
        connection = await connectPage(port);
        const check = await waitFor("B′ 启动后检查了更新", async () => updateChecks(logEntries(await readFile(shellLog, "utf8"), logCursor)).at(0) ?? null, 90_000, 1_000);
        if (check.remote !== versionA || check.result !== "older") throw new SmokeFailure(`B′ 的检查结论是 ${JSON.stringify(check)}，应当是远端 ${versionA}、更低`);
        const after = await downloads(requests, requestCursor);
        if (after.patches + after.archives > 0) throw new SmokeFailure("B′ 在源是更低版本时下载了东西");
        if ((await connection.page.getByText("可以更新").count()) > 0) throw new SmokeFailure("B′ 在源是更低版本时提示了“可以更新”");
        await connection.browser.close().catch(() => undefined);
        const problems = baselineProblems(before, await readBaseline(stateRoot, seeded));
        if (problems.length > 0) throw new SmokeFailure(`换上之后数据变了：${problems.join("；")}`);
        step(`✓ 场景 2 前半：B′ 上源是 ${versionA}，检查结论“更低”，不提示、不下载；作品登记、模型设置与那一章不变`);
        await closeApp(appDir, step);
        await uninstall(installed, step);
    } finally {
        if (installed !== null) await killUnder(installed.appDir);
        feed.stop();
        await collectEvidence(evidence, {logs: join(stateRoot, "logs", "desktop"), "feed-requests.log": requests, "nbook-update-state.json": join(installed?.channel ?? "", "nbook-update-state.json"), "version.json": join(installed?.appDir ?? "", "Resources", "version.json")});
        for (const file of installed === null ? [] : await updaterResultFiles(installed.channel)) await cp(file, join(evidence, file.split(/[\\/]/u).at(-1) ?? "result.json")).catch(() => undefined);
        for (const [name, content] of backups) {
            const path = join(stateRoot, name);
            if (content === null) await rm(path, {force: true});
            else await writeFile(path, content);
        }
    }
}

async function main(argv: readonly string[]): Promise<void> {
    const options = parseOptions(argv);
    await mkdir(options.work, {recursive: true});
    await smoke(options);
    console.log("更新冒烟通过");
}

if (import.meta.main) {
    try {
        await main(Bun.argv.slice(2));
    } catch (error) {
        console.error(error instanceof SmokeFailure || error instanceof UsageError ? `冒烟失败：${error.message}` : error);
        process.exitCode = error instanceof UsageError ? 2 : 1;
    }
}
