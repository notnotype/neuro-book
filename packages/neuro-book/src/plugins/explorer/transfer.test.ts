/**
 * 资源管理器的剪贴板、粘贴、碰撞、拖动与结果未知门禁（docs/specs/workbench/files-explorer.md 验收 4–8、15 与“剪贴板与冻结
 * 的意图”“结果未知”“拖动”）：真实内核实例、真实目录与清单（`testing/world.ts`）。“没有写入”看窗口链路上记下的写请求；
 * 竞态用真实的清单锁与回复交付闸门制造，不按毫秒等待。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {createHash} from "node:crypto";
import {mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {holdLock} from "nbook/backend/locked-replace";
import {extraWindow} from "nbook/plugins/files/testing/scene";
import type {Layout, Scene} from "nbook/plugins/files/testing/scene";
import {filesWrites} from "nbook/plugins/files/testing/tap";

import {entry, exists, explorerWorlds, row, select, until} from "./testing/world";
import type {ExplorerWorld} from "./testing/world";
import type {ExplorerController} from "./web/controller";

let tmp = "";
const worlds = explorerWorlds(() => tmp);
const heldLocks: Array<() => Promise<void>> = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-explorer", "transfer");
});

afterEach(async () => {
    for (const release of heldLocks.splice(0)) await release();
    await worlds.close();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const LAYOUT: Layout = {
    "lore.content/content.xml": `<?xml version="1.0" encoding="UTF-8"?>
<content>
  <item name="alice" title="爱丽丝"/>
  <item name="bob" title="鲍勃"/>
  <item name="gone" title="已删除"/>
</content>
`,
    "lore.content/alice/notes.md": "A",
    "lore.content/bob/index.md": "BOB",
    "lore.content/bob/attach.txt": "ATT",
    "lore.content/stray.md": "S",
    "plain/a.md": "PA",
    "plain/z.md": "Z",
    "plain/zz.md": "ZZ",
    "plain/sub/x.md": "X",
    "dest/a.md": "OLD-A",
    "dest/z.md": "OLD-Z",
};

const USER: Layout = {"notes/u.md": "U"};

const EXPANDED = ["project://", "project://plain", "project://lore.content", "project://dest", "user://", "user://notes"];
const READY = ["project://lore.content/alice", "project://plain/a.md", "project://dest/a.md", "user://notes/u.md"];

const world = (): Promise<ExplorerWorld> => worlds.world(LAYOUT, EXPANDED, READY, USER);
const at = (scene: Scene, path: string): string => join(scene.project, path);
const text = (path: string): Promise<string> => readFile(path, "utf8");
const writes = (world: ExplorerWorld) => filesWrites(world.tap.requests);
const OK = {ok: true} as const;

/** 等碰撞对话框问到某个源。 */
async function asked(world: ExplorerWorld, source: string): Promise<void> {
    await until(world, `问 ${source} 的同名`, () => world.controller.dialog.value?.kind === "collision" && world.controller.dialog.value.source === source);
}

/** 不选任何项、焦点留在某行：当前根取焦点行的方案。 */
function deselect(controller: ExplorerController, id: string): void {
    select(controller, id);
    controller.click(id, {toggle: true, range: false}, "row");
}

/** 占住一棵内容树的清单锁：批量的文件改完后停在改清单之前（真实的锁，不是钩子）。 */
async function holdManifest(scene: Scene, tree: string): Promise<() => Promise<void>> {
    const directory = at(scene, ".nbook/locks/files");
    await mkdir(directory, {recursive: true});
    const held = await holdLock(join(directory, `${createHash("sha256").update(`${tree}/content.xml`).digest("hex")}.lock`), () => undefined);
    if (!held.ok) throw new Error(held.detail);
    heldLocks.push(held.lock.release);
    return held.lock.release;
}

