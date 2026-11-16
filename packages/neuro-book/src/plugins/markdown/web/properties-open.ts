/**
 * 属性面板的展开状态（docs/specs/workbench/markdown-editing.md 输出 41 与“副作用与数据”）：按作品记在本机的项目分区记录
 * `markdown.properties-open`，只记展开着的文件地址，最近展开的在前，至多 200 个；收起即去掉。缺省收起，所以没记的就是收起。
 * 不是设置：设置的作品层会进 Git，这只是个人的显示偏好（同 `editor.comment-margin`）。记录读不出、坏了时按收起，这时切换不记
 * （存储不覆盖读不出的记录）；保存暂停（失败、结果未知）期间只改显示，不重试也不提示。提交按当前值改这一个文件，几个窗口各改
 * 各的文件不互相覆盖。
 */

import {ref} from "@vue/reactivity";
import {inject} from "vue";
import type {InjectionKey} from "vue";
import {Type} from "typebox";

import {defineRecord} from "nbook/shared/storage";
import {fieldProblem} from "nbook/shared/store/problem";
import {defineStore} from "nbook/shared/store/store";

export const PROPERTIES_OPEN_LIMIT = 200;

export const MARKDOWN_PROPERTIES_OPEN_RECORD = defineRecord({
    key: "markdown.properties-open",
    scope: "project",
    locality: "local",
    version: 1,
    schema: Type.Object({open: Type.Array(Type.String(), {maxItems: PROPERTIES_OPEN_LIMIT})}, {additionalProperties: false}),
});

/** 改一个文件之后的列表：展开的挪到最前（多出的去掉最旧的），收起的去掉。 */
export function nextOpen(current: readonly string[], address: string, open: boolean): string[] {
    const rest = current.filter((item) => item !== address);
    return open ? [address, ...rest].slice(0, PROPERTIES_OPEN_LIMIT) : rest;
}

export const propertiesOpenStore = defineStore("markdown-properties-open", ({persist}) => {
    const files = persist(MARKDOWN_PROPERTIES_OPEN_RECORD, {initial: {open: []}});
    return {
        state: {files},
        actions: {
            set: (address: string, open: boolean): void => {
                const next = (value: Readonly<{open: readonly string[]}>): {open: string[]} => ({open: nextOpen(value.open, address, open)});
                // 读不出、记录坏了（存储不覆盖它，提交会被挡下、显示退回）或保存暂停时：只改这次运行里的显示，展开与收起照样起作用。
                if (fieldProblem(files) !== null) files.show(next(files.display));
                else void files.commit(next);
            },
        },
    };
});

/** Markdown 控件用的端口：这个文件展开着没有（在 computed 或渲染里读会跟着变）与改它。 */
export interface PropertiesOpen {
    isOpen(address: string): boolean;
    set(address: string, open: boolean): void;
}

export const markdownPropertiesOpenKey: InjectionKey<PropertiesOpen> = Symbol("nbook.markdown/properties-open");

export function propertiesOpenPort(store: ReturnType<typeof propertiesOpenStore.create>): PropertiesOpen {
    return {
        isOpen: (address) => store.state.files.display.open.includes(address),
        set: (address, open) => store.actions.set(address, open),
    };
}

/** 没有绑定作品（没有项目分区）、或应用没装存储服务时：只在这次运行里记着。 */
export function memoryPropertiesOpen(): PropertiesOpen {
    const open = ref<readonly string[]>([]);
    return {
        isOpen: (address) => open.value.includes(address),
        set: (address, value) => {
            open.value = nextOpen(open.value, address, value);
        },
    };
}

/** 控件里取展开状态。没有注入时（Lab、组件测试）几个控件共用一份内存里的。 */
let unprovided: PropertiesOpen | null = null;
export function usePropertiesOpen(): PropertiesOpen {
    return inject(markdownPropertiesOpenKey, null) ?? (unprovided ??= memoryPropertiesOpen());
}
