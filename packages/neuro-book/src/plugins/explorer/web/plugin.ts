/**
 * `nbook.explorer` 浏览器入口（docs/specs/workbench/files-explorer.md 的“新应用的插件、命令与界面”）：贡献侧栏视图
 * `nbook.explorer`、资源管理器的命令与公开状态。会话在激活时建立，视图第一次挂上时才打开偏好记录、列出文件，所以
 * 直接打开 Lab 的窗口不读产品偏好、不列目录。
 */

import {computed} from "vue";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {COMMANDS_POINT, commandServiceKey} from "nbook/plugins/commands/shared/contracts";
import {filesKey} from "nbook/plugins/files/shared/contracts";
import {displayLocale, settingsKey} from "nbook/plugins/settings/shared/contracts";
import {PUBLIC_STATE_POINT} from "nbook/plugins/state/shared/contracts";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {WORKBENCH_VIEWS_POINT} from "nbook/plugins/workbench/shared/contracts";
import type {ViewDeclaration} from "nbook/plugins/workbench/shared/contracts";
import type {ViewImplementation} from "nbook/plugins/workbench/web/contracts";
import {windowProjectKey} from "nbook/shared/projects";
import {bindingsOf} from "nbook/shared/store/public";

import {descriptor} from "../plugin";
import {EXPLORER_COMMAND_DECLARATIONS, explorerCommands} from "./commands";
import {explorerLocalized} from "./messages";
import {explorerStoreFor} from "./preferences";
import {createExplorerSession} from "./session";
import {explorerState, explorerStateValues} from "./state";
import {createExplorerViewHost} from "./view-host";

export const EXPLORER_VIEW_ID = "nbook.explorer";

const VIEW: ViewDeclaration = {title: explorerLocalized("title"), icon: "i-lucide-files", location: "sidebar", order: 0, layout: "fill"};

export const explorerBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        activationEvents: ["onStartup"],
        dependencies: [{key: diagnosticsKey}, {key: filesKey}, {key: commandServiceKey}, {key: storageKey}, {key: windowProjectKey}, {key: settingsKey}],
        contributions: [
            {capability: WORKBENCH_VIEWS_POINT, id: EXPLORER_VIEW_ID, declaration: VIEW},
            ...Object.entries(EXPLORER_COMMAND_DECLARATIONS).map(([id, declaration]) => ({capability: COMMANDS_POINT, id, declaration})),
            ...explorerState.contributions,
        ],
        activate: (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const commands = context.services.require(commandServiceKey);
            const storage = context.services.require(storageKey);
            const settings = context.services.require(settingsKey);
            const bound = context.services.require(windowProjectKey).project !== null;
            const locale = computed(() => displayLocale(settings));
            const report = (error: unknown): void => {
                diagnostics.record({level: "error", event: "explorer.error", message: error instanceof Error ? error.message : String(error), error, source: {plugin: descriptor.id}});
            };
            const session = createExplorerSession({
                files: context.services.require(filesKey),
                commands,
                bound,
                createStore: () => explorerStoreFor(bound).create(context, {storage, diagnostics}),
                report,
            });
            context.signal.addEventListener("abort", () => session.dispose(), {once: true});
            const view: ViewImplementation = {
                load: async () => createExplorerViewHost((await import("./components/FilesExplorerView.vue")).default, {
                    session,
                    commands,
                    locale,
                    report: (id, reason) => diagnostics.record({level: "warn", event: "explorer.command", message: `${id} 执行失败：${reason}`, source: {plugin: descriptor.id}}),
                }),
            };
            const published = bindingsOf(explorerState, explorerStateValues(session.controller));
            return {
                contributions: {
                    [WORKBENCH_VIEWS_POINT]: {[EXPLORER_VIEW_ID]: view},
                    [COMMANDS_POINT]: explorerCommands(session, () => locale.value),
                    [PUBLIC_STATE_POINT]: Object.fromEntries(published.bindings),
                },
            };
        },
    })],
};