describe("Spec workbench.files-explorer 验收 5：复制与剪切", () => {
    it("复制冻结身份、可重复粘贴；再粘贴时同名逐个问，“对其余都这样”用各自的候选名", async () => {
        const w = await world();
        const {controller} = w;
        select(controller, "project://plain/a.md", "project://plain/z.md");
        expect(await controller.copy()).toEqual(OK);
        // 用 toEqual：Bun 的 toMatchObject 会把非对称匹配器写回被检查的对象（实测 1.4.2），那会改掉控制器里的令牌。
        expect(controller.clipboard.value).toEqual({id: expect.any(Number), mode: "copy", scheme: "project", items: [
            {address: "project://plain/a.md", token: expect.any(String), name: "a.md", directory: false},
            {address: "project://plain/z.md", token: expect.any(String), name: "z.md", directory: false},
        ]});
        // 复制不标剪切。
        expect(entry(controller, "project://plain/a.md").cut).toBe(false);

        select(controller, "project://plain/sub");
        expect(await controller.paste()).toEqual(OK);
        expect(await text(at(w.scene, "plain/sub/a.md"))).toBe("PA");
        expect(await text(at(w.scene, "plain/sub/z.md"))).toBe("Z");
        expect(controller.report.value).toBeNull();
        expect(writes(w).map((request) => [request.method, request.input])).toEqual([["copy", {operation: expect.any(String), items: [
            {source: "plain/a.md", target: "plain/sub/a.md", expected: expect.any(String)},
            {source: "plain/z.md", target: "plain/sub/z.md", expected: expect.any(String)},
        ]}]]);

        select(controller, "project://plain/sub");
        const again = controller.paste();
        await asked(w, "project://plain/a.md");
        expect(controller.dialog.value).toEqual({kind: "collision", action: "copy", source: "project://plain/a.md", target: "project://plain/sub/a.md", candidate: "a (2).md", error: null, busy: false});
        expect(controller.available.value.paste).toBe(false);
        controller.resolveCollision({kind: "rename", name: "a (2).md"}, true);
        expect(await again).toEqual(OK);
        expect(await text(at(w.scene, "plain/sub/a (2).md"))).toBe("PA");
        expect(await text(at(w.scene, "plain/sub/z (2).md"))).toBe("Z");
        expect(controller.clipboard.value?.mode).toBe("copy");
        expect(controller.focusRequest.value).toBeGreaterThan(0);
    });

    it("同目录复制不覆盖源：必须改名，改成已占用的名字原位提示", async () => {
        const w = await world();
        const {controller} = w;
        select(controller, "project://plain/a.md");
        await controller.copy();
        const pasting = controller.paste();
        await asked(w, "project://plain/a.md");
        controller.resolveCollision({kind: "rename", name: "z.md"}, false);
        expect(controller.dialog.value).toMatchObject({kind: "collision", error: {code: "conflict"}});
        controller.resolveCollision({kind: "rename", name: " a-copy.md "}, false);
        await pasting;
        expect(await text(at(w.scene, "plain/a-copy.md"))).toBe("PA");
        expect(await text(at(w.scene, "plain/a.md"))).toBe("PA");
        expect(await text(at(w.scene, "plain/z.md"))).toBe("Z");
    });

    it("剪切逐项结算：成功的移出剪贴板、失败的保留并仍标剪切；预判之后被占用仍是冲突；Escape 清除", async () => {
        const w = await world();
        const {controller} = w;
        select(controller, "project://plain/a.md", "project://plain/z.md");
        expect(await controller.cut()).toEqual(OK);
        expect(entry(controller, "project://plain/a.md").cut).toBe(true);
        const clipId = controller.clipboard.value?.id ?? null;

        select(controller, "project://plain/sub");
        // 预判用的列出结果在路上时，外部占用 z.md：预判看不到，提交时服务端排他重验为冲突。
        const listing = w.tap.hold((request) => request.method === "list" && (request.input as {path: string}).path === "plain/sub");
        const pasting = controller.paste();
        await listing.arrived;
        await writeFile(at(w.scene, "plain/sub/z.md"), "OTHER");
        listing.release();
        await pasting;
        expect(controller.report.value).toEqual({
            action: "move",
            items: [
                {address: "project://plain/a.md", target: "project://plain/sub/a.md", result: {status: "done"}},
                {address: "project://plain/z.md", target: "project://plain/sub/z.md", result: expect.objectContaining({status: "failed", code: "conflict"})},
            ],
            manifests: [],
            truncated: false,
        });
        expect(await text(at(w.scene, "plain/sub/z.md"))).toBe("OTHER");
        expect(await exists(at(w.scene, "plain/a.md"))).toBe(false);
        expect(controller.clipboard.value).toMatchObject({id: clipId, mode: "cut", items: [{address: "project://plain/z.md"}]});
        await until(w, "a.md 移走", () => row(controller, "project://plain/a.md") === undefined);
        expect(entry(controller, "project://plain/z.md").cut).toBe(true);

        expect(controller.clearCut()).toEqual(OK);
        expect(controller.clipboard.value).toBeNull();
        expect(entry(controller, "project://plain/z.md").cut).toBe(false);
        expect(controller.clearCut()).toEqual({ok: false, reason: "not-applicable"});
    });

    it("剪切粘贴在途时换了剪贴板：迟到的结果不动新剪贴板", async () => {
        const w = await world();
        const {controller} = w;
        select(controller, "project://plain/a.md");
        await controller.cut();
        select(controller, "project://plain/sub");
        const reply = w.tap.hold((request) => request.method === "move");
        const pasting = controller.paste();
        await reply.arrived;
        select(controller, "project://plain/z.md");
        await controller.cut();
        const swapped = controller.clipboard.value;
        reply.release();
        await pasting;
        expect(await exists(at(w.scene, "plain/sub/a.md"))).toBe(true);
        expect(controller.clipboard.value).toBe(swapped);
    });

    it("源被改名或同路径换成同字节的新文件后，旧意图为源已换；剪切标记随改名消失；剪贴板不改写地址", async () => {
        const w = await world();
        const {controller} = w;
        select(controller, "project://plain/a.md");
        await controller.cut();
        await rename(at(w.scene, "plain/a.md"), at(w.scene, "plain/b.md"));
        await until(w, "改名后的行出现", () => row(controller, "project://plain/b.md") !== undefined);
        expect(entry(controller, "project://plain/b.md").cut).toBe(false);
        expect(controller.clipboard.value?.items.map((item) => item.address)).toEqual(["project://plain/a.md"]);
        select(controller, "project://plain/sub");
        await controller.paste();
        expect(controller.report.value?.items).toEqual([{address: "project://plain/a.md", target: "project://plain/sub/a.md", result: expect.objectContaining({status: "failed", code: "source-changed"})}]);
        expect(await text(at(w.scene, "plain/b.md"))).toBe("PA");

        select(controller, "project://plain/z.md");
        await controller.copy();
        await rm(at(w.scene, "plain/z.md"));
        await writeFile(at(w.scene, "plain/z.md"), "Z");
        select(controller, "project://plain/sub");
        await controller.paste();
        expect(controller.report.value?.items).toEqual([{address: "project://plain/z.md", target: "project://plain/sub/z.md", result: expect.objectContaining({status: "failed", code: "source-changed"})}]);
        expect(await exists(at(w.scene, "plain/sub/z.md"))).toBe(false);
    });
});

