/**
 * `settingsPage`（docs/specs/settings/settings-window.md“分区声明”）：包出的页面收到窗口给的 `context` 与插件补的属性，
 * `load` 可以交模块或组件本身，补的属性在渲染时求值。
 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";
import {defineComponent, h, ref} from "vue";
import type {PropType} from "vue";

import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";

import {settingsPage} from "./settings-page";

const Page = defineComponent({
    name: "ProbePage",
    props: {
        context: {type: Object as PropType<SettingsPageContext>, required: true},
        label: {type: String, required: true},
    },
    setup: (props) => () => h("p", {"data-page": props.context.id}, props.label),
});

const context: SettingsPageContext = {id: "x.notes.page", layer: ref("user"), projectTitle: ref(null), writable: ref(true), options: {}, dirty: () => undefined, reportWriteFailure: () => undefined};

describe("settingsPage", () => {
    it("load 交模块（动态导入的写法）或组件本身都行；页面收到 context 与补的属性", async () => {
        for (const load of [async () => ({default: Page}), async () => Page]) {
            const component = await settingsPage(load, () => ({label: "片段"})).load();
            const wrapper = mount(component, {props: {context}});
            expect(wrapper.get("[data-page]").attributes("data-page")).toBe("x.notes.page");
            expect(wrapper.text()).toBe("片段");
            wrapper.unmount();
        }
    });

    it("补的属性在渲染时求值：读响应式的值，页面随之更新", async () => {
        const label = ref("用户");
        const component = await settingsPage(async () => Page, () => ({label: label.value})).load();
        const wrapper = mount(component, {props: {context}});
        expect(wrapper.text()).toBe("用户");
        label.value = "本作品";
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toBe("本作品");
        wrapper.unmount();
    });
});
