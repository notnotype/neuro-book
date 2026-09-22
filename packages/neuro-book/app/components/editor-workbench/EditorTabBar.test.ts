// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {nextTick} from "vue";
import EditorTabBar from "nbook/app/components/editor-workbench/EditorTabBar.vue";
import type {EditorTabPresentation} from "nbook/app/components/editor-workbench/editor-view.types";

vi.hoisted(() => {
    globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});

/**
 * 标签栏的交互边界：受控展示（只发意图、不自行摘标签）、roving 焦点与手动激活、
 * 固定/普通分组，以及 Shift+F10 右键菜单这条不依赖拖拽的键盘路径。
 *
 * 关闭决策、store 顺序与 flush 时序由 useEditorWorkbench / novel-ide 的测试覆盖；
 * 这里只验证用户实际操作下画出的语义 DOM 与发出的意图，并让“父层接受/拒绝”在本地可控复现。
 */

const mounted: VueWrapper[] = [];

// jsdom 不实现滚动；真实浏览器里这一调用负责把活动标签滚入可见区。
const scrollIntoView = vi.fn();
Element.prototype.scrollIntoView = scrollIntoView;

beforeEach(() => {
    scrollIntoView.mockClear();
    vi.stubGlobal("useI18n", () => ({t: (key: string) => key}));
    vi.stubGlobal("ResizeObserver", class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
    });
});

afterEach(() => {
    for (const wrapper of mounted.splice(0)) {
        wrapper.unmount();
    }
    document.body.replaceChildren();
    vi.unstubAllGlobals();
});

function tab(path: string, overrides: Partial<Omit<EditorTabPresentation, "path">> = {}): EditorTabPresentation {
    return {path, title: path, pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-text", ...overrides};
}

function mountBar(
    tabs: readonly EditorTabPresentation[],
    activePath: string,
    slots?: Record<string, string>,
): VueWrapper {
    const wrapper = mount(EditorTabBar, {props: {tabs, activePath}, slots, attachTo: document.body});
    mounted.push(wrapper);
    return wrapper;
}

/** 标签本体按钮：按展示投影的标题定位，不依赖类名。 */
function tabButton(wrapper: VueWrapper, path: string): HTMLButtonElement {
    return wrapper.get<HTMLButtonElement>(`[data-role="editor-tab-item"][title="${path}"] [role="tab"]`).element;
}

function closeTabButton(wrapper: VueWrapper, path: string): HTMLButtonElement {
    return wrapper.get<HTMLButtonElement>(`[data-role="editor-tab-item"][title="${path}"] .editor-tab-close`).element;
}

async function pressKey(element: Element, key: string, init: KeyboardEventInit = {}): Promise<void> {
    element.dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true, ...init}));
    await nextTick();
}

function rowPaths(row: Element): string[] {
    return [...row.querySelectorAll("[data-role='editor-tab-item']")].map((item) => item.getAttribute("title") ?? "");
}

/** 当前展开的右键菜单项（ContextMenu 传送出组件，按语义角色查 DOM）。 */
function menuItems(): HTMLButtonElement[] {
    return [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]')];
}

function menuItem(label: string): HTMLButtonElement {
    const item = menuItems().find((candidate) => candidate.textContent?.includes(label) === true);
    if (!item) {
        throw new Error(`菜单里没有「${label}」：${menuItems().map((candidate) => candidate.textContent).join(" / ")}`);
    }
    return item;
}

async function openTabMenu(wrapper: VueWrapper, path: string): Promise<HTMLButtonElement> {
    const button = tabButton(wrapper, path);
    button.focus();
    await pressKey(button, "F10", {shiftKey: true});
    if (menuItems().length === 0) {
        throw new Error(`Shift+F10 没有展开「${path}」的标签菜单`);
    }
    return button;
}

