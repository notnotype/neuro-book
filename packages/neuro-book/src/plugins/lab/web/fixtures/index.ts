import type {Component} from "vue";

import type ExplorerFeedback from "nbook/plugins/explorer/web/components/ExplorerFeedback.vue";
import type EditorArea from "nbook/plugins/editor/web/components/EditorArea.vue";
import type EditorTabBar from "nbook/plugins/editor/web/components/EditorTabBar.vue";
import type ExplorerRow from "nbook/plugins/explorer/web/components/ExplorerRow.vue";
import type ExplorerTree from "nbook/plugins/explorer/web/components/ExplorerTree.vue";
import type FilesExplorerView from "nbook/plugins/explorer/web/components/FilesExplorerView.vue";
import type BookshelfPage from "nbook/plugins/projects/web/components/BookshelfPage.vue";
import type BookSpine from "nbook/plugins/projects/web/components/BookSpine.vue";
import type ContinueCard from "nbook/plugins/projects/web/components/ContinueCard.vue";
import type ShelfList from "nbook/plugins/projects/web/components/ShelfList.vue";
import type ShelfTitlePage from "nbook/plugins/projects/web/components/ShelfTitlePage.vue";
import type SpineShelf from "nbook/plugins/projects/web/components/SpineShelf.vue";
import type JsonViewer from "nbook/ui/JsonViewer.vue";
import type SkillChip from "nbook/ui/SkillChip.vue";
import type WorkbenchActivityBar from "nbook/plugins/workbench/web/components/WorkbenchActivityBar.vue";
import type WorkbenchCommandPalette from "nbook/plugins/workbench/web/components/WorkbenchCommandPalette.vue";
import type WorkbenchDragFeedback from "nbook/plugins/workbench/web/components/WorkbenchDragFeedback.vue";
import type WorkbenchMoveViewMenu from "nbook/plugins/workbench/web/components/WorkbenchMoveViewMenu.vue";
import type WorkbenchPanelSurface from "nbook/plugins/workbench/web/components/WorkbenchPanelSurface.vue";
import type WorkbenchShellLayout from "nbook/plugins/workbench/web/components/WorkbenchShellLayout.vue";
import type WorkbenchItemStrip from "nbook/plugins/workbench/web/components/WorkbenchItemStrip.vue";
import type WorkbenchTitleBar from "nbook/plugins/workbench/web/components/WorkbenchTitleBar.vue";
import type WorkbenchStatusBar from "nbook/plugins/workbench/web/components/WorkbenchStatusBar.vue";
import type WorkbenchViewContainerHost from "nbook/plugins/workbench/web/components/WorkbenchViewContainerHost.vue";
import type WorkbenchViewFrame from "nbook/plugins/workbench/web/components/WorkbenchViewFrame.vue";
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

