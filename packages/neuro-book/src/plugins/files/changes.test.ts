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


import {BATCH_DELAY_MS, MAX_BATCH_PATHS} from "./backend/changes";
import {projectFilesContract, userFilesContract} from "./shared/contracts";
import type {FileChange, Scheme, WatchMessage} from "./shared/contracts";
import {extraWindow, files, filesScene, hash, remote} from "./testing/scene";
import type {Layout, Probe, Scene} from "./testing/scene";

let tmp = "";
let counter = 0;
const scenes: Scene[] = [];
/** 读 `/proc` 的用例只在 Linux 上跑。 */
const linux = process.platform === "linux";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-files", "changes");
});

afterEach(async () => {
    const results = [];
    for (const created of scenes.splice(0)) {
        results.push(...(await created.world.close()));
        await rm(created.root, {recursive: true, force: true});
    }
    for (const result of results) expect(result).toMatchObject({status: "closed"});
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function scene(layout: {readonly project?: Layout; readonly user?: Layout} = {}): Promise<Scene> {
    counter += 1;
    const created = await filesScene(join(tmp, `world-${String(counter)}`), layout);
    scenes.push(created);
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

/** 写好之后等本测试自己的监视器看到最后一个文件：它与文件服务的监视器由同一个 Bun 监视线程投递。 */
async function writeAndSee(directory: string, names: ReadonlyArray<string>): Promise<void> {
    let seen = false;
    const last = names.at(-1)!;
    const probe = watch(directory, {recursive: true}, (_event, filename) => {
        if (filename !== null && filename.endsWith(last)) seen = true;
    });
    try {
        for (const name of names) await writeFile(join(directory, name), "");
        await waitUntil(`${last} 的原始事件`, () => seen);
    } finally {
        probe.close();
    }
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

    it("文件名含换行：保存时的临时文件同样不发出", async () => {
        const name = "line\nname.md";
        const created = await scene({project: {[name]: "L"}});
        const project = await watching(created.window, "project");
        expect(await files(created.window).write(`project://${name}`, "L2", {hash: hash("L")})).toMatchObject({ok: true});
        await barrier(created, project, "barrier.md");
        expect(changes(project).filter((change) => change.path !== "barrier.md")).toEqual([{type: "changed", path: name, source: {kind: "user", plugin: "x.explorer"}}]);
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
    it.skipIf(!linux)("同一窗口两个监听者共用订阅：释放一个，另一个继续收到；最后一个释放后监视器关闭", async () => {
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

    it.skipIf(!linux)("订阅还没建立就释放：监视器最终关闭，监听者不被回调", async () => {
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
        await writeAndSee(created.project, Array.from({length: MAX_BATCH_PATHS + 1}, (_unused, index) => `f${String(index)}.md`));
        await settle(created, "resync", () => project.messages.some((message) => message.kind === "resync"));
        expect(changes(project)).toEqual([]);
    });

    it("一批编码后装不进一条 RPC 消息（路径很长、条数在上限内）：只推 resync", async () => {
        const deep = Array.from({length: 5}, (_unused, index) => `${String(index)}${"d".repeat(239)}`).join("/");
        const created = await scene({project: {[`${deep}/seed.md`]: ""}});
        const project = await watching(created.window, "project");
        const count = 900;
        expect(count).toBeLessThan(MAX_BATCH_PATHS);
        await writeAndSee(join(created.project, deep), Array.from({length: count}, (_unused, index) => `f${String(index)}.md`));
        await settle(created, "resync", () => project.messages.some((message) => message.kind === "resync"));
        expect(changes(project)).toEqual([]);
    });

    it("处理中的一批在最后一个订阅释放时作废：之后的新订阅收不到之前的变化", async () => {
        const created = await scene();
        const old = await watching(created.window, "project");
        await writeAndSee(created.project, Array.from({length: 500}, (_unused, index) => `race-${String(index)}.md`));
        // 推进时钟开始处理这一批（逐个 lstat，要一些时间），紧接着释放旧订阅、建立新订阅。
        created.world.clock.advance(BATCH_DELAY_MS);
        old.release();
        const other = await extraWindow(created, "w2");
        const fresh = await watching(other, "project");
        await barrier(created, fresh, "barrier.md");
        expect(changes(fresh).filter((change) => change.path.startsWith("race-"))).toEqual([]);
    });

    it("同一项目代次内断线重连：订阅由内核重建，监听者收到 resync，之后的变化照常到达", async () => {
        const created = await scene();
        const project = await watching(created.window, "project");
        created.windowLink.disconnect();
        expect(await created.windowLink.reconnect()).toMatchObject({ok: true});
        await waitUntil("重连后的 resync", () => project.messages.some((message) => message.kind === "resync"));
        await barrier(created, project, "after.md");
    });

    it("根目录被移走：同一窗口的全部监听者各收到一次 root-gone；在结束回调里被释放的监听者不再回调", async () => {
        const created = await scene();
        // 先加的先收到：`first` 在自己的结束回调里释放排在它后面的 `late`。
        const first: WatchMessage[] = [];
        let releaseLate = (): void => undefined;
        files(created.window).watch("project", (message) => {
            first.push(message);
            if (message.kind === "ended") releaseLate();
        });
        const late: WatchMessage[] = [];
        releaseLate = files(created.window).watch("project", (message) => late.push(message));
        const second = await watching(created.window, "project");
        await waitUntil("三个监听者都就绪", () => [late, first].every((messages) => messages.some((message) => message.kind === "ready")));
        await rename(created.project, `${created.project}-moved`);
        await settle(created, "订阅结束", () => second.messages.some((message) => message.kind === "ended"));
        expect(first.filter((message) => message.kind === "ended")).toEqual([{kind: "ended", reason: "root-gone"}]);
        expect(second.messages.filter((message) => message.kind === "ended")).toEqual([{kind: "ended", reason: "root-gone"}]);
        expect(late.filter((message) => message.kind === "ended")).toEqual([]);
        await rename(`${created.project}-moved`, created.project);
    });
});
