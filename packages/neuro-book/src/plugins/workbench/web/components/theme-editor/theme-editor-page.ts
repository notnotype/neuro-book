/**
 * 主题编辑器作为编辑区页面与工作台浮层的交付（docs/specs/theme/editor.md 输出 1）：两处放的都是 `ThemeEditorHolder`，经会话共用一份模型。
 * `.vue` 只在 `load()` 里动态导入：插件的合同测试在 bun test 里导入入口文件，bun 不能加载 `.vue`。
 */

import {defineComponent, h} from "vue";
import type {Component} from "vue";

import type {ThemeEntry} from "../../themes";
import type {ThemeEditorSession} from "./theme-editor-session";

export function themeEditorPage(session: ThemeEditorSession, themes: () => ReadonlyArray<ThemeEntry>): {readonly load: () => Promise<Component>} {
    return {
        load: async () => {
            const Holder = (await import("./ThemeEditorHolder.vue")).default;
            return defineComponent({name: "ThemeEditorPage", inheritAttrs: false, setup: () => () => h(Holder, {session, themes: themes(), closable: false})});
        },
    };
}

export function themeEditorOverlay(session: ThemeEditorSession, themes: () => ReadonlyArray<ThemeEntry>): {readonly load: () => Promise<Component>} {
    return {
        load: async () => {
            const Window = (await import("./ThemeEditorWindow.vue")).default;
            return defineComponent({name: "ThemeEditorOverlay", setup: () => () => h(Window, {session, themes})});
        },
    };
}
