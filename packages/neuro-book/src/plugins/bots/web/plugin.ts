/**
 * `nbook.bots` 的浏览器入口（docs/specs/bots/view.md）：给 `nbook.agent` 的消息视图当归属插件（`agent.sessionOwners`，agent/conversation.md
 * 输出 53）。bot 一页的联系人、打开主对话、记“看到”都经这里；聊天本身是消息视图里的同一个聊天区，档位按会话的归属定。
 *
 * 浏览器入口不接收预设：预设只在服务端核对与使用。缺省预设是描述的顶层贡献，每个运行位置都登记，所以这里同样声明贡献点。
 */

import {computed} from "vue";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {SESSION_OWNERS_POINT} from "nbook/plugins/agent/shared/contracts";
import type {OwnerContactsState, SessionOwnerProvider} from "nbook/plugins/agent/shared/contracts";

import {descriptor} from "../plugin";
import {avatarUrl, botsContract, mainSessionId, presetsPoint} from "../shared/contracts";
import {createBotsStore} from "./store";

const OWNER_CONTRIBUTION = "nbook.bots.main";

export const botsBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    contributionPoints: [presetsPoint],
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        activationEvents: ["onStartup"],
        dependencies: [{key: diagnosticsKey}],
        contributions: [
            {capability: SESSION_OWNERS_POINT, id: OWNER_CONTRIBUTION, declaration: {}},
        ],
        activate: (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const report = (code: string, message: string): void => {
                diagnostics.record({level: "warn", event: `bots.${code}`, message, source: {plugin: descriptor.id}});
            };
            // 入口启动即订阅：消息视图没打开时，入口角标与状态栏的未读照样更新。
            const store = createBotsStore({bots: context.remote.use(botsContract), report, signal: context.signal});
            const provider: SessionOwnerProvider = {
                contacts: computed(() => store.items.value.map((item) => ({
                    id: item.id,
                    name: item.name,
                    avatar: avatarUrl(item.id),
                    unread: item.unread,
                    last: item.last,
                    // 主对话的 id 是定的；还没建（`none`）时没有会话可开、没有活动可对。
                    sessionId: item.main.state === "none" ? null : mainSessionId(item.id),
                }))),
                state: computed((): OwnerContactsState => store.listState.value),
                reload: () => store.reload(),
                open: (id) => store.ensureMain(id),
                seen: (id, seq) => store.markSeen(id, seq),
            };
            return {contributions: {[SESSION_OWNERS_POINT]: {[OWNER_CONTRIBUTION]: provider}}};
        },
    })],
};
