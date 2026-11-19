/**
 * 按贴纸显示的偏好（docs/specs/agent/stickers.md 输出 47）：哪些表情包的表情在文字里也显示成大图。存在 `nbook.stickers` 的一条
 * user/shared 记录里，跟着用户走（开发者 2026-11-19 定，w00050 t11 决定 8），不写进表情包的清单：内置与插件的包也能设。
 *
 * 记录按表情包 id 存；改包名、删了重建的包 id 变了，偏好不跟着走（Spec 的“不承诺”）。每次写入时按当前目录剪掉已经不在的 id，
 * 免得失效的 id 累积到上限。记录读不到、坏了时当作空的；保存暂停（确定失败、结果未知）期间只改显示，不重试也不提示（同 `recent.ts`）。
 */

import {shallowRef} from "vue";
import {Type} from "typebox";

import {defineRecord} from "nbook/shared/storage";
import {defineStore} from "nbook/shared/store/store";

import type {StickerDisplayService} from "../shared/contracts";

/** 记录里至多这么多个包。 */
export const DISPLAY_PACKS_MAX = 256;

const DisplaySchema = Type.Object({stickerPacks: Type.Array(Type.String({minLength: 1}), {maxItems: DISPLAY_PACKS_MAX})}, {additionalProperties: false});

export const STICKERS_DISPLAY_RECORD = defineRecord({key: "stickers.display", scope: "user", locality: "shared", version: 1, schema: DisplaySchema});

/**
 * 打开或关掉一个包之后的列表：打开的加在末尾（已在的不动），关掉的去掉；`known` 是当前目录里的全部包 id，给了就剪掉不在其中的
 * （目录还没取到时为 null，不剪）。超过上限时丢最早的。
 */
export function nextDisplayPacks(current: readonly string[], id: string, on: boolean, known: ReadonlySet<string> | null): string[] {
    const kept = current.filter((item) => item !== id && (known === null || known.has(item)));
    const next = on ? [...kept, id] : kept;
    return next.slice(Math.max(0, next.length - DISPLAY_PACKS_MAX));
}

export const stickerDisplayStore = defineStore("stickers-display", ({persist}) => {
    const display = persist(STICKERS_DISPLAY_RECORD, {initial: {stickerPacks: []}});
    return {
        state: {display},
        actions: {
            set: (id: string, on: boolean, known: ReadonlySet<string> | null): void => {
                const next = (current: Readonly<{stickerPacks: readonly string[]}>): {stickerPacks: string[]} => ({stickerPacks: nextDisplayPacks(current.stickerPacks, id, on, known)});
                if (display.save.state === "failed" || display.save.state === "unknown") display.show(next(display.display));
                else void display.commit(next);
            },
        },
    };
});

/** 服务：读（在 computed、watch 或渲染里读会跟着变）与设。`known` 交回当前目录里的包 id，目录还没取到时为 null。 */
export function displayService(store: ReturnType<typeof stickerDisplayStore.create>, known: () => ReadonlySet<string> | null): StickerDisplayService {
    return {
        packs: () => store.state.display.display.stickerPacks,
        set: (id, on) => store.actions.set(id, on, known()),
    };
}

/** 没有 Storage 时：只在这次运行里记。 */
export function memoryDisplay(known: () => ReadonlySet<string> | null): StickerDisplayService {
    const packs = shallowRef<readonly string[]>([]);
    return {
        packs: () => packs.value,
        set: (id, on) => {
            packs.value = nextDisplayPacks(packs.value, id, on, known());
        },
    };
}
