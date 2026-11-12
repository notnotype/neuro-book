/**
 * 批注页边的开关（docs/specs/workbench/markdown-editing.md 输出 33）：按作品记在本机的项目分区记录 `editor.comment-margin`，缺省关。
 * 不是设置：设置的作品层文件可以进 Git，第二个人打开同一作品页边就开着，项目层还会盖住用户层；这只是个人的显示偏好，同
 * `editor.tabs`、`editor.recent` 放在本机。记录读不出、坏了时按关，这时切换不记（存储不覆盖读不出的记录）；保存暂停（失败、
 * 结果未知）期间只改显示，不重试也不提示。
 */

import {computed, ref} from "@vue/reactivity";
import type {Ref} from "@vue/reactivity";
import {Type} from "typebox";

import {defineRecord} from "nbook/shared/storage";
import {defineStore} from "nbook/shared/store/store";

export const EDITOR_COMMENT_MARGIN_RECORD = defineRecord({
    key: "editor.comment-margin",
    scope: "project",
    locality: "local",
    version: 1,
    schema: Type.Object({on: Type.Boolean()}, {additionalProperties: false}),
});

export const commentMarginStore = defineStore("editor-comment-margin", ({persist}) => {
    const margin = persist(EDITOR_COMMENT_MARGIN_RECORD, {initial: {on: false}});
    return {
        state: {margin},
        actions: {
            toggle: (): void => {
                const next = (value: Readonly<{on: boolean}>): {on: boolean} => ({on: !value.on});
                if (margin.save.state === "failed" || margin.save.state === "unknown") margin.show(next(margin.display));
                else void margin.commit(next);
            },
        },
    };
});

/** 编辑器区用的端口：开关此刻的值（响应式）与切换。 */
export interface CommentMargin {
    readonly on: Readonly<Ref<boolean>>;
    toggle(): void;
}

export function commentMarginOf(store: ReturnType<typeof commentMarginStore.create>): CommentMargin {
    return {on: computed(() => store.state.margin.display.on), toggle: () => store.actions.toggle()};
}

/** 没有绑定作品（没有项目分区）时：只在这次运行里记着。 */
export function memoryCommentMargin(): CommentMargin {
    const on = ref(false);
    return {on, toggle: () => {
        on.value = !on.value;
    }};
}
