import type {Component} from "vue";

import type JsonViewer from "nbook/ui/JsonViewer.vue";
import type SkillChip from "nbook/ui/SkillChip.vue";
import type WorkbenchActivityBar from "nbook/plugins/workbench/web/components/WorkbenchActivityBar.vue";
import type WorkbenchCommandPalette from "nbook/plugins/workbench/web/components/WorkbenchCommandPalette.vue";
import type WorkbenchMoveViewMenu from "nbook/plugins/workbench/web/components/WorkbenchMoveViewMenu.vue";
import type WorkbenchPanelSurface from "nbook/plugins/workbench/web/components/WorkbenchPanelSurface.vue";
import type WorkbenchShellLayout from "nbook/plugins/workbench/web/components/WorkbenchShellLayout.vue";
import type WorkbenchStatusBar from "nbook/plugins/workbench/web/components/WorkbenchStatusBar.vue";
import type WorkbenchViewSection from "nbook/plugins/workbench/web/components/WorkbenchViewSection.vue";
import type {PanelState} from "nbook/plugins/workbench/web/shell/panel-state";

import type CollapsibleSidePanel from "../components/CollapsibleSidePanel.vue";
import type EventLogPanel from "../components/EventLogPanel.vue";
import type FixtureExample from "../components/FixtureExample.vue";
import type HighlightBox from "../components/HighlightBox.vue";
import type MarkdownView from "../components/MarkdownView.vue";
import type SurfaceTierDemo from "../components/SurfaceTierDemo.vue";
import type ViewportCanvas from "../components/ViewportCanvas.vue";
import type {LabInputOf, LabJsonPropOf, LabSlotOf, LabSubjectProps} from "../lab-subject";

import {defineSubjectFixture} from "./subject-fixture";

/**
 * 场景登记。这不是第二份组件清单——组件清单由 component-index 扫文档得到，
 * 这里只补文档里没有的东西：一个组件可以摆出哪几个场景。两者按组件名对上。
 */
export type LabScene = {
    id: string;
    label: string;
    /** 运行时消费的宽化输入；登记入口负责把它约束到组件类型。 */
    input?: {props?: Record<string, unknown>; model?: Record<string, unknown>; slots?: Record<string, boolean>};
};

declare const LAB_FIXTURE_BRAND: unique symbol;

export type LabFixture = {
    /** 与组件文档同名 */
    component: string;
    scenes: LabScene[];
    /** 没有可登记 JSON 数据 prop 的组件可声明无输入理由；运行期能力仍由 fixture 绑定。 */
    noInput?: string;
    /** fixture 为哪些插槽备了预设内容。 */
    slots?: readonly string[];
    load: () => Promise<Component>;
    readonly [LAB_FIXTURE_BRAND]: true;
};

export type LabFixtureDefinition<C> = {
    component: string;
    load: () => Promise<Component>;
} & (
    | {
        noInput?: never;
        slots?: readonly LabSlotOf<C>[];
        scenes: Array<{id: string; label: string; input: LabInputOf<C>}>;
    }
    | ([LabJsonPropOf<C>] extends [never] ? {
        noInput: string;
        slots?: never;
        scenes: Array<{id: string; label: string; input?: never}>;
    } : never)
);

/** 唯一的类型化 fixture 登记入口；运行时只返回登记对象，不加载组件或推导签名。 */
export function defineLabFixture<C = never>(
    definition: [C] extends [never] ? never : [LabSubjectProps<C>] extends [never] ? never : LabFixtureDefinition<C>,
): LabFixture {
    // 类型检查发生在入口参数；消费方需要的宽化 registry 类型在此处擦除一次。
    return definition as unknown as LabFixture;
}

/**
 * fixture 在被检视的那个零件上加 `data-lab-subject`，Lab 据此画常亮描边。
 *
 * 没有它 Lab 分不出哪块是零件、哪块是 fixture 自己搭的台子——多数 fixture 都带工具栏
 * 和说明文字。零件是单根节点时直接写在标签上即可，Vue 会把它落到根 DOM 节点。
 * 不标也能检查，只是无法把复合 fixture 的主要零件作为优先定位目标。
 */
// Lab 场景在选择时才加载：避免一次导入所有产品组件和纯内存 fixture。

