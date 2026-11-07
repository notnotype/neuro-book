/**
 * 编辑器区的控制器（docs/specs/workbench/editor.md 输出 1–10、21–22，场景 2）：组模型、真实 Files 场地上的文档模型、
 * 视图绑定、进度条与关闭询问。进度条的计时用手动时钟（与场地的时钟分开：等事件时推进场地的时钟不会碰到进度条）。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {shallowRef} from "@vue/reactivity";

import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {BATCH_DELAY_MS} from "nbook/plugins/files/backend/changes";
import {files, filesScene} from "nbook/plugins/files/testing/scene";
import type {Scene} from "nbook/plugins/files/testing/scene";
import {createLinkTap} from "nbook/plugins/files/testing/tap";
import type {LinkTap} from "nbook/plugins/files/testing/tap";

import {CODE_EDITOR, MARKDOWN_EDITOR} from "./shared/contracts";
import {editorText} from "./shared/text";
import {editorTestText, reasonText} from "./testing/text";
import {createEditorArea} from "./web/area";
import {BINARY_TAB_EDITOR, completedBuiltinEditors, catalogOf} from "./web/editors";
import type {EditorCatalog} from "./web/editors";
import type {EditorArea, EditorControlHandle, TextEditorBinding} from "./web/area";
import {createEditorGroups} from "./web/groups/groups";
import {createEditorTabDrag} from "./web/tab-drag";
import {nameOf} from "./web/documents/address";
import {createMemoryEditorPanels} from "nbook/plugins/workbench/shared/editor-panels";
import type {MemoryEditorPanels} from "nbook/plugins/workbench/shared/editor-panels";
import {editorStateValues} from "./web/state";
import type {SavedTab, TabsSnapshot} from "./web/groups/groups";

/** 组的文本绑定（这些用例里的标签都是文本编辑器）；字节绑定或没有绑定为 null。 */
const textBinding = (area: Pick<EditorArea, "binding">, groupId: string): TextEditorBinding | null => {
    const binding = area.binding(groupId);
    return binding?.kind === "text" ? binding : null;
};

/** 组顶部提示按某种语言显示的整句；没有提示为 null。 */
const noticeText = (area: Pick<EditorArea, "notice">, locale: "zh-CN" | "en-US" = "zh-CN"): string | null => {
    const notice = area.notice.value;
    return notice === null ? null : editorTestText(locale).t(notice);
};

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
    readonly saved: TabsSnapshot[];
    readonly panels: MemoryEditorPanels;
    /** `opened` 交出的地址（最近打开）。 */
    readonly opened: string[];
}

async function world(initial: TabsSnapshot | null = null, editors?: EditorCatalog, panels: MemoryEditorPanels = createMemoryEditorPanels(), mountedControlsPerEditor?: number): Promise<World> {
    counter += 1;
    const tap = createLinkTap();
    const scene = await filesScene(join(tmp, `case-${String(counter)}`), {project: {"a.md": "A", "b.md": "B", "c.json": "{}", "a.html": "<p>A</p>", "a.pdf": "%PDF-1.7", "img/a.png": "PNG"}}, {wrapLink: tap.wrap});
    const clock = new ManualClock();
    const saved: TabsSnapshot[] = [];
    const opened: string[] = [];
    const area = createEditorArea({files: files(scene.window), clock, workspaceKey: "p1", generation: 1, panels, initial, persist: (snapshot) => saved.push(snapshot), opened: (address) => opened.push(address), report: (error) => {
        throw error;
    }, ...(editors === undefined ? {} : {editors}), ...(mountedControlsPerEditor === undefined ? {} : {mountedControlsPerEditor})});
    closers.push(async () => {
        area.dispose();
        await scene.world.close();
        await rm(scene.root, {recursive: true, force: true});
    });
    return {scene, tap, clock, area, saved, panels, opened};
}

/** 窗口重开：布局文档与标签记录都从存下的读回来。缺省记录是最后存下的那份。 */
const reopen = (at: World, editors?: EditorCatalog, snapshot: TabsSnapshot | null = at.saved.at(-1) ?? null): Promise<World> => world(snapshot, editors, createMemoryEditorPanels(at.panels.document()));
const fileTabs = (snapshot: TabsSnapshot | undefined | null): Array<Exclude<SavedTab, {page: true}>> => Object.values(snapshot?.tabs ?? {}).flatMap((tab) => ("page" in tab ? [] : [tab]));

async function until(at: World, description: string, check: () => boolean): Promise<void> {
    await waitUntil(description, () => {
        at.scene.world.clock.advance(BATCH_DELAY_MS);
        return check();
    });
}

const groupId = (at: World): string => at.area.groups.activeGroup.value;
const activeTabId = (at: World): string => {
    const tab = at.area.groups.activeTab();
    if (tab === null) throw new Error("没有活动标签");
    return tab.id;
};

async function ready(at: World): Promise<void> {
    await until(at, "活动文档就绪", () => textBinding(at.area, groupId(at)) !== null);
}

describe("Spec workbench.editor 输出 6–8：打开与切换", () => {
    it("标签当帧切换；读取扣住时 800 ms 前不显示进度条、之后显示；放行后撤掉；迟到的结果不改变活动标签", async () => {
        const at = await world();
        const held = at.tap.hold((request) => request.method === "read");
        expect(at.area.open("project://a.md", {mode: "preview"})).toMatchObject({ok: true});
        expect(at.area.groups.activeTab()?.address).toBe("project://a.md");
        await held.arrived;
        expect(textBinding(at.area, groupId(at))).toBeNull();
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
        expect(textBinding(at.area, groupId(at))?.text.value).toBe("B");
    });

    it("preview 连续替换：换下的标签连同视图状态与实例一起释放，切换照常", async () => {
        const at = await world();
        for (let index = 1; index <= 6; index += 1) await writeFile(join(at.scene.project, `p${String(index)}.md`), `P${String(index)}`);
        const released: string[] = [];
        for (let index = 1; index <= 6; index += 1) {
            at.area.open(`project://p${String(index)}.md`, {mode: "preview"});
            const bound = await until(at, `p${String(index)} 就绪`, () => textBinding(at.area, groupId(at))?.text.value === `P${String(index)}`).then(() => textBinding(at.area, groupId(at)));
            if (bound === null) throw new Error("没有绑定");
            bound.slot.dispose = () => released.push(`视图 p${String(index)}`);
            at.area.tabControlSlot(bound.tabId, bound.editor).dispose = () => released.push(`实例 p${String(index)}`);
        }
        expect(released).toEqual([1, 2, 3, 4, 5].flatMap((index) => [`视图 p${String(index)}`, `实例 p${String(index)}`]));
        at.area.open("project://a.md", {mode: "permanent"});
        await ready(at);
        expect(textBinding(at.area, groupId(at))?.text.value).toBe("A");
        expect(at.area.groups.groups.value[0]?.tabs.map((tab) => tab.address)).toEqual(["project://p6.md", "project://a.md"]);
    });

    it("读取失败：没有绑定，文档带原因；进度条不显示", async () => {
        const at = await world();
        at.area.open("project://none.md", {mode: "preview"});
        const document = at.area.documentOf(groupId(at));
        await until(at, "失败", () => document?.status.value === "failed");
        expect(textBinding(at.area, groupId(at))).toBeNull();
        expect(document?.failure.value?.code).toBe("not-found");
        at.clock.advance(800);
        expect(at.area.progress(groupId(at))).toBe(false);
    });

    it("按类型选编辑器；在 preview 标签里编辑即转正；切走再切回是同一个绑定与视图状态", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "preview"});
        await ready(at);
        const binding = textBinding(at.area, groupId(at));
        if (binding === null) throw new Error("没有绑定");
        binding.slot.state = {caret: 1};
        expect(binding.commit(binding.revision.value, "A1")).toMatchObject({status: "accepted"});
        expect(at.area.groups.activeTab()?.preview).toBe(false);
        at.area.open("project://b.md", {mode: "permanent"});
        await ready(at);
        at.area.activate(at.area.groups.groups.value[0]?.tabs[0]?.id ?? "");
        const back = textBinding(at.area, groupId(at));
        expect(back).toBe(binding);
        expect(back?.slot.state).toEqual({caret: 1});
        expect(back?.text.value).toBe("A1");
    });

    it("当前视图有未裁决输入时不换文档，给出提示", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        await ready(at);
        at.area.split("right");
        await ready(at);
        const right = textBinding(at.area, groupId(at));
        const left = textBinding(at.area, at.area.groups.groups.value[0]?.id ?? "");
        if (right === null || left === null) throw new Error("没有绑定");
        const base = right.revision.value;
        left.commit(base, "左");
        expect(right.commit(base, "右")).toMatchObject({status: "conflict"});
        expect(at.area.open("project://b.md", {mode: "preview"})).toMatchObject({ok: false});
        expect(at.area.notice.value).not.toBeNull();
        at.area.resolve(groupId(at), "keep-view");
        expect(right.text.value).toBe("右");
        expect(at.area.open("project://b.md", {mode: "preview"})).toMatchObject({ok: true});
    });

    it("当前视图写不出时不换文档、不换编辑器（输出 61）：理由说是写不回；别的视图的输入被接受不解除它；采用当前正文后可以换", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        await ready(at);
        at.area.split("right");
        await ready(at);
        const right = textBinding(at.area, groupId(at));
        const left = textBinding(at.area, at.area.groups.groups.value[0]?.id ?? "");
        if (right === null || left === null) throw new Error("没有绑定");
        right.block({reason: "段首的 HTML", from: 1, to: 4, index: 1, excerpt: "A", fallback: "A"});
        expect(right.blocked()).toBe(true);
        const opened = at.area.open("project://b.md", {mode: "preview"});
        expect(opened).toMatchObject({ok: false});
        expect(reasonText(opened)).toBe("当前视图有一块写不回 Markdown");
        expect(reasonText(opened, "en-US")).toBe("A block in the current view cannot be written back as Markdown");
        expect(noticeText(at.area)).toBe("这个视图有一块写不回 Markdown：先在组顶部定位并修改它，或采用当前正文");
        expect(noticeText(at.area, "en-US")).toBe("A block in this view cannot be written back as Markdown: first use Show Block at the top of the group and change it, or choose Use Current Text");
        const reopened = at.area.reopenWith(CODE_EDITOR);
        expect(reopened).toMatchObject({ok: false});
        expect(reasonText(reopened)).toBe("当前视图有一块写不回 Markdown");
        left.commit(left.revision.value, "左");
        expect(right.blocked()).toBe(true);
        const saved = await at.area.save();
        expect(saved).toMatchObject({ok: false});
        expect(reasonText(saved)).toBe("有视图写不回 Markdown，没有保存：先在组顶部定位并修改，或采用当前正文");
        expect(reasonText(saved, "en-US")).toBe("A view cannot be written back as Markdown, so nothing was saved: first use Show Block at the top of the group and change it, or choose Use Current Text");
        at.area.unblock(groupId(at));
        expect(right.blocked()).toBe(false);
        expect(at.area.open("project://b.md", {mode: "preview"})).toMatchObject({ok: true});
    });
});

