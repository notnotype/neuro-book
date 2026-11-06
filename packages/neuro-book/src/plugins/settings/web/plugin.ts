/**
 * `nbook.settings` 的浏览器入口：不存配置，订阅服务端的用户层与（绑定项目时）项目实例的项目层，在本窗口合成有效值，
 * 按调用方提供配置服务；写入以调用方的身份经远程服务转给层的拥有者（docs/specs/settings/configuration.md）。配置核心
 * 入口同时拥有设置分区贡献点 `settings.sections`、贡献“外观”分区，并把分区注册表与用户编辑的写入路径交给本插件
 * 自己的其它入口（docs/specs/settings/settings-window.md）。
 *
 * 配置核心入口 `browser` 只依赖宿主能力与诊断，工作台、命令系统都依赖它；用到命令面板选择服务的“切换界面语言”与要工作台
 * 通知的设置窗口各在另一个入口里，免得配置核心经工作台、命令系统绕回自己（服务装配的静态环把可选依赖也算在内）。
 */

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {Type} from "typebox";

import {computed, effect} from "@vue/reactivity";
import {defineComponent, h} from "vue";

import {COMMANDS_POINT, menuImplementations} from "nbook/plugins/commands/shared/contracts";
import type {WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import {PUBLIC_STATE_POINT} from "nbook/plugins/state/shared/contracts";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {notificationsKey, quickPickKey, WORKBENCH_ACTIVITYBAR_ITEMS_POINT, WORKBENCH_OVERLAYS_POINT, WORKBENCH_TITLEBAR_MENU_POINT} from "nbook/plugins/workbench/shared/contracts";
import type {ActivityBarItemDeclaration, OverlayDeclaration, TitlebarMenuItemDeclaration} from "nbook/plugins/workbench/shared/contracts";
import type {ActivityBarItemImplementation, WorkbenchOverlayImplementation} from "nbook/plugins/workbench/web/contracts";

import {clockKey, windowConnectionKey, windowPluginsKey} from "nbook/shared/host";
import type {Written} from "nbook/shared/convention-keys";
import {HOST_LOCALES, hostLocaleSchema} from "nbook/shared/host-locales";
import {windowProjectKey} from "nbook/shared/projects";
import {resolverFor} from "nbook/shared/localized-text";
import {windowTextKey, windowTextPort} from "nbook/shared/window-text";
import {bindingsOf, definePublicState} from "nbook/shared/store/public";
import type {SettingLayer} from "nbook/shared/settings";

import {descriptor} from "../plugin";
import {displayLocale, localeSetting, OPEN_SETTINGS_COMMAND, TOGGLE_SETTINGS_COMMAND, projectSettingsContract, SETTINGS_CHOICES_ACTIVATION_PREFIX, SETTINGS_CHOICES_POINT, SETTINGS_PAGE_ACTIVATION_PREFIX, SETTINGS_PAGES_POINT, SETTINGS_SECTIONS_POINT, SETTINGS_WINDOW_OPEN_KEY, settingsKey, switchSetting, userSettingsContract} from "../shared/contracts";
import type {SettingsChoicesDeclaration, SettingsPageDeclaration, SettingsSectionDeclaration} from "../shared/contracts";
import {createSettingsInstance, FIRST_SNAPSHOT_MS, provideSettings, recordTo} from "../shared/instance";
import {acceptedSettings, choicesPoint, pagesPoint, sectionsPoint, settingsPoint} from "../shared/point";
import {settingsText} from "../shared/text";
import {remoteLayerEditor, remoteLayerFile, remoteLayerLink} from "../shared/remote-link";
import {ChoiceSourceRegistry} from "./choices";
import {SettingsSectionRegistry} from "./sections";
import {createSettingsWindow} from "./settings-window";
import type {SettingsWindowSizeStore} from "./settings-window";
import {settingsWindowSizeStore, sizeStorePort} from "./window-size";
import {choiceReferences, createSettingsWindowSource, provideSettingsWindowSource, settingsWindowSourceKey} from "./window-source";

export const SWITCH_LOCALE_COMMAND = "nbook.settings.switch-locale";

/** 标题栏视图组里“切换主题、明暗”之后的“切换界面语言”（docs/specs/ui/workbench-shell.md 外壳四输出 29）。 */
const LOCALE_MENU_ITEMS: ReadonlyArray<{readonly id: string; readonly declaration: TitlebarMenuItemDeclaration}> = [
    {id: "nbook.settings.menu.locale", declaration: {group: "view", section: "4_appearance", order: 3, command: SWITCH_LOCALE_COMMAND}},
];

/** 写用户层（界面语言只允许用户层）；Agent 带参数即可切换，plan、discuss 模式下按命令系统的规则只读。 */
export const SWITCH_LOCALE_DECLARATION: WrittenCommandDeclaration = {
    category: settingsText("commands.category"),
    description: "Change the display language of all windows. Without arguments, the user picks one; with { locale }, it is set directly.",
    args: Type.Object({locale: Type.Optional(hostLocaleSchema())}, {additionalProperties: false}),
    effect: "write",
    expose: {agent: "auto"},
};

/**
 * 打开设置窗口（settings-window.md 输出 15）。只读：打开窗口不改数据；不对 Agent 开放，它是给人看的窗口。分区不在左栏里为
 * `invalid-args`、窗口没有绑定作品却要本作品标签为 `unavailable`，两种都不打开。
 */
export const OPEN_SETTINGS_DECLARATION: WrittenCommandDeclaration = {
    category: settingsText("commands.category"),
    description: "Open the settings window of this page, or focus it when it is already open. { section } jumps to a section id; { layer: \"user\" | \"project\" } switches between user and book settings.",
    args: Type.Object({
        section: Type.Optional(Type.String()),
        layer: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("project")])),
    }, {additionalProperties: false}),
    effect: "read",
    keybinding: "Mod+,",
    expose: {agent: "never"},
};

