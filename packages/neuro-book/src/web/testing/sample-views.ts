/**
 * e2e 用的浏览器测试插件 `test.sample-views`（docs/specs/workbench/views.md 的 e2e）：一个浏览器入口贡献六个视图（侧栏
 * 三个、右栏一个、面板两个，各在自己的隐式容器；开关打开时右栏另有一个受限视图）、编辑器槽的样例内容（docs/specs/ui/workbench-shell.md 非目标第一条）
 * 与测试命令 `test.sample-views.stop`。开关见
 * `src/shared/testing/sample-views-contract.ts`；它们只在测试外壳里读，产品清单与产品构建不含本插件。
 */

import {defineComponent, h, Teleport} from "vue";
import type {PropType} from "vue";
import {Type} from "typebox";

import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {COMMANDS_POINT, commandServiceKey} from "nbook/plugins/commands/shared/contracts";
import type {CommandDeclaration, CommandImplementation} from "nbook/plugins/commands/shared/contracts";
import {VIEW_RAIL, viewRailOf, WORKBENCH_EDITOR_AREA_POINT} from "nbook/plugins/workbench/shared/contracts";
import type {ViewRailBounds} from "nbook/plugins/workbench/shared/contracts";
import {WORKBENCH_VIEWS_POINT} from "nbook/plugins/workbench/shared/views";
import type {ViewDeclaration} from "nbook/plugins/workbench/shared/views";
import type {EditorAreaContext, EditorAreaImplementation, ViewContext, ViewImplementation} from "nbook/plugins/workbench/web/contracts";
import {publicStateKey} from "nbook/plugins/state/shared/contracts";
import type {PublicStateRead} from "nbook/plugins/state/shared/contracts";
import {SAMPLE_EDITOR_AREA_ID, SAMPLE_RAIL_BOUNDS, SAMPLE_VIEW_IDS, SAMPLE_VIEWS_MARK_COMMAND, SAMPLE_VIEWS_RUN_EVENT, SAMPLE_VIEWS_STOP_COMMAND, SAMPLE_VIEWS_SWITCHES, sampleViewsDescriptor} from "nbook/shared/testing/sample-views-contract";

const view = (name: string, location: ViewDeclaration["location"], icon: string, extra: Partial<ViewDeclaration> = {}): ViewDeclaration => ({title: {"zh-CN": name, "en-US": name}, icon, location, layout: "scroll", ...extra});

// 测试插件是第三方插件，没写 `order` 的视图会排到内置视图之后（views.md 输出 13）：e2e 依赖的位置都写明 `order`。
const VIEWS: Readonly<Record<string, ViewDeclaration>> = {
    [SAMPLE_VIEW_IDS.alpha]: view("样例甲", "sidebar", "i-lucide-files", {layout: "fill", order: 0}),
    [SAMPLE_VIEW_IDS.beta]: view("样例乙", "sidebar", "i-lucide-list-tree", {order: 1}),
    // 丙自己声明一个收进“⋯”的动作；`test.menus` 另给它贡献按钮与“⋯”里的项（views.md 验收 8）。
    [SAMPLE_VIEW_IDS.gamma]: view("样例丙", "sidebar", "i-lucide-clock", {order: 2, actions: [{command: SAMPLE_VIEWS_MARK_COMMAND, icon: "i-lucide-bookmark", title: {"zh-CN": "样例的菜单动作", "en-US": "Sample Menu Action"}, placement: "menu"}]}),
    [SAMPLE_VIEW_IDS.delta]: view("样例丁", "auxiliarybar", "i-lucide-notebook-pen", {order: 0}),
    [SAMPLE_VIEW_IDS.omega]: view("样例戊", "panel", "i-lucide-terminal", {order: 0}),
    // 长标题：看面板标签带放不下时的溢出与键盘切换。
    [SAMPLE_VIEW_IDS.zeta]: view("样例己：一个很长的面板视图标题", "panel", "i-lucide-scroll-text", {order: 1, floatable: false}),
};

/** 开关 `withRail` 打开时另贡献的受限视图（views.md 输出 22）：排在样例丁之后。 */
const RAIL_VIEW: ViewDeclaration = view("样例庚", "auxiliarybar", "i-lucide-messages-square", {order: 1, confinedTo: "auxiliarybar"});

