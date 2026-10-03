// @vitest-environment jsdom
import {afterEach, describe, expect, it} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import EditorBreadcrumbs from "./EditorBreadcrumbs.vue";

const mounted: VueWrapper[] = [];

afterEach(() => {
    for (const wrapper of mounted.splice(0)) {
        wrapper.unmount();
    }
    document.body.replaceChildren();
});

describe("EditorBreadcrumbs 组件", () => {
    it("根据文件路径自动解析出文件夹与文件层级", () => {
        const wrapper = mount(EditorBreadcrumbs, {
            props: {path: "src/draft/note-01.md"},
            attachTo: document.body,
        });
        mounted.push(wrapper);

        const buttons = wrapper.findAll("button");
        expect(buttons).toHaveLength(3);
        expect(buttons[0]?.text()).toBe("src");
        expect(buttons[1]?.text()).toBe("draft");
        expect(buttons[2]?.text()).toBe("note-01.md");
    });

    it("支持附加符号节点（例如标题大纲）并渲染", () => {
        const wrapper = mount(EditorBreadcrumbs, {
            props: {
                path: "chapter-01.md",
                symbols: [{id: "h1", label: "第一章 觉醒", iconClass: "i-lucide-hash"}],
            },
            attachTo: document.body,
        });
        mounted.push(wrapper);

        const buttons = wrapper.findAll("button");
        expect(buttons).toHaveLength(2);
        expect(buttons[0]?.text()).toBe("chapter-01.md");
        expect(buttons[1]?.text()).toBe("第一章 觉醒");
    });

    it("正确归一化 Windows 反斜杠路径", () => {
        const wrapper = mount(EditorBreadcrumbs, {
            props: {path: "packages\\neuro-book\\src\\story\\chapter-01.md"},
            attachTo: document.body,
        });
        mounted.push(wrapper);

        const buttons = wrapper.findAll("button");
        expect(buttons).toHaveLength(5);
        expect(buttons[0]?.text()).toBe("packages");
        expect(buttons[1]?.text()).toBe("neuro-book");
        expect(buttons[2]?.text()).toBe("src");
        expect(buttons[3]?.text()).toBe("story");
        expect(buttons[4]?.text()).toBe("chapter-01.md");
    });

    it("正确为末尾项设置 aria-current='location'，前序项不设置", () => {
        const wrapper = mount(EditorBreadcrumbs, {
            props: {
                path: "src/story/chapter-01.md",
                symbols: [{id: "sym-1", label: "第一节"}],
            },
            attachTo: document.body,
        });
        mounted.push(wrapper);

        const buttons = wrapper.findAll("button");
        expect(buttons).toHaveLength(4);
        expect(buttons[0]?.attributes("aria-current")).toBeUndefined();
        expect(buttons[1]?.attributes("aria-current")).toBeUndefined();
        expect(buttons[2]?.attributes("aria-current")).toBeUndefined();
        // 符号作为最终激活节点，拥有 aria-current="location"
        expect(buttons[3]?.attributes("aria-current")).toBe("location");
    });

    it("支持键盘左右方向键与 Home/End 巡检聚焦", async () => {
        const wrapper = mount(EditorBreadcrumbs, {
            props: {path: "a/b/c"},
            attachTo: document.body,
        });
        mounted.push(wrapper);

        const buttons = wrapper.findAll("button");
        expect(buttons).toHaveLength(3);

        const btn0 = buttons[0]?.element as HTMLButtonElement;
        const btn1 = buttons[1]?.element as HTMLButtonElement;
        const btn2 = buttons[2]?.element as HTMLButtonElement;

        btn0.focus();
        expect(document.activeElement).toBe(btn0);

        await buttons[0]?.trigger("keydown", {key: "ArrowRight"});
        expect(document.activeElement).toBe(btn1);

        await buttons[1]?.trigger("keydown", {key: "End"});
        expect(document.activeElement).toBe(btn2);

        await buttons[2]?.trigger("keydown", {key: "ArrowLeft"});
        expect(document.activeElement).toBe(btn1);

        await buttons[1]?.trigger("keydown", {key: "Home"});
        expect(document.activeElement).toBe(btn0);
    });

    it("点击面包屑节点发出 navigate 事件", async () => {
        const wrapper = mount(EditorBreadcrumbs, {
            props: {path: "packages/app/index.vue"},
            attachTo: document.body,
        });
        mounted.push(wrapper);

        const firstButton = wrapper.findAll("button")[0];
        await firstButton?.trigger("click");

        expect(wrapper.emitted("navigate")).toHaveLength(1);
        expect(wrapper.emitted("navigate")?.[0]?.[0]).toMatchObject({
            id: "packages",
            label: "packages",
            path: "packages",
        });
    });

    it("默认渲染底部分割线 (bordered=true)，当 bordered=false 时移除底边框", () => {
        const defaultWrapper = mount(EditorBreadcrumbs, {
            props: {path: "src/main.ts"},
            attachTo: document.body,
        });
        mounted.push(defaultWrapper);
        expect(defaultWrapper.find("nav").classes()).toContain("border-b");

        const unborderedWrapper = mount(EditorBreadcrumbs, {
            props: {path: "src/main.ts", bordered: false},
            attachTo: document.body,
        });
        mounted.push(unborderedWrapper);
        expect(unborderedWrapper.find("nav").classes()).not.toContain("border-b");
    });
});


