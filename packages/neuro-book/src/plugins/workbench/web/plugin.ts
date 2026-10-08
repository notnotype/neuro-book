/**
 * `nbook.workbench` 浏览器入口：提供窗口挂载的页面表，定义页面贡献点 `workbench.pages`；
 * 向命令系统贡献面板入口命令与切换主题、明暗的命令，向其它插件提供选择服务（命令面板的选择模式），`/` 页挂着命令
 * 宿主（命令面板与浏览器键位分发）与文档根的设置（界面语言、产品主题）。
 */

import {computed, defineAsyncComponent, h} from "vue";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry, provide} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {COMMANDS_POINT, commandServiceKey} from "nbook/plugins/commands/shared/contracts";
import {displayLocale, settingsKey} from "nbook/plugins/settings/shared/contracts";
import {windowProjectKey} from "nbook/shared/projects";

import {descriptor} from "../plugin";
import {OPEN_COMMANDS_DECLARATION, OPEN_COMMANDS_ID, PaletteSlot} from "./commands/open-commands";
import {SWITCH_APPEARANCE_COMMAND, SWITCH_APPEARANCE_DECLARATION, SWITCH_THEME_COMMAND, SWITCH_THEME_DECLARATION, themeCommands} from "./commands/theme-commands";
import type {PaletteHost} from "./commands/palette-host";
import {appearanceSetting, quickPickKey, themeSetting, WORKBENCH_PAGES_POINT} from "../shared/contracts";
import {workbenchRootKey} from "./contracts";
import {createEmptyWorkbench} from "./empty-workbench";
import {PageTable, validatePageContribution} from "./pages";

const CommandHost = defineAsyncComponent(() => import("./commands/WorkbenchCommandHost.vue"));
const WorkbenchDocument = defineAsyncComponent(() => import("./document/WorkbenchDocument.vue"));

export const workbenchBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    contributionPoints: [{id: WORKBENCH_PAGES_POINT, implementation: "required", validate: validatePageContribution}],
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        dependencies: [{key: diagnosticsKey}, {key: commandServiceKey}, {key: windowProjectKey}, {key: settingsKey}],
        provides: [workbenchRootKey, quickPickKey],
        receives: [WORKBENCH_PAGES_POINT],
        contributions: [
            {capability: COMMANDS_POINT, id: OPEN_COMMANDS_ID, declaration: OPEN_COMMANDS_DECLARATION},
            {capability: COMMANDS_POINT, id: SWITCH_THEME_COMMAND, declaration: SWITCH_THEME_DECLARATION},
            {capability: COMMANDS_POINT, id: SWITCH_APPEARANCE_COMMAND, declaration: SWITCH_APPEARANCE_DECLARATION},
        ],
        activate: (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const commands = context.services.require(commandServiceKey);
            const palettes = new PaletteSlot();
            const report = (error: Error): void => {
                diagnostics.record({level: "warn", event: "workbench.commands", message: error.message, source: {plugin: descriptor.id}});
            };
            const project = context.services.require(windowProjectKey).project;
            const settings = context.services.require(settingsKey);
            const locale = computed(() => displayLocale(settings));
            const theme = computed(() => settings.get(themeSetting));
            const appearance = computed(() => settings.get(appearanceSetting));
            const home = createEmptyWorkbench(() => h(CommandHost, {commands, report, locale, attach: (host: PaletteHost) => palettes.attach(host)}), () => h(WorkbenchDocument, {locale, theme, appearance}), project?.name ?? null, locale);
            const pages = new PageTable([{path: "/", title: "NeuroBook", load: async () => home}]);
            return {
                services: [provide(workbenchRootKey, {pages: () => pages.list()}), provide(quickPickKey, palettes.quickPick)],
                receivers: {[WORKBENCH_PAGES_POINT]: pages.receiver()},
                contributions: {[COMMANDS_POINT]: {[OPEN_COMMANDS_ID]: palettes.command, ...themeCommands(settings, palettes.quickPick)}},
            };
        },
    })],
};
