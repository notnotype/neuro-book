/**
 * `nbook.workbench` 浏览器入口：提供窗口挂载的页面表（`/` 与 `/workbench`），定义页面贡献点 `workbench.pages`、视图贡献点
 * `workbench.views`、编辑器槽贡献点 `workbench.editor-area`、三个条目贡献点（状态栏、标题栏、活动栏底部）、页面浮层贡献点
 * `workbench.overlays` 与无项目首页贡献点 `workbench.home`；向活动栏底部贡献头像占位；
 * 向命令系统贡献面板入口命令、切换主题与明暗的命令、五条面板命令，向其它插件提供选择服务（命令面板的选择模式），
 * 公开外壳的布局状态（`state.public`）；`/` 页挂着命令宿主（命令面板与浏览器键位分发）与文档根的设置（界面语言、
 * 产品主题）。布局 store 在外壳页面第一次挂载时才创建（`state/layout-host.ts`）；视图注册表在激活时就建立，接收者从
 * 第一刻起记下交付的句柄（`views/registry.ts`）。
 */

import {computed, defineAsyncComponent, h, watch} from "vue";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry, provideService} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {COMMANDS_POINT, commandServiceKey, currentKeyPlatform, menuImplementations, MenuItemRegistry} from "nbook/plugins/commands/shared/contracts";
import {PUBLIC_STATE_POINT, publicStateKey} from "nbook/plugins/state/shared/contracts";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {bindingsOf} from "nbook/shared/store/public";
import {windowLocale, windowTextKey, windowTextPort} from "nbook/shared/window-text";
import {displayLocale, settingsKey} from "nbook/plugins/settings/shared/contracts";
import {windowNavigationKey, windowPluginsKey} from "nbook/shared/host";
import {windowProjectKey} from "nbook/shared/projects";

import {descriptor} from "../plugin";
import {OPEN_COMMANDS_DECLARATION, OPEN_COMMANDS_ID, PaletteSlot} from "./commands/open-commands";
import {SWITCH_APPEARANCE_COMMAND, SWITCH_APPEARANCE_DECLARATION, SWITCH_THEME_COMMAND, SWITCH_THEME_DECLARATION, themeCommands} from "./commands/theme-commands";
import type {PaletteHost} from "./commands/palette-host";
import {APP_COMMAND_DECLARATIONS, appCommands} from "./commands/app-commands";
import {PANEL_COMMAND_DECLARATIONS, panelCommands} from "./commands/panel-commands";
import {PART_COMMAND_DECLARATIONS, partCommands} from "./commands/part-commands";
import {VIEW_COMMAND_DECLARATIONS, viewCommands} from "./commands/view-commands";
import {appearanceSetting, notificationsKey, quickPickKey, themeSetting, WORKBENCH_EDITOR_AREA_POINT, WORKBENCH_PAGES_POINT} from "../shared/contracts";
import type {NotificationInput} from "../shared/contracts";
import {completeHomeDeclaration, validateHomeContribution, WORKBENCH_HOME_POINT, WORKBENCH_PATH} from "../shared/home";
import {activityBarItemsPoint, statusbarItemsPoint, titlebarItemsPoint, WORKBENCH_ACTIVITYBAR_ITEMS_POINT, WORKBENCH_STATUSBAR_ITEMS_POINT, WORKBENCH_TITLEBAR_ITEMS_POINT} from "../shared/items";
import type {ActivityBarItemDeclaration, ItemDeclaration} from "../shared/items";
import {titlebarMenuPoint, viewTitlePoint, WORKBENCH_TITLEBAR_MENU_POINT, WORKBENCH_VIEW_TITLE_POINT} from "../shared/menus";
import type {TitlebarMenuItemDeclaration, ViewTitleItemDeclaration} from "../shared/menus";
import {overlaysPoint, WORKBENCH_OVERLAYS_POINT} from "../shared/overlays";
import {viewsPoint, WORKBENCH_VIEWS_POINT} from "../shared/views";
import type {ViewDeclaration} from "../shared/views";
import {workbenchRootKey} from "./contracts";
import type {ActivityBarItemImplementation} from "./contracts";
import {EditorAreaSlot, validateEditorAreaContribution} from "./editor-area";
import {createWorkbenchPages} from "./home-page";
import {HomeSlot} from "./home-slot";
import {createNotifications} from "./notifications";
import {ActivityItemRegistry} from "./items/activity-items";
import {ItemRegistry} from "./items/registry";
import {createOverlayHost, OverlaySlot} from "./overlays";
import {WORKBENCH_TITLEBAR_MENU_ITEMS} from "./titlebar/menu-items";
import {createShellChrome} from "./titlebar/titlebar-source";
import {PageTable, validatePageContribution} from "./pages";
import {createLayoutHost} from "./state/layout-host";
import {layoutStoreFor} from "./state/layout-store";
import {workbenchState, workbenchStateBindings} from "./state/public-state";
import {ViewRegistry} from "./views/registry";

