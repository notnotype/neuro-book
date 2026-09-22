// @vitest-environment jsdom
import {mount, type VueWrapper} from "@vue/test-utils";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {defineComponent, nextTick} from "vue";
import EditorWorkbenchFixture from "./EditorWorkbenchFixture.vue";
import EditorWorkbench from "nbook/app/components/editor-workbench/EditorWorkbench.vue";
import type {EditorSplitPayload, TabTransferPayload} from "nbook/app/components/editor-workbench/editor-intents";
import {DEFAULT_CONTENTS, SCENE_TABS} from "./editor-workbench/fixture-data";
import {LAB_DATA_SINK, LAB_EVENT_SINK, type LabDataSink, type LabEventSink} from "../lab-event-sink";

/**
 * Lab 夹具的身份与事务边界：标签实例身份是 `(groupId, path)`，同组内 path 唯一。
 *
 * 这里只用**真实入口**驱动（控制栏按钮、标签关闭按钮、工具栏分屏按钮、外壳 emit 的拖放意图），
 * 因为这一层要钉的正是"入口 → 宿主事务"之间那条链：
 * 1. 草稿路径按占用分配，移动/关闭让标签数回落也不复用身份、不覆盖旧正文；
 * 2. 分屏与跨组转移要么整批发布，要么一格不动——未知来源/目标/路径、非法方向不产生伪造标签；
 * 3. 组集合顺序等于布局树叶序，目标组已有同 path 时不产生重复实例。
 */

/**
 * `@dnd-kit/dom` 在**模块求值期**就取 `ResizeObserver`，`vi.stubGlobal` 在 `beforeEach` 里太晚，
 * 因此用 `vi.hoisted` 在 import 之前补上（jsdom 没有这个 API）。
 */
vi.hoisted(() => {
    class ResizeObserverHoistedStub {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
    }
    globalThis.ResizeObserver ??= ResizeObserverHoistedStub as unknown as typeof ResizeObserver;
});

/** 真实 Splitter 需要布局引擎；这里只验渲染与事务接线，用面板插槽桩替代（同 EditorWorkbench.test.ts）。 */
const SplitterStub = defineComponent({
    name: "Splitter",
    props: ["branchId", "direction", "panels", "sashSizes", "sizesPx", "disabled"],
    emits: ["layout", "gesture-start", "gesture-update", "gesture-end", "gesture-cancel"],
    template: "<div><slot v-for='panel in panels' :name='`panel-${panel.id}`'/></div>",
});

const wrappers: VueWrapper[] = [];

/** 同一用例里要连挂多个夹具时先摘掉上一个：DOM 查询是全局的，两个夹具同时挂着会互相冒充。 */
function unmountAll(): void {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
}

