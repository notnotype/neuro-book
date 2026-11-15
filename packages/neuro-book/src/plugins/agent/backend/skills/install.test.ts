/**
 * 初始化 Skill（docs/specs/agent/skills.md 输出 18–21 与场景 4、5）：真跑应用的 Bun 安装（只依赖本地的 `file:` 包，不联网），
 * 另起一个进程拿锁。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {createTasksCore} from "nbook/plugins/tasks/backend/core";
import type {TasksCore} from "nbook/plugins/tasks/backend/core";
import type {BackgroundTasks} from "nbook/plugins/tasks/shared/contracts";

import {SkillCatalog, sourceRoot} from "./catalog";
import {SkillInstaller} from "./install";
import {MARKER_FILE} from "./readiness";

let tmp = "";
let counter = 0;
const cleanups: Array<() => Promise<void> | void> = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-agent", "skills-install");
});
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 一个用户的 Skill，依赖同级目录里的本地包 `local-dep`；脚本导入它。`tasks` 是应用里的后台任务（命令行不给）。 */
async function scene(options: {readonly tasks?: BackgroundTasks} = {}) {
    counter += 1;
    const base = join(tmp, `s${String(counter)}`);
    const skills = join(base, "skills");
    const dep = join(base, "local-dep");
    await mkdir(dep, {recursive: true});
    await writeFile(join(dep, "package.json"), JSON.stringify({name: "local-dep", version: "1.0.0", main: "index.js"}));
    await writeFile(join(dep, "index.js"), "module.exports = {answer: 42};\n");
    const directory = join(skills, "epub-export");
    await mkdir(directory, {recursive: true});
    await writeFile(join(directory, "SKILL.md"), "---\nname: epub-export\ndescription: 导出\n---\n\n正文\n");
    await writeFile(join(directory, "package.json"), JSON.stringify({name: "epub-export", private: true, dependencies: {"local-dep": `file:${dep}`}}));
    await writeFile(join(directory, "run.js"), "console.log(require(\"local-dep\").answer);\n");
    const locksRoot = join(base, "locks");
    let installer: SkillInstaller | null = null;
    const catalog = await SkillCatalog.open({roots: [sourceRoot("user", skills, false)], clock: systemClock, report: () => undefined, installing: (id) => installer?.installing(id) ?? false});
    installer = new SkillInstaller({item: (id) => catalog.item(id), refresh: (id) => catalog.refresh(id), locksRoot, bun: process.execPath, clock: systemClock, ...(options.tasks === undefined ? {} : {tasks: options.tasks})});
    const own = installer;
    cleanups.push(() => catalog.close(), () => own.stop());
    return {directory, catalog, installer: own, locksRoot};
}

const status = (catalog: SkillCatalog) => catalog.item("user.epub-export")?.entry.status;

