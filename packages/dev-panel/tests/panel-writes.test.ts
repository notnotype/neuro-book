import {afterEach, describe, expect, test} from "bun:test";
import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {once} from "node:events";
import {mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {acquireRecordsLock} from "../src/core/lock.js";
import {readRegistry} from "../src/core/registry.js";
import {locateRepository} from "../src/core/repo.js";
import {sha256} from "../src/core/transaction.js";
import {createLoginTicket} from "../src/server/auth.js";
import {startPanelServer, type PanelServer} from "../src/server/serve.js";
import {CLI_PATH, cleanupFixtures, createFixture, git, panelEnv, run, taskReadme, type Fixture} from "./git-fixture.js";

/**
 * t10 面板写接口（L3）：服务在进程内起（端口取 0），前端产物用桩页面注入。场景 1 到 6 的接口部分、请求校验、
 * 错误码到 HTTP 的映射、漏掉的失败路径，以及外部客户端（curl）下的空闲超时与客户端断开。
 */

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close();
    await cleanupFixtures();
});

const TASK_DIR = ".agents/works/w00001-seed/tasks/t01-seed";
const TASK_README = `${TASK_DIR}/README.md`;
const ARTIFACT_DIR = `${TASK_DIR}/artifacts/review`;

type Body = {ok: boolean; data: Record<string, unknown> & {commit?: Record<string, unknown>}; errors: Array<{code: string; message: string; details?: Record<string, unknown>}>; warnings: Array<{code: string}>; revisions: Record<string, number>};
type Panel = {
    server: PanelServer;
    cookie: string;
    csrf: string;
    logs: string[];
    send(method: string, path: string, body: unknown, headers?: Record<string, string>): Promise<{status: number; body: Body}>;
    get(path: string): Promise<{status: number; body: Body}>;
};

async function startPanel(fixture: Fixture): Promise<Panel> {
    const staticDir = join(fixture.root, "web");
    await mkdir(staticDir, {recursive: true});
    await writeFile(join(staticDir, "index.html"), "<!doctype html><html><head><title>面板</title></head><body>panel-index</body></html>\n");
    const token = randomBytes(32).toString("hex");
    const logs: string[] = [];
    const server = await startPanelServer({context: await locateRepository(fixture.main), host: "127.0.0.1", port: 0, artifactPort: 0, herdr: null, token, log: (message) => logs.push(message), env: panelEnv(fixture)});
    closers.push(() => server.stop());
    await server.setStatic(staticDir, {failed: null});
    await server.warm();
    const cookie = `nbdev_panel_${server.port}=${server.auth.redeem(createLoginTicket(token))}`;
    const index = await (await fetch(`${server.url}/`)).text();
    const csrf = /name="nbdev-csrf" content="([^"]+)"/u.exec(index)![1]!;
    const parse = async (response: Response) => ({status: response.status, body: await response.json() as Body});
    return {
        server, cookie, csrf, logs,
        async send(method, path, body, headers = {}) {
            return parse(await fetch(`${server.url}${path}`, {
                method,
                headers: {Cookie: cookie, Origin: server.url, "X-Nbdev-Csrf": csrf, "Content-Type": "application/json", ...headers},
                body: typeof body === "string" ? body : JSON.stringify(body),
            }));
        },
        async get(path) {
            return parse(await fetch(`${server.url}${path}`, {headers: {Cookie: cookie}}));
        },
    };
}

function page(): string {
    return [
        "<!doctype html><title>评审板</title>",
        '<section data-nbdev-question="layout" data-nbdev-type="single"><h2>版式</h2>',
        '<div data-nbdev-option="cards"><h3>卡片</h3></div><div data-nbdev-option="table"><h3>表</h3></div></section>',
        '<section data-nbdev-question="approve" data-nbdev-type="confirm"><h2>批准</h2></section>',
    ].join("\n");
}

async function published(name: string): Promise<Fixture> {
    const fixture = await createFixture(name);
    await fixture.write(`${ARTIFACT_DIR}/index.html`, page());
    const result = await fixture.cli(["artifact", "publish", "w00001", "t01", "review", "--kind", "design", "--as", "bob", "--json"]);
    expect([result.exitCode, result.json?.errors]).toEqual([0, []]);
    return fixture;
}