const MARK_DECLARATION: CommandDeclaration = {
    title: {"zh-CN": "样例的菜单动作", "en-US": "Sample Menu Action"},
    category: {"zh-CN": "测试", "en-US": "Test"},
    description: "Do nothing (test only).",
    args: Type.Object({}, {additionalProperties: false}),
    effect: "read",
    expose: {agent: "never"},
};

const STOP_DECLARATION: CommandDeclaration = {
    title: {"zh-CN": "停止样例视图入口", "en-US": "Stop Sample Views Entry"},
    category: {"zh-CN": "测试", "en-US": "Test"},
    description: "Close this plugin entry's activation scope (test only).",
    args: Type.Object({}, {additionalProperties: false}),
    effect: "write",
    expose: {agent: "never"},
};

/** 工作台公开的当前面板（docs/specs/ui/workbench-layout.md 输出 36）。 */
const FOCUSED_PART_KEY = "nbook.workbench/focusedPart";

function focusedPartOf(read: PublicStateRead): string {
    return read.status === "undeclared" ? "undeclared" : `${read.status}:${String(read.value)}`;
}

/** 编辑器槽的样例内容：显示创建次数与 `visible`，e2e 经它核对布局变化只停放、不重挂。 */
const editorAreaMounts = {count: 0};
const SampleEditorArea = defineComponent({
    name: "SampleEditorArea",
    props: {context: {type: Object as PropType<EditorAreaContext>, required: true}},
    setup: (props) => {
        editorAreaMounts.count += 1;
        const instance = editorAreaMounts.count;
        return () => h("div", {"data-sample-editor-area": "", "data-instance": String(instance), "data-visible": props.context.visible.value ? "true" : "false"}, `样例编辑器 #${String(instance)}`);
    },
});

const SampleEditorHost = defineComponent({name: "SampleEditorHost", setup: () => () => null});

function switchOn(key: string): ReadonlyArray<string> {
    return (globalThis.localStorage?.getItem(key) ?? "").split(",").filter(Boolean);
}

/** `rail` 视图段的范围：开关里的 JSON，读不出时用缺省。 */
function railBoundsSwitch(): ViewRailBounds {
    try {
        const raw = globalThis.localStorage?.getItem(SAMPLE_VIEWS_SWITCHES.railBounds);
        return raw === null || raw === undefined ? SAMPLE_RAIL_BOUNDS : {...SAMPLE_RAIL_BOUNDS, ...(JSON.parse(raw) as Partial<ViewRailBounds>)};
    } catch (error) {
        console.warn("[test.sample-views] rail-bounds 开关读不出，用缺省", error);
        return SAMPLE_RAIL_BOUNDS;
    }
}

/**
 * `rail` 视图的视图段（views.md 输出 21）：借到右轨时往 `main` 送三个会话按钮、往 `foot` 送一个按钮，都带 `data-rail-item`；展开时 `main` 里另有一行写着“展开”。
 * 视图自己的内容写出此刻的借用状态，e2e 经它核对借用、撤回与展开。
 */
const SampleRailView = defineComponent({
    name: "SampleRailView",
    props: {context: {type: Object as PropType<ViewContext>, required: true}},
    setup: (props) => {
        const rail = viewRailOf(props.context);
        return () => {
            const placement = rail?.placement.value ?? {kind: "none" as const};
            const expanded = rail?.expanded.value === true;
            const body = h("div", {"data-sample-rail": placement.kind, "data-sample-rail-expanded": expanded ? "true" : "false"}, `样例庚：${placement.kind}`);
            if (placement.kind !== "rail" || !(placement.main instanceof HTMLElement) || !(placement.foot instanceof HTMLElement)) return body;
            const items = ["一", "二", "三"].map((name) => h("button", {type: "button", "data-rail-item": "", "data-sample-rail-item": name, "aria-label": `会话${name}`, class: "sample-rail-item"}, name));
            return [
                body,
                h(Teleport, {to: placement.main}, [h("div", {"data-messages-segment": "", "data-messages-segment-state": expanded ? "expanded" : "collapsed"}, [...items, ...(expanded ? [h("div", {"data-sample-rail-list": ""}, "展开")] : [])])]),
                h(Teleport, {to: placement.foot}, [h("button", {type: "button", "data-rail-item": "", "data-sample-rail-foot": "", "aria-label": "新对话"}, "+")]),
            ];
        };
    },
});

