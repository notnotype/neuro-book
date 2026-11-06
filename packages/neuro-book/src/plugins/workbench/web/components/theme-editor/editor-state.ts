/**
 * 主题编辑器的编辑状态（选中的主题、明暗、分区）：单独一个只依赖 Vue 的小模块。会话在工作台入口（首屏）里创建、持有它，而模型与
 * 颜色算法只在编辑器打开时才加载，所以它不能放在模型文件里。
 */

import {shallowRef} from "vue";
import type {ShallowRef} from "vue";

export type EditorSection = "basic" | "colors" | "fonts" | "chrome" | "scene" | "icons" | "contrast";
export type Appearance = "light" | "dark";

/** 编辑状态：放在会话里，页签切走再回来时还在（模型随页签卸载，状态不随它丢）。 */
export interface ThemeEditorState {
    readonly section: ShallowRef<EditorSection>;
    readonly appearance: ShallowRef<Appearance>;
    readonly selectedId: ShallowRef<string | null>;
}

export function createEditorState(appearance: Appearance): ThemeEditorState {
    return {section: shallowRef<EditorSection>("basic"), appearance: shallowRef<Appearance>(appearance), selectedId: shallowRef<string | null>(null)};
}
