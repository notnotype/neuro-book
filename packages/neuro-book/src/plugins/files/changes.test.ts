/**
 * 变更事件与写入来源（docs/specs/workspace/resources.md 输出“写入来源”“变更事件”“订阅”，验收 2、5 的直接调用部分；
 * files.md 验收 5 的服务侧）：真实内核实例、真实目录与真实递归 `fs.watch`。一批的合并用场地的手动时钟推进，不按时长
 * 等待。
 *
 * “没有某个事件”用屏障判定：之后再做一次外部修改，等它的事件到达；inotify 按发生顺序投递，屏障到了，之前的事件
 * 也已处理完。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {watch} from "node:fs";
import {mkdir, readdir, readFile, readlink, rename, rm, stat, symlink, unlink, utimes, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {SettingsWorld} from "nbook/plugins/settings/testing/world";

import {BATCH_DELAY_MS, MAX_BATCH_PATHS} from "./backend/changes";
import {projectFilesContract, userFilesContract} from "./shared/contracts";
import type {FileChange, Scheme, WatchMessage} from "./shared/contracts";
import {extraWindow, files, filesScene, hash, remote} from "./testing/scene";
import type {Layout, Probe, Scene} from "./testing/scene";

let tmp = "";
let counter = 0;
const worlds: SettingsWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-files", "changes");
});

afterEach(async () => {
    const results = [];
    for (const world of worlds.splice(0)) results.push(...(await world.close()));
    for (const result of results) expect(result).toMatchObject({status: "closed"});
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function scene(layout: {readonly project?: Layout; readonly user?: Layout} = {}): Promise<Scene> {
    counter += 1;
    const created = await filesScene(join(tmp, `world-${String(counter)}`), layout);
    worlds.push(created.world);
    return created;
}

interface Watching {
    readonly messages: WatchMessage[];
    readonly release: () => void;
}

/** 订阅并等到 `ready`。 */
async function watching(of: Probe, scheme: Scheme): Promise<Watching> {
    const messages: WatchMessage[] = [];
    const release = files(of).watch(scheme, (message) => messages.push(message));
    await waitUntil(`${scheme}:// 的订阅就绪`, () => messages.some((message) => message.kind === "ready"));
    return {messages, release};
}

const changes = (watched: Watching): FileChange[] => watched.messages.flatMap((message) => (message.kind === "batch" ? message.events : []));

/** 推进手动时钟直到条件成立：原始事件到了之后，合并窗口过去才处理一批。 */
function settle<T>(created: Scene, description: string, check: () => T) {
    return waitUntil(description, () => {
        created.world.clock.advance(BATCH_DELAY_MS);
        return check();
    });
}

/** 屏障：外部写一个文件，等它的外部事件到达。 */
async function barrier(created: Scene, watched: Watching, name: string): Promise<void> {
    await writeFile(join(created.project, name), name);
    await settle(created, `屏障 ${name} 的事件`, () => changes(watched).some((change) => change.path === name && change.source.kind === "external"));
}

/** 本进程 inotify 监视着的目录数（Linux）：Bun 的全部 `fs.watch` 共用一个 inotify 实例，递归监视每个目录占一项。 */
async function inotifyCount(): Promise<number> {
    const fds = await readdir("/proc/self/fd");
    let watches = 0;
    for (const fd of fds) {
        const target = await readlink(`/proc/self/fd/${fd}`).catch(() => "");
        if (target !== "anon_inode:inotify") continue;
        const info = await readFile(`/proc/self/fdinfo/${fd}`, "utf8").catch(() => "");
        watches += info.split("\n").filter((line) => line.startsWith("inotify wd:")).length;
    }
    return watches;
}

