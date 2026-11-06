/**
 * EditorGroupHead（同名 .md）的组顶部提示（docs/specs/workbench/editor.md 输出 61）：编辑器区交出的提示是文字值，组件经窗口的翻译
 * 端口显示，切换显示语言后已显示的提示原地换成新语言。编辑器区是真实的，文件客户端是与真实 Files 对过契约的内存适配器
 * （Lab 的 `memory-files.ts`）；这里不打开文件，只看提示一行。
 */

import {mount} from "@vue/test-utils";
import {nextTick} from "vue";
import {afterEach, describe, expect, it} from "vitest";

import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import {TEXT_PORT_KEY} from "@notnotype/nb-ui/text-port";

import {createMemoryFiles} from "nbook/plugins/lab/web/fixtures/explorer-scene/memory-files";
import {createMemoryEditorPanels} from "nbook/plugins/workbench/shared/editor-panels";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import {editorText} from "../../shared/text";
import {createEditorArea} from "../area";
import {editorCatalogs} from "../text";
import EditorGroupHead from "./EditorGroupHead.vue";

const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function mounted() {
    const memory = createMemoryFiles({project: [], user: []});
    const area = createEditorArea({files: memory.files, clock: systemClock, panels: createMemoryEditorPanels(), workspaceKey: "test", generation: 1, initial: null, report: (error) => {
        throw error;
    }});
    const text = createHostTextEngine({locale: "zh-CN", strict: true});
    text.register("nbook.editor", editorCatalogs.catalogs, editorCatalogs.source);
    const wrapper = mount(EditorGroupHead, {props: {area, groupId: area.groups.activeGroup.value}, attachTo: document.body, global: {provide: {[TEXT_PORT_KEY as symbol]: text.port}}});
    cleanups.push(() => memory.dispose(), () => area.dispose(), () => wrapper.unmount());
    return {area, text, wrapper};
}

describe("EditorGroupHead 的组顶部提示", () => {
    it("提示是文字值：按当前语言显示整句，切换语言后原地换成英文", async () => {
        const {area, text, wrapper} = mounted();
        expect(wrapper.find("[data-editor-notice]").exists()).toBe(false);
        area.notify(editorText("notice.continueOutsideProject", {address: "user://x.md"}));
        await nextTick();
        const notice = wrapper.get("[data-editor-notice]");
        expect(notice.get("span").text()).toBe("不能打开 user://x.md：继续写作只能打开项目里的文件");
        text.setLocale("en-US");
        await nextTick();
        expect(wrapper.get("[data-editor-notice] span").text()).toBe("Cannot open user://x.md: only files in the project can be opened to continue writing");
    });
});
