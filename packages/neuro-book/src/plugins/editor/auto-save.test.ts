/**
 * 自动保存（docs/specs/workbench/editor.md 输出 4、21、63）：真实 Files 场地上的编辑器区，设置用一个可改的引用代替配置服务，
 * “停手后”的计时用手动时钟（与场地的时钟分开）。断言磁盘内容与文档状态；“没有发起保存”看文档的 `saving`：保存一发起它
 * 就同步为真。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {chmod, readFile, rename, rm, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {join} from "node:path";

import {shallowRef} from "@vue/reactivity";
import type {ShallowRef} from "@vue/reactivity";

import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {BATCH_DELAY_MS} from "nbook/plugins/files/backend/changes";
import {files, filesScene} from "nbook/plugins/files/testing/scene";
import type {Scene} from "nbook/plugins/files/testing/scene";
import {createLinkTap} from "nbook/plugins/files/testing/tap";
import type {LinkTap} from "nbook/plugins/files/testing/tap";
import {createMemoryEditorPanels} from "nbook/plugins/workbench/shared/editor-panels";

import {createEditorArea} from "./web/area";
import type {EditorArea, TextEditorBinding} from "./web/area";
import type {AutoSaveMode, AutoSaveSettings} from "./web/auto-save";
import {CODE_EDITOR} from "./shared/contracts";
import type {TextDocument} from "./web/documents/store";

let tmp = "";
let counter = 0;
const closers: Array<() => Promise<void>> = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-editor", "auto-save");
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
    readonly settings: ShallowRef<AutoSaveSettings>;
}

const DELAY = 1000;

async function world(mode: AutoSaveMode): Promise<World> {
    counter += 1;
    const tap = createLinkTap();
    const scene = await filesScene(join(tmp, `case-${String(counter)}`), {project: {"a.md": "A", "b.md": "B"}}, {wrapLink: tap.wrap});
    const clock = new ManualClock();
    const settings = shallowRef<AutoSaveSettings>({mode, delay: DELAY});
    const area = createEditorArea({files: files(scene.window), clock, workspaceKey: "p1", generation: 1, panels: createMemoryEditorPanels(), initial: null, autoSave: () => settings.value, report: (error) => {
        throw error;
    }});
    closers.push(async () => {
        area.dispose();
        await scene.world.close();
        // 有的用例把项目目录设成只读来制造保存失败：删之前恢复。
        await chmod(scene.project, 0o755);
        await rm(scene.root, {recursive: true, force: true});
    });
    return {scene, tap, clock, area, settings};
}

async function until(at: World, description: string, check: () => boolean | Promise<boolean>): Promise<void> {
    await waitUntil(description, () => {
        at.scene.world.clock.advance(BATCH_DELAY_MS);
        return check();
    });
}

const groupId = (at: World): string => at.area.groups.activeGroup.value;
const tabId = (at: World): string => {
    const tab = at.area.groups.activeTab();
    if (tab === null) throw new Error("没有活动标签");
    return tab.id;
};
const bindingOf = (at: World, group: string = groupId(at)): TextEditorBinding => {
    const binding = at.area.binding(group);
    if (binding?.kind !== "text") throw new Error("没有文本绑定");
    return binding;
};
const documentOf = (at: World, address: string): TextDocument => {
    const document = at.area.documents.get(address);
    if (document === null) throw new Error(`${address} 没有打开`);
    return document;
};

/** 打开一个文件并等它就绪；返回它的文档。 */
async function open(at: World, name: string): Promise<TextDocument> {
    const address = `project://${name}`;
    expect(at.area.open(address, {mode: "permanent"})).toMatchObject({ok: true});
    await until(at, `${name} 就绪`, () => at.area.binding(groupId(at))?.address.value === address);
    return documentOf(at, address);
}
/** 像控件那样把输入交给文档。 */
const type = (at: World, text: string, group?: string): void => {
    const binding = bindingOf(at, group);
    expect(binding.commit(binding.revision.value, text).status).toBe("accepted");
};
const disk = (at: World, name: string): Promise<string> => readFile(join(at.scene.project, name), "utf8");
const saved = (at: World, name: string, text: string): Promise<void> => until(at, `${name} 落盘`, async () => (await disk(at, name)) === text && !documentOf(at, `project://${name}`).dirty.value);
const writes = (at: World): number => at.tap.requests.filter((request) => request.method === "write").length;

