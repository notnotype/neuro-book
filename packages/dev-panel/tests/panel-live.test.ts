import {afterEach, describe, expect, test} from "bun:test";
import {randomBytes} from "node:crypto";
import {existsSync, readFileSync} from "node:fs";
import {chmod, mkdir, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {setTimeout as sleep} from "node:timers/promises";
import {locateRepository} from "../src/core/repo.js";
import {createLoginTicket} from "../src/server/auth.js";
import {GH_COMMANDS} from "../src/server/github.js";
import {CheckoutStatusCache} from "../src/server/live-views.js";
import {startPanelServer, type PanelServer} from "../src/server/serve.js";
import {cleanupFixtures, CLI_PATH, createFixture, git, panelEnv, type Fixture} from "./git-fixture.js";
import {startFakeClaude} from "./processes.js";

/**
 * t14 面板“现场”（L3）：GitHub 只读页（假 `gh`）、“在跑”（登记加去重）、checkout 页的新列。面板在进程内起，herdr 不连。
 */

const FAKE_GH = resolve(import.meta.dirname, "fixtures", "fake-gh.ts");
const FAKE_DEV = resolve(import.meta.dirname, "fixtures", "fake-dev.ts");
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close();
    await cleanupFixtures();
});

async function until<T>(read: () => T | Promise<T>, ok: (value: T) => boolean, ms: number, what: string): Promise<T> {
    const started = Date.now();
    for (;;) {
        const value = await read();
        if (ok(value)) return value;
        if (Date.now() - started > ms) throw new Error(`${ms} 毫秒内没等到：${what}（最后 ${JSON.stringify(value).slice(0, 300)}）`);
        await sleep(100);
    }
}

type Panel = {server: PanelServer; fixture: Fixture; cookie: string; get(path: string): Promise<{status: number; body: {data: Record<string, unknown>; errors: Array<{code: string}>}}>; post(path: string, csrf?: boolean, body?: unknown): Promise<{status: number}>};

/** 假 gh：sh 包装再交给 bun 跑 `fake-gh.ts`；模式写在一个文件里，测试中途可以改。 */
async function fakeGh(fixture: Fixture): Promise<{bin: string; log: string; mode: (value: string) => Promise<void>; env: Record<string, string>}> {
    const dir = join(fixture.root, "gh-bin");
    await mkdir(dir, {recursive: true});
    const bin = join(dir, "gh");
    await writeFile(bin, `#!/bin/sh\nexec '${process.execPath}' '${FAKE_GH}' "$@"\n`);
    await chmod(bin, 0o755);
    const log = join(fixture.root, "gh.log");
    const modeFile = join(fixture.root, "gh.mode");
    await writeFile(log, "");
    await writeFile(modeFile, "ok");
    return {bin, log, mode: (value) => writeFile(modeFile, value), env: {FAKE_GH_LOG: log, FAKE_GH_MODE_FILE: modeFile}};
}

async function startPanel(fixture: Fixture, env: Record<string, string>): Promise<Panel> {
    const token = randomBytes(32).toString("hex");
    const server = await startPanelServer({
        context: await locateRepository(fixture.main), host: "127.0.0.1", port: 0, artifactPort: 0, herdr: null, token, log: () => undefined,
        env: {...panelEnv(fixture), ...env},
    });
    closers.push(() => server.stop());
    const staticDir = join(fixture.root, "web");
    await mkdir(staticDir, {recursive: true});
    await writeFile(join(staticDir, "index.html"), "<!doctype html><html><head></head><body>panel</body></html>\n");
    await server.setStatic(staticDir, {failed: null});
    await server.warm();
    const cookie = `nbdev_panel_${server.port}=${server.auth.redeem(createLoginTicket(token))}`;
    const csrf = /name="nbdev-csrf" content="([^"]+)"/u.exec(await (await fetch(`${server.url}/`)).text())![1]!;
    return {
        server, fixture, cookie,
        async get(path) {
            const response = await fetch(`${server.url}${path}`, {headers: {Cookie: cookie}});
            return {status: response.status, body: await response.json() as {data: Record<string, unknown>; errors: Array<{code: string}>}};
        },
        async post(path, withCsrf = true, body = {}) {
            const response = await fetch(`${server.url}${path}`, {method: "POST", headers: {Cookie: cookie, Origin: server.url, ...(withCsrf ? {"X-Nbdev-Csrf": csrf} : {}), "Content-Type": "application/json"}, body: JSON.stringify(body)});
            await response.body?.cancel();
            return {status: response.status};
        },
    };
}