const CommandHost = defineAsyncComponent(() => import("./commands/WorkbenchCommandHost.vue"));
const Notifications = defineAsyncComponent(() => import("./components/WorkbenchNotifications.vue"));

/**
 * 头像占位（docs/specs/ui/workbench-shell.md 输出 40）：账户插件迁回前不可点，样子同书架右上角的头像位；账户插件迁回时由它
 * 贡献真正的头像，这一条随之删去。排在设置齿轮（1000）之上。
 */
const PROFILE_ITEM = "nbook.workbench.profile";
const PROFILE_DECLARATION: Omit<ActivityBarItemDeclaration, "title"> = {
    icon: "i-lucide-user-round",
    order: 900,
};
const NO_IMPLEMENTATION: ActivityBarItemImplementation = Object.freeze({});

export const workbenchBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    contributionPoints: [
        {id: WORKBENCH_PAGES_POINT, implementation: "required", validate: validatePageContribution},
        viewsPoint,
        {id: WORKBENCH_EDITOR_AREA_POINT, implementation: "required", validate: validateEditorAreaContribution},
        statusbarItemsPoint,
        titlebarItemsPoint,
        activityBarItemsPoint,
        overlaysPoint,
        {id: WORKBENCH_HOME_POINT, implementation: "required", complete: completeHomeDeclaration, validate: validateHomeContribution},
        titlebarMenuPoint,
        viewTitlePoint,
    ],
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        dependencies: [{key: diagnosticsKey}, {key: commandServiceKey}, {key: windowProjectKey}, {key: windowNavigationKey}, {key: settingsKey}, {key: storageKey}, {key: publicStateKey}, {key: windowPluginsKey, required: false}, {key: windowTextKey, required: false}],
        provides: [workbenchRootKey, quickPickKey, notificationsKey],
        receives: [WORKBENCH_PAGES_POINT, WORKBENCH_VIEWS_POINT, WORKBENCH_EDITOR_AREA_POINT, WORKBENCH_STATUSBAR_ITEMS_POINT, WORKBENCH_TITLEBAR_ITEMS_POINT, WORKBENCH_ACTIVITYBAR_ITEMS_POINT, WORKBENCH_OVERLAYS_POINT, WORKBENCH_HOME_POINT, WORKBENCH_TITLEBAR_MENU_POINT, WORKBENCH_VIEW_TITLE_POINT],
        contributions: [
            {capability: WORKBENCH_ACTIVITYBAR_ITEMS_POINT, id: PROFILE_ITEM, declaration: PROFILE_DECLARATION},
            {capability: COMMANDS_POINT, id: OPEN_COMMANDS_ID, declaration: OPEN_COMMANDS_DECLARATION},
            {capability: COMMANDS_POINT, id: SWITCH_THEME_COMMAND, declaration: SWITCH_THEME_DECLARATION},
            {capability: COMMANDS_POINT, id: SWITCH_APPEARANCE_COMMAND, declaration: SWITCH_APPEARANCE_DECLARATION},
            ...Object.entries(PANEL_COMMAND_DECLARATIONS).map(([id, declaration]) => ({capability: COMMANDS_POINT, id, declaration})),
            ...Object.entries(PART_COMMAND_DECLARATIONS).map(([id, declaration]) => ({capability: COMMANDS_POINT, id, declaration})),
            ...Object.entries(APP_COMMAND_DECLARATIONS).map(([id, declaration]) => ({capability: COMMANDS_POINT, id, declaration})),
            ...Object.entries(VIEW_COMMAND_DECLARATIONS).map(([id, declaration]) => ({capability: COMMANDS_POINT, id, declaration})),
            ...workbenchState.contributions,
            ...WORKBENCH_TITLEBAR_MENU_ITEMS.map(({id, declaration}) => ({capability: WORKBENCH_TITLEBAR_MENU_POINT, id, declaration})),
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
            const editorArea = new EditorAreaSlot((message) => diagnostics.record({level: "warn", event: "workbench.editor-area", message, source: {plugin: descriptor.id}}));
            const stateService = context.services.require(publicStateKey);
            const reportItem = (message: string): void => {
                diagnostics.record({level: "warn", event: "workbench.items", message, source: {plugin: descriptor.id}});
            };
            const statusItems = new ItemRegistry(context.declarations.list<ItemDeclaration>(WORKBENCH_STATUSBAR_ITEMS_POINT), stateService, reportItem, context.signal);
            const titleItems = new ItemRegistry(context.declarations.list<ItemDeclaration>(WORKBENCH_TITLEBAR_ITEMS_POINT), stateService, reportItem, context.signal);
            const activityItems = new ActivityItemRegistry(context.declarations.list<ActivityBarItemDeclaration>(WORKBENCH_ACTIVITYBAR_ITEMS_POINT), stateService, context.signal);
            const titlebarMenu = new MenuItemRegistry(context.declarations.list<TitlebarMenuItemDeclaration>(WORKBENCH_TITLEBAR_MENU_POINT), context.signal);
            const viewTitle = new MenuItemRegistry(context.declarations.list<ViewTitleItemDeclaration>(WORKBENCH_VIEW_TITLE_POINT), context.signal);
            const chrome = createShellChrome({commands, state: stateService, statusItems, titleItems, activityItems, titlebarMenu, viewTitle, platform: currentKeyPlatform(), signal: context.signal});
            const overlays = new OverlaySlot(context.signal);
            const OverlayHost = createOverlayHost(overlays, (message) => diagnostics.record({level: "warn", event: "workbench.overlays", message, source: {plugin: descriptor.id}}));
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
            const locale = await windowLocale(context.services, () => displayLocale(settings));
            const text = await windowTextPort(context.services, () => displayLocale(settings));
            const theme = computed(() => settings.get(themeSetting));
            const appearance = computed(() => settings.get(appearanceSetting));
            const homeSlot = new HomeSlot(context.declarations, (message) => diagnostics.record({level: "warn", event: "workbench.home", message, source: {plugin: descriptor.id}}));
            // 通知队列与入口同寿：入口停止时清空，计时器不留到下一代。
            const notifications = createNotifications((message) => diagnostics.record({level: "warn", event: "workbench.notifications", message, source: {plugin: descriptor.id}}), text);
            context.signal.addEventListener("abort", () => notifications.dispose(), {once: true});
            // 短名只给页面根的标记与“有没有项目”的判断用；界面上显示书名（窗口的显示名，见 nbook/shared/projects）。
            const projectName = project?.name ?? null;
            const projectTitle = project?.title ?? null;
            const workbenchPages = createWorkbenchPages({
                // 文档根的设置与外壳由页面自己加载，挂上后页面根才标 `data-page-rendered`（home-page.ts）。
                document: {load: async () => (await import("./document/WorkbenchDocument.vue")).default, props: () => ({locale, theme, appearance})},
                // 布局 store 在要显示外壳时才创建：首页贡献在场的 `/` 页与直接打开 Lab 的窗口都不读产品布局记录。开始加载外壳时就
                // 创建、开始读布局记录，与下载外壳代码并行：等外壳挂上才读的话，每次打开都先按缺省布局画出来（Spec 失败表的“记录
                // 未读完”），记录到了再变过去，侧栏、面板从缺省尺寸动画收起，缺省可见的视图也被加载。
                shell: {load: async () => {
                    layout.acquire();
                    return (await import("./components/WorkbenchShell.vue")).default;
                }, props: () => ({layout: layout.acquire(), commands, views, editorArea, chrome, project: projectTitle})},
                renderCommandHost: () => h(CommandHost, {commands, report, notify: (input: NotificationInput) => void notifications.notify(input), attach: (host: PaletteHost) => palettes.attach(host)}),
                renderNotifications: () => h(Notifications, {queue: notifications.queue}),
                renderOverlays: () => h(OverlayHost),
                projectName,
                home: homeSlot,
                reportHome: (message) => diagnostics.record({level: "warn", event: "workbench.home", message, source: {plugin: descriptor.id}}),
                // 入口停止后（窗口整页离开、实例停止）外壳还在加载会被正在停止的 store 拒绝：那是页面在离开，不是加载失败。
                reportPart: (message) => diagnostics.record({level: context.signal.aborted ? "debug" : "error", event: "workbench.page", message, source: {plugin: descriptor.id}}),
            });
            const pages = new PageTable([
                {path: "/", title: "NeuroBook", load: async () => workbenchPages.home},
                {path: WORKBENCH_PATH, title: "NeuroBook", load: async () => workbenchPages.workbench},
            ]);
            return {
                services: [provideService(workbenchRootKey, {pages: () => pages.list()}), provideService(quickPickKey, palettes.quickPick), provideService(notificationsKey, {notify: (input) => notifications.notify(input)})],
                receivers: {[WORKBENCH_PAGES_POINT]: pages.receiver(), [WORKBENCH_VIEWS_POINT]: views.receiver(), [WORKBENCH_EDITOR_AREA_POINT]: editorArea.receiver(), [WORKBENCH_STATUSBAR_ITEMS_POINT]: statusItems.receiver(), [WORKBENCH_TITLEBAR_ITEMS_POINT]: titleItems.receiver(), [WORKBENCH_ACTIVITYBAR_ITEMS_POINT]: activityItems.receiver(), [WORKBENCH_OVERLAYS_POINT]: overlays.receiver(), [WORKBENCH_HOME_POINT]: homeSlot.receiver(), [WORKBENCH_TITLEBAR_MENU_POINT]: titlebarMenu.receiver(), [WORKBENCH_VIEW_TITLE_POINT]: viewTitle.receiver()},
                contributions: {
                    [WORKBENCH_ACTIVITYBAR_ITEMS_POINT]: {[PROFILE_ITEM]: NO_IMPLEMENTATION},
                    [WORKBENCH_TITLEBAR_MENU_POINT]: menuImplementations(WORKBENCH_TITLEBAR_MENU_ITEMS),
                    [COMMANDS_POINT]: {[OPEN_COMMANDS_ID]: palettes.command, ...themeCommands(settings, palettes.quickPick, text), ...panelCommands(() => layout.current.value, palettes.quickPick), ...partCommands(() => layout.current.value, palettes.quickPick), ...viewCommands(() => layout.current.value, palettes.quickPick), ...appCommands(context.services.require(windowNavigationKey))},
                    [PUBLIC_STATE_POINT]: Object.fromEntries(publicState.bindings),
                },
            };
        },
    })],
};
