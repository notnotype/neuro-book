/**
 * 最近用过的表情（docs/specs/agent/stickers.md 输出 43）：`nbook.stickers` 的一条 user/local 记录，这个客户端的编辑器与输入框共用。
 * 记录读不到、坏了时当作空的；保存暂停（确定失败、结果未知）期间只改显示。只是偏好，不重试也不提示（同 Markdown 记住的颜色）。
 */

import {shallowRef} from "vue";
import {Type} from "typebox";

import {defineRecord} from "nbook/shared/storage";
import {defineStore} from "nbook/shared/store/store";

import {RECENT_MAX, withUsed} from "./picker";
import type {RecentEntry} from "./picker";

const EntrySchema = Type.Object({pack: Type.String({minLength: 1}), name: Type.String({minLength: 1})}, {additionalProperties: false});
const RecentSchema = Type.Object({entries: Type.Array(EntrySchema, {maxItems: RECENT_MAX})}, {additionalProperties: false});

export const STICKERS_RECENT_RECORD = defineRecord({key: "stickers.recent", scope: "user", locality: "local", version: 1, schema: RecentSchema});

/** 选择器要的端口：读（在 computed 或渲染里读会跟着变）与记下。 */
export interface RecentStickers {
    entries(): readonly RecentEntry[];
    use(entry: RecentEntry): void;
}

export const recentStickersStore = defineStore("stickers-recent", ({persist}) => {
    const recent = persist(STICKERS_RECENT_RECORD, {initial: {entries: []}});
    return {
        state: {recent},
        actions: {
            use: (entry: RecentEntry): void => {
                const next = (current: Readonly<{entries: readonly RecentEntry[]}>): {entries: RecentEntry[]} => ({entries: withUsed(current.entries, entry)});
                if (recent.save.state === "failed" || recent.save.state === "unknown") recent.show(next(recent.display));
                else void recent.commit(next);
            },
        },
    };
});

export function recentPort(store: ReturnType<typeof recentStickersStore.create>): RecentStickers {
    return {
        entries: () => store.state.recent.display.entries,
        use: (entry) => store.actions.use(entry),
    };
}

/** 没有 Storage 时：只在这次运行里记。 */
export function memoryRecent(): RecentStickers {
    const entries = shallowRef<readonly RecentEntry[]>([]);
    return {
        entries: () => entries.value,
        use: (entry) => {
            entries.value = withUsed(entries.value, entry);
        },
    };
}
