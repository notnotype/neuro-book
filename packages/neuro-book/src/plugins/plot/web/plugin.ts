/**
 * `nbook.plot` 的浏览器入口：剧情侧的作者界面（docs/specs/plot/author-ui.md）。侧栏“剧情”、编辑区里的几张表、条目页的专门界面
 * （知道什么、目标与态度、谁知道）与附加分页“经历”，读取都经 canon 浏览器入口交的读取服务（`canonReadsKey`）：剧情的远程读取挂进
 * 窗口的同一份读取层，世界变了、窗口换了线以后与 canon 的读取同一轮换上。
 * 视图、页面与命令的实现要在启动时交出，所以入口在启动时激活。
 */

import {Type} from "typebox";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {computed, defineComponent, h, onMounted, shallowRef} from "vue";
import type {PropType} from "vue";

import {CANON_COMPONENT_VIEWS_POINT, CANON_ENTRY_TABS_POINT, canonReadsKey, OPEN_ENTRY_COMMAND, PERSON_COMPONENT} from "nbook/plugins/canon/shared/contracts";
import type {ComponentViewDeclaration, EntryTabDeclaration} from "nbook/plugins/canon/shared/contracts";
import type {CanonReads} from "nbook/plugins/canon/shared/reads";
import type {ComponentViewContext, ComponentViewImplementation, EntryTabContext} from "nbook/plugins/canon/web/component-views";
import {COMMANDS_POINT, commandServiceKey} from "nbook/plugins/commands/shared/contracts";
import type {CommandImplementation, CommandResult, WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import {EDITOR_PAGES_POINT, OPEN_PAGE_COMMAND} from "nbook/plugins/editor/shared/contracts";
import type {EditorPageDeclaration} from "nbook/plugins/editor/shared/contracts";
import type {EditorPageContext, EditorPageImplementation} from "nbook/plugins/editor/web/pages";
import {OPEN_VIEW_COMMAND, WORKBENCH_VIEWS_POINT} from "nbook/plugins/workbench/shared/contracts";
import type {WrittenViewDeclaration} from "nbook/plugins/workbench/shared/views";
import type {ViewImplementation} from "nbook/plugins/workbench/web/contracts";

import {descriptor} from "../plugin";
import {COMPONENT_IDS} from "../shared/declarations";
import {plotText} from "../shared/text";
import {createPlotAuthorClient} from "./author";
import type {PlotAuthorClient} from "./author";
import {tableTitle} from "./pages";
import type {GoalsPageState, LedgerPageState, PlotTable, SecretsPageState} from "./pages";

export const SIDEBAR_VIEW = "nbook.plot.sidebar";
export const SECRETS_PAGE = "nbook.plot.secrets";
export const LEDGER_PAGE = "nbook.plot.ledger";
export const GOALS_PAGE = "nbook.plot.goals";
export const OPEN_SECRETS_COMMAND = "nbook.plot.open-secrets";
export const OPEN_LEDGER_COMMAND = "nbook.plot.open-ledger";
export const OPEN_GOALS_COMMAND = "nbook.plot.open-goals";
export const SHOW_SIDEBAR_COMMAND = "nbook.plot.show-sidebar";
/** 人物页的附加分页“经历”（输出 18）。 */
export const EXPERIENCE_TAB = "nbook.plot.experience";

/** 侧栏，排在“设定”（`order: 10`）之后；标题由约定键补（`views.sidebar.title`）。 */
const SIDEBAR_DECLARATION: WrittenViewDeclaration = {icon: "i-lucide-git-branch", location: "sidebar", order: 20, layout: "fill"};
/** 无参数的页面，刷新后恢复；标题由约定键补（`editorPages.<本地 id>.title`）。 */
const TABLE_PAGE: Omit<EditorPageDeclaration, "title"> = {icon: "i-lucide-table-2", restore: true};

/** 专门界面的标题由约定键补（`componentViews.<本地 id>.title`）；图标各一个。 */
const KNOWING_VIEW: ComponentViewDeclaration = {icon: "i-lucide-key-round"};
const ATTITUDE_VIEW: ComponentViewDeclaration = {icon: "i-lucide-target"};
const POINT_VIEW: ComponentViewDeclaration = {icon: "i-lucide-eye"};
/** 条目启用了 canon 的人物类型才出“经历”；它全是从剧情里算出来的，作品里还没有剧情变更时不出。 */
const EXPERIENCE_DECLARATION: EntryTabDeclaration = {requires: PERSON_COMPONENT, icon: "i-lucide-footprints", needsChanges: true};

const NO_ARGS = Type.Object({}, {additionalProperties: false});
/** 都只改这个窗口的布局（打开页面、显示视图），不改作品；Agent 读剧情走 `nbook.plot/world`。 */
const COMMAND_DECLARATIONS: Readonly<Record<string, WrittenCommandDeclaration>> = {
    [OPEN_SECRETS_COMMAND]: {category: plotText("commands.category"), description: "Open the Who Knows What table: each secret, who knows it, what the reader knows, and how it will be revealed.", args: NO_ARGS, effect: "write", expose: {agent: "never"}},
    [OPEN_LEDGER_COMMAND]: {category: plotText("commands.category"), description: "Open the foreshadowing ledger: each foreshadowing thread, its stage, when it was last mentioned and what is planned next.", args: NO_ARGS, effect: "write", expose: {agent: "never"}},
    [OPEN_GOALS_COMMAND]: {category: plotText("commands.category"), description: "Open the goals table: each main character's goals, conflicts, progress and attitudes.", args: NO_ARGS, effect: "write", expose: {agent: "never"}},
    [SHOW_SIDEBAR_COMMAND]: {category: plotText("commands.category"), description: "Show the Plot view in the sidebar.", args: NO_ARGS, effect: "write", expose: {agent: "never"}},
};

/** 一张表的页面：组件挂上时记下“最后显示出来的那张表”（侧栏选中它，输出 1）。 */
function tablePage<State extends object>(table: PlotTable, load: () => Promise<{default: unknown}>, initialState: () => State, extra: Record<string, unknown>, shown: (table: PlotTable) => void): EditorPageImplementation<State> {
    return {
        load: async () => {
            const Page = (await load()).default as Parameters<typeof h>[0];
            return defineComponent({
                name: `PlotTablePage-${table}`,
                props: {context: {type: Object as PropType<EditorPageContext<State>>, required: true}},
                setup(props) {
                    onMounted(() => shown(table));
                    return () => h(Page, {state: props.context.state, ...extra});
                },
            });
        },
        initialState,
        breadcrumbs: () => [{label: plotText("page.plot"), command: {id: OPEN_VIEW_COMMAND, args: {viewId: SIDEBAR_VIEW}}}, {label: tableTitle(table)}],
    };
}

/** 条目页的界面：条目页给 `{context}`，这里另给读取层与剧情的客户端。 */
function entryView<Context extends ComponentViewContext | EntryTabContext>(load: () => Promise<{default: unknown}>, reads: CanonReads, client: PlotAuthorClient): ComponentViewImplementation {
    return {
        load: async () => {
            const View = (await load()).default as Parameters<typeof h>[0];
            return defineComponent({
                props: {context: {type: Object as PropType<Context>, required: true}},
                setup: (props) => () => h(View, {context: props.context, reads, client}),
            });
        },
    };
}

export const plotBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        activationEvents: ["onStartup"],
        // 命令服务可选：只装读取层的测试窗口没有工作台，也没有命令。
        dependencies: [{key: canonReadsKey}, {key: commandServiceKey, required: false}],
        contributions: [
            {capability: WORKBENCH_VIEWS_POINT, id: SIDEBAR_VIEW, declaration: SIDEBAR_DECLARATION},
            {capability: EDITOR_PAGES_POINT, id: SECRETS_PAGE, declaration: TABLE_PAGE},
            {capability: EDITOR_PAGES_POINT, id: LEDGER_PAGE, declaration: TABLE_PAGE},
            {capability: EDITOR_PAGES_POINT, id: GOALS_PAGE, declaration: TABLE_PAGE},
            {capability: CANON_COMPONENT_VIEWS_POINT, id: COMPONENT_IDS.knowing, declaration: KNOWING_VIEW},
            {capability: CANON_COMPONENT_VIEWS_POINT, id: COMPONENT_IDS.attitude, declaration: ATTITUDE_VIEW},
            {capability: CANON_COMPONENT_VIEWS_POINT, id: COMPONENT_IDS.point, declaration: POINT_VIEW},
            {capability: CANON_ENTRY_TABS_POINT, id: EXPERIENCE_TAB, declaration: EXPERIENCE_DECLARATION},
            ...Object.entries(COMMAND_DECLARATIONS).map(([id, declaration]) => ({capability: COMMANDS_POINT, id, declaration})),
        ],
        activate: async (context) => {
            const reads = context.services.require(canonReadsKey);
            const resolved = await context.services.resolve(commandServiceKey);
            const commands = resolved.status === "resolved" ? resolved.instance : null;
            const client = createPlotAuthorClient(() => context.remote);
            const execute = (id: string, args: unknown): void => void commands?.execute(id, args);
            const open = (id: string): void => execute(OPEN_ENTRY_COMMAND, {id});
            const active = shallowRef<PlotTable | null>(null);
            const shown = (table: PlotTable): void => {
                active.value = table;
            };
            const pageOf: Record<PlotTable, string> = {secrets: SECRETS_PAGE, ledger: LEDGER_PAGE, goals: GOALS_PAGE};
            const sidebar: ViewImplementation = {
                load: async () => {
                    const Sidebar = (await import("./components/PlotSidebar.vue")).default;
                    return defineComponent({
                        name: "PlotSidebarView",
                        setup() {
                            const lines = reads.useExternal("plotLines", () => ({}), (input) => client.call("plotLines", input));
                            const data = computed(() => lines.value?.data);
                            return () => h(Sidebar, {
                                unbound: reads.connection.value === "no-project",
                                lines: data.value?.items ?? null,
                                names: data.value?.names ?? {},
                                active: active.value,
                                onTable: (table: PlotTable) => execute(OPEN_PAGE_COMMAND, {id: pageOf[table]}),
                                onLine: open,
                            });
                        },
                    });
                },
            };
            const missing: CommandResult<unknown> = {ok: false, code: "unavailable", reason: "no command service in this window"};
            const commandImplementations: Record<string, CommandImplementation> = {
                [OPEN_SECRETS_COMMAND]: {run: async () => (commands === null ? missing : commands.execute(OPEN_PAGE_COMMAND, {id: SECRETS_PAGE}))},
                [OPEN_LEDGER_COMMAND]: {run: async () => (commands === null ? missing : commands.execute(OPEN_PAGE_COMMAND, {id: LEDGER_PAGE}))},
                [OPEN_GOALS_COMMAND]: {run: async () => (commands === null ? missing : commands.execute(OPEN_PAGE_COMMAND, {id: GOALS_PAGE}))},
                [SHOW_SIDEBAR_COMMAND]: {run: async () => (commands === null ? missing : commands.execute(OPEN_VIEW_COMMAND, {viewId: SIDEBAR_VIEW}))},
            };
            return {
                contributions: {
                    [WORKBENCH_VIEWS_POINT]: {[SIDEBAR_VIEW]: sidebar},
                    [EDITOR_PAGES_POINT]: {
                        [SECRETS_PAGE]: tablePage<SecretsPageState>("secrets", () => import("./components/SecretsPage.vue"), () => ({position: "", planned: false, segment: "all", people: null}), {reads, client, open}, shown),
                        [LEDGER_PAGE]: tablePage<LedgerPageState>("ledger", () => import("./components/LedgerPage.vue"), () => ({position: "", planned: false, segment: "unpaid"}), {reads, client, open}, shown),
                        [GOALS_PAGE]: tablePage<GoalsPageState>("goals", () => import("./components/GoalsPage.vue"), () => ({position: "", planned: false, holder: null, finished: false, collapsed: []}), {reads, client, open}, shown),
                    },
                    [COMMANDS_POINT]: commandImplementations,
                    [CANON_COMPONENT_VIEWS_POINT]: {
                        [COMPONENT_IDS.knowing]: entryView<ComponentViewContext>(() => import("./components/KnowingView.vue"), reads, client),
                        [COMPONENT_IDS.attitude]: entryView<ComponentViewContext>(() => import("./components/AttitudeView.vue"), reads, client),
                        [COMPONENT_IDS.point]: entryView<ComponentViewContext>(() => import("./components/PointView.vue"), reads, client),
                    },
                    [CANON_ENTRY_TABS_POINT]: {[EXPERIENCE_TAB]: entryView<EntryTabContext>(() => import("./components/ExperienceTab.vue"), reads, client)},
                },
            };
        },
    })],
};