/** 齿轮执行的（输出 15）：窗口开着是关闭，有未保存的改动时同关闭按钮一样先确认；关着是打开。 */
export const TOGGLE_SETTINGS_DECLARATION: WrittenCommandDeclaration = {
    category: settingsText("commands.category"),
    description: "Close the settings window of this page if it is open, otherwise open it.",
    args: Type.Object({}, {additionalProperties: false}),
    effect: "read",
    expose: {agent: "never"},
};

/** 设置窗口的公开状态；限定名即 `SETTINGS_WINDOW_OPEN_KEY`。 */
export const settingsWindowState = definePublicState(descriptor.id, {
    windowOpen: {type: "boolean", unready: false, reason: settingsText("state.windowOpen.reason")},
});

/**
 * 工作台活动栏最下面的齿轮（docs/specs/ui/workbench-shell.md 输出 40）：在头像占位（900）之下；窗口开着时画成按下。
 * 书架右上角的齿轮是书架自己画的，执行同一条命令、读同一个公开键。
 */
export const SETTINGS_GEAR_ITEM = "nbook.settings";
const GEAR_DECLARATION: Written<ActivityBarItemDeclaration, "title"> = {
    icon: "i-lucide-settings",
    order: 1000,
    command: {id: TOGGLE_SETTINGS_COMMAND},
    toggled: SETTINGS_WINDOW_OPEN_KEY,
};
const GEAR: ActivityBarItemImplementation = Object.freeze({});

/** 设置窗口经工作台的页面浮层挂在页面根上（settings-window.md“时序与寿命”）：首页与工作台页都有，每个页面一份。 */
export const SETTINGS_WINDOW_OVERLAY = "nbook.settings.window";
const OVERLAY_DECLARATION: OverlayDeclaration = {};

/**
 * 设置窗口的入口（settings-window.md）：持有窗口模型（开着与否、分区、标签、尺寸），贡献 `nbook.settings.open` 与公开键
 * `windowOpen`，向工作台贡献活动栏的齿轮与挂窗口的页面浮层。依赖工作台的通知，所以不能是配置核心入口；命令随入口激活才进
 * 命令表，启动即激活。尺寸记录在窗口第一次读尺寸时才打开：没打开过设置的页面不读它。
 */