/** 内置两个编辑器加一个 HTML 预览编辑器与一个只认 png 的字节编辑器。 */
const WITH_PREVIEW = catalogOf([
    ...completedBuiltinEditors(),
    {id: "test.html.preview", declaration: {title: {"zh-CN": "预览", "en-US": "Preview"}, selector: {extensions: ["html"]}, priority: "option", input: "text", role: "preview"}},
    {id: "test.image.viewer", declaration: {title: {"zh-CN": "图片", "en-US": "Image"}, selector: {extensions: ["png"]}, priority: "default", input: "bytes"}},
]);

describe("Spec workbench.editor 输出 1、4、37–40：编辑器的选择与同一文件的几个标签", () => {
    it("不指定编辑器的打开激活本组非预览的那个标签；指定时按编辑器找；未登记的编辑器与不认领的字节编辑器被拒", async () => {
        const at = await world(null, WITH_PREVIEW);
        expect(at.area.open("project://a.html", {mode: "permanent"})).toMatchObject({ok: true});
        const source = at.area.groups.activeTab()!;
        expect(source).toMatchObject({kind: "file", editor: CODE_EDITOR});
        const preview = at.area.open("project://a.html", {mode: "permanent", editor: "test.html.preview"});
        expect(preview).toMatchObject({ok: true});
        expect(at.area.groups.groups.value[0]?.tabs).toHaveLength(2);
        expect(at.area.open("project://a.html", {mode: "preview"})).toEqual({ok: true, tabId: source.id});
        expect(at.area.open("project://a.html", {mode: "permanent", editor: "test.html.preview"})).toEqual(preview);
        expect(at.area.open("project://a.md", {mode: "permanent", editor: "test.nope.editor"})).toMatchObject({ok: false});
        expect(at.area.open("project://a.md", {mode: "permanent", editor: "test.image.viewer"})).toMatchObject({ok: false});
        expect(at.area.groups.groups.value[0]?.tabs).toHaveLength(2);
    });

    it("关掉 dirty 的源码标签、只剩它的预览视图时选“不保存”：修改丢掉，预览回到磁盘上的内容，之后的全部保存不写它", async () => {
        const at = await world(null, WITH_PREVIEW);
        at.area.open("project://a.html", {mode: "permanent"});
        await ready(at);
        const source = at.area.groups.activeTab()!;
        const binding = textBinding(at.area, groupId(at))!;
        binding.commit(binding.revision.value, "<p>改</p>");
        at.area.open("project://a.html", {mode: "permanent", editor: "test.html.preview"});
        const closing = at.area.close(source.id);
        await until(at, "问", () => at.area.dialog.value !== null);
        at.area.answer("discard");
        expect(await closing).toBe("closed");
        const preview = textBinding(at.area, groupId(at))!;
        expect([preview.text.value, at.area.documentOf(groupId(at))?.dirty.value]).toEqual(["<p>A</p>", false]);
        expect(await at.area.saveAll()).toEqual({ok: true});
        expect(await readFile(join(at.scene.project, "a.html"), "utf8")).toBe("<p>A</p>");
    });

    it("关掉 dirty 的源码标签、只剩它的预览视图时照常询问；还有另一个可编辑的标签时不问", async () => {
        const at = await world(null, WITH_PREVIEW);
        at.area.open("project://a.html", {mode: "permanent"});
        await ready(at);
        const source = at.area.groups.activeTab()!;
        const binding = textBinding(at.area, groupId(at))!;
        binding.commit(binding.revision.value, "<p>改</p>");
        at.area.open("project://a.html", {mode: "permanent", editor: "test.html.preview"});
        const closing = at.area.close(source.id);
        await until(at, "问", () => at.area.dialog.value !== null);
        at.area.answer("cancel");
        expect(await closing).toBe("cancelled");
        // 拆出另一个源码标签：它能编辑这份文档，关掉原来的就不问。
        at.area.activate(source.id);
        expect(at.area.split("right")).toMatchObject({ok: true});
        expect(await at.area.close(source.id)).toBe("closed");
        expect(at.area.dialog.value).toBeNull();
    });

    it("已知二进制：标签显示不能在这里打开，不读文件；用其它编辑器可以换成源码编辑器", async () => {
        const at = await world(null, WITH_PREVIEW);
        expect(at.area.open("project://a.pdf", {mode: "permanent"})).toMatchObject({ok: true});
        expect(at.area.groups.activeTab()).toMatchObject({editor: BINARY_TAB_EDITOR});
        expect(at.area.documentOf(groupId(at))).toBeNull();
        expect(at.area.documents.get("project://a.pdf")).toBeNull();
        expect(at.area.reopenWith(CODE_EDITOR)).toEqual({ok: true});
        await until(at, "源码读到", () => textBinding(at.area, groupId(at))?.text.value === "%PDF-1.7");
    });

    it("编辑器不在了的标签：用默认编辑器打开按选择顺序重选", async () => {
        const panels = createMemoryEditorPanels();
        const recorded = createEditorGroups(panels);
        recorded.open("project://a.md", {mode: "permanent", editor: "test.gone.editor"});
        const at = await world(recorded.snapshot(), WITH_PREVIEW, panels);
        expect(at.area.groups.activeTab()).toMatchObject({editor: "test.gone.editor"});
        expect(at.area.reopenWith("test.gone.editor")).toMatchObject({ok: false});
        expect(at.area.reopenWithDefault()).toEqual({ok: true});
        expect(at.area.groups.activeTab()).toMatchObject({editor: MARKDOWN_EDITOR});
    });
});

describe("Spec workbench.editor 输出 41、48：字节标签与视图能否输入", () => {
    it("图片标签：字节绑定、不读正文；有句柄时是活动的编辑器，没有文档与字数、不可输入；关闭、拆分、换成源码照常", async () => {
        const at = await world(null, WITH_PREVIEW);
        expect(at.area.open("project://img/a.png", {mode: "permanent"})).toMatchObject({ok: true});
        const binding = at.area.binding(groupId(at));
        expect(binding).toMatchObject({kind: "bytes", editor: "test.image.viewer"});
        expect(binding?.kind === "bytes" ? binding.address.value : null).toBe("project://img/a.png");
        expect(at.area.documentOf(groupId(at))).toBeNull();
        expect(at.area.fileOf(groupId(at))?.status.value).toBe("ready");
        expect(at.area.openDocuments.value).toEqual([]);
        at.area.registerTabHandle(activeTabId(at), "test.image.viewer", {focus: () => undefined, flushPendingChange: () => undefined});
        const state = editorStateValues(shallowRef(at.area));
        expect([state.active.value, state.hasDocument.value, state.writable.value, state.activeEditor.value]).toEqual([true, false, false, "test.image.viewer"]);
        expect(at.area.split("right")).toMatchObject({ok: true});
        expect(at.area.groups.activeTab()).toMatchObject({editor: "test.image.viewer"});
        expect(await at.area.close(at.area.groups.activeTab()!.id)).toBe("closed");
        expect(at.area.reopenWith(CODE_EDITOR)).toEqual({ok: true});
        await until(at, "换成源码后读到正文", () => textBinding(at.area, groupId(at))?.text.value === "PNG");
    });

    it("源码标签有未保存的修改、又是最后一个能编辑的标签：不能换成按字节显示的编辑器；保存后可以", async () => {
        const at = await world(null, WITH_PREVIEW);
        at.area.open("project://img/a.png", {mode: "permanent", editor: CODE_EDITOR});
        await ready(at);
        const binding = textBinding(at.area, groupId(at))!;
        binding.commit(binding.revision.value, "PNG（改）");
        expect(at.area.reopenWith("test.image.viewer")).toMatchObject({ok: false});
        expect(at.area.groups.activeTab()).toMatchObject({editor: CODE_EDITOR});
        expect(await at.area.save()).toEqual({ok: true});
        expect(at.area.reopenWith("test.image.viewer")).toEqual({ok: true});
        expect(at.area.binding(groupId(at))).toMatchObject({kind: "bytes"});
    });

    it("另一组里恢复出来、还没读到的源码标签算作能编辑的标签：换成字节编辑器时它接过正文，未保存的修改不丢", async () => {
        const at = await world(null, WITH_PREVIEW);
        at.area.open("project://img/a.png", {mode: "permanent", editor: CODE_EDITOR});
        await ready(at);
        const first = groupId(at);
        expect(at.area.split("right")).toMatchObject({ok: true});
        at.area.open("project://b.md", {mode: "permanent"});
        at.area.groups.focusGroup(first);
        // 恢复后右侧组的 a.png 不是活动标签：它还没有文档引用。
        const restored = await reopen(at, WITH_PREVIEW);
        await ready(restored);
        const binding = textBinding(restored.area, groupId(restored))!;
        expect(binding.address.value).toBe("project://img/a.png");
        binding.commit(binding.revision.value, "PNG（改）");
        expect(restored.area.reopenWith("test.image.viewer")).toEqual({ok: true});
        const png = restored.area.openDocuments.value.find((document) => document.target.value.path === "project://img/a.png");
        expect([png?.text.value, png?.dirty.value]).toEqual(["PNG（改）", true]);
    });

    it("资源管理器删除图片：标签关闭；改名：标签跟到新地址", async () => {
        const at = await world(null, WITH_PREVIEW);
        at.area.open("project://img/a.png", {mode: "permanent"});
        expect(at.area.binding(groupId(at))).toMatchObject({kind: "bytes"});
        const lease = await at.area.documents.coordinator.begin(["project://img"]);
        if (!lease.ok) throw new Error("没有租约");
        lease.lease.end({kind: "done", moved: [{from: "project://img", to: "project://pics"}]});
        expect(at.area.groups.activeTab()).toMatchObject({address: "project://pics/a.png"});
        at.area.documents.coordinator.close(["project://pics"]);
        expect(at.area.groups.groups.value.flatMap((group) => group.tabs)).toEqual([]);
    });

    it("预览视图不可输入：同一份文档在源码标签可写、在预览视图不可写", async () => {
        const at = await world(null, WITH_PREVIEW);
        at.area.open("project://a.html", {mode: "permanent"});
        await ready(at);
        expect(at.area.viewWritable(groupId(at))).toBe(true);
        at.area.open("project://a.html", {mode: "permanent", editor: "test.html.preview"});
        await ready(at);
        expect(at.area.documentOf(groupId(at))?.writable.value).toBe(true);
        expect(at.area.viewWritable(groupId(at))).toBe(false);
    });
});

