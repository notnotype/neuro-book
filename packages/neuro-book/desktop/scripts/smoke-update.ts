/**
 * 自动更新的冒烟：docs/specs/runtime/desktop-update.md“验收与 Smoke”。在 Windows 的登录桌面会话里运行，两种用法：
 *
 * - 场景 1、2（发布流水线 `.github/workflows/release.yml` 的 `desktop` 作业）：用两个测试包，A′ 是本次版本，B′ 是补丁号加 1；
 *   都用测试应用标识，更新源构建成本机端口（`NBOOK_UPDATE_BASE_URL`，`desktop/electrobun.config.ts`），由这里起的本机更新源换着放。
 *
 *     --setup-a <A′ 的 Setup.zip> --feed-a <A′ 的产物目录> --feed-b <B′ 的产物目录>
 *     --identifier <测试标识> --evidence <目录> [--feed-port <端口，缺省 47819>] [--work <目录>]
 *
 * - 上一个正式版本到本次（`upgrade-from-previous` 作业，本次公开、是最新之后）：装上一版的正式 Setup，它从 GitHub
 *   `latest/download` 发现本次、下载、换上。正式标识，不起本机更新源，不核对取的是补丁还是完整包（请求不经过这里）。
 *
 *     --previous <上一版的 Setup.zip> --expect <本次版本> --evidence <目录> [--work <目录>]
 *
 * 状态根用缺省的：设了 NBOOK_STATE_ROOT 的壳只提示、不下载不换上。缺省状态根里原有的 `projects.json`、`settings.json`
 * 先备份、结束时还原（本机验证时那里可能有开发者的数据）。
 *
 * 壳的交接：每一段结束都 WM_CLOSE、等安装目录下的进程都结束（桌面锁随之放下），才进下一段；测试标识隔开安装与通道根，
 * 不隔开缺省状态根上的桌面锁。更新器拉起的新版本不带脚本的环境（换上程序经任务计划程序启动），换上后的第一次启动
 * 按壳日志取证（页面显示“已更新到”之后交回壳的 `desktop.update.notice-shown`），UI 自动化读到那条通知就另记一笔；
 * 之后关掉、由脚本带调试端口重新启动，做页面一侧的检查。
 * 退出码：0 通过；1 失败；2 用法错误。
 */