describe("初始化", () => {
    test("场景 4：没有 bun.lock 时先要 resolve；确认后装好、生成锁文件、写下标记、变成可用，脚本能导入依赖；之后按锁装", async () => {
        const {directory, catalog, installer} = await scene();
        expect(status(catalog)).toBe("needs-init");
        expect(await installer.plan("user.epub-export")).toEqual({ok: true, plan: {lock: false, dependencies: ["local-dep"]}});
        expect(await installer.init("user.epub-export")).toEqual({ok: false, code: "lock-missing"});

        expect(await installer.init("user.epub-export", {resolve: true})).toEqual({ok: true});
        expect(status(catalog)).toBe("ready");
        expect(JSON.parse(await readFile(join(directory, MARKER_FILE), "utf8"))).toMatchObject({schema: 1, runtime: "bun", bun: Bun.version});
        const plan = await installer.plan("user.epub-export");
        expect(plan.ok && plan.plan.lock).toBe(true);
        const run = Bun.spawnSync([process.execPath, "run.js"], {cwd: directory});
        expect(run.stdout.toString().trim()).toBe("42");

        await rm(join(directory, "node_modules"), {recursive: true});
        await catalog.refresh("user.epub-export");
        expect(status(catalog)).toBe("needs-init");
        expect(await installer.init("user.epub-export")).toEqual({ok: true});
        expect(status(catalog)).toBe("ready");
    }, 60_000);

    test("同一个进程里同时请求两次，并入同一次；装不上时写下原因、回到未初始化", async () => {
        const {directory, catalog, installer} = await scene();
        await writeFile(join(directory, "package.json"), JSON.stringify({name: "epub-export", private: true, dependencies: {"not-here": "file:./missing-dir"}}));
        await catalog.refresh("user.epub-export");
        const first = installer.init("user.epub-export", {resolve: true});
        const second = installer.init("user.epub-export", {resolve: true});
        expect(second).toBe(first);
        const result = await first;
        expect(result).toMatchObject({ok: false, code: "install-failed"});
        expect(catalog.item("user.epub-export")?.entry).toMatchObject({status: "needs-init", problem: {code: "install-failed"}});
    }, 60_000);

    test("场景 5：别的进程拿着锁时得 busy、状态是正在初始化；那个进程被杀之后再初始化能成功", async () => {
        const {catalog, installer, locksRoot} = await scene();
        await mkdir(locksRoot, {recursive: true});
        // 子进程从本目录起，经包名找到同一个锁模块。
        const holder = Bun.spawn([process.execPath, "-e", `const {tryLock} = await import("@notnotype/nb-flock"); const lock = tryLock(${JSON.stringify(join(locksRoot, "user.epub-export.lock"))}); console.log(lock === null ? "missed" : "held"); await new Promise(() => {});`], {cwd: import.meta.dir, stdout: "pipe", stdin: "ignore"});
        cleanups.push(() => void holder.kill("SIGKILL"));
        const reader = holder.stdout.getReader();
        const line = new TextDecoder().decode((await reader.read()).value);
        expect(line.trim()).toBe("held");
        await catalog.refresh("user.epub-export");
        expect(status(catalog)).toBe("initializing");
        expect(await installer.init("user.epub-export", {resolve: true})).toEqual({ok: false, code: "busy"});

        holder.kill("SIGKILL");
        await holder.exited;
        await catalog.refresh("user.epub-export");
        await waitUntil("锁放掉后回到未初始化", () => status(catalog) === "needs-init" || undefined);
        expect(await installer.init("user.epub-export", {resolve: true})).toEqual({ok: true});
    }, 60_000);

    test("输出 21：应用停止时，正在进行的安装被结束、标记写中断、锁放掉；刚请求就停止的不起安装", async () => {
        // 一个不回应的本地包源：安装一直等在下载上，直到被停止。
        const server = Bun.serve({port: 0, hostname: "127.0.0.1", fetch: () => new Promise<Response>(() => undefined)});
        cleanups.push(() => void server.stop(true));
        const slow = JSON.stringify({name: "epub-export", private: true, dependencies: {"slow-dep": `http://127.0.0.1:${String(server.port)}/slow-dep.tgz`}});

        const midway = await scene();
        await writeFile(join(midway.directory, "package.json"), slow);
        await midway.catalog.refresh("user.epub-export");
        const running = midway.installer.init("user.epub-export", {resolve: true});
        await waitUntil("开始下载", () => status(midway.catalog) === "initializing" || undefined);
        await midway.installer.stop();
        expect(await running).toEqual({ok: false, code: "interrupted"});
        expect(JSON.parse(await readFile(join(midway.directory, MARKER_FILE), "utf8"))).toMatchObject({error: {code: "interrupted"}});
        expect(midway.installer.installing("user.epub-export")).toBe(false);

        const early = await scene();
        await writeFile(join(early.directory, "package.json"), slow);
        await early.catalog.refresh("user.epub-export");
        const started = early.installer.init("user.epub-export", {resolve: true});
        await early.installer.stop();
        expect(await started).toEqual({ok: false, code: "interrupted"});
        expect(early.installer.installing("user.epub-export")).toBe(false);
    }, 60_000);

    test("内置的、没有 package.json 的不能初始化；没有这个 id 得 skill-not-found", async () => {
        const {directory, catalog, installer} = await scene();
        await rm(join(directory, "package.json"));
        await catalog.refresh("user.epub-export");
        expect(await installer.init("user.epub-export")).toEqual({ok: false, code: "not-initializable"});
        expect(await installer.plan("user.nothing")).toEqual({ok: false, code: "skill-not-found"});
    });
});

/** 真实的后台任务清单，Agent 的服务端入口是发起方（background-tasks.md 输出 1–6）。 */
function tasksCore(): {readonly core: TasksCore; readonly tasks: BackgroundTasks} {
    let next = 0;
    const core = createTasksCore({clock: systemClock, newId: () => `task-${String((next += 1))}`, report: () => undefined});
    const tasks = core.facade({instanceId: "server", location: "server", client: null, plugin: "nbook.agent", entry: "server", generation: 1, via: null});
    return {core, tasks};
}