type GithubData = {state: string; error: string | null; at: string | null; prs: Array<Record<string, unknown>>; issues: Array<Record<string, unknown>>; truncated: {prs: boolean; issues: boolean}};

describe("GitHub 只读页（场景 5）", () => {
    test("只调写死的两条命令（带禁交互的环境变量）；检查汇总兼容 StatusContext；分支链到 Task；非 https 链接丢掉；条数到上限标截断；PATH 里没有 gh 时用 NBDEV_GH_BIN", async () => {
        const fixture = await createFixture("gh-ok");
        const gh = await fakeGh(fixture);
        const panel = await startPanel(fixture, {...gh.env, NBDEV_GH_BIN: gh.bin, PATH: join(fixture.root, "no-bin"), FAKE_GH_ISSUES: "100"});
        // GET 只读、不触发取数；打开页面时页面发 ifStale。
        await panel.get("/api/github");
        await sleep(500);
        expect(readFileSync(gh.log, "utf8")).toBe("");
        expect((await panel.post("/api/github/refresh", true, {ifStale: true})).status).toBe(200);
        const data = await until(async () => (await panel.get("/api/github")).body.data as GithubData, (value) => value.state === "ok", 15_000, "GitHub 数据");
        expect(data.prs[0]).toMatchObject({number: 7, title: "<b>标题</b> 加粗不生效", branch: "feat/w00001-t01-seed", draft: false, reviewDecision: null, url: "https://github.com/x/y/pull/7", task: {workId: "w00001-seed", taskId: "t01-seed"}});
        expect(data.prs[0]!.checks).toEqual({success: 2, failure: 3, pending: 1, failed: [{name: "test", workflow: "ci", url: "https://github.com/x/y/runs/2"}, {name: "test", workflow: "nightly", url: "https://github.com/x/y/runs/4"}, {name: "ci/legacy", workflow: null, url: null}]});
        expect(data.prs[1]).toMatchObject({number: 8, draft: true, reviewDecision: "APPROVED", url: null, task: null});
        expect(data.issues.length).toBe(100);
        expect(data.truncated).toEqual({prs: false, issues: true});
        const calls = readFileSync(gh.log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as {args: string[]; prompt: string; notifier: string; color: string});
        expect(calls.map((call) => call.args).sort()).toEqual([[...GH_COMMANDS.issues], [...GH_COMMANDS.prs]].sort());
        expect(calls.every((call) => call.prompt === "1" && call.notifier === "1" && call.color === "1")).toBe(true);
        // 刷新走写请求的 CSRF 校验。
        expect((await panel.post("/api/github/refresh", false)).status).toBe(403);
        expect((await panel.post("/api/github/refresh")).status).toBe(200);
    }, 40_000);

    test("降级：找不到 gh、没登录（以 4 退出）、输出读不懂；取过一次之后超时保留上一份并标 stale", async () => {
        const missing = await createFixture("gh-missing");
        const none = await startPanel(missing, {PATH: join(missing.root, "no-bin")});
        await none.post("/api/github/refresh", true, {ifStale: true});
        expect(await until(async () => (await none.get("/api/github")).body.data as GithubData, (value) => value.state === "unavailable", 10_000, "unavailable")).toMatchObject({error: expect.stringContaining("NBDEV_GH_BIN")});

        const fixture = await createFixture("gh-degrade");
        const gh = await fakeGh(fixture);
        const panel = await startPanel(fixture, {...gh.env, NBDEV_GH_BIN: gh.bin});
        await gh.mode("auth");
        await panel.post("/api/github/refresh");
        expect(((await panel.get("/api/github")).body.data as GithubData).state).toBe("not_logged_in");
        await gh.mode("bad");
        await panel.post("/api/github/refresh");
        expect(((await panel.get("/api/github")).body.data as GithubData)).toMatchObject({state: "error", error: expect.stringContaining("读不懂")});
        await gh.mode("ok");
        await panel.post("/api/github/refresh");
        const ok = (await panel.get("/api/github")).body.data as GithubData;
        expect(ok.state).toBe("ok");
        await gh.mode("slow");
        await panel.post("/api/github/refresh");
        const stale = (await panel.get("/api/github")).body.data as GithubData;
        expect(stale).toMatchObject({state: "stale", at: ok.at, error: expect.stringContaining("15 秒")});
        expect(stale.prs.length).toBe(2);
    }, 60_000);

    test("取不到数据时不成环（t14 实现审查 B1）：照页面的方式连着 /ws、每次推送就重取 GET，没登录、找不到 gh、出错三种状态下 10 秒里 gh 只跑一轮、推送有上限", async () => {
        type Probe = {mode: string; gh: Awaited<ReturnType<typeof fakeGh>> | null; panel: Panel; pushes: number; gets: number; ws: WebSocket};
        const probes: Probe[] = [];
        const pending: Array<Promise<unknown>> = [];
        for (const mode of ["auth", "missing", "fail"]) {
            const fixture = await createFixture(`gh-loop-${mode}`);
            const gh = mode === "missing" ? null : await fakeGh(fixture);
            if (gh) await gh.mode(mode);
            const panel = await startPanel(fixture, gh ? {...gh.env, NBDEV_GH_BIN: gh.bin} : {PATH: join(fixture.root, "no-bin")});
            const ws = new WebSocket(`ws://127.0.0.1:${panel.server.port}/ws`, {headers: {Cookie: panel.cookie, Origin: panel.server.url}} as unknown as string[]);
            closers.push(async () => ws.close());
            const probe: Probe = {mode, gh, panel, pushes: 0, gets: 0, ws};
            ws.onmessage = (event) => {
                const message = JSON.parse(String(event.data)) as {type: string; parts?: string[]};
                if (message.type !== "changed" || !(message.parts ?? []).includes("github")) return;
                probe.pushes += 1;
                probe.gets += 1;
                pending.push(panel.get("/api/github"));
            };
            await new Promise((resolveOpen) => (ws.onopen = resolveOpen));
            probes.push(probe);
        }
        // 打开页面：GET 一次，再发一次 ifStale。
        for (const probe of probes) {
            probe.gets += 1;
            await probe.panel.get("/api/github");
            expect((await probe.panel.post("/api/github/refresh", true, {ifStale: true})).status).toBe(200);
        }
        await sleep(10_000);
        for (const probe of probes) {
            const calls = probe.gh ? readFileSync(probe.gh.log, "utf8").trim().split("\n").filter(Boolean).length : 0;
            const state = ((await probe.panel.get("/api/github")).body.data as GithubData).state;
            // 一轮是两条命令（PR 与 Issue）。
            const expected: Record<string, string> = {auth: "not_logged_in", missing: "unavailable", fail: "error"};
            expect([probe.mode, state, calls <= 2, probe.pushes >= 1 && probe.pushes <= 2, probe.gets <= 3]).toEqual([probe.mode, expected[probe.mode]!, true, true, true]);
        }
        // 失败之后打开页面不到 60 秒不重取；“刷新”按钮照样立即取。
        const auth = probes[0]!;
        const before = readFileSync(auth.gh!.log, "utf8").trim().split("\n").length;
        await auth.panel.post("/api/github/refresh", true, {ifStale: true});
        await sleep(500);
        expect(readFileSync(auth.gh!.log, "utf8").trim().split("\n").length).toBe(before);
        await auth.panel.post("/api/github/refresh");
        expect(readFileSync(auth.gh!.log, "utf8").trim().split("\n").length).toBe(before + 2);
        for (const probe of probes) probe.ws.close();
        await Promise.all(pending);
    }, 60_000);
});