/** 起一个挂着 `answers --wait` 的命令行子进程，等它在 stderr 报“等待中”才返回。 */
async function startWaiter(fixture: Fixture, args: string[]): Promise<{result: Promise<{exitCode: number | null; stdout: string}>}> {
    const child = spawn(process.execPath, [CLI_PATH, "answers", ...args, "--wait", "--json"], {cwd: fixture.main, env: process.env, stdio: ["ignore", "pipe", "pipe"]});
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
    });
    const waiting = new Promise<void>((resolveWaiting, rejectWaiting) => {
        child.stderr!.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf8");
            if (stderr.includes("等待中")) resolveWaiting();
        });
        child.once("exit", () => rejectWaiting(new Error(`等待的命令提前退出了：${stderr}`)));
    });
    const result = once(child, "exit").then(([code]) => ({exitCode: code as number | null, stdout}));
    closers.push(async () => {
        if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
            await once(child, "exit");
        }
    });
    await waiting;
    // 包一层：async 函数直接返回承诺会被展开，变成等子进程退出。
    return {result};
}

async function snapshot(fixture: Fixture): Promise<string> {
    return `${await git(fixture.main, "rev-parse", "HEAD")}\n${await git(fixture.main, "status", "--porcelain", "--untracked-files=all")}`;
}

async function hashOf(fixture: Fixture, path: string): Promise<string> {
    return sha256(await readFile(join(fixture.main, path)));
}

describe("答复（场景 1、2）", () => {
    test("场景 1：侧栏提交两道题：只多一个答复文件的提交，挂着的 answers --wait 退出并拿到它；回应之前缓存已重算", async () => {
        const fixture = await published("write-answer");
        const panel = await startPanel(fixture);
        const waiter = await startWaiter(fixture, ["w00001", "t01", "review", "--timeout", "60"]);
        const before = (await panel.get("/api/overview")).body.revisions.records!;
        const posted = await panel.send("POST", "/api/answers", {workId: "w00001-seed", taskId: "t01-seed", artifactId: "review", version: 1, values: {layout: "cards", approve: true}, comments: {layout: "卡片更直观"}, note: null});
        expect([posted.status, posted.body.errors]).toEqual([200, []]);
        expect(posted.body.revisions.records).toBeGreaterThan(before);
        const answer = posted.body.data.answer as {answerId: string; submittedBy: unknown; values: unknown};
        expect([answer.submittedBy, answer.values]).toEqual([{kind: "developer", device: "local"}, {layout: "cards", approve: true}]);
        expect((await git(fixture.main, "show", "--name-only", "--format=%s", "HEAD")).split("\n")).toEqual(["docs(w00001): t01 面板记下 review 的答复", "", `${ARTIFACT_DIR}/answers/${answer.answerId}.json`]);
        const view = await panel.get("/api/artifact/w00001-seed/t01-seed/review");
        expect((view.body.data.questions as Array<{state: string}>).map((question) => question.state)).toEqual(["answered", "answered"]);
        const waited = await Promise.race([waiter.result, Bun.sleep(5_000).then(() => null)]);
        expect(waited?.exitCode).toBe(0);
        const unacked = (JSON.parse(waited!.stdout) as {data: {artifacts: Array<{unacked: string[]}>}}).data.artifacts[0]!.unacked;
        expect(unacked).toEqual([answer.answerId]);
    }, 30_000);

    test("开发者在面板上关评审：没答的题撤回、离开收件箱，挂着的 --wait 醒来；提问集改成撤回没答的题；不存在的产物回 404", async () => {
        const fixture = await published("write-close-review");
        const panel = await startPanel(fixture);
        const waiter = await startWaiter(fixture, ["w00001", "t01", "review", "--timeout", "60"]);
        const base = {workId: "w00001-seed", taskId: "t01-seed"};
        const closed = await panel.send("POST", "/api/artifact-close", {...base, artifactId: "review"});
        expect([closed.status, closed.body.errors]).toEqual([200, []]);
        const view = await panel.get("/api/artifact/w00001-seed/t01-seed/review");
        expect([view.body.data.state, (view.body.data.questions as Array<{state: string}>).every((question) => question.state !== "open")]).toEqual(["closed", true]);
        const overview = await panel.get("/api/overview");
        expect((overview.body.data.inbox as unknown[]).length).toBe(0);
        const waited = await Promise.race([waiter.result, Bun.sleep(5_000).then(() => null)]);
        expect(waited?.exitCode).toBe(0);
        expect((await panel.send("POST", "/api/artifact-close", {...base, artifactId: "nope"})).status).toBe(404);
    }, 30_000);

    test("场景 2：伪造的题号回 404、__proto__ 之类的键回 400、旧版本回 409 stale_version；都不写文件", async () => {
        const fixture = await published("write-answer-forged");
        const panel = await startPanel(fixture);
        const before = await snapshot(fixture);
        const base = {workId: "w00001-seed", taskId: "t01-seed", artifactId: "review", version: 1};
        const forged = await panel.send("POST", "/api/answers", {...base, values: {"no-such": "x"}});
        expect([forged.status, forged.body.errors[0]?.code]).toEqual([404, "question_not_found"]);
        const proto = await panel.send("POST", "/api/answers", `{"workId":"w00001-seed","taskId":"t01-seed","artifactId":"review","version":1,"values":{"__proto__":"x"}}`);
        expect([proto.status, proto.body.errors[0]?.details?.reason]).toEqual([400, "question_id"]);
        const invalid = await panel.send("POST", "/api/answers", {...base, values: {layout: "nope"}});
        expect([invalid.status, invalid.body.errors[0]?.code]).toEqual([400, "invalid_answer"]);
        const control = await panel.send("POST", "/api/answers", {...base, values: {layout: "cards"}, note: "备注\u0000"});
        expect([control.status, control.body.errors[0]?.code]).toEqual([400, "invalid_text"]);
        const unknownArtifact = await panel.send("POST", "/api/answers", {...base, artifactId: "nope", values: {layout: "cards"}});
        expect(unknownArtifact.status).toBe(404);
        expect(await snapshot(fixture)).toBe(before);
        expect((await fixture.cli(["artifact", "publish", "w00001", "t01", "review", "--force-version", "--as", "bob", "--json"])).exitCode).toBe(0);
        const head = await snapshot(fixture);
        const stale = await panel.send("POST", "/api/answers", {...base, values: {layout: "cards"}});
        expect([stale.status, stale.body.errors[0]?.code, stale.body.errors[0]?.details?.latestVersion]).toEqual([409, "stale_version", 2]);
        expect(await snapshot(fixture)).toBe(head);
    }, 30_000);
});

