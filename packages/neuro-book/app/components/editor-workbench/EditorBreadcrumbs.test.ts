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
});
