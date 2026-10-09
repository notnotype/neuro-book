/**
 * 编辑器区的控制器（docs/specs/workbench/editor.md 输出 1–10、21–22，场景 2）：组模型、真实 Files 场地上的文档模型、
 * 视图绑定、进度条与关闭询问。进度条的计时用手动时钟（与场地的时钟分开：等事件时推进场地的时钟不会碰到进度条）。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {BATCH_DELAY_MS} from "nbook/plugins/files/backend/changes";
import {files, filesScene} from "nbook/plugins/files/testing/scene";
import type {Scene} from "nbook/plugins/files/testing/scene";
import {createLinkTap} from "nbook/plugins/files/testing/tap";
import type {LinkTap} from "nbook/plugins/files/testing/tap";

import {createEditorArea, defaultEditor} from "./web/area";
import type {EditorArea} from "./web/area";
import {createEditorGroups} from "./web/groups/groups";
import type {GroupsSnapshot} from "./web/groups/groups";

let tmp = "";
let counter = 0;
const closers: Array<() => Promise<void>> = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-editor", "area");
});

afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

interface World {
    readonly scene: Scene;
    readonly tap: LinkTap;
    readonly clock: ManualClock;
    readonly area: EditorArea;
    readonly saved: GroupsSnapshot[];
}

async function world(initial: GroupsSnapshot | null = null): Promise<World> {
    counter += 1;
    const tap = createLinkTap();
    const scene = await filesScene(join(tmp, `case-${String(counter)}`), {project: {"a.md": "A", "b.md": "B", "c.json": "{}"}}, {wrapLink: tap.wrap});
    const clock = new ManualClock();
    const saved: GroupsSnapshot[] = [];
    const area = createEditorArea({files: files(scene.window), clock, workspaceKey: "p1", generation: 1, initial, persist: (snapshot) => saved.push(snapshot), report: (error) => {
        throw error;
    }});
    closers.push(async () => {
        area.dispose();
        await scene.world.close();
        await rm(scene.root, {recursive: true, force: true});
    });
    return {scene, tap, clock, area, saved};
}

async function until(at: World, description: string, check: () => boolean): Promise<void> {
    await waitUntil(description, () => {
        at.scene.world.clock.advance(BATCH_DELAY_MS);
        return check();
    });
}

const groupId = (at: World): string => at.area.groups.activeGroup.value;

async function ready(at: World): Promise<void> {
    await until(at, "活动文档就绪", () => at.area.binding(groupId(at)) !== null);
}

describe("Spec workbench.editor 输出 6–8：打开与切换", () => {
    it("标签当帧切换；读取扣住时 800 ms 前不显示进度条、之后显示；放行后撤掉；迟到的结果不改变活动标签", async () => {
        const at = await world();
        const held = at.tap.hold((request) => request.method === "read");
        expect(at.area.open("project://a.md", {mode: "preview"})).toEqual({ok: true});
        expect(at.area.groups.activeTab()?.address).toBe("project://a.md");
        await held.arrived;
        expect(at.area.binding(groupId(at))).toBeNull();
        // 阈值按合同写死（输出 6），不取产品常量。
        at.clock.advance(799);
        expect(at.area.progress(groupId(at))).toBe(false);
        at.clock.advance(1);
        expect(at.area.progress(groupId(at))).toBe(true);
        // 放行之前改为打开 B：A 的读取迟到也不改变活动标签。
        at.area.open("project://b.md", {mode: "permanent"});
        expect(at.area.progress(groupId(at))).toBe(false);
        held.release();
        await ready(at);
        expect(at.area.groups.activeTab()?.address).toBe("project://b.md");
        expect(at.area.binding(groupId(at))?.document.text.value).toBe("B");
    });

    it("preview 连续替换多于保留上限：换下的视图状态随标签释放，不再进最近列表，切换照常", async () => {
        const at = await world();
        for (let index = 1; index <= 6; index += 1) await writeFile(join(at.scene.project, `p${String(index)}.md`), `P${String(index)}`);
        for (let index = 1; index <= 6; index += 1) {
            at.area.open(`project://p${String(index)}.md`, {mode: "preview"});
            await until(at, `p${String(index)} 就绪`, () => at.area.binding(groupId(at))?.document.text.value === `P${String(index)}`);
        }
        at.area.open("project://a.md", {mode: "permanent"});
        await ready(at);
        expect(at.area.binding(groupId(at))?.document.text.value).toBe("A");
        expect(at.area.groups.groups.value[0]?.tabs.map((tab) => tab.address)).toEqual(["project://p6.md", "project://a.md"]);
    });

    it("读取失败：没有绑定，文档带原因；进度条不显示", async () => {
        const at = await world();
        at.area.open("project://none.md", {mode: "preview"});
        const document = at.area.documentOf(groupId(at));
        await until(at, "失败", () => document?.status.value === "failed");
        expect(at.area.binding(groupId(at))).toBeNull();
        expect(document?.failure.value?.code).toBe("not-found");
        at.clock.advance(800);
        expect(at.area.progress(groupId(at))).toBe(false);
    });

    it("按类型选编辑器；在 preview 标签里编辑即转正；同一文档换回来是同一个视图状态槽", async () => {
        const at = await world();
        expect(defaultEditor("project://a.md")).toBe("markdown");
        expect(defaultEditor("project://c.json")).toBe("code");
        at.area.open("project://a.md", {mode: "preview"});
        await ready(at);
        const binding = at.area.binding(groupId(at));
        if (binding === null) throw new Error("没有绑定");
        binding.slot.state = {caret: 1};
        expect(binding.commit(binding.document.revision.value, "A1")).toMatchObject({status: "accepted"});
        expect(at.area.groups.activeTab()?.preview).toBe(false);
        at.area.open("project://b.md", {mode: "permanent"});
        await ready(at);
        at.area.activate(at.area.groups.groups.value[0]?.tabs[0]?.id ?? "");
        const back = at.area.binding(groupId(at));
        expect(back?.slot.state).toEqual({caret: 1});
        expect(back?.token).not.toBe(binding.token);
        expect(back?.document.text.value).toBe("A1");
        // 换下的旧绑定的迟到回调不改变文档（“时序与寿命”）。
        expect(binding.commit(binding.document.revision.value, "迟到")).toEqual({status: "stale"});
        expect(back?.document.text.value).toBe("A1");
    });

    it("当前视图有未裁决输入时不换文档，给出提示", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        await ready(at);
        at.area.split("right");
        await ready(at);
        const right = at.area.binding(groupId(at));
        const left = at.area.binding(at.area.groups.groups.value[0]?.id ?? "");
        if (right === null || left === null) throw new Error("没有绑定");
        const base = right.document.revision.value;
        left.commit(base, "左");
        expect(right.commit(base, "右")).toMatchObject({status: "conflict"});
        expect(at.area.open("project://b.md", {mode: "preview"})).toMatchObject({ok: false});
        expect(at.area.notice.value).not.toBeNull();
        at.area.resolve(groupId(at), "keep-view");
        expect(right.document.text.value).toBe("右");
        expect(at.area.open("project://b.md", {mode: "preview"})).toEqual({ok: true});
    });
});

describe("Spec workbench.editor 输出 3–5：关闭、拆分与会话", () => {
    it("关闭 dirty 文档的最后一个标签先问：取消不关；保存后关闭并写盘；同一文档还在别的组时不问", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        await ready(at);
        const binding = at.area.binding(groupId(at));
        binding?.commit(binding.document.revision.value, "A（改）");
        const tab = at.area.groups.activeTab()?.id ?? "";
        const cancelled = at.area.close(tab);
        await until(at, "问", () => at.area.dialog.value !== null);
        expect(at.area.dialog.value).toEqual({address: "project://a.md"});
        at.area.answer("cancel");
        expect(await cancelled).toBe("cancelled");
        expect(at.area.groups.activeTab()?.id).toBe(tab);

        at.area.split("right");
        await ready(at);
        expect(await at.area.close(at.area.groups.activeTab()?.id ?? "")).toBe("closed");
        expect(at.area.dialog.value).toBeNull();

        const saving = at.area.close(tab);
        await until(at, "问", () => at.area.dialog.value !== null);
        at.area.answer("save");
        expect(await saving).toBe("closed");
        expect(await readFile(join(at.scene.project, "a.md"), "utf8")).toBe("A（改）");
        expect(at.area.documents.get("project://a.md")).toBeNull();
    });

    it("不保存：丢弃修改关闭，磁盘不变", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        await ready(at);
        const binding = at.area.binding(groupId(at));
        binding?.commit(binding.document.revision.value, "A（丢掉）");
        const closing = at.area.close(at.area.groups.activeTab()?.id ?? "");
        await until(at, "问", () => at.area.dialog.value !== null);
        at.area.answer("discard");
        expect(await closing).toBe("closed");
        expect(await readFile(join(at.scene.project, "a.md"), "utf8")).toBe("A");
        expect(at.area.needsLeaveConfirm()).toBe(false);
    });

    it("会话变化时交出快照；按快照恢复：标签先在，第一次成为活动标签才读文档", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        at.area.open("project://b.md", {mode: "permanent"});
        await ready(at);
        const snapshot = at.saved.at(-1);
        expect(snapshot?.groups[0]?.tabs.map((tab) => tab.address)).toEqual(["project://a.md", "project://b.md"]);

        const restored = await world(snapshot ?? null);
        expect(restored.area.groups.groups.value[0]?.tabs.map((tab) => tab.address)).toEqual(["project://a.md", "project://b.md"]);
        expect(restored.area.documents.get("project://a.md")).toBeNull();
        await until(restored, "活动的 b 就绪", () => restored.area.binding(groupId(restored)) !== null);
        expect(restored.area.documents.get("project://a.md")).toBeNull();
        restored.area.activate(restored.area.groups.groups.value[0]?.tabs[0]?.id ?? "");
        await until(restored, "a 就绪", () => restored.area.binding(groupId(restored))?.document.text.value === "A");
    });
});

describe("Spec workbench.editor 输出 4、13：关闭时的结算", () => {
    it("选“保存”后保存期间又有输入：保存完再问一次，不丢新输入", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        await ready(at);
        const binding = at.area.binding(groupId(at));
        if (binding === null) throw new Error("没有绑定");
        binding.commit(binding.document.revision.value, "A1");
        const held = at.tap.hold((request) => request.method === "write");
        const closing = at.area.close(at.area.groups.activeTab()?.id ?? "");
        await until(at, "问", () => at.area.dialog.value !== null);
        at.area.answer("save");
        await held.arrived;
        binding.commit(binding.document.revision.value, "A2（保存期间）");
        held.release();
        await until(at, "再问", () => at.area.dialog.value !== null);
        expect(await readFile(join(at.scene.project, "a.md"), "utf8")).toBe("A1");
        at.area.answer("save");
        expect(await closing).toBe("closed");
        expect(await readFile(join(at.scene.project, "a.md"), "utf8")).toBe("A2（保存期间）");
    });

    it("关同组里别的标签不动活动视图的绑定，它的未裁决输入仍可裁决", async () => {
        const at = await world();
        at.area.open("project://b.md", {mode: "permanent"});
        at.area.open("project://a.md", {mode: "permanent"});
        await ready(at);
        at.area.split("right");
        await ready(at);
        const right = at.area.binding(groupId(at));
        const leftGroup = at.area.groups.groups.value[0]?.id ?? "";
        const left = at.area.binding(leftGroup);
        if (right === null || left === null) throw new Error("没有绑定");
        const base = left.document.revision.value;
        right.commit(base, "右");
        expect(left.commit(base, "左")).toMatchObject({status: "conflict"});
        const bTab = at.area.groups.groups.value[0]?.tabs.find((tab) => tab.address === "project://b.md")?.id ?? "";
        expect(await at.area.close(bTab)).toBe("closed");
        expect(at.area.binding(leftGroup)?.token).toBe(left.token);
        expect(at.area.binding(leftGroup)?.unresolved()).toBe(true);
        at.area.resolve(leftGroup, "keep-view");
        expect(left.document.text.value).toBe("左");
        expect(await at.area.documents.save(left.document)).toEqual({ok: true});
    });

    it("同一文档还在别的组：关掉有未裁决输入的视图要问；不保存只丢这个视图的输入，文档仍可保存", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        await ready(at);
        at.area.split("right");
        await ready(at);
        const right = at.area.binding(groupId(at));
        const left = at.area.binding(at.area.groups.groups.value[0]?.id ?? "");
        if (right === null || left === null) throw new Error("没有绑定");
        const base = left.document.revision.value;
        left.commit(base, "左");
        expect(right.commit(base, "右")).toMatchObject({status: "conflict"});
        const closing = at.area.close(at.area.groups.activeTab()?.id ?? "");
        await until(at, "问", () => at.area.dialog.value !== null);
        at.area.answer("discard");
        expect(await closing).toBe("closed");
        expect(left.document.unresolved.value).toEqual([]);
        expect(await at.area.documents.save(left.document)).toEqual({ok: true});
        expect(await readFile(join(at.scene.project, "a.md"), "utf8")).toBe("左");
    });

    it("恢复出来、还没读到的标签也算同一文件的标签：关另一组的标签不问，正文留给它", async () => {
        // 用真实的组模型造一份合法记录：左组 a，右组 a、b（活动 b），活动组在左。
        const model = createEditorGroups();
        model.open("project://a.md", {mode: "permanent", editor: "markdown"});
        const leftId = model.activeGroup.value;
        model.split(model.activeTab()?.id ?? "", "right");
        const rightId = model.activeGroup.value;
        model.open("project://b.md", {mode: "permanent", editor: "markdown"});
        model.focusGroup(leftId);
        const at = await world(model.snapshot());
        await ready(at);
        const left = at.area.binding(leftId);
        if (left === null) throw new Error("没有绑定");
        left.commit(left.document.revision.value, "A（未保存）");
        expect(await at.area.close(at.area.groups.activeTab()?.id ?? "")).toBe("closed");
        expect(at.area.dialog.value).toBeNull();
        const aTab = at.area.groups.groups.value.find((group) => group.id === rightId)?.tabs[0]?.id ?? "";
        at.area.activate(aTab);
        await until(at, "右组的 a 就绪", () => at.area.binding(rightId)?.document.text.value === "A（未保存）");
    });
});

describe("Spec workbench.editor 输出 21–22：离开与抢救", () => {
    it("离开前结算视图里还没交出的输入；有 dirty 时需要确认；抢救列出 dirty 正文", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        await ready(at);
        const binding = at.area.binding(groupId(at));
        if (binding === null) throw new Error("没有绑定");
        expect(at.area.needsLeaveConfirm()).toBe(false);
        const detach = binding.attach(() => {
            binding.commit(binding.document.revision.value, "A（防抖中）");
        });
        expect(at.area.needsLeaveConfirm()).toBe(true);
        expect(at.area.documents.rescue()).toEqual([{path: "project://a.md", text: "A（防抖中）"}]);
        detach();
    });
});
