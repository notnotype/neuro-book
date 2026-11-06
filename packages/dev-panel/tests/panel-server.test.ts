import {afterEach, describe, expect, test} from "bun:test";
import {randomBytes, randomUUID} from "node:crypto";
import {appendFile, mkdir, rm, symlink, utimes, writeFile} from "node:fs/promises";
import {once} from "node:events";
import {connect} from "node:net";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {locateRepository} from "../src/core/repo.js";
import {createHerdrClient, HERDR_PANEL_READ_METHODS} from "../src/herdr/client.js";
import {createLoginTicket} from "../src/server/auth.js";
import {computeBuildHash, ensureWebBuild} from "../src/server/build.js";
import {backoffDelay, HerdrMonitor} from "../src/server/herdr-monitor.js";
import {startPanelServer, type PanelServer} from "../src/server/serve.js";
import {claudePane, shellPane, startFakeHerdr, type FakeHerdr} from "./fake-herdr.js";
import {holdFileLeases} from "./file-lease.js";
import {cleanupFixtures, createFixture, git, panelEnv, run, taskReadme, workReadme, type Fixture} from "./git-fixture.js";
import {startFakeClaude, spawnMarked, stopProcess, type MarkedChild} from "./processes.js";

/** L3：面板服务在进程内起（端口取 0），前端产物用桩页面注入，不依赖 dist/web。 */

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close();
    await cleanupFixtures();
});

type Panel = {
    server: PanelServer;
    token: string;
    fake: FakeHerdr | null;
    cookie: string;
    logs: string[];
    get(path: string, headers?: Record<string, string>): Promise<Response>;
    json<T = Record<string, unknown>>(path: string): Promise<{status: number; body: {ok: boolean; data: T; errors: Array<{code: string}>; revisions: Record<string, number>; instance: string}}>;
};

async function startPanel(fixture: Fixture, panes: Parameters<typeof startFakeHerdr>[1] | null = []): Promise<Panel> {
    const staticDir = join(fixture.root, "web");
    await mkdir(join(staticDir, "assets"), {recursive: true});
    await writeFile(join(staticDir, "index.html"), "<!doctype html><html><head><title>面板</title></head><body>panel-index</body></html>\n");
    await writeFile(join(staticDir, "assets", "app.js"), "console.log('panel');\n");
    const fake = panes === null ? null : await startFakeHerdr(fixture.root, panes);
    if (fake) closers.push(() => fake.close());
    const token = randomBytes(32).toString("hex");
    const logs: string[] = [];
    const server = await startPanelServer({
        context: await locateRepository(fixture.main),
        host: "127.0.0.1",
        port: 0,
        artifactPort: 0,
        herdr: fake ? createHerdrClient({socketPath: fake.socketPath, allow: HERDR_PANEL_READ_METHODS}) : null,
        token,
        log: (message) => logs.push(message),
        env: panelEnv(fixture),
    });
    closers.push(() => server.stop());
    await server.setStatic(staticDir, {failed: null});
    await server.warm();
    const sessionId = server.auth.redeem(createLoginTicket(token))!;
    const cookie = `nbdev_panel_${server.port}=${sessionId}`;
    const get = (path: string, headers: Record<string, string> = {}) => fetch(`${server.url}${path}`, {headers: {Cookie: cookie, ...headers}, redirect: "manual"});
    return {
        server, token, fake, cookie, logs, get,
        async json(path) {
            const response = await get(path);
            return {status: response.status, body: await response.json()};
        },
    } as Panel;
}