describe("新建（场景 3）", () => {
    test("面板与命令行同时新建 Work：编号不同、都已提交、登记表两条都是 claimed；回应之后马上能打开新 Work", async () => {
        const fixture = await createFixture("write-create");
        const panel = await startPanel(fixture);
        const [viaPanel, viaCli] = await Promise.all([
            panel.send("POST", "/api/works", {slug: "panel", title: "面板建的", goal: "面板。", taskSlug: "first"}),
            fixture.cli(["work", "new", "cli", "--title", "命令行建的", "--goal", "命令行。", "--task", "first", "--as", "bob", "--json"]),
        ]);
        expect([viaPanel.status, viaCli.exitCode]).toEqual([200, 0]);
        const panelId = viaPanel.body.data.workId as string;
        const cliId = (viaCli.json?.data as {workId: string}).workId;
        expect(panelId.slice(0, 6)).not.toBe(cliId.slice(0, 6));
        expect([viaPanel.body.data.commit?.committed, (viaCli.json?.data as {commit?: unknown}) !== null]).toEqual([true, true]);
        expect(await git(fixture.main, "status", "--porcelain")).toBe("");
        const {registry} = await readRegistry(fixture.main);
        const entries = registry.works.filter((work) => work.workId === panelId || work.workId === cliId);
        expect(entries.map((entry) => [entry.status, entry.by?.key.startsWith("developer:") ?? false]).sort()).toEqual([["claimed", false], ["claimed", true]]);
        expect((await panel.get(`/api/work/${panelId}`)).status).toBe(200);
        const task = await panel.send("POST", `/api/works/${panelId}/tasks`, {slug: "second", title: "第二个", goal: null, status: "active"});
        expect([task.status, task.body.data.taskId]).toEqual([200, "t02-second"]);
        expect((await panel.get(`/api/task/${panelId}/t02-second`)).status).toBe(200);
    }, 30_000);

    test("预览走 POST：长目标也能预览；不写任何文件（主工作区、worktree、Git 目录）", async () => {
        const fixture = await createFixture("write-preview");
        const worktree = await fixture.addWorktree("wt", "feat/wt");
        const panel = await startPanel(fixture);
        const marker = join(fixture.root, "marker");
        await writeFile(marker, "");
        await Bun.sleep(20);
        const goal = "很长的目标。".repeat(400);
        const work = await panel.send("POST", "/api/preview/work", {slug: "panel", title: "面板", goal, taskSlug: "first"});
        expect([work.status, work.body.data.workId, (work.body.data.files as Record<string, string>)[".agents/works/w00002-panel/README.md"]?.includes(goal)]).toEqual([200, "w00002-panel", true]);
        const partial = await panel.send("POST", "/api/preview/work", {slug: "Bad", title: ""});
        expect((partial.body.data.problems as Array<{field: string}>).map((problem) => problem.field)).toEqual(["slug", "taskSlug", "title", "goal"]);
        const task = await panel.send("POST", "/api/preview/task", {workId: "w00001-seed", slug: "next", title: "下一个"});
        expect(task.body.data.taskId).toBe("t02-next");
        expect((await panel.get(`/api/files?path=${encodeURIComponent(TASK_README)}`)).status).toBe(200);
        const commonDir = join(fixture.main, ".git");
        const touched = await run("find", [fixture.main, worktree, commonDir, "-newer", marker, "-not", "-path", `${fixture.main}/.local/*`], fixture.root);
        expect(touched.stdout.trim().split("\n").filter((line) => line !== "" && line !== `${fixture.main}/.local`)).toEqual([]);
    }, 30_000);
});