describe("EditorTabBar 漫游焦点与手动激活", () => {
    const tabs = [tab("manuscript/a.md"), tab("data.json"), tab("page.html", {preview: true})];

    it("焦点只在 tab stop 之间移动，Enter/Space/点击才是激活", async () => {
        const wrapper = mountBar(tabs, "manuscript/a.md");

        // 活动标签是初始唯一的 Tab 停靠点。
        expect(tabButton(wrapper, "manuscript/a.md").getAttribute("tabindex")).toBe("0");
        expect(tabButton(wrapper, "data.json").getAttribute("tabindex")).toBe("-1");

        tabButton(wrapper, "manuscript/a.md").focus();
        await pressKey(tabButton(wrapper, "manuscript/a.md"), "ArrowRight");
        expect(document.activeElement).toBe(tabButton(wrapper, "data.json"));
        expect(tabButton(wrapper, "data.json").getAttribute("tabindex")).toBe("0");
        expect(tabButton(wrapper, "manuscript/a.md").getAttribute("tabindex")).toBe("-1");
        // 漫游不是激活：受控外壳仍指着原标签，也没有发出选择意图。
        expect(wrapper.emitted("select-tab")).toBeUndefined();
        expect(tabButton(wrapper, "manuscript/a.md").getAttribute("aria-selected")).toBe("true");
        expect(tabButton(wrapper, "data.json").getAttribute("aria-selected")).toBe("false");

        await pressKey(tabButton(wrapper, "data.json"), "Enter");
        await pressKey(tabButton(wrapper, "page.html"), " ");
        tabButton(wrapper, "page.html").click();
        expect(wrapper.emitted("select-tab")).toEqual([["data.json"], ["page.html"], ["page.html"]]);

        // 父层接受后才轮到 aria-selected 移动。
        await wrapper.setProps({activePath: "page.html"});
        expect(tabButton(wrapper, "page.html").getAttribute("aria-selected")).toBe("true");
        expect(tabButton(wrapper, "data.json").getAttribute("aria-selected")).toBe("false");
    });

    it("Home/End 直达首末标签，左右方向键在两端回绕，活动标签滚入可见", async () => {
        const wrapper = mountBar(tabs, "manuscript/a.md");

        await pressKey(tabButton(wrapper, "manuscript/a.md"), "End");
        expect(document.activeElement).toBe(tabButton(wrapper, "page.html"));

        await pressKey(tabButton(wrapper, "page.html"), "ArrowRight");
        expect(document.activeElement).toBe(tabButton(wrapper, "manuscript/a.md"));

        await pressKey(tabButton(wrapper, "manuscript/a.md"), "ArrowLeft");
        expect(document.activeElement).toBe(tabButton(wrapper, "page.html"));

        await pressKey(tabButton(wrapper, "page.html"), "Home");
        expect(document.activeElement).toBe(tabButton(wrapper, "manuscript/a.md"));
        expect(wrapper.emitted("select-tab")).toBeUndefined();

        // 活动标签变化时请求把它滚入可见区（点击标签或外壳切标签都走这一条）。
        scrollIntoView.mockClear();
        await wrapper.setProps({activePath: "page.html"});
        await nextTick();
        expect(scrollIntoView.mock.contexts).toContain(tabButton(wrapper, "page.html"));
    });
    it("多行上下键按实际行寻找同列邻项，切回单行后不抢上下键", async () => {
        const wrapper = mountBar([tab("a"), tab("b"), tab("c"), tab("d")], "b");
        await wrapper.setProps({wrap: true});
        for (const [path, x, y, height] of [["a", 0, 5, 26], ["b", 110, 4, 28], ["c", 0, 40, 28], ["d", 110, 41, 26]] as const) {
            vi.spyOn(tabButton(wrapper, path), "getBoundingClientRect").mockReturnValue(new DOMRect(x, y, 100, height));
        }
        tabButton(wrapper, "b").focus();
        await pressKey(tabButton(wrapper, "b"), "ArrowDown");
        expect(document.activeElement).toBe(tabButton(wrapper, "d"));
        await pressKey(tabButton(wrapper, "d"), "ArrowUp");
        expect(document.activeElement).toBe(tabButton(wrapper, "b"));
        expect(wrapper.emitted("select-tab")).toBeUndefined();
        await wrapper.setProps({wrap: false});
        await pressKey(tabButton(wrapper, "b"), "ArrowDown");
        expect(document.activeElement).toBe(tabButton(wrapper, "b"));
    });
});