describe("Spec workbench.editor 输出 35：打开到指定的组", () => {
    it("只结算活动标签要换的那一组：活动组有未裁决输入时仍能打开到别的组；侧边的组有未裁决输入时“侧边”被拦；组已关闭为不可用", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        await ready(at);
        at.area.split("right");
        await ready(at);
        const leftGroup = at.area.groups.groups.value[0]?.id ?? "";
        const rightGroup = groupId(at);
        const right = textBinding(at.area, rightGroup);
        const left = textBinding(at.area, leftGroup);
        if (right === null || left === null) throw new Error("没有绑定");
        const base = right.revision.value;
        left.commit(base, "左");
        expect(right.commit(base, "右")).toMatchObject({status: "conflict"});

        // 活动的是右组（有未裁决输入）：打开到左组不碰右组，照样打开，左组成为活动组。
        expect(at.area.open("project://b.md", {mode: "permanent", group: leftGroup})).toMatchObject({ok: true});
        expect(at.area.groups.activeGroup.value).toBe(leftGroup);
        // 从左组“侧边”打开：目标是有未裁决输入的右组，拦下，不新建组。
        expect(at.area.open("project://c.md", {mode: "permanent", group: "side"})).toMatchObject({ok: false});
        expect(at.area.groups.groups.value).toHaveLength(2);
        at.area.resolve(rightGroup, "keep-view");
        expect(at.area.open("project://c.md", {mode: "permanent", group: "side"})).toMatchObject({ok: true});
        expect(at.area.groups.activeGroup.value).toBe(rightGroup);
        const opened = at.area.open("project://a.md", {mode: "permanent", group: "g-gone"});
        expect(opened).toMatchObject({ok: false});
        expect(reasonText(opened)).toBe("编辑组已关闭");
        expect(reasonText(opened, "en-US")).toBe("The editor group is closed");
    });
});

describe("Spec workbench.editor 输出 3–5：关闭、拆分与会话", () => {
    it("关闭 dirty 文档的最后一个标签先问：取消不关；保存后关闭并写盘；同一文档还在别的组时不问", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        await ready(at);
        const binding = textBinding(at.area, groupId(at));
        binding?.commit(binding.revision.value, "A（改）");
        const tab = at.area.groups.activeTab()?.id ?? "";
        const cancelled = at.area.close(tab);
        await until(at, "问", () => at.area.dialog.value !== null);
        expect(at.area.dialog.value).toEqual({address: "project://a.md", saveable: true});
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

    it("dirty 文档只剩一个 preview 标签（关正式标签时因为它而没问）：本组再单击打开别的文件时它转正、不被换掉，修改还在", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "preview"});
        await ready(at);
        expect(at.area.split("right")).toMatchObject({ok: true});
        await ready(at);
        const binding = textBinding(at.area, groupId(at));
        binding?.commit(binding.revision.value, "A（改）");
        expect(await at.area.close(at.area.groups.activeTab()?.id ?? "")).toBe("closed");
        expect(at.area.dialog.value).toBeNull();

        at.area.open("project://b.md", {mode: "preview"});
        const tabs = at.area.groups.groups.value.flatMap((group) => group.tabs);
        expect(tabs.map((tab) => [tab.kind === "file" ? tab.address : null, tab.preview])).toEqual([["project://a.md", false], ["project://b.md", true]]);
        expect(at.area.documents.get("project://a.md")?.dirty.value).toBe(true);
        expect(at.area.needsLeaveConfirm()).toBe(true);
    });

    it("不保存：丢弃修改关闭，磁盘不变", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        await ready(at);
        const binding = textBinding(at.area, groupId(at));
        binding?.commit(binding.revision.value, "A（丢掉）");
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
        expect(fileTabs(snapshot).map((tab) => tab.address)).toEqual(["project://a.md", "project://b.md"]);

        const restored = await reopen(at);
        expect(restored.area.groups.groups.value[0]?.tabs.map((tab) => tab.address)).toEqual(["project://a.md", "project://b.md"]);
        expect(restored.area.documents.get("project://a.md")).toBeNull();
        await until(restored, "活动的 b 就绪", () => textBinding(restored.area, groupId(restored)) !== null);
        expect(restored.area.documents.get("project://a.md")).toBeNull();
        restored.area.activate(restored.area.groups.groups.value[0]?.tabs[0]?.id ?? "");
        await until(restored, "a 就绪", () => textBinding(restored.area, groupId(restored))?.text.value === "A");
    });
});

describe("Spec workbench.editor 输出 30–31：上次的光标与最近打开", () => {
    const tabsOf = fileTabs;

    it("控件交出的光标记到标签上、随快照保存；写法与编辑器对不上、与记下的相同都不写；换下之后迟到的照记", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        await ready(at);
        const a = textBinding(at.area, groupId(at))!;
        expect(a.cursor).toBeNull();
        a.remember({offset: 5});
        expect(tabsOf(at.saved.at(-1))[0]?.cursor).toEqual({offset: 5});
        const count = at.saved.length;
        a.remember({offset: 5});
        a.remember({line: 2, column: 3});
        expect(at.saved.length).toBe(count);

        // 换到 b 之后 a 的控件才交出离开时的光标：仍记到 a 的标签上。
        at.area.open("project://b.md", {mode: "permanent"});
        a.remember({offset: 7});
        expect(tabsOf(at.saved.at(-1)).map((tab) => tab.cursor)).toEqual([{offset: 7}, undefined]);
    });

    it("按快照恢复后，第一次绑定带着记下的光标；拆分出的标签带过去的是拆分这一刻的光标（先让控件交出）；换编辑器丢掉", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        await ready(at);
        textBinding(at.area, groupId(at))!.remember({offset: 1});

        const restored = await reopen(at);
        await ready(restored);
        const binding = textBinding(restored.area, groupId(restored))!;
        expect(binding.cursor).toEqual({offset: 1});
        // 光标已移到 4，控件还没到“停下 1 秒”交出：拆分时先让活动控件交出这一刻的光标。
        restored.area.registerTabHandle(activeTabId(restored), MARKDOWN_EDITOR, {focus: () => undefined, flushPendingChange: () => undefined, rememberCursor: () => binding.remember({offset: 4})});
        expect(restored.area.split("right")).toMatchObject({ok: true});
        expect(tabsOf(restored.saved.at(-1)).map((tab) => tab.cursor)).toEqual([{offset: 4}, {offset: 4}]);
        expect(restored.area.reopenWith(CODE_EDITOR)).toMatchObject({ok: true});
        expect(tabsOf(restored.saved.at(-1)).map((tab) => tab.cursor)).toEqual([{offset: 4}, undefined]);
    });

    it("语言记在标签上（输出 45）：换语言不换绑定；随快照保存与恢复；拆分带过去；换编辑器丢掉", async () => {
        const at = await world();
        at.area.open("project://c.json", {mode: "permanent"});
        await ready(at);
        const binding = textBinding(at.area, groupId(at))!;
        expect(binding.language.value).toBeNull();
        at.area.groups.setLanguage(binding.tabId, "plaintext");
        expect(textBinding(at.area, groupId(at))).toBe(binding);
        expect(binding.language.value).toBe("plaintext");
        expect(tabsOf(at.saved.at(-1)).map((tab) => tab.language)).toEqual(["plaintext"]);

        const restored = await reopen(at);
        await ready(restored);
        expect(textBinding(restored.area, groupId(restored))!.language.value).toBe("plaintext");
        expect(restored.area.split("right")).toMatchObject({ok: true});
        expect(tabsOf(restored.saved.at(-1)).map((tab) => tab.language)).toEqual(["plaintext", "plaintext"]);
        expect(restored.area.reopenWith(MARKDOWN_EDITOR)).toMatchObject({ok: true});
        expect(tabsOf(restored.saved.at(-1)).map((tab) => tab.language)).toEqual(["plaintext", undefined]);
    });

    it("恢复的会话：活动标签就绪、控件交出句柄后聚焦一次，不定位到末尾；就绪前、或就绪后定位执行前焦点离开编辑器区就不聚焦；读取失败不另提示", async () => {
        const seed = await world();
        seed.area.open("project://a.md", {mode: "permanent"});
        await ready(seed);
        const snapshot = seed.saved.at(-1) ?? null;
        const handle = (calls: string[]): EditorControlHandle => ({focus: () => void calls.push("focus"), flushPendingChange: () => undefined, revealEnd: () => void calls.push("revealEnd")});

        const restored = await reopen(seed);
        const calls: string[] = [];
        restored.area.registerTabHandle(activeTabId(restored), MARKDOWN_EDITOR, handle(calls));
        await ready(restored);
        restored.clock.advance(0);
        expect(calls).toEqual(["focus"]);
        restored.area.registerTabHandle(activeTabId(restored), MARKDOWN_EDITOR, handle(calls));
        restored.clock.advance(0);
        expect(calls).toEqual(["focus"]);

        const left = await reopen(seed);
        const leftCalls: string[] = [];
        left.area.focusLeft();
        left.area.registerTabHandle(activeTabId(left), MARKDOWN_EDITOR, handle(leftCalls));
        await ready(left);
        left.clock.advance(0);
        expect(leftCalls).toEqual([]);

        // 就绪、定位已排进时钟，执行前焦点离开：不再聚焦。
        const late = await reopen(seed);
        const lateCalls: string[] = [];
        late.area.registerTabHandle(activeTabId(late), MARKDOWN_EDITOR, handle(lateCalls));
        await ready(late);
        late.area.focusLeft();
        late.clock.advance(0);
        expect(lateCalls).toEqual([]);

        const gone = await reopen(seed, undefined, {tabs: Object.fromEntries(Object.entries(snapshot!.tabs).map(([id, tab]) => [id, {...tab, address: "project://missing.md"}])) as TabsSnapshot["tabs"]});
        await until(gone, "读取失败", () => gone.area.documentOf(groupId(gone))?.status.value === "failed");
        gone.clock.advance(0);
        expect(gone.area.notice.value).toBeNull();
    });

    it("打开时交出地址（最近打开），preview 与 permanent 都算；切换已打开的标签与恢复出来的标签不算", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "preview"});
        at.area.open("project://b.md", {mode: "permanent"});
        await ready(at);
        at.area.activate(at.area.groups.groups.value[0]!.tabs[0]!.id);
        expect(at.opened).toEqual(["project://a.md", "project://b.md"]);

        const restored = await reopen(at);
        await ready(restored);
        expect(restored.opened).toEqual([]);
    });
});

