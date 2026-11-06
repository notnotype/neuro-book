/**
 * “我的主题”的 store（docs/specs/theme/editor.md）：Storage 用户记录 `user-themes` 在本窗口的投影。编辑器改它，主题目录读它的显示值，
 * 所以改动在保存确认前就已经在预览里（显示是乐观的）。另一个窗口保存的结果由 `watchConfirmed` 采纳。
 */

import type {DeepReadonly} from "@vue/reactivity";

import {defineStore} from "nbook/shared/store/store";

import {USER_THEMES_RECORD} from "../shared/user-themes";
import type {UserTheme, UserThemes} from "../shared/user-themes";

/** 修改拿到的是冻结的值、要返回可写的新值：先深拷贝一份再改。 */
const copyOf = (value: DeepReadonly<UserThemes>): UserThemes => structuredClone(value) as UserThemes;

export const userThemesStore = defineStore("user-themes", ({persist}) => {
    const themes = persist(USER_THEMES_RECORD, {initial: {themes: []}});
    return {
        state: {themes},
        actions: {
            /** 加一套；id 已存在时不加（调用方现生成 uuid，撞上只会是重放）。 */
            create: (theme: UserTheme): Promise<unknown> => themes.commit((value) => (value.themes.some((candidate) => candidate.id === theme.id) ? copyOf(value) : {themes: [...copyOf(value).themes, theme]})),
            /** 改一套；没有这个 id 时不动。 */
            update: (id: string, change: (theme: UserTheme) => UserTheme): Promise<unknown> => themes.commit((value) => ({themes: copyOf(value).themes.map((theme) => (theme.id === id ? change(theme) : theme))})),
            remove: (id: string): Promise<unknown> => themes.commit((value) => ({themes: copyOf(value).themes.filter((theme) => theme.id !== id)})),
            /** 别的窗口保存了新值：没有本窗口排队的修改时采纳它，否则等本窗口的写完再说（不强行改本窗口正在做的事）。 */
            adoptConfirmed: (): void => {
                if (themes.queue === 0) themes.adopt();
            },
        },
    };
});

export type UserThemesStore = ReturnType<typeof userThemesStore.create>;
