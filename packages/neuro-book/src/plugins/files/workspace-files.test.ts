/**
 * 写入接口（docs/specs/workspace/resources.md 的“写入接口”各条与验收 11–13、15）：服务端实例、路由与项目管理器是真实的，
 * 项目跑在真实子进程里；测试插件经 `workspaceFilesKey` 调用，id 为 `nbook.agent` 的那个可以注明代表哪个会话。
 * “没有外部回声”的判法：写完之后从外部改一个哨兵文件，等它的外部事件到达；监视按顺序处理，哨兵之前没有出现的回声就
 * 不会再出现。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {randomBytes} from "node:crypto";
import {mkdir, readdir, readFile, rm, stat, symlink, truncate, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {definitionAt} from "nbook/manifest";
import {createConsoleExporterFactory, createConsoleFallback} from "nbook/plugins/diagnostics/web/console-exporter";
import {killSpawnedProjects, leaseOf, projectHarness} from "nbook/server/testing/projects";
import type {ProjectHarness} from "nbook/server/testing/projects";
import {projectsKey} from "nbook/shared/projects";
import type {ProjectsService} from "nbook/shared/projects";

import {filesBackendPlugin} from "./backend/plugin";
import {descriptor} from "./plugin";
import {projectFilesContract} from "./shared/contracts";
import type {ChangesMessage, FileChange} from "./shared/contracts";
import {workspaceFilesKey} from "./shared/workspace-files";
import type {WorkspaceFiles} from "./shared/workspace-files";
import {hash} from "./testing/scene";

let tmp = "";
const harnesses: ProjectHarness[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-files", "workspace-files");
});
afterEach(async () => {
    try {
        for (const harness of harnesses.splice(0)) expect(await harness.parent.stop()).toMatchObject({status: "closed"});
    } finally {
        killSpawnedProjects();
    }
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

interface Held {
    files: WorkspaceFiles | null;
    projects: ProjectsService | null;
    remote: ActivationContext["remote"] | null;
}

function consumer(id: string, held: Held): PluginDefinition {
    return {id, entries: [defineEntry({
        id: "server",
        location: "server",
        activationEvents: ["onStartup"],
        dependencies: [{key: workspaceFilesKey}, {key: projectsKey}],
        activate: (context) => {
            held.files = context.services.require(workspaceFilesKey);
            held.projects = context.services.require(projectsKey);
            held.remote = context.remote;
            return {};
        },
    })]};
}

async function scene(): Promise<{readonly h: ProjectHarness; readonly agent: Held; readonly other: Held; readonly book: string}> {
    const silent = {error: () => undefined};
    const agent: Held = {files: null, projects: null, remote: null};
    const other: Held = {files: null, projects: null, remote: null};
    const h = await projectHarness(tmp, {plugins: [
        createDiagnosticsPlugin({location: "server", store: createDiagnosticsStore({identity: {location: "server", instanceId: "hub"}}), exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)}),
        definitionAt("server", descriptor, filesBackendPlugin),
        consumer("nbook.agent", agent),
        consumer("x.other", other),
    ]});
    harnesses.push(h);
    return {h, agent, other, book: join(h.root, "Book")};
}

const files = (held: Held): WorkspaceFiles => held.files ?? (() => { throw new Error("测试插件没有激活"); })();
const asAgent = {as: {agent: {session: "s1", profile: "p"}}};

/** 持着项目的租约订阅它的变更：项目一直在运行，事件都收得到。 */
async function watching(h: ProjectHarness, held: Held): Promise<{readonly events: FileChange[]; release(): void}> {
    const lease = leaseOf(await held.projects!.acquire("book"));
    const messages: ChangesMessage[] = [];
    const subscribed = await held.remote!.use(projectFilesContract).at({project: h.project.id}).events.changes.subscribe({}, (message) => messages.push(message));
    if (!subscribed.ok) throw new Error(subscribed.code);
    await waitUntil("订阅就绪", () => messages.some((message) => message.kind === "ready"));
    const events: FileChange[] = [];
    const flatten = (): void => {
        events.splice(0, events.length, ...messages.flatMap((message) => (message.kind === "batch" ? message.events : [])));
    };
    return {
        get events() {
            flatten();
            return events;
        },
        release: () => lease.release(),
    };
}

