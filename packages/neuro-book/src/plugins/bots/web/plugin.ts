/**
 * `nbook.bots` 的浏览器入口（docs/specs/bots/view.md）：左侧栏的 bot 视图（未读数写在面板头的标题后），以及把有归属的主对话从通用的对话视图
 * 转到这里（`agent.sessionOwners`，agent/conversation.md 输出 53）。聊天本身是 `nbook.agent` 交出的固定会话组件。
 *
 * 浏览器入口不接收预设：预设只在服务端核对与使用。缺省预设是描述的顶层贡献，每个运行位置都登记，所以这里同样声明贡献点。
 */

import {markRaw} from "vue";
import type {Component} from "vue";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {agentConversationKey, SESSION_OWNERS_POINT} from "nbook/plugins/agent/shared/contracts";
import type {SessionOwnerOpener} from "nbook/plugins/agent/shared/contracts";
import {commandServiceKey} from "nbook/plugins/commands/shared/contracts";
import {modelsSettingsContract, PROVIDERS_SECTION} from "nbook/plugins/models/shared/contracts";
import {OPEN_SETTINGS_COMMAND} from "nbook/plugins/settings/shared/contracts";
import {OPEN_VIEW_COMMAND, WORKBENCH_VIEWS_POINT} from "nbook/plugins/workbench/shared/contracts";
import type {WrittenViewDeclaration} from "nbook/plugins/workbench/shared/views";
import type {ViewImplementation} from "nbook/plugins/workbench/web/contracts";
import {boundComponent} from "nbook/ui/bound-component";

import {descriptor} from "../plugin";
import {botsContract, presetsPoint} from "../shared/contracts";
import {createBotsStore} from "./store";

/** bot 视图：左侧栏，自己的活动栏图标（不写容器）；标题取约定键 `views.chat.title`。 */
export const BOT_VIEW = "nbook.bots.chat";
const BOT_VIEW_DECLARATION: WrittenViewDeclaration = {icon: "i-lucide-message-circle-heart", location: "sidebar", order: 60, layout: "fill"};
const OWNER_CONTRIBUTION = "nbook.bots.main";

export const botsBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    contributionPoints: [presetsPoint],
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        activationEvents: ["onStartup"],
        dependencies: [{key: diagnosticsKey}, {key: commandServiceKey}, {key: agentConversationKey}],
        contributions: [
            {capability: WORKBENCH_VIEWS_POINT, id: BOT_VIEW, declaration: BOT_VIEW_DECLARATION},
            {capability: SESSION_OWNERS_POINT, id: OWNER_CONTRIBUTION, declaration: {}},
        ],
        activate: (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const commands = context.services.require(commandServiceKey);
            const report = (code: string, message: string): void => {
                diagnostics.record({level: "warn", event: `bots.${code}`, message, source: {plugin: descriptor.id}});
            };
            const reveal = (): void => {
                void commands.execute(OPEN_VIEW_COMMAND, {viewId: BOT_VIEW}).then((opened) => {
                    if (!opened.ok) report("reveal-failed", opened.code);
                });
            };
            const store = createBotsStore({
                bots: context.remote.use(botsContract),
                models: context.remote.use(modelsSettingsContract),
                openProviders: () => void commands.execute(OPEN_SETTINGS_COMMAND, {section: PROVIDERS_SECTION, focus: "add", layer: "user"}),
                report,
                signal: context.signal,
            });
            const conversation = markRaw(context.services.require(agentConversationKey).FixedConversation as Component);
            const view: ViewImplementation = {
                ...boundComponent("BotChatView", () => import("./BotChatView.vue"), () => ({store, conversation})),
                // 缺省 bot 的未读数（bots/view.md 输出 1）：0 与还没数完都不显示。
                badge: () => store.items.value[0]?.unread ?? null,
            };
            // 第一版只有一个 bot：不论哪个 bot 的主对话，都揭示这个视图。
            const opener: SessionOwnerOpener = {open: () => reveal()};
            return {contributions: {
                [WORKBENCH_VIEWS_POINT]: {[BOT_VIEW]: view},
                [SESSION_OWNERS_POINT]: {[OWNER_CONTRIBUTION]: opener},
            }};
        },
    })],
};
