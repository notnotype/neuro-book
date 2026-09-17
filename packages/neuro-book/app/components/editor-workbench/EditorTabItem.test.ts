// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {nextTick} from "vue";
import EditorTabItem from "./EditorTabItem.vue";
import type {EditorTabPresentation} from "./editor-view.types";

const mounted: VueWrapper[] = [];

beforeEach(() => {
    vi.stubGlobal("useI18n", () => ({t: (key: string) => key}));
});

afterEach(() => {
    for (const wrapper of mounted.splice(0)) {
        wrapper.unmount();
    }
    document.body.replaceChildren();
    vi.unstubAllGlobals();
});

function createTab(path: string, overrides: Partial<Omit<EditorTabPresentation, "path">> = {}): EditorTabPresentation {
    return {
        path,
        title: path.split("/").pop() ?? path,
        pinned: false,
        preview: false,
        dirty: false,
        iconClass: "i-lucide-file-text",
        ...overrides,
    };
}

describe("EditorTabItem 组件", () => {
    it("正确渲染语义节点：data-role, role=tab, aria-selected 与关闭按钮", () => {
        const tab = createTab("src/draft.md");
        const wrapper = mount(EditorTabItem, {
            props: {
                tab,
                active: true,
                focused: true,
                tabId: "tab-1",
                ariaControls: "panel-1",
            },
            attachTo: document.body,
        });
        mounted.push(wrapper);

        expect(wrapper.attributes("data-role")).toBe("editor-tab-item");
        expect(wrapper.attributes("title")).toBe("src/draft.md");

        const button = wrapper.get('[role="tab"]');
        expect(button.attributes("id")).toBe("tab-1");
        expect(button.attributes("aria-selected")).toBe("true");
        expect(button.attributes("aria-controls")).toBe("panel-1");
        expect(button.attributes("tabindex")).toBe("0");

        const closeBtn = wrapper.get(".editor-tab-close");
        expect(closeBtn.exists()).toBe(true);
    });

    it("点击与双击分别触发 select 与 keep 事件", async () => {
        const tab = createTab("src/note.md", {preview: true});
        const wrapper = mount(EditorTabItem, {
            props: {tab, active: false},
            attachTo: document.body,
        });
        mounted.push(wrapper);

        await wrapper.get('[role="tab"]').trigger("click");
        expect(wrapper.emitted("select")).toEqual([["src/note.md"]]);

        await wrapper.get('[role="tab"]').trigger("dblclick");
        expect(wrapper.emitted("keep")).toEqual([["src/note.md"]]);
    });

    it("点击关闭按钮发出 close 事件并阻止冒泡", async () => {
        const tab = createTab("test.json");
        const wrapper = mount(EditorTabItem, {
            props: {tab},
            attachTo: document.body,
        });
        mounted.push(wrapper);

        await wrapper.get(".editor-tab-close").trigger("click");
        expect(wrapper.emitted("close")).toEqual([["test.json"]]);
        // select 不应被触发（click.stop）
        expect(wrapper.emitted("select")).toBeUndefined();
    });

    it("正确呈现未保存 dirty 圆点与 Git statusText", () => {
        const tab = createTab("config.json", {dirty: true, statusText: "U"});
        const wrapper = mount(EditorTabItem, {
            props: {tab},
            attachTo: document.body,
        });
        mounted.push(wrapper);

        expect(wrapper.find('[aria-label="editorWorkbench.unsaved"]').exists()).toBe(true);
        expect(wrapper.text()).toContain("U");
    });

    it("拖拽指示线能根据 dropIndicator 正确展示", async () => {
        const tab = createTab("main.ts");
        const wrapper = mount(EditorTabItem, {
            props: {tab, dropIndicator: "before"},
            attachTo: document.body,
        });
        mounted.push(wrapper);

        expect(wrapper.find(".left-0").exists()).toBe(true);

        await wrapper.setProps({dropIndicator: "after"});
        expect(wrapper.find(".right-0").exists()).toBe(true);

        await wrapper.setProps({dropIndicator: null});
        expect(wrapper.find(".left-0").exists()).toBe(false);
        expect(wrapper.find(".right-0").exists()).toBe(false);
    });
});