describe("Spec workbench.editor 输出 33：页面标签", () => {
    it("打开页面：活动组开一个正式标签，没有文档与绑定；再开同一页面切到已开的那个（在别的组也一样）；页面不拆分、不换编辑器，可以关闭；资源打开不接受页面地址", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        await ready(at);
        const opened = at.area.openPage("nbook.test.welcome");
        expect(opened).toMatchObject({ok: true});
        const tab = at.area.groups.activeTab()!;
        expect([tab.address, tab.kind, tab.preview]).toEqual(["page://nbook.test.welcome", "page", false]);
        expect(textBinding(at.area, groupId(at))).toBeNull();
        expect(at.area.documentOf(groupId(at))).toBeNull();
        expect(at.area.activeDocument.value).toBeNull();
        // 公开键 activeDocument 只给文件的地址：页面不是资源管理器能揭示的东西。
        expect(editorStateValues(shallowRef(at.area)).activeDocument.value).toBe("");
        const split = at.area.split("right");
        expect(split).toMatchObject({ok: false});
        expect(reasonText(split)).toBe("页面只开一个，不能拆分");
        expect(reasonText(split, "en-US")).toBe("A page opens only once and cannot be split");
        const reopened = at.area.reopenWith(CODE_EDITOR);
        expect(reopened).toMatchObject({ok: false});
        expect(reasonText(reopened)).toBe("页面不是文件，不能换编辑器");
        expect(reasonText(reopened, "en-US")).toBe("A page is not a file, so its editor cannot be changed");
        expect(at.area.open("page://nbook.test.welcome", {mode: "permanent"})).toMatchObject({ok: false});
        expect(at.opened).toEqual(["project://a.md"]);
        expect(fileTabs(at.saved.at(-1)).map((saved) => saved.address)).toEqual(["project://a.md"]);

        // 切到 a，拆分出新组，再从新组打开同一页面：回到原来的组里的那一个。
        at.area.activate(at.area.groups.groups.value[0]!.tabs[0]!.id);
        expect(at.area.split("right")).toMatchObject({ok: true});
        const first = at.area.groups.groups.value[0]!.id;
        expect(at.area.openPage("nbook.test.welcome")).toEqual({ok: true, tabId: tab.id});
        expect(at.area.groups.activeGroup.value).toBe(first);
        expect(at.area.groups.activeTab()?.id).toBe(tab.id);
        expect(await at.area.close(tab.id)).toBe("closed");
        expect(at.area.groups.groups.value.flatMap((group) => group.tabs).some((candidate) => candidate.kind === "page")).toBe(false);
    });
});

describe("Spec workbench.editor 输出 4、13：关闭时的结算", () => {
    it("选“保存”后保存期间又有输入：保存完再问一次，不丢新输入", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        await ready(at);
        const binding = textBinding(at.area, groupId(at));
        if (binding === null) throw new Error("没有绑定");
        binding.commit(binding.revision.value, "A1");
        const held = at.tap.hold((request) => request.method === "write");
        const closing = at.area.close(at.area.groups.activeTab()?.id ?? "");
        await until(at, "问", () => at.area.dialog.value !== null);
        at.area.answer("save");
        await held.arrived;
        binding.commit(binding.revision.value, "A2（保存期间）");
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
        const right = textBinding(at.area, groupId(at));
        const leftGroup = at.area.groups.groups.value[0]?.id ?? "";
        const left = textBinding(at.area, leftGroup);
        if (right === null || left === null) throw new Error("没有绑定");
        const base = left.revision.value;
        right.commit(base, "右");
        expect(left.commit(base, "左")).toMatchObject({status: "conflict"});
        const bTab = at.area.groups.groups.value[0]?.tabs.find((tab) => tab.address === "project://b.md")?.id ?? "";
        expect(await at.area.close(bTab)).toBe("closed");
        expect(textBinding(at.area, leftGroup)?.token).toBe(left.token);
        expect(textBinding(at.area, leftGroup)?.unresolved()).toBe(true);
        at.area.resolve(leftGroup, "keep-view");
        expect(left.text.value).toBe("左");
        expect(await at.area.documents.save(at.area.documentOf(leftGroup)!)).toEqual({ok: true});
    });

    it("关掉写不出的视图（输出 61）：询问里没有保存；不保存时丢掉它的输入，文档的正文不变", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        await ready(at);
        const binding = textBinding(at.area, groupId(at));
        if (binding === null) throw new Error("没有绑定");
        binding.block({reason: "段首的 HTML", from: 1, to: 4, index: 1, excerpt: "A", fallback: "A"});
        const document = at.area.documentOf(groupId(at));
        const closing = at.area.close(at.area.groups.activeTab()?.id ?? "");
        await until(at, "问", () => at.area.dialog.value !== null);
        expect(at.area.dialog.value).toEqual({address: "project://a.md", saveable: false});
        at.area.answer("discard");
        expect(await closing).toBe("closed");
        expect(document?.blocked.value.size ?? 0).toBe(0);
        expect(await readFile(join(at.scene.project, "a.md"), "utf8")).toBe("A");
    });

    it("同一文档还在别的组：关掉有未裁决输入的视图要问；不保存只丢这个视图的输入，文档仍可保存", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        await ready(at);
        at.area.split("right");
        await ready(at);
        const right = textBinding(at.area, groupId(at));
        const leftGroup = at.area.groups.groups.value[0]?.id ?? "";
        const left = textBinding(at.area, leftGroup);
        if (right === null || left === null) throw new Error("没有绑定");
        const base = left.revision.value;
        left.commit(base, "左");
        expect(right.commit(base, "右")).toMatchObject({status: "conflict"});
        const closing = at.area.close(at.area.groups.activeTab()?.id ?? "");
        await until(at, "问", () => at.area.dialog.value !== null);
        at.area.answer("discard");
        expect(await closing).toBe("closed");
        expect(at.area.documentOf(leftGroup)?.unresolved.value).toEqual([]);
        expect(await at.area.documents.save(at.area.documentOf(leftGroup)!)).toEqual({ok: true});
        expect(await readFile(join(at.scene.project, "a.md"), "utf8")).toBe("左");
    });

    it("恢复出来、还没读到的标签也算同一文件的标签：关另一组的标签不问，正文留给它", async () => {
        // 用真实的组模型造一份合法记录：左组 a，右组 a、b（活动 b），活动组在左。
        const panels = createMemoryEditorPanels();
        const model = createEditorGroups(panels);
        model.open("project://a.md", {mode: "permanent", editor: MARKDOWN_EDITOR});
        const leftId = model.activeGroup.value;
        model.split(model.activeTab()?.id ?? "", "right");
        const rightId = model.activeGroup.value;
        model.open("project://b.md", {mode: "permanent", editor: MARKDOWN_EDITOR});
        model.focusGroup(leftId);
        const at = await world(model.snapshot(), undefined, panels);
        await ready(at);
        const left = textBinding(at.area, leftId);
        if (left === null) throw new Error("没有绑定");
        left.commit(left.revision.value, "A（未保存）");
        expect(await at.area.close(at.area.groups.activeTab()?.id ?? "")).toBe("closed");
        expect(at.area.dialog.value).toBeNull();
        const aTab = at.area.groups.groups.value.find((group) => group.id === rightId)?.tabs[0]?.id ?? "";
        at.area.activate(aTab);
        await until(at, "右组的 a 就绪", () => textBinding(at.area, rightId)?.text.value === "A（未保存）");
    });
});

describe("Spec workbench.editor 输出 21–22：离开与抢救", () => {
    it("离开前结算视图里还没交出的输入；有 dirty 时需要确认；抢救列出 dirty 正文", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        await ready(at);
        const binding = textBinding(at.area, groupId(at));
        if (binding === null) throw new Error("没有绑定");
        expect(at.area.needsLeaveConfirm()).toBe(false);
        const detach = binding.attach(() => {
            binding.commit(binding.revision.value, "A（防抖中）");
        });
        expect(at.area.needsLeaveConfirm()).toBe(true);
        expect(at.area.documents.rescue()).toEqual([{path: "project://a.md", text: "A（防抖中）"}]);
        detach();
    });
});

