/**
 * `nbook.projects` 浏览器入口：向命令系统贡献“打开项目”与“欢迎”，向工作台的 `workbench.home` 贡献书架页、向编辑器的
 * `editor.pages` 贡献欢迎页，向设置窗口贡献“作品”分区（docs/specs/workbench/bookshelf.md）。选择候选用工作台的选择服务
 * （命令面板的选择模式），整页导航与新标签页用宿主能力 `windowNavigationKey`。
 */

import {Type} from "typebox";
import {computed} from "vue";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {COMMANDS_POINT, commandServiceKey, currentKeyPlatform, formatKeybinding, menuImplementations} from "nbook/plugins/commands/shared/contracts";
import {EDITOR_PAGES_POINT, OPEN_PAGE_COMMAND} from "nbook/plugins/editor/shared/contracts";
import type {EditorPageDeclaration} from "nbook/plugins/editor/shared/contracts";
import type {EditorPageImplementation} from "nbook/plugins/editor/web/pages";
import {filesKey} from "nbook/plugins/files/shared/contracts";
import type {WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import {windowTextKey, windowTextPort} from "nbook/shared/window-text";
import {displayLocale, SETTINGS_PAGES_POINT, SETTINGS_WINDOW_OPEN_KEY, settingsKey} from "nbook/plugins/settings/shared/contracts";
import type {SettingsPageImplementation} from "nbook/plugins/settings/web/contracts";
import {publicStateKey} from "nbook/plugins/state/shared/contracts";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {notificationsKey, quickPickKey, WORKBENCH_HOME_POINT, WORKBENCH_TITLEBAR_MENU_POINT} from "nbook/plugins/workbench/shared/contracts";
import type {TitlebarMenuItemDeclaration} from "nbook/plugins/workbench/shared/contracts";
import type {HomeDeclaration} from "nbook/plugins/workbench/shared/contracts";
import type {WorkbenchHomeImplementation} from "nbook/plugins/workbench/web/contracts";
import type {Written} from "nbook/shared/convention-keys";
import {clockKey, windowNavigationKey} from "nbook/shared/host";
import {windowProjectKey} from "nbook/shared/projects";

import {descriptor} from "../plugin";
import {projectsRemoteContract} from "../shared/contracts";
import {projectCoverUrl} from "../shared/cover";
import {projectsText} from "../shared/text";
import {createBookshelfHome} from "./bookshelf-home";
import {browseDirectory} from "./browse";
import {OPEN_PROJECT_COMMAND, OPEN_PROJECT_DECLARATION, openProject} from "./open-project";
import type {OpenProjectHost} from "./open-project";
import {createShelfPage} from "./shelf-page";
import type {CoverTransport, CoverTransportResult} from "./shelf-page";
import {shelfPreferencesStore} from "./shelf-preferences";
import type {ShelfPreferencesStore} from "./shelf-preferences";
import {createWorksPage, WORKS_SECTION, WORKS_SECTION_DECLARATION} from "./works-section";
import {createWelcomeHost, WELCOME_PAGE_ID} from "./welcome";

const DECLARATION: WrittenCommandDeclaration = {...OPEN_PROJECT_DECLARATION, args: Type.Object({}, {additionalProperties: false})};

export const BOOKSHELF_HOME_ID = "nbook.projects.bookshelf";
/** 标题省略，登记时补成约定键 `home.bookshelf.title`。 */
const HOME_DECLARATION: Written<HomeDeclaration, "title"> = {};

/** “帮助 > 欢迎”与命令面板打开欢迎页的命令。 */
export const WELCOME_COMMAND = "nbook.help.welcome";

/** 标题栏菜单里归作品插件的条目（docs/specs/ui/workbench-shell.md 外壳四输出 29）：文件组的打开项目、帮助组的欢迎。 */
const TITLEBAR_MENU_ITEMS: ReadonlyArray<{readonly id: string; readonly declaration: TitlebarMenuItemDeclaration}> = [
    {id: "nbook.projects.menu.open", declaration: {group: "file", section: "1_open", command: OPEN_PROJECT_COMMAND}},
    {id: "nbook.projects.menu.welcome", declaration: {group: "help", section: "1_help", order: 1, command: WELCOME_COMMAND}},
];
const WELCOME_DECLARATION: WrittenCommandDeclaration = {
    category: projectsText("commands.nbook.help.welcome.category"),
    description: "Open the welcome page of the work in this window: overview, new chapter, recent files and getting-started tips.",
    args: Type.Object({}, {additionalProperties: false}),
    effect: "read",
    expose: {agent: "never"},
};
/** 作品第一次在本窗口打开时自动打开（docs/specs/workbench/editor.md 输出 33）。 */
const WELCOME_PAGE: Written<EditorPageDeclaration, "title"> = {icon: "i-lucide-book-open", openOnFirstVisit: true, scene: true};

/** 命令面板的命令（与工作台的命令搜索同一条）：欢迎页的入门提示显示它的快捷键。 */
const OPEN_COMMANDS_ID = "nbook.quick-open.open-commands";

export const projectsBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        // 命令随贡献方入口激活才进命令表（还没有按命令触发的激活事件）：启动即激活，面板里才列得出“打开项目”。
        activationEvents: ["onStartup"],
        dependencies: [{key: diagnosticsKey}, {key: quickPickKey}, {key: windowNavigationKey}, {key: settingsKey}, {key: storageKey}, {key: clockKey}, {key: notificationsKey}, {key: commandServiceKey}, {key: publicStateKey}, {key: windowProjectKey}, {key: filesKey, required: false}, {key: windowTextKey, required: false}],
        contributions: [
            {capability: COMMANDS_POINT, id: OPEN_PROJECT_COMMAND, declaration: DECLARATION},
            {capability: COMMANDS_POINT, id: WELCOME_COMMAND, declaration: WELCOME_DECLARATION},
            ...TITLEBAR_MENU_ITEMS.map(({id, declaration}) => ({capability: WORKBENCH_TITLEBAR_MENU_POINT, id, declaration})),
            {capability: WORKBENCH_HOME_POINT, id: BOOKSHELF_HOME_ID, declaration: HOME_DECLARATION},
            {capability: SETTINGS_PAGES_POINT, id: WORKS_SECTION, declaration: WORKS_SECTION_DECLARATION},
            {capability: EDITOR_PAGES_POINT, id: WELCOME_PAGE_ID, declaration: WELCOME_PAGE},
        ],
        activate: async (context) => {
            const quickPick = context.services.require(quickPickKey);
            const navigation = context.services.require(windowNavigationKey);
            const remote = context.remote.use(projectsRemoteContract);
            const settings = context.services.require(settingsKey);
            const diagnostics = context.services.require(diagnosticsKey);
            const storage = context.services.require(storageKey);
            const clock = context.services.require(clockKey);
            const notifications = context.services.require(notificationsKey);
            const commands = context.services.require(commandServiceKey);
            const text = await windowTextPort(context.services, () => displayLocale(settings));
            const state = context.services.require(publicStateKey);
            // 书架右上角的齿轮按下与否：读设置插件的公开键，与工作台活动栏的齿轮同一个来源。
            const settingsOpen = computed(() => {
                const read = state.read(SETTINGS_WINDOW_OPEN_KEY);
                return read.status === "ready" && read.value === true;
            });
            const host: OpenProjectHost = {
                remote,
                quickPick,
                navigateDocument: (href) => navigation.navigateDocument(href),
                text,
                recordFailure: (reason, detail) => diagnostics.record({level: "info", event: "projects.register-failed", message: "登记项目失败", data: {reason, detail}, source: {plugin: descriptor.id}}),
            };
            // 偏好记录在书架第一次渲染时才打开：绑定了项目的窗口不读它。
            let store: ShelfPreferencesStore | null = null;
            const preferences = (): ShelfPreferencesStore => (store ??= shelfPreferencesStore.create(context, {storage, diagnostics}));
            const home: WorkbenchHomeImplementation = {
                load: async () => createBookshelfHome({
                    component: (await import("./components/BookshelfHost.vue")).default,
                    settingsOpen,
                    createPage: () => createShelfPage({
                        remote,
                        clock,
                        text,
                        preferences: {
                            view: computed(() => preferences().state.preferences.display.view),
                            sort: computed(() => preferences().state.preferences.display.sort),
                            setView: (view) => preferences().actions.setView(view),
                            setSort: (sort) => preferences().actions.setSort(sort),
                        },
                        settings,
                        navigation,
                        notifications,
                        cover: coverTransport(),
                        commands: {execute: async (id) => {
                            const result = await commands.execute(id, undefined, {source: "user"});
                            return result.ok ? {ok: true} : {ok: false, reason: `${result.code}：${text.t(result.reason)}`};
                        }},
                        report: (event, message) => diagnostics.record({level: "warn", event, message, source: {plugin: descriptor.id}}),
                    }),
                }),
            };
            const works: SettingsPageImplementation = {
                // 设置窗口第一次显示“作品”分区时才调用。
                load: async () => createWorksPage({
                    component: (await import("./components/WorksSettingsPage.vue")).default,
                    settings,
                    source: {list: (path) => browseDirectory(remote, path, text)},
                    // 取不到时页面原位写一句淡色的说明，不发通知（bookshelf.md 输出 21），这里只记诊断。
                    library: async () => {
                        const result = await remote.library({});
                        if (result.ok) return result.value;
                        diagnostics.record({level: "warn", event: "projects.library-failed", message: `取作品目录失败：${result.code}`, source: {plugin: descriptor.id}});
                        return null;
                    },
                    notifications,
                    report: (message) => diagnostics.record({level: "warn", event: "projects.library-not-saved", message, source: {plugin: descriptor.id}}),
                }),
            };
            const project = context.services.require(windowProjectKey).project;
            // 欢迎页的快捷入口与“新建章节”要文件服务；书架不要，没有装文件插件的窗口照样有书架。
            const files = await context.services.resolve(filesKey);
            const welcome: EditorPageImplementation = {
                load: async () => createWelcomeHost({
                    component: (await import("./components/WelcomePage.vue")).default,
                    project: project === null ? null : {id: project.id, title: project.title},
                    remote,
                    files: files.status === "resolved" ? files.instance : null,
                    commands,
                    navigateDocument: (href) => navigation.navigateDocument(href),
                    text,
                    now: () => clock.now(),
                    shortcut: () => {
                        const command = commands.get(OPEN_COMMANDS_ID);
                        return command.ok && command.value.keybinding !== undefined ? formatKeybinding(command.value.keybinding, currentKeyPlatform()) : null;
                    },
                    report: (message) => diagnostics.record({level: "warn", event: "projects.welcome", message, source: {plugin: descriptor.id}}),
                }),
            };
            return {contributions: {
                [COMMANDS_POINT]: {
                    [OPEN_PROJECT_COMMAND]: {run: () => openProject(host)},
                    [WELCOME_COMMAND]: {run: () => commands.execute(OPEN_PAGE_COMMAND, {id: WELCOME_PAGE_ID}, {source: "user"})},
                },
                [WORKBENCH_HOME_POINT]: {[BOOKSHELF_HOME_ID]: home},
                [EDITOR_PAGES_POINT]: {[WELCOME_PAGE_ID]: welcome},
                [SETTINGS_PAGES_POINT]: {[WORKS_SECTION]: works},
                [WORKBENCH_TITLEBAR_MENU_POINT]: menuImplementations(TITLEBAR_MENU_ITEMS),
            }};
        },
    })],
};

/** 封面经服务端入口的 HTTP 路由（docs/specs/runtime/projects.md 输出第 21 条）：同源，浏览器直接 fetch。 */
function coverTransport(): CoverTransport {
    const failure = async (response: Response): Promise<CoverTransportResult> => {
        const body = await response.json().catch(() => null) as {readonly code?: string; readonly detail?: string} | null;
        return {ok: false, code: body?.code ?? String(response.status), detail: body?.detail ?? response.statusText};
    };
    const url = (id: string): string => projectCoverUrl(id, "").split("?")[0] ?? "";
    return {
        upload: async (id, file) => {
            const form = new FormData();
            form.set("file", file, file.name);
            try {
                const response = await fetch(url(id), {method: "PUT", body: form});
                return response.ok ? {ok: true} : failure(response);
            } catch (error) {
                return {ok: false, code: "network", detail: error instanceof Error ? error.message : String(error)};
            }
        },
        remove: async (id) => {
            try {
                const response = await fetch(url(id), {method: "DELETE"});
                return response.ok ? {ok: true} : failure(response);
            } catch (error) {
                return {ok: false, code: "network", detail: error instanceof Error ? error.message : String(error)};
            }
        },
    };
}