describe("编辑（场景 4）", () => {
    test("先改后打开：差异分两段、默认拒绝；确认后连同改动一起提交", async () => {
        const fixture = await createFixture("write-edit-dirty");
        const panel = await startPanel(fixture);
        const original = await readFile(join(fixture.main, TASK_README), "utf8");
        await fixture.write(TASK_README, original.replace("正文。", "正文。\n会话加的一行。"));
        const opened = await panel.get(`/api/files?path=${encodeURIComponent(TASK_README)}`);
        const file = opened.body.data as {text: string; hash: string; editable: boolean; uncommitted: {unstaged: string; staged: null}};
        expect([file.editable, file.uncommitted.staged, file.uncommitted.unstaged.includes("+会话加的一行。")]).toEqual([true, null, true]);
        const head = await git(fixture.main, "rev-parse", "HEAD");
        const content = `${file.text}面板加的一行。\n`;
        const refused = await panel.send("PUT", `/api/files?path=${encodeURIComponent(TASK_README)}`, {content, baseHash: file.hash});
        expect([refused.status, refused.body.errors[0]?.code, refused.body.errors[0]?.details?.currentHash]).toEqual([409, "uncommitted_changes", file.hash]);
        await git(fixture.main, "add", TASK_README);
        const staged = await panel.send("PUT", `/api/files?path=${encodeURIComponent(TASK_README)}`, {content, baseHash: file.hash});
        expect([staged.body.errors[0]?.code, String(staged.body.errors[0]?.details?.staged).includes("+会话加的一行。")]).toEqual(["uncommitted_changes", true]);
        expect(await git(fixture.main, "rev-parse", "HEAD")).toBe(head);
        const saved = await panel.send("PUT", `/api/files?path=${encodeURIComponent(TASK_README)}`, {content, baseHash: file.hash, includeUncommitted: true});
        expect([saved.status, saved.body.data.changed, (saved.body.data.text as string).includes("updated: ")]).toEqual([200, true, true]);
        const committed = await git(fixture.main, "show", `HEAD:${TASK_README}`);
        expect([committed.includes("会话加的一行。"), committed.includes("面板加的一行。")]).toEqual([true, true]);
        expect(saved.body.data.nextHash).toBe(await hashOf(fixture, TASK_README));
        const unchanged = await panel.send("PUT", `/api/files?path=${encodeURIComponent(TASK_README)}`, {content: saved.body.data.text, baseHash: saved.body.data.nextHash});
        expect([unchanged.status, unchanged.body.data.changed, unchanged.body.data.commit?.reason]).toEqual([200, false, "nothing_to_commit"]);
    }, 30_000);

    test("先打开后改：hash_mismatch（带 currentHash），文件不变、没有提交；README 的 status 不能在编辑里改", async () => {
        const fixture = await createFixture("write-edit-stale");
        const panel = await startPanel(fixture);
        const file = (await panel.get(`/api/files?path=${encodeURIComponent(TASK_README)}`)).body.data as {text: string; hash: string};
        const sessionText = file.text.replace("正文。", "正文，会话改的。");
        await fixture.write(TASK_README, sessionText);
        const head = await git(fixture.main, "rev-parse", "HEAD");
        const stale = await panel.send("PUT", `/api/files?path=${encodeURIComponent(TASK_README)}`, {content: `${file.text}x\n`, baseHash: file.hash});
        expect([stale.status, stale.body.errors[0]?.code, stale.body.errors[0]?.details?.currentHash]).toEqual([409, "hash_mismatch", await hashOf(fixture, TASK_README)]);
        expect([await readFile(join(fixture.main, TASK_README), "utf8"), await git(fixture.main, "rev-parse", "HEAD")]).toEqual([sessionText, head]);
        await git(fixture.main, "checkout", "--", TASK_README);
        const fresh = (await panel.get(`/api/files?path=${encodeURIComponent(TASK_README)}`)).body.data as {text: string; hash: string};
        const status = await panel.send("PUT", `/api/files?path=${encodeURIComponent(TASK_README)}`, {content: fresh.text.replace("taskId: t01-seed", "taskId: t01-seed\nstatus: done"), baseHash: fresh.hash});
        expect([status.status, status.body.errors[0]?.code]).toEqual([400, "invalid_record_edit"]);
        expect((await panel.get(`/api/files?path=${encodeURIComponent("random/x.md")}`)).status).toBe(404);
    }, 30_000);
});

