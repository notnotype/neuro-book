/**
 * `nbook.canon` 的浏览器入口：不存世界，按调用方提供世界客户端，以调用方的身份经远程服务转给本窗口绑定的项目实例
 * （docs/specs/canon/project.md 输出 1）。没有绑定项目的窗口调用得到 `no-project`。
 *
 * 作者界面（docs/specs/canon/author-ui.md）也在这里：侧栏视图“设定”、条目页、数据分页的贡献点 `canon.component-views`（canon
 * 自己给人物、面板各交一个界面）与命令。界面用本入口自己的身份建一份读取层（`world.ts`），视图或页面第一次挂上时才建（才订阅
 * 世界），窗口停止时释放。视图、页面与命令的实现要在启动时交出，所以入口在启动时激活。
 */

import {defineEntry, provideServicePerConsumer} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {defineComponent, h} from "vue";
import type {PropType} from "vue";

import {COMMANDS_POINT, commandServiceKey} from "nbook/plugins/commands/shared/contracts";
import {EDITOR_PAGES_POINT} from "nbook/plugins/editor/shared/contracts";
import type {EditorPageDeclaration} from "nbook/plugins/editor/shared/contracts";
import {WORKBENCH_VIEWS_POINT} from "nbook/plugins/workbench/shared/contracts";
import type {WrittenViewDeclaration} from "nbook/plugins/workbench/shared/views";
import type {ViewImplementation} from "nbook/plugins/workbench/web/contracts";
import {windowProjectKey} from "nbook/shared/projects";

import {descriptor} from "../plugin";
import {CANON_COMPONENT_VIEWS_POINT, componentViewsPoint} from "../shared/component-views";
import type {ComponentViewDeclaration} from "../shared/component-views";
import {componentsPoint} from "../shared/components";
import {canonClientKey, canonWorldContract} from "../shared/contracts";
import type {CanonClient} from "../shared/contracts";
import {createCanonClient} from "./client";
import {CANON_COMMAND_DECLARATIONS, canonCommands, ENTRY_PAGE, OPEN_ENTRY_COMMAND} from "./commands";
import {ComponentViewRegistry} from "./component-views";
import type {ComponentViewContext, ComponentViewImplementation} from "./component-views";
import {createEntriesViewHost, entriesViewState} from "./entries-view";
import {createEntryPage, originsFetcher} from "./entry-page";
import {createCanonWorld} from "./world";
import type {CanonWorld} from "./world";

export const ENTRIES_VIEW_ID = "nbook.canon.entries";

/** author-ui.md 的“输入与前置条件”：侧栏，排在文件资源管理器（`order: 0`）之后。标题由约定键补（`views.<id>.title`）。 */
const ENTRIES_VIEW: WrittenViewDeclaration = {icon: "i-lucide-book", location: "sidebar", order: 10, layout: "fill"};

/** 条目页：每个条目一个标签，刷新后恢复（author-ui.md 的“输入与前置条件”）。标题由约定键补（`editorPages.entry.title`）。 */
const ENTRY_PAGE_DECLARATION: Omit<EditorPageDeclaration, "title"> = {icon: "i-lucide-book-open", instances: true, restore: true};

/** canon 自己的两个内置类型的数据分页界面；标题由约定键补（`componentViews.<本地 id>.title`）。 */
const PERSON_TYPE = "nbook.canon.person";
const PANEL_TYPE = "nbook.canon.panel";
const BUILTIN_VIEW: ComponentViewDeclaration = {};

/** 把一个收 `{context}` 的组件交成数据分页的界面；`extra` 是固定给它的别的属性。 */
function componentView(load: () => Promise<{default: unknown}>, extra: Record<string, unknown> = {}): ComponentViewImplementation {
    return {
        load: async () => {
            const component = (await load()).default as Parameters<typeof h>[0];
            return defineComponent({
                props: {context: {type: Object as PropType<ComponentViewContext>, required: true}},
                setup: (props) => () => h(component, {context: props.context, ...extra}),
            });
        },
    };
}

export const canonBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    // 贡献点在每个有本插件的实例里都定义：内置类型是顶层声明，各实例都登记它们（plugin-manifest.md 输出 11）。
    contributionPoints: [componentsPoint, componentViewsPoint],
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        activationEvents: ["onStartup"],
        // 命令服务可选：只装世界客户端的窗口（测试场地、别的插件的测试）没有工作台，也没有命令。
        dependencies: [{key: windowProjectKey}, {key: commandServiceKey, required: false}],
        provides: [canonClientKey],
        receives: [CANON_COMPONENT_VIEWS_POINT],
        remoteDelegates: [canonWorldContract],
        contributions: [
            {capability: WORKBENCH_VIEWS_POINT, id: ENTRIES_VIEW_ID, declaration: ENTRIES_VIEW},
            {capability: EDITOR_PAGES_POINT, id: ENTRY_PAGE, declaration: ENTRY_PAGE_DECLARATION},
            {capability: CANON_COMPONENT_VIEWS_POINT, id: PERSON_TYPE, declaration: BUILTIN_VIEW},
            {capability: CANON_COMPONENT_VIEWS_POINT, id: PANEL_TYPE, declaration: BUILTIN_VIEW},
            ...Object.entries(CANON_COMMAND_DECLARATIONS).map(([id, declaration]) => ({capability: COMMANDS_POINT, id, declaration})),
        ],
        activate: async (context) => {
            const bound = context.services.require(windowProjectKey).project !== null;
            const resolved = await context.services.resolve(commandServiceKey);
            const commands = resolved.status === "resolved" ? resolved.instance : null;
            // 界面用的那一份客户端与读取层：第一个视图或页面挂上时才建。
            let client: CanonClient | null = null;
            let world: CanonWorld | null = null;
            const clientOf = (): CanonClient => (client ??= createCanonClient(() => context.remote));
            const worldOf = (): CanonWorld | null => {
                if (!bound || context.signal.aborted) return null;
                world ??= createCanonWorld(clientOf());
                return world;
            };
            context.signal.addEventListener("abort", () => world?.dispose(), {once: true});
            const execute = (id: string, args: unknown): void => void commands?.execute(id, args);
            const views = new ComponentViewRegistry();
            const page = createEntryPage({
                world: worldOf,
                fetchOrigins: originsFetcher((input) => clientOf().call("origins", input)),
                views,
                execute,
                entriesView: ENTRIES_VIEW_ID,
            });
            const state = entriesViewState();
            const view: ViewImplementation = {
                load: async () => createEntriesViewHost((await import("./components/EntryTree.vue")).default, {
                    world: worldOf(),
                    state,
                    open: (id) => execute(OPEN_ENTRY_COMMAND, {id}),
                }),
            };
            return {
                services: [provideServicePerConsumer(canonClientKey, (consumer) => createCanonClient(bound ? () => context.remote.on(consumer) : null))],
                receivers: {[CANON_COMPONENT_VIEWS_POINT]: views.receiver()},
                contributions: {
                    [WORKBENCH_VIEWS_POINT]: {[ENTRIES_VIEW_ID]: view},
                    [EDITOR_PAGES_POINT]: {[ENTRY_PAGE]: page},
                    [CANON_COMPONENT_VIEWS_POINT]: {
                        [PERSON_TYPE]: componentView(() => import("./components/FieldsDataView.vue"), {semanticNotes: true}),
                        [PANEL_TYPE]: componentView(() => import("./components/PanelDataView.vue")),
                    },
                    [COMMANDS_POINT]: canonCommands(commands),
                },
            };
        },
    })],
};