describe("Spec workbench.files-explorer 验收 6：粘贴目标与源", () => {
    it("右键目录、选中文件的父目录、没有选择时的当前根，项目与用户资产两根各一次", async () => {
        const w = await world();
        const {controller} = w;
        select(controller, "project://plain/a.md");
        await controller.copy();
        controller.contextSelect("project://plain/sub");
        await controller.paste();
        expect(await text(at(w.scene, "plain/sub/a.md"))).toBe("PA");
        select(controller, "project://lore.content/stray.md");
        await controller.paste();
        expect(await text(at(w.scene, "lore.content/a.md"))).toBe("PA");
        expect(await text(at(w.scene, "lore.content/content.xml"))).toContain('name="a.md"');
        deselect(controller, "project://plain/z.md");
        expect(controller.selection.value.selected).toEqual([]);
        await controller.paste();
        expect(await text(at(w.scene, "a.md"))).toBe("PA");

        select(controller, "user://notes/u.md");
        await controller.copy();
        deselect(controller, "user://notes/u.md");
        await controller.paste();
        expect(await text(join(w.scene.user, "u.md"))).toBe("U");
        select(controller, "user://notes");
        const pasting = controller.paste();
        await asked(w, "user://notes/u.md");
        controller.closeDialog();
        await pasting;
        expect(controller.report.value?.items).toEqual([{address: "user://notes/u.md", target: "user://notes/u.md", result: {status: "declined", reason: "cancel"}}]);
    });

    it("多个选中的目录不猜；跨根粘贴拒绝且两端不变", async () => {
        const w = await world();
        const {controller} = w;
        select(controller, "project://plain/a.md");
        await controller.copy();
        select(controller, "project://plain/sub", "project://dest");
        expect(controller.available.value.paste).toBe(false);
        expect(await controller.paste()).toEqual({ok: false, reason: "no-target"});
        select(controller, "user://notes");
        expect(await controller.paste()).toEqual({ok: false, reason: "cross-root"});
        expect(writes(w)).toEqual([]);
        expect(await exists(join(w.scene.user, "notes", "a.md"))).toBe(false);
        expect(await text(at(w.scene, "plain/a.md"))).toBe("PA");
    });

    it("父子同时选中只取最外层；内容节点整目录复制带隐藏的正文与附件", async () => {
        const w = await world();
        const {controller} = w;
        controller.click("project://plain/sub", {toggle: false, range: false}, "twisty");
        await until(w, "sub 列出", () => row(controller, "project://plain/sub/x.md") !== undefined);
        select(controller, "project://plain/sub", "project://plain/sub/x.md");
        await controller.copy();
        expect(controller.clipboard.value?.items.map((item) => [item.address, item.directory])).toEqual([["project://plain/sub", true]]);

        select(controller, "project://lore.content/bob");
        await controller.copy();
        select(controller, "project://dest");
        await controller.paste();
        expect(await text(at(w.scene, "dest/bob/index.md"))).toBe("BOB");
        expect(await text(at(w.scene, "dest/bob/attach.txt"))).toBe("ATT");
        expect(await text(at(w.scene, "lore.content/bob/index.md"))).toBe("BOB");
    });

    it("移动到自身后代被拒绝；同目标移动无操作、不发写请求、剪贴板不变", async () => {
        const w = await world();
        const {controller} = w;
        select(controller, "project://plain");
        await controller.cut();
        controller.click("project://plain/sub", {toggle: false, range: false}, "row");
        select(controller, "project://plain/sub");
        await controller.paste();
        expect(controller.report.value?.items).toEqual([{address: "project://plain", target: "project://plain/sub/plain", result: expect.objectContaining({status: "failed", code: "into-itself"})}]);
        expect(await text(at(w.scene, "plain/a.md"))).toBe("PA");

        select(controller, "project://plain/a.md");
        await controller.cut();
        const clip = controller.clipboard.value;
        const before = writes(w).length;
        select(controller, "project://plain/z.md");
        expect(await controller.paste()).toEqual(OK);
        expect(writes(w).length).toBe(before);
        expect(controller.clipboard.value).toBe(clip);
    });
});