describe("Spec workspace.resources 写入来源：按调用方身份", () => {
    it("窗口里的插件保存为写作者，项目实例与服务端里的插件为系统，都带调用的插件；输入带来源字段被拒", async () => {
        const created = await scene({project: {"a.md": "A", "b.md": "B"}, user: {"u.md": "U"}});
        const project = await watching(created.window, "project");
        const user = await watching(created.window, "user");

        expect(await files(created.window).write("project://a.md", "A2", {hash: hash("A")})).toMatchObject({ok: true});
        expect(await remote(created.inProject).use(projectFilesContract).write({path: "b.md", text: "B2", baseline: {hash: hash("B")}})).toMatchObject({ok: true});
        expect(await remote(created.hub).use(userFilesContract).write({path: "u.md", text: "U2", baseline: {hash: hash("U")}})).toMatchObject({ok: true});
        await waitUntil("两条项目保存事件", () => changes(project).length >= 2);
        await waitUntil("用户资产的保存事件", () => changes(user).length >= 1);
        expect(changes(project)).toEqual([
            {type: "changed", path: "a.md", source: {kind: "user", plugin: "x.explorer"}},
            {type: "changed", path: "b.md", source: {kind: "system", plugin: "x.project"}},
        ]);
        expect(changes(user)).toEqual([{type: "changed", path: "u.md", source: {kind: "system", plugin: "x.hub"}}]);

        const forged = {path: "a.md", text: "A3", baseline: {hash: hash("A2")}, source: {kind: "user", plugin: "x.explorer"}};
        expect(await remote(created.inProject).use(projectFilesContract).write(forged as never)).toMatchObject({ok: false, code: "invalid-input"});
    });
});

describe("Spec workspace.resources 变更事件：外部变化", () => {
    it("外部写、删、改名与新建子目录里的文件：存在为 changed、不在为 deleted，来源为外部", async () => {
        const created = await scene({project: {"old.md": "O", "gone.md": "G"}});
        const project = await watching(created.window, "project");
        await writeFile(join(created.project, "new.md"), "N");
        await unlink(join(created.project, "gone.md"));
        await rename(join(created.project, "old.md"), join(created.project, "renamed.md"));
        await mkdir(join(created.project, "vol", "deep"), {recursive: true});
        await writeFile(join(created.project, "vol", "deep", "ch.md"), "C");
        const expected: FileChange[] = [
            {type: "changed", path: "new.md", source: {kind: "external"}},
            {type: "deleted", path: "gone.md", source: {kind: "external"}},
            {type: "deleted", path: "old.md", source: {kind: "external"}},
            {type: "changed", path: "renamed.md", source: {kind: "external"}},
            {type: "changed", path: "vol/deep/ch.md", source: {kind: "external"}},
        ];
        await settle(created, "五个外部变化都到达", () => expected.every((event) => changes(project).some((change) => change.path === event.path && change.type === event.type)));
        for (const event of expected) expect(changes(project)).toContainEqual(event);
    });

    it("控制目录里的变化不发出", async () => {
        const created = await scene({project: {".nbook/x.json": "{}"}});
        const project = await watching(created.window, "project");
        await writeFile(join(created.project, ".nbook", "x.json"), "{\"a\": 1}");
        await barrier(created, project, "after.md");
        expect(changes(project).filter((change) => change.path.startsWith(".nbook"))).toEqual([]);
    });
});

describe("Spec workspace.resources 变更事件：自己写入的回声", () => {
    it("一次保存只有一条带来源的事件：没有临时文件的事件，监视报来的回声不以外部来源重复", async () => {
        const created = await scene({project: {"chapter.md": "AAAA"}});
        const project = await watching(created.window, "project");
        expect(await files(created.window).write("project://chapter.md", "BBBB", {hash: hash("AAAA")})).toMatchObject({ok: true});
        await barrier(created, project, "barrier.md");
        expect(changes(project).filter((change) => change.path !== "barrier.md")).toEqual([{type: "changed", path: "chapter.md", source: {kind: "user", plugin: "x.explorer"}}]);
    });

    it("保存之后外部写入同样长度并恢复修改时间：仍作为外部修改发出", async () => {
        const created = await scene({project: {"chapter.md": "AAAA"}});
        const project = await watching(created.window, "project");
        expect(await files(created.window).write("project://chapter.md", "BBBB", {hash: hash("AAAA")})).toMatchObject({ok: true});
        await barrier(created, project, "first.md");
        const saved = await stat(join(created.project, "chapter.md"));
        await writeFile(join(created.project, "chapter.md"), "CCCC");
        await utimes(join(created.project, "chapter.md"), saved.atime, saved.mtime);
        await settle(created, "外部修改的事件", () => changes(project).some((change) => change.path === "chapter.md" && change.source.kind === "external"));
    });

    it("经目录链接保存：请求地址与真实地址各一条带来源的事件，真实路径的回声不记为外部", async () => {
        const created = await scene({project: {"actual/story.md": "S"}});
        await symlink("actual", join(created.project, "alias"));
        const project = await watching(created.window, "project");
        expect(await files(created.window).write("project://alias/story.md", "S2", {hash: hash("S")})).toMatchObject({ok: true});
        await barrier(created, project, "barrier.md");
        expect(changes(project).filter((change) => change.path !== "barrier.md")).toEqual([
            {type: "changed", path: "alias/story.md", source: {kind: "user", plugin: "x.explorer"}},
            {type: "changed", path: "actual/story.md", source: {kind: "user", plugin: "x.explorer"}},
        ]);
    });
});