export const settingsWindowEntry = defineEntry({
    id: "window",
    location: "browser",
    activationEvents: ["onStartup"],
    dependencies: [{key: diagnosticsKey}, {key: settingsKey}, {key: settingsWindowSourceKey}, {key: notificationsKey}, {key: storageKey}, {key: windowProjectKey}, {key: windowTextKey, required: false}],
    contributions: [
        {capability: COMMANDS_POINT, id: OPEN_SETTINGS_COMMAND, declaration: OPEN_SETTINGS_DECLARATION},
        {capability: COMMANDS_POINT, id: TOGGLE_SETTINGS_COMMAND, declaration: TOGGLE_SETTINGS_DECLARATION},
        {capability: WORKBENCH_ACTIVITYBAR_ITEMS_POINT, id: SETTINGS_GEAR_ITEM, declaration: GEAR_DECLARATION},
        {capability: WORKBENCH_OVERLAYS_POINT, id: SETTINGS_WINDOW_OVERLAY, declaration: OVERLAY_DECLARATION},
        ...settingsWindowState.contributions,
    ],
    activate: async (context) => {
        const diagnostics = context.services.require(diagnosticsKey);
        const settings = context.services.require(settingsKey);
        const storage = context.services.require(storageKey);
        const notifications = context.services.require(notificationsKey);
        const project = context.services.require(windowProjectKey).project;
        let sizePort: SettingsWindowSizeStore | null = null;
        const size = (): SettingsWindowSizeStore => (sizePort ??= sizeStorePort(settingsWindowSizeStore.create(context, {storage, diagnostics})));
        const remembered = computed(() => size().remembered.value);
        const settingsWindow = createSettingsWindow({
            source: context.services.require(settingsWindowSourceKey),
            settings,
            bound: project !== null,
            // 窗口的显示名：书名，没有书名时是目录原名（nbook/shared/projects 的 WindowProject）。
            projectTitle: project?.title ?? null,
            locale: computed(() => displayLocale(settings)),
            text: resolverFor(() => displayLocale(settings), await windowTextPort(context.services, () => displayLocale(settings))),
            size: {remembered, remember: (next) => size().remember(next)},
            notify: (input) => void notifications.notify(input),
            report: (message) => diagnostics.record({level: "warn", event: "settings.window", message, source: {plugin: descriptor.id}}),
        });
        context.scope.register({kind: "settings-window", label: `${descriptor.id} window`, value: settingsWindow, release: (value) => value.dispose()});
        const published = bindingsOf(settingsWindowState, {windowOpen: settingsWindow.open});
        const run = (args: unknown) => settingsWindow.openWindow(args as {readonly section?: string; readonly layer?: SettingLayer});
        const overlay: WorkbenchOverlayImplementation = {
            // `.vue` 只在 load() 里动态导入：插件的合同测试在 bun test 里导入本文件，bun 不能加载 `.vue`。
            load: async () => {
                const SettingsWindow = (await import("./components/SettingsWindow.vue")).default;
                return defineComponent({name: "SettingsWindowOverlay", setup: () => () => h(SettingsWindow, {window: settingsWindow})});
            },
        };
        return {
            contributions: {
                [COMMANDS_POINT]: {[OPEN_SETTINGS_COMMAND]: {run}, [TOGGLE_SETTINGS_COMMAND]: {run: () => settingsWindow.toggleWindow()}},
                [PUBLIC_STATE_POINT]: Object.fromEntries(published.bindings),
                [WORKBENCH_ACTIVITYBAR_ITEMS_POINT]: {[SETTINGS_GEAR_ITEM]: GEAR},
                [WORKBENCH_OVERLAYS_POINT]: {[SETTINGS_WINDOW_OVERLAY]: overlay},
            },
        };
    },
});