describe("状态（场景 5）与来自分支的记录（场景 6）", () => {
    test("场景 5：Task 改为 done：只改 status 与 updated 两行；租约释放；首页的谁在动清零", async () => {
        const fixture = await createFixture("write-status");
        await fixture.write(TASK_README, taskReadme("t01-seed", "status: active\nupdated: 2026-01-01\n"));
        await fixture.commit("active");
        expect((await fixture.cli(["lease", "take", "w00001", "t01", "--as", "bob", "--json"])).exitCode).toBe(0);
        const panel = await startPanel(fixture);
        const task = (await panel.get("/api/task/w00001-seed/t01-seed")).body.data as {task: {readmeHash: string}};
        expect(task.task.readmeHash).toBe(await hashOf(fixture, TASK_README));
        const stale = await panel.send("POST", "/api/works/w00001-seed/tasks/t01-seed/status", {status: "done", expectedHash: "0".repeat(64)});
        expect([stale.status, stale.body.errors[0]?.code]).toEqual([409, "hash_mismatch"]);
        const done = await panel.send("POST", "/api/works/w00001-seed/tasks/t01-seed/status", {status: "done", expectedHash: task.task.readmeHash});
        expect([done.status, done.body.data.changed, (done.body.data.released as unknown[]).length]).toEqual([200, true, 1]);
        expect(await git(fixture.main, "show", "--name-only", "--format=%s", "HEAD")).toBe(`docs(w00001): t01-seed 状态改为 done（面板）\n\n${TASK_README}`);
        const diff = (await git(fixture.main, "diff", "HEAD~1", "HEAD", "--unified=0", "--", TASK_README)).split("\n").filter((line) => /^[-+][^-+]/u.test(line));
        expect(diff).toEqual(["-status: active", "-updated: 2026-01-01", `+status: done`, expect.stringMatching(/^\+updated: \d{4}-\d{2}-\d{2}$/u)]);
        const leases = (await fixture.cli(["lease", "list", "--all", "--json"])).json?.data as {leases: Array<{state: string}>};
        expect(leases.leases.map((lease) => lease.state)).toEqual(["released"]);
        const overview = (await panel.get("/api/overview")).body.data as {works: Array<{tasks: Array<{leaseCount: number}>}>};
        expect(overview.works[0]!.tasks[0]!.leaseCount).toBe(0);
        const again = await panel.send("POST", "/api/works/w00001-seed/tasks/t01-seed/status", {status: "done", expectedHash: done.body.data.commit ? await hashOf(fixture, TASK_README) : ""});
        expect([again.status, again.body.data.changed]).toEqual([200, false]);
    }, 30_000);

    test("场景 6：记录在分支上维护的 Task：读得到但不能编辑，编辑与状态都回 409；在它的 Work 下新建 Task 照常写进 master", async () => {
        const fixture = await createFixture("write-branch");
        const worktree = await fixture.addWorktree("w2", "feat/w2");
        await fixture.addWork("w00002-branchy", ["t01-x"], worktree);
        await fixture.commit("branch work", worktree);
        await fixture.addWork("w00002-branchy", ["t01-x"]);
        await fixture.commit("old copy on master");
        await fixture.write(".agents/works/w00002-branchy/tasks/t01-x/README.md", taskReadme("t01-x", "status: active\n"), worktree);
        await fixture.commit("branch edit", worktree);
        const panel = await startPanel(fixture);
        const path = ".agents/works/w00002-branchy/tasks/t01-x/README.md";
        const file = (await panel.get(`/api/files?path=${encodeURIComponent(path)}`)).body.data as {editable: boolean; reason: {code: string}; hash: string};
        expect([file.editable, file.reason.code]).toEqual([false, "branch_maintained_record"]);
        const edit = await panel.send("PUT", `/api/files?path=${encodeURIComponent(path)}`, {content: "x\n", baseHash: file.hash});
        expect([edit.status, edit.body.errors[0]?.code]).toEqual([409, "branch_maintained_record"]);
        const status = await panel.send("POST", "/api/works/w00002-branchy/tasks/t01-x/status", {status: "done", expectedHash: file.hash});
        expect([status.status, status.body.errors[0]?.code]).toEqual([409, "branch_maintained_record"]);
        const created = await panel.send("POST", "/api/works/w00002-branchy/tasks", {slug: "on-master", title: "写进 master"});
        expect([created.status, created.body.data.taskId]).toEqual([200, "t02-on-master"]);
        expect(await git(fixture.main, "show", "--name-only", "--format=", "HEAD")).toBe(".agents/works/w00002-branchy/tasks/t02-on-master/README.md");
    }, 30_000);
});

