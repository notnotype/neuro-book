/**
 * 资源管理器控制器的浏览部分（docs/specs/workbench/files-explorer.md 验收 1、2、3、10，以及“增量刷新的依赖”）：真实
 * 内核实例、真实目录与递归 `fs.watch`，经窗口里的文件客户端。变化的合并用场地的手动时钟推进。
 *
 * - “没有发出某类请求”看窗口链路上记下的请求（`files/testing/tap.ts`）：同字节保存不改字节，只看磁盘看不出来。
 * - 列出在途时的时序用回复闸门制造：真实列出已经完成，扣住回复，先让变化事件到达模型，再交付旧回复。
 * - 打开经真实的命令表：编辑器区还没有时，测试登记一条 `nbook.editor.open` 记录调用。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {chmod, mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {Type} from "typebox";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {contextTable} from "nbook/plugins/commands/shared/context-keys";
import {createCommandRegistry} from "nbook/plugins/commands/shared/registry";
import type {CommandRegistry} from "nbook/plugins/commands/shared/registry";
import {BATCH_DELAY_MS} from "nbook/plugins/files/backend/changes";
import type {FilesService, WatchMessage} from "nbook/plugins/files/shared/contracts";
import {extraWindow, files, filesScene} from "nbook/plugins/files/testing/scene";
import type {Layout, Scene} from "nbook/plugins/files/testing/scene";
import {createLinkTap, filesWrites} from "nbook/plugins/files/testing/tap";
import type {LinkTap} from "nbook/plugins/files/testing/tap";

import {createExplorerController, OPEN_COMMAND} from "./web/controller";
import type {ExplorerController} from "./web/controller";
import type {EntryRow, Row} from "./web/tree/rows";

/** 权限用例要求以普通用户运行，root 时跳过。 */
const privileged = process.getuid?.() === 0;

let tmp = "";
let counter = 0;
const scenes: Scene[] = [];
const controllers: ExplorerController[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-explorer", "controller");
});