describe("EditorTabBar 关闭与固定", () => {
    it("关闭按钮只表达意图：父层不响应时标签仍在，接受后焦点交给接替的邻居", async () => {
        const wrapper = mountBar([tab("a.md"), tab("b.md"), tab("c.md")], "b.md");

        // 取消：父层忽略 close-tab，标签一个都不能少。
        closeTabButton(wrapper, "a.md").click();
        await nextTick();
        expect(wrapper.emitted("close-tab")).toEqual([["a.md"]]);
        expect(wrapper.find('[data-role="editor-tab-item"][title="a.md"]').exists()).toBe(true);

        // 接受：宿主先摘掉标签并清空活动路径，稍后才切到接替的邻居（store.closeWorkspaceTab 的真实顺序）。
        closeTabButton(wrapper, "b.md").click();
        await nextTick();
        await wrapper.setProps({tabs: [tab("a.md"), tab("c.md")], activePath: ""});
        await nextTick();
        await nextTick();
        expect(wrapper.emitted("close-tab")).toEqual([["a.md"], ["b.md"]]);
        expect(wrapper.find('[data-role="editor-tab-item"][title="b.md"]').exists()).toBe(false);
        expect([tabButton(wrapper, "a.md"), tabButton(wrapper, "c.md")]).toContain(document.activeElement);

        // 宿主随后把活动标签切到接替者：焦点留在标签栏里，不能被切走。
        await wrapper.setProps({activePath: "c.md"});
        await nextTick();
        expect([tabButton(wrapper, "a.md"), tabButton(wrapper, "c.md")]).toContain(document.activeElement);
    });

    it("取消关闭时不移动焦点：标签还在，焦点留在被请求关闭的标签上", async () => {
        const wrapper = mountBar([tab("a.md"), tab("b.md"), tab("c.md")], "b.md");
        const requested = tabButton(wrapper, "b.md");
        requested.focus();
        await pressKey(requested, "Delete");

        expect(wrapper.emitted("close-tab")).toEqual([["b.md"]]);
        await nextTick();
        // 父层没有接受（脏标签选“取消”）：标签与焦点都必须原地不动，不能漂到邻居。
        expect(wrapper.find('[data-role="editor-tab-item"][title="b.md"]').exists()).toBe(true);
        expect(document.activeElement).toBe(requested);
    });

    it("Delete 只表达关闭意图；父层真的摘掉最后一个标签后才发出 empty-focus", async () => {
        const wrapper = mountBar([tab("only.md")], "only.md");

        await pressKey(tabButton(wrapper, "only.md"), "Delete");
        expect(wrapper.emitted("close-tab")).toEqual([["only.md"]]);
        // 组件不自行摘除受控标签，也不在父层表态前就宣称工作区已空。
        expect(wrapper.find('[data-role="editor-tab-item"][title="only.md"]').exists()).toBe(true);
        expect(wrapper.emitted("empty-focus")).toBeUndefined();

        // 父层接受：标签真的空了，外壳据此把焦点交给欢迎区主动作（只发一次）。
        await wrapper.setProps({tabs: [], activePath: ""});
        await nextTick();
        await nextTick();
        expect(wrapper.emitted("empty-focus")).toHaveLength(1);
    });

    it("固定与普通标签分行渲染，菜单能切换固定状态并发出分组内移动", async () => {
        const wrapper = mountBar(
            [tab("p.md", {pinned: true}), tab("q.md", {pinned: true}), tab("r.md"), tab("s.md")],
            "s.md",
            {trailing: "<span data-trailing></span>"},
        );

        expect(rowPaths(wrapper.get('[role="tablist"][aria-label="editorWorkbench.pinnedTabs"]').element)).toEqual(["p.md", "q.md"]);
        expect(rowPaths(wrapper.get('[role="tablist"][aria-label="editorWorkbench.regularTabs"]').element)).toEqual(["r.md", "s.md"]);
        expect(wrapper.find("[data-trailing]").exists()).toBe(true);

        // 取消固定：菜单给固定标签的是“取消固定”。
        const pinnedSecond = await openTabMenu(wrapper, "q.md");
        menuItem("editorWorkbench.unpin").click();
        await nextTick();
        await nextTick();
        expect(wrapper.emitted("set-pin")).toEqual([["q.md", false]]);
        // 动作完成后焦点归还触发标签。
        expect(document.activeElement).toBe(pinnedSecond);

        // 普通标签给出的是“固定”。
        await openTabMenu(wrapper, "r.md");
        menuItem("editorWorkbench.pin").click();
        await nextTick();
        expect(wrapper.emitted("set-pin")).toEqual([["q.md", false], ["r.md", true]]);

        // 组内移动：目标与位置按所在分组给出，不跨组。
        await openTabMenu(wrapper, "q.md");
        menuItem("editorWorkbench.moveBefore").click();
        await nextTick();
        expect(wrapper.emitted("move-tab")).toEqual([["q.md", "p.md", true, "before"]]);

        // 组内首项没有更靠前的目标，末项没有更靠后的目标。
        await openTabMenu(wrapper, "p.md");
        expect(menuItem("editorWorkbench.moveBefore").disabled).toBe(true);
        document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        await nextTick();
        await nextTick();

        await openTabMenu(wrapper, "s.md");
        expect(menuItem("editorWorkbench.moveAfter").disabled).toBe(true);
        document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        await nextTick();
        await nextTick();

        // 没有固定标签时固定行整行收起。
        await wrapper.setProps({tabs: [tab("r.md"), tab("s.md")]});
        expect(wrapper.find('[role="tablist"][aria-label="editorWorkbench.pinnedTabs"]').exists()).toBe(false);
    });

    it("图钉取消固定不选中或关闭标签，宿主接受后焦点随标签进入普通区", async () => {
        const wrapper = mountBar([tab("p.md", {pinned: true}), tab("r.md")], "r.md");
        const pin = wrapper.get<HTMLButtonElement>('[aria-label="editorWorkbench.unpin p.md"]');
        pin.element.focus();
        await pin.trigger("click");
        expect(wrapper.emitted("set-pin")).toEqual([["p.md", false]]);
        expect(wrapper.emitted("select-tab")).toBeUndefined();
        expect(wrapper.emitted("close-tab")).toBeUndefined();
        expect(rowPaths(wrapper.get('.editor-pinned-tabs').element)).toEqual(["p.md"]);
        await wrapper.setProps({tabs: [tab("p.md"), tab("r.md")]});
        await nextTick();
        expect(wrapper.find('.editor-pinned-tabs').exists()).toBe(false);
        expect(rowPaths(wrapper.get('.editor-regular-tabs').element)).toEqual(["p.md", "r.md"]);
        expect(document.activeElement).toBe(tabButton(wrapper, "p.md"));
    });

    it("Shift+F10 展开标签菜单，Escape 关闭并把焦点还给触发标签", async () => {
        const wrapper = mountBar([tab("a.md"), tab("b.md")], "b.md");

        const trigger = await openTabMenu(wrapper, "b.md");
        expect(document.querySelector('[role="menu"]')).not.toBeNull();

        // 焦点先落到菜单项上，再按 Escape——归还焦点必须是一次真实转移。
        const firstItem = menuItems()[0];
        if (!firstItem) {
            throw new Error("标签菜单没有可聚焦的菜单项");
        }
        firstItem.focus();
        expect(document.activeElement).toBe(firstItem);
        firstItem.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        await nextTick();
        await nextTick();

        expect(document.querySelector('[role="menu"]')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    it("预览标签双击转为常驻，未保存标记可被辅助技术读出", async () => {
        const wrapper = mountBar([tab("draft.md", {preview: true, dirty: true})], "draft.md");

        tabButton(wrapper, "draft.md").dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
        await nextTick();
        expect(wrapper.emitted("keep-tab")).toEqual([["draft.md"]]);
        expect(wrapper.find('[data-role="editor-tab-item"][title="draft.md"] [aria-label="editorWorkbench.unsaved"]').exists()).toBe(true);
    });

    it("鼠标滚轮在溢出的标签栏滚动时转化为横向 scrollLeft", async () => {
        const wrapper = mountBar([tab("a.md"), tab("b.md"), tab("c.md")], "a.md");
        await wrapper.setProps({wrap: false});
        const regularTablist = wrapper.get<HTMLDivElement>(".editor-regular-tabs").element;
        const scrollRow = regularTablist.parentElement!;

        Object.defineProperty(scrollRow, "scrollWidth", {value: 1000, configurable: true});
        Object.defineProperty(scrollRow, "clientWidth", {value: 300, configurable: true});

        const wheelEvent = new WheelEvent("wheel", {deltaY: 100, bubbles: true, cancelable: true});
        regularTablist.dispatchEvent(wheelEvent);
        await nextTick();

        expect(scrollRow.scrollLeft).toBe(100);
        expect(wheelEvent.defaultPrevented).toBe(true);
        await wrapper.setProps({wrap: true});
        const verticalWheel = new WheelEvent("wheel", {deltaY: 100, bubbles: true, cancelable: true});
        regularTablist.dispatchEvent(verticalWheel);
        expect(scrollRow.scrollLeft).toBe(100);
        expect(verticalWheel.defaultPrevented).toBe(false);
    });
});

