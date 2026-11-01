/**
 * `nbook` 命令行（docs/specs/runtime/cli.md）：在测试里把 `src/cli/main.ts` 与项目宿主构建到临时目录（与 `build:server`
 * 同样的布局），用真实进程运行打包产物。Web 根给一个只有 `index.html` 的目录；主目录、XDG 与 SSH 环境都换成测试自己的，
 * 不碰真实的数据目录；`PATH` 前面放一个记下参数的假 `xdg-open`，观察“打开浏览器”。`open` 拉起它之后不等它结束，记录文件按用例
 * 分开，前一个用例迟到的写入不影响后一个；断言失败时 `afterEach` 结束还活着的子进程。
 */

import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from "bun:test";
import type {Subprocess} from "bun";
import {chmod, mkdir, readFile, rm, stat, symlink, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {claimStateRoot, queryInstance} from "nbook/server/instance";
import {PRODUCT_VERSION} from "nbook/shared/product";

import {SERVER_EXTERNALS} from "../../scripts/pack-app";

const PACKAGE_ROOT = resolve(import.meta.dir, "..", "..");

let tmp = "";
let nbook = "";
let web = "";
let fakeBin = "";
let opened = "";
let sequence = 0;
/** 本用例起的 nbook 进程。 */
const spawned = new Set<Subprocess>();

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-cli", "nbook");
    const server = join(tmp, "app", "server");
    const externals = SERVER_EXTERNALS.flatMap((pattern) => ["--external", pattern]);
    // 命令行开代码分割（入口 cli/main.ts 的说明）：入口是 nbook.js，本体在旁边的 chunk 里。
    for (const [entry, output] of [["src/cli/main.ts", ["--splitting", "--outdir", server, "--entry-naming", "nbook.js", "--chunk-naming", "nbook-[hash].[ext]"]], ["src/project/main.ts", ["--outfile", join(server, "project.js")]]] as const) {
        const built = Bun.spawnSync(["bun", "build", entry, "--target", "bun", ...externals, ...output], {cwd: PACKAGE_ROOT, stderr: "pipe"});
        if (built.exitCode !== 0) throw new Error(`构建 ${entry} 失败：${built.stderr.toString()}`);
    }
    // OMP 不打进 bundle，装包时由 npm 装（scripts/pack-app.ts 的 SERVER_EXTERNALS）：把本仓库的 node_modules 链到应用旁边，相当于装过。
    await symlink(resolve(PACKAGE_ROOT, "../../node_modules"), join(tmp, "app", "node_modules"), "dir");
    nbook = join(server, "nbook.js");
    web = join(tmp, "web");
    await mkdir(web, {recursive: true});
    await writeFile(join(web, "index.html"), "<!doctype html><title>nbook test</title>");
    fakeBin = join(tmp, "bin");
    await mkdir(fakeBin, {recursive: true});
    await writeFile(join(fakeBin, "xdg-open"), `#!/bin/sh\necho "$1" >> "$NBOOK_TEST_OPENED"\n`);
    await chmod(join(fakeBin, "xdg-open"), 0o755);
});

beforeEach(() => {
    sequence += 1;
    opened = join(tmp, `opened-${String(sequence)}.txt`);
});