const agentRef = (key: string, params?: Record<string, string | number>) => ({kind: "text", ns: "nbook.agent", key: `skills.task.${key}`, ...(params === undefined ? {} : {params})});

describe("后台任务（输出 29）", () => {
    test("开始安装时登记一件可取消的任务，进展写正在解析依赖；装好结束为成功、写已可用；并入的请求不另登记", async () => {
        const {core, tasks} = tasksCore();
        const {catalog, installer} = await scene({tasks});
        const snapshots: Array<ReturnType<TasksCore["list"]>> = [];
        cleanups.push(core.onChanged(() => void snapshots.push(core.list())));

        const first = installer.init("user.epub-export", {resolve: true});
        const second = installer.init("user.epub-export", {resolve: true});
        expect(await first).toEqual({ok: true});
        await second;
        expect(status(catalog)).toBe("ready");

        expect(snapshots[0]).toEqual([expect.objectContaining({state: "running", title: agentRef("title", {name: "epub-export"}), message: agentRef("resolving"), cancellable: true, progress: null})]);
        expect(core.list()).toEqual([expect.objectContaining({state: "succeeded", message: agentRef("ready")})]);
        core.close();
    }, 60_000);

    test("有锁时进展写要装的包数；装不上时结束为失败、详情是安装输出，能重试，重试的那次另起一件", async () => {
        const {core, tasks} = tasksCore();
        const {directory, catalog, installer} = await scene({tasks});
        expect(await installer.init("user.epub-export", {resolve: true})).toEqual({ok: true});
        await rm(join(directory, "node_modules"), {recursive: true});
        await catalog.refresh("user.epub-export");
        core.clearFinished();
        const snapshots: Array<ReturnType<TasksCore["list"]>> = [];
        const stop = core.onChanged(() => void snapshots.push(core.list()));
        expect(await installer.init("user.epub-export")).toEqual({ok: true});
        stop();
        expect(snapshots[0]?.[0]).toMatchObject({state: "running", message: agentRef("installing", {count: 1})});
        core.clearFinished();

        await writeFile(join(directory, "package.json"), JSON.stringify({name: "epub-export", private: true, dependencies: {"not-here": "file:./missing-dir"}}));
        await catalog.refresh("user.epub-export");
        expect(await installer.init("user.epub-export", {resolve: true})).toMatchObject({ok: false, code: "install-failed"});
        const [failed] = core.list();
        expect(failed).toMatchObject({state: "failed", message: agentRef("failed"), hasDetail: true, retryable: true});
        const detail = core.detail(failed!.id);
        expect(detail.ok && detail.value?.text).toContain("missing-dir");

        expect(core.retry(failed!.id)).toEqual({ok: true, value: null});
        await waitUntil("重试的那次装完", () => core.list().some((item) => item.id !== failed!.id && item.state === "failed") || undefined);
        expect(core.list().map((item) => item.id)).not.toContain(failed!.id);
        core.close();
    }, 60_000);

    test("用户取消：中止安装，标记按中断写下、回到未初始化，任务结束为已取消", async () => {
        // 一个不回应的本地包源：安装一直等在下载上，直到被取消。
        const server = Bun.serve({port: 0, hostname: "127.0.0.1", fetch: () => new Promise<Response>(() => undefined)});
        cleanups.push(() => void server.stop(true));
        const {core, tasks} = tasksCore();
        const {directory, catalog, installer} = await scene({tasks});
        await writeFile(join(directory, "package.json"), JSON.stringify({name: "epub-export", private: true, dependencies: {"slow-dep": `http://127.0.0.1:${String(server.port)}/slow-dep.tgz`}}));
        await catalog.refresh("user.epub-export");

        const running = installer.init("user.epub-export", {resolve: true});
        const task = await waitUntil("任务登记了", () => core.list()[0]);
        await waitUntil("开始下载", () => status(catalog) === "initializing" || undefined);
        expect(core.cancel(task.id)).toEqual({ok: true, value: null});
        expect(await running).toEqual({ok: false, code: "interrupted"});
        expect(core.list()).toEqual([expect.objectContaining({state: "cancelled"})]);
        expect(catalog.item("user.epub-export")?.entry).toMatchObject({status: "needs-init", problem: {code: "interrupted"}});
        core.close();
    }, 60_000);
});