describe("Spec workbench.files-explorer 验收 7：碰撞", () => {
    it("跳过与取消剩余：被跳过、被取消的项都不提交，结果逐项列出", async () => {
        const w = await world();
        const {controller} = w;
        select(controller, "project://plain/a.md", "project://plain/z.md", "project://plain/zz.md");
        await controller.copy();
        select(controller, "project://dest");
        const pasting = controller.paste();
        await asked(w, "project://plain/a.md");
        controller.resolveCollision({kind: "skip"}, false);
        await asked(w, "project://plain/z.md");
        controller.resolveCollision({kind: "cancel"}, false);
        await pasting;
        expect(writes(w)).toEqual([]);
        expect(controller.report.value).toEqual({action: "copy", manifests: [], truncated: false, items: [
            {address: "project://plain/a.md", target: "project://dest/a.md", result: {status: "declined", reason: "skip"}},
            {address: "project://plain/z.md", target: "project://dest/z.md", result: {status: "declined", reason: "cancel"}},
            {address: "project://plain/zz.md", target: "project://dest/zz.md", result: {status: "declined", reason: "cancel"}},
        ]});
        expect(await text(at(w.scene, "dest/a.md"))).toBe("OLD-A");
    });

    it("“对其余同名项都跳过”：只问一次，不相撞的照常提交", async () => {
        const w = await world();
        const {controller} = w;
        select(controller, "project://plain/a.md", "project://plain/z.md", "project://plain/sub");
        await controller.copy();
        select(controller, "project://dest");
        const pasting = controller.paste();
        await asked(w, "project://plain/a.md");
        controller.resolveCollision({kind: "skip"}, true);
        await pasting;
        expect(writes(w).map((request) => (request.input as {items: Array<{target: string}>}).items.map((item) => item.target))).toEqual([["dest/sub"]]);
        expect(await text(at(w.scene, "dest/sub/x.md"))).toBe("X");
        expect(controller.report.value?.items.map((item) => item.result.status)).toEqual(["done", "declined", "declined"]);
    });

    it("对话框开着时外部占用了要改成的名字：确认后仍为该项冲突，不覆盖", async () => {
        const w = await world();
        const {controller} = w;
        select(controller, "project://plain/a.md");
        await controller.copy();
        select(controller, "project://dest");
        const pasting = controller.paste();
        await asked(w, "project://plain/a.md");
        await writeFile(at(w.scene, "dest/fresh.md"), "FRESH");
        controller.resolveCollision({kind: "rename", name: "fresh.md"}, false);
        await pasting;
        expect(controller.report.value?.items).toEqual([{address: "project://plain/a.md", target: "project://dest/fresh.md", result: expect.objectContaining({status: "failed", code: "conflict"})}]);
        expect(await text(at(w.scene, "dest/fresh.md"))).toBe("FRESH");
    });
});

