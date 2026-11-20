/**
 * 服务商图标的取法：登记表在 `files.ts`，文件地址表 `urls.ts` 按需动态导入（不进首屏包）。
 *
 * 取图是同步的：地址表还没到时返回 null，调用方先画首字母块；到了之后 `providerIcon` 读的 `urls` 是响应式的，
 * 在渲染里调用的组件会自动重画（表晚到时首字母换成图标，由 nb-agent-ui 的图标解析端口在渲染时调用保证）。
 */

import {shallowRef} from "vue";

import {PROVIDER_ICON_FILES} from "./files";
import type {ProviderIconKind} from "./files";

export type {ProviderIconKind} from "./files";
export {PROVIDER_ICON_FILES} from "./files";

export type ResolvedProviderIcon = {readonly kind: ProviderIconKind; readonly src: string};

const urls = shallowRef<Readonly<Record<string, string>> | null>(null);
let loading: Promise<void> | null = null;

/** 开始加载地址表（只加载一次）；加载失败时保持首字母块，下次取图再试。 */
function ensureLoaded(): void {
    if (urls.value !== null || loading !== null) return;
    loading = import("./urls").then((module) => {
        urls.value = module.ICON_URLS;
    }, (error: unknown) => {
        console.error("provider icons: the icon table failed to load; initials are shown instead", error);
    }).finally(() => {
        loading = null;
    });
}

/** 这个服务商（目录 id 或模板 id）的图标；没登记，或地址表还没到，返回 null。 */
export function providerIcon(id: string): ResolvedProviderIcon | null {
    const entry = PROVIDER_ICON_FILES[id];
    if (entry === undefined) return null;
    ensureLoaded();
    const src = urls.value?.[entry.file];
    return src === undefined ? null : {kind: entry.kind, src};
}