import {randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {cp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {parseArgs} from "node:util";

import {localModelSettings} from "../../src/plugins/agent/testing/endpoint";
import {cleanUp, closeApp, installFromSetup, killUnder, OFFICIAL_IDENTIFIER, readBaseline, seedState, startApp, uninstall, uninstallLeftover, webViewData, type Installed} from "./smoke/app";
import {baselineProblems, lineCount, logEntries, noticesShown, updateChecks} from "./smoke/facts";
import {feedServer} from "./smoke/feed";
import {collectEvidence, connectPage, defaultStateRoot, freePort, skipFirstRun, SmokeFailure, updaterResultFiles, waitFor, watchWindowText} from "./smoke/windows";

class UsageError extends Error {}

type TestOptions = {mode: "test"; setupA: string; feedA: string; feedB: string; identifier: string; evidence: string; feedPort: number; work: string};
type PreviousOptions = {mode: "previous"; previous: string; expect: string; evidence: string; work: string};
type Options = TestOptions | PreviousOptions;

const USAGE = "用法：bun desktop/scripts/smoke-update.ts --setup-a <zip> --feed-a <目录> --feed-b <目录> --identifier <测试标识> --evidence <目录> [--feed-port <端口>] [--work <目录>]\n　　或 --previous <上一版的 Setup.zip> --expect <本次版本> --evidence <目录> [--work <目录>]";

function parseOptions(argv: readonly string[]): Options {
    let values: Record<string, string | undefined>;
    try {
        ({values} = parseArgs({args: [...argv], options: {"setup-a": {type: "string"}, "feed-a": {type: "string"}, "feed-b": {type: "string"}, identifier: {type: "string"}, evidence: {type: "string"}, "feed-port": {type: "string"}, work: {type: "string"}, previous: {type: "string"}, expect: {type: "string"}}}));
    } catch (error) {
        throw new UsageError((error as Error).message);
    }
    const {"setup-a": setupA, "feed-a": feedA, "feed-b": feedB, identifier, evidence, previous, expect} = values;
    const work = values.work ?? join(tmpdir(), `nbook-smoke-update-${randomUUID().slice(0, 8)}`);
    if (evidence === undefined) throw new UsageError(USAGE);
    if (previous !== undefined || expect !== undefined) {
        if (previous === undefined || expect === undefined || setupA !== undefined || feedA !== undefined || feedB !== undefined || identifier !== undefined || values["feed-port"] !== undefined) throw new UsageError(USAGE);
        return {mode: "previous", previous, expect, evidence, work};
    }
    if (setupA === undefined || feedA === undefined || feedB === undefined || identifier === undefined) throw new UsageError(USAGE);
    if (identifier === OFFICIAL_IDENTIFIER) throw new UsageError("测试包的更新冒烟只用测试标识：测试包的更新源是本机端口，不能装成正式安装");
    return {mode: "test", setupA, feedA, feedB, identifier, evidence, feedPort: Number(values["feed-port"] ?? 47819), work};
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

async function installedVersion(appDir: string): Promise<string> {
    const version = (JSON.parse(await readFile(join(appDir, "Resources", "version.json"), "utf8")) as {version?: unknown}).version;
    if (typeof version !== "string") throw new SmokeFailure(`${appDir} 的 Resources/version.json 里没有版本`);
    return version;
}

/**
 * 两种用法的差别：装哪个包、新版本从哪里来、能不能看到下载的请求。
 * - `offerNew`：让正在运行的旧版本能发现新版本（测试包：本机源放 B′）；
 * - `fallBack`：换上之前源回到哪里（测试包：退回 A′，即场景 2 后半；上一版：源一直是 GitHub 上的本次）；
 * - `recheck`：换上之后再启动时，检查的结论应当是什么；
 * - `downloads`：请求记录里第 `from` 行之后取过的补丁与完整包；看不到请求时是 null。
 */
type Route = {
    label: {old: string; new: string};
    setup: string;
    identifier: string;
    target: string;
    evidence: string;
    offerNew(): void;
    fallBack(): void;
    recheck(from: string, target: string): {remote: string; result: "older" | "same"; text: string};
    requestCursor(): Promise<number>;
    downloads(from: number): Promise<{patches: number; archives: number} | null>;
    evidenceFiles(): Record<string, string>;
    stop(): void;
};

async function testRoute(options: TestOptions): Promise<Route> {
    const [versionA, versionB] = [await feedVersion(options.feedA), await feedVersion(options.feedB)];
    if (Bun.semver.order(versionB, versionA) !== 1) throw new SmokeFailure(`B′（${versionB}）要高于 A′（${versionA}）`);
    const requests = join(options.work, "feed-requests.log");
    // 两个源目录各一份副本：换源就是让服务指向另一个目录，不在被服务的目录里换文件。
    const served = {a: join(options.work, "feed-a"), b: join(options.work, "feed-b")};
    await cp(options.feedA, served.a, {recursive: true});
    await cp(options.feedB, served.b, {recursive: true});
    const feed = feedServer(options.feedPort, requests);
    return {
        label: {old: "A′", new: "B′"},
        setup: options.setupA,
        identifier: options.identifier,
        target: versionB,
        evidence: join(options.evidence, "update"),
        offerNew: () => feed.serve(served.b),
        // 场景 2 后半：已下载 B′ 之后源退回正在运行的 A′；下次打开照样换上 B′。
        fallBack: () => feed.serve(served.a),
        // 场景 2 前半：B′ 上源是 A′（更低）：检查过、不提示、不下载。
        recheck: (from) => ({remote: from, result: "older", text: `源是 ${from}，检查结论“更低”`}),
        requestCursor: () => linesOf(requests),
        downloads: (from) => downloads(requests, from),
        evidenceFiles: () => ({"feed-requests.log": requests}),
        stop: () => feed.stop(),
    };
}

function previousRoute(options: PreviousOptions): Route {
    return {
        label: {old: "上一版", new: "本次"},
        setup: options.previous,
        identifier: OFFICIAL_IDENTIFIER,
        target: options.expect,
        evidence: join(options.evidence, "previous"),
        offerNew: () => undefined,
        fallBack: () => undefined,
        // 源（GitHub latest/download）一直是本次：换上之后检查结论是“相同”。
        recheck: (_from, target) => ({remote: target, result: "same", text: `源是 ${target}，检查结论“相同”`}),
        requestCursor: async () => 0,
        downloads: async () => null,
        evidenceFiles: () => ({}),
        stop: () => undefined,
    };
}

async function smoke(options: Options): Promise<void> {
    const stateRoot = defaultStateRoot();
    const shellLog = join(stateRoot, "logs", "desktop", "shell.log");
    const backups = new Map<string, string | null>();
    for (const name of ["projects.json", "settings.json"]) backups.set(name, existsSync(join(stateRoot, name)) ? await readFile(join(stateRoot, name), "utf8") : null);
    const route = options.mode === "test" ? await testRoute(options) : previousRoute(options);
    const {old: oldLabel, new: newLabel} = route.label;
    const target = route.target;
    await mkdir(route.evidence, {recursive: true});
    let installed: Installed | null = null;
    try {
        installed = await installFromSetup(route.setup, route.identifier, options.work, step);
        const appDir = installed.appDir;
        const from = await installedVersion(appDir);
        if (Bun.semver.order(target, from) !== 1) throw new SmokeFailure(`${newLabel}（${target}）要高于装上的${oldLabel}（${from}）`);
        // 模型设置只作数据基线里可认出的值；这个冒烟不调模型。“启动时打开”写成书架：同一个作业里前面的冒烟用缺省状态根打开过
        // 作品，不写的话这里一启动就进了那部作品（projects.md 的“启动时打开”）。上一版不认识这个键：没声明的键留在文件里、不报错。
        const seeded = await seedState(stateRoot, options.work, {...localModelSettings("http://127.0.0.1:9"), "nbook.projects/startupOpen": "shelf"});

        // 场景 1：旧版本运行中发现新版本，下载（有补丁就取补丁），关掉。
        route.offerNew();
        let port = freePort();
        await startApp(installed.launcher, webViewData(installed), {cdpPort: port});
        let connection = await connectPage(port, webViewData(installed));
        // 首次启动向导只在状态根第一次打开桌面版时出现：同一个作业里安装版冒烟已经用过缺省状态根、看过它，这里多半不出；
        // 新的 runner（上一版升级的作业）上会出，而且可能和更新提示同时在。向导是模态框，开着时页面其余部分对读屏隐藏，
        // 按角色找不到“下载”（v0.15.0 的上一版升级就这样失败）。所以向导一出现就跳过，点“下载”之前再查一次。
        const offer = connection.page.getByText(`NeuroBook ${target} 可以更新`);
        const wizard = connection.page.locator("[data-first-run-wizard]");
        await offer.or(wizard).first().waitFor({timeout: 90_000});
        if (await wizard.isVisible()) await skipFirstRun(connection.page, step);
        await offer.waitFor({timeout: 90_000});
        if (await wizard.isVisible()) await skipFirstRun(connection.page, step);
        await connection.page.getByRole("button", {name: "下载"}).first().click();
        await connection.page.getByText("已下载").first().waitFor({timeout: 300_000});
        await connection.browser.close().catch(() => undefined);
        const got = await route.downloads(0);
        if (got !== null && (got.patches === 0 || got.archives > 0)) throw new SmokeFailure(`下载${newLabel}时应当只取补丁：补丁 ${String(got.patches)} 个、完整包 ${String(got.archives)} 个`);
        step(`✓ 场景 1：${oldLabel}（${from}）提示 ${target} 可以更新，下载完成${got === null ? "" : "，取的是补丁"}`);
        await closeApp(appDir, step);
        const before = await readBaseline(stateRoot, seeded);

        // 换上之后第一次启动的新版本由更新器经任务计划程序拉起，不带调试端口：页面显示过“已更新到”以壳日志里
        // 页面交回的那一条为准；UI 自动化同时去读那条几秒后自己消失的通知，读到就记下，没赶上不算失败。
        route.fallBack();
        const expected = route.recheck(from, target);
        const swapCursor = await linesOf(shellLog);
        const reading = watchWindowText(appDir, "已更新到", 90_000).catch((error: unknown) => `（UI 自动化出错：${error instanceof Error ? error.message : String(error)}）`);
        await startApp(installed.launcher, webViewData(installed));
        const notice = await waitFor(`换上之后${newLabel}的页面显示了“已更新到”`, async () => {
            const entries = logEntries(existsSync(shellLog) ? await readFile(shellLog, "utf8") : "", swapCursor);
            return noticesShown(entries).find((item) => item.kind === "updated") ?? null;
        }, 240_000, 1_000);
        if (notice.version !== target) throw new SmokeFailure(`换上之后页面显示的是“已更新到 ${notice.version}”，不是 ${target}`);
        const swapped = await installedVersion(appDir);
        if (swapped !== target) throw new SmokeFailure(`换上之后安装目录里的版本是 ${swapped}，不是 ${target}`);
        const read = await reading;
        await writeFile(join(route.evidence, "updated-notice-uia.txt"), `${read ?? "（没赶上：通知已经消失）"}\n`);
        step(`✓ 打开${oldLabel}的启动器：换上 ${target}，页面显示了“已更新到 NeuroBook ${target}”（UI 自动化：${read ?? "没赶上"}）`);
        // 换上之后的第一次启动也要检查过更新，结论与源对得上（场景 2 后半：源退回 A′，不再提示）。
        const firstCheck = await waitFor(`换上之后${newLabel}的第一次启动检查了更新`, async () => updateChecks(logEntries(await readFile(shellLog, "utf8"), swapCursor)).at(0) ?? null, 90_000, 1_000);
        if (firstCheck.remote !== expected.remote || firstCheck.result !== expected.result) throw new SmokeFailure(`换上之后${newLabel}的第一次检查结论是 ${JSON.stringify(firstCheck)}，应当是远端 ${expected.remote}、${expected.result}`);
        await closeApp(appDir, step);

        // 换上之后的下一次启动：检查过、结论符合预期、不提示、不下载。检查只在启动时与每 24 小时做，所以重新启动一次。
        const logCursor = await linesOf(shellLog);
        const requestCursor = await route.requestCursor();
        port = freePort();
        await startApp(installed.launcher, webViewData(installed), {cdpPort: port});
        connection = await connectPage(port, webViewData(installed));
        const check = await waitFor(`${newLabel}启动后检查了更新`, async () => updateChecks(logEntries(await readFile(shellLog, "utf8"), logCursor)).at(0) ?? null, 90_000, 1_000);
        if (check.remote !== expected.remote || check.result !== expected.result) throw new SmokeFailure(`${newLabel}的检查结论是 ${JSON.stringify(check)}，应当是远端 ${expected.remote}、${expected.result}`);
        const after = await route.downloads(requestCursor);
        if (after !== null && after.patches + after.archives > 0) throw new SmokeFailure(`${newLabel}在源不更高时下载了东西`);
        if ((await connection.page.getByText("可以更新").count()) > 0) throw new SmokeFailure(`${newLabel}在源不更高时提示了“可以更新”`);
        await connection.browser.close().catch(() => undefined);
        const problems = baselineProblems(before, await readBaseline(stateRoot, seeded));
        if (problems.length > 0) throw new SmokeFailure(`换上之后数据变了：${problems.join("；")}`);
        step(`✓ ${newLabel}再启动：${expected.text}，不提示、不下载；作品登记、模型设置与那一章不变`);
        await closeApp(appDir, step);
        await uninstall(installed, step);
    } finally {
        // 每项单独收尾（一项失败不挡还原）：先存证据（进程列表要在结束进程之前拍），再结束进程、还原缺省状态根里的两个文件。
        const done = installed;
        await cleanUp([
            ["存证据", () => collectEvidence(route.evidence, {logs: join(stateRoot, "logs", "desktop"), ...route.evidenceFiles(), "nbook-update-state.json": join(done?.channel ?? "", "nbook-update-state.json"), "version.json": join(done?.appDir ?? "", "Resources", "version.json")})],
            ["结束应用进程", () => (done === null ? undefined : killUnder(done.appDir))],
            ["停本机更新源", () => route.stop()],
            ...[...backups].map(([name, content]) => [`还原 ${name}`, () => (content === null ? rm(join(stateRoot, name), {force: true}) : writeFile(join(stateRoot, name), content))] as const),
            ["存更新器的结果文件", async () => {
                for (const file of done === null ? [] : await updaterResultFiles(done.channel)) await cp(file, join(route.evidence, file.split(/[\\/]/u).at(-1) ?? "result.json"));
            }],
            ["卸载残留的测试安装", () => uninstallLeftover(done)],
        ]);
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