describe("Spec workbench.editor 输出 63：离开视图与窗口失焦", () => {
    it("失焦时：视图发 leave 就保存这份文档", async () => {
        const at = await world("onFocusChange");
        const document = await open(at, "a.md");
        type(at, "A1");
        expect(document.dirty.value).toBe(true);
        at.area.viewLeft(tabId(at));
        await saved(at, "a.md", "A1");
    });

    it("关闭、停手后、窗口失焦时三种模式下，视图发 leave 不保存", async () => {
        for (const mode of ["off", "afterDelay", "onWindowChange"] as const) {
            const at = await world(mode);
            const document = await open(at, "a.md");
            type(at, "A1");
            at.area.viewLeft(tabId(at));
            expect(document.saving.value).toBe(false);
            expect(await disk(at, "a.md")).toBe("A");
        }
    });

    it("失焦时：换到同组另一个标签，换下的文件保存", async () => {
        const at = await world("onFocusChange");
        await open(at, "a.md");
        type(at, "A1");
        await open(at, "b.md");
        await saved(at, "a.md", "A1");
    });

    it("窗口失焦：窗口失焦时与失焦时两种模式都保存全部打开的文档", async () => {
        const at = await world("onWindowChange");
        await open(at, "a.md");
        type(at, "A1");
        const b = await open(at, "b.md");
        type(at, "B1");
        // 窗口失焦时模式下，应用内换标签不保存。
        expect(documentOf(at, "project://a.md").saving.value).toBe(false);
        at.area.windowBlurred();
        await saved(at, "a.md", "A1");
        await saved(at, "b.md", "B1");

        at.settings.value = {mode: "onFocusChange", delay: DELAY};
        type(at, "B2");
        at.area.windowBlurred();
        await saved(at, "b.md", "B2");

        at.settings.value = {mode: "off", delay: DELAY};
        type(at, "B3");
        at.area.windowBlurred();
        expect(b.saving.value).toBe(false);
        // 换成停手后会把已经 dirty 的先存一次（另一条用例）；等它存完再看窗口失焦不触发。
        at.settings.value = {mode: "afterDelay", delay: DELAY};
        await saved(at, "b.md", "B3");
        type(at, "B4");
        at.area.windowBlurred();
        expect(b.saving.value).toBe(false);
    });

    it("离开页面：开着自动保存时把未保存的发出去", async () => {
        const at = await world("afterDelay");
        const document = await open(at, "a.md");
        type(at, "A1");
        at.area.leaving();
        expect(document.saving.value).toBe(true);
        await saved(at, "a.md", "A1");
    });
});