beforeEach(() => {
    vi.stubGlobal("useI18n", () => ({t: (key: string) => key}));
    vi.stubGlobal("ResizeObserver", class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => 1440);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => 900);
    // jsdom 不实现滚动；标签栏用它把活动标签滚入可见。
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    unmountAll();
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

async function flush(): Promise<void> {
    for (let tick = 0; tick < 6; tick += 1) {
        await nextTick();
    }
}

type Harness = {
    wrapper: VueWrapper;
    events: Array<{name: string; payload?: unknown}>;
    data: unknown[];
};

function mountFixture(scene: string, data?: unknown): Harness {
    const events: Array<{name: string; payload?: unknown}> = [];
    const data_ = [] as unknown[];
    const eventSink: LabEventSink = (name, payload) => {
        events.push({name, payload});
    };
    const dataSink: LabDataSink = (value) => {
        data_.push(value);
    };
    const wrapper = mount(EditorWorkbenchFixture, {
        props: {scene, data},
        attachTo: document.body,
        global: {
            provide: {
                [LAB_EVENT_SINK as symbol]: eventSink,
                [LAB_DATA_SINK as symbol]: dataSink,
            },
            stubs: {Splitter: SplitterStub},
        },
    });
    wrappers.push(wrapper);
    return {wrapper, events, data: data_};
}

/** 场景标签表：只给身份字段，其余由夹具归一（与 Lab 传 `data.tabs` 同形）。 */
function tab(path: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {path, title: path.split("/").pop() ?? path, pinned: false, preview: false, dirty: false, ...overrides};
}

function countOf(harness: Harness, name: string): number {
    return harness.events.filter((entry) => entry.name === name).length;
}

function lastData(harness: Harness): Record<string, unknown> {
    return (harness.data.at(-1) ?? {}) as Record<string, unknown>;
}

/** 组 id：DOM 顺序就是布局树叶序（GridRenderer 按树渲染）。 */
function groupIds(): string[] {
    return [...document.querySelectorAll("[data-group-id]")]
        .map((element) => element.getAttribute("data-group-id") ?? "");
}

function group(groupId: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-group-id="${groupId}"]`);
}

function tabPaths(groupId: string): string[] {
    const scope = group(groupId);
    if (scope === null) return [];
    return [...scope.querySelectorAll("[data-role='editor-tab-item']")]
        .map((element) => element.getAttribute("data-editor-tab-path") ?? "");
}

/** 组内活动标签（aria-selected 的唯一真源）。 */
function activeTabPath(groupId: string): string {
    const scope = group(groupId);
    if (scope === null) return "";
    const item = [...scope.querySelectorAll("[data-role='editor-tab-item']")]
        .find((element) => element.querySelector("[role='tab'][aria-selected='true']") !== null);
    return item?.getAttribute("data-editor-tab-path") ?? "";
}

function activeGroupId(): string {
    return document.querySelector("[data-group-id].is-active-group")?.getAttribute("data-group-id") ?? "";
}

/**
 * 组里**可见**的正文：EditorViewHost 会把访问过的实例留在 DOM 里但 `display: none`，
 * 所以只读没有被 aria-hidden 包住的那一个。
 */
function bodyOf(groupId: string): string {
    const scope = group(groupId);
    if (scope === null) throw new Error(`组不存在：${groupId}`);
    const visible = [...scope.querySelectorAll("textarea")].find((element) => element.closest("[aria-hidden='true']") === null);
    if (!visible) throw new Error(`组 ${groupId} 没有可见正文`);
    return visible.value;
}

function clickSelector(selector: string): void {
    const element = document.querySelector<HTMLElement>(selector);
    if (element === null) {
        throw new Error(`找不到要点击的节点：${selector}`);
    }
    element.click();
}

/** 控制栏按钮按文案点击（Lab 控制实体在 jsdom 里走 fallback 容器，节点仍在 DOM 中）。 */
function clickButton(label: string): void {
    const wanted = label.replace(/\s+/g, "");
    const button = [...document.querySelectorAll("button")]
        .find((candidate) => (candidate.textContent ?? "").replace(/\s+/g, "") === wanted);
    if (!button) {
        throw new Error(`找不到按钮：${label}`);
    }
    button.click();
}

function emitIntent(harness: Harness, event: "split-tab" | "transfer-tab", payload: EditorSplitPayload | TabTransferPayload): void {
    const workbench = harness.wrapper.findComponent(EditorWorkbench);
    (workbench.vm.$emit as (name: string, payload: unknown) => void)(event, payload);
}

function snapshot(): {groups: Array<[string, string[]]>; activeGroup: string} {
    return {
        groups: groupIds().map((id) => [id, tabPaths(id)]),
        activeGroup: activeGroupId(),
    };
}

describe("EditorWorkbenchFixture 身份与事务边界", () => {
    it("三标签在组边缘 move 分屏：只搬走被选中的那一个实例，源组保留其余标签", async () => {
        const harness = mountFixture("mixed", {
            tabs: [tab("a.md"), tab("b.md"), tab("c.md")],
            activePath: "b.md",
        });
        await flush();
        expect(groupIds()).toEqual(["primary"]);
        expect(activeTabPath("primary")).toBe("b.md");

        emitIntent(harness, "split-tab", {
            sourceGroupId: "primary",
            targetGroupId: "primary",
            path: "b.md",
            direction: "right",
            mode: "move",
        });
        await flush();

        expect(countOf(harness, "split-tab")).toBe(1);
        expect(countOf(harness, "split-tab-rejected")).toBe(0);
        expect(groupIds()).toEqual(["primary", "group-2"]);
        expect(tabPaths("primary")).toEqual(["a.md", "c.md"]);
        expect(tabPaths("group-2")).toEqual(["b.md"]);
        // 被搬走的正好是活动标签：源组回落到剩余的第一个，新组接管活动组。
        expect(activeTabPath("primary")).toBe("a.md");
        expect(activeTabPath("group-2")).toBe("b.md");
        expect(activeGroupId()).toBe("group-2");
        expect(lastData(harness).groupsCount).toBe(2);
        expect(lastData(harness).splitPanePath).toBe("b.md");
    });

    it("三标签复制分屏（工具栏按钮）：源组保留全部标签，新组拿到同一文档的第二个视图", async () => {
        const harness = mountFixture("mixed", {
            tabs: [tab("a.md"), tab("b.md"), tab("c.md")],
            activePath: "b.md",
        });
        await flush();

        clickSelector('[data-group-id="primary"] .editor-toolbar-split-btn');
        await flush();

        expect(countOf(harness, "split-tab")).toBe(1);
        expect(groupIds()).toEqual(["primary", "group-2"]);
        expect(tabPaths("primary")).toEqual(["a.md", "b.md", "c.md"]);
        expect(tabPaths("group-2")).toEqual(["b.md"]);
        expect(activeTabPath("primary")).toBe("b.md");
    });

    it("向左分屏时组集合顺序跟布局树叶序（新组在前），不靠数组追加假定叶序", async () => {
        const harness = mountFixture("mixed", {
            tabs: [tab("a.md"), tab("b.md")],
            activePath: "a.md",
        });
        await flush();

        emitIntent(harness, "split-tab", {
            sourceGroupId: "primary",
            targetGroupId: "primary",
            path: "b.md",
            direction: "left",
            mode: "copy",
        });
        await flush();

        expect(groupIds()).toEqual(["group-2", "primary"]);
        expect(tabPaths("group-2")).toEqual(["b.md"]);
        expect(tabPaths("primary")).toEqual(["a.md", "b.md"]);
        // 组集合的第二项就是叶序里的第二片叶（primary）：追加顺序会让它变成新组。
        expect(lastData(harness).splitPanePath).toBe("a.md");
    });

    it("单标签 move 分屏：源组塌陷，新组接管活动组（不留空组、不留假标签）", async () => {
        const harness = mountFixture("mixed", {tabs: [tab("only.md")], activePath: "only.md"});
        await flush();

        emitIntent(harness, "split-tab", {
            sourceGroupId: "primary",
            targetGroupId: "primary",
            path: "only.md",
            direction: "right",
            mode: "move",
        });
        await flush();

        expect(groupIds()).toEqual(["group-2"]);
        expect(tabPaths("group-2")).toEqual(["only.md"]);
        expect(activeGroupId()).toBe("group-2");
        expect(activeTabPath("group-2")).toBe("only.md");
    });

    it("未知来源/路径与非法方向、模式的分屏载荷不改变任何可见标签与组数", async () => {
        const harness = mountFixture("mixed", {
            tabs: [tab("a.md"), tab("b.md"), tab("c.md")],
            activePath: "b.md",
        });
        await flush();
        const before = snapshot();

        for (const payload of [
            // 未知来源组：不能回落到"第一个组"再分屏。
            {sourceGroupId: "ghost", targetGroupId: "primary", path: "b.md", direction: "right", mode: "move"},
            // 路径不在源组：不能伪造一个标签顶上。
            {sourceGroupId: "primary", targetGroupId: "primary", path: "missing.md", direction: "right", mode: "move"},
            // 非法方向：不能落进几何映射的缺省分支。
            {sourceGroupId: "primary", targetGroupId: "primary", path: "b.md", direction: "down", mode: "move"},
            // 非法模式：不是 copy/move 的载荷一律拒绝。
            {sourceGroupId: "primary", targetGroupId: "primary", path: "b.md", direction: "right", mode: "duplicate"},
        ]) {
            // 载荷可来自 DOM 拖放层；非法值必须由夹具拒绝，因此这里显式构造越界载荷。
            emitIntent(harness, "split-tab", payload as unknown as EditorSplitPayload);
            await flush();
            expect(snapshot(), `载荷 ${JSON.stringify(payload)} 不该改变状态`).toEqual(before);
        }

        expect(countOf(harness, "split-tab-rejected")).toBe(4);
        expect(countOf(harness, "split-tab")).toBe(0);
    });

    it("创建草稿按占用取号：移动走的草稿不让 primary 数量回落复用同一路径或覆盖旧正文", async () => {
        const harness = mountFixture("mixed", {
            tabs: [tab("a.md"), tab("b.md")],
            activePath: "a.md",
        });
        await flush();

        clickButton("+ 新建标签");
        await flush();
        expect(tabPaths("primary")).toEqual(["a.md", "b.md", "src/draft/note-01.md"]);
        const firstBody = bodyOf("primary");
        expect(firstBody).toContain("新建笔记 01");

        // 把草稿移到新组：primary 的标签数回落到 2——旧实现会在这里算出同一个序号。
        emitIntent(harness, "split-tab", {
            sourceGroupId: "primary",
            targetGroupId: "primary",
            path: "src/draft/note-01.md",
            direction: "right",
            mode: "move",
        });
        await flush();
        expect(tabPaths("group-2")).toEqual(["src/draft/note-01.md"]);

        clickButton("+ 新建标签");
        await flush();

        expect(tabPaths("primary")).toEqual(["a.md", "b.md", "src/draft/note-02.md"]);
        expect(bodyOf("primary")).toContain("新建笔记 02");
        // 旧正文没有被第二次创建覆盖：被搬走的 note-01 仍是原内容。
        expect(bodyOf("group-2")).toBe(firstBody);
    });

    it("关闭草稿后再创建：序号继续递增，不复用刚释放的路径", async () => {
        const harness = mountFixture("mixed", {
            tabs: [tab("a.md"), tab("b.md")],
            activePath: "a.md",
        });
        await flush();

        clickButton("+ 新建标签");
        await flush();
        expect(tabPaths("primary")).toEqual(["a.md", "b.md", "src/draft/note-01.md"]);

        clickSelector('[data-editor-tab-path="src/draft/note-01.md"] .editor-tab-close');
        await flush();
        expect(tabPaths("primary")).toEqual(["a.md", "b.md"]);

        clickButton("+ 新建标签");
        await flush();
        expect(tabPaths("primary")).toEqual(["a.md", "b.md", "src/draft/note-02.md"]);
        expect(bodyOf("primary")).toContain("新建笔记 02");
    });

    it("换场景后新建草稿也不覆盖上个场景留下的正文", async () => {
        const harness = mountFixture("mixed");
        await flush();
        clickButton("+ 新建标签");
        await flush();
        const firstBody = bodyOf("primary");
        expect(firstBody).toContain("新建笔记 01");

        // 换场景会重建标签与布局，但正文缓冲留在会话里——序号仍要避开它。
        await harness.wrapper.setProps({scene: "long-titles"});
        await flush();
        expect(tabPaths("primary")).toEqual(SCENE_TABS["long-titles"]!.map((item) => item.path));

        clickButton("+ 新建标签");
        await flush();

        expect(tabPaths("primary").at(-1)).toBe("src/draft/note-02.md");
        expect(bodyOf("primary")).toContain("新建笔记 02");
        expect(bodyOf("primary")).not.toBe(firstBody);
    });

    it("跨组转移遇到目标已有同 path：只激活既有引用并删除来源实例，不产生重复标签", async () => {
        const harness = mountFixture("mixed", {
            tabs: [tab("a.md"), tab("b.md")],
            activePath: "a.md",
        });
        await flush();

        clickSelector('[data-group-id="primary"] .editor-toolbar-split-btn');
        await flush();
        expect(tabPaths("group-2")).toEqual(["a.md"]);

        emitIntent(harness, "transfer-tab", {
            path: "a.md",
            sourceGroupId: "primary",
            targetGroupId: "group-2",
            targetPath: null,
            targetPinned: false,
            position: "after",
        });
        await flush();

        expect(countOf(harness, "transfer-tab")).toBe(1);
        expect(countOf(harness, "transfer-tab-rejected")).toBe(0);
        expect(groupIds()).toEqual(["primary", "group-2"]);
        expect(tabPaths("primary")).toEqual(["b.md"]);
        expect(tabPaths("group-2")).toEqual(["a.md"]);
        expect(activeGroupId()).toBe("group-2");

        // 源组搬空后塌陷，标签落进目标组的既有引用之后，活动组仍指向目标组。
        emitIntent(harness, "transfer-tab", {
            path: "b.md",
            sourceGroupId: "primary",
            targetGroupId: "group-2",
            targetPath: "a.md",
            targetPinned: false,
            position: "after",
        });
        await flush();

        expect(groupIds()).toEqual(["group-2"]);
        expect(tabPaths("group-2")).toEqual(["a.md", "b.md"]);
        expect(activeGroupId()).toBe("group-2");
        expect(activeTabPath("group-2")).toBe("b.md");
    });

    it("未知来源/目标/路径的跨组转移被拒绝，且不改任何可见标签与组数", async () => {
        const harness = mountFixture("mixed", {
            tabs: [tab("a.md"), tab("b.md")],
            activePath: "a.md",
        });
        await flush();
        clickSelector('[data-group-id="primary"] .editor-toolbar-split-btn');
        await flush();
        const before = snapshot();

        for (const payload of [
            {path: "a.md", sourceGroupId: "ghost", targetGroupId: "group-2", targetPath: null, targetPinned: false, position: "after"},
            {path: "a.md", sourceGroupId: "primary", targetGroupId: "ghost", targetPath: null, targetPinned: false, position: "after"},
            {path: "missing.md", sourceGroupId: "primary", targetGroupId: "group-2", targetPath: null, targetPinned: false, position: "after"},
            {path: "a.md", sourceGroupId: "primary", targetGroupId: "primary", targetPath: null, targetPinned: false, position: "after"},
        ]) {
            emitIntent(harness, "transfer-tab", payload as unknown as TabTransferPayload);
            await flush();
            expect(snapshot(), `载荷 ${JSON.stringify(payload)} 不该改变状态`).toEqual(before);
        }

        expect(countOf(harness, "transfer-tab-rejected")).toBe(4);
        expect(countOf(harness, "transfer-tab")).toBe(0);
    });

    it("非法 activePath 的数据更新不写正文，合法更新照常写入", async () => {
        const data = {tabs: [tab("src/a.md")], activePath: "src/a.md", content: "# A1"};
        const harness = mountFixture("mixed", data);
        await flush();
        expect(activeTabPath("primary")).toBe("src/a.md");
        expect(bodyOf("primary")).toBe("# A1");

        await harness.wrapper.setProps({data: {...data, activePath: "src/missing.md", content: "# 不该写入"}});
        await flush();

        expect(countOf(harness, "active-path-rejected")).toBe(1);
        expect(activeTabPath("primary")).toBe("src/a.md");
        expect(bodyOf("primary")).toBe("# A1");

        // 同一条通道的合法更新仍然生效：上面的读取不是"永远读不到新正文"的假阳性。
        await harness.wrapper.setProps({data: {...data, content: "# A2"}});
        await flush();
        expect(bodyOf("primary")).toBe("# A2");
    });

    it("自定义标签表含空 path 或组内重复 path 时整份拒绝，回落到场景默认标签且不写正文", async () => {
        const defaults = SCENE_TABS.mixed!.map((item) => item.path);

        for (const tabs of [[tab("dup.md"), tab("dup.md")], [tab("a.md"), {path: ""}]]) {
            const harness = mountFixture("mixed", {tabs, activePath: "dup.md", content: "# 不该写入"});
            await flush();

            expect(countOf(harness, "scene-rejected"), `标签表 ${JSON.stringify(tabs)} 应被拒绝`).toBe(1);
            expect(tabPaths("primary")).toEqual(defaults);
            expect(activeTabPath("primary")).toBe("src/story/chapter-02.md");
            expect(lastData(harness).tabCount).toBe(defaults.length);
            expect(bodyOf("primary")).toBe(DEFAULT_CONTENTS["src/story/chapter-02.md"]);
            unmountAll();
        }
    });

    it("场景分屏参数非法时既不建组也不写正文", async () => {
        const harness = mountFixture("mixed", {
            tabs: [tab("a.md"), tab("b.md")],
            activePath: "a.md",
            splitPanePath: "missing.md",
            splitPaneDirection: "right",
            content: "# 不该写入",
        });
        await flush();

        expect(countOf(harness, "split-tab-rejected")).toBe(1);
        expect(groupIds()).toEqual(["primary"]);
        expect(tabPaths("primary")).toEqual(["a.md", "b.md"]);
        expect(bodyOf("primary")).not.toContain("不该写入");
    });

    it("未指定标签表时非法活动路径也拒绝正文写入", async () => {
        const harness = mountFixture("mixed", {activePath: "missing.md", content: "# 不该写入"});
        await flush();
        expect(countOf(harness, "active-path-rejected")).toBe(1);
        expect(bodyOf("primary")).toBe(DEFAULT_CONTENTS["src/story/chapter-02.md"]);
    });

    it("场景分屏参数合法时按声明的边缘方向真的分屏", async () => {
        const harness = mountFixture("mixed", {
            tabs: [tab("a.md"), tab("b.md")],
            activePath: "a.md",
            splitPanePath: "b.md",
            splitPaneDirection: "right",
        });
        await flush();

        expect(countOf(harness, "split-tab")).toBe(1);
        expect(groupIds()).toEqual(["primary", "group-2"]);
        expect(tabPaths("primary")).toEqual(["a.md", "b.md"]);
        expect(tabPaths("group-2")).toEqual(["b.md"]);
    });

    it("轮转分屏按钮按真实源标签逐档扩到 4 组再还原单组", async () => {
        const harness = mountFixture("mixed", {
            tabs: [tab("a.md"), tab("b.md"), tab("c.md")],
            activePath: "a.md",
        });
        await flush();

        clickButton("分屏打开");
        await flush();
        expect(groupIds()).toEqual(["primary", "group-2"]);
        expect(tabPaths("group-2")).toEqual(["b.md"]);

        clickButton("分屏: 2组 (切下档)");
        await flush();
        expect(groupIds()).toEqual(["primary", "group-2", "group-3"]);

        clickButton("分屏: 3组 (切下档)");
        await flush();
        expect(groupIds()).toEqual(["primary", "group-4", "group-2", "group-3"]);
        expect(groupIds()).toHaveLength(4);

        clickButton("分屏: 4组 (切下档)");
        await flush();
        expect(groupIds()).toEqual(["primary"]);
        expect(tabPaths("primary")).toEqual(["a.md", "b.md", "c.md"]);
        expect(lastData(harness).groupsCount).toBe(1);
        expect(countOf(harness, "split-tab-rejected")).toBe(0);
    });

    it("没有真实标签时轮转分屏只拒绝：不伪造源标签、不建空组", async () => {
        const harness = mountFixture("empty");
        await flush();
        expect(groupIds()).toEqual(["primary"]);
        expect(tabPaths("primary")).toEqual([]);

        clickButton("分屏打开");
        await flush();

        expect(countOf(harness, "split-tab-rejected")).toBe(1);
        expect(countOf(harness, "split-tab")).toBe(0);
        expect(groupIds()).toEqual(["primary"]);
        expect(tabPaths("primary")).toEqual([]);
        expect(lastData(harness).groupsCount).toBe(1);
    });
});