describe("Spec workspace.resources 订阅：共享、释放与失同步", () => {
    it("同一窗口两个监听者共用订阅：释放一个，另一个继续收到；最后一个释放后监视器关闭", async () => {
        // 有子目录：递归监视为它们各加一项，监视器开关在目录数上看得出来（根目录本身可能已被配置的监视占着）。
        const created = await scene({project: {"vol/a/x.md": "", "vol/b/y.md": ""}});
        const before = await inotifyCount();
        const first = await watching(created.window, "project");
        const second = await watching(created.window, "project");
        const watchingCount = await inotifyCount();
        expect(watchingCount).toBeGreaterThan(before);
        first.release();
        first.release();
        await writeFile(join(created.project, "x.md"), "X");
        await settle(created, "第二个监听者收到外部变化", () => changes(second).some((change) => change.path === "x.md"));
        expect(changes(first)).toEqual([]);
        second.release();
        await waitUntil("最后一个监听者释放后监视器关闭", async () => (await inotifyCount()) === before);
    });

    it("订阅还没建立就释放：监视器最终关闭，监听者不被回调", async () => {
        const created = await scene({project: {"vol/a/x.md": ""}});
        const before = await inotifyCount();
        const messages: WatchMessage[] = [];
        const release = files(created.window).watch("project", (message) => messages.push(message));
        release();
        // 另一个窗口的订阅建立完成，说明前一次建立的请求也已处理过；之后它被撤回。
        const other = await extraWindow(created, "w2");
        const second = await watching(other, "project");
        second.release();
        await waitUntil("监视器关闭", async () => (await inotifyCount()) === before);
        expect(messages).toEqual([]);
    });

    it("一批待处理的路径过多：只推 resync，不逐条发出", async () => {
        const created = await scene();
        const project = await watching(created.window, "project");
        // 本测试自己的监视器与文件服务的监视器由同一个 Bun 监视线程投递：它看到最后一个文件，文件服务也看到了。
        let seen = false;
        const last = `f${String(MAX_BATCH_PATHS)}.md`;
        const probe = watch(created.project, {recursive: true}, (_event, filename) => {
            if (filename === last) seen = true;
        });
        try {
            for (let index = 0; index <= MAX_BATCH_PATHS; index += 1) await writeFile(join(created.project, `f${String(index)}.md`), "");
            await waitUntil("最后一个文件的原始事件", () => seen);
        } finally {
            probe.close();
        }
        await settle(created, "resync", () => project.messages.some((message) => message.kind === "resync"));
        expect(changes(project)).toEqual([]);
    });

    it("根目录被移走：订阅以 root-gone 结束，之后不再有回调", async () => {
        const created = await scene();
        const project = await watching(created.window, "project");
        await rename(created.project, `${created.project}-moved`);
        await settle(created, "订阅结束", () => project.messages.some((message) => message.kind === "ended"));
        expect(project.messages.at(-1)).toEqual({kind: "ended", reason: "root-gone"});
        await rename(`${created.project}-moved`, created.project);
    });
});