describe("Spec workbench.editor 输出 63：停手后", () => {
    it("到点保存；继续输入重新计时", async () => {
        const at = await world("afterDelay");
        const document = await open(at, "a.md");
        type(at, "A1");
        at.clock.advance(DELAY - 1);
        expect(document.saving.value).toBe(false);
        type(at, "A2");
        at.clock.advance(DELAY - 1);
        expect(document.saving.value).toBe(false);
        at.clock.advance(1);
        expect(document.saving.value).toBe(true);
        await saved(at, "a.md", "A2");
    });

    it("视图手里还有没交出的输入（组字中）时顺延，不强制结算；交出后重新计时", async () => {
        const at = await world("afterDelay");
        const document = await open(at, "a.md");
        const binding = bindingOf(at);
        let composing = false;
        let flushed = 0;
        const detach = binding.attach(() => {
            flushed += 1;
        }, () => composing);
        type(at, "A1");
        composing = true;
        at.clock.advance(DELAY);
        at.clock.advance(DELAY);
        expect(document.saving.value).toBe(false);
        expect(flushed).toBe(0);
        expect(await disk(at, "a.md")).toBe("A");
        // 上屏：控件把输入交出来，从这时起再过一个延迟才保存。
        composing = false;
        type(at, "A1 上屏");
        at.clock.advance(DELAY - 1);
        expect(document.saving.value).toBe(false);
        at.clock.advance(1);
        await saved(at, "a.md", "A1 上屏");
        detach();
    });

    it("到点之前手动保存了：计时取消，不再多写一次", async () => {
        const at = await world("afterDelay");
        const document = await open(at, "a.md");
        type(at, "A1");
        expect(await at.area.save()).toEqual({ok: true});
        const before = writes(at);
        at.clock.advance(DELAY);
        expect(document.saving.value).toBe(false);
        expect(writes(at)).toBe(before);
    });

    it("阻碍消除后补存：未裁决输入采用当前正文之后，修订没变也会重新计时", async () => {
        const at = await world("afterDelay");
        const document = await open(at, "a.md");
        const left = groupId(at);
        expect(at.area.split("right")).toMatchObject({ok: true});
        await until(at, "右组就绪", () => at.area.binding(groupId(at)) !== null && groupId(at) !== left);
        const base = bindingOf(at, left).revision.value;
        expect(bindingOf(at).commit(base, "右").status).toBe("accepted");
        expect(bindingOf(at, left).commit(base, "左").status).toBe("conflict");
        at.clock.advance(DELAY);
        expect(document.saving.value).toBe(false);
        at.area.resolve(left, "adopt-current");
        at.clock.advance(DELAY - 1);
        expect(document.saving.value).toBe(false);
        at.clock.advance(1);
        await saved(at, "a.md", "右");
    });

    it("模式换走取消计时；换成开启的模式立即保存一次", async () => {
        const at = await world("afterDelay");
        const document = await open(at, "a.md");
        type(at, "A1");
        at.settings.value = {mode: "off", delay: DELAY};
        at.clock.advance(DELAY);
        expect(document.saving.value).toBe(false);
        at.settings.value = {mode: "onWindowChange", delay: DELAY};
        expect(document.saving.value).toBe(true);
        await saved(at, "a.md", "A1");
    });

    it("连续的输入与保存交错，自己的写入回声不让文档出现磁盘已变化或冲突", async () => {
        const at = await world("afterDelay");
        const document = await open(at, "a.md");
        for (const text of ["A1", "A2", "A3"]) {
            type(at, text);
            at.clock.advance(DELAY);
            // 上一次保存的事件还在路上时就接着输入。
            type(at, `${text}+`);
            at.clock.advance(DELAY);
            await saved(at, "a.md", `${text}+`);
        }
        await until(at, "事件落定", () => !document.saving.value);
        expect(document.diskChanged.value).toBe(false);
        expect(document.conflict.value).toBeNull();
    });
});

describe("Spec workbench.editor 输出 63：不自动保存的文档", () => {
    it("dirty 时磁盘已变化：不保存，留给用户处理", async () => {
        const at = await world("onFocusChange");
        const document = await open(at, "a.md");
        type(at, "A1");
        await writeFile(join(at.scene.project, "a.md"), "外部");
        await until(at, "磁盘已变化", () => document.diskChanged.value);
        at.area.viewLeft(tabId(at));
        at.area.windowBlurred();
        expect(document.saving.value).toBe(false);
        expect(document.conflict.value).toBeNull();
        expect(await disk(at, "a.md")).toBe("外部");
    });

    it("有磁盘冲突：不再发保存，等用户选重新载入或覆盖", async () => {
        const at = await world("onFocusChange");
        const document = await open(at, "a.md");
        type(at, "A1");
        await writeFile(join(at.scene.project, "a.md"), "外部");
        await until(at, "磁盘已变化", () => document.diskChanged.value);
        expect(await at.area.save()).toMatchObject({ok: false});
        expect(document.conflict.value).not.toBeNull();
        const before = writes(at);
        at.area.viewLeft(tabId(at));
        at.area.windowBlurred();
        expect(document.saving.value).toBe(false);
        expect(writes(at)).toBe(before);
    });

    it("被其它来源删除：不在原路径重建", async () => {
        const at = await world("onFocusChange");
        const document = await open(at, "a.md");
        type(at, "A1");
        await rm(join(at.scene.project, "a.md"));
        await until(at, "标为已删除", () => document.status.value === "deleted");
        at.area.viewLeft(tabId(at));
        expect(document.saving.value).toBe(false);
        expect(existsSync(join(at.scene.project, "a.md"))).toBe(false);
    });

    it("写不出的视图：不保存", async () => {
        const at = await world("onFocusChange");
        const document = await open(at, "a.md");
        type(at, "A1");
        bindingOf(at).block({reason: "测试", from: 0, to: 1, index: 1, excerpt: "A", fallback: "A"});
        at.area.viewLeft(tabId(at));
        expect(document.saving.value).toBe(false);
    });

    it("自动保存失败后对这份文档停下；一次保存成功后恢复", async () => {
        const at = await world("onFocusChange");
        const document = await open(at, "a.md");
        await chmod(at.scene.project, 0o555);
        type(at, "A1");
        at.area.viewLeft(tabId(at));
        await until(at, "保存失败", () => document.saveProblem.value !== null && !document.saving.value);
        type(at, "A2");
        at.area.viewLeft(tabId(at));
        expect(document.saving.value).toBe(false);

        await chmod(at.scene.project, 0o755);
        expect(await at.area.save()).toEqual({ok: true});
        expect(await disk(at, "a.md")).toBe("A2");
        type(at, "A3");
        at.area.viewLeft(tabId(at));
        await saved(at, "a.md", "A3");
    });

    it("自动保存失败后重新载入：不再提示保存失败，之后的输入照常自动保存", async () => {
        const at = await world("onFocusChange");
        const document = await open(at, "a.md");
        await chmod(at.scene.project, 0o555);
        type(at, "A1");
        at.area.viewLeft(tabId(at));
        await until(at, "保存失败", () => document.saveProblem.value !== null && !document.saving.value);
        await at.area.revert();
        expect(document.dirty.value).toBe(false);
        expect(document.saveProblem.value).toBeNull();

        await chmod(at.scene.project, 0o755);
        type(at, "A2");
        at.area.viewLeft(tabId(at));
        await saved(at, "a.md", "A2");
    });
});