describe("Spec workbench.editor 输出 29：继续写作", () => {
    const handleWith = (calls: string[], withReveal = true): EditorControlHandle => ({
        focus: () => void calls.push("focus"),
        flushPendingChange: () => undefined,
        ...(withReveal ? {revealEnd: () => void calls.push("revealEnd")} : {}),
    });

    it("打开并定位到末尾：等文档就绪与控件句柄，定位一次并聚焦；open 给出标签 id", async () => {
        const at = await world();
        const calls: string[] = [];
        const opened = at.area.open("project://a.md", {mode: "permanent", reveal: "end"});
        const tabId = opened.ok ? opened.tabId : "";
        expect(tabId).not.toBe("");
        expect(at.area.groups.activeTab()?.id).toBe(tabId);
        await ready(at);
        expect(calls).toEqual([]);
        at.area.registerTabHandle(activeTabId(at), MARKDOWN_EDITOR, handleWith(calls));
        // 定位推到下一个时钟刻：控件先在自己的 watch 里装上正文。
        expect(calls).toEqual([]);
        at.clock.advance(0);
        expect(calls).toEqual(["revealEnd", "focus"]);
        at.area.registerTabHandle(activeTabId(at), MARKDOWN_EDITOR, handleWith(calls));
        at.clock.advance(0);
        expect(calls).toEqual(["revealEnd", "focus"]);
    });

    it("句柄先到、文档后就绪也定位；没有 revealEnd 的控件只打开、只聚焦", async () => {
        const at = await world();
        const calls: string[] = [];
        at.area.open("project://a.md", {mode: "permanent", reveal: "end"});
        at.area.registerTabHandle(activeTabId(at), MARKDOWN_EDITOR, handleWith(calls));
        await ready(at);
        at.clock.advance(0);
        expect(calls).toEqual(["revealEnd", "focus"]);

        const plain = await world();
        const plainCalls: string[] = [];
        plain.area.open("project://a.md", {mode: "permanent", reveal: "end"});
        plain.area.registerTabHandle(activeTabId(plain), MARKDOWN_EDITOR, handleWith(plainCalls, false));
        await ready(plain);
        plain.clock.advance(0);
        expect(plainCalls).toEqual(["focus"]);
    });

    it("等待期间切到别的标签：取消，之后控件就绪也不动光标；切到别的组同样取消", async () => {
        // 文档已就绪、控件还没交出句柄（源码编辑器要先下载）时用户点了别的标签。
        const at = await world();
        const calls: string[] = [];
        at.area.open("project://a.md", {mode: "permanent", reveal: "end"});
        await ready(at);
        expect(at.area.open("project://b.md", {mode: "preview"})).toMatchObject({ok: true});
        await until(at, "b 就绪", () => textBinding(at.area, groupId(at))?.address.value.endsWith("b.md") === true);
        at.area.registerTabHandle(activeTabId(at), MARKDOWN_EDITOR, handleWith(calls));
        at.clock.advance(0);
        expect(calls).toEqual([]);
        // 切回 a 也不再定位：定位只在打开时记下的那一次。
        const a = at.area.groups.groups.value[0]?.tabs.find((tab) => tab.address === "project://a.md");
        expect(at.area.activate(a?.id ?? "")).toMatchObject({ok: true});
        await ready(at);
        at.clock.advance(0);
        expect(calls).toEqual([]);

        // 切到别的组：拆分出的新组成为活动组。
        const other = await world();
        const otherCalls: string[] = [];
        other.area.open("project://a.md", {mode: "permanent", reveal: "end"});
        await ready(other);
        expect(other.area.split("right")).toMatchObject({ok: true});
        other.area.registerTabHandle(activeTabId(other), MARKDOWN_EDITOR, handleWith(otherCalls));
        other.clock.advance(0);
        expect(otherCalls).toEqual([]);
    });

    it("等待期间焦点离开编辑器区：取消；就绪后、定位那一刻之前切到别的标签：不动光标也不聚焦", async () => {
        const at = await world();
        const calls: string[] = [];
        at.area.open("project://a.md", {mode: "permanent", reveal: "end"});
        await ready(at);
        at.area.focusLeft();
        at.area.registerTabHandle(activeTabId(at), MARKDOWN_EDITOR, handleWith(calls));
        at.clock.advance(0);
        expect(calls).toEqual([]);

        // 就绪已经排了下一刻的定位；这一刻里用户切到了同组的别的标签（同一种控件、同一个句柄）。
        const late = await world();
        const lateCalls: string[] = [];
        late.area.open("project://a.md", {mode: "permanent", reveal: "end"});
        await ready(late);
        late.area.registerTabHandle(activeTabId(late), MARKDOWN_EDITOR, handleWith(lateCalls));
        expect(late.area.open("project://b.md", {mode: "preview"})).toMatchObject({ok: true});
        late.clock.advance(0);
        expect(lateCalls).toEqual([]);
    });

    it("文件不在：标签照常打开，组顶部提示；notify 也能直接提示", async () => {
        const at = await world();
        at.area.open("project://missing.md", {mode: "permanent", reveal: "end"});
        await until(at, "读取失败后提示", () => at.area.notice.value !== null);
        expect(noticeText(at.area)).toBe("上次编辑的片段已不在原处：project://missing.md");
        expect(noticeText(at.area, "en-US")).toBe("The passage you last edited is no longer where it was: project://missing.md");
        at.area.notify(editorText("notice.continueOutsideProject", {address: "user://x.md"}));
        expect(noticeText(at.area)).toBe("不能打开 user://x.md：继续写作只能打开项目里的文件");
        expect(noticeText(at.area, "en-US")).toBe("Cannot open user://x.md: only files in the project can be opened to continue writing");
    });
});

