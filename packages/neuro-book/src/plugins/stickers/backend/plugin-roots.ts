/**
 * 插件经 `stickers.packs` 带来的表情包根（docs/specs/agent/stickers.md 的插件来源与输出 6）：贡献发布时按声明的目录加一个根，
 * 撤回时拿掉。目录经平台的插件包查询取真实路径（只有第三方插件有安装目录）；查询是异步的，每次发布记一个号，查回来时号不是
 * 当前的就不加（做法同 `agent.skills` 的 `plugin-roots.ts`）。
 */

import type {ContributionReceiver} from "@notnotype/nb-runtime/plugins";

import type {PluginPackages} from "nbook/plugin-platform/backend/packages";

import type {StickerPacksDeclaration} from "../shared/contracts";
import type {StickerCatalog} from "./catalog";

export interface PluginPackRootsOptions {
    readonly catalog: StickerCatalog;
    /** 没有平台的插件包查询（只装表情包的测试）时为 null：插件的贡献只写诊断。 */
    readonly packages: PluginPackages | null;
    readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
}

export function pluginPackRoots(options: PluginPackRootsOptions): ContributionReceiver<StickerPacksDeclaration> {
    const live = new Map<string, number>();
    let counter = 0;
    return {
        published: (handle) => {
            const token = (counter += 1);
            live.set(handle.id, token);
            void (async () => {
                const {directory} = handle.declaration;
                const root = options.packages === null ? null : await options.packages.directory(handle.plugin, directory);
                if (live.get(handle.id) !== token) return;
                if (root === null) {
                    options.report("root-unavailable", `${handle.plugin} 的表情包用不了：${directory} 不是插件包里的目录`, {plugin: handle.plugin, contribution: handle.id, directory});
                    return;
                }
                // 号核对与加根之间没有 await：之后到的撤回，它的 removeRoot 一定排在后面。
                await options.catalog.addRoot({key: handle.id, source: "plugin", prefix: handle.plugin, root, watch: false, plugin: {id: handle.plugin, title: options.packages?.title(handle.plugin) ?? null}});
            })().catch((error: unknown) => options.report("root-unavailable", `${handle.plugin} 的表情包用不了`, {plugin: handle.plugin, contribution: handle.id, message: error instanceof Error ? error.message : String(error)}));
        },
        revoke: async (handle) => {
            live.delete(handle.id);
            await options.catalog.removeRoot(handle.id);
        },
    };
}
