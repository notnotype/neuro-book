/**
 * e2e 用的浏览器测试插件 `test.sample-views`（docs/specs/workbench/views.md 的 e2e）：一个浏览器入口贡献六个视图（侧栏
 * 三个、右栏一个、面板两个，各在自己的隐式容器）与测试命令 `test.sample-views.stop`。开关见
 * `src/shared/testing/sample-views-contract.ts`；它们只在测试外壳里读，产品清单与产品构建不含本插件。
 */

import {defineComponent, h} from "vue";
import type {PropType} from "vue";
import {Type} from "typebox";

import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {COMMANDS_POINT} from "nbook/plugins/commands/shared/contracts";
import type {CommandDeclaration, CommandImplementation} from "nbook/plugins/commands/shared/contracts";
import {WORKBENCH_VIEWS_POINT} from "nbook/plugins/workbench/shared/views";
import type {ViewDeclaration} from "nbook/plugins/workbench/shared/views";
import type {ViewContext, ViewImplementation} from "nbook/plugins/workbench/web/contracts";
import {publicStateKey} from "nbook/plugins/state/shared/contracts";
import type {PublicStateRead} from "nbook/plugins/state/shared/contracts";
import {SAMPLE_VIEW_IDS, SAMPLE_VIEWS_STOP_COMMAND, SAMPLE_VIEWS_SWITCHES, sampleViewsDescriptor} from "nbook/shared/testing/sample-views-contract";

const view = (name: string, location: ViewDeclaration["location"], icon: string, extra: Partial<ViewDeclaration> = {}): ViewDeclaration => ({title: {"zh-CN": name, "en-US": name}, icon, location, layout: "scroll", ...extra});

const VIEWS: Readonly<Record<string, ViewDeclaration>> = {
    [SAMPLE_VIEW_IDS.alpha]: view("样例甲", "sidebar", "i-lucide-files", {layout: "fill"}),
    [SAMPLE_VIEW_IDS.beta]: view("样例乙", "sidebar", "i-lucide-list-tree", {order: 1}),
    [SAMPLE_VIEW_IDS.gamma]: view("样例丙", "sidebar", "i-lucide-clock", {order: 2}),
    [SAMPLE_VIEW_IDS.delta]: view("样例丁", "auxiliarybar", "i-lucide-notebook-pen"),
    [SAMPLE_VIEW_IDS.omega]: view("样例戊", "panel", "i-lucide-terminal"),
    // 长标题：看面板标签带放不下时的溢出与键盘切换。
    [SAMPLE_VIEW_IDS.zeta]: view("样例己：一个很长的面板视图标题", "panel", "i-lucide-scroll-text", {order: 1}),
};

const STOP_DECLARATION: CommandDeclaration = {
    title: {"zh-CN": "停止样例视图入口", "en-US": "Stop Sample Views Entry"},
    category: {"zh-CN": "测试", "en-US": "Test"},
    description: "Close this plugin entry's activation scope (test only).",
    args: Type.Object({}, {additionalProperties: false}),
    effect: "write",
    expose: {agent: "never"},
};

/** 工作台公开的焦点 Part（docs/specs/ui/workbench-shell.md 输出 27）。 */
const FOCUSED_PART_KEY = "nbook.workbench/focusedPart";

function focusedPartOf(read: PublicStateRead): string {
    return read.status === "undeclared" ? "undeclared" : `${read.status}:${String(read.value)}`;
}

function switchOn(key: string): ReadonlyArray<string> {
    return (globalThis.localStorage?.getItem(key) ?? "").split(",").filter(Boolean);
}

export function createSampleViewsBrowserPlugin(): PluginDefinition {
    return {
        id: sampleViewsDescriptor.id,
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            dependencies: [{key: publicStateKey}],
            contributions: [
                ...Object.entries(VIEWS).map(([id, declaration]) => ({capability: WORKBENCH_VIEWS_POINT, id, declaration})),
                {capability: COMMANDS_POINT, id: SAMPLE_VIEWS_STOP_COMMAND, declaration: STOP_DECLARATION},
            ],
            activate: (context) => {
                if (switchOn(SAMPLE_VIEWS_SWITCHES.failActivation).includes("1")) throw new Error("样例视图入口按开关激活失败");
                const publicState = context.services.require(publicStateKey);
                const implementation = (viewId: string): ViewImplementation => ({
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
                return {contributions: {
                    [WORKBENCH_VIEWS_POINT]: Object.fromEntries(Object.keys(VIEWS).map((id) => [id, implementation(id)])),
                    [COMMANDS_POINT]: {[SAMPLE_VIEWS_STOP_COMMAND]: stop},
                }};
            },
        }],
    };
}