describe("Spec workbench.editor 术语“视图”：每个标签一个控件", () => {
    const handleOf = (calls: string[], name: string): EditorControlHandle => ({focus: () => calls.push(name), flushPendingChange: () => undefined});

    it("拆出新组：绑定与视图状态不重建；关闭标签才释放", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        at.area.open("project://b.md", {mode: "permanent"});
        await ready(at);
        const before = textBinding(at.area, groupId(at));
        if (before === null) throw new Error("没有绑定");
        const released: string[] = [];
        before.slot.dispose = () => released.push("视图");
        at.area.tabControlSlot(before.tabId, before.editor).dispose = () => released.push("实例");
        expect(at.area.moveToNewGroup(before.tabId, {kind: "split", panel: groupId(at), edge: "right"})).toEqual({ok: true});
        expect(at.area.groups.groups.value).toHaveLength(2);
        expect(at.area.tabBinding(before.tabId)).toBe(before);
        expect(released).toEqual([]);
        expect(await at.area.close(before.tabId)).toBe("closed");
        expect(released).toEqual(["视图", "实例"]);
        expect(before.commit(before.revision.value, "迟到")).toEqual({status: "stale"});
    });

    it("换编辑器：换下的那一种释放，别的标签不受影响；同组关掉别的标签不动这个标签的绑定", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        at.area.open("project://b.md", {mode: "permanent"});
        await ready(at);
        const other = at.area.groups.groups.value[0]?.tabs[0]?.id ?? "";
        const markdown = textBinding(at.area, groupId(at));
        if (markdown === null) throw new Error("没有绑定");
        const released: string[] = [];
        markdown.slot.dispose = () => released.push("视图");
        at.area.tabControlSlot(markdown.tabId, MARKDOWN_EDITOR).dispose = () => released.push("实例");
        expect(at.area.reopenWith(CODE_EDITOR)).toEqual({ok: true});
        expect(released).toEqual(["视图", "实例"]);
        const code = textBinding(at.area, groupId(at));
        expect(code?.editor).toBe(CODE_EDITOR);
        expect(code?.slot).not.toBe(markdown.slot);
        expect(markdown.commit(markdown.revision.value, "迟到")).toEqual({status: "stale"});
        expect(await at.area.close(other)).toBe("closed");
        expect(textBinding(at.area, groupId(at))).toBe(code);
    });

    it("句柄按标签：切走后这组的句柄是新活动标签的，切回来还是原来那个", async () => {
        const at = await world();
        const calls: string[] = [];
        at.area.open("project://a.md", {mode: "permanent"});
        const first = activeTabId(at);
        at.area.registerTabHandle(first, MARKDOWN_EDITOR, handleOf(calls, "a"));
        at.area.open("project://b.md", {mode: "permanent"});
        expect(at.area.handleOf(groupId(at))).toBeNull();
        at.area.registerTabHandle(activeTabId(at), MARKDOWN_EDITOR, handleOf(calls, "b"));
        at.area.handleOf(groupId(at))?.focus();
        at.area.activate(first);
        at.area.handleOf(groupId(at))?.focus();
        expect(calls).toEqual(["b", "a"]);
    });

    it("关闭后焦点在下一个时钟刻才交给活动视图（那时这一轮渲染已经做完）；此前焦点移出编辑器区就撤销；控件还没挂上时等它登记", async () => {
        const at = await world();
        const calls: string[] = [];
        at.area.open("project://a.md", {mode: "permanent"});
        await ready(at);
        at.area.registerTabHandle(activeTabId(at), MARKDOWN_EDITOR, handleOf(calls, "a"));
        const closeWithFocus = async (name: string): Promise<void> => {
            at.area.open(`project://${name}`, {mode: "permanent"});
            await ready(at);
            at.area.focused.value = true;
            expect(await at.area.close(activeTabId(at))).toBe("closed");
        };
        await closeWithFocus("b.md");
        expect(calls).toEqual([]);
        at.clock.advance(0);
        expect(calls).toEqual(["a"]);

        await closeWithFocus("b.md");
        at.area.focusLeft();
        at.clock.advance(0);
        expect(calls).toEqual(["a"]);

        // 拆出的新标签：控件还没挂上。
        at.area.focused.value = true;
        expect(at.area.split("right")).toEqual({ok: true});
        at.clock.advance(0);
        expect(calls).toEqual(["a"]);
        at.area.registerTabHandle(activeTabId(at), MARKDOWN_EDITOR, handleOf(calls, "新标签"));
        expect(calls).toEqual(["a"]);
        at.clock.advance(0);
        expect(calls).toEqual(["a", "新标签"]);
    });

    it("留着控件的标签：活动标签加上每种编辑器最近用过的；超过上限时最久没用的出去，切回来又进来", async () => {
        const at = await world(null, undefined, undefined, 2);
        for (const name of ["a.md", "b.md"]) at.area.open(`project://${name}`, {mode: "permanent"});
        at.area.open("project://c.json", {mode: "permanent"});
        const ids = (): Array<string> => at.area.groups.groups.value[0]?.tabs.map((tab) => tab.id) ?? [];
        const [a, b, json] = ids() as [string, string, string];
        // 源码编辑器单独算：Markdown 的 a、b 都还在。
        expect([...at.area.mountedControls.value].sort()).toEqual([a, b, json].sort());
        at.area.open("project://a.html", {mode: "permanent"});
        const html = ids().at(-1) ?? "";
        expect(at.area.mountedControls.value.has(html)).toBe(true);
        expect(at.area.mountedControls.value.has(json)).toBe(true);
        at.area.open("project://c.json", {mode: "permanent", editor: MARKDOWN_EDITOR});
        // Markdown 第三个标签进来，最久没用的 a 出去。
        expect(at.area.mountedControls.value.has(a)).toBe(false);
        expect(at.area.mountedControls.value.has(b)).toBe(true);
        at.area.activate(a);
        expect(at.area.mountedControls.value.has(a)).toBe(true);
        expect(at.area.mountedControls.value.has(b)).toBe(false);
    });

    it("名额空出来不回填：早已回收的标签不在后台重新挂控件，要它再活动一次", async () => {
        const at = await world(null, undefined, undefined, 2);
        for (const name of ["a.md", "b.md", "a.html"]) at.area.open(`project://${name}`, {mode: "permanent", editor: MARKDOWN_EDITOR});
        const [a, b, c] = at.area.groups.groups.value[0]?.tabs.map((tab) => tab.id) as [string, string, string];
        expect(at.area.mountedControls.value.has(a)).toBe(false);
        expect(await at.area.close(c)).toBe("closed");
        expect([...at.area.mountedControls.value]).toEqual([b]);
        at.area.activate(a);
        expect([...at.area.mountedControls.value].sort()).toEqual([a, b].sort());
    });

    it("连续两次换编辑器（中间没有渲染）：换回来的绑定不接着用已释放的槽", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        await ready(at);
        const before = textBinding(at.area, groupId(at));
        if (before === null) throw new Error("没有绑定");
        before.slot.state = {caret: 1};
        expect(at.area.reopenWith(CODE_EDITOR)).toEqual({ok: true});
        expect(at.area.reopenWith(MARKDOWN_EDITOR)).toEqual({ok: true});
        const after = textBinding(at.area, groupId(at));
        expect(after).not.toBe(before);
        expect(after?.slot.state).toBeNull();
    });

    it("等定位的标签换了组：定位照做，焦点在目标组；只聚焦的交接不把在等的定位降级", async () => {
        const at = await world();
        const calls: string[] = [];
        const reveal = (): EditorControlHandle => ({focus: () => calls.push("focus"), flushPendingChange: () => undefined, revealEnd: () => calls.push("revealEnd")});
        at.area.open("project://a.md", {mode: "permanent"});
        at.area.open("project://b.md", {mode: "permanent", reveal: "end"});
        const moving = activeTabId(at);
        expect(at.area.moveToNewGroup(moving, {kind: "split", panel: groupId(at), edge: "right"})).toEqual({ok: true});
        at.area.registerTabHandle(moving, MARKDOWN_EDITOR, reveal());
        await ready(at);
        at.clock.advance(0);
        expect(calls).toEqual(["revealEnd", "focus"]);
    });

    it("移动：缺省把焦点交给活动视图；`focusView: false`（键盘放下，手势把焦点还给标签）不交", async () => {
        const at = await world();
        const calls: string[] = [];
        at.area.open("project://a.md", {mode: "permanent"});
        at.area.open("project://b.md", {mode: "permanent"});
        await ready(at);
        const b = activeTabId(at);
        at.area.registerTabHandle(b, MARKDOWN_EDITOR, handleOf(calls, "b"));
        at.clock.advance(0);
        const place = {group: groupId(at), partition: "normal" as const, before: at.area.groups.groups.value[0]?.tabs[0]?.id ?? null};
        expect(await at.area.moveTab(b, place, {focusView: false})).toEqual({ok: true});
        at.clock.advance(0);
        expect(calls).toEqual([]);
        expect(await at.area.moveTab(b, {...place, before: null})).toEqual({ok: true});
        at.clock.advance(0);
        expect(calls).toEqual(["b"]);
    });

    it("活动标签总留着，哪怕组比上限还多；页面标签不算", async () => {
        const at = await world(null, undefined, undefined, 1);
        at.area.open("project://a.md", {mode: "permanent"});
        expect(at.area.split("right")).toEqual({ok: true});
        expect(at.area.split("right")).toEqual({ok: true});
        const active = at.area.groups.groups.value.map((group) => group.active);
        expect(new Set(active).size).toBe(3);
        for (const id of active) expect(at.area.mountedControls.value.has(id ?? "")).toBe(true);
        at.area.openPage("nbook.test/page");
        expect(at.area.mountedControls.value.has(activeTabId(at))).toBe(true);
    });

    it("恢复的会话：只有活动标签留着控件，没活动过的标签不读文档", async () => {
        const first = await world();
        first.area.open("project://a.md", {mode: "permanent"});
        first.area.open("project://b.md", {mode: "permanent"});
        await ready(first);
        const restored = await reopen(first);
        const active = activeTabId(restored);
        expect([...restored.area.mountedControls.value]).toEqual([active]);
        await ready(restored);
        expect(restored.area.documents.get("project://b.md")).not.toBeNull();
        expect(restored.area.documents.get("project://a.md")).toBeNull();
    });
});