/** 从外部改一个哨兵文件并等它的外部事件：在它之前没出现的回声之后也不会出现。 */
async function settled(book: string, watch: {readonly events: FileChange[]}): Promise<void> {
    const name = `哨兵-${String(Date.now())}-${String(Math.random()).slice(2)}.txt`;
    await writeFile(join(book, name), "x");
    await waitUntil("哨兵的外部事件", () => watch.events.some((event) => event.path === name && event.source.kind === "external"));
}

const stagingOf = (book: string): Promise<string[]> => readdir(join(book, ".nbook", "staging")).catch(() => []);

describe("写入接口：暂存与提交", () => {
    it("验收 11：流式写 8 MB 二进制并建上级目录、整份写文本；内容一致，事件带会话来源，没有外部回声，暂存不留", async () => {
        const {h, agent, book} = await scene();
        const watch = await watching(h, agent);
        const image = randomBytes(8 * 1024 * 1024);
        const staged = await files(agent).stage("projects://book/插图/封面.png", async (sink) => {
            for (let at = 0; at < image.length; at += 1024 * 1024) await sink.write(image.subarray(at, at + 1024 * 1024));
        }, {...asAgent, expect: "absent", createParents: true});
        expect(staged).toEqual({ok: true, value: {baseline: {hash: hash(image)}}});
        expect(Buffer.compare(await readFile(join(book, "插图", "封面.png")), image)).toBe(0);

        const text = await files(agent).write("projects://book/第一章.md", "正文", {...asAgent, expect: "any"});
        expect(text).toEqual({ok: true, value: {baseline: {hash: hash("正文")}}});
        await waitUntil("新建事件", () => watch.events.some((event) => event.path === "插图/封面.png" && event.type === "created"));
        await settled(book, watch);
        const ours = watch.events.filter((event) => event.path === "插图" || event.path === "插图/封面.png" || event.path === "第一章.md");
        expect(ours.every((event) => event.source.kind === "agent" && event.source.session === "s1")).toBe(true);
        expect(ours.map((event) => `${event.type} ${event.path}`)).toEqual(["created 插图", "created 插图/封面.png", "created 第一章.md"]);
        expect(await stagingOf(book)).toEqual([]);
        watch.release();
    });

    it("期望：基线成立与冲突（冲突带当前基线）、absent 遇到已存在为冲突、缺的文件按基线写为 not-found", async () => {
        const {agent, book} = await scene();
        await writeFile(join(book, "a.md"), "旧");
        const old = {hash: hash("旧")};
        expect(await files(agent).write("projects://book/a.md", "新", {expect: old})).toMatchObject({ok: true});
        expect(await files(agent).write("projects://book/a.md", "又新", {expect: old})).toEqual({ok: false, code: "conflict", detail: expect.any(String), current: {hash: hash("新")}});
        expect(await files(agent).write("projects://book/a.md", "x", {expect: "absent"})).toMatchObject({ok: false, code: "conflict"});
        expect(await files(agent).write("projects://book/无.md", "x", {expect: old})).toMatchObject({ok: false, code: "not-found"});
        expect(await readFile(join(book, "a.md"), "utf8")).toBe("新");
        expect(await stagingOf(book)).toEqual([]);
    });

    it("写入函数抛错或调用被取消：目标不动，暂存不留", async () => {
        const {agent, book} = await scene();
        await writeFile(join(book, "a.md"), "旧");
        const thrown = await files(agent).stage("projects://book/a.md", async (sink) => {
            await sink.write(new TextEncoder().encode("一半"));
            throw new Error("生成失败");
        }, {expect: "any"});
        expect(thrown).toMatchObject({ok: false, code: "io-failed"});
        const controller = new AbortController();
        const cancelled = await files(agent).stage("projects://book/a.md", async (sink) => {
            controller.abort();
            await sink.write(new TextEncoder().encode("不该写进去"));
        }, {expect: "any", signal: controller.signal});
        expect(cancelled).toMatchObject({ok: false, code: "cancelled"});
        expect(await readFile(join(book, "a.md"), "utf8")).toBe("旧");
        expect(await stagingOf(book)).toEqual([]);
    });

    it("验收 12：同一基线的两次并发写恰好一次成功；absent 与新建并发恰好一方成功", async () => {
        const {agent, book} = await scene();
        await writeFile(join(book, "a.md"), "旧");
        const both = await Promise.all([
            files(agent).write("projects://book/a.md", "甲", {expect: {hash: hash("旧")}}),
            files(agent).write("projects://book/a.md", "乙", {expect: {hash: hash("旧")}}),
        ]);
        expect(both.filter((result) => result.ok)).toHaveLength(1);
        expect(["甲", "乙"]).toContain(await readFile(join(book, "a.md"), "utf8"));

        // 竞态窗口很窄，多跑几轮：每一轮都必须恰好一方成功、字节与胜者一致。
        for (let round = 0; round < 30; round += 1) {
            const name = `b${String(round)}.md`;
            const raced = await Promise.all([
                files(agent).write(`projects://book/${name}`, "写入的", {expect: "absent"}),
                files(agent).create(`projects://book/${name}`, "file"),
            ]);
            expect(raced.filter((result) => result.ok)).toHaveLength(1);
            expect(await readFile(join(book, name), "utf8")).toBe(raced[0].ok ? "写入的" : "");
        }
    });

    it("写入函数运行期间持着项目的租约：没在运行的项目被打开、写完之前不进宽限期", async () => {
        const {h, agent, book} = await scene();
        const stateOf = async (): Promise<string | undefined> => {
            const listed = await h.manager.list();
            return listed.ok ? listed.value.find((project) => project.id === h.project.id)?.state : undefined;
        };
        expect(await stateOf()).toBe("stopped");
        let resume: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            resume = resolve;
        });
        let writing = false;
        const pending = files(agent).stage("projects://book/慢.md", async (sink) => {
            writing = true;
            await gate;
            await sink.write(new TextEncoder().encode("写完了"));
        }, {expect: "absent"});
        await waitUntil("写入函数在等", () => writing);
        expect(await stateOf()).toBe("running");
        resume();
        expect(await pending).toMatchObject({ok: true});
        expect(await readFile(join(book, "慢.md"), "utf8")).toBe("写完了");
        expect(await stateOf()).toBe("idle-grace");
    });

    it("新建的文件的权限位与“新建文件”相同", async () => {
        const {agent, book} = await scene();
        expect(await files(agent).create("projects://book/建的.md", "file")).toMatchObject({ok: true});
        expect(await files(agent).write("projects://book/写的.md", "x", {expect: "absent"})).toMatchObject({ok: true});
        expect((await stat(join(book, "写的.md"))).mode & 0o777).toBe((await stat(join(book, "建的.md"))).mode & 0o777);
    });

    it("验收 13：提交发出后项目子进程断开为 unknown-outcome；以原期望重试得到确定结果，再打开后暂存不留", async () => {
        const {h, agent, book} = await scene();
        await writeFile(join(book, "d.md"), "旧");
        expect(await files(agent).read("projects://book/d.md")).toMatchObject({ok: true});
        const listed = await h.manager.list();
        const pid = listed.ok ? listed.value.find((project) => project.id === h.project.id)?.pid : null;
        if (pid === null || pid === undefined) throw new Error("项目没在运行");
        process.kill(pid, "SIGSTOP");
        const pending = files(agent).write("projects://book/d.md", "新", {expect: {hash: hash("旧")}});
        await waitUntil("提交已经发出", async () => {
            const now = await h.manager.list();
            return now.ok && now.value.find((project) => project.id === h.project.id)?.state === "running" && (await stagingOf(book)).some((name) => name.endsWith(".stage"));
        });
        process.kill(pid, "SIGKILL");
        expect(await pending).toMatchObject({ok: false, code: "unknown-outcome"});
        const retried = await files(agent).write("projects://book/d.md", "新", {expect: {hash: hash("旧")}});
        expect(retried.ok || (!retried.ok && retried.code === "conflict")).toBe(true);
        expect(await readFile(join(book, "d.md"), "utf8")).toBe("新");
        expect((await stagingOf(book)).filter((name) => name.endsWith(".stage"))).toEqual([]);
    });
});