afterEach(async () => {
    for (const child of spawned) {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await child.exited;
    }
    spawned.clear();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

function nextRoot(): string {
    sequence += 1;
    return join(tmp, `state-${String(sequence)}`);
}

/** 测试进程的环境：去掉会改变行为的外部变量，主目录换成临时目录，有一个假的图形会话。 */
function cleanEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
    const env: Record<string, string | undefined> = {...process.env};
    for (const name of Object.keys(env)) {
        if (name.startsWith("NBOOK_") || name.startsWith("SSH_") || name === "XDG_DATA_HOME" || name === "NEURO_BOOK_SAFE_MODE") delete env[name];
    }
    Object.assign(env, {HOME: join(tmp, "home"), PATH: `${fakeBin}:${process.env.PATH ?? ""}`, DISPLAY: ":99", NBOOK_WEB_ROOT: web, NBOOK_TEST_OPENED: opened}, extra);
    return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

interface Run {
    readonly pid: number;
    /** 标准输出的第一行 JSON（`--json` 时的结果）。 */
    readonly result: Promise<Record<string, unknown>>;
    readonly exit: Promise<number | null>;
    readonly stderr: () => string;
    signal(name: NodeJS.Signals): void;
}

function run(args: readonly string[], env: Record<string, string | undefined> = {}): Run {
    const child = Bun.spawn(["bun", nbook, ...args], {env: cleanEnv(env), stdout: "pipe", stderr: "pipe"});
    spawned.add(child);
    let stderr = "";
    void (async () => {
        for await (const chunk of child.stderr.pipeThrough(new TextDecoderStream())) stderr += chunk;
    })();
    const result = (async () => {
        let out = "";
        for await (const chunk of child.stdout.pipeThrough(new TextDecoderStream())) {
            out += chunk;
            const newline = out.indexOf("\n");
            if (newline >= 0) return JSON.parse(out.slice(0, newline)) as Record<string, unknown>;
        }
        throw new Error(`nbook 没有写出结果；stderr：${stderr}`);
    })();
    result.catch(() => undefined);
    return {pid: child.pid, result, exit: child.exited, stderr: () => stderr, signal: (name) => child.kill(name)};
}

async function openedUrls(): Promise<string[]> {
    return (await readFile(opened, "utf8").catch(() => "")).split("\n").filter(Boolean);
}

describe("nbook start（真实进程）", () => {
    it("启动后报告地址并打开浏览器；再运行一次得到同一个实例并再打开它；SIGHUP 有序停止，放下状态根", async () => {
        const root = nextRoot();
        const first = run(["start", "--state-root", root, "--port", "0", "--json"]);
        const started = await first.result;
        expect(started).toMatchObject({ok: true, started: true, pid: first.pid, version: PRODUCT_VERSION, stateRoot: root});
        const url = started.url as string;
        expect((await fetch(`${url}api/runtime/health`)).status).toBe(200);
        expect(await (await fetch(url)).text()).toContain("nbook test");
        expect(await waitUntil("打开了浏览器", async () => ((await openedUrls()).includes(url) ? true : undefined))).toBe(true);

        // 不给子命令等于 start；选项写在前面也行。
        const second = run(["--state-root", root, "--json", "--port", "4999", "--safe-mode"]);
        expect(await second.result).toMatchObject({ok: true, started: false, pid: first.pid, url});
        expect(await second.exit).toBe(0);
        expect(second.stderr()).toContain("忽略 --port");
        expect(second.stderr()).toContain("没有以安全模式启动");
        expect(await waitUntil("又打开了一次", async () => ((await openedUrls()).filter((opened) => opened === url).length === 2 ? true : undefined))).toBe(true);

        first.signal("SIGHUP");
        expect(await first.exit).toBe(0);
        expect(await queryInstance(root)).toEqual({state: "none"});
    }, 30_000);

    it("--no-open 不打开；SSH 会话里不打开，提示端口转发；Ctrl-C（SIGINT）以 0 退出", async () => {
        for (const [args, env] of [[["--no-open"], {}], [[], {SSH_CONNECTION: "10.0.0.1 22 10.0.0.2 22"}]] as const) {
            const root = nextRoot();
            const before = (await openedUrls()).length;
            const server = run(["start", "--state-root", root, "--port", "0", "--json", ...args], env);
            const started = await server.result;
            expect(started).toMatchObject({ok: true, started: true});
            if ("SSH_CONNECTION" in env) expect(await waitUntil("提示了端口转发", () => (server.stderr().includes("ssh -L") ? true : undefined))).toBe(true);
            server.signal("SIGINT");
            expect(await server.exit).toBe(0);
            expect(server.stderr()).toContain("NeuroBook 已停止。");
            expect((await openedUrls()).length).toBe(before);
        }
    }, 30_000);

    it("没给状态根时用主目录下的平台数据目录", async () => {
        const server = run(["--json", "--no-open", "--port", "0"]);
        const started = await server.result;
        expect(started).toMatchObject({ok: true, stateRoot: join(tmp, "home", ".local", "share", "neuro-book")});
        expect((await stat(started.stateRoot as string)).isDirectory()).toBe(true);
        server.signal("SIGTERM");
        expect(await server.exit).toBe(0);
    }, 30_000);
});

describe("nbook start 遇到已有实例", () => {
    it("还在启动：等它就绪后报告它（started 为 false）", async () => {
        const root = nextRoot();
        const claimed = await claimStateRoot({stateRoot: root, kind: "product", version: PRODUCT_VERSION, report: () => undefined});
        if (!claimed.ok) throw new Error(claimed.reason);
        try {
            const waiting = run(["start", "--state-root", root, "--json", "--no-open"]);
            await waitUntil("nbook 看到实例在启动、开始等", () => (waiting.stderr().includes("等它就绪") ? true : undefined));
            claimed.claim.publish({url: "http://127.0.0.1:1/", rpcUrl: "ws://127.0.0.1:2/", plugins: {safeMode: false, items: []}});
            expect(await waiting.result).toMatchObject({ok: true, started: false, pid: process.pid, url: "http://127.0.0.1:1/"});
            expect(await waiting.exit).toBe(0);
        } finally {
            await claimed.claim.release();
        }
    }, 30_000);

    it("正在停止：等它停完，自己认领并启动", async () => {
        const root = nextRoot();
        const claimed = await claimStateRoot({stateRoot: root, kind: "product", version: PRODUCT_VERSION, report: () => undefined});
        if (!claimed.ok) throw new Error(claimed.reason);
        claimed.claim.stopping();
        const next = run(["start", "--state-root", root, "--json", "--no-open", "--port", "0"]);
        await waitUntil("nbook 看到实例在停止、开始等", () => (next.stderr().includes("等它停完") ? true : undefined));
        await claimed.claim.release();
        expect(await next.result).toMatchObject({ok: true, started: true, pid: next.pid});
        next.signal("SIGTERM");
        expect(await next.exit).toBe(0);
    }, 30_000);

    it("版本不同：以 1 退出，码 version-mismatch，说明两个版本", async () => {
        const root = nextRoot();
        const claimed = await claimStateRoot({stateRoot: root, kind: "product", version: "9.9.9", report: () => undefined});
        if (!claimed.ok) throw new Error(claimed.reason);
        try {
            claimed.claim.publish({url: "http://127.0.0.1:1/", rpcUrl: "ws://127.0.0.1:2/", plugins: {safeMode: false, items: []}});
            const attempt = run(["--state-root", root, "--json"]);
            expect(await attempt.result).toMatchObject({ok: false, code: "version-mismatch", running: "9.9.9", installed: PRODUCT_VERSION, pid: process.pid});
            expect(await attempt.exit).toBe(1);
        } finally {
            await claimed.claim.release();
        }
    });

    it("开发服务占着：以 1 退出，码 development-instance", async () => {
        const root = nextRoot();
        const claimed = await claimStateRoot({stateRoot: root, kind: "development", version: PRODUCT_VERSION, report: () => undefined});
        if (!claimed.ok) throw new Error(claimed.reason);
        try {
            claimed.claim.publish({url: "http://127.0.0.1:1/", rpcUrl: "ws://127.0.0.1:2/", plugins: {safeMode: false, items: []}});
            const attempt = run(["--state-root", root, "--json"]);
            expect(await attempt.result).toMatchObject({ok: false, code: "development-instance"});
            expect(await attempt.exit).toBe(1);
        } finally {
            await claimed.claim.release();
        }
    });
});

describe("启动失败", () => {
    it("服务端启动失败（Web 根不存在）：结果对象是 startup-failed，带原因，以 1 退出；文本模式写一行 nbook：说明", async () => {
        const missing = join(tmp, "no-such-web");
        const failed = run(["start", "--state-root", nextRoot(), "--port", "0", "--no-open", "--json"], {NBOOK_WEB_ROOT: missing});
        const result = await failed.result;
        expect(result).toMatchObject({ok: false, code: "startup-failed", causes: [expect.objectContaining({message: expect.stringContaining(missing)})]});
        expect(String(result.message)).toContain(missing);
        expect(await failed.exit).toBe(1);
        const text = run(["start", "--state-root", nextRoot(), "--port", "0", "--no-open"], {NBOOK_WEB_ROOT: missing});
        expect(await text.exit).toBe(1);
        expect(text.stderr()).toContain("nbook：服务端启动失败");
    }, 30_000);
});

describe("用法", () => {
    it("拼错的命令、不认识的选项、不合法的端口：以 2 退出，带码 usage；--version 与 --help 以 0 退出", async () => {
        for (const args of [["strat"], ["--bogus"], ["start", "--port", "70000"]]) {
            const attempt = run(["--json", ...args]);
            expect(await attempt.result).toMatchObject({ok: false, code: "usage"});
            expect(await attempt.exit).toBe(2);
        }
        const typo = run(["strat"]);
        expect(await typo.exit).toBe(2);
        expect(typo.stderr()).toContain("不认识的命令 strat");
        // --state-root 给了空串是用法错误，不回落到缺省的真实状态根。
        expect(await json(["plugin", "list", "--state-root", ""])).toMatchObject({exit: 2, result: {ok: false, code: "usage"}});
        // help 子命令与 --help 一样正常结束。
        for (const args of [["help", "start"], ["plugin", "help", "install"]]) expect(Bun.spawnSync(["bun", nbook, ...args], {env: cleanEnv()}).exitCode).toBe(0);
        const version = Bun.spawnSync(["bun", nbook, "--version"], {env: cleanEnv()});
        expect(version.exitCode).toBe(0);
        expect(version.stdout.toString()).toContain(`NeuroBook ${PRODUCT_VERSION}`);
        // 选项与命令两段里，说明列从同一个显示列开始（中文一个字两格宽）。
        for (const args of [["--help"], ["start", "--help"]]) {
            const help = Bun.spawnSync(["bun", nbook, ...args], {env: cleanEnv()});
            expect(help.exitCode).toBe(0);
            expect(help.stdout.toString()).toContain("用法：");
            const starts = help.stdout.toString().split("\n").filter((line) => /^ {2}\S/u.test(line)).map((line) => Bun.stringWidth(/^ {2}\S.*?\s{2,}(?=\S)/u.exec(line)?.[0] ?? ""));
            expect(new Set(starts).size).toBe(1);
        }
    }, 30_000);
});

/** 在临时目录写一个最小的插件文件夹（没有入口，只有清单）。 */
async function pluginSource(name: string, version: string): Promise<string> {
    sequence += 1;
    const directory = join(tmp, "sources", `${name}-${version}-${String(sequence)}`);
    await mkdir(directory, {recursive: true});
    await writeFile(join(directory, "package.json"), JSON.stringify({publisher: "example", name, version, engines: {neurobook: `^${PRODUCT_VERSION}`}, contributes: []}));
    return directory;
}

async function json(args: readonly string[]): Promise<{readonly result: Record<string, unknown>; readonly exit: number | null; readonly stderr: string}> {
    const attempt = run([...args, "--json"]);
    const result = await attempt.result;
    const exit = await attempt.exit;
    return {result, exit, stderr: attempt.stderr()};
}

type Listed = {readonly plugins: ReadonlyArray<{readonly id: string; readonly source: string; readonly state: string; readonly version: string; readonly pending: ReadonlyArray<{readonly kind: string}>}>; readonly running: {readonly pid: number} | null};

function thirdParty(listed: Record<string, unknown>): Listed["plugins"] {
    return (listed as unknown as Listed).plugins.filter((plugin) => plugin.source === "third-party");
}

describe("nbook plugin（真实进程）", () => {
    it("离线：安装后列出（没有运行中的实例，按重启后的样子）；同一版本再装 already-installed；启停与卸载只改目标状态；状态根不存在时 list 不建它", async () => {
        const root = nextRoot();
        const listedEmpty = await json(["plugin", "list", "--state-root", root]);
        expect(listedEmpty.result).toMatchObject({ok: true, running: null});
        expect(thirdParty(listedEmpty.result)).toEqual([]);
        expect(await stat(root).then(() => "exists", () => "missing")).toBe("missing");

        const source = await pluginSource("hello", PRODUCT_VERSION);
        const installed = await json(["plugin", "install", source, "--state-root", root]);
        expect(installed.result).toMatchObject({ok: true, restartRequired: true, stateRoot: root, preview: {id: "example.hello", relation: "install"}, plugin: {id: "example.hello", state: "enabled"}});
        expect(installed.stderr).toContain("插件完全受信任");
        expect(thirdParty((await json(["plugin", "list", "--state-root", root])).result)).toEqual([expect.objectContaining({id: "example.hello", state: "enabled", pending: []})]);
        expect(await json(["plugin", "install", source, "--state-root", root])).toMatchObject({exit: 1, result: {ok: false, code: "already-installed"}});

        expect(await json(["plugin", "disable", "example.hello", "--state-root", root])).toMatchObject({exit: 0, result: {ok: true, plugin: {state: "disabled"}}});
        expect(await json(["plugin", "enable", "nbook.http", "--state-root", root])).toMatchObject({exit: 1, result: {ok: false, code: "builtin-fixed"}});
        expect(await json(["plugin", "uninstall", "example.missing", "--state-root", root])).toMatchObject({exit: 1, result: {ok: false, code: "not-installed"}});
        expect(await json(["plugin", "uninstall", "example.hello", "--state-root", root])).toMatchObject({exit: 0, result: {ok: true, plugin: {state: "uninstalling"}}});
        expect(await readFile(join(root, "logs", "cli.jsonl"), "utf8")).toContain("plugins.uninstall.pending");
    }, 30_000);

    it("降级要 --yes：没有时以 2 退出、码 confirmation-required，不动登记表；加上之后装成", async () => {
        const root = nextRoot();
        expect((await json(["plugin", "install", await pluginSource("down", "2.0.0"), "--state-root", root])).result).toMatchObject({ok: true});
        const older = await pluginSource("down", "1.0.0");
        expect(await json(["plugin", "install", older, "--state-root", root])).toMatchObject({exit: 2, result: {ok: false, code: "confirmation-required", preview: {relation: "downgrade", installed: "2.0.0"}}});
        expect(thirdParty((await json(["plugin", "list", "--state-root", root])).result)).toEqual([expect.objectContaining({id: "example.down", version: "2.0.0"})]);
        expect(await json(["plugin", "install", older, "--state-root", root, "--yes"])).toMatchObject({exit: 0, result: {ok: true, preview: {relation: "downgrade"}}});
    }, 30_000);

    it("服务端运行时安装：列表带运行中的实例与“重启后安装”；重启服务之后服务端登记了它", async () => {
        const root = nextRoot();
        const first = run(["start", "--state-root", root, "--port", "0", "--no-open", "--json"]);
        expect(await first.result).toMatchObject({ok: true, started: true});
        expect((await json(["plugin", "install", await pluginSource("live", PRODUCT_VERSION), "--state-root", root])).result).toMatchObject({ok: true});
        const listed = (await json(["plugin", "list", "--state-root", root])).result;
        expect(listed).toMatchObject({running: {pid: first.pid}});
        expect(thirdParty(listed)).toEqual([expect.objectContaining({id: "example.live", pending: [{kind: "install"}]})]);

        first.signal("SIGTERM");
        expect(await first.exit).toBe(0);
        const second = run(["start", "--state-root", root, "--port", "0", "--no-open", "--json"]);
        expect(await second.result).toMatchObject({ok: true, started: true});
        const instance = await queryInstance(root);
        expect(instance).toMatchObject({state: "running", instance: {plugins: {items: [{id: "example.live", state: "enabled", notLoaded: null}]}}});
        expect(thirdParty((await json(["plugin", "list", "--state-root", root])).result)).toEqual([expect.objectContaining({id: "example.live", pending: []})]);
        second.signal("SIGTERM");
        expect(await second.exit).toBe(0);
    }, 60_000);

    it("--safe-mode：本次启动不加载第三方插件，实例应答与列表都标出安全模式", async () => {
        const root = nextRoot();
        expect((await json(["plugin", "install", await pluginSource("safe", PRODUCT_VERSION), "--state-root", root])).result).toMatchObject({ok: true});
        const server = run(["start", "--state-root", root, "--port", "0", "--no-open", "--json", "--safe-mode"]);
        expect(await server.result).toMatchObject({ok: true, started: true});
        expect(await queryInstance(root)).toMatchObject({state: "running", instance: {plugins: {safeMode: true, items: [{id: "example.safe", notLoaded: {code: "safe-mode"}}]}}});
        expect((await json(["plugin", "list", "--state-root", root])).result).toMatchObject({safeMode: true});
        server.signal("SIGTERM");
        expect(await server.exit).toBe(0);
    }, 30_000);

    it("清单无效：码 manifest-invalid，结果对象带逐条问题，说明里每条只出现一次", async () => {
        sequence += 1;
        const broken = join(tmp, "sources", `broken-${String(sequence)}`);
        await mkdir(broken, {recursive: true});
        await writeFile(join(broken, "package.json"), JSON.stringify({publisher: "example", name: "broken"}));
        const attempt = await json(["plugin", "install", broken, "--state-root", nextRoot()]);
        expect(attempt).toMatchObject({exit: 1, result: {ok: false, code: "manifest-invalid"}});
        const problems = attempt.result.problems as string[];
        expect(problems.length).toBeGreaterThan(0);
        for (const problem of problems) expect(String(attempt.result.message).split(problem).length - 1).toBe(1);
    }, 30_000);

    it("用法与提示：plugin 不跟子命令以 2 退出；路径不是插件目录时提示确认路径与 nbooke build", async () => {
        const bare = run(["plugin"]);
        expect(await bare.exit).toBe(2);
        const missing = await json(["plugin", "install", join(tmp, "no-such-plugin"), "--state-root", nextRoot()]);
        expect(missing).toMatchObject({exit: 1, result: {ok: false, code: "path-rejected"}});
        expect(String(missing.result.message)).toContain("nbooke build");
    }, 30_000);
});