describe("Spec workbench.editor 输出 49–51：移动、固定与批量关闭", () => {
    /** 组里标签的地址（去掉 `project://`）。 */
    const names = (at: World, index: number): string[] => (at.area.groups.groups.value[index]?.tabs ?? []).map((tab) => tab.address.replace("project://", ""));
    const tabId = (at: World, index: number, name: string): string => at.area.groups.groups.value[index]?.tabs.find((tab) => tab.address === `project://${name}`)?.id ?? "";
    const groupAt = (at: World, index: number): string => at.area.groups.groups.value[index]?.id ?? "";
    async function boundIn(at: World, group: string): Promise<TextEditorBinding> {
        await until(at, `组 ${group} 的文档就绪`, () => textBinding(at.area, group) !== null);
        const binding = textBinding(at.area, group);
        if (binding === null) throw new Error("没有绑定");
        return binding;
    }

    it("换组：绑定、视图状态与实例跟着标签走，还能接着写；目标组有未裁决输入时不动并提示", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        at.area.open("project://b.md", {mode: "permanent"});
        const left = groupAt(at, 0);
        const before = await boundIn(at, left);
        before.commit(before.revision.value, "B1");
        before.slot.state = {caret: 1};
        const instance = at.area.tabControlSlot(before.tabId, before.editor);
        let released = 0;
        before.slot.dispose = () => {
            released += 1;
        };
        at.area.open("project://c.md", {mode: "permanent", group: "side"});
        const right = groupAt(at, 1);
        expect(await at.area.moveTab(tabId(at, 0, "b.md"), {group: right, partition: "normal", before: null})).toEqual({ok: true});
        expect([names(at, 0), names(at, 1)]).toEqual([["a.md"], ["c.md", "b.md"]]);
        const after = await boundIn(at, right);
        expect(after).toBe(before);
        expect(after.slot.state).toEqual({caret: 1});
        expect(at.area.tabControlSlot(after.tabId, after.editor)).toBe(instance);
        expect(released).toBe(0);
        expect(after.text.value).toBe("B1");
        after.commit(after.revision.value, "B2");
        expect(await at.area.documents.save(at.area.documentOf(right)!)).toEqual({ok: true});
        expect(await readFile(join(at.scene.project, "b.md"), "utf8")).toBe("B2");

        // 左组也打开 b.md，两个视图基于同一修订输入不同内容：右组的那个有未裁决输入。
        at.area.open("project://b.md", {mode: "permanent", group: left});
        const leftB = await boundIn(at, left);
        const base = leftB.revision.value;
        leftB.commit(base, "左");
        expect(after.commit(base, "右")).toMatchObject({status: "conflict"});
        expect(await at.area.moveTab(tabId(at, 0, "a.md"), {group: right, partition: "normal", before: null})).toMatchObject({ok: false});
        expect(at.area.notice.value).not.toBeNull();
        expect(names(at, 0)).toEqual(["a.md", "b.md"]);
    });

    it("浮动：标签浮出来是同一个绑定与实例，成为活动组；关到空后活动组回到树里", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        at.area.open("project://b.md", {mode: "permanent"});
        const left = groupAt(at, 0);
        const before = await boundIn(at, left);
        before.commit(before.revision.value, "B1");
        const b = tabId(at, 0, "b.md");
        const rect = {x: 10, y: 10, width: 400, height: 300};
        expect(at.area.moveToFloat(b, rect)).toEqual({ok: true});
        const floating = groupId(at);
        expect(floating).not.toBe(left);
        expect(at.panels.document().floats).toEqual([{panel: floating, rect}]);
        expect(names(at, 0)).toEqual(["a.md"]);
        const after = await boundIn(at, floating);
        expect(after).toBe(before);
        expect(after.text.value).toBe("B1");

        expect(await at.area.documents.save(at.area.documentOf(floating)!)).toEqual({ok: true});
        expect(await at.area.close(b)).toBe("closed");
        expect(at.panels.document().floats).toEqual([]);
        expect(groupId(at)).toBe(left);
    });

    it("浮动的组没有相邻：在侧边打开进树里的组，拆分拆树里的组，窗不拆", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        at.area.open("project://b.md", {mode: "permanent"});
        const left = groupAt(at, 0);
        expect(at.area.moveToFloat(tabId(at, 0, "b.md"), {x: 0, y: 0, width: 400, height: 300})).toEqual({ok: true});
        const floating = groupId(at);
        at.area.open("project://c.md", {mode: "permanent", group: "side"});
        expect(names(at, 0)).toEqual(["a.md", "c.md"]);
        expect(groupId(at)).toBe(left);
        at.area.groups.focusGroup(floating);
        expect(at.area.split("right").ok).toBe(true);
        expect(at.panels.document().floats.map((float) => float.panel)).toEqual([floating]);
        const treeGroups = at.area.groups.groups.value.filter((group) => group.id !== floating);
        expect(treeGroups).toHaveLength(2);
    });

    it("整窗停靠走编辑器区：目标组已有同一文件并掉，固定标签进固定区，窗空了移除", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        at.area.open("project://b.md", {mode: "permanent"});
        at.area.open("project://c.md", {mode: "permanent"});
        const left = groupAt(at, 0);
        const rect = {x: 0, y: 0, width: 400, height: 300};
        const c = tabId(at, 0, "c.md");
        expect(at.area.moveToFloat(c, rect)).toEqual({ok: true});
        const floating = groupId(at);
        const b = tabId(at, 0, "b.md");
        expect(await at.area.moveTab(b, {group: floating, partition: "normal", before: null})).toEqual({ok: true});
        at.area.setPinned(b, true);
        // 窗里再开一个左边已有的文件：停靠时并掉。
        at.area.open("project://a.md", {mode: "permanent", group: floating});
        const drag = createEditorTabDrag({area: () => at.area, pages: () => null, wrapTabs: () => true, text: {t: String} as never});
        drag.dropPanel(floating, {kind: "center", panel: left}, undefined, true);
        await until(at, "窗空了", () => at.panels.document().floats.length === 0);
        expect(at.area.groups.groups.value.map((group) => group.id)).toEqual([left]);
        const tabs = at.area.groups.groups.value[0]?.tabs ?? [];
        expect(tabs.map((tab) => nameOf(tab.address)).sort()).toEqual(["a.md", "b.md", "c.md"]);
        expect(tabs[0]?.id).toBe(b);
    });

    it("整窗停靠中途被拒绝就停，剩下的留在窗里", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        at.area.open("project://b.md", {mode: "permanent"});
        const left = groupAt(at, 0);
        expect(at.area.moveToFloat(tabId(at, 0, "b.md"), {x: 0, y: 0, width: 400, height: 300})).toEqual({ok: true});
        const floating = groupId(at);
        const winB = await boundIn(at, floating);
        const b = winB.tabId;
        at.area.open("project://c.json", {mode: "permanent", group: floating});
        expect(at.area.activate(b)).toEqual({ok: true});
        // 左组也开 b.md，两边基于同一修订输入不同内容：窗里的活动视图有未裁决输入，移走它要先裁决。
        at.area.open("project://b.md", {mode: "permanent", group: left});
        const leftB = await boundIn(at, left);
        const base = winB.revision.value;
        leftB.commit(base, "左");
        expect(winB.commit(base, "窗")).toMatchObject({status: "conflict"});
        const drag = createEditorTabDrag({area: () => at.area, pages: () => null, wrapTabs: () => true, text: {t: String} as never});
        drag.dropPanel(floating, {kind: "edge", target: {kind: "split", panel: left, edge: "right"}}, undefined, true);
        await until(at, "提示出现", () => at.area.notice.value !== null);
        expect(at.panels.document().floats.map((float) => float.panel)).toEqual([floating]);
        expect(at.area.groups.groups.value.find((group) => group.id === floating)?.tabs).toHaveLength(2);
    });

    describe("资源树拖来的文件", () => {
        const dragOf = (at: World) => createEditorTabDrag({area: () => at.area, pages: () => null, wrapTabs: () => true, text: {t: String} as never});

        it("中央：正式标签，目标组成为活动组", async () => {
            const at = await world();
            at.area.open("project://a.md", {mode: "permanent"});
            const left = groupAt(at, 0);
            at.area.open("project://c.json", {mode: "permanent", group: "side"});
            expect(await dragOf(at).openFiles(["project://b.md"], {kind: "center", panel: left}, undefined)).toBe(true);
            expect(names(at, 0)).toEqual(["a.md", "b.md"]);
            expect(groupId(at)).toBe(left);
        });

        it("标签条：多个文件按拖动顺序排在落点前面；落点上就是被放下的文件时不算失败", async () => {
            const at = await world();
            at.area.open("project://a.md", {mode: "permanent"});
            at.area.open("project://b.md", {mode: "permanent"});
            const left = groupAt(at, 0);
            const drag = dragOf(at);
            expect(await drag.openFiles(["project://c.json", "project://a.html"], {kind: "strip", panel: left, index: 1}, undefined)).toBe(true);
            expect(names(at, 0)).toEqual(["a.md", "c.json", "a.html", "b.md"]);
            // b.md 已经在这一组、落点就在它前面：复用它，不重复。
            expect(await drag.openFiles(["project://b.md"], {kind: "strip", panel: left, index: 3}, undefined)).toBe(true);
            expect(names(at, 0)).toEqual(["a.md", "c.json", "a.html", "b.md"]);
            // 已在落点上的：不算失败，也不动。
            expect(await drag.openFiles(["project://a.md"], {kind: "strip", panel: left, index: 0}, undefined)).toBe(true);
            expect(names(at, 0)).toEqual(["a.md", "c.json", "a.html", "b.md"]);
        });

        it("固定区末尾：放下的文件已是固定区最后一个，不算失败，后面的文件照开", async () => {
            const at = await world();
            at.area.open("project://a.md", {mode: "permanent"});
            at.area.open("project://b.md", {mode: "permanent"});
            const left = groupAt(at, 0);
            at.area.setPinned(tabId(at, 0, "a.md"), true);
            expect(names(at, 0)).toEqual(["a.md", "b.md"]);
            expect(await dragOf(at).openFiles(["project://a.md", "project://c.json"], {kind: "strip", panel: left, index: 1}, "pinned")).toBe(true);
            expect(names(at, 0)).toEqual(["a.md", "c.json", "b.md"]);
        });

        it("外缘：新组里开新标签，别的组已有同一文件不抢它的标签", async () => {
            const at = await world();
            at.area.open("project://a.md", {mode: "permanent"});
            const left = groupAt(at, 0);
            expect(await dragOf(at).openFiles(["project://a.md"], {kind: "edge", target: {kind: "split", panel: left, edge: "right"}}, undefined)).toBe(true);
            expect(at.area.groups.groups.value).toHaveLength(2);
            expect(names(at, 0)).toEqual(["a.md"]);
            expect(names(at, 1)).toEqual(["a.md"]);
            expect(groupId(at)).toBe(groupAt(at, 1));
        });

        it("没有落点：一个窗里多个标签，窗成为活动组", async () => {
            const at = await world();
            at.area.open("project://a.md", {mode: "permanent"});
            const rect = {x: 10, y: 10, width: 400, height: 300};
            expect(await dragOf(at).openFiles(["project://b.md", "project://c.json"], {kind: "float", rect}, undefined)).toBe(true);
            const floats = at.panels.document().floats;
            expect(floats).toHaveLength(1);
            expect(at.area.groups.groups.value.find((group) => group.id === floats[0]?.panel)?.tabs).toHaveLength(2);
            expect(groupId(at)).toBe(floats[0]?.panel ?? "");
        });

        it("目标组有未裁决输入：停，后面的不开，提示照旧", async () => {
            const at = await world();
            at.area.open("project://b.md", {mode: "permanent"});
            const left = groupAt(at, 0);
            at.area.open("project://b.md", {mode: "permanent", group: "side"});
            const right = groupAt(at, 1);
            const leftB = await boundIn(at, left);
            const rightB = await boundIn(at, right);
            const base = rightB.revision.value;
            rightB.commit(base, "右");
            expect(leftB.commit(base, "左")).toMatchObject({status: "conflict"});
            expect(await dragOf(at).openFiles(["project://a.md", "project://c.json"], {kind: "center", panel: left}, undefined)).toBe(false);
            expect(names(at, 0)).toEqual(["b.md"]);
            expect(at.area.notice.value).not.toBeNull();
        });
    });

    it("实时布局的预览判据与真正移动同条件：同组换位、跨组、新组、目标已有同一文件", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        at.area.open("project://b.md", {mode: "permanent"});
        const left = groupAt(at, 0);
        at.area.open("project://c.md", {mode: "permanent", group: "side"});
        const right = groupAt(at, 1);
        at.area.open("project://b.md", {mode: "permanent", group: right});
        const b = tabId(at, 0, "b.md");
        const a = tabId(at, 0, "a.md");
        const c = tabId(at, 1, "c.md");
        // 没有未裁决输入：只有目标已有同一文件时不摆预览。
        expect(at.area.moveBlocked(a, left)).toBe(false);
        expect(at.area.moveBlocked(c, left)).toBe(false);
        expect(at.area.moveBlocked(b, right)).toBe(true);
        expect(at.area.moveBlocked(a, null)).toBe(false);

        // 让左组的 b.md 有未裁决输入：两边基于同一修订输入不同内容。
        const leftB = await boundIn(at, left);
        const rightB = await boundIn(at, right);
        const base = rightB.revision.value;
        rightB.commit(base, "右");
        expect(leftB.commit(base, "左")).toMatchObject({status: "conflict"});
        expect(leftB.unresolved()).toBe(true);
        // 活动标签有未裁决输入：同组里挪别的标签、把它移走、往这组移，都和 `moveTab` 一样不行。
        expect(at.area.moveBlocked(a, left)).toBe(true);
        expect(await at.area.moveTab(a, {group: left, partition: "normal", before: b})).toMatchObject({ok: false});
        expect(at.area.moveBlocked(c, left)).toBe(true);
        expect(await at.area.moveTab(c, {group: left, partition: "normal", before: null})).toMatchObject({ok: false});
        // 活动的就是被挪的标签：同组换位不用离开它。
        expect(at.area.moveBlocked(b, left)).toBe(false);
        expect(at.area.moveBlocked(b, null)).toBe(true);
    });

    it("移到已有同一标签的组：共享的修改不问，源组空了随之关闭；被移动的视图有未裁决输入时问，取消则留在原处", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        await ready(at);
        expect(at.area.split("right")).toEqual({ok: true});
        const [left, right] = [groupAt(at, 0), groupAt(at, 1)];
        const leftView = await boundIn(at, left);
        leftView.commit(leftView.revision.value, "A1");
        expect(await at.area.moveTab(tabId(at, 0, "a.md"), {group: right, partition: "normal", before: null})).toEqual({ok: true});
        expect(at.area.dialog.value).toBeNull();
        expect(at.area.groups.groups.value.map((group) => group.id)).toEqual([right]);
        expect(at.area.documents.get("project://a.md")?.text.value).toBe("A1");

        expect(at.area.split("right")).toEqual({ok: true});
        const [first, second] = [groupAt(at, 0), groupAt(at, 1)];
        const one = await boundIn(at, first);
        const two = await boundIn(at, second);
        const base = one.revision.value;
        one.commit(base, "一");
        expect(two.commit(base, "二")).toMatchObject({status: "conflict"});
        const moving = at.area.moveTab(tabId(at, 1, "a.md"), {group: first, partition: "normal", before: null});
        await until(at, "问", () => at.area.dialog.value !== null);
        at.area.answer("cancel");
        expect(await moving).toMatchObject({ok: false});
        expect(names(at, 1)).toEqual(["a.md"]);
        expect(two.unresolved()).toBe(true);
    });

    it("关闭其他、关闭右侧跳过固定标签；询问里取消时停下、之前的已关；进行中的第二批被拒；固定刷新后仍在", async () => {
        const at = await world();
        for (const name of ["a", "b", "c", "c.json"]) at.area.open(`project://${name.includes(".") ? name : `${name}.md`}`, {mode: "permanent"});
        at.area.open("project://a.html", {mode: "permanent"});
        const group = groupAt(at, 0);
        expect(at.area.setPinned(tabId(at, 0, "a.md"), true)).toEqual({ok: true});
        at.area.activate(tabId(at, 0, "c.json"));
        const dirty = await boundIn(at, group);
        dirty.commit(dirty.revision.value, "{\"x\": 1}");
        at.area.activate(tabId(at, 0, "a.html"));
        const closing = at.area.closeOthers(tabId(at, 0, "a.html"));
        await until(at, "问", () => at.area.dialog.value !== null);
        const busy = await at.area.closeToRight(tabId(at, 0, "a.md"));
        expect(busy).toMatchObject({ok: false, closed: 0});
        expect(reasonText(busy)).toBe("正在关闭编辑器");
        expect(reasonText(busy, "en-US")).toBe("Editors are already being closed");
        at.area.answer("cancel");
        expect(await closing).toMatchObject({ok: false, closed: 2});
        expect(names(at, 0)).toEqual(["a.md", "c.json", "a.html"]);
        // 等待期间才固定的标签同样跳过：关闭右侧时先问 c.json，问着的时候固定 a.html。
        const right = at.area.closeToRight(tabId(at, 0, "a.md"));
        await until(at, "问", () => at.area.dialog.value !== null);
        at.area.setPinned(tabId(at, 0, "a.html"), true);
        at.area.answer("discard");
        expect(await right).toEqual({ok: true, closed: 1});
        expect(names(at, 0)).toEqual(["a.md", "a.html"]);
        expect(fileTabs(at.saved.at(-1)).map((tab) => [tab.address, tab.pinned ?? false])).toEqual([["project://a.md", true], ["project://a.html", true]]);
    });

    it("移走源组里非活动的标签：活动视图的绑定与它的未裁决输入不动，仍可裁决后保存", async () => {
        const at = await world();
        at.area.open("project://b.md", {mode: "permanent"});
        at.area.open("project://a.md", {mode: "permanent"});
        await ready(at);
        expect(at.area.split("right")).toEqual({ok: true});
        const [left, right] = [groupAt(at, 0), groupAt(at, 1)];
        const kept = await boundIn(at, left);
        const other = await boundIn(at, right);
        const base = kept.revision.value;
        other.commit(base, "右");
        expect(kept.commit(base, "左")).toMatchObject({status: "conflict"});
        expect(await at.area.moveTab(tabId(at, 0, "b.md"), {group: right, partition: "normal", before: null})).toEqual({ok: true});
        expect(textBinding(at.area, left)?.token).toBe(kept.token);
        expect(kept.unresolved()).toBe(true);
        at.area.resolve(left, "keep-view");
        expect(await at.area.documents.save(at.area.documentOf(left)!)).toEqual({ok: true});
        expect(await readFile(join(at.scene.project, "a.md"), "utf8")).toBe("左");
    });

    it("并掉时落点在固定区：关掉被移动的标签之后，留下的那个固定并排到落点", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        at.area.open("project://b.md", {mode: "permanent", group: "side"});
        at.area.open("project://a.md", {mode: "permanent", group: groupAt(at, 1)});
        const right = groupAt(at, 1);
        at.area.setPinned(tabId(at, 1, "b.md"), true);
        expect(await at.area.moveTab(tabId(at, 0, "a.md"), {group: right, partition: "pinned", before: tabId(at, 1, "b.md")})).toEqual({ok: true});
        expect(at.area.groups.groups.value.map((group) => group.tabs.map((tab) => `${tab.address.replace("project://", "")}${tab.kind === "file" && tab.pinned === true ? "^" : ""}`))).toEqual([["a.md^", "b.md^"]]);
    });

    it("询问期间另一个能编辑的标签被关掉：选“不保存”时按此刻的状态重新问，不按询问前的判断只丢这个视图的输入", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        await ready(at);
        expect(at.area.split("right")).toEqual({ok: true});
        const [left, right] = [groupAt(at, 0), groupAt(at, 1)];
        const one = await boundIn(at, left);
        const two = await boundIn(at, right);
        const base = one.revision.value;
        one.commit(base, "一");
        expect(two.commit(base, "二")).toMatchObject({status: "conflict"});
        const closing = at.area.close(tabId(at, 1, "a.md"));
        await until(at, "问", () => at.area.dialog.value !== null);
        // 左边的标签没有自己的未裁决输入：关它不问。
        const leftClose = at.area.close(tabId(at, 0, "a.md"));
        expect(await leftClose).toBe("closed");
        at.area.answer("discard");
        await until(at, "再问", () => at.area.dialog.value !== null);
        at.area.answer("discard");
        expect(await closing).toBe("closed");
        expect(at.area.needsLeaveConfirm()).toBe(false);
    });

    it("询问期间别处又开了这份文档的可编辑标签：选“保存”照样保存，不因状态变了跳过", async () => {
        const at = await world();
        at.area.open("project://a.md", {mode: "permanent"});
        const left = groupAt(at, 0);
        const view = await boundIn(at, left);
        view.commit(view.revision.value, "A（改）");
        const closing = at.area.close(tabId(at, 0, "a.md"));
        await until(at, "问", () => at.area.dialog.value !== null);
        expect(at.area.split("right", tabId(at, 0, "a.md"))).toEqual({ok: true});
        at.area.answer("save");
        expect(await closing).toBe("closed");
        expect(await readFile(join(at.scene.project, "a.md"), "utf8")).toBe("A（改）");
    });

    it("关闭已保存按地址看文档：恢复出来、还没读到的标签，若同一文档在别组改过，也留下", async () => {
        const first = await world();
        first.area.open("project://a.md", {mode: "permanent"});
        first.area.open("project://a.md", {mode: "permanent", group: "side"});
        first.area.open("project://b.md", {mode: "permanent", group: groupAt(first, 1)});
        const at = await reopen(first);
        const view = await boundIn(at, groupAt(at, 0));
        view.commit(view.revision.value, "A（改）");
        expect(await at.area.closeSaved(tabId(at, 1, "b.md"))).toEqual({ok: true, closed: 1});
        expect(names(at, 1)).toEqual(["a.md"]);
    });

    it("设置“预览标签页”关掉：已有的 preview 标签立即转正，之后单击打开也是常驻；再打开照旧", async () => {
        const enabled = shallowRef(true);
        counter += 1;
        const scene = await filesScene(join(tmp, `case-${String(counter)}`), {project: {"a.md": "A", "b.md": "B", "c.md": "C"}});
        const area = createEditorArea({files: files(scene.window), clock: new ManualClock(), panels: createMemoryEditorPanels(), workspaceKey: "p1", generation: 1, initial: null, enablePreview: () => enabled.value, report: (error) => {
            throw error;
        }});
        closers.push(async () => {
            area.dispose();
            await scene.world.close();
            await rm(scene.root, {recursive: true, force: true});
        });
        const previews = () => area.groups.groups.value.flatMap((group) => group.tabs).map((tab) => [tab.address, tab.preview]);
        area.open("project://a.md", {mode: "preview"});
        expect(previews()).toEqual([["project://a.md", true]]);
        enabled.value = false;
        await waitUntil("已有的 preview 转正", () => previews()[0]?.[1] === false);
        area.open("project://b.md", {mode: "preview"});
        expect(previews()).toEqual([["project://a.md", false], ["project://b.md", false]]);
        enabled.value = true;
        area.open("project://c.md", {mode: "preview"});
        expect(previews()).toEqual([["project://a.md", false], ["project://b.md", false], ["project://c.md", true]]);
    });

    it("关闭已保存：先结算视图输入，留下要保存的与固定的；保存失败时批量停下", async () => {
        const at = await world();
        for (const name of ["a.md", "b.md", "c.json", "a.html"]) at.area.open(`project://${name}`, {mode: "permanent"});
        const group = groupAt(at, 0);
        at.area.setPinned(tabId(at, 0, "a.md"), true);
        at.area.activate(tabId(at, 0, "b.md"));
        const b = await boundIn(at, group);
        b.commit(b.revision.value, "B（改）");
        expect(await at.area.closeSaved(tabId(at, 0, "b.md"))).toEqual({ok: true, closed: 2});
        expect(names(at, 0)).toEqual(["a.md", "b.md"]);

        // 磁盘被别处改过：选“保存”得到冲突，批量停在这里。
        await writeFile(join(at.scene.project, "b.md"), "外部");
        const closing = at.area.closeToRight(tabId(at, 0, "a.md"));
        await until(at, "问", () => at.area.dialog.value !== null);
        at.area.answer("save");
        expect(await closing).toMatchObject({ok: false, closed: 0});
        expect(names(at, 0)).toEqual(["a.md", "b.md"]);
        expect(await readFile(join(at.scene.project, "b.md"), "utf8")).toBe("外部");
    });
});