describe("Spec workbench.editor 输出 14、63：存不了之后怎样恢复", () => {
    it("结果未知、核对后没落盘：说明保存失败，“重试保存”成功后自动保存恢复", async () => {
        const at = await world("onFocusChange");
        const document = await open(at, "a.md");
        type(at, "A1");
        // 写请求还没到服务端就断线：结果未知。
        const held = at.tap.holdSend((frame) => (frame as {type?: string; method?: string}).type === "request" && (frame as {method?: string}).method === "write");
        at.area.viewLeft(tabId(at));
        await held.arrived;
        at.scene.windowLink.disconnect();
        await until(at, "结果未知", () => document.saveProblem.value?.code === "unknown-outcome" && !document.saving.value);
        await at.scene.windowLink.reconnect();
        await until(at, "核对过：没有落盘", () => document.saveProblem.value?.code === "not-written");
        expect(await disk(at, "a.md")).toBe("A");
        expect(document.dirty.value).toBe(true);
        // 停下了：再离开视图不发保存。
        at.area.viewLeft(tabId(at));
        expect(document.saving.value).toBe(false);
        expect(await at.area.save()).toEqual({ok: true});
        expect(document.saveProblem.value).toBeNull();
        type(at, "A2");
        at.area.viewLeft(tabId(at));
        await saved(at, "a.md", "A2");
    });

    it("保存失败后把正文改回原样：不再提示保存失败，之后的输入照常自动保存", async () => {
        const at = await world("onFocusChange");
        const document = await open(at, "a.md");
        await chmod(at.scene.project, 0o555);
        type(at, "A1");
        at.area.viewLeft(tabId(at));
        await until(at, "保存失败", () => document.saveProblem.value !== null && !document.saving.value);
        type(at, "A");
        expect(document.dirty.value).toBe(false);
        expect(document.saveProblem.value).toBeNull();
        await chmod(at.scene.project, 0o755);
        type(at, "A3");
        at.area.viewLeft(tabId(at));
        await saved(at, "a.md", "A3");
    });

    it("设置换成值相同的新对象：“停手后”的计时不重排", async () => {
        const at = await world("afterDelay");
        const a = await open(at, "a.md");
        type(at, "A1");
        at.clock.advance(DELAY - 1);
        // 换一个值相同的设置对象：取值没变，不重排。
        at.settings.value = {mode: "afterDelay", delay: DELAY};
        at.clock.advance(1);
        expect(a.saving.value).toBe(true);
        await saved(at, "a.md", "A1");
    });
});

describe("Spec workbench.editor 输出 63：什么不算离开视图", () => {
    it("再次打开组里正活动的文件、同一个标签换编辑器：不保存", async () => {
        const at = await world("onFocusChange");
        const document = await open(at, "a.md");
        type(at, "A1");
        expect(at.area.open("project://a.md", {mode: "permanent"})).toMatchObject({ok: true});
        expect(document.saving.value).toBe(false);
        expect(at.area.reopenWith(CODE_EDITOR)).toMatchObject({ok: true});
        expect(document.saving.value).toBe(false);
        expect(document.dirty.value).toBe(true);
    });

    it("同一文件在两个组里：关掉其中一组的标签算离开，保存", async () => {
        const at = await world("onFocusChange");
        const document = await open(at, "a.md");
        expect(at.area.split("right")).toMatchObject({ok: true});
        await until(at, "右组就绪", () => at.area.binding(groupId(at)) !== null);
        type(at, "A1");
        expect(await at.area.close(tabId(at))).toBe("closed");
        await saved(at, "a.md", "A1");
        expect(document.dirty.value).toBe(false);
    });
});

