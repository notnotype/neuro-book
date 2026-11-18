/**
 * `nbook.stickers` 的浏览器入口（docs/specs/agent/stickers.md 输出 10、18）：先订阅目录变化再取目录，交出按写法查表情的服务，
 * `nbook.markdown` 把它作为 nb-markdown 的宿主端口交给展示器与编辑器。
 */

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry, provideService} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {descriptor} from "../plugin";
import {stickerResolverKey, stickersCatalogContract} from "../shared/contracts";
import {createStickerDirectory} from "./resolver";

export const stickersBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        activationEvents: ["onStartup"],
        dependencies: [{key: diagnosticsKey}],
        provides: [stickerResolverKey],
        activate: (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const report = (message: string): void => {
                diagnostics.record({level: "warn", event: "stickers.catalog-unavailable", message, source: {plugin: descriptor.id}});
            };
            const directory = createStickerDirectory();
            const remote = context.remote.use(stickersCatalogContract);
            const load = async (): Promise<void> => {
                const result = await remote.catalog({});
                if (result.ok) directory.set(result.value);
                else {
                    report(`取不到表情目录：${String(result.code)}`);
                    directory.failed();
                }
            };
            // 不等目录：查询自己等它到。窗口启动时恢复的对话与编辑器标签先显示占位（输出 10 与“时序与寿命”）。
            void (async () => {
                const subscription = await remote.events.changed.subscribe({}, () => void load(), {onResync: () => void load()});
                if (!subscription.ok) report(`订阅不了表情目录的变化：${String(subscription.code)}`);
                else context.signal.addEventListener("abort", () => subscription.value.release(), {once: true});
                await load();
            })().catch((error: unknown) => {
                report(`取不到表情目录：${String(error)}`);
                directory.failed();
            });
            return {services: [provideService(stickerResolverKey, directory.resolve)]};
        },
    })],
};