export const labFixtures: LabFixture[] = [
    defineLabFixture<typeof CollapsibleSidePanel>({
        component: "CollapsibleSidePanel", slots: ["default", "actions"],
        scenes: [
            {id: "default", label: "展开", input: {props: {title: "示例侧栏", collapsedWidth: 40, side: "left", layer: "nav"}, model: {collapsed: false}, slots: {default: true, actions: true}}},
            {id: "collapsed", label: "收起", input: {props: {title: "示例侧栏", collapsedWidth: 40, side: "left", layer: "nav"}, model: {collapsed: true}, slots: {default: true, actions: true}}},
            {id: "right", label: "靠右", input: {props: {title: "检视", collapsedWidth: 40, side: "right", layer: "nav"}, model: {collapsed: false}, slots: {default: true, actions: true}}},
            {id: "content", label: "内容层", input: {props: {title: "检视", collapsedWidth: 40, side: "left", layer: "content"}, model: {collapsed: false}, slots: {default: true, actions: true}}},
            {id: "long", label: "长内容", input: {props: {title: "很长的一列条目", collapsedWidth: 40, side: "left", layer: "nav"}, model: {collapsed: false}, slots: {default: true, actions: true}}},
        ],
        load: async () => (await import("./CollapsibleSidePanelFixture.vue")).default,
    }),
    defineLabFixture<typeof ViewportCanvas>({
        component: "ViewportCanvas", slots: ["default"],
        scenes: [
            {id: "phone", label: "手机 390×844", input: {props: {minSize: 200, showSize: true}, model: {width: 390, height: 844}, slots: {default: true}}},
            {id: "tablet", label: "平板 768×1024", input: {props: {minSize: 200, showSize: true}, model: {width: 768, height: 1024}, slots: {default: true}}},
            {id: "free", label: "不限尺寸", input: {props: {minSize: 200, showSize: true}, model: {width: 0, height: 0}, slots: {default: true}}},
        ],
        load: async () => (await import("./ViewportCanvasFixture.vue")).default,
    }),
    defineLabFixture<typeof MarkdownView>({
        component: "MarkdownView", scenes: [
            {id: "prose", label: "常规正文", input: {props: {source: "## 小标题\n\n一段普通正文，里面有 **粗体**、*斜体* 和 `行内代码`。\n\n- 列表第一项\n- 列表第二项\n\n> 引用块\n\n[外部链接](https://example.com)"}}},
            {id: "table", label: "表格与代码", input: {props: {source: "| 列 A | 列 B |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst answer: number = 42;\n```"}}},
            {id: "html", label: "内嵌 HTML（会被净化）", input: {props: {source: "下面这行的脚本会被净化掉，什么都不会发生：\n\n<script>alert(1)<\/script>\n\n<b>这个粗体标签是允许的</b>"}}},
            {id: "empty", label: "空文本", input: {props: {source: ""}}},
        ], load: async () => (await import("./MarkdownViewFixture.vue")).default,
    }),
    defineLabFixture<typeof EventLogPanel>({
        component: "EventLogPanel", scenes: [
            {id: "mixed", label: "有负载与无负载混排", input: {props: {emptyText: "还没有事件", entries: [{id: "click-1", name: "click", payload: {count: 1}}, {id: "update-1", name: "update:modelValue"}]}}},
            {id: "empty", label: "空列表", input: {props: {emptyText: "还没有事件", entries: []}}},
        ], load: async () => (await import("./EventLogPanelFixture.vue")).default,
    }),
    defineLabFixture<typeof HighlightBox>({
        component: "HighlightBox", scenes: [
            {id: "subject", label: "零件档（实线）", input: {props: {label: "EventLogPanel  320 × 180", tone: "subject", rect: {top: 80, left: 80, width: 260, height: 120}}}},
            {id: "probe", label: "探针档（虚线）", input: {props: {label: "div.flex.items-center  296 × 28", tone: "probe", rect: {top: 80, left: 80, width: 296, height: 28}}}},
            {id: "no-label", label: "只画框不带标签", input: {props: {label: "", tone: "subject", rect: {top: 80, left: 80, width: 200, height: 200}}}},
            {id: "none", label: "没有要框的东西", input: {props: {label: "看不见我", tone: "subject", rect: null}}},
        ], load: async () => (await import("./HighlightBoxFixture.vue")).default,
    }),
    defineLabFixture<typeof FixtureExample>({
        component: "FixtureExample",
        slots: ["extra"],
        scenes: [
            {
                id: "default",
                label: "默认受控卡片（居中与标准材质示范）",
                input: {
                    props: {
                        title: "章节大纲智能体编排",
                        description: "负责小说卷级与章级大纲的递归展开，维护伏笔与人物动机一致性。",
                        status: "ready",
                        count: 12,
                        active: false,
                        disabled: false,
                    },
                    slots: {extra: true},
                },
            },
            {
                id: "active",
                label: "激活态与高亮外框",
                input: {
                    props: {
                        title: "章节大纲智能体编排",
                        description: "负责小说卷级与章级大纲的递归展开，维护伏笔与人物动机一致性。",
                        status: "ready",
                        count: 12,
                        active: true,
                        disabled: false,
                    },
                    slots: {extra: true},
                },
            },
            {
                id: "busy",
                label: "忙碌呼吸状态",
                input: {
                    props: {
                        title: "正在生成第三卷剧情推演",
                        description: "后台正在计算角色动机转移概率矩阵与未回收伏笔拓扑图...",
                        status: "busy",
                        count: 99,
                        active: true,
                        disabled: false,
                    },
                    slots: {extra: true},
                },
            },
            {
                id: "warning",
                label: "警告冲突状态",
                input: {
                    props: {
                        title: "检测到人物性格设定冲突",
                        description: "角色「沈屿」在第二章的对话用词与素材库口吻约定存在 2 处偏差。",
                        status: "warning",
                        count: 2,
                        active: false,
                        disabled: false,
                    },
                    slots: {extra: false},
                },
            },
            {
                id: "disabled",
                label: "禁用态",
                input: {
                    props: {
                        title: "章节大纲智能体编排",
                        description: "负责小说卷级与章级大纲的递归展开，维护伏笔与人物动机一致性。",
                        status: "ready",
                        count: 12,
                        active: false,
                        disabled: true,
                    },
                    slots: {extra: false},
                },
            },
        ],
        load: async () => (await import("./FixtureExampleFixture.vue")).default,
    }),
    defineLabFixture<typeof JsonViewer>({
        component: "JsonViewer", scenes: [
            {id: "object", label: "对象", input: {props: {readOnly: false, maxHeight: 320}, model: {value: {id: "chapter-01", title: "第一章", wordCount: 3182, tags: ["草稿", "待审"], meta: {createdAt: "2026-08-01T10:00:00Z", author: null, pinned: false}}}}},
            {id: "array", label: "数组", input: {props: {readOnly: false, maxHeight: 320}, model: {value: [{tool: "read_file", ok: true, ms: 12}, {tool: "write_file", ok: false, ms: 340}, {tool: "list_dir", ok: true, ms: 3}]}}},
            {id: "text", label: "未写完的字符串", input: {props: {readOnly: false, maxHeight: 320}, model: {value: '{\n  "unfinished": tru'}}},
            {id: "empty", label: "空对象", input: {props: {readOnly: false, maxHeight: 320}, model: {value: {}}}},
        ], load: async () => (await import("./JsonViewerFixture.vue")).default,
    }),
    defineLabFixture<typeof SurfaceTierDemo>({
        component: "SurfaceTierDemo", noInput: "该组件没有可编辑输入",
        scenes: [{id: "default", label: "5 档对照"}],
        load: async () => (await import("./SurfaceTierDemoFixture.vue")).default,
    }),
    defineLabFixture<typeof WorkbenchCommandPalette>({
        component: "WorkbenchCommandPalette",
        noInput: "命令面板由场景的局部命令宿主驱动，没有可登记的 JSON 输入",
        scenes: [
            {id: "command-navigation", label: "命令与行号导航"},
            {id: "readonly", label: "只读文档"},
            {id: "commands-unavailable", label: "无活动编辑器"},
        ],
        load: async () => (await import("./WorkbenchCommandPaletteFixture.vue")).default,
    }),
    defineLabFixture<typeof WorkbenchShellLayout>({
        component: "WorkbenchShellLayout",
        scenes: (() => {
            const sizes = {sidebarWidth: 340, auxiliarybarWidth: 400, panelHeight: 200, panelWidth: 320};
            const panel: PanelState = {position: "bottom", alignment: "center", hidden: false, collapsed: false, maximized: false};
            const scene = (id: string, label: string, override: {panel?: Partial<PanelState>; hiddenParts?: Array<"titlebar" | "activitybar" | "sidebar" | "auxiliarybar">; dragCollapsedParts?: {sidebar?: boolean; auxiliarybar?: boolean; panel?: boolean}}) => ({
                id,
                label,
                input: {props: {sizes, panel: {...panel, ...override.panel}, contextKey: `lab:${id}`, hiddenParts: override.hiddenParts ?? [], dragCollapsedParts: override.dragCollapsedParts ?? {}, disabled: false}},
            });
            return [
                scene("default", "默认（底部居中）", {}),
                scene("justify", "底部两端对齐", {panel: {alignment: "justify"}}),
                scene("left", "面板在左侧", {panel: {position: "left"}}),
                scene("top-right", "顶部靠右", {panel: {position: "top", alignment: "right"}}),
                scene("collapsed", "面板收起为标题头", {panel: {collapsed: true}}),
                scene("maximized", "面板最大化", {panel: {maximized: true}}),
                scene("hidden", "面板隐藏、侧栏拖到零", {panel: {hidden: true}, dragCollapsedParts: {sidebar: true}}),
                scene("minimal", "只留编辑器与状态栏", {hiddenParts: ["titlebar", "activitybar", "sidebar", "auxiliarybar"], panel: {hidden: true}}),
            ];
        })(),
        load: async () => (await import("./WorkbenchShellLayoutFixture.vue")).default,
    }),
    defineSubjectFixture<typeof WorkbenchPanelSurface>({
        component: "WorkbenchPanelSurface",
        events: ["action"],
        class: "h-full w-full",
        scenes: (() => {
            const action = (id: string, label: string, icon: string, disabled = false, extra: {reason?: string; pressed?: boolean} = {}) => ({id, label, icon, disabled, ...extra});
            const actions = (side: boolean, collapsed: boolean, maximized: boolean) => [
                action("nbook.view.set-panel-position", "面板位置", "i-lucide-panel-bottom"),
                action("nbook.view.set-panel-alignment", "面板对齐", "i-lucide-align-horizontal-space-between", side, side ? {reason: "面板不在底部或顶部"} : {}),
                action("nbook.view.set-panel-collapsed", "收起为标题头", "i-lucide-chevrons-down", side, side ? {reason: "面板不在底部或顶部"} : {pressed: collapsed}),
                action("nbook.view.toggle-panel-maximized", "最大化/还原面板", "i-lucide-maximize-2", false, {pressed: maximized}),
                action("nbook.view.set-panel-hidden", "隐藏面板", "i-lucide-x"),
            ];
            return [
                {id: "default", label: "底部、全部可用", input: {props: {title: "面板", collapsed: false, actions: actions(false, false, false)}}},
                {id: "collapsed", label: "收起为标题头", input: {props: {title: "面板", collapsed: true, actions: actions(false, true, false)}}},
                {id: "side", label: "在左侧（对齐与收起不可用）", input: {props: {title: "面板", collapsed: false, actions: actions(true, false, false)}}},
                {id: "long-title", label: "长标题", input: {props: {title: "一个非常长的面板标题，用来看放不下时标题先截断、按钮保持可点", collapsed: false, actions: actions(false, false, true)}}},
            ];
        })(),
        subject: () => import("nbook/plugins/workbench/web/components/WorkbenchPanelSurface.vue"),
    }),
    defineSubjectFixture<typeof WorkbenchStatusBar>({
        component: "WorkbenchStatusBar",
        events: ["toggle-panel", "retry", "discard"],
        class: "w-full",
        scenes: [
            {id: "no-project", label: "未打开项目", input: {props: {locale: "zh-CN", project: null, panelHidden: false, panelToggleDisabled: false, problems: []}}},
            {id: "project", label: "项目名", input: {props: {locale: "zh-CN", project: "长篇小说《雾港》第二部", panelHidden: false, panelToggleDisabled: false, problems: []}}},
            {id: "unsaved", label: "布局未保存", input: {props: {locale: "zh-CN", project: "雾港", panelHidden: false, panelToggleDisabled: false, problems: [{record: "customizations", kind: "unsaved", code: "unavailable"}]}}},
            {id: "unread", label: "布局未读取", input: {props: {locale: "zh-CN", project: "雾港", panelHidden: false, panelToggleDisabled: false, problems: [{record: "side", kind: "unread", code: "corrupt"}]}}},
            {id: "hidden", label: "面板已隐藏、按钮不可用", input: {props: {locale: "en-US", project: null, panelHidden: true, panelToggleDisabled: true, problems: []}}},
        ],
        subject: () => import("nbook/plugins/workbench/web/components/WorkbenchStatusBar.vue"),
    }),
    defineSubjectFixture<typeof WorkbenchActivityBar>({
        component: "WorkbenchActivityBar",
        events: ["select"],
        class: "h-full w-[48px]",
        scenes: (() => {
            const containers = [
                {id: "view:nbook.files", label: "资源管理器", icon: "i-lucide-files"},
                {id: "view:nbook.search", label: "搜索", icon: "i-lucide-search"},
                {id: "view:nbook.outline", label: "大纲", icon: "i-lucide-list-tree"},
            ];
            const many = Array.from({length: 24}, (_, index) => ({id: `view:test.v${String(index)}`, label: `视图 ${String(index + 1)}`, icon: "i-lucide-square"}));
            return [
                {id: "default", label: "三个容器、Sidebar 可见", input: {props: {label: "活动栏", containers, selected: "view:nbook.files", sidebarVisible: true}}},
                {id: "sidebar-hidden", label: "Sidebar 隐藏：没有选中标记", input: {props: {label: "活动栏", containers, selected: "view:nbook.files", sidebarVisible: false}}},
                {id: "empty", label: "没有容器", input: {props: {label: "活动栏", containers: [], selected: null, sidebarVisible: true}}},
                {id: "many", label: "放不下时卡片内滚动", input: {props: {label: "活动栏", containers: many, selected: "view:test.v3", sidebarVisible: true}}},
            ];
        })(),
        subject: () => import("nbook/plugins/workbench/web/components/WorkbenchActivityBar.vue"),
    }),
    defineSubjectFixture<typeof WorkbenchMoveViewMenu>({
        component: "WorkbenchMoveViewMenu",
        events: ["move", "reset"],
        scenes: (() => {
            const groups = [
                {label: "侧栏", targets: [{id: "view:nbook.search", label: "搜索", icon: "i-lucide-search"}, {id: "view:nbook.outline", label: "大纲", icon: "i-lucide-list-tree"}]},
                {label: "面板", targets: [{id: "view:nbook.terminal", label: "终端", icon: "i-lucide-terminal"}]},
            ];
            const base = {label: "移动到", viewId: "nbook.files", sourceContainerId: "view:nbook.files", identity: "nbook.files|view:nbook.files|1|single"};
            return [
                {id: "default", label: "两个 Part 的目标", input: {props: {...base, groups, resetLabel: null}}},
                {id: "reset", label: "不在默认位置：可重置", input: {props: {...base, sourceContainerId: "view:nbook.search", groups, resetLabel: "重置位置"}}},
                {id: "none", label: "没有目标：禁用", input: {props: {...base, groups: [], resetLabel: null}}},
            ];
        })(),
        subject: () => import("nbook/plugins/workbench/web/components/WorkbenchMoveViewMenu.vue"),
    }),
    defineLabFixture<typeof WorkbenchViewSection>({
        component: "WorkbenchViewSection", slots: ["default", "actions"],
        scenes: (() => {
            const base = {viewId: "nbook.files", title: "资源管理器", icon: "i-lucide-files", collapseLabel: "收起视图", expandLabel: "展开视图"};
            const scene = (id: string, label: string, props: {axis: "vertical" | "horizontal"; chrome: boolean; collapsed: boolean; layout: "scroll" | "fill"}) => ({id, label, input: {props: {...base, ...props}, slots: {default: true, actions: true}}});
            return [
                scene("multiple", "multiple：标题行与动作", {axis: "vertical", chrome: true, collapsed: false, layout: "scroll"}),
                scene("collapsed", "纵向收起为 32px 标题", {axis: "vertical", chrome: true, collapsed: true, layout: "scroll"}),
                scene("horizontal-collapsed", "横向收起为 32px 竖条", {axis: "horizontal", chrome: true, collapsed: true, layout: "scroll"}),
                scene("single", "single：没有标题行", {axis: "vertical", chrome: false, collapsed: false, layout: "scroll"}),
                scene("fill", "fill：视图占满", {axis: "vertical", chrome: true, collapsed: false, layout: "fill"}),
                scene("short", "内容不满一屏", {axis: "vertical", chrome: true, collapsed: false, layout: "scroll"}),
            ];
        })(),
        load: async () => (await import("./WorkbenchViewSectionFixture.vue")).default,
    }),
    defineSubjectFixture<typeof SkillChip>({
        component: "SkillChip",
        scenes: [
            {id: "skill", label: "技能名", input: {props: {name: "novel-outline"}}},
            {id: "long-name", label: "长技能名", input: {props: {name: "novel-character-motivation-and-continuity-review"}}},
        ],
        subject: () => import("nbook/ui/SkillChip.vue"),
        class: "max-w-full",
    }),
];

export function findLabFixture(component: string): LabFixture | null {
    return labFixtures.find((fixture) => fixture.component === component) ?? null;
}