afterEach(async () => {
    for (const controller of controllers.splice(0)) controller.dispose();
    const results = [];
    for (const created of scenes.splice(0)) {
        results.push(...(await created.world.close()));
        await chmod(join(created.project, "locked"), 0o755).catch(() => undefined);
        await rm(created.root, {recursive: true, force: true});
    }
    for (const result of results) expect(result).toMatchObject({status: "closed"});
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<content>
  <item name="alice" title="爱丽丝"/>
  <item name="bob" title="鲍勃">
    <item name="sword" title="宝剑"/>
  </item>
</content>
`;

const LAYOUT: Layout = {
    "lore.content/content.xml": MANIFEST,
    "lore.content/alice/notes.md": "A",
    "lore.content/bob/index.md": "BOB",
    "lore.content/bob/sword/index.md": "SWORD",
    "broken.content/content.xml": "<oops",
    "broken.content/child/index.md": "C",
    "story.binder/binder.xml": "<binder/>",
    "story.binder/ch1.md": "1",
    "plain/a.md": "PA",
    "plain/index.md": "PI",
    "plain/sub/x.md": "X",
};

interface World {
    readonly scene: Scene;
    readonly tap: LinkTap;
    readonly client: FilesService;
    /** 与控制器共用同一条订阅、登记在它之后：它收到的事件，控制器已经处理过。 */
    readonly seen: WatchMessage[];
}

async function world(layout: Layout = LAYOUT, user: Layout = {"notes.md": "U"}): Promise<World> {
    counter += 1;
    const tap = createLinkTap();
    const scene = await filesScene(join(tmp, `world-${String(counter)}`), {project: layout, user}, {wrapLink: tap.wrap});
    scenes.push(scene);
    return {scene, tap, client: files(scene.window), seen: []};
}

function registry(): CommandRegistry {
    return createCommandRegistry({contextKeys: contextTable({}), report: (error) => {
        throw error;
    }});
}

/** 登记一条记录调用的 `nbook.editor.open`；返回记录。 */
function editor(commands: CommandRegistry): Array<{address: string; mode: string}> {
    const opened: Array<{address: string; mode: string}> = [];
    const registered = commands.register({
        id: OPEN_COMMAND,
        source: "nbook.test-editor",
        declaration: {
            title: {"zh-CN": "打开", "en-US": "Open"},
            description: "Open a resource in the editor.",
            args: Type.Object({address: Type.String(), mode: Type.Union([Type.Literal("preview"), Type.Literal("permanent")])}, {additionalProperties: false}),
            effect: "read",
        },
        run: (args) => {
            opened.push(args as {address: string; mode: string});
            return {ok: true, value: null};
        },
    });
    if (!registered.ok) throw new Error(registered.reason);
    return opened;
}

function explorer(at: World, options: {expanded?: string[]; commands?: CommandRegistry; client?: FilesService; bound?: boolean} = {}): ExplorerController {
    const controller = createExplorerController({
        files: options.client ?? at.client,
        commands: options.commands ?? registry(),
        bound: options.bound ?? true,
        ...(options.expanded === undefined ? {} : {expanded: options.expanded}),
        report: (error) => {
            throw error;
        },
    });
    controllers.push(controller);
    // 登记在控制器之后：同一条订阅按登记顺序投递。
    (options.client ?? at.client).watch("project", (message) => at.seen.push(message));
    return controller;
}

const row = (controller: ExplorerController, id: string): Row | undefined => controller.rows.value.find((candidate) => candidate.id === id);

function entry(controller: ExplorerController, id: string): EntryRow {
    const found = row(controller, id);
    if (found?.kind !== "entry") throw new Error(`没有资源行 ${id}：${controller.rows.value.map((candidate) => candidate.id).join(", ")}`);
    return found;
}

/** 等到某行出现并满足条件；期间推进手动时钟，让变化合并成批送出。 */
async function until(at: World, description: string, check: () => boolean): Promise<void> {
    await waitUntil(description, () => {
        at.scene.world.clock.advance(BATCH_DELAY_MS);
        return check();
    });
}

/** 等控制器处理完路径为 `path` 的事件（登记在它之后的监听者也收到了）。 */
async function processed(at: World, path: string): Promise<void> {
    await until(at, `${path} 的事件`, () => at.seen.some((message) => message.kind === "batch" && message.events.some((event) => event.path === path)));
}

const EXPANDED = ["project://", "project://plain", "project://lore.content", "project://lore.content/bob", "project://broken.content", "project://broken.content/child", "project://story.binder"];

describe("Spec workbench.files-explorer 验收 1、2：浏览", () => {
    it("按需列出展开的目录，三类文件夹按呈现规则成行；浏览与切换显示不读正文、不发写请求", async () => {
        const at = await world();
        const controller = explorer(at, {expanded: EXPANDED});
        await until(at, "全部展开的目录列出", () => row(controller, "project://lore.content/bob/sword") !== undefined && row(controller, "project://broken.content/child/index.md") !== undefined && row(controller, "project://story.binder/ch1.md") !== undefined);
        expect(entry(controller, "project://plain/index.md")).toMatchObject({label: "index.md", opens: "project://plain/index.md"});
        expect(entry(controller, "project://lore.content/alice")).toMatchObject({label: "爱丽丝", subtitle: "alice", node: true, body: false});
        expect(entry(controller, "project://lore.content/bob")).toMatchObject({label: "鲍勃", body: true, opens: "project://lore.content/bob/index.md"});
        expect(entry(controller, "project://lore.content/bob/sword")).toMatchObject({label: "宝剑", node: true});
        expect(row(controller, "project://lore.content/bob/index.md")).toBeUndefined();
        expect(entry(controller, "project://broken.content/child")).toMatchObject({node: false});
        expect(row(controller, "project://broken.content#manifest")).toMatchObject({status: "manifest", code: "invalid"});
        expect(entry(controller, "project://story.binder")).toMatchObject({binder: true});
        expect(entry(controller, "project://story.binder/binder.xml")).toMatchObject({manifest: false});
        expect(row(controller, "user://")).toMatchObject({expanded: false});
        // 没展开的目录不列出。
        expect(row(controller, "project://plain/sub/x.md")).toBeUndefined();

        controller.setShowManifests(true);
        expect(entry(controller, "project://lore.content/content.xml")).toMatchObject({manifest: true});
        controller.setShowManifests(false);
        controller.click("project://plain/sub", {toggle: false, range: false}, "row");
        await until(at, "plain/sub 列出", () => row(controller, "project://plain/sub/x.md") !== undefined);

        expect(at.tap.requests.filter((request) => request.method === "read")).toEqual([]);
        expect(filesWrites(at.tap.requests)).toEqual([]);
        expect(at.tap.requests.filter((request) => request.method === "list").map((request) => (request.input as {path: string}).path)).not.toContain("plain/sub/x.md");
    });

    it("没有绑定项目：项目根没有子行，用户资产根照常列出", async () => {
        const at = await world();
        const unbound = await extraWindow(at.scene, "w2", {bound: false});
        const controller = explorer(at, {client: files(unbound), bound: false, expanded: ["user://"]});
        await until(at, "用户资产根列出", () => row(controller, "user://notes.md") !== undefined);
        expect(row(controller, "project://")).toMatchObject({status: {kind: "unbound"}, expanded: false});
        expect(controller.rows.value.filter((candidate) => candidate.id.startsWith("project://") && candidate.id !== "project://")).toEqual([]);
    });

    it.skipIf(privileged)("读取失败与空目录分开显示", async () => {
        const at = await world({"plain/a.md": "A", "empty/.keep": "", "locked/a.md": "L"});
        await rm(join(at.scene.project, "empty", ".keep"));
        await chmod(join(at.scene.project, "locked"), 0o000);
        const controller = explorer(at, {expanded: ["project://", "project://empty", "project://locked", "project://ghost"]});
        await until(at, "empty 与 locked 列出", () => row(controller, "project://empty#empty") !== undefined && row(controller, "project://locked#error") !== undefined);
        expect(row(controller, "project://locked#error")).toMatchObject({status: "error", code: "permission-denied"});
        expect(row(controller, "project://locked#empty")).toBeUndefined();
        // 展开记录里的 ghost 在父目录列出后确认不存在：从展开集合去掉，不当作读取失败显示。
        expect(controller.model.expanded.value.has("project://ghost")).toBe(false);
        expect(row(controller, "project://ghost#error")).toBeUndefined();
    });
});

describe("Spec workbench.files-explorer 增量刷新的依赖", () => {
    it("清单改一次：已展开的嵌套层标题都更新；外部改清单同样更新", async () => {
        const at = await world();
        const controller = explorer(at, {expanded: EXPANDED});
        await until(at, "嵌套层列出", () => row(controller, "project://lore.content/bob/sword") !== undefined);
        expect(await at.client.display("project://lore.content/bob/sword", {title: "神剑"})).toEqual({ok: true, value: {}});
        await until(at, "嵌套层的标题更新", () => entry(controller, "project://lore.content/bob/sword").label === "神剑");
        await writeFile(join(at.scene.project, "lore.content", "content.xml"), MANIFEST.replace("爱丽丝", "艾丽斯"));
        await until(at, "外部改清单后标题更新", () => entry(controller, "project://lore.content/alice").label === "艾丽斯");
    });

    it("节点正文的增删更新父层的正文入口", async () => {
        const at = await world();
        const controller = explorer(at, {expanded: ["project://", "project://lore.content"]});
        await until(at, "内容文件夹列出", () => row(controller, "project://lore.content/alice") !== undefined);
        expect(entry(controller, "project://lore.content/alice").opens).toBeNull();
        expect(await at.client.createContent("project://lore.content/alice")).toEqual({ok: true, value: {}});
        await until(at, "alice 有了正文", () => entry(controller, "project://lore.content/alice").opens === "project://lore.content/alice/index.md");
        await rm(join(at.scene.project, "lore.content", "alice", "index.md"));
        await until(at, "外部删除正文后 alice 没有正文", () => entry(controller, "project://lore.content/alice").body === false);
    });

    it("展开的目录改名：子树在新地址继续展开，选择跟随", async () => {
        const at = await world();
        const controller = explorer(at, {expanded: ["project://", "project://plain", "project://plain/sub"]});
        await until(at, "plain/sub 列出", () => row(controller, "project://plain/sub/x.md") !== undefined);
        controller.click("project://plain/sub/x.md", {toggle: false, range: false}, "row");
        expect(await at.client.rename("project://plain/sub", "sub2")).toEqual({ok: true, value: {}});
        await until(at, "新地址列出", () => row(controller, "project://plain/sub2/x.md") !== undefined);
        expect(row(controller, "project://plain/sub")).toBeUndefined();
        expect(controller.selection.value.selected).toEqual(["project://plain/sub2/x.md"]);
        expect(controller.model.expanded.value.has("project://plain/sub2")).toBe(true);
    });

    it("列出在途时外部新建：旧回复到达后再列一次，不漏新项", async () => {
        const at = await world();
        const controller = explorer(at, {expanded: ["project://"]});
        await until(at, "根列出", () => row(controller, "project://plain") !== undefined);
        const held = at.tap.hold((request) => request.method === "list" && (request.input as {path: string}).path === "plain");
        controller.click("project://plain", {toggle: false, range: false}, "row");
        await held.arrived;
        await writeFile(join(at.scene.project, "plain", "new.md"), "N");
        await processed(at, "plain/new.md");
        held.release();
        await until(at, "新项出现", () => row(controller, "project://plain/new.md") !== undefined);
        expect(entry(controller, "project://plain/a.md").label).toBe("a.md");
    });

    it("列出在途时目录被删除又重建：旧回复不回填到新目录", async () => {
        const at = await world();
        const controller = explorer(at, {expanded: ["project://", "project://plain"]});
        await until(at, "plain 列出", () => row(controller, "project://plain/sub") !== undefined);
        const held = at.tap.hold((request) => request.method === "list" && (request.input as {path: string}).path === "plain/sub");
        controller.click("project://plain/sub", {toggle: false, range: false}, "row");
        await held.arrived;
        expect(await at.client.delete([{address: "project://plain/sub"}]).result).toMatchObject({ok: true, value: {items: [{status: "done"}]}});
        await processed(at, "plain/sub");
        await mkdir(join(at.scene.project, "plain", "sub"));
        await writeFile(join(at.scene.project, "plain", "sub", "y.md"), "Y");
        held.release();
        await until(at, "重建的目录出现", () => row(controller, "project://plain/sub") !== undefined);
        controller.click("project://plain/sub", {toggle: false, range: false}, "row");
        await until(at, "新目录的内容列出", () => row(controller, "project://plain/sub/y.md") !== undefined);
        expect(row(controller, "project://plain/sub/x.md")).toBeUndefined();
    });

    it("订阅建立之前已经列出的目录：订阅就绪后重新核对，不漏其间的变化", async () => {
        const at = await world();
        const subscribe = at.tap.holdSend((frame) => frame.type === "subscribe" && frame.contract === "nbook.files/project");
        const controller = explorer(at, {expanded: ["project://"]});
        await subscribe.arrived;
        await until(at, "根列出", () => row(controller, "project://plain") !== undefined);
        await writeFile(join(at.scene.project, "early.md"), "E");
        subscribe.release();
        await until(at, "订阅就绪前新建的文件出现", () => row(controller, "project://early.md") !== undefined);
    });

    it("收起的目录收到变化只记为过期，再展开时重列", async () => {
        const at = await world();
        const controller = explorer(at, {expanded: ["project://", "project://plain"]});
        await until(at, "plain 列出", () => row(controller, "project://plain/a.md") !== undefined);
        controller.click("project://plain", {toggle: false, range: false}, "row");
        expect(row(controller, "project://plain/a.md")).toBeUndefined();
        await writeFile(join(at.scene.project, "plain", "later.md"), "L");
        await processed(at, "plain/later.md");
        controller.click("project://plain", {toggle: false, range: false}, "row");
        await until(at, "再展开后新文件出现", () => row(controller, "project://plain/later.md") !== undefined);
    });

    it("断线重连后重新核对：断线期间的外部变化出现", async () => {
        const at = await world();
        const controller = explorer(at, {expanded: ["project://", "project://plain"]});
        await until(at, "plain 列出", () => row(controller, "project://plain/a.md") !== undefined);
        at.scene.windowLink.disconnect();
        await writeFile(join(at.scene.project, "plain", "offline.md"), "O");
        expect(await at.scene.windowLink.reconnect()).toMatchObject({ok: true});
        await until(at, "断线期间新建的文件出现", () => row(controller, "project://plain/offline.md") !== undefined);
    });

    it("项目代次结束：根标为已停止同步并给出原因", async () => {
        const at = await world();
        const controller = explorer(at, {expanded: ["project://"]});
        await until(at, "根列出", () => row(controller, "project://plain") !== undefined);
        await at.scene.projectApp.stop();
        await until(at, "根已停止同步", () => row(controller, "project://")?.kind === "root" && (row(controller, "project://") as {status: {kind: string}}).status.kind === "ended");
        expect(row(controller, "user://")).toMatchObject({status: {kind: "live"}});
    });
});

describe("Spec workbench.files-explorer 验收 2、3：点击与打开", () => {
    it("单击文件 preview、双击与 Enter permanent；节点行的打开区打开正文；无正文节点只选中；修饰点击不打开", async () => {
        const at = await world();
        const commands = registry();
        const opened = editor(commands);
        const controller = explorer(at, {expanded: ["project://", "project://plain", "project://lore.content"], commands});
        await until(at, "目录列出", () => row(controller, "project://lore.content/bob") !== undefined && row(controller, "project://plain/a.md") !== undefined);

        controller.click("project://plain/a.md", {toggle: false, range: false}, "row");
        controller.activate("project://plain/index.md");
        controller.click("project://lore.content/bob", {toggle: false, range: false}, "row");
        controller.click("project://lore.content/alice", {toggle: false, range: false}, "row");
        expect(controller.selection.value.selected).toEqual(["project://lore.content/alice"]);
        controller.click("project://plain/a.md", {toggle: true, range: false}, "row");
        controller.click("project://plain/index.md", {toggle: false, range: true}, "row");
        expect(controller.key({key: "Enter", shift: false, toggle: false, alt: false}, 10)).toBe(true);
        await waitUntil("打开的命令执行完", () => opened.length === 4);
        expect(opened).toEqual([
            {address: "project://plain/a.md", mode: "preview"},
            {address: "project://plain/index.md", mode: "permanent"},
            {address: "project://lore.content/bob/index.md", mode: "preview"},
            {address: "project://plain/index.md", mode: "permanent"},
        ]);
        // 节点行的展开箭头只展开，不打开。
        controller.click("project://lore.content/bob", {toggle: false, range: false}, "twisty");
        await until(at, "bob 展开", () => row(controller, "project://lore.content/bob/sword") !== undefined);
        expect(opened).toHaveLength(4);
        expect(controller.notice.value).toBeNull();
    });

    it("编辑器区还没有：打开显示“编辑器尚未接入”，不伪装成功", async () => {
        const at = await world();
        const controller = explorer(at, {expanded: ["project://", "project://plain"]});
        await until(at, "plain 列出", () => row(controller, "project://plain/a.md") !== undefined);
        controller.click("project://plain/a.md", {toggle: false, range: false}, "row");
        await waitUntil("提示出现", () => controller.notice.value);
        expect(controller.notice.value).toEqual({kind: "editor-missing", address: "project://plain/a.md"});
    });
});