export const settingsBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    contributionPoints: [settingsPoint, sectionsPoint, pagesPoint, choicesPoint],
    // 设置窗口显示 page 分区时触发 `onSettingsPage:<分区 id>`（settings-window.md 输出 4），要一个提供者的选项时触发
    // `onSettingsChoices:<提供者 id>`（“选项提供者”）。
    activationEventPrefixes: [SETTINGS_PAGE_ACTIVATION_PREFIX, SETTINGS_CHOICES_ACTIVATION_PREFIX],
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        dependencies: [{key: diagnosticsKey}, {key: clockKey}, {key: windowConnectionKey}, {key: windowProjectKey}, {key: windowPluginsKey, required: false}],
        provides: [settingsKey, settingsWindowSourceKey],
        receives: [SETTINGS_PAGES_POINT, SETTINGS_CHOICES_POINT],
        remoteDelegates: [userSettingsContract, projectSettingsContract],
        activate: async (context) => {
            const bound = context.services.require(windowProjectKey).project !== null;
            const diagnostics = context.services.require(diagnosticsKey);
            const declarations = acceptedSettings(context.declarations);
            const instance = createSettingsInstance({
                layers: {
                    user: remoteLayerLink(context.remote, userSettingsContract),
                    ...(bound ? {project: remoteLayerLink(context.remote, projectSettingsContract)} : {}),
                },
                declarations,
                clock: context.services.require(clockKey),
                firstSnapshotMs: FIRST_SNAPSHOT_MS,
                connection: context.services.require(windowConnectionKey),
                record: recordTo(diagnostics, descriptor.id),
            });
            context.scope.register({kind: "settings-instance", label: `${descriptor.id} browser`, value: instance, release: (value) => value.close()});
            const plugins = await context.services.resolve(windowPluginsKey);
            const sections = new SettingsSectionRegistry(
                context.declarations.list<SettingsSectionDeclaration>(SETTINGS_SECTIONS_POINT),
                context.declarations.list<SettingsPageDeclaration>(SETTINGS_PAGES_POINT),
                plugins.status === "resolved" ? plugins.instance : null,
                (message) => diagnostics.record({level: "warn", event: "settings.sections", message, source: {plugin: descriptor.id}}),
                context.signal,
                (event) => context.activation.trigger(event),
            );
            const choices = new ChoiceSourceRegistry(
                context.declarations.list<SettingsChoicesDeclaration>(SETTINGS_CHOICES_POINT),
                choiceReferences(declarations),
                plugins.status === "resolved" ? plugins.instance : null,
                (message) => diagnostics.record({level: "warn", event: "settings.choices", message, source: {plugin: descriptor.id}}),
                context.signal,
                (event) => context.activation.trigger(event),
            );
            const windowSource = createSettingsWindowSource({
                sections,
                choices,
                declarations,
                editors: {
                    user: remoteLayerEditor(context.remote, userSettingsContract),
                    ...(bound ? {project: remoteLayerEditor(context.remote, projectSettingsContract)} : {}),
                },
                files: {
                    user: remoteLayerFile(context.remote, userSettingsContract),
                    ...(bound ? {project: remoteLayerFile(context.remote, projectSettingsContract)} : {}),
                },
                instance,
            });
            await instance.ready;
            return {
                services: [provideSettings(instance), provideSettingsWindowSource(windowSource, descriptor.id)],
                receivers: {[SETTINGS_PAGES_POINT]: sections.receiver(), [SETTINGS_CHOICES_POINT]: choices.receiver()},
            };
        },
    }), defineEntry({
        id: "commands",
        location: "browser",
        // 命令随贡献方入口激活才进命令表（还没有按命令触发的激活事件），启动即激活。
        activationEvents: ["onStartup"],
        dependencies: [{key: settingsKey}, {key: quickPickKey}, {key: windowTextKey, required: false}],
        contributions: [
            {capability: COMMANDS_POINT, id: SWITCH_LOCALE_COMMAND, declaration: SWITCH_LOCALE_DECLARATION},
            ...LOCALE_MENU_ITEMS.map(({id, declaration}) => ({capability: WORKBENCH_TITLEBAR_MENU_POINT, id, declaration})),
        ],
        activate: async (context) => {
            const settings = context.services.require(settingsKey);
            const quickPick = context.services.require(quickPickKey);
            const text = resolverFor(() => displayLocale(settings), await windowTextPort(context.services, () => displayLocale(settings)));
            const run = (args: unknown) => switchSetting({
                settings,
                quickPick,
                setting: localeSetting,
                value: (args as {readonly locale?: string}).locale,
                // 语言名用它自己的语言写，换到看不懂的语言后也找得回来。
                choices: HOST_LOCALES.map((locale) => ({id: locale.tag, label: locale.name})),
                title: settingsText("commands.switch-locale.title"),
                text,
            });
            return {contributions: {[COMMANDS_POINT]: {[SWITCH_LOCALE_COMMAND]: {run}}, [WORKBENCH_TITLEBAR_MENU_POINT]: menuImplementations(LOCALE_MENU_ITEMS)}};
        },
    }), defineEntry({
        id: "locale",
        location: "browser",
        // 窗口的界面语言只有这一个来源：把设置里的值推给窗口的翻译引擎（docs/specs/ui/i18n.md“时序与寿命”）。启动即激活，
        // 不依赖工作台，没有工作台的窗口也跟随设置。值来自用户层时让宿主记下，下次启动在设置快照到达前就用它；缺省值不记。
        activationEvents: ["onStartup"],
        // 翻译引擎是窗口能力；只装插件、不建窗口宿主的测试场地没有它，这时本入口什么都不做。
        dependencies: [{key: settingsKey}, {key: windowTextKey, required: false}],
        activate: async (context) => {
            const settings = context.services.require(settingsKey);
            const text = await context.services.resolve(windowTextKey);
            if (text.status !== "resolved") return {};
            const runner = effect(() => {
                const inspected = settings.inspect(localeSetting);
                text.instance.setLocale(inspected.value, {remember: inspected.source !== "default"});
            });
            context.scope.register({kind: "settings-locale", label: `${descriptor.id} locale`, value: runner, release: (value) => value.effect.stop()});
            return {};
        },
    }), settingsWindowEntry],
};

/**
 * 只有配置核心入口的浏览器定义：给不装工作台的测试实例与示例场地用。切换界面语言的入口要命令面板的选择服务，
 * 没有工作台时它受阻，会被当作启动失败；产品窗口总有工作台，装完整的 `settingsBrowserPlugin`。
 */
export const settingsBrowserCore: PluginDefinition = {...settingsBrowserPlugin, entries: settingsBrowserPlugin.entries.filter((entry) => entry.id === "browser")};