describe("Spec workbench.files-explorer 验收 8、15：结果未知", () => {
    it("批量在途时断线：结果未知，复制、剪切、粘贴、拖动与删除都不可用、不发第二批；重新列出不解除，放弃后恢复并清掉剪贴板", async () => {
        const w = await world();
        const {controller} = w;
        select(controller, "project://plain/a.md", "project://plain/z.md");
        await controller.cut();
        const clipId = controller.clipboard.value?.id ?? null;
        await holdManifest(w.scene, "lore.content");
        select(controller, "project://lore.content/stray.md");
        const pasting = controller.paste();
        await waitUntil("第一项的文件已移动", () => exists(at(w.scene, "lore.content/a.md")));
        expect(controller.running.value).toMatchObject({action: "move", count: 2});
        w.scene.windowLink.disconnect();
        await pasting;
        expect(controller.unknown.value).toEqual({action: "move", clipboard: clipId, items: [
            {address: "project://plain/a.md", target: "project://lore.content/a.md"},
            {address: "project://plain/z.md", target: "project://lore.content/z.md"},
        ]});
        for (const release of heldLocks.splice(0)) await release();
        await w.scene.windowLink.reconnect();

        const sent = w.tap.requests.length;
        select(controller, "project://dest");
        expect(controller.available.value).toMatchObject({copy: false, cut: false, paste: false, delete: false});
        expect(await controller.paste()).toEqual({ok: false, reason: "unknown-outcome"});
        expect(await controller.copy()).toEqual({ok: false, reason: "unknown-outcome"});
        expect(await controller.delete()).toEqual({ok: false, reason: "unknown-outcome"});
        select(controller, "project://plain/sub");
        expect(controller.startDrag("project://plain/sub")).toBe(false);
        controller.recheck();
        expect(controller.unknown.value).not.toBeNull();
        expect(filesWrites(w.tap.requests.slice(sent))).toEqual([]);

        controller.abandon();
        expect(controller.unknown.value).toBeNull();
        expect(controller.clipboard.value).toBeNull();
        expect(controller.available.value).toMatchObject({copy: true, cut: true, delete: true});
    });
});

describe("Spec workbench.files-explorer 验收 5：窗口与项目", () => {
    it("另一个窗口有自己的空剪贴板，粘贴不到本窗口的意图", async () => {
        const w = await world();
        select(w.controller, "project://plain/a.md");
        await w.controller.copy();
        const other = worlds.controller(await extraWindow(w.scene, "w2"), EXPANDED);
        await until(w, "另一个窗口列出", () => row(other, "project://plain/sub") !== undefined);
        select(other, "project://plain/sub");
        expect(other.available.value.paste).toBe(false);
        expect(await other.paste()).toEqual({ok: false, reason: "empty-clipboard"});
        expect(writes(w)).toEqual([]);
    });

    it("项目结束：剪贴板清空；对话框里等着的旧意图不再写", async () => {
        const w = await world();
        const {controller} = w;
        select(controller, "project://plain/a.md");
        await controller.copy();
        const pasting = controller.paste();
        await asked(w, "project://plain/a.md");
        await w.scene.projectApp.stop();
        await until(w, "根已停止同步", () => row(controller, "project://")?.kind === "root" && controller.model.roots.value[0]?.status.kind === "ended");
        expect(controller.clipboard.value).toBeNull();
        controller.resolveCollision({kind: "rename", name: "a2.md"}, false);
        await pasting;
        expect(writes(w)).toEqual([]);
        expect(await exists(at(w.scene, "plain/a2.md"))).toBe(false);
    });
});