/** 原始 HTTP 请求：fetch 会先把 `..`、`%2e%2e` 规范化掉，测到的是 URL 解析器而不是守卫。 */
function rawGet(port: number, path: string, headers: Record<string, string> = {}): Promise<{status: number; text: string}> {
    return new Promise((resolvePromise, rejectPromise) => {
        const socket = connect(port, "127.0.0.1");
        let data = "";
        socket.setEncoding("utf8");
        socket.on("connect", () => {
            const lines = [`GET ${path} HTTP/1.1`, `Host: 127.0.0.1:${port}`, "Connection: close", ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`), "", ""];
            socket.write(lines.join("\r\n"));
        });
        socket.on("data", (chunk: string) => {
            data += chunk;
        });
        socket.on("end", () => resolvePromise({status: Number(data.slice(9, 12)), text: data}));
        socket.on("error", rejectPromise);
    });
}

async function publishedFixture(name: string): Promise<Fixture> {
    const fixture = await createFixture(name);
    await fixture.write(".agents/works/w00002-alpha/README.md", workReadme("w00002-alpha", "status: active\n").replace("w00002-alpha 的目标。", "做一个面板。"));
    await fixture.write(".agents/works/w00002-alpha/tasks/t01-board/README.md", `${taskReadme("t01-board", "status: active\n")}\n## 当前状态\n\n第二轮评审中。\n`);
    await fixture.write(".agents/works/w00003-branchy/README.md", workReadme("w00003-branchy"));
    await fixture.write(".agents/works/w00003-branchy/tasks/t01-old/README.md", taskReadme("t01-old"));
    await fixture.commit("works");
    const worktree = await fixture.addWorktree("w00003-branchy", "feat/w00003");
    await fixture.write(".agents/works/w00003-branchy/tasks/t01-old/README.md", taskReadme("t01-old", "status: active\n"), worktree);
    await fixture.commit("branch records", worktree);
    await fixture.write(".agents/works/w00002-alpha/tasks/t01-board/artifacts/review/index.html", [
        "<!doctype html><title>评审板</title>",
        '<section data-nbdev-question="layout" data-nbdev-type="single"><h2>版式</h2><div data-nbdev-option="cards"><h3>卡片</h3></div><div data-nbdev-option="table"><h3>表</h3></div></section>',
        '<section data-nbdev-question="approve" data-nbdev-type="confirm"><h2>批准</h2></section>',
        '<img src="shot.png">',
    ].join("\n"));
    await writeFile(join(fixture.main, ".agents/works/w00002-alpha/tasks/t01-board/artifacts/review/shot.png"), randomBytes(64));
    expect((await fixture.cli(["artifact", "publish", "w00002", "t01", "review", "--kind", "design", "--as", "bob", "--json"])).exitCode).toBe(0);
    return fixture;
}

describe("面板服务（场景）", () => {
    test("场景 1：概览列出全部 Work（状态与目标、来自分支、未标）、收件箱的提问与提问者是否还在；herdr 的状态变化 1 秒内推到 /ws", async () => {
        const fixture = await publishedFixture("panel-s1");
        const sessionId = randomUUID();
        // 会话标题从本机的 Claude Code 会话文件里读（t15 阶段 4 第 3 批）。文件在面板起来之前就有：找不到的会话文件要记 60 秒。
        const project = join(panelEnv(fixture).HOME!, ".claude", "projects", "-repo");
        await mkdir(project, {recursive: true});
        const sessionFile = join(project, `${sessionId}.jsonl`);
        await writeFile(sessionFile, `${JSON.stringify({type: "ai-title", aiTitle: "会话页重做", sessionId})}\n`);
        const panel = await startPanel(fixture, [claudePane("w9:p1", sessionId, {cwd: fixture.main})]);
        const {status, body} = await panel.json<{works: Array<{workId: string; status: {value: string | null}; goal: {value: string | null}; source: string; tasks: Array<{taskId: string; currentState: string | null}>}>; inbox: Array<{kind: string; questionId?: string; askedBy?: string; askerActive?: boolean}>}>("/api/overview");
        expect(status).toBe(200);
        expect(body.data.works.map((work) => [work.workId, work.status.value, work.goal.value, work.source])).toEqual([
            ["w00001-seed", null, "w00001-seed 的目标。", "master"],
            ["w00002-alpha", "active", "做一个面板。", "master"],
            ["w00003-branchy", null, "w00003-branchy 的目标。", "branch"],
        ]);
        expect(body.data.works[1]!.tasks[0]).toMatchObject({taskId: "t01-board", currentState: "第二轮评审中。"});
        // Work 页的 Task 表与首页同一个口径数待答（t15 阶段 4 第 2 批审查：/api/work 原来不带这个数，表格总是 0）。
        const workPage = await panel.json<{tasks: Array<{taskId: string; waiting: number}>}>("/api/work/w00002-alpha");
        expect(workPage.body.data.tasks.map((task) => [task.taskId, task.waiting])).toEqual([["t01-board", 2]]);
        expect(body.data.inbox.map((item) => [item.questionId, item.askedBy, item.askerActive])).toEqual([["approve", "external:bob", true], ["layout", "external:bob", true]]);

        while (panel.fake!.subscriberCount() === 0) await Bun.sleep(20);
        const socket = new WebSocket(`${panel.server.url.replace("http", "ws")}/ws`, {headers: {Cookie: panel.cookie, Origin: panel.server.url}} as unknown as string[]);
        closers.push(async () => socket.close());
        const messages: Array<{type: string; parts?: string[]}> = [];
        socket.addEventListener("message", (event) => messages.push(JSON.parse(String(event.data))));
        while (!messages.some((message) => message.type === "hello")) await Bun.sleep(10);
        const started = Date.now();
        panel.fake!.panes[0]!.agent_status = "working";
        panel.fake!.emit("pane.agent_status_changed", {pane_id: "w9:p1", workspace_id: "w9", agent_status: "working"});
        while (!messages.some((message) => message.type === "changed" && message.parts?.includes("sessions"))) await Bun.sleep(10);
        expect(Date.now() - started).toBeLessThan(1_000);
        // 标题由活动刷新之后的后台任务读（t17）：herdr 报上这格之后，这格没有租约也带上标题。
        type SessionsBody = {panes: Array<{paneId: string; status: string; inRepository: boolean; title: {text: string; source: string} | null}>};
        const sessions = await waitUntil("会话页带上标题", async () => {
            const body = (await panel.json<SessionsBody>("/api/sessions")).body;
            return body.data.panes[0]?.title ? body : null;
        });
        expect(sessions.data.panes).toEqual([expect.objectContaining({paneId: "w9:p1", status: "working", inRepository: true, title: {text: "会话页重做", source: "claude-ai-title"}})]);
        // 文件更新之后，下一轮活动刷新（有浏览器连着时每 5 秒）之后读到新标题，并推 activity 的 changed 给已打开的页面。
        const changedBefore = messages.filter((message) => message.type === "changed" && message.parts?.includes("activity")).length;
        await appendFile(sessionFile, `${JSON.stringify({type: "ai-title", aiTitle: "会话页重做：两栏", sessionId})}\n`);
        const paneTitles = async () => (await panel.json<SessionsBody>("/api/sessions")).body.data.panes.map((pane) => [pane.paneId, pane.title]);
        await waitUntil("取到新标题", async () => JSON.stringify(await paneTitles()) === JSON.stringify([["w9:p1", {text: "会话页重做：两栏", source: "claude-ai-title"}]]), {timeoutMs: 15_000, intervalMs: 50});
        await waitUntil("标题变了推 activity", () => messages.filter((message) => message.type === "changed" && message.parts?.includes("activity")).length > changedBefore);
    }, 30_000);

    test("场景 2：产物页的题与状态、答复；iframe 地址在产物来源上、带随机前缀；改了页面没发布时标出来；产物来源只给 .agents/works/ 下的文件", async () => {
        const fixture = await publishedFixture("panel-s2");
        expect((await fixture.cli(["answers", "record", "w00002", "t01", "review", "--set", "approve=yes", "--as", "bob", "--json"])).exitCode).toBe(0);
        await fixture.write(".agents/works/w00002-alpha/tasks/t01-board/artifacts/review/index.html", (await Bun.file(join(fixture.main, ".agents/works/w00002-alpha/tasks/t01-board/artifacts/review/index.html")).text()).replace('data-nbdev-question="layout"', 'data-nbdev-question="layout-v2"'));
        expect((await fixture.cli(["artifact", "publish", "w00002", "t01", "review", "--as", "bob", "--json"])).exitCode).toBe(0);
        // 页面没有引用的未跟踪文件（检查页面时的截图）不在文件集里，不算改动；页面引用的图片改了才算。
        await fixture.write(".agents/works/w00002-alpha/tasks/t01-board/artifacts/review/notes.txt", "没被引用的草稿\n");
        const panel = await startPanel(fixture, null);
        type ArtifactData = {versions: number[]; version: number; questions: Array<{question: {id: string}; state: string}>; answers: unknown[]; pageUrl: string; unpublishedChanges: boolean};
        expect((await panel.json<ArtifactData>("/api/artifact/w00002-alpha/t01-board/review")).body.data.unpublishedChanges).toBe(false);
        await writeFile(join(fixture.main, ".agents/works/w00002-alpha/tasks/t01-board/artifacts/review/shot.png"), randomBytes(64));
        const {body} = await panel.json<ArtifactData>("/api/artifact/w00002-alpha/t01-board/review");
        expect([body.data.versions, body.data.version, body.data.questions.map((state) => [state.question.id, state.state]), body.data.answers.length, body.data.unpublishedChanges]).toEqual([
            [1, 2], 2, [["layout", "superseded"], ["approve", "answered"], ["layout-v2", "open"]], 1, true,
        ]);
        const v1 = await panel.json<ArtifactData>("/api/artifact/w00002-alpha/t01-board/review?version=1");
        expect(v1.body.data.questions.map((state) => state.question.id)).toEqual(["layout", "approve"]);
        expect((await panel.get("/api/artifact/w00002-alpha/t01-board/review?version=9")).status).toBe(404);
        expect((await panel.get("/api/artifact/w00002-alpha/t01-board/nope")).status).toBe(404);

        const page = new URL(body.data.pageUrl);
        expect(`${page.protocol}//${page.host}`).toBe(panel.server.artifactUrl);
        const html = await fetch(page);
        expect([html.status, html.headers.get("access-control-allow-origin"), html.headers.get("content-security-policy")?.startsWith("sandbox allow-scripts allow-forms allow-popups")]).toEqual([200, "*", true]);
        expect(await html.text()).toContain("data-nbdev-question");
        const prefix = page.pathname.split("/")[2]!;
        const origin = panel.server.artifactUrl;
        expect((await fetch(`${origin}/a/${prefix}/main/.agents/works/w00002-alpha/tasks/t01-board/artifacts/review/shot.png`)).status).toBe(200);
        for (const path of [`/a/${prefix}/main/package.json`, `/a/${prefix}/main/.gitignore`, `/a/wrong-prefix/main/.agents/works/w00002-alpha/README.md`, `/a/${prefix}/_nbdev/x.js`, `/a/${prefix}/nope/.agents/works/w00002-alpha/README.md`]) {
            expect([path, (await fetch(`${origin}${path}`)).status]).toEqual([path, 404]);
        }
        expect((await fetch(`${origin}/a/${prefix}/main/.agents/works/w00002-alpha/README.md`, {method: "POST"})).status).toBe(405);
    }, 30_000);

    test("场景 3：记录在 master、代码在 worktree 的 Task：执行 checkout 是那个 worktree；文档树切到它时标出与 master 的差异；文档只给白名单里的路径", async () => {
        const fixture = await createFixture("panel-s3");
        await fixture.write("docs/specs/ui/shell.md", "# 外壳\n");
        await fixture.write(".agents/works/w00001-seed/tasks/t02-impl/README.md", `${taskReadme("t02-impl", "status: active\n")}\n## 执行位置\n\nworktree \`.worktree/w00001-t02-impl\`。\n\n见 [Spec](../../../../../docs/specs/ui/shell.md)。\n`);
        await fixture.write(".agents/works/w00001-seed/tasks/t02-impl/requirements.md", "# 需求\n");
        await fixture.commit("t02 on master");
        const worktree = await fixture.addWorktree("w00001-t02-impl", "t02/impl");
        await fixture.write("docs/specs/ui/shell.md", "# 外壳 v2\n", worktree);
        await fixture.write("docs/specs/ui/new.md", "# 新\n", worktree);
        await fixture.commit("spec draft", worktree);
        const panel = await startPanel(fixture, null);
        const task = await panel.json<{task: {checkoutKey: string}; detail: {execution: {chosen: {key: string; rule: string}; candidates: Array<{key: string}>}; specs: string[]; commits: {entries: Array<{subject: string}>}}}>("/api/task/w00001-seed/t02-impl");
        expect([task.body.data.task.checkoutKey, task.body.data.detail.execution.chosen, task.body.data.detail.execution.candidates.map((candidate) => candidate.key), task.body.data.detail.specs, task.body.data.detail.commits.entries.map((entry) => entry.subject)]).toEqual([
            "main", expect.objectContaining({key: "w00001-t02-impl", rule: "readme"}), ["w00001-t02-impl", "main"], ["docs/specs/ui/shell.md"], ["spec draft"],
        ]);
        const tree = await panel.json<{checkout: {key: string; branch: string | null; isMain: boolean}; docs: Array<{path: string}>; changes: Array<{path: string; change: string}>}>("/api/docs/tree?checkout=w00001-t02-impl");
        expect([tree.body.data.checkout, tree.body.data.changes]).toEqual([{key: "w00001-t02-impl", branch: "t02/impl", isMain: false}, [{path: "docs/specs/ui/new.md", change: "added"}, {path: "docs/specs/ui/shell.md", change: "modified"}]]);
        expect((await panel.json("/api/docs/tree?checkout=main")).body.data).toMatchObject({changes: []});
        const file = await panel.json<{title: string; changedIn: string[]}>("/api/docs/file?checkout=main&path=docs/specs/ui/shell.md");
        expect([file.body.data.title, file.body.data.changedIn]).toEqual(["外壳", ["w00001-t02-impl"]]);
        expect((await panel.json<{title: string}>("/api/docs/file?checkout=w00001-t02-impl&path=docs/specs/ui/shell.md")).body.data.title).toBe("外壳 v2");
        expect((await panel.json<{title: string}>("/api/docs/file?checkout=main&path=.agents/works/w00001-seed/tasks/t02-impl/requirements.md")).body.data.title).toBe("需求");
        for (const path of [".gitignore", "package.json", ".agents/works/w00001-seed/tasks/t02-impl/requirements.md"]) {
            const checkout = path.endsWith("requirements.md") ? "w00001-t02-impl" : "main";
            expect([path, checkout, (await panel.get(`/api/docs/file?checkout=${checkout}&path=${encodeURIComponent(path)}`)).status]).toEqual([path, checkout, 404]);
        }
        expect((await panel.get("/api/docs/tree?checkout=nope")).status).toBe(404);
    }, 30_000);

    test("文档与 master 的差异（t15 阶段 4 第 4 批）：与文档树同口径，树上标的每一种改动差异接口回同一类型、差异非空；没改的回 null；白名单之外 404", async () => {
        const fixture = await createFixture("panel-doc-diff");
        await fixture.write("docs/specs/ui/shell.md", "# 外壳\n");
        await fixture.write("docs/specs/ui/old.md", "# 旧\n");
        await fixture.write("docs/specs/ui/same.md", "# 不变\n");
        await fixture.commit("docs");
        const worktree = await fixture.addWorktree("w00001-t02-impl", "t02/impl");
        await fixture.write("docs/specs/ui/shell.md", "# 外壳 v2\n", worktree);
        await fixture.write("docs/specs/ui/new.md", "# 新\n", worktree);
        await rm(join(worktree, "docs/specs/ui/old.md"));
        await fixture.commit("branch edits", worktree);
        await fixture.write("docs/specs/ui/draft.md", "# 草稿\n还没提交\n", worktree);
        await fixture.write("docs/specs/ui/later.md", "# 后来\n");
        await fixture.commit("master later");
        const panel = await startPanel(fixture, null);
        const tree = await panel.json<{changes: Array<{path: string; change: string}>}>("/api/docs/tree?checkout=w00001-t02-impl");
        expect(tree.body.data.changes.map((entry) => entry.change).sort()).toEqual(["added", "added", "deleted", "master_only", "modified"]);
        for (const entry of tree.body.data.changes) {
            const diff = await panel.json<{change: string | null; text: string; mergeBase: string | null}>(`/api/docs/diff?checkout=w00001-t02-impl&path=${encodeURIComponent(entry.path)}`);
            expect([entry.path, diff.body.data.change, diff.body.data.text.includes("@@")]).toEqual([entry.path, entry.change, true]);
            expect([entry.path, diff.body.data.mergeBase === null]).toEqual([entry.path, entry.change === "master_only"]);
        }
        const texts = async (path: string) => (await panel.json<{text: string}>(`/api/docs/diff?checkout=w00001-t02-impl&path=${encodeURIComponent(path)}`)).body.data.text;
        expect(await texts("docs/specs/ui/draft.md")).toContain("+还没提交");
        expect(await texts("docs/specs/ui/old.md")).toContain("-# 旧");
        expect(await texts("docs/specs/ui/later.md")).toContain("+# 后来");
        expect(await texts("docs/specs/ui/shell.md")).toContain("+# 外壳 v2");
        expect((await panel.json<{change: string | null; text: string}>("/api/docs/diff?checkout=w00001-t02-impl&path=docs/specs/ui/same.md")).body.data).toMatchObject({change: null, text: ""});
        expect((await panel.json<{change: string | null}>("/api/docs/diff?checkout=main&path=docs/specs/ui/shell.md")).body.data.change).toBeNull();
        for (const path of ["package.json", "docs/specs/ui/nope.md", "../outside.md"]) {
            expect([path, (await panel.get(`/api/docs/diff?checkout=w00001-t02-impl&path=${encodeURIComponent(path)}`)).status]).toEqual([path, 404]);
        }
    }, 30_000);

    test("文档接口走路径守卫：指向 .env 与仓库外的 .md 符号链接不进树、读不到；worktree 里没暂存的删除记成 deleted、不在树里", async () => {
        const fixture = await createFixture("panel-doc-guard");
        await fixture.write("docs/specs/ui/shell.md", "# 外壳\n");
        await fixture.write(".env", "SECRET_TOKEN=hunter2\n");
        await mkdir(join(fixture.main, "docs/specs/ui"), {recursive: true});
        await symlink("../../../.env", join(fixture.main, "docs/specs/ui/leak.md"));
        await symlink("/etc/hostname", join(fixture.main, "docs/specs/ui/host.md"));
        await git(fixture.main, "add", "-f", "--", "docs/specs/ui/leak.md", "docs/specs/ui/host.md", "docs/specs/ui/shell.md");
        await git(fixture.main, "commit", "--quiet", "-m", "docs with links", "--", "docs/specs/ui/leak.md", "docs/specs/ui/host.md", "docs/specs/ui/shell.md");
        const worktree = await fixture.addWorktree("w00001-line", "feat/w00001");
        await rm(join(worktree, "docs/specs/ui/shell.md"));
        const panel = await startPanel(fixture, null);
        const tree = await panel.json<{docs: Array<{path: string}>}>("/api/docs/tree?checkout=main");
        expect(tree.body.data.docs.map((doc) => doc.path)).toEqual(["docs/specs/ui/shell.md"]);
        for (const path of ["docs/specs/ui/leak.md", "docs/specs/ui/host.md"]) {
            const response = await panel.get(`/api/docs/file?checkout=main&path=${encodeURIComponent(path)}`);
            expect([path, response.status, (await response.text()).includes("hunter2")]).toEqual([path, 404, false]);
        }
        const branch = await panel.json<{docs: Array<{path: string}>; changes: Array<{path: string; change: string}>}>("/api/docs/tree?checkout=w00001-line");
        expect([branch.body.data.docs.map((doc) => doc.path), branch.body.data.changes]).toEqual([[], [{path: "docs/specs/ui/shell.md", change: "deleted"}]]);
    }, 30_000);

    test("场景 4：会话 idle、它派出的进程还在跑：会话页里会话是 idle，运行列在它下面；普通 shell 里的进程归无主", async () => {
        const fixture = await createFixture("panel-s4");
        const claude = await startFakeClaude(randomUUID());
        closers.push(() => claude.stop());
        const tool = await claude.spawn("sleep", ["61"], {cwd: fixture.main});
        const shell = await spawnMarked("sh", ["-c", "sleep 62; true"], {cwd: fixture.main, env: {HERDR_PANE_ID: "w9:pJ"}});
        closers.push(() => stopProcess(shell));
        const panel = await startPanel(fixture, [claudePane("w9:p1", claude.sessionId, {foreground_pids: [claude.pid], cwd: fixture.main}), shellPane("w9:pJ", {shell_pid: shell.pid, cwd: fixture.main})]);
        type SessionsData = {sessions: Array<{key: string; herdr: {status: string} | null; runs: Array<{pid: number}>}>; unownedRuns: Array<{paneId: string | null; command: string}>};
        let data = (await panel.json<SessionsData>("/api/sessions")).body.data;
        // herdr 的状态随后补上（不阻塞启动），活动在它变了以后重算。
        for (let attempt = 0; attempt < 100 && !(data.sessions.length > 0 && data.unownedRuns.length > 0); attempt += 1) {
            await Bun.sleep(50);
            data = (await panel.json<SessionsData>("/api/sessions")).body.data;
        }
        expect(data.sessions).toEqual([expect.objectContaining({key: `claude:${claude.sessionId}`, herdr: {paneId: "w9:p1", status: "idle"}, runs: [expect.objectContaining({pid: tool})]})]);
        expect(data.unownedRuns).toEqual([expect.objectContaining({paneId: "w9:pJ", command: "sleep 62"})]);
        expect(panel.fake!.requests.every((request) => HERDR_PANEL_READ_METHODS.includes(request.method))).toBe(true);
    }, 30_000);
});

/** 会话标题的文件：Claude Code 的会话文件与 omp 的会话文件，都放在面板的 HOME 下（t17）。 */
async function claudeTitleFile(fixture: Fixture, sessionId: string, title: string): Promise<string> {
    const project = join(panelEnv(fixture).HOME!, ".claude", "projects", "-repo");
    await mkdir(project, {recursive: true});
    const file = join(project, `${sessionId}.jsonl`);
    await writeFile(file, `${JSON.stringify({type: "ai-title", aiTitle: title, sessionId})}\n`);
    return file;
}

function ompSessionPath(fixture: Fixture, id: string): string {
    // omp 的会话值是文件的绝对路径；目录名带冒号，键只能按第一个冒号拆。
    return join(panelEnv(fixture).HOME!, ".omp", "agent", "sessions", "-repo:main", `2026-10-14T01-00-00-000Z_${id}.jsonl`);
}

async function ompTitleFile(path: string, title: string): Promise<void> {
    await mkdir(join(path, ".."), {recursive: true});
    await writeFile(path, `${JSON.stringify({type: "title", v: 1, title, source: "auto"})}\n`);
}

type Titles = Record<string, {text: string; source: string}>;

/** 登记一次经 nbdev 起过、已经结束的服务，属主是 `owner`：它就成了要读标题的会话，不需要 herdr 或租约。 */
async function registerEndedRun(fixture: Fixture, owner: {key: string; agent: string}): Promise<void> {
    const procs = join(fixture.main, ".local", "agent", "run", "procs");
    await mkdir(procs, {recursive: true});
    const now = new Date().toISOString();
    const bootId = (await Bun.file("/proc/sys/kernel/random/boot_id").text()).trim();
    const runId = "dev-20261014T010000Z-0e0e0e0e";
    await writeFile(join(procs, `${runId}.json`), JSON.stringify({
        schema: "nbdev.proc/v1", runId, kind: "dev", checkout: fixture.main, checkoutKey: "main", package: "apps/web", script: "dev", argv: [],
        logPath: join(fixture.root, "dev.log"), bootId, startedAt: now, startedBy: {...owner, label: null, process: null},
        supervisor: {pid: 1, startTicks: "0"}, endedAt: now, endedReason: "exited", exitCode: 0,
    }));
}

describe("会话标题（t17）", () => {
    test("首页、Work 页、Task 页、运行页各带 sessionTitles，只放本视图出现的会话：首页含已不在活动里的提问者，运行页含只剩进程登记的属主；会话页的 title 取自同一份", async () => {
        const fixture = await createFixture("panel-titles-views");
        const asker = await startFakeClaude(randomUUID());
        closers.push(() => asker.stop());
        const worker = await startFakeClaude(randomUUID());
        closers.push(() => worker.stop());
        await claudeTitleFile(fixture, asker.sessionId, "提问的会话");
        await claudeTitleFile(fixture, worker.sessionId, "在动的会话");
        const ompPath = ompSessionPath(fixture, "0c0c0c0c-0000-4000-8000-000000000000");
        await ompTitleFile(ompPath, "起服务的会话");

        // 提问者发布一道必答题后退出：租约失效、不在活动里，收件箱里还留着它的键。
        await fixture.write(".agents/works/w00001-seed/tasks/t01-seed/artifacts/review/index.html", '<!doctype html><title>评审</title><section data-nbdev-question="approve" data-nbdev-type="confirm"><h2>批准</h2></section>\n');
        const publish = await asker.cli(["artifact", "publish", "w00001", "t01", "review", "--kind", "design", "--json"], fixture.main);
        expect([publish.exitCode, publish.json?.errors]).toEqual([0, []]);
        await asker.stop();
        expect((await worker.cli(["lease", "take", "w00001", "t01", "--json"], fixture.main)).exitCode).toBe(0);
        expect((await fixture.cli(["lease", "take", "w00001", "t01", "--as", "bob", "--json"])).exitCode).toBe(0);
        // 经 nbdev 起过、已经结束的服务：属主只剩登记里的 startedBy。
        const procs = join(fixture.main, ".local", "agent", "run", "procs");
        await mkdir(procs, {recursive: true});
        const now = new Date().toISOString();
        const bootId = (await Bun.file("/proc/sys/kernel/random/boot_id").text()).trim();
        await writeFile(join(procs, "dev-20261014T010000Z-0a0b0c0d.json"), JSON.stringify({
            schema: "nbdev.proc/v1", runId: "dev-20261014T010000Z-0a0b0c0d", kind: "dev", checkout: fixture.main, checkoutKey: "main", package: "apps/web", script: "dev", argv: [],
            logPath: join(fixture.root, "dev.log"), bootId, startedAt: now, startedBy: {key: `omp:${ompPath}`, agent: "omp", label: null, process: null},
            supervisor: {pid: 1, startTicks: "0"}, endedAt: now, endedReason: "exited", exitCode: 0,
        }));

        const panel = await startPanel(fixture, []);
        const askerKey = `claude:${asker.sessionId}`;
        const workerKey = `claude:${worker.sessionId}`;
        const ompKey = `omp:${ompPath}`;
        // 标题由活动刷新之后的后台任务读，一轮读完一起并进快照：首页带上两个标题时，各视图用的是同一份。
        await waitUntil("标题读进快照", async () => Object.keys((await panel.json<{sessionTitles: Titles}>("/api/overview")).body.data.sessionTitles).length === 2, {intervalMs: 50});
        const overview = (await panel.json<{inbox: Array<{askedBy?: string | null; askerActive?: boolean | null}>; sessionTitles: Titles}>("/api/overview")).body.data;
        expect(overview.inbox.map((item) => [item.askedBy, item.askerActive])).toEqual([[askerKey, false]]);
        expect(overview.sessionTitles).toEqual({
            [askerKey]: {text: "提问的会话", source: "claude-ai-title"},
            [workerKey]: {text: "在动的会话", source: "claude-ai-title"},
        });
        expect((await panel.json<{sessionTitles: Titles}>("/api/work/w00001-seed")).body.data.sessionTitles).toEqual({[workerKey]: {text: "在动的会话", source: "claude-ai-title"}});
        expect((await panel.json<{sessionTitles: Titles}>("/api/task/w00001-seed/t01-seed")).body.data.sessionTitles).toEqual({[workerKey]: {text: "在动的会话", source: "claude-ai-title"}});
        const runs = (await panel.json<{procs: Array<{startedBy: {key: string} | null}>; sessionTitles: Titles}>("/api/runs")).body.data;
        expect(runs.procs.map((run) => run.startedBy?.key)).toEqual([ompKey]);
        expect(runs.sessionTitles).toEqual({[ompKey]: {text: "起服务的会话", source: "omp"}});
        const sessions = (await panel.json<{sessions: Array<{key: string; title: unknown}>}>("/api/sessions")).body.data.sessions;
        expect(sessions.map((session) => [session.key, session.title]).sort()).toEqual([[workerKey, {text: "在动的会话", source: "claude-ai-title"}], ["external:bob", null]]);
    }, 60_000);

    test("标题改名、文件删掉、文件后来出现：已打开的页面收到 activity 的 changed，再取到的是新标题", async () => {
        const fixture = await createFixture("panel-titles-refresh");
        const worker = await startFakeClaude(randomUUID());
        closers.push(() => worker.stop());
        const file = await claudeTitleFile(fixture, worker.sessionId, "第一版");
        expect((await worker.cli(["lease", "take", "w00001", "t01", "--json"], fixture.main)).exitCode).toBe(0);
        // herdr 上一格 omp 会话，它的会话文件还没建。
        const ompPath = ompSessionPath(fixture, "0d0d0d0d-0000-4000-8000-000000000000");
        const ompPane = {...claudePane("w9:p2", ompPath, {cwd: fixture.main}), agent: "omp", agent_session: {agent: "omp", kind: "path", source: "herdr:omp", value: ompPath}};
        const panel = await startPanel(fixture, [ompPane]);
        const workerKey = `claude:${worker.sessionId}`;
        const ompKey = `omp:${ompPath}`;
        const socket = new WebSocket(`${panel.server.url.replace("http", "ws")}/ws`, {headers: {Cookie: panel.cookie, Origin: panel.server.url}} as unknown as string[]);
        closers.push(async () => socket.close());
        let activityChanges = 0;
        socket.addEventListener("message", (event) => {
            const message = JSON.parse(String(event.data)) as {type: string; parts?: string[]};
            if (message.type === "changed" && message.parts?.includes("activity")) activityChanges += 1;
        });
        await waitUntil("连上 /ws", () => socket.readyState === WebSocket.OPEN);
        const taskTitles = async () => (await panel.json<{sessionTitles: Titles}>("/api/task/w00001-seed/t01-seed")).body.data.sessionTitles;
        const titlesAre = (expected: Titles) => async () => JSON.stringify(await taskTitles()) === JSON.stringify(expected);
        await waitUntil("读到第一版标题", titlesAre({[workerKey]: {text: "第一版", source: "claude-ai-title"}}), {intervalMs: 50});
        const paneTitle = async () => (await panel.json<{panes: Array<{paneId: string; title: unknown}>}>("/api/sessions")).body.data.panes.find((pane) => pane.paneId === "w9:p2")?.title;
        await waitUntil("herdr 报上 omp 那一格", async () => (await panel.json<{panes: unknown[]}>("/api/sessions")).body.data.panes.length === 1);
        expect(await paneTitle()).toBeNull();

        // 每一步：等取到新标题（有浏览器连着时活动每 5 秒重算一次，之后的后台任务读标题），再等这次变化推来的 activity changed。
        async function afterChange(change: () => Promise<void>, settled: () => Promise<boolean>): Promise<void> {
            const before = activityChanges;
            await change();
            await waitUntil("取到新标题", settled, {timeoutMs: 15_000, intervalMs: 50});
            await waitUntil("标题变了推 activity", () => activityChanges > before);
        }
        const activityRevision = async () => (await panel.json("/api/runs")).body.revisions.activity!;
        // 文字不变、只有来源变了（自动起的名被 /rename 成同一个名字）：页面显示的来源变了，照样增加 revision、推送。
        const beforeSource = await activityRevision();
        await afterChange(() => appendFile(file, `${JSON.stringify({type: "custom-title", customTitle: "第一版"})}\n`), titlesAre({[workerKey]: {text: "第一版", source: "claude-custom"}}));
        expect(await activityRevision()).toBeGreaterThan(beforeSource);
        await afterChange(() => appendFile(file, `${JSON.stringify({type: "custom-title", customTitle: "改过的名"})}\n`), titlesAre({[workerKey]: {text: "改过的名", source: "claude-custom"}}));
        await afterChange(() => rm(file), titlesAre({}));
        await afterChange(() => ompTitleFile(ompPath, "后来建的"), async () => JSON.stringify(await paneTitle()) === JSON.stringify({text: "后来建的", source: "omp"}));
        expect((await panel.json<{sessionTitles: Titles}>("/api/overview")).body.data.sessionTitles).toEqual({});

        // 读到的 {text, source} 不变时不推送：omp 的文件按原样重写（修改时间变了，会重读），同时 Claude 的文件重新出现。
        // 读到 Claude 新标题的那一轮一定也重读了 omp 的文件；两处只有 Claude 一处变了，revision 只能多 1。
        const beforeSame = await activityRevision();
        await afterChange(async () => {
            await ompTitleFile(ompPath, "后来建的");
            await writeFile(file, `${JSON.stringify({type: "ai-title", aiTitle: "又回来了"})}\n`);
        }, titlesAre({[workerKey]: {text: "又回来了", source: "claude-ai-title"}}));
        expect(await activityRevision()).toBe(beforeSame + 1);
        expect(await paneTitle()).toEqual({text: "后来建的", source: "omp"});
    }, 60_000);

    test("运行中停止：读标题卡在文件系统上时，stop 等那次读盘结束才返回；返回之后快照与 revision 不再变", async () => {
        const fixture = await createFixture("panel-titles-stop");
        const sessionId = randomUUID();
        const file = await claudeTitleFile(fixture, sessionId, "停止后才读完的标题");
        await registerEndedRun(fixture, {key: `claude:${sessionId}`, agent: "claude"});
        // 标题文件挂上租约：面板读它的 open() 卡在内核里，直到测试放掉。
        const leases = await holdFileLeases([file]);
        closers.push(() => leases.close());
        const panel = await startPanel(fixture, null);
        await waitUntil("读标题卡在打开文件上", async () => (await leases.states())[0] === "breaking");
        const revision = panel.server.state.revisions().activity;
        expect((await panel.json<{sessionTitles: Titles}>("/api/runs")).body.data.sessionTitles).toEqual({});

        let released = false;
        const stopping = panel.server.stop().then(() => released);
        // 端口关了：stop 除了等读标题，别的收口都做完了。这时还没放租约，stop 不能已经返回。
        const refused = (url: string) => fetch(url).then(() => false, () => true);
        await waitUntil("面板的两个端口都已关闭", async () => await refused(panel.server.url) && await refused(panel.server.artifactUrl));
        released = true;
        await leases.release(0);
        expect(await stopping).toBe(true);
        // 读盘已经结束：面板关了标题文件，租约才挂得回去。读到的标题没有并进快照。
        await leases.reacquire(0);
        expect(panel.server.state.revisions().activity).toBe(revision);
        expect(panel.server.state.activity.part.value?.sessionTitles).toEqual({});
    }, 30_000);

    test("预热中停止：预热之后算出的活动不再起读标题，预热与 stop 返回之后没有打开过标题文件、快照里没有标题", async () => {
        const fixture = await createFixture("panel-titles-warm-stop");
        const sessionId = randomUUID();
        const file = await claudeTitleFile(fixture, sessionId, "不该读到的标题");
        await registerEndedRun(fixture, {key: `claude:${sessionId}`, agent: "claude"});
        // 有人打开标题文件，租约就会进入 breaking：用它看停止之后有没有读标题。
        const leases = await holdFileLeases([file]);
        closers.push(() => leases.close());
        const server = await startPanelServer({
            context: await locateRepository(fixture.main), host: "127.0.0.1", port: 0, artifactPort: 0, herdr: null,
            token: randomBytes(32).toString("hex"), log: () => undefined, env: panelEnv(fixture),
        });
        closers.push(() => server.stop());
        // 预热的第一步要等 git，stop 一定落在预热中途；预热随后照常算一遍记录与活动。
        const warming = server.warm();
        await server.stop();
        expect(await warming).toBe(false);
        expect(server.state.activity.part.value?.procs.map((run) => run.startedBy?.key)).toEqual([`claude:${sessionId}`]);
        expect(await leases.states()).toEqual(["held"]);
        expect(server.state.activity.part.value?.sessionTitles).toEqual({});
    }, 30_000);
});

describe("面板服务的安全", () => {
    test("场景 5：Host 不对、带转发头、跨站请求、没登录、跨来源的写请求与 WebSocket 都被拒；登录票据用一次作废", async () => {
        const fixture = await publishedFixture("panel-s5");
        const panel = await startPanel(fixture, null);
        const port = panel.server.port;
        expect(port).toBeGreaterThan(0);
        expect((await fetch(`${panel.server.url}/api/meta`, {headers: {Cookie: panel.cookie, Host: "evil.example"}})).status).toBe(421);
        expect((await panel.get("/api/overview", {"X-Forwarded-For": "1.2.3.4"})).status).toBe(403);
        expect((await panel.get("/api/overview", {"Sec-Fetch-Site": "cross-site"})).status).toBe(403);
        expect((await panel.get("/api/overview", {"Sec-Fetch-Site": "same-origin"})).status).toBe(200);
        expect((await fetch(`${panel.server.url}/api/overview`)).status).toBe(401);
        expect((await fetch(`${panel.server.url}/api/overview`, {method: "POST", headers: {Cookie: panel.cookie, Origin: "http://evil.example"}})).status).toBe(403);
        expect((await fetch(`${panel.server.url}/api/overview`, {method: "POST", headers: {Cookie: panel.cookie, Origin: panel.server.url}})).status).toBe(403);
        const index = await (await panel.get("/")).text();
        const csrf = /name="nbdev-csrf" content="([^"]+)"/u.exec(index)![1]!;
        expect((await fetch(`${panel.server.url}/api/overview`, {method: "POST", headers: {Cookie: panel.cookie, Origin: panel.server.url, "X-Nbdev-Csrf": csrf}})).status).toBe(405);
        // 写请求先过登录：没有 cookie 时，令牌与同源 Origin 都对也回 401（令牌在不要求登录的页面里，本机人人读得到）。
        expect((await fetch(`${panel.server.url}/api/overview`, {method: "POST", headers: {Origin: panel.server.url, "X-Nbdev-Csrf": csrf}})).status).toBe(401);
        // cookie 名带端口：别的端口的同名前缀 cookie 不算登录。
        expect((await fetch(`${panel.server.url}/api/overview`, {headers: {Cookie: panel.cookie.replace(`nbdev_panel_${panel.server.port}=`, "nbdev_panel_1=")}})).status).toBe(401);
        const upgrade = await fetch(`${panel.server.url}/ws`, {headers: {Cookie: panel.cookie, Origin: "http://evil.example", Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": randomBytes(16).toString("base64")}});
        expect(upgrade.status).toBe(403);

        const login = (ticket: string) => fetch(`${panel.server.url}/login?ticket=${encodeURIComponent(ticket)}`, {redirect: "manual"});
        const ticket = createLoginTicket(panel.token);
        const first = await login(ticket);
        expect([first.status, first.headers.get("location")]).toEqual([302, "/"]);
        expect((await login(ticket)).status).toBe(403);
        expect((await login(createLoginTicket("token-of-another-instance"))).status).toBe(403);
        expect((await login(createLoginTicket(panel.token, Date.now() - 10 * 60_000))).status).toBe(403);
        expect((await login("garbage")).status).toBe(403);
    }, 30_000);

    test("场景 5：URL 解析器先折叠 .. 与 %2e%2e，剩下的段再检查：折叠后指向 .git 的回 404，..%2f、%00、不合法的百分号编码回 400，都不回 500；/../../etc/passwd 回 index.html 而不是文件；符号链接与 .env、node_modules 拿不到", async () => {
        const fixture = await publishedFixture("panel-s5-paths");
        await mkdir(join(fixture.main, ".agents/works/w00002-alpha/tasks/t01-board/artifacts/review/node_modules"), {recursive: true});
        await writeFile(join(fixture.main, ".agents/works/w00002-alpha/tasks/t01-board/artifacts/review/node_modules/x.js"), "secret\n");
        await writeFile(join(fixture.main, ".agents/works/w00002-alpha/tasks/t01-board/artifacts/review/.env"), "SECRET=1\n");
        await symlink(join(fixture.main, ".git/config"), join(fixture.main, ".agents/works/w00002-alpha/tasks/t01-board/artifacts/review/config-link"));
        await symlink("/etc/passwd", join(fixture.main, ".agents/works/w00002-alpha/tasks/t01-board/artifacts/review/outside-link"));
        const panel = await startPanel(fixture, null);
        const panelPaths = ["/../.git/config", "/%2e%2e/.git/config", "/..%2f.git/config", "/%00", "/a%00b", "/%zz", "/.git/config", "/assets/../../.git/config", "/assets/%2e%2e%2f%2e%2e%2f.git%2fconfig"];
        for (const path of panelPaths) {
            const response = await rawGet(panel.server.port, path, {Cookie: panel.cookie});
            expect([path, response.status >= 400 && response.status < 500, response.text.includes("panel-index")]).toEqual([path, true, false]);
        }
        // 折叠出不了根：落到单页回退，拿到的是 index.html，不是 /etc/passwd。
        const passwd = await rawGet(panel.server.port, "/../../etc/passwd", {Cookie: panel.cookie});
        expect([passwd.status, passwd.text.includes("panel-index"), passwd.text.includes("root:")]).toEqual([200, true, false]);
        const {body} = await panel.json<{pageUrl: string}>("/api/artifact/w00002-alpha/t01-board/review");
        const base = new URL(body.data.pageUrl).pathname.replace(/index\.html$/u, "");
        const artifactPaths = [`${base}../../../../../../.git/config`, `${base}${"%2e%2e/".repeat(7)}.gitignore`, `${base}..%2f..%2fREADME.md`, `${base}%00`, `${base}%zz`, `${base}config-link`, `${base}outside-link`, `${base}.env`, `${base}node_modules/x.js`];
        for (const path of artifactPaths) {
            const response = await rawGet(panel.server.artifactPort, path);
            expect([path, response.status >= 400 && response.status < 500]).toEqual([path, true]);
        }
        expect((await rawGet(panel.server.artifactPort, `${base}index.html`)).status).toBe(200);
        expect(panel.logs.filter((line) => line.includes("失败"))).toEqual([]);
    }, 30_000);

    test("场景 6：依次请求全部接口、产物来源与一次搜索之后，主工作区、worktree 与 Git 公共目录里没有任何文件被改过", async () => {
        const fixture = await publishedFixture("panel-s6");
        const worktree = `${fixture.main}/.worktree/w00003-branchy`;
        const panel = await startPanel(fixture, [claudePane("w9:p1", randomUUID(), {cwd: fixture.main})]);
        const marker = join(fixture.root, "marker");
        await writeFile(marker, "");
        await Bun.sleep(1_100);
        for (const path of ["/api/meta", "/api/overview", "/api/work/w00002-alpha", "/api/task/w00002-alpha/t01-board", "/api/artifacts", "/api/artifact/w00002-alpha/t01-board/review", "/api/docs/tree?checkout=main", "/api/docs/tree?checkout=w00003-branchy", "/api/sessions", "/"]) {
            expect([path, (await panel.get(path)).status]).toEqual([path, 200]);
        }
        const search = await panel.get("/api/search?q=README");
        const lines = (await search.text()).trim().split("\n").map((line) => JSON.parse(line) as {type: string});
        expect([search.status, lines.some((line) => line.type === "hit"), lines.at(-1)?.type]).toEqual([200, true, "end"]);
        const {body} = await panel.json<{pageUrl: string}>("/api/artifact/w00002-alpha/t01-board/review");
        expect((await fetch(body.data.pageUrl)).status).toBe(200);
        const gitCommon = (await git(fixture.main, "rev-parse", "--path-format=absolute", "--git-common-dir")).trim();
        const changed = await run("find", [fixture.main, worktree, gitCommon, "-newer", marker, "-not", "-path", "*/.local/agent/panel.json", "-not", "-path", "*/.local/agent/run/panel.lock"], fixture.root);
        expect(changed.stdout.trim()).toBe("");
    }, 30_000);
});

describe("面板服务的启动与搜索", () => {
    test("预热完成之前 /api/* 回 503、/api/meta 照常；搜索词不合格回 400", async () => {
        const fixture = await createFixture("panel-warm");
        await fixture.write("docs/a.md", "needle\n".repeat(50));
        await fixture.commit("docs");
        const token = randomBytes(32).toString("hex");
        const server = await startPanelServer({context: await locateRepository(fixture.main), host: "127.0.0.1", port: 0, artifactPort: 0, herdr: null, token, log: () => undefined, env: panelEnv(fixture)});
        closers.push(() => server.stop());
        const cookie = `nbdev_panel_${server.port}=${server.auth.redeem(createLoginTicket(token))}`;
        expect((await fetch(`${server.url}/api/overview`, {headers: {Cookie: cookie}})).status).toBe(503);
        expect((await fetch(`${server.url}/api/meta`, {headers: {Cookie: cookie}})).status).toBe(200);
        expect((await fetch(`${server.url}/`)).status).toBe(503);
        await server.warm();
        for (const q of ["", "a", "a%0Ab", "x".repeat(201)]) expect([q.slice(0, 5), (await fetch(`${server.url}/api/search?q=${q}`, {headers: {Cookie: cookie}})).status]).toEqual([q.slice(0, 5), 400]);
    }, 30_000);

    test("搜索的三种结束：客户端断开、新的搜索取代旧的、5 秒截断，都结束 git grep 子进程", async () => {
        const fixture = await createFixture("panel-search-cancel");
        await fixture.write("docs/a.md", "needle\n");
        await fixture.commit("docs");
        await fixture.addWorktree("search-wt", "search-wt");
        const staticDir = join(fixture.root, "web");
        await mkdir(staticDir, {recursive: true});
        await writeFile(join(staticDir, "index.html"), "<!doctype html><html><head></head><body>panel-index</body></html>\n");
        // 内容搜索换成一个长跑的进程（exec 之后 PID 不变，记下来查它是否已退出）；其余 Git 命令照常。
        const shim = join(fixture.root, "grep-shim");
        const pidFile = join(fixture.root, "grep-pids");
        await mkdir(shim, {recursive: true});
        await writeFile(join(shim, "git"), `#!/bin/sh\ncase " $* " in *" grep -I "*) echo $$ >> "${pidFile}"; exec sleep 30;; esac\nexec /usr/bin/git "$@"\n`, {mode: 0o755});
        const {CLI_PATH} = await import("./git-fixture.js");
        const serve: MarkedChild = await spawnMarked(process.execPath, [CLI_PATH, "panel", "serve", "--port", "0", "--artifact-port", "0", "--static-dir", staticDir], {cwd: fixture.main, env: {PATH: `${shim}:${process.env.PATH ?? ""}`}});
        closers.push(() => stopProcess(serve));
        const panelFile = join(fixture.main, ".local/agent/panel.json");
        while (!(await Bun.file(panelFile).exists())) await Bun.sleep(20);
        const opened = await fixture.cli(["panel", "open", "--print", "--json"]);
        expect([opened.exitCode, opened.stderr]).toEqual([0, ""]);
        const login = await fetch((opened.json?.data as {loginUrl: string}).loginUrl, {redirect: "manual"});
        expect(login.status).toBe(302);
        const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
        const base = (await Bun.file(panelFile).json() as {url: string}).url;
        while ((await fetch(`${base}/api/overview`, {headers: {Cookie: cookie}})).status === 503) await Bun.sleep(50);

        const pids = async () => (await Bun.file(pidFile).exists() ? (await Bun.file(pidFile).text()).trim().split("\n").map(Number) : []);
        const waitForPids = async (count: number) => {
            while ((await pids()).length < count) await Bun.sleep(20);
            return (await pids()).slice(count - 2, count);
        };
        const alive = async (pid: number) => {
            // 进程已退出：目录没了是 ENOENT；正在退出的那一瞬间读 stat 会得到 ESRCH。两者都算退出。
            const stat = await Bun.file(`/proc/${pid}/stat`).text().catch((error: unknown) => {
                const code = (error as {code?: string}).code;
                if (code === "ENOENT" || code === "ESRCH") return null;
                throw error;
            });
            return stat !== null && stat.slice(stat.lastIndexOf(")") + 2)[0] !== "Z";
        };
        const allExited = async (group: number[], withinMs: number) => {
            const deadline = Date.now() + withinMs;
            while (Date.now() < deadline) {
                if (!(await Promise.all(group.map(alive))).some(Boolean)) return true;
                await Bun.sleep(20);
            }
            return false;
        };
        type Line = {type: string; truncated?: boolean; aborted?: boolean};
        const readAll = async (response: Response) => (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as Line);

        // Bun.serve 等流里有第一行才回响应头（这里的内容搜索没有命中，要到结束才有），所以下面都不等 fetch 回来就往下走。
        // 客户端断开：两个 checkout 的子进程都结束。
        const disconnect = new AbortController();
        const dropped = fetch(`${base}/api/search?q=needle`, {headers: {Cookie: cookie}, signal: disconnect.signal}).then(
            () => "responded",
            (error: unknown) => (error instanceof Error && error.name === "AbortError" ? "aborted" : Promise.reject(error)),
        );
        const droppedPids = await waitForPids(2);
        disconnect.abort();
        expect(await dropped).toBe("aborted");
        expect(await allExited(droppedPids, 2_000)).toBe(true);

        // 新的搜索取代旧的：旧的恰好以 aborted 结束、子进程结束；新的不受影响，跑到 5 秒截断，子进程随后结束。
        const first = fetch(`${base}/api/search?q=needle`, {headers: {Cookie: cookie}}).then(readAll);
        const firstPids = await waitForPids(4);
        const startedSecond = Date.now();
        const second = fetch(`${base}/api/search?q=needle`, {headers: {Cookie: cookie}}).then(readAll);
        const firstLines = await first;
        expect(Date.now() - startedSecond).toBeLessThan(2_000);
        expect(firstLines.at(-1)).toMatchObject({type: "end", truncated: true, aborted: true});
        expect(await allExited(firstPids, 2_000)).toBe(true);
        const secondPids = await waitForPids(6);
        expect(await Promise.all(secondPids.map(alive))).toEqual([true, true]);
        const secondLines = await second;
        expect(Date.now() - startedSecond).toBeGreaterThanOrEqual(4_500);
        expect(secondLines.at(-1)).toMatchObject({type: "end", truncated: true, aborted: false});
        expect([firstLines, secondLines].filter((lines) => lines.at(-1)?.aborted === true).length).toBe(1);
        expect(await allExited(secondPids, 2_000)).toBe(true);
    }, 40_000);
});

describe("herdr 的常驻状态", () => {
    test("退避：初值 500 毫秒、乘 2、上限 30 秒、加 0 到 20% 的抖动", () => {
        expect([0, 1, 2, 10].map((attempt) => backoffDelay(attempt, () => 0))).toEqual([500, 1_000, 2_000, 30_000]);
        expect(backoffDelay(0, () => 1)).toBe(600);
    });

    test("herdr 一直不在：只有一条重试链，次数按退避有上界（对账定时器不另起链）", async () => {
        const fixture = await createFixture("panel-monitor-down");
        const timings = {reconcileMs: 30, pollMs: 500, pendingPollMs: 15_000, backoffInitialMs: 20, backoffMaxMs: 200, stableMs: 500};
        const monitor = new HerdrMonitor(createHerdrClient({socketPath: join(fixture.root, "no-herdr.sock"), allow: HERDR_PANEL_READ_METHODS}), () => undefined, () => undefined, timings);
        closers.push(async () => monitor.stop());
        monitor.start();
        await Bun.sleep(2_000);
        // 20、40、80、160 之后每次约 200 到 240 毫秒：两秒里不到 15 次；对账若另起链，每 30 毫秒就多一条。
        expect(monitor.current()).toMatchObject({available: false, mode: "unavailable"});
        expect(monitor.current().retries).toBeLessThanOrEqual(15);
        expect(monitor.current().retries).toBeGreaterThanOrEqual(5);
    }, 10_000);

    test("订阅连上就断：重连间隔按 2 的幂增长，快照成功不清零退避", async () => {
        const fixture = await createFixture("panel-monitor-flap");
        const fake = await startFakeHerdr(fixture.root, [claudePane("w9:p1", randomUUID())]);
        closers.push(() => fake.close());
        fake.dropSubscriptionsAfterMs = 5;
        const timings = {reconcileMs: 60_000, pollMs: 500, pendingPollMs: 15_000, backoffInitialMs: 40, backoffMaxMs: 5_000, stableMs: 1_000};
        const monitor = new HerdrMonitor(createHerdrClient({socketPath: fake.socketPath, allow: HERDR_PANEL_READ_METHODS}), () => undefined, () => undefined, timings);
        closers.push(async () => monitor.stop());
        monitor.start();
        const subscribes = () => fake.requests.filter((request) => request.method === "events.subscribe").map((request) => request.at);
        while (subscribes().length < 6) await Bun.sleep(20);
        const times = subscribes();
        const gaps = times.slice(1).map((time, index) => time - times[index]!);
        // 第 n 次的退避是 40 × 2^n（加 0 到 20% 的抖动）：后一个间隔至少是前一个的 1.5 倍。
        for (let index = 1; index < 5; index += 1) expect(gaps[index]!).toBeGreaterThanOrEqual(gaps[index - 1]! * 1.5);
        expect(gaps[4]!).toBeGreaterThanOrEqual(600);
    }, 20_000);

    test("订阅断开后重连并对账；对账发现状态序号变了而没收到事件，计一次漏事件；pane 增减时换订阅连接", async () => {
        const fixture = await createFixture("panel-monitor");
        const fake = await startFakeHerdr(fixture.root, [claudePane("w9:p1", randomUUID(), {state_change_seq: 1})]);
        closers.push(() => fake.close());
        let changes = 0;
        const monitor = new HerdrMonitor(createHerdrClient({socketPath: fake.socketPath, allow: HERDR_PANEL_READ_METHODS}), () => changes++, () => undefined);
        closers.push(async () => monitor.stop());
        monitor.start();
        while (monitor.current().mode !== "subscribed") await Bun.sleep(10);
        const subscribeCount = () => fake.requests.filter((request) => request.method === "events.subscribe").length;
        expect(fake.requests.find((request) => request.method === "events.subscribe")?.params.subscriptions).toContainEqual({type: "pane.agent_status_changed", pane_id: "w9:p1"});
        fake.panes[0]!.state_change_seq = 2;
        fake.panes[0]!.agent_status = "working";
        fake.dropSubscribers();
        while (monitor.current().reconnects === 0 || monitor.current().mode !== "subscribed") await Bun.sleep(20);
        expect(monitor.current()).toMatchObject({missedEvents: 1, panes: [expect.objectContaining({status: "working"})]});
        const before = subscribeCount();
        fake.panes.push(claudePane("w9:p2", randomUUID()));
        fake.emit("pane.created", {pane_id: "w9:p2"});
        while (subscribeCount() === before || fake.subscriberCount() !== 1) await Bun.sleep(20);
        expect(fake.requests.filter((request) => request.method === "events.subscribe").at(-1)?.params.subscriptions).toContainEqual({type: "pane.agent_status_changed", pane_id: "w9:p2"});
        expect(changes).toBeGreaterThan(0);
    }, 30_000);
});

describe("前端构建", () => {
    test("构建失败时有旧产物就用旧的、给出原因；没有旧产物报 build_failed；输入没变不构建", async () => {
        const fixture = await createFixture("panel-build");
        const packageRoot = join(fixture.root, "pkg");
        await mkdir(join(packageRoot, "src", "web"), {recursive: true});
        await writeFile(join(packageRoot, "package.json"), "{}\n");
        const distDir = join(packageRoot, "dist", "web");
        const options = {packageRoot, repoRoot: fixture.root, distDir, log: () => undefined};
        await expect(ensureWebBuild(options)).rejects.toMatchObject({code: "build_failed"});
        await mkdir(distDir, {recursive: true});
        await writeFile(join(distDir, "index.html"), "<html></html>\n");
        const fallback = await ensureWebBuild(options);
        expect([fallback.built, fallback.failed?.includes("vite")]).toEqual([false, true]);
        expect(await Bun.file(join(distDir, "index.html")).text()).toBe("<html></html>\n");
        await writeFile(join(distDir, ".build-hash"), `${await computeBuildHash(packageRoot, fixture.root)}\n`);
        expect(await ensureWebBuild(options)).toEqual({built: false, failed: null});
    });
});

describe("端口", () => {
    test("端口被占时报 port_in_use，已绑定的另一个端口也放掉", async () => {
        const fixture = await createFixture("panel-port");
        const holder = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response("busy")});
        closers.push(async () => {
            await holder.stop(true);
        });
        const context = await locateRepository(fixture.main);
        const attempt = (port: number, artifactPort: number) => startPanelServer({context, host: "127.0.0.1", port, artifactPort, herdr: null, token: "t", log: () => undefined, env: panelEnv(fixture)});
        await expect(attempt(holder.port!, 0)).rejects.toMatchObject({code: "port_in_use"});
        await expect(attempt(0, holder.port!)).rejects.toMatchObject({code: "port_in_use"});
        const ok = await attempt(0, 0);
        await ok.stop();
    });
});

describe("nbdev panel serve 与 panel open", () => {
    test("预热进行中收到 SIGTERM：收口后进程退出（退出码 0），不再挂上监视与定时器", async () => {
        const fixture = await createFixture("panel-warm-term");
        const staticDir = join(fixture.root, "web");
        await mkdir(staticDir, {recursive: true});
        await writeFile(join(staticDir, "index.html"), "<!doctype html><html><head></head><body>panel-index</body></html>\n");
        // 让预热的第一步（读面板代码所在的树）慢 3 秒，信号一定落在预热中途。
        const shim = join(fixture.root, "shim");
        await mkdir(shim, {recursive: true});
        await writeFile(join(shim, "git"), '#!/bin/sh\ncase "$*" in *HEAD:packages/dev-panel*) sleep 3;; esac\nexec /usr/bin/git "$@"\n', {mode: 0o755});
        const {CLI_PATH} = await import("./git-fixture.js");
        const serve: MarkedChild = await spawnMarked(process.execPath, [CLI_PATH, "panel", "serve", "--port", "0", "--artifact-port", "0", "--static-dir", staticDir], {cwd: fixture.main, env: {PATH: `${shim}:${process.env.PATH ?? ""}`}});
        closers.push(() => stopProcess(serve));
        const panelFile = join(fixture.main, ".local/agent/panel.json");
        while (!(await Bun.file(panelFile).exists())) await Bun.sleep(20);
        const exited = once(serve, "exit");
        serve.kill("SIGTERM");
        const [code] = await Promise.race([exited, Bun.sleep(8_000).then(() => [null])]);
        expect(code).toBe(0);
        expect(await Bun.file(panelFile).exists()).toBe(false);
    }, 30_000);

    test("panel serve 写权限 600 的 panel.json、同一个主工作区只能起一个；panel open --print 给出能登录的一次性链接，不带 --print 只把私有跳转页交给 xdg-open；SIGTERM 收口", async () => {
        const fixture = await createFixture("panel-cli");
        const staticDir = join(fixture.root, "web");
        await mkdir(staticDir, {recursive: true});
        await writeFile(join(staticDir, "index.html"), "<!doctype html><html><head></head><body>panel-index</body></html>\n");
        expect((await fixture.cli(["panel", "serve", "--host", "0.0.0.0", "--json"])).json?.errors[0]?.code).toBe("unsafe_host");
        expect((await fixture.cli(["panel", "serve", "--host", "::1", "--json"])).json?.errors[0]?.code).toBe("unsafe_host");
        expect((await fixture.cli(["panel", "open", "--print", "--json"])).json?.errors[0]?.code).toBe("panel_not_running");
        const { CLI_PATH } = await import("./git-fixture.js");
        const serve: MarkedChild = await spawnMarked(process.execPath, [CLI_PATH, "panel", "serve", "--port", "0", "--artifact-port", "0", "--static-dir", staticDir], {cwd: fixture.main});
        closers.push(() => stopProcess(serve));
        const panelFile = join(fixture.main, ".local/agent/panel.json");
        while (!(await Bun.file(panelFile).exists())) await Bun.sleep(20);
        const info = await Bun.file(panelFile).json() as {url: string; artifactUrl: string; pid: number};
        expect(((await Bun.file(panelFile).stat()).mode & 0o777).toString(8)).toBe("600");
        expect(info.pid).toBe(serve.pid);
        const second = await fixture.cli(["panel", "serve", "--port", "0", "--artifact-port", "0", "--static-dir", staticDir, "--json"]);
        expect([second.exitCode, second.json?.errors[0]?.code]).toEqual([3, "panel_running"]);
        const opened = await fixture.cli(["panel", "open", "--print", "--json"]);
        const loginUrl = (opened.json?.data as {loginUrl: string}).loginUrl;
        let login = await fetch(loginUrl, {redirect: "manual"});
        for (let attempt = 0; attempt < 100 && login.status === 503; attempt += 1) {
            await Bun.sleep(50);
            login = await fetch(loginUrl, {redirect: "manual"});
        }
        expect([login.status, login.headers.get("location"), login.headers.get("set-cookie")?.includes("HttpOnly; SameSite=Strict")]).toEqual([302, "/", true]);
        expect((await fetch(loginUrl, {redirect: "manual"})).status).toBe(403);
        const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
        let meta = await fetch(`${info.url}/api/overview`, {headers: {Cookie: cookie}});
        for (let attempt = 0; attempt < 200 && meta.status === 503; attempt += 1) {
            await Bun.sleep(50);
            meta = await fetch(`${info.url}/api/overview`, {headers: {Cookie: cookie}});
        }
        expect(meta.status).toBe(200);

        // 不带 --print：票据不进 xdg-open 的命令行，只交一个只有自己能读的跳转页。
        const shim = join(fixture.root, "open-shim");
        await mkdir(shim, {recursive: true});
        await writeFile(join(shim, "xdg-open"), '#!/bin/sh\np="${1#file://}"\nprintf \'%s\\n\' "$#" "$1" "$(stat -c %a "$p")" "$(stat -c %a "$(dirname "$p")")" > "$OPEN_RECORD.tmp"\nmv "$OPEN_RECORD.tmp" "$OPEN_RECORD"\n', {mode: 0o755});
        const openThroughShim = async (runtimeDir: string, record: string) => {
            const result = await fixture.cli(["panel", "open", "--json"], fixture.main, {PATH: `${shim}:${process.env.PATH ?? ""}`, XDG_RUNTIME_DIR: runtimeDir, OPEN_RECORD: record, DISPLAY: ":0"});
            for (let attempt = 0; attempt < 200 && !(await Bun.file(record).exists()); attempt += 1) await Bun.sleep(20);
            const [argc, arg, fileMode, dirMode] = (await Bun.file(record).text()).trimEnd().split("\n");
            return {result, argc, arg: arg!, fileMode, dirMode};
        };
        // 没有桌面环境（经 SSH 登进来）：不调 xdg-open、不写跳转页，警告里写怎么转发两个端口。
        const headless = await fixture.cli(["panel", "open", "--json"], fixture.main, {PATH: `${shim}:${process.env.PATH ?? ""}`, OPEN_RECORD: join(fixture.root, "open-headless.txt"), DISPLAY: "", WAYLAND_DISPLAY: ""});
        const headlessPorts = [new URL(info.url).port, new URL(info.artifactUrl).port];
        expect([headless.exitCode, (headless.json?.data as {page: string | null}).page, headless.json?.warnings.map((warning) => warning.code)]).toEqual([0, null, ["no_display"]]);
        expect(headless.json?.warnings[0]?.message).toContain(`ssh -L ${headlessPorts[0]}:127.0.0.1:${headlessPorts[0]} -L ${headlessPorts[1]}:127.0.0.1:${headlessPorts[1]}`);
        await Bun.sleep(300);
        expect(await Bun.file(join(fixture.root, "open-headless.txt")).exists()).toBe(false);
        const runtimeDir = join(fixture.root, "runtime");
        await mkdir(join(runtimeDir, "nbdev"), {recursive: true});
        const stalePage = join(runtimeDir, "nbdev", "open-0000000000000000.html");
        await writeFile(stalePage, "stale");
        await utimes(stalePage, new Date(Date.now() - 11 * 60_000), new Date(Date.now() - 11 * 60_000));
        const viaRuntime = await openThroughShim(runtimeDir, join(fixture.root, "open-1.txt"));
        const page = (viaRuntime.result.json?.data as {page: string; loginUrl: string | null});
        expect([viaRuntime.result.exitCode, page.loginUrl, viaRuntime.argc, viaRuntime.fileMode, viaRuntime.dirMode]).toEqual([0, null, "1", "600", "700"]);
        expect(viaRuntime.arg).toBe(pathToFileURL(page.page).href);
        expect(viaRuntime.arg.startsWith(`file://${runtimeDir}/nbdev/open-`)).toBe(true);
        expect(viaRuntime.arg.includes("ticket")).toBe(false);
        expect(viaRuntime.result.stdout.includes("ticket")).toBe(false);
        expect(await Bun.file(stalePage).exists()).toBe(false);
        const pageLogin = /location\.replace\("([^"]+)"\)/u.exec(await Bun.file(page.page).text())?.[1];
        expect(pageLogin?.startsWith(`${info.url}/login?ticket=`)).toBe(true);
        expect((await fetch(pageLogin!, {redirect: "manual"})).status).toBe(302);
        // 没有 XDG_RUNTIME_DIR 时落到主工作区的 .local/agent/run/panel-open/。
        const viaLocal = await openThroughShim("", join(fixture.root, "open-2.txt"));
        expect([viaLocal.argc, viaLocal.fileMode, viaLocal.dirMode]).toEqual(["1", "600", "700"]);
        expect(viaLocal.arg.startsWith(`file://${fixture.main}/.local/agent/run/panel-open/open-`)).toBe(true);

        const exited = once(serve, "exit");
        serve.kill("SIGTERM");
        expect((await exited)[0]).toBe(0);
        expect(await Bun.file(panelFile).exists()).toBe(false);
        expect(await Bun.file(join(fixture.main, ".local/agent/run/panel.lock")).exists()).toBe(false);
    }, 60_000);
});