import {EXPLORER_ROWS, manyRows, UNBOUND_ROWS} from "./explorer-rows";
import {nbUiFixtures} from "./nb-ui";
import {SHELF_ITEM_REVISING, SHELF_ITEMS, SHELF_NOW} from "./shelf-fixture-data";
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
                // 外壳二的集成场景：工具区域里是真实的容器与视图实例（shell-scene/ShellViewsScene.vue）。
                scene("views", "视图：五个视图各在自己的容器", {}),
                scene("views-merged", "视图：大纲并进资源管理器（multiple）", {}),
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
    defineSubjectFixture<typeof WorkbenchTitleBar>({
        component: "WorkbenchTitleBar",
        events: ["run", "search", "toggle-part", "open-project", "run-item"],
        class: "w-full",
        scenes: (() => {
            const entry = (command: string, label: string, extra: {args?: Record<string, unknown>; reason?: string; shortcut?: string; checked?: boolean} = {}) => ({
                id: extra.args === undefined ? command : `${command} ${JSON.stringify(extra.args)}`, command, args: extra.args ?? {}, label,
                enabled: extra.reason === undefined, reason: extra.reason ?? null, shortcut: extra.shortcut ?? null, checked: extra.checked ?? null,
            });
            const menus = [
                {id: "file", label: "文件", sections: [[entry("nbook.project.open", "打开项目")], [entry("nbook.editor.save", "保存", {reason: "活动文档没有需要保存的修改"}), entry("nbook.editor.save-all", "全部保存")]]},
                {id: "edit", label: "编辑", sections: [[entry("nbook.edit.undo", "撤销", {reason: "没有活动的编辑器"}), entry("nbook.edit.redo", "重做", {reason: "没有活动的编辑器"})]]},
                {id: "view", label: "视图", sections: [[entry("nbook.quick-open.open-commands", "命令面板", {shortcut: "Ctrl+Shift+P"})], [entry("nbook.view.set-part-hidden", "侧栏", {args: {part: "sidebar"}, checked: true}), entry("nbook.view.set-part-hidden", "右栏", {args: {part: "auxiliarybar"}, checked: false})], [entry("nbook.app.reload", "重新载入")]]},
                {id: "help", label: "帮助", sections: [[entry("nbook.help.documentation", "文档")]]},
            ];
            const layout = {sidebar: {pressed: true, disabled: false}, panel: {pressed: true, disabled: false}, auxiliarybar: {pressed: false, disabled: false}};
            const base = {locale: "zh-CN" as const, menus, searchShortcut: "Ctrl+Shift+P", layout, items: []};
            return [
                {id: "project", label: "打开了项目", input: {props: {...base, project: "长篇小说《雾港》第二部"}}},
                {id: "no-project", label: "没有项目", input: {props: {...base, project: null}}},
                {id: "items", label: "带条目", input: {props: {...base, project: "雾港", items: [{id: "test.items.sync", text: "已同步", title: "同步状态", alignment: "right" as const, order: 0, priority: 0, command: null, tooltip: null, state: "normal" as const, disabledReason: null}]}}},
            ];
        })(),
        subject: () => import("nbook/plugins/workbench/web/components/WorkbenchTitleBar.vue"),
    }),
    defineSubjectFixture<typeof WorkbenchItemStrip>({
        component: "WorkbenchItemStrip",
        events: ["run"],
        class: "w-full",
        scenes: (() => {
            const entry = (id: string, text: string, extra: {title?: string; order?: number; priority?: number; command?: boolean; state?: "normal" | "warning" | "error"; disabledReason?: string; tooltip?: string} = {}) => ({
                id, text, title: extra.title ?? text, alignment: "right" as const, order: extra.order ?? 0, priority: extra.priority ?? 0,
                command: extra.command === true ? {id: "nbook.editor.save-all", args: {}} : null,
                tooltip: extra.tooltip ?? null, state: extra.state ?? "normal", disabledReason: extra.disabledReason ?? null,
            });
            const editor = [
                entry("nbook.editor.unsaved", "未保存 3 个", {title: "未保存的文档", order: 10, priority: 30, command: true, state: "warning", tooltip: "第一章.md、第二章.md、设定.md"}),
                entry("nbook.editor.word-count", "12,480 字", {title: "字数", order: 20, priority: 20}),
                entry("nbook.editor.cursor", "第 18 行，第 4 列", {title: "光标位置", order: 30, priority: 10}),
            ];
            return [
                {id: "editor", label: "编辑器的三个条目", input: {props: {locale: "zh-CN", entries: editor, itemHeight: 20, align: "end"}}},
                {id: "states", label: "出错、禁用与长文字", input: {props: {locale: "zh-CN", itemHeight: 20, align: "end", entries: [
                    entry("test.items.failed", "保存失败 1 个", {order: 1, priority: 5, command: true, state: "error", tooltip: "第一章.md：磁盘已满"}),
                    entry("test.items.disabled", "全部保存", {order: 2, priority: 5, command: true, disabledReason: "没有需要保存的文档"}),
                    entry("test.items.long", "一段相当长的条目文字，用来看看三百二十像素的上限与省略号在状态栏里是什么样子", {order: 3, priority: 1}),
                ]}}},
                {id: "many", label: "放不下时收进“更多”", input: {props: {locale: "zh-CN", itemHeight: 20, align: "end", entries: Array.from({length: 14}, (_, index) => entry(`test.items.n${String(index)}`, `条目 ${String(index + 1)} · 一些文字`, {order: index, priority: index % 4, command: index % 3 === 0}))}}},
            ];
        })(),
        subject: () => import("nbook/plugins/workbench/web/components/WorkbenchItemStrip.vue"),
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
                {id: "default", label: "三个容器、Sidebar 可见", input: {props: {label: "活动栏", containers, selected: "view:nbook.files", sidebarVisible: true, dragHint: "按空格拿起并拖动"}}},
                {id: "sidebar-hidden", label: "Sidebar 隐藏：没有选中标记", input: {props: {label: "活动栏", containers, selected: "view:nbook.files", sidebarVisible: false, dragHint: "按空格拿起并拖动"}}},
                {id: "empty", label: "没有容器", input: {props: {label: "活动栏", containers: [], selected: null, sidebarVisible: true, dragHint: "按空格拿起并拖动"}}},
                {id: "many", label: "放不下时卡片内滚动", input: {props: {label: "活动栏", containers: many, selected: "view:test.v3", sidebarVisible: true, dragHint: "按空格拿起并拖动"}}},
            ];
        })(),
        subject: () => import("nbook/plugins/workbench/web/components/WorkbenchActivityBar.vue"),
    }),
    defineSubjectFixture<typeof WorkbenchMoveViewMenu>({
        component: "WorkbenchMoveViewMenu",
        events: ["move", "reset"],
        scenes: (() => {
            const groups = [
                {part: "sidebar", label: "侧栏", targets: [{id: "view:nbook.search", label: "搜索", icon: "i-lucide-search"}, {id: "view:nbook.outline", label: "大纲", icon: "i-lucide-list-tree"}], createLabel: "新建容器（在侧栏）"},
                {part: "auxiliarybar", label: "右栏", targets: [], createLabel: "新建容器（在右栏）"},
                {part: "panel", label: "面板", targets: [{id: "view:nbook.terminal", label: "终端", icon: "i-lucide-terminal"}], createLabel: "新建容器（在面板）"},
            ];
            const base = {label: "移动到", viewId: "nbook.files", sourceContainerId: "view:nbook.files", identity: "nbook.files|view:nbook.files|1|single"};
            return [
                {id: "default", label: "三个 Part 的目标与新建容器", input: {props: {...base, groups, resetLabel: null}}},
                {id: "reset", label: "不在默认位置：可重置", input: {props: {...base, sourceContainerId: "view:nbook.search", groups, resetLabel: "重置位置"}}},
                {id: "none", label: "没有目标：禁用", input: {props: {...base, groups: [], resetLabel: null}}},
            ];
        })(),
        subject: () => import("nbook/plugins/workbench/web/components/WorkbenchMoveViewMenu.vue"),
    }),
    defineSubjectFixture<typeof WorkbenchDragFeedback>({
        component: "WorkbenchDragFeedback",
        events: [],
        scenes: [
            {id: "line", label: "Switcher 插入线与拖影", input: {props: {ghost: {label: "资源管理器", icon: "i-lucide-files", x: 220, y: 140}, preview: {areaRect: null, entryRect: null, indicator: {left: 180, top: 96, right: 182, bottom: 128}, orientation: "horizontal"}, label: "新建容器", kind: "detach-view", count: 1}}},
            {id: "area", label: "边缘并入的半区", input: {props: {ghost: {label: "终端", icon: "i-lucide-terminal", x: 320, y: 260}, preview: {areaRect: {left: 120, top: 200, right: 520, bottom: 320}, entryRect: null, indicator: null, orientation: "vertical"}, label: "移到这里", kind: "move-view", count: 1}}},
            {id: "idle", label: "没有拖动", input: {props: {ghost: null, preview: null, label: "", kind: "", count: 0}}},
        ],
        subject: () => import("nbook/plugins/workbench/web/components/WorkbenchDragFeedback.vue"),
    }),
    defineLabFixture<typeof WorkbenchViewContainerHost>({
        component: "WorkbenchViewContainerHost",
        scenes: (() => {
            const slot = (id: string, name: string, extra: {collapsed?: boolean; size?: number | null; layout?: "scroll" | "fill"} = {}) => ({
                id, title: {"zh-CN": name, "en-US": name}, icon: "i-lucide-square", layout: extra.layout ?? ("scroll" as const), movable: true, collapsed: extra.collapsed ?? false, size: extra.size ?? null, minSize: 64, maxSize: 1_000_000,
            });
            const container = (part: "sidebar" | "panel", views: ReturnType<typeof slot>[]) => ({
                id: "view:test.a", part, axis: part === "panel" ? ("horizontal" as const) : ("vertical" as const), title: views[0]?.title ?? {"zh-CN": "空", "en-US": "Empty"}, icon: "i-lucide-square",
                mode: views.length === 0 ? ("empty" as const) : views.length === 1 ? ("single" as const) : ("multiple" as const), members: views.map((view) => view.id), views, showContainerTitle: part === "sidebar" && views.length === 1,
            });
            const scene = (id: string, label: string, part: "sidebar" | "panel", views: ReturnType<typeof slot>[]) => ({
                id, label, input: {props: {container: container(part, views), contextKey: `lab:${id}`, disabled: false, collapseLabel: "收起视图", expandLabel: "展开视图", dragLabel: "拖动 {title}", locale: "zh-CN" as const}},
            });
            return [
                scene("vertical", "侧栏纵向三个视图", "sidebar", [slot("test.a", "资源管理器"), slot("test.b", "大纲", {size: 160}), slot("test.c", "时间线")]),
                scene("collapsed", "纵向：中间一个收起", "sidebar", [slot("test.a", "资源管理器"), slot("test.b", "大纲", {collapsed: true}), slot("test.c", "时间线")]),
                scene("horizontal", "Panel 横向两个视图，一个收起成竖条", "panel", [slot("test.a", "终端"), slot("test.b", "问题", {collapsed: true}), slot("test.c", "输出")]),
                scene("single", "single：一个视图、没有标题行", "sidebar", [slot("test.a", "资源管理器")]),
            ];
        })(),
        load: async () => (await import("./WorkbenchViewContainerHostFixture.vue")).default,
    }),
    defineSubjectFixture<typeof WorkbenchViewFrame>({
        component: "WorkbenchViewFrame",
        events: ["retry-entry", "reload", "retry-render", "render-error"],
        class: "h-full w-full",
        scenes: (() => {
            const base = {viewId: "test.files", locale: "zh-CN" as const, layout: "scroll" as const, error: null, component: null, context: null, generation: 1, busy: false};
            return [
                {id: "declared", label: "等待入口启动", input: {props: {...base, delivery: {kind: "declared" as const}, status: "waiting" as const}}},
                {id: "blocked", label: "入口受阻", input: {props: {...base, delivery: {kind: "entry-blocked" as const, reason: "missing-dependency：nbook/storage"}, status: "waiting" as const}}},
                {id: "failed", label: "入口启动失败（可重试）", input: {props: {...base, delivery: {kind: "entry-failed" as const, reason: "activation-threw"}, status: "waiting" as const}}},
                {id: "stopped", label: "入口已停止", input: {props: {...base, delivery: {kind: "entry-stopped" as const, reason: "scope-closed" as const}, status: "waiting" as const}}},
                {id: "loading", label: "加载中", input: {props: {...base, delivery: {kind: "available" as const}, status: "loading" as const}}},
                {id: "load-failed", label: "加载失败（重新加载）", input: {props: {...base, delivery: {kind: "available" as const}, status: "load-failed" as const, error: "Failed to fetch dynamically imported module"}}},
                {id: "render-failed", label: "渲染出错（重试）", input: {props: {...base, delivery: {kind: "available" as const}, status: "render-failed" as const, error: "Cannot read properties of undefined"}}},
            ];
        })(),
        subject: () => import("nbook/plugins/workbench/web/components/WorkbenchViewFrame.vue"),
    }),
    defineLabFixture<typeof WorkbenchViewSection>({
        component: "WorkbenchViewSection", slots: ["default", "actions"],
        scenes: (() => {
            const base = {viewId: "nbook.files", title: "资源管理器", icon: "i-lucide-files", collapseLabel: "收起视图", expandLabel: "展开视图", dragLabel: "拖动 资源管理器"};
            const scene = (id: string, label: string, props: {axis: "vertical" | "horizontal"; chrome: boolean; collapsed: boolean}) => ({id, label, input: {props: {...base, ...props}, slots: {default: true, actions: true}}});
            return [
                scene("multiple", "multiple：标题行与动作", {axis: "vertical", chrome: true, collapsed: false}),
                scene("collapsed", "纵向收起为 32px 标题", {axis: "vertical", chrome: true, collapsed: true}),
                scene("horizontal-collapsed", "横向收起为 32px 竖条", {axis: "horizontal", chrome: true, collapsed: true}),
                scene("single", "single：没有标题行", {axis: "vertical", chrome: false, collapsed: false}),
                scene("short", "内容不满一屏", {axis: "vertical", chrome: true, collapsed: false}),
            ];
        })(),
        load: async () => (await import("./WorkbenchViewSectionFixture.vue")).default,
    }),
    defineSubjectFixture<typeof ExplorerRow>({
        component: "ExplorerRow",
        events: ["press", "activate", "context", "retry"],
        class: "w-full",
        scenes: (() => {
            const scene = (id: string, label: string, index: number, extra: {selected?: boolean; active?: boolean; edit?: {name: string; error: string | null; busy: boolean}} = {}) => ({id, label, input: {props: {row: EXPLORER_ROWS[index] as (typeof EXPLORER_ROWS)[number], locale: "zh-CN" as const, domId: `lab-row-${id}`, selected: extra.selected ?? false, active: extra.active ?? false, height: 26, edit: extra.edit ?? null}}});
            return [
                scene("node", "内容节点：展示名与真实名字", 3),
                scene("selected", "选中并有焦点框", 3, {selected: true, active: true}),
                scene("no-body", "无正文的节点", 2),
                scene("missing", "缺失条目", 4),
                scene("unlisted", "未列入项", 5),
                scene("binder", "活页夹：需要剧情插件", 9),
                scene("manifest-error", "清单不合法", 7),
                scene("error", "读取失败", 13),
                scene("root", "根", 0),
                scene("rename", "改名：名字冲突的提示", 3, {selected: true, edit: {name: "alice", error: "已存在同名项", busy: false}}),
            ];
        })(),
        subject: () => import("nbook/plugins/explorer/web/components/ExplorerRow.vue"),
    }),
    defineSubjectFixture<typeof ExplorerTree>({
        component: "ExplorerTree",
        events: ["row-press", "row-activate", "row-context", "retry", "focus-change"],
        class: "h-full w-full",
        scenes: [
            {id: "kinds", label: "三类文件夹与状态行", input: {props: {rows: EXPLORER_ROWS, selected: ["project://lore.content/bob"], focus: "project://lore.content/bob", locale: "zh-CN", label: "文件"}}},
            {id: "many", label: "五百行：虚拟滚动与长名字", input: {props: {rows: manyRows(500), selected: [], focus: null, locale: "zh-CN", label: "文件"}}},
            {id: "english", label: "英文界面", input: {props: {rows: EXPLORER_ROWS, selected: [], focus: null, locale: "en-US", label: "Files"}}},
        ],
        runtimeProps: async () => ({handleKey: () => "none" as const}),
        subject: () => import("nbook/plugins/explorer/web/components/ExplorerTree.vue"),
    }),
    defineSubjectFixture<typeof ExplorerFeedback>({
        component: "ExplorerFeedback",
        events: ["dismiss"],
        class: "w-full",
        scenes: [
            {id: "editor-missing", label: "编辑器尚未接入", input: {props: {locale: "zh-CN", notice: {kind: "editor-missing", address: "project://lore.content/bob/index.md"}}}},
            {id: "open-failed", label: "打开失败、长路径", input: {props: {locale: "zh-CN", notice: {kind: "open-failed", address: "project://一个非常深的目录/再深一层/还有一层/第一百二十三章 一个相当长的章节标题.md", reason: "not-text：文件含 NUL，不是文本"}}}},
            {id: "none", label: "没有提示", input: {props: {locale: "zh-CN", notice: null}}},
        ],
        subject: () => import("nbook/plugins/explorer/web/components/ExplorerFeedback.vue"),
    }),
    defineLabFixture<typeof FilesExplorerView>({
        component: "FilesExplorerView",
        scenes: (() => {
            const base = {locale: "zh-CN" as const, rows: EXPLORER_ROWS, selected: [], focus: null, showManifests: false, ready: true, notice: null, problem: null};
            return [
                // 集成场景：真实的视图宿主、控制器与命令，文件换成内存适配器；输入只是占位，场景不读它。
                {id: "live", label: "内存数据：真实控制器与命令", input: {props: base}},
                {id: "default", label: "浏览", input: {props: base}},
                {id: "unbound", label: "未打开项目、用户资产停止同步", input: {props: {...base, rows: UNBOUND_ROWS}}},
                {id: "unsaved", label: "偏好未保存、编辑器尚未接入", input: {props: {...base, showManifests: true, problem: {kind: "unsaved" as const, code: "conflict"}, notice: {kind: "editor-missing" as const, address: "project://plain/a.md"}}}},
                {id: "loading", label: "偏好还在读取", input: {props: {...base, ready: false}}},
                {id: "delete", label: "删除确认：多项与长路径", input: {props: {...base, dialog: {kind: "delete" as const, items: Array.from({length: 12}, (_, index) => ({address: `project://一个很深的目录/第${String(index + 1)}章 一个相当长的章节标题.md`, token: `t${String(index)}`})), busy: false, unsaved: ["project://一个很深的目录/第1章 一个相当长的章节标题.md"]}}}},
                {id: "dirty-copy", label: "复制有未保存修改的文件", input: {props: {...base, dialog: {kind: "dirty-copy" as const, documents: ["project://chapters/第一章.md", "project://chapters/第二章.md"]}}}},
                {id: "report", label: "删除部分失败、进行中", input: {props: {...base, running: {action: "delete" as const, count: 3}, report: {action: "delete" as const, items: [
                    {address: "project://plain", target: null, result: {status: "failed" as const, code: "permission-denied", detail: "没有权限", partial: {removed: {paths: ["plain/a.md", "plain/b.md"], truncated: false}}}},
                    {address: "project://a.md", target: null, result: {status: "done" as const}},
                    {address: "project://b.md", target: null, result: {status: "not-run" as const, reason: "stopped" as const}},
                ], manifests: [{path: "lore.content/content.xml", status: "failed" as const, detail: "写不进去"}], truncated: false}}}},
                {id: "collision", label: "粘贴碰撞：长路径与名字不能用", input: {props: {...base, dialog: {kind: "collision" as const, action: "copy" as const, source: "project://一个很深的目录/再深一层/第一百二十三章 一个相当长的章节标题.md", target: "project://另一个目录/第一百二十三章 一个相当长的章节标题.md", candidate: "第一百二十三章 一个相当长的章节标题 (2).md", error: {code: "conflict" as const}, busy: false as const}}}},
                {id: "unknown", label: "结果未知、剪切中、移动部分失败", input: {props: {
                    ...base,
                    rows: EXPLORER_ROWS.map((row) => (row.kind === "entry" && row.id === "project://lore.content/stray.md" ? {...row, cut: true} : row)),
                    unknown: {action: "move" as const, clipboard: 1, items: [{address: "project://plain/a.md", target: "project://lore.content/a.md"}, {address: "project://plain/z.md", target: "project://lore.content/z.md"}]},
                    report: {action: "move" as const, manifests: [], truncated: false, items: [
                        {address: "project://plain/a.md", target: "project://plain/sub/a.md", result: {status: "done" as const}},
                        {address: "project://plain/z.md", target: "project://plain/sub/z.md", result: {status: "failed" as const, code: "conflict", detail: "目标已存在"}},
                        {address: "project://plain/y.md", target: "project://plain/sub/y.md", result: {status: "declined" as const, reason: "skip" as const}},
                    ]},
                }}},
            ];
        })(),
        load: async () => (await import("./FilesExplorerViewFixture.vue")).default,
    }),
    defineLabFixture<typeof EditorArea>({
        component: "EditorArea",
        // 集成场景：真实的编辑器区控制器、文档模型与控件，文件换成内存适配器；输入只给界面语言。
        scenes: [
            {id: "live", label: "内存数据：两个标签", input: {props: {locale: "zh-CN"}}},
            {id: "split", label: "向右拆分的两组", input: {props: {locale: "zh-CN"}}},
            {id: "english", label: "英文界面", input: {props: {locale: "en-US"}}},
        ],
        load: async () => (await import("./editor-scene/EditorAreaFixture.vue")).default,
    }),
    defineSubjectFixture<typeof EditorTabBar>({
        component: "EditorTabBar",
        events: ["activate", "pin", "close", "move"],
        class: "w-full",
        scenes: (() => {
            const tab = (id: string, label: string, extra: {preview?: boolean; dirty?: boolean; active?: boolean} = {}) => ({id, label, title: `project://chapters/${label}`, preview: extra.preview ?? false, dirty: extra.dirty ?? false, active: extra.active ?? false});
            const base = {label: "打开的编辑器", unsavedLabel: "未保存"};
            return [
                {id: "mixed", label: "预览、未保存与活动标签", input: {props: {...base, tabs: [tab("t1", "第一章.md", {dirty: true}), tab("t2", "第二章.md", {active: true}), tab("t3", "第三章.md", {preview: true})]}}},
                {id: "many", label: "放不下时横向滚动", input: {props: {...base, tabs: Array.from({length: 18}, (_, index) => tab(`t${String(index)}`, `第${String(index + 1)}章 一个相当长的章节标题.md`, {active: index === 9, dirty: index % 4 === 0}))}}},
                {id: "single", label: "只有一个预览标签", input: {props: {...base, tabs: [tab("t1", "第一章.md", {preview: true, active: true})]}}},
            ];
        })(),
        runtimeProps: async () => ({closeLabel: (name: string) => `关闭 ${name}`}),
        subject: () => import("nbook/plugins/editor/web/components/EditorTabBar.vue"),
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
    ...shelfFixtures(),
    ...nbUiFixtures,
];

/** 书架页（docs/proposals/bookshelf.md）：静态稿给开发者看，也是页面接上真实数据之后的回归场景。 */
function shelfFixtures(): LabFixture[] {
    const [first, second, third, , long] = SHELF_ITEMS as [typeof SHELF_ITEMS[number], ...typeof SHELF_ITEMS];
    const page = {locale: "zh-CN" as const, status: "ready" as const, items: SHELF_ITEMS, now: SHELF_NOW};
    return [
        defineSubjectFixture<typeof BookshelfPage>({
            component: "BookshelfPage",
            events: ["continue", "open", "open-new-window", "edit", "remove", "create", "add-existing", "enter-workbench", "retry"],
            class: "h-full w-full",
            scenes: [
                {id: "spines", label: "书脊视图，选中一部", input: {props: page, model: {view: "spines", sort: "recent", activeId: first.id}}},
                {id: "spines-none-selected", label: "书脊视图，未选中", input: {props: page, model: {view: "spines", sort: "title", activeId: null}}},
                {id: "list", label: "列表视图", input: {props: page, model: {view: "list", sort: "words", activeId: null}}},
                {id: "one", label: "只有一部", input: {props: {...page, items: [second]}, model: {view: "spines", sort: "recent", activeId: second.id}}},
                {id: "no-record", label: "有作品但没有写作记录", input: {props: {...page, items: [SHELF_ITEMS[3]!]}, model: {view: "spines", sort: "recent", activeId: null}}},
                {id: "empty", label: "空书架", input: {props: {...page, items: []}, model: {view: "spines", sort: "recent", activeId: null}}},
                {id: "loading", label: "加载中", input: {props: {...page, status: "loading", items: []}, model: {view: "spines", sort: "recent", activeId: null}}},
                {id: "error", label: "取数失败", input: {props: {...page, status: "error", error: "书架没取到：服务端暂时不可用", items: []}, model: {view: "spines", sort: "recent", activeId: null}}},
                {id: "english", label: "英文界面", input: {props: {...page, locale: "en-US"}, model: {view: "spines", sort: "recent", activeId: third.id}}},
            ],
            subject: () => import("nbook/plugins/projects/web/components/BookshelfPage.vue"),
        }),
        defineSubjectFixture<typeof ContinueCard>({
            component: "ContinueCard",
            events: ["continue"],
            class: "w-full",
            scenes: [
                {id: "fresh", label: "正在写（统计最新）", input: {props: {locale: "zh-CN", item: first, now: SHELF_NOW}}},
                {id: "stale", label: "前天写的（统计过期）", input: {props: {locale: "zh-CN", item: second, now: SHELF_NOW}}},
                {id: "revising", label: "今天净删", input: {props: {locale: "zh-CN", item: SHELF_ITEM_REVISING, now: SHELF_NOW}}},
            ],
            subject: () => import("nbook/plugins/projects/web/components/ContinueCard.vue"),
        }),
        defineSubjectFixture<typeof SpineShelf>({
            component: "SpineShelf",
            events: ["open", "remove", "create", "add-existing"],
            class: "w-full",
            scenes: [
                {id: "shelf", label: "一排书", input: {props: {locale: "zh-CN", items: SHELF_ITEMS}, model: {activeId: first.id}}},
                {id: "many", label: "放不下换层", input: {props: {locale: "zh-CN", items: [...SHELF_ITEMS, ...SHELF_ITEMS, ...SHELF_ITEMS].map((item, index) => ({...item, id: `${item.id}-${String(index)}`}))}, model: {activeId: null}}},
                {id: "empty", label: "空书架", input: {props: {locale: "zh-CN", items: []}, model: {activeId: null}}},
            ],
            subject: () => import("nbook/plugins/projects/web/components/SpineShelf.vue"),
        }),
        defineSubjectFixture<typeof BookSpine>({
            component: "BookSpine",
            class: "",
            scenes: [
                {id: "generated", label: "生成的色档", input: {props: {id: "spine-a", title: "长夜行", width: 52, height: 214, hue: 3, color: null, active: false, running: false, runningLabel: "已在一个窗口里打开"}}},
                {id: "custom-light", label: "作者给的浅色", input: {props: {id: "spine-b", title: "短篇集", width: 34, height: 200, hue: 0, color: "#d9c9a3", active: false, running: false, runningLabel: "已在一个窗口里打开"}}},
                {id: "active-running", label: "选中且已打开", input: {props: {id: "spine-c", title: "北方以北", width: 46, height: 220, hue: 0, color: "#7a4b3a", active: true, running: true, runningLabel: "已在一个窗口里打开"}}},
                {id: "long", label: "书名放不下", input: {props: {id: "spine-d", title: long.title ?? long.name, width: 30, height: 208, hue: 5, color: null, active: false, running: false, runningLabel: "已在一个窗口里打开"}}},
            ],
            subject: () => import("nbook/plugins/projects/web/components/BookSpine.vue"),
        }),
        defineSubjectFixture<typeof ShelfTitlePage>({
            component: "ShelfTitlePage",
            events: ["open", "open-new-window", "edit", "remove"],
            class: "w-full",
            scenes: [
                {id: "running", label: "正在打开", input: {props: {locale: "zh-CN", item: first, now: SHELF_NOW}}},
                {id: "stale", label: "统计过期", input: {props: {locale: "zh-CN", item: second, now: SHELF_NOW}}},
                {id: "none", label: "尚未统计、没有书名", input: {props: {locale: "zh-CN", item: SHELF_ITEMS[3]!, now: SHELF_NOW}}},
                {id: "long", label: "长书名与长路径", input: {props: {locale: "zh-CN", item: long, now: SHELF_NOW}}},
            ],
            subject: () => import("nbook/plugins/projects/web/components/ShelfTitlePage.vue"),
        }),
        defineSubjectFixture<typeof ShelfList>({
            component: "ShelfList",
            events: ["open", "open-new-window", "edit", "remove", "create", "add-existing"],
            class: "w-full",
            scenes: [
                {id: "books", label: "几部作品", input: {props: {locale: "zh-CN", items: SHELF_ITEMS, now: SHELF_NOW}}},
                {id: "english", label: "英文界面", input: {props: {locale: "en-US", items: SHELF_ITEMS, now: SHELF_NOW}}},
                {id: "empty", label: "空书架", input: {props: {locale: "zh-CN", items: [], now: SHELF_NOW}}},
            ],
            subject: () => import("nbook/plugins/projects/web/components/ShelfList.vue"),
        }),
    ];
}

export function findLabFixture(component: string): LabFixture | null {
    return labFixtures.find((fixture) => fixture.component === component) ?? null;
}