describe("Spec workbench.editor 输出 4、63：关闭标签", () => {
    it("开着自动保存：关闭未保存的标签不询问，保存完成后关闭", async () => {
        const at = await world("afterDelay");
        await open(at, "a.md");
        type(at, "A1");
        expect(await at.area.close(tabId(at))).toBe("closed");
        expect(at.area.dialog.value).toBeNull();
        expect(await disk(at, "a.md")).toBe("A1");
    });

    it("保存期间又有输入：再存一次，仍不询问", async () => {
        const at = await world("onWindowChange");
        await open(at, "a.md");
        type(at, "A1");
        const held = at.tap.hold((request) => request.method === "write");
        const closing = at.area.close(tabId(at));
        await held.arrived;
        type(at, "A2（保存期间）");
        held.release();
        expect(await closing).toBe("closed");
        expect(at.area.dialog.value).toBeNull();
        expect(await disk(at, "a.md")).toBe("A2（保存期间）");
    });

    it("保存失败：落回询问，取消后标签与修改都在", async () => {
        const at = await world("onFocusChange");
        const document = await open(at, "a.md");
        await chmod(at.scene.project, 0o555);
        type(at, "A1");
        const closing = at.area.close(tabId(at));
        await until(at, "问", () => at.area.dialog.value !== null);
        expect(at.area.dialog.value).toMatchObject({address: "project://a.md", saveable: true});
        at.area.answer("cancel");
        expect(await closing).toBe("cancelled");
        expect(document.dirty.value).toBe(true);
        expect(at.area.groups.activeTab()?.address).toBe("project://a.md");
    });

    it("批量关闭遇保存失败：停在询问，取消后已关的不恢复", async () => {
        const at = await world("onFocusChange");
        await open(at, "b.md");
        await open(at, "a.md");
        const keep = tabId(at);
        await at.area.activate(at.area.groups.groups.value[0]!.tabs[0]!.id);
        await until(at, "b 就绪", () => at.area.binding(groupId(at))?.address.value === "project://b.md");
        await chmod(at.scene.project, 0o555);
        type(at, "B1");
        const closing = at.area.closeOthers(keep);
        await until(at, "问", () => at.area.dialog.value !== null);
        at.area.answer("cancel");
        expect(await closing).toMatchObject({ok: false, closed: 0});
        expect(at.area.groups.groups.value[0]!.tabs).toHaveLength(2);
    });

    it("磁盘已变化的文档：照旧询问", async () => {
        const at = await world("onFocusChange");
        const document = await open(at, "a.md");
        type(at, "A1");
        await writeFile(join(at.scene.project, "a.md"), "外部");
        await until(at, "磁盘已变化", () => document.diskChanged.value);
        const closing = at.area.close(tabId(at));
        await until(at, "问", () => at.area.dialog.value !== null);
        at.area.answer("cancel");
        expect(await closing).toBe("cancelled");
        expect(await disk(at, "a.md")).toBe("外部");
    });
});

describe("Spec workbench.editor 输出 63：与资源管理器的租约", () => {
    it("租约期间触发的自动保存等租约结束，改名后存到新地址", async () => {
        const at = await world("onFocusChange");
        const document = await open(at, "a.md");
        const begun = await at.area.documents.coordinator.begin(["project://a.md"]);
        if (!begun.ok) throw new Error("没有拿到租约");
        type(at, "A1");
        at.area.viewLeft(tabId(at));
        expect(document.saving.value).toBe(true);
        await rename(join(at.scene.project, "a.md"), join(at.scene.project, "moved.md"));
        begun.lease.end({kind: "done", moved: [{from: "project://a.md", to: "project://moved.md"}]});
        await until(at, "存到新地址", async () => existsSync(join(at.scene.project, "moved.md")) && (await disk(at, "moved.md")) === "A1" && !document.dirty.value);
        expect(existsSync(join(at.scene.project, "a.md"))).toBe(false);
    });
});
