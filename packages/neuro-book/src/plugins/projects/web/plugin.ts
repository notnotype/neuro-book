/**
 * `nbook.projects` 浏览器入口：向命令系统贡献“打开项目”，向工作台的 `workbench.home` 贡献书架页（docs/specs/workbench/
 * bookshelf.md）。选择候选用工作台的选择服务（命令面板的选择模式），整页导航与新标签页用宿主能力 `windowNavigationKey`。
 */

import {Type} from "typebox";
import {computed} from "vue";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {COMMANDS_POINT} from "nbook/plugins/commands/shared/contracts";
import type {CommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import {displayLocale, settingsKey} from "nbook/plugins/settings/shared/contracts";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {quickPickKey, WORKBENCH_HOME_POINT} from "nbook/plugins/workbench/shared/contracts";
import type {HomeDeclaration} from "nbook/plugins/workbench/shared/contracts";
import type {WorkbenchHomeImplementation} from "nbook/plugins/workbench/web/contracts";
import {clockKey, windowNavigationKey} from "nbook/shared/host";

import {descriptor} from "../plugin";
import {projectsRemoteContract} from "../shared/contracts";
import {createBookshelfHome} from "./bookshelf-home";
import {OPEN_PROJECT_COMMAND, OPEN_PROJECT_DECLARATION, openProject} from "./open-project";
import type {OpenProjectHost} from "./open-project";
import {createShelfPage} from "./shelf-page";
import {shelfPreferencesStore} from "./shelf-preferences";
import type {ShelfPreferencesStore} from "./shelf-preferences";

const DECLARATION: CommandDeclaration = {...OPEN_PROJECT_DECLARATION, args: Type.Object({}, {additionalProperties: false})};

export const BOOKSHELF_HOME_ID = "nbook.projects.bookshelf";
const HOME_DECLARATION: HomeDeclaration = {title: {"zh-CN": "书架", "en-US": "Bookshelf"}};

export const projectsBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        // 命令随贡献方入口激活才进命令表（还没有按命令触发的激活事件）：启动即激活，面板里才列得出“打开项目”。
        activationEvents: ["onStartup"],
        dependencies: [{key: diagnosticsKey}, {key: quickPickKey}, {key: windowNavigationKey}, {key: settingsKey}, {key: storageKey}, {key: clockKey}],
        contributions: [
            {capability: COMMANDS_POINT, id: OPEN_PROJECT_COMMAND, declaration: DECLARATION},
            {capability: WORKBENCH_HOME_POINT, id: BOOKSHELF_HOME_ID, declaration: HOME_DECLARATION},
        ],
        activate: (context) => {
            const quickPick = context.services.require(quickPickKey);
            const navigation = context.services.require(windowNavigationKey);
            const remote = context.remote.use(projectsRemoteContract);
            const settings = context.services.require(settingsKey);
            const diagnostics = context.services.require(diagnosticsKey);
            const storage = context.services.require(storageKey);
            const clock = context.services.require(clockKey);
            const locale = computed(() => displayLocale(settings));
            const host: OpenProjectHost = {
                remote,
                quickPick,
                navigateDocument: (href) => navigation.navigateDocument(href),
                locale: () => locale.value,
                recordFailure: (reason, detail) => diagnostics.record({level: "info", event: "projects.register-failed", message: "登记项目失败", data: {reason, detail}, source: {plugin: descriptor.id}}),
            };
            // 偏好记录在书架第一次渲染时才打开：绑定了项目的窗口不读它。
            let store: ShelfPreferencesStore | null = null;
            const preferences = (): ShelfPreferencesStore => (store ??= shelfPreferencesStore.create(context, {storage, diagnostics}));
            const home: WorkbenchHomeImplementation = {
                load: async () => createBookshelfHome({
                    component: (await import("./components/BookshelfHost.vue")).default,
                    locale,
                    createPage: () => createShelfPage({
                        remote,
                        clock,
                        locale: () => locale.value,
                        preferences: {
                            view: computed(() => preferences().state.preferences.display.view),
                            sort: computed(() => preferences().state.preferences.display.sort),
                            setView: (view) => preferences().actions.setView(view),
                            setSort: (sort) => preferences().actions.setSort(sort),
                        },
                        settings,
                        quickPick,
                        navigation,
                        report: (event, message) => diagnostics.record({level: "warn", event, message, source: {plugin: descriptor.id}}),
                    }),
                }),
            };
            return {contributions: {[COMMANDS_POINT]: {[OPEN_PROJECT_COMMAND]: {run: () => openProject(host)}}, [WORKBENCH_HOME_POINT]: {[BOOKSHELF_HOME_ID]: home}}};
        },
    })],
};
