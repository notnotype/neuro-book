/**
 * 文字颜色与高亮上次用过的颜色（docs/specs/workbench/markdown-editing.md 输出 1、6 与“副作用与数据”）：`nbook.markdown` 的一条
 * user/local 记录，同一客户端的所有作品共用。记录读不到、坏了时用缺省（红色文字、黄色高亮）；保存暂停（确定失败、结果未知）
 * 期间只改显示。这只是偏好，不是要用户处理的数据，不重试也不提示。
 */

import {inject, reactive} from "vue";
import type {InjectionKey} from "vue";
import {Type} from "typebox";

import {defineRecord} from "nbook/shared/storage";
import {defineStore} from "nbook/shared/store/store";

import {HIGHLIGHT_COLORS, TEXT_COLORS} from "./components/menus/palette";

export type ColorAction = "text-color" | "highlight";

// 只认色板会写的写法（小写的 `#rrggbb`）：外部改坏的值由 Storage 判为损坏，显示退回缺省。
const Color = Type.String({pattern: "^#[0-9a-f]{6}$"});
const ColorsSchema = Type.Object({text: Type.Optional(Color), highlight: Type.Optional(Color)}, {additionalProperties: false});
type Colors = {text?: string; highlight?: string};

export const MARKDOWN_COLORS_RECORD = defineRecord({key: "markdown.colors", scope: "user", locality: "local", version: 1, schema: ColorsSchema});

const color = (palette: typeof TEXT_COLORS, id: string): string => {
    const found = palette.find((entry) => entry.id === id);
    if (found === undefined) throw new Error(`palette has no ${id}`);
    return found.value;
};

/** 第一次用时的颜色。 */
export const DEFAULT_COLORS: Readonly<Record<ColorAction, string>> = {"text-color": color(TEXT_COLORS, "red"), highlight: color(HIGHLIGHT_COLORS, "yellow")};

const FIELD: Readonly<Record<ColorAction, keyof Colors>> = {"text-color": "text", highlight: "highlight"};

/** 颜色按钮要的端口：上次的颜色（在 computed 或渲染里读会跟着变）与记下。 */
export interface MarkdownColors {
    last(action: ColorAction): string;
    remember(action: ColorAction, value: string): void;
}

export const markdownColorsKey: InjectionKey<MarkdownColors> = Symbol("nbook.markdown/colors");

export const markdownColorsStore = defineStore("markdown-colors", ({persist}) => {
    const colors = persist(MARKDOWN_COLORS_RECORD, {initial: {}});
    return {
        state: {colors},
        actions: {
            remember: (action: ColorAction, value: string): void => {
                const next = (current: Readonly<Colors>): Colors => ({...current, [FIELD[action]]: value});
                if (colors.save.state === "failed" || colors.save.state === "unknown") colors.show(next(colors.display));
                else void colors.commit(next);
            },
        },
    };
});

export function colorsPort(store: ReturnType<typeof markdownColorsStore.create>): MarkdownColors {
    return {
        last: (action) => store.state.colors.display[FIELD[action]] ?? DEFAULT_COLORS[action],
        remember: (action, value) => store.actions.remember(action, value),
    };
}

/** 没有 Storage（应用没装它）或没有注入（组件测试、Lab）时：只在内存里记，刷新后回到缺省。 */
export function memoryColors(): MarkdownColors {
    const colors = reactive<Colors>({});
    return {
        last: (action) => colors[FIELD[action]] ?? DEFAULT_COLORS[action],
        remember: (action, value) => {
            colors[FIELD[action]] = value;
        },
    };
}

/** 组件里取记住的颜色。没有注入时几处共用一份内存里的，工具栏与选区菜单仍记同一个颜色。 */
let unprovided: MarkdownColors | null = null;
export function useMarkdownColors(): MarkdownColors {
    return inject(markdownColorsKey, null) ?? (unprovided ??= memoryColors());
}
