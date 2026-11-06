/**
 * 主题编辑器的 Lab 场景用的“我的主题”：内存里的一份，形状同产品里 Storage 记录的投影（`UserThemesStore`），模型只读它的显示值、调它的
 * 三个动作。没有真实的 Storage，所以保存状态永远是空闲；场景里的修改只在这一页里有效，刷新就没有了。
 */

import {reactive} from "vue";

import type {UserTheme} from "nbook/plugins/workbench/shared/user-themes";
import type {UserThemesStore} from "nbook/plugins/workbench/web/user-themes-store";

export function createLabUserThemes(initial: ReadonlyArray<UserTheme>, ready = true): UserThemesStore {
    const state = reactive({themes: {display: {themes: structuredClone([...initial]) as UserTheme[]}, ready, failure: null as string | null, queue: 0, base: null, save: {state: "idle" as const}, canSave: true}});
    const actions = {
        create: async (theme: UserTheme): Promise<void> => {
            if (!state.themes.display.themes.some((candidate) => candidate.id === theme.id)) state.themes.display.themes.push(structuredClone(theme));
        },
        update: async (id: string, change: (theme: UserTheme) => UserTheme): Promise<void> => {
            const index = state.themes.display.themes.findIndex((theme) => theme.id === id);
            const current = state.themes.display.themes[index];
            if (current !== undefined) state.themes.display.themes[index] = change(structuredClone(current));
        },
        remove: async (id: string): Promise<void> => {
            state.themes.display.themes = state.themes.display.themes.filter((theme) => theme.id !== id);
        },
        adoptConfirmed: (): void => undefined,
    };
    return {state, actions, contributions: {}} as unknown as UserThemesStore;
}
