/**
 * Profile 设置页的表情包列表（docs/specs/agent/stickers.md 输出 19）：第一次用到时订阅 `nbook.stickers` 的目录变化并取概要。
 * 没装表情包插件时取不到，列表一直是 null，设置页不画这一节。
 */

import {shallowRef} from "vue";
import type {ShallowRef} from "vue";

import type {RemoteClient} from "@notnotype/nb-runtime/remote";

import type {StickerPackSummary, stickersCatalogContract} from "nbook/plugins/stickers/shared/contracts";

export interface StickerPacksClient {
    /** null 是还没取到或取不到。 */
    readonly entries: ShallowRef<readonly StickerPackSummary[] | null>;
    /** 第一次用到时订阅并取；之后再调不做事。 */
    ensure(): void;
}

export function createStickerPacksClient(remote: RemoteClient<typeof stickersCatalogContract>, signal: AbortSignal, report: (message: string) => void): StickerPacksClient {
    const entries = shallowRef<readonly StickerPackSummary[] | null>(null);
    let started = false;
    const load = async (): Promise<void> => {
        const result = await remote.packs({});
        if (result.ok) entries.value = result.value;
        else report(`sticker packs: ${String(result.code)}`);
    };
    return {
        entries,
        ensure() {
            if (started) return;
            started = true;
            void (async () => {
                const subscription = await remote.events.changed.subscribe({}, () => void load(), {onResync: () => void load()});
                if (!subscription.ok) {
                    report(`sticker packs subscribe: ${String(subscription.code)}`);
                    started = false;
                    return;
                }
                signal.addEventListener("abort", () => subscription.value.release(), {once: true});
                await load();
            })().catch((error: unknown) => report(`sticker packs: ${String(error)}`));
        },
    };
}