describe("“在跑”与 checkout 页", () => {
    test("“在跑”列出经 nbdev 起的服务；它的进程树不再出现在会话的运行里", async () => {
        const fixture = await createFixture("runs-view");
        await fixture.write("apps/web/package.json", JSON.stringify({name: "web", private: true, scripts: {dev: `bun ${FAKE_DEV}`}}));
        const claude = await startFakeClaude("cccccccc-3333-4ccc-8ccc-cccccccccccc");
        closers.push(() => claude.stop());
        const out = join(fixture.root, "dev.out");
        const supervisor = await claude.spawn("/bin/sh", ["-c", `exec '${process.execPath}' '${CLI_PATH}' dev start --package apps/web > '${out}' 2>&1`], {cwd: fixture.main});
        closers.push(async () => {
            if (existsSync(`/proc/${supervisor}`)) process.kill(supervisor, "SIGTERM");
            await until(() => existsSync(`/proc/${supervisor}`) && !readFileSync(`/proc/${supervisor}/stat`, "utf8").includes(") Z "), (alive) => !alive, 15_000, "监管进程退出");
        });
        await until(() => (existsSync(out) ? readFileSync(out, "utf8") : ""), (text) => text.includes("READY "), 20_000, "READY");
        const panel = await startPanel(fixture, {});
        const data = await until(async () => (await panel.get("/api/runs")).body.data as {procs: Array<Record<string, unknown>>; sessions: Array<{runs: Array<{pid: number; descendants: Array<{pid: number}>}>}>}, (value) => value.procs.length === 1, 15_000, "在跑");
        expect(data.procs[0]).toMatchObject({checkoutKey: "main", package: "apps/web", script: "dev", state: "running"});
        const sessionPids = data.sessions.flatMap((session) => session.runs.flatMap((run) => [run.pid, ...run.descendants.map((entry) => entry.pid)]));
        expect(sessionPids).not.toContain(supervisor);
    }, 60_000);

    test("checkout 页：没 add 的改动当场算进未提交，已跟踪与未跟踪分开数（未跟踪的目录算一条）；领先落后相对 master；Task 的 home 与在跑的服务；文件清单分三段", async () => {
        const fixture = await createFixture("checkouts-view");
        await fixture.write("docs/a.md", "一\n");
        await fixture.commit("a");
        expect((await fixture.cli(["worktree", "new", "w00001", "t01", "--json"])).exitCode).toBe(0);
        const worktree = join(fixture.main, ".worktree", "w00001-t01-seed");
        await fixture.write("docs/b.md", "二\n", worktree);
        await fixture.commit("b", worktree);
        await fixture.write("docs/a.md", "一改了\n");
        await fixture.write("notes/new-1.txt", "新\n");
        await fixture.write("notes/new-2.txt", "新\n");
        await fixture.write("scratch.txt", "新\n");
        const panel = await startPanel(fixture, {});
        const rows = ((await panel.get("/api/checkouts")).body.data as {checkouts: Array<Record<string, unknown>>}).checkouts;
        expect(rows.find((row) => row.isMain)).toMatchObject({key: "main", tracked: 1, untracked: 2, ahead: 0, behind: 0, timedOut: false, tasks: []});
        expect(rows.find((row) => !row.isMain)).toMatchObject({key: "w00001-t01-seed", tracked: 0, untracked: 0, ahead: 1, behind: 0, homeOf: [{workId: "w00001-seed", taskId: "t01-seed"}], tasks: [{workId: "w00001-seed", taskId: "t01-seed"}], runs: []});
        const files = await panel.get("/api/checkouts/main/files");
        expect(files.body.data).toMatchObject({key: "main", staged: [], unstaged: [{path: "docs/a.md", code: "M"}], untracked: ["notes/", "scratch.txt"], truncated: false, timedOut: false});
        expect((await panel.get("/api/checkouts/nope/files")).status).toBe(404);
    }, 60_000);

    test("checkout 的 git 调用各自限时：一个慢的到点标 timedOut、计数为 null，同一次算的另一个照常有数，整次不等慢的那个", async () => {
        const fixture = await createFixture("checkouts-timeout");
        await fixture.write("docs/a.md", "一\n");
        await fixture.commit("a");
        const head = (await git(fixture.main, "rev-parse", "HEAD")).trim();
        expect((await fixture.cli(["worktree", "new", "w00001", "t01", "--json"])).exitCode).toBe(0);
        const slow = join(fixture.main, ".worktree", "w00001-t01-seed");
        // git 替身：对慢的那个 checkout 换成 sleep（exec，到点 SIGKILL 结束的就是它，不留占着管道的子进程），其余交给真的 git。
        const bin = join(fixture.root, "slow-git-bin");
        await mkdir(bin, {recursive: true});
        const realGit = Bun.which("git")!;
        await writeFile(join(bin, "git"), `#!/bin/sh\ncase "$*" in *"${slow}"*) exec sleep 10;; esac\nexec ${realGit} "$@"\n`);
        await chmod(join(bin, "git"), 0o755);
        const path = process.env.PATH;
        process.env.PATH = `${bin}:${path}`;
        try {
            const started = Date.now();
            const statuses = await new CheckoutStatusCache(500).statuses([{root: slow, head}, {root: fixture.main, head}]);
            const elapsed = Date.now() - started;
            expect(statuses.get(slow)).toMatchObject({timedOut: true, tracked: null, untracked: null, ahead: null, behind: null});
            expect(statuses.get(fixture.main)).toMatchObject({timedOut: false, tracked: 0, untracked: 0, ahead: 0, behind: 0});
            expect(elapsed).toBeLessThan(3_000);
        } finally {
            process.env.PATH = path;
        }
    }, 30_000);
});