describe("Spec workbench.files-explorer 拖动：判定与提交", () => {
    it("拖已选的行拖整个选择；落点与最后显示的相同才提交，移入带冻结的令牌", async () => {
        const w = await world();
        const {controller} = w;
        select(controller, "project://plain/a.md", "project://plain/z.md");
        expect(controller.startDrag("project://plain/a.md")).toBe(true);
        expect(controller.drag.value).toEqual({sources: ["project://plain/a.md", "project://plain/z.md"], over: null, action: {kind: "none"}});
        controller.hoverDrag({id: "project://plain/sub", zone: "inside"});
        expect(controller.drag.value?.action).toEqual({kind: "move", target: "project://plain/sub"});
        // 放下时指针下已经是另一行：与显示的不同，不写。
        await controller.dropDrag({id: "project://dest", zone: "inside"});
        expect(controller.drag.value).toBeNull();
        expect(writes(w)).toEqual([]);

        controller.startDrag("project://plain/a.md");
        controller.hoverDrag({id: "project://plain/sub", zone: "inside"});
        await controller.dropDrag({id: "project://plain/sub", zone: "inside"});
        expect(await text(at(w.scene, "plain/sub/a.md"))).toBe("PA");
        expect(await text(at(w.scene, "plain/sub/z.md"))).toBe("Z");
        expect(writes(w).map((request) => [request.method, (request.input as {items: Array<{expected?: string}>}).items.map((item) => item.expected)])).toEqual([["move", [expect.any(String), expect.any(String)]]]);
    });

    it("拖未选的行只拖它；移入时同名走同一个碰撞对话框", async () => {
        const w = await world();
        const {controller} = w;
        select(controller, "project://plain/z.md");
        controller.startDrag("project://plain/a.md");
        expect(controller.drag.value?.sources).toEqual(["project://plain/a.md"]);
        controller.hoverDrag({id: "project://dest", zone: "inside"});
        const dropping = controller.dropDrag({id: "project://dest", zone: "inside"});
        await asked(w, "project://plain/a.md");
        expect(controller.dialog.value).toMatchObject({action: "move", target: "project://dest/a.md"});
        controller.resolveCollision({kind: "rename", name: "a (2).md"}, false);
        await dropping;
        expect(await text(at(w.scene, "dest/a (2).md"))).toBe("PA");
        expect(await text(at(w.scene, "dest/a.md"))).toBe("OLD-A");
    });

    it("内容文件夹里两行之间调整顺序，只改清单", async () => {
        const w = await world();
        const {controller} = w;
        controller.startDrag("project://lore.content/bob");
        controller.hoverDrag({id: "project://lore.content/alice", zone: "before"});
        expect(controller.drag.value?.action).toMatchObject({kind: "reorder", names: ["bob", "alice", "gone"]});
        await controller.dropDrag({id: "project://lore.content/alice", zone: "before"});
        expect([...(await text(at(w.scene, "lore.content/content.xml"))).matchAll(/name="([^"]+)"/gu)].map((match) => match[1])).toEqual(["bob", "alice", "gone"]);
        expect(writes(w).map((request) => request.method)).toEqual(["reorder"]);
    });

    it("拖动中切换显示清单文件、源被删除：拖动取消，放下不写；拖动中源被同字节替换：放下为源已换", async () => {
        const w = await world();
        const {controller} = w;
        controller.startDrag("project://plain/a.md");
        controller.hoverDrag({id: "project://plain/sub", zone: "inside"});
        controller.setShowManifests(true);
        expect(controller.drag.value).toBeNull();
        await controller.dropDrag({id: "project://plain/sub", zone: "inside"});

        // 令牌取到之后才删源：取消要来自源的行不在了，不是令牌没取到。
        const frozen = w.tap.hold((request) => request.method === "identify");
        controller.startDrag("project://plain/z.md");
        controller.hoverDrag({id: "project://plain/sub", zone: "inside"});
        await frozen.arrived;
        frozen.release();
        await rm(at(w.scene, "plain/z.md"));
        await until(w, "源失效，拖动取消", () => controller.drag.value === null);
        await controller.dropDrag({id: "project://plain/sub", zone: "inside"});
        expect(writes(w)).toEqual([]);

        // 服务端算出令牌之后（回复已到、还没交付），在同一路径换成同字节的新文件。
        const identified = w.tap.hold((request) => request.method === "identify");
        controller.startDrag("project://plain/a.md");
        controller.hoverDrag({id: "project://plain/sub", zone: "inside"});
        await identified.arrived;
        await rm(at(w.scene, "plain/a.md"));
        await writeFile(at(w.scene, "plain/a.md"), "PA");
        identified.release();
        await controller.dropDrag({id: "project://plain/sub", zone: "inside"});
        expect(controller.report.value?.items).toEqual([{address: "project://plain/a.md", target: "project://plain/sub/a.md", result: expect.objectContaining({status: "failed", code: "source-changed"})}]);
        expect(await exists(at(w.scene, "plain/sub/a.md"))).toBe(false);
    });
});
