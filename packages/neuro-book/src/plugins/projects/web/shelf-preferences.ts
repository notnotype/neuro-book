/**
 * 书架的视图与排序偏好（docs/specs/workbench/bookshelf.md 输出 3 与“副作用与数据”）：user/local 记录，每个客户端一份。
 * 保存暂停（确定失败、结果未知）期间只改显示并记下最后一份，恢复后再提交。
 */

import {Type} from "typebox";

import {defineRecord} from "nbook/shared/storage";
import {defineStore} from "nbook/shared/store/store";
import type {PersistedField} from "nbook/shared/store/store";

import type {ShelfSort} from "./shelf-format";

export type ShelfView = "spines" | "list";

export interface ShelfPreferences {
    readonly view: ShelfView;
    readonly sort: ShelfSort;
}

const PreferencesSchema = Type.Object({
    view: Type.Union([Type.Literal("spines"), Type.Literal("list")]),
    sort: Type.Union([Type.Literal("recent"), Type.Literal("title"), Type.Literal("words")]),
}, {additionalProperties: false});

export const SHELF_PREFERENCES_RECORD = defineRecord({key: "projects.shelf-preferences", scope: "user", locality: "local", version: 1, schema: PreferencesSchema});

const DEFAULT_PREFERENCES: ShelfPreferences = {view: "spines", sort: "recent"};

const paused = (field: PersistedField<ShelfPreferences>): boolean => field.save.state === "failed" || field.save.state === "unknown";

export const shelfPreferencesStore = defineStore("projects-shelf", ({persist}) => {
    const preferences = persist(SHELF_PREFERENCES_RECORD, {initial: DEFAULT_PREFERENCES});
    let latest: ShelfPreferences | null = null;
    const commit = (value: ShelfPreferences): void => {
        if (paused(preferences)) {
            preferences.show(value);
            latest = value;
            return;
        }
        latest = null;
        void preferences.commit(() => value);
    };
    return {
        state: {preferences},
        actions: {
            setView: (view: ShelfView): void => commit({...preferences.display, view}),
            setSort: (sort: ShelfSort): void => commit({...preferences.display, sort}),
            /** 重试暂停的保存，然后提交暂停期间记下的最后一份。 */
            retry: async (): Promise<void> => {
                if (preferences.failure !== null) await preferences.reopen();
                if (preferences.failure === null && paused(preferences)) await preferences.retry();
                const pending = latest;
                if (pending !== null && !paused(preferences)) {
                    latest = null;
                    void preferences.commit(() => pending);
                }
            },
        },
    };
});

export type ShelfPreferencesStore = ReturnType<typeof shelfPreferencesStore.create>;