describe("请求校验与失败路径", () => {
    test("没登录 401（带有效的 CSRF 与同源 Origin）、缺 CSRF 403、跨来源 403、跨站 403、Content-Type 415、超长 413、多余字段 400、控制字符 400、没有的写路由 405", async () => {
        const fixture = await createFixture("write-guards");
        const panel = await startPanel(fixture);
        const before = await snapshot(fixture);
        const body = JSON.stringify({slug: "x", title: "x", goal: "x", taskSlug: "y"});
        const post = (headers: Record<string, string>, payload = body, path = "/api/works") => fetch(`${panel.server.url}${path}`, {method: "POST", headers, body: payload});
        const good = {Cookie: panel.cookie, Origin: panel.server.url, "X-Nbdev-Csrf": panel.csrf, "Content-Type": "application/json"};
        expect((await post({...good, Cookie: ""})).status).toBe(401);
        expect((await post({...good, "X-Nbdev-Csrf": ""})).status).toBe(403);
        expect((await post({...good, Origin: "http://evil.example"})).status).toBe(403);
        expect((await post({...good, "Sec-Fetch-Site": "cross-site"})).status).toBe(403);
        expect((await post({...good, "Content-Type": "text/plain"})).status).toBe(415);
        expect((await post(good, JSON.stringify({slug: "x", title: "x", goal: "长".repeat(20_000), taskSlug: "y"}))).status).toBe(413);
        const extra = await panel.send("POST", "/api/works", {slug: "x", title: "x", goal: "x", taskSlug: "y", taskStauts: "active"});
        expect([extra.status, extra.body.errors[0]?.details?.field]).toEqual([400, "taskStauts"]);
        const wrongType = await panel.send("POST", "/api/works", {slug: 1, title: "x", goal: "x", taskSlug: "y"});
        expect([wrongType.status, wrongType.body.errors[0]?.details?.field]).toEqual([400, "slug"]);
        const array = await panel.send("POST", "/api/works", "[]");
        expect(array.status).toBe(400);
        const control = await panel.send("POST", "/api/works", {slug: "x", title: "标题\u0007", goal: "x", taskSlug: "y"});
        expect([control.status, control.body.errors[0]?.code]).toEqual([400, "invalid_title"]);
        expect((await panel.send("DELETE", "/api/works", {})).status).toBe(405);
        expect((await panel.send("POST", "/api/overview", {})).status).toBe(405);
        expect(await snapshot(fixture)).toBe(before);
    }, 30_000);

    test("主工作区不在 master：/api/meta 标不能写，写请求 409 main_not_on_master、什么都不写；Work README 未提交时新建 Task 409 work_not_committed", async () => {
        const fixture = await createFixture("write-main-state");
        await fixture.addWork("w00002-fresh", ["t01-a"]);
        const panel = await startPanel(fixture);
        const fresh = await panel.send("POST", "/api/works/w00002-fresh/tasks", {slug: "b", title: "b"});
        expect([fresh.status, fresh.body.errors[0]?.code]).toEqual([409, "work_not_committed"]);
        await rm(join(fixture.main, ".agents/works/w00002-fresh"), {recursive: true});
        await git(fixture.main, "checkout", "--quiet", "-b", "side");
        const meta = (await panel.get("/api/meta")).body.data as {mainWritable: {ok: boolean; code: string}};
        expect(meta.mainWritable).toMatchObject({ok: false, code: "main_not_on_master"});
        const before = await snapshot(fixture);
        const refused = await panel.send("POST", "/api/works", {slug: "x", title: "x", goal: "x", taskSlug: "y"});
        expect([refused.status, refused.body.errors[0]?.code]).toEqual([409, "main_not_on_master"]);
        expect(await snapshot(fixture)).toBe(before);
        await git(fixture.main, "checkout", "--quiet", "master");
        expect(((await panel.get("/api/meta")).body.data as {mainWritable: {ok: boolean}}).mainWritable.ok).toBe(true);
    }, 30_000);

    test("index.lock 一直被占：提交阶段超时回 500 commit_failed，writtenPaths 非空", async () => {
        const fixture = await createFixture("write-index-lock");
        const panel = await startPanel(fixture);
        const hash = await hashOf(fixture, TASK_README);
        const lock = join(fixture.main, ".git/index.lock");
        await writeFile(lock, "");
        try {
            const result = await panel.send("POST", "/api/works/w00001-seed/tasks/t01-seed/status", {status: "active", expectedHash: hash});
            expect([result.status, result.body.errors[0]?.code, result.body.errors[0]?.details?.writtenPaths]).toEqual([500, "commit_failed", [TASK_README]]);
            expect(result.body.data.commit).toMatchObject({committed: false, reason: "git_lock_timeout"});
        } finally {
            await rm(lock, {force: true});
        }
    }, 40_000);
});