export function createSampleViewsBrowserPlugin(): PluginDefinition {
    const views: Readonly<Record<string, ViewDeclaration>> = switchOn(SAMPLE_VIEWS_SWITCHES.withRail).includes("1") ? {...VIEWS, [SAMPLE_VIEW_IDS.rail]: RAIL_VIEW} : VIEWS;
    return {
        id: sampleViewsDescriptor.id,
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            dependencies: [{key: publicStateKey}, {key: commandServiceKey}],
            contributions: [
                ...Object.entries(views).map(([id, declaration]) => ({capability: WORKBENCH_VIEWS_POINT, id, declaration})),
                {capability: COMMANDS_POINT, id: SAMPLE_VIEWS_STOP_COMMAND, declaration: STOP_DECLARATION},
                {capability: COMMANDS_POINT, id: SAMPLE_VIEWS_MARK_COMMAND, declaration: MARK_DECLARATION},
                {capability: WORKBENCH_EDITOR_AREA_POINT, id: SAMPLE_EDITOR_AREA_ID, declaration: {order: 0}},
            ],
            activate: (context) => {
                if (switchOn(SAMPLE_VIEWS_SWITCHES.failActivation).includes("1")) throw new Error("样例视图入口按开关激活失败");
                const publicState = context.services.require(publicStateKey);
                const commands = context.services.require(commandServiceKey);
                const run = (event: Event): void => {
                    const {command, args} = (event as CustomEvent<{readonly command: string; readonly args?: unknown}>).detail;
                    void commands.execute(command, args).then((result) => {
                        if (!result.ok) console.warn(`[test.sample-views] ${command} 没有执行`, result);
                    }, (error: unknown) => console.error(`[test.sample-views] ${command} 出错`, error));
                };
                globalThis.addEventListener(SAMPLE_VIEWS_RUN_EVENT, run);
                context.scope.register({kind: "sample-views-run-event", label: `${sampleViewsDescriptor.id} run event`, value: run, release: (listener) => globalThis.removeEventListener(SAMPLE_VIEWS_RUN_EVENT, listener)});
                const railImplementation: ViewImplementation & {readonly [VIEW_RAIL]: ViewRailBounds} = {
                    load: async () => {
                        if (switchOn(SAMPLE_VIEWS_SWITCHES.failLoad).includes(SAMPLE_VIEW_IDS.rail)) throw new Error(`样例视图 ${SAMPLE_VIEW_IDS.rail} 按开关加载失败`);
                        return SampleRailView;
                    },
                    [VIEW_RAIL]: railBoundsSwitch(),
                };
                const implementation = (viewId: string): ViewImplementation => (viewId === SAMPLE_VIEW_IDS.rail ? railImplementation : {
                    load: async () => {
                        if (switchOn(SAMPLE_VIEWS_SWITCHES.failLoad).includes(viewId)) throw new Error(`样例视图 ${viewId} 按开关加载失败`);
                        const view = (await import("./SampleViewsView.vue")).default;
                        // 样例视图同时是工作台公开状态的消费者：把 `focusedPart` 显示出来，e2e 经它核对真实接线。
                        return defineComponent({
                            name: "SampleViewsWithState",
                            props: {context: {type: Object as PropType<ViewContext>, required: true}},
                            setup: (props) => () => h(view, {context: props.context, focusedPart: focusedPartOf(publicState.read(FOCUSED_PART_KEY))}),
                        });
                    },
                });
                // `context.scope` 是本代次之下的入口工作作用域，单关它会等别处借用它的资源；关的是它的父，即这一代的激活作用域。
                const stop: CommandImplementation = {run: () => {
                    void context.scope.parent?.close();
                    return {ok: true, value: null};
                }};
                const editorArea: EditorAreaImplementation = {load: async () => ({host: SampleEditorHost, group: SampleEditorArea})};
                return {contributions: {
                    [WORKBENCH_VIEWS_POINT]: Object.fromEntries(Object.keys(views).map((id) => [id, implementation(id)])),
                    [WORKBENCH_EDITOR_AREA_POINT]: {[SAMPLE_EDITOR_AREA_ID]: editorArea},
                    [COMMANDS_POINT]: {[SAMPLE_VIEWS_STOP_COMMAND]: stop, [SAMPLE_VIEWS_MARK_COMMAND]: {run: () => ({ok: true, value: null})}},
                }};
            },
        }],
    };
}