describe("写入接口：user://", () => {
    it("在服务端本进程里写、读、改、删；暂存在状态根下、不留", async () => {
        const {h, agent} = await scene();
        expect(await files(agent).write("user://笔记/a.md", "一", {expect: "absent", createParents: true})).toMatchObject({ok: true});
        expect(await files(agent).update("user://笔记/a.md", (text) => `${text}二`)).toEqual({ok: true, value: {baseline: {hash: hash("一二")}}});
        expect(await readFile(join(h.stateRoot, "user", "笔记", "a.md"), "utf8")).toBe("一二");
        expect(await files(agent).delete([{address: "user://笔记/a.md"}])).toMatchObject({ok: true, value: {items: [{status: "done"}]}});
        expect(await readdir(join(h.stateRoot, "staging"))).toEqual([]);
    });
});

describe("写入接口：读", () => {
    it("验收 15：read 交回字节与基线；超过 32 MB 为 too-large；虚拟根交回文字；读路径跟随根外链接、拒绝指向控制目录的", async () => {
        const {agent, book, h} = await scene();
        await writeFile(join(book, "a.md"), "正文");
        expect(await files(agent).read("projects://book/a.md")).toEqual({ok: true, value: {bytes: new TextEncoder().encode("正文"), baseline: {hash: hash("正文")}}});
        await writeFile(join(book, "大.bin"), "");
        await truncate(join(book, "大.bin"), 33 * 1024 * 1024);
        expect(await files(agent).read("projects://book/大.bin")).toMatchObject({ok: false, code: "too-large"});
        const root = await files(agent).read("projects://");
        expect(root.ok && new TextDecoder().decode(root.value.bytes).includes("projects://book")).toBe(true);

        const outside = join(h.root, "别处");
        await mkdir(outside);
        await writeFile(join(outside, "资料.md"), "外面的");
        await symlink(outside, join(book, "资料"));
        expect(await files(agent).readPath("projects://book/资料/资料.md")).toEqual({ok: true, value: {path: join(outside, "资料.md"), kind: "file"}});
        expect(await files(agent).read("projects://book/资料/资料.md")).toMatchObject({ok: true, value: {baseline: {hash: hash("外面的")}}});
        await symlink(join(book, ".nbook"), join(book, "控制"));
        expect(await files(agent).readPath("projects://book/控制/project.json")).toMatchObject({ok: false, code: "protected-path"});
        // 写仍按根外拒绝。
        expect(await files(agent).write("projects://book/资料/资料.md", "改", {expect: "any"})).toMatchObject({ok: false, code: "outside-root"});
    });

    it("别的调用方直接调项目合同取跟随链接的读路径或提交：permission-denied；别的插件注明会话为 invalid-input", async () => {
        const {h, other} = await scene();
        const lease = leaseOf(await other.projects!.acquire("book"));
        const client = other.remote!.use(projectFilesContract).at({project: h.project.id});
        expect(await client.realPath({path: "", follow: true})).toMatchObject({ok: false, code: "permission-denied"});
        expect(await client.commit({stage: "00000000-0000-0000-0000-000000000000.stage", hash: "x", path: "a.md", expect: "any"})).toMatchObject({ok: false, code: "permission-denied"});
        // 浏览器与别的插件的保存也可以带分组（版本 7 的全部写方法）。
        const created = await client.create({path: "g.md", kind: "file"});
        expect(created.ok).toBe(true);
        const read = await client.read({path: "g.md"});
        if (!read.ok) throw new Error(read.code);
        expect(await client.write({path: "g.md", text: "x", baseline: read.value.baseline, group: {id: "g1", title: "一组"}})).toMatchObject({ok: true});
        lease.release();
        expect(await files(other).write("projects://book/a.md", "x", {...asAgent, expect: "any"})).toMatchObject({ok: false, code: "invalid-input"});
    });
});

