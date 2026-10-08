/**
 * `nbook.workbench` 浏览器入口：提供窗口挂载的页面表，定义页面贡献点 `workbench.pages` 与视图贡献点 `workbench.views`；
 * 向命令系统贡献面板入口命令、切换主题与明暗的命令、五条面板命令，向其它插件提供选择服务（命令面板的选择模式），
 * 公开外壳的布局状态（`state.public`）；`/` 页挂着命令宿主（命令面板与浏览器键位分发）与文档根的设置（界面语言、
 * 产品主题）。布局 store 在外壳页面第一次挂载时才创建（`state/layout-host.ts`）；视图注册表在激活时就建立，接收者从
 * 第一刻起记下交付的句柄（`views/registry.ts`）。
 */

import {computed, defineAsyncComponent, h, watch} from "vue";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry, provide} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {COMMANDS_POINT, commandServiceKey} from "nbook/plugins/commands/shared/contracts";
import {PUBLIC_STATE_POINT} from "nbook/plugins/state/shared/contracts";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {bindingsOf} from "nbook/shared/store/public";
import {displayLocale, settingsKey} from "nbook/plugins/settings/shared/contracts";
import {windowPluginsKey} from "nbook/shared/host";
import {windowProjectKey} from "nbook/shared/projects";

import {descriptor} from "../plugin";
import {OPEN_COMMANDS_DECLARATION, OPEN_COMMANDS_ID, PaletteSlot} from "./commands/open-commands";
import {SWITCH_APPEARANCE_COMMAND, SWITCH_APPEARANCE_DECLARATION, SWITCH_THEME_COMMAND, SWITCH_THEME_DECLARATION, themeCommands} from "./commands/theme-commands";
import type {PaletteHost} from "./commands/palette-host";
import {PANEL_COMMAND_DECLARATIONS, panelCommands} from "./commands/panel-commands";
import {VIEW_COMMAND_DECLARATIONS, viewCommands} from "./commands/view-commands";
import {appearanceSetting, quickPickKey, themeSetting, WORKBENCH_PAGES_POINT} from "../shared/contracts";
import {validateViewContribution, WORKBENCH_VIEWS_POINT} from "../shared/views";
import type {ViewDeclaration} from "../shared/views";
import {workbenchRootKey} from "./contracts";
import {createHomePage} from "./home-page";
import {PageTable, validatePageContribution} from "./pages";
import {createLayoutHost} from "./state/layout-host";
import {layoutStoreFor} from "./state/layout-store";
import {workbenchState, workbenchStateBindings} from "./state/public-state";
import {ViewRegistry} from "./views/registry";

const CommandHost = defineAsyncComponent(() => import("./commands/WorkbenchCommandHost.vue"));
const WorkbenchDocument = defineAsyncComponent(() => import("./document/WorkbenchDocument.vue"));
const WorkbenchShell = defineAsyncComponent(() => import("./components/WorkbenchShell.vue"));

export const workbenchBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    contributionPoints: [
        {id: WORKBENCH_PAGES_POINT, implementation: "required", validate: validatePageContribution},
        {id: WORKBENCH_VIEWS_POINT, implementation: "required", validate: validateViewContribution},
    ],
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        dependencies: [{key: diagnosticsKey}, {key: commandServiceKey}, {key: windowProjectKey}, {key: settingsKey}, {key: storageKey}, {key: windowPluginsKey, required: false}],
        provides: [workbenchRootKey, quickPickKey],
        receives: [WORKBENCH_PAGES_POINT, WORKBENCH_VIEWS_POINT],
        contributions: [
            {capability: COMMANDS_POINT, id: OPEN_COMMANDS_ID, declaration: OPEN_COMMANDS_DECLARATION},
            {capability: COMMANDS_POINT, id: SWITCH_THEME_COMMAND, declaration: SWITCH_THEME_DECLARATION},
            {capability: COMMANDS_POINT, id: SWITCH_APPEARANCE_COMMAND, declaration: SWITCH_APPEARANCE_DECLARATION},
            ...Object.entries(PANEL_COMMAND_DECLARATIONS).map(([id, declaration]) => ({capability: COMMANDS_POINT, id, declaration})),
            ...Object.entries(VIEW_COMMAND_DECLARATIONS).map(([id, declaration]) => ({capability: COMMANDS_POINT, id, declaration})),
            ...workbenchState.contributions,
        ],
        activate: async (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const commands = context.services.require(commandServiceKey);
            const palettes = new PaletteSlot();
            const report = (error: Error): void => {
                diagnostics.record({level: "warn", event: "workbench.commands", message: error.message, source: {plugin: descriptor.id}});
            };
            const project = context.services.require(windowProjectKey).project;
            const storage = context.services.require(storageKey);
            const plugins = await context.services.resolve(windowPluginsKey);
            const views = new ViewRegistry(context.declarations.list<ViewDeclaration>(WORKBENCH_VIEWS_POINT), plugins.status === "resolved" ? plugins.instance : null, context.signal);
            const layout = createLayoutHost(() => {
                const store = layoutStoreFor(project !== null).create(context, {storage, diagnostics});
                store.actions.acceptViewCatalog(views.catalog);
                // 落位与呈现的诊断（未知引用、默认位置已变、起源声明不在）：同一条只记一次。
                const recorded = new Set<string>();
                const stop = watch(() => [...store.state.presentation.diagnostics, ...store.state.patchProblems], (lines) => {
                    for (const line of lines) {
                        if (recorded.has(line)) continue;
                        recorded.add(line);
                        diagnostics.record({level: "warn", event: "workbench.views.placement", message: line, source: {plugin: descriptor.id}});
                    }
                }, {immediate: true});
                context.signal.addEventListener("abort", () => stop(), {once: true});
                return store;
            });
            const publicState = bindingsOf(workbenchState, workbenchStateBindings(layout.current));
            const settings = context.services.require(settingsKey);
            const locale = computed(() => displayLocale(settings));
            const theme = computed(() => settings.get(themeSetting));
            const appearance = computed(() => settings.get(appearanceSetting));
            const home = createHomePage({
                shell: WorkbenchShell,
                renderDocument: () => h(WorkbenchDocument, {locale, theme, appearance}),
                renderCommandHost: () => h(CommandHost, {commands, report, locale, attach: (host: PaletteHost) => palettes.attach(host)}),
                layout,
                commands,
                views,
                projectName: project?.name ?? null,
                locale,
            });
            const pages = new PageTable([{path: "/", title: "NeuroBook", load: async () => home}]);
            return {
                services: [provide(workbenchRootKey, {pages: () => pages.list()}), provide(quickPickKey, palettes.quickPick)],
                receivers: {[WORKBENCH_PAGES_POINT]: pages.receiver(), [WORKBENCH_VIEWS_POINT]: views.receiver()},
                contributions: {
                    [COMMANDS_POINT]: {[OPEN_COMMANDS_ID]: palettes.command, ...themeCommands(settings, palettes.quickPick), ...panelCommands(() => layout.current.value, palettes.quickPick), ...viewCommands(() => layout.current.value, palettes.quickPick)},
                    [PUBLIC_STATE_POINT]: Object.fromEntries(publicState.bindings),
                },
            };
        },
    })],
};