describe("外部客户端（空闲超时与断开）", () => {
    async function curlPost(panel: Panel, path: string, body: unknown, maxTime: number): Promise<{exitCode: number | null; stdout: string}> {
        const result = await run("curl", ["-sS", "--max-time", String(maxTime), "-X", "POST", "-H", `Cookie: ${panel.cookie}`, "-H", `Origin: ${panel.server.url}`, "-H", `X-Nbdev-Csrf: ${panel.csrf}`, "-H", "Content-Type: application/json", "--data", JSON.stringify(body), `${panel.server.url}${path}`], "/", undefined, 90_000);
        return {exitCode: result.exitCode, stdout: result.stdout};
    }

    test("等锁 15 秒：连接不被切断，只领一个号", async () => {
        const fixture = await createFixture("write-idle");
        const panel = await startPanel(fixture);
        const lock = await acquireRecordsLock(fixture.main);
        const release = Bun.sleep(15_000).then(() => lock.release());
        const result = await curlPost(panel, "/api/works", {slug: "slow", title: "慢", goal: "等锁。", taskSlug: "first"}, 60);
        await release;
        expect(result.exitCode).toBe(0);
        expect((JSON.parse(result.stdout) as Body).data.workId).toBe("w00002-slow");
        expect((await readdir(join(fixture.main, ".agents/works"))).sort()).toEqual(["w00001-seed", "w00002-slow"]);
    }, 60_000);

    test("客户端 3 秒后断开、锁在那之后才放：什么都不写（request_aborted 只进日志）", async () => {
        const fixture = await createFixture("write-abort");
        const panel = await startPanel(fixture);
        const before = await snapshot(fixture);
        const lock = await acquireRecordsLock(fixture.main);
        const release = Bun.sleep(6_000).then(() => lock.release());
        const result = await curlPost(panel, "/api/works", {slug: "gone", title: "断开", goal: "断开。", taskSlug: "first"}, 3);
        expect(result.exitCode).toBe(28);
        await release;
        for (let attempt = 0; attempt < 100 && !panel.logs.some((line) => line.includes("客户端在写之前断开")); attempt += 1) await Bun.sleep(50);
        expect(panel.logs.some((line) => line.includes("客户端在写之前断开"))).toBe(true);
        expect(await snapshot(fixture)).toBe(before);
        expect((await readRegistry(fixture.main)).registry.works.some((work) => work.workId.startsWith("w00002"))).toBe(false);
    }, 30_000);
});