describe("写入接口：文件操作与分组", () => {
    it("组里的写入与文件操作带同一个组；文件操作沿用浏览器的语义", async () => {
        const {h, agent, book} = await scene();
        const watch = await watching(h, agent);
        await writeFile(join(book, "旧.md"), "要删的");
        const done = await files(agent).group({title: "拆章", note: "把第三章拆成两章"}, async (g) => {
            await g.write("projects://book/上.md", "上半", {...asAgent, expect: "absent"});
            await g.write("projects://book/下.md", "下半", {...asAgent, expect: "absent"});
            return g.delete([{address: "projects://book/旧.md"}], asAgent);
        });
        expect(done).toMatchObject({ok: true, value: {items: [{status: "done"}]}});
        await waitUntil("三条事件", () => ["上.md", "下.md", "旧.md"].every((path) => watch.events.some((event) => event.path === path && event.source.kind === "agent")));
        const grouped = watch.events.filter((event) => ["上.md", "下.md", "旧.md"].includes(event.path));
        const ids = new Set(grouped.map((event) => event.group?.id));
        expect(ids.size).toBe(1);
        expect(grouped[0]?.group).toMatchObject({title: "拆章", note: "把第三章拆成两章"});
        expect(await files(agent).rename("projects://book/上.md", "上篇.md")).toMatchObject({ok: true});
        expect(await files(agent).move([{source: "projects://book/上篇.md", target: "projects://book/下.md"}])).toMatchObject({ok: true, value: {items: [{status: "failed", code: "conflict"}]}});
        watch.release();
    });
});
