/**
 * `nbook.stickers` 的浏览器入口（docs/specs/agent/stickers.md 输出 10、18）：先订阅目录变化再取目录，交出按写法查表情的服务，
 * `nbook.markdown` 把它作为 nb-markdown 的宿主端口交给展示器与编辑器。
 */

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry, provideService} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {stickerAllowlistUsageKey} from "nbook/plugins/agent/shared/contracts";
import {displayLocale, SETTINGS_PAGES_POINT, settingsKey} from "nbook/plugins/settings/shared/contracts";
import type {WrittenSettingsPageDeclaration} from "nbook/plugins/settings/shared/sections";
import {notificationsKey} from "nbook/plugins/workbench/shared/contracts";
import {boundText} from "nbook/shared/use-plugin-text";
import {windowTextKey, windowTextPort} from "nbook/shared/window-text";
import {settingsPage} from "nbook/ui/settings/settings-page";

import type zhCN from "../locales/zh-CN.json";
import {descriptor} from "../plugin";
import {stickerResolverKey, stickersCatalogContract} from "../shared/contracts";
import {STICKERS_TEXT_NAMESPACE, stickersText} from "../shared/text";
import {createStickersHttp} from "./http";
import {createStickerDirectory} from "./resolver";

/** 设置窗口里的“表情包”分区（docs/specs/agent/stickers.md 输出 25）：分类 `ai`，排在 Skill 之后，只有用户层。 */
export const PACKS_SECTION = "nbook.stickers.packs";
const PACKS_PAGE: WrittenSettingsPageDeclaration = {icon: "i-lucide-sticker", category: "ai", order: 32, layers: ["user"], layout: "fill", description: stickersText("settingsPages.packs.description")};

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
    }), defineEntry({
        // 只给设置页用的入口：对 Agent 提供的服务键做可选依赖。服务依赖按入口算，所以它不会与上面入口提供给 Markdown 的 `stickerResolverKey`
        // 成环（Agent 入口依赖 Markdown，Markdown 依赖上面的入口）。
        id: "page",
        location: "browser",
        activationEvents: ["onStartup"],
        dependencies: [{key: diagnosticsKey}, {key: settingsKey}, {key: notificationsKey}, {key: windowTextKey, required: false}, {key: stickerAllowlistUsageKey, required: false}],
        contributions: [{capability: SETTINGS_PAGES_POINT, id: PACKS_SECTION, declaration: PACKS_PAGE}],
        activate: async (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const settings = context.services.require(settingsKey);
            const notifications = context.services.require(notificationsKey);
            const port = await windowTextPort(context.services, () => displayLocale(settings));
            const remote = context.remote.use(stickersCatalogContract);
            const http = createStickersHttp();
            const t = boundText<typeof zhCN>(port, STICKERS_TEXT_NAMESPACE);
            return {
                contributions: {
                    [SETTINGS_PAGES_POINT]: {[PACKS_SECTION]: settingsPage(async () => {
                        const [{stickersPage}, {default: page}] = await Promise.all([import("./page-host"), import("./components/StickerPacksPage.vue")]);
                        return stickersPage(page, {
                            remote,
                            http,
                            t,
                            notify: (input) => void notifications.notify(input),
                            // 第一次用到时才解析 Agent 一侧的服务：设置页分区不等 Agent 入口激活；解析不到（Agent 入口起不来）交回 null，
                            // 改名对话框写通用提醒。
                            allowlistUsage: async (id: string) => {
                                const usage = await context.services.resolve(stickerAllowlistUsageKey);
                                return usage.status === "resolved" ? usage.instance.profilesUsing(id) : null;
                            },
                            report: (code, message) => diagnostics.record({level: "warn", event: `stickers.${code}`, message, source: {plugin: descriptor.id}}),
                        });
                    })},
                },
            };
        },
    })],
};
