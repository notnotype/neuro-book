import type {Component} from "vue";

import type ExplorerFeedback from "nbook/plugins/explorer/web/components/ExplorerFeedback.vue";
import type EditorGroup from "nbook/plugins/editor/web/components/EditorGroup.vue";
import type HtmlPreview from "nbook/plugins/html-preview/web/components/HtmlPreview.vue";
import type ImageViewer from "nbook/plugins/image-viewer/web/components/ImageViewer.vue";
import type EditorBreadcrumbs from "nbook/plugins/editor/web/components/EditorBreadcrumbs.vue";
import type EditorTabBar from "nbook/plugins/editor/web/components/EditorTabBar.vue";
import {fileIconForName} from "nbook/ui/file-icons/file-icons";
import type ExplorerRow from "nbook/plugins/explorer/web/components/ExplorerRow.vue";
import type ExplorerTree from "nbook/plugins/explorer/web/components/ExplorerTree.vue";
import type FilesExplorerView from "nbook/plugins/explorer/web/components/FilesExplorerView.vue";
import type FileIcon from "nbook/ui/file-icons/FileIcon.vue";
import type {InlineChip} from "@notnotype/nb-markdown/chip";
import type {MarkdownDisplay, MarkdownImage} from "@notnotype/nb-markdown/display";
import type {PromptAttachmentStrip, PromptEditor, PromptPasteFrame, PromptTextView} from "@notnotype/nb-markdown/prompt";
import type BookCard from "nbook/plugins/projects/web/components/BookCard.vue";
import type WelcomePage from "nbook/plugins/projects/web/components/WelcomePage.vue";
import type BookCover from "nbook/plugins/projects/web/components/BookCover.vue";
import type BookshelfPage from "nbook/plugins/projects/web/components/BookshelfPage.vue";
import type FileBrowser from "nbook/plugins/projects/web/components/FileBrowser.vue";
import type PathPickerDialog from "nbook/plugins/projects/web/components/PathPickerDialog.vue";
import type ProjectInfoDialog from "nbook/plugins/projects/web/components/ProjectInfoDialog.vue";
import type ShelfCards from "nbook/plugins/projects/web/components/ShelfCards.vue";
import type ShelfDesk from "nbook/plugins/projects/web/components/ShelfDesk.vue";
import type ShelfList from "nbook/plugins/projects/web/components/ShelfList.vue";
import type PluginsPage from "nbook/plugins/plugins/web/components/PluginsPage.vue";
import type AddProviderDialog from "nbook/plugins/models/web/components/AddProviderDialog.vue";
import type AllModelsView from "nbook/plugins/models/web/components/AllModelsView.vue";
import type CapabilityIcons from "nbook/plugins/models/web/components/CapabilityIcons.vue";
import type HeadersEditor from "nbook/plugins/models/web/components/HeadersEditor.vue";
import type ManageModelsDialog from "nbook/plugins/models/web/components/ManageModelsDialog.vue";
import type ModelEditDialog from "nbook/plugins/models/web/components/ModelEditDialog.vue";
import type ModelRow from "nbook/plugins/models/web/components/ModelRow.vue";
import type ProviderDetail from "nbook/plugins/models/web/components/ProviderDetail.vue";
import type ProviderRail from "nbook/plugins/models/web/components/ProviderRail.vue";
import type PermissionRulesPage from "nbook/plugins/agent/web/components/PermissionRulesPage.vue";
import type ProvidersPage from "nbook/plugins/models/web/components/ProvidersPage.vue";
import type RolesPage from "nbook/plugins/models/web/components/RolesPage.vue";
import type WorksSettingsPage from "nbook/plugins/projects/web/components/WorksSettingsPage.vue";
import type {ShelfItem} from "nbook/plugins/projects/shared/shelf";
import type SettingsWindow from "nbook/plugins/settings/web/components/SettingsWindow.vue";
import type NeuroBookLockup from "nbook/ui/brand/NeuroBookLockup.vue";
import type NeuroBookMark from "nbook/ui/brand/NeuroBookMark.vue";
import type NeuroBookMood from "nbook/ui/brand/NeuroBookMood.vue";
import type JsonViewer from "nbook/ui/JsonViewer.vue";
import type HighlightedText from "nbook/ui/settings/HighlightedText.vue";
import type SettingsPageActions from "nbook/ui/settings/SettingsPageActions.vue";
import type SettingsSaveBar from "nbook/ui/settings/SettingsSaveBar.vue";
import type SettingsPageList from "nbook/ui/settings/SettingsPageList.vue";
import type SettingsRow from "nbook/ui/settings/SettingsRow.vue";
import type SkillChip from "nbook/ui/SkillChip.vue";
import type ThemeEditor from "nbook/plugins/workbench/web/components/theme-editor/ThemeEditor.vue";
import type ThemeSettingsPage from "nbook/plugins/workbench/web/components/theme-editor/ThemeSettingsPage.vue";
import type WorkbenchActivityBar from "nbook/plugins/workbench/web/components/WorkbenchActivityBar.vue";
import type WorkbenchCommandPalette from "nbook/plugins/workbench/web/components/WorkbenchCommandPalette.vue";
import type WorkbenchDragFeedback from "nbook/plugins/workbench/web/components/WorkbenchDragFeedback.vue";
import type WorkbenchMoveViewMenu from "nbook/plugins/workbench/web/components/WorkbenchMoveViewMenu.vue";
import type WorkbenchPanelSurface from "nbook/plugins/workbench/web/components/WorkbenchPanelSurface.vue";
import type WorkbenchShellLayout from "nbook/plugins/workbench/web/components/WorkbenchShellLayout.vue";
import type WorkbenchSurface from "nbook/plugins/workbench/web/components/WorkbenchSurface.vue";
import type WorkbenchPanelHead from "nbook/plugins/workbench/web/components/WorkbenchPanelHead.vue";
import type WorkbenchToolStrip from "nbook/plugins/workbench/web/components/WorkbenchToolStrip.vue";
import type WorkbenchItemStrip from "nbook/plugins/workbench/web/components/WorkbenchItemStrip.vue";
import type WorkbenchTitleBar from "nbook/plugins/workbench/web/components/WorkbenchTitleBar.vue";
import type WorkbenchStatusBar from "nbook/plugins/workbench/web/components/WorkbenchStatusBar.vue";
import type WorkbenchViewContainerHost from "nbook/plugins/workbench/web/components/WorkbenchViewContainerHost.vue";
import type WorkbenchViewFrame from "nbook/plugins/workbench/web/components/WorkbenchViewFrame.vue";
import type TitleActions from "nbook/ui/menus/TitleActions.vue";
import type WorkbenchViewSection from "nbook/plugins/workbench/web/components/WorkbenchViewSection.vue";
import type {PanelState} from "nbook/plugins/workbench/web/shell/panel-state";
import {localeSetting} from "nbook/plugins/settings/shared/contracts";
import {appearanceSetting} from "nbook/plugins/workbench/shared/contracts";

import type CollapsibleSidePanel from "../components/CollapsibleSidePanel.vue";
import type EventLogPanel from "../components/EventLogPanel.vue";
import type FixtureExample from "../components/FixtureExample.vue";
import type HighlightBox from "../components/HighlightBox.vue";
import type MarkdownView from "../components/MarkdownView.vue";
import type SurfaceTierDemo from "../components/SurfaceTierDemo.vue";
import type ViewportCanvas from "../components/ViewportCanvas.vue";
import type {LabInputOf, LabJsonPropOf, LabSlotOf, LabSubjectProps} from "../lab-subject";

import {EXPLORER_ROWS, manyRows, UNBOUND_ROWS} from "./explorer-rows";
import {withExplorerText} from "./explorer-scene/explorer-text";
import {withProjectsText} from "./projects-scene/projects-text";
import {withAgentPageText} from "./agent-scene/agent-page-text";
import {withModelsText} from "./models-scene/models-text";
import {SAMPLE_CANDIDATES, SAMPLE_CATALOG, SAMPLE_PROVIDERS} from "./models-scene/sample";
import {withSettingsText} from "./settings-scene/settings-text";
import {withWorkbenchText} from "./workbench-scene/workbench-text";
import {withNbookMarkdownHost} from "./markdown-host";
import {withMarkdownSceneText} from "./markdown-text";
import {nbAgentUiFixtures} from "./nb-agent-ui";
import {nbFormFixtures} from "./nb-form";
import {nbLayoutFixtures} from "./nb-layout";
import {nbUiFixtures} from "./nb-ui";
import {PROMPT_LAB_THUMBNAILS, promptAttachmentStripScenes, promptEditorScenes, promptPasteFrameScenes, promptTextViewScenes} from "./prompt-scene/scenes";
import {SHELF_COVER_SRC, SHELF_ITEMS, SHELF_ITEM_REVISING, SHELF_NOW} from "./shelf-fixture-data";
import {rowDemoSettings, sceneThemeSetting, SETTINGS_WINDOW_SCENES, snippetsSettings} from "./settings-scene/scene-settings";
import {createSubjectFixture, defineSubjectFixture} from "./subject-fixture";

/** MarkdownDisplay 场景用的回复：每种内置方言各一段，加引用小块、外部链接与图片。 */
const DISPLAY_REPLY = [
    "我读了[<comment body=\"她第一次出场\">林</comment>雪](/设定/林雪.md)的设定和[第三章](/正文/第三章.md)，有三处可以改：",
    "",
    "1. 开头<ruby text=\"jì tán\">祭坛</ruby>的描写偏长，==可以压到两句==。",
    "2. 对话里的 <kbd>Ctrl</kbd> 是笔误，H<sub>2</sub>O 与 x<sup>2</sup> 也要统一写法。",
    "",
    "> [!WARNING]- 伏笔会提前暴露",
    "> 第二段直接说出了她的来历，读者在第五章前不该知道。",
    "",
    "<align value=\"center\">",
    "—— 改写示例 ——",
    "</align>",
    "",
    "<bilingual text=\"老人缓缓走向祭坛。\">",
    "The old man walked slowly toward the altar.",
    "</bilingual>",
    "",
    "<html>",
    "<div style=\"padding:8px;border:1px solid #ccc\"><b>人物卡</b>：林雪，二十岁</div>",
    "</html>",
    "",
    "![示意图](/资料/地图.png)",
    "",
    "参考：[写作手册](https://example.com/guide)。",
].join("\n");

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
        load: async () => withWorkbenchText((await import("./WorkbenchShellLayoutFixture.vue")).default),
    }),
    defineLabFixture<typeof WorkbenchSurface>({
        component: "WorkbenchSurface",
        // 文档与呈现树由夹具自己算（它扮演工作台），不是 JSON 输入；输入只是占位（类型要求登记必填的 doc、projection），夹具不读它。断言见 e2e/lab-workbench-surface.e2e.ts。
        scenes: (() => {
            const leaf = {kind: "leaf" as const, id: "g0", ref: "panel:g0"};
            const base = {
                contextKey: "lab:surface",
                doc: {version: 1 as const, tree: {version: 2 as const, root: {...leaf, size: {width: 0, height: 0}}}, panels: {g0: {role: "editor" as const, tabs: [], active: null}}, floats: [], hiddenBars: [], currentEditor: "g0"},
                projection: {input: leaf},
            };
            return [
                {id: "default", label: "侧栏、两个编辑组、右栏、面板（平铺）", input: {props: base}},
                {id: "cards", label: "卡片：缝、圆角、相连按邻接算", input: {props: base}},
            ];
        })(),
        load: async () => (await import("./WorkbenchSurfaceFixture.vue")).default,
    }),
    defineSubjectFixture<typeof WorkbenchPanelHead>({
        component: "WorkbenchPanelHead",
        events: ["activate", "action", "context-menu"],
        writeBack: {activate: {layer: "props", key: "active"}},
        class: "w-full",
        scenes: (() => {
            const tab = (id: string, label: string, icon: string) => ({id: `view:${id}`, label, icon});
            const tabs = [tab("files", "资源管理器", "i-lucide-files"), tab("search", "搜索", "i-lucide-search"), tab("outline", "大纲", "i-lucide-list-tree"), tab("chat", "对话", "i-lucide-message-square"), tab("output", "输出", "i-lucide-terminal")];
            const named = [
                {id: "collapse", label: "收起", icon: "i-lucide-chevrons-down", disabled: false, pressed: false},
                {id: "maximize", label: "最大化", icon: "i-lucide-maximize-2", disabled: false, pressed: false},
                {id: "hide", label: "隐藏", icon: "i-lucide-x", disabled: false},
            ];
            const base = {panelId: "sidebar", label: "侧栏", moreLabel: "更多", active: "view:files"};
            return [
                {id: "default", label: "几个标签、框架按钮", input: {props: {...base, tabs: tabs.slice(0, 3), frameActions: named}}},
                {id: "many", label: "标签多：放不下时逐级让位（拖窄画布看）", input: {props: {...base, tabs, frameActions: named}}},
                {id: "anonymous", label: "无名面板：没有隐藏按钮", input: {props: {...base, panelId: "p-1", label: "面板", tabs: tabs.slice(0, 2), frameActions: named.slice(0, 2)}}},
                {id: "disabled", label: "框架按钮不可用", input: {props: {...base, tabs: tabs.slice(0, 2), frameActions: [{...named[0]!, disabled: true, reason: "编辑组不能收起"}, named[1]!, named[2]!]}}},
                {id: "empty", label: "没有标签：显示名称", input: {props: {...base, tabs: [], active: null, frameActions: named}}},
            ];
        })(),
        subject: () => import("nbook/plugins/workbench/web/components/WorkbenchPanelHead.vue"),
    }),
    defineSubjectFixture<typeof WorkbenchToolStrip>({
        component: "WorkbenchToolStrip",
        events: ["select", "run-item"],
        class: "h-full",
        scenes: (() => {
            const entry = (id: string, label: string, icon: string, pressed: boolean) => ({id, label, icon, pressed});
            const entries = [entry("files", "资源管理器", "i-lucide-files", true), entry("search", "搜索", "i-lucide-search", false), entry("outline", "大纲", "i-lucide-list-tree", false), entry("chat", "对话", "i-lucide-message-square", true)];
            const items = [
                {id: "profile", title: "个人资料尚未开放", icon: "i-lucide-user", interactive: false, pressed: null, disabledReason: null},
                {id: "settings", title: "设置", icon: "i-lucide-settings", interactive: true, pressed: true, disabledReason: null},
                {id: "sync", title: "同步", icon: "i-lucide-refresh-cw", interactive: true, pressed: null, disabledReason: "没有打开项目"},
            ];
            const base = {label: "活动栏", moreLabel: "更多"};
            return [
                {id: "default", label: "两个视图同时按下，底段全局项", input: {props: {...base, entries, items}}},
                {id: "many", label: "视图多：放不下时后面的收进“更多”，按下的总在外面", input: {props: {...base, entries: [...Array.from({length: 24}, (_, index) => entry(`v${String(index)}`, `视图 ${String(index)}`, "i-lucide-square", false)), entry("last", "排在最后的可见视图", "i-lucide-star", true)], items}}},
                {id: "empty", label: "没有视图", input: {props: {...base, entries: [], items}}},
            ];
        })(),
        subject: () => import("nbook/plugins/workbench/web/components/WorkbenchToolStrip.vue"),
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
    defineLabFixture<typeof ThemeEditor>({
        component: "ThemeEditor",
        scenes: [
            {id: "empty", label: "还没有我的主题", input: {props: {themes: [], closable: true}}},
            {id: "loading", label: "正在读取我的主题", input: {props: {themes: [], closable: true}}},
            {id: "basic", label: "基本信息", input: {props: {themes: [], closable: true}}},
            {id: "colors", label: "配色（主色、分组、行内对比度）", input: {props: {themes: [], closable: true}}},
            {id: "dark", label: "配色，编辑暗色", input: {props: {themes: [], closable: true}}},
            {id: "fonts", label: "字体", input: {props: {themes: [], closable: true}}},
            {id: "chrome", label: "活动栏与画框", input: {props: {themes: [], closable: true}}},
            {id: "scene", label: "场景与取景（还没有场景图）", input: {props: {themes: [], closable: true}}},
            {id: "scene-full", label: "场景与取景（有工作态场景、提供者未发布）", input: {props: {themes: [], closable: true}}},
            {id: "icons", label: "图标（有两个覆盖）", input: {props: {themes: [], closable: true}}},
            {id: "icons-empty", label: "图标（还没有覆盖）", input: {props: {themes: [], closable: true}}},
            {id: "contrast", label: "对比度检查：没有不合格项", input: {props: {themes: [], closable: true}}},
            {id: "failing", label: "对比度检查：弱化文字太淡", input: {props: {themes: [], closable: true}}},
            {id: "colors-english", label: "配色，英文界面", input: {props: {themes: [], closable: true}}},
        ],
        load: async () => withWorkbenchText((await import("./ThemeEditorFixture.vue")).default, ["colors-english"]),
    }),
    defineLabFixture<typeof ThemeSettingsPage>({
        component: "ThemeSettingsPage",
        scenes: (() => {
            const entry = (id: string, plugin: string, title: string, titleEn: string, colors?: Record<string, string>) => ({id, plugin, declaration: {title: {"zh-CN": title, "en-US": titleEn}, base: "nbook" as const, light: colors === undefined ? {} : {colors}, dark: {}}});
            const builtin = [entry("nbook", "nbook.workbench", "NeuroBook", "NeuroBook"), entry("macos", "nbook.workbench", "macOS", "macOS")];
            const mine = [entry("user:00000000-0000-4000-8000-000000000001", "user", "夜读", "Night reading", {"--bg-main": "#f3ead8", "--text-main": "#2e261c", "--accent-main": "#8a5a24"}), entry("user:00000000-0000-4000-8000-000000000002", "user", "雨窗", "Rainy window", {"--bg-main": "#dfe8ee", "--text-main": "#1c2a36", "--accent-main": "#3b6f8f"})];
            return [
                {id: "empty", label: "还没有我的主题", input: {props: {themes: builtin, currentId: "nbook", appearance: "light"}}},
                {id: "mine", label: "两套我的主题，其中一套在用", input: {props: {themes: [...builtin, ...mine], currentId: "user:00000000-0000-4000-8000-000000000001", appearance: "light"}}},
                {id: "mine-english", label: "英文界面", input: {props: {themes: [...builtin, ...mine], currentId: "nbook", appearance: "light"}}},
            ];
        })(),
        load: async () => withWorkbenchText(createSubjectFixture<typeof ThemeSettingsPage>((await import("nbook/plugins/workbench/web/components/theme-editor/ThemeSettingsPage.vue")).default, {events: ["open"], class: "w-full max-w-[720px] p-6"}), ["mine-english"]),
    }),
    defineLabFixture<typeof WorkbenchStatusBar>({
        component: "WorkbenchStatusBar",
        scenes: [
            {id: "no-project", label: "未打开项目", input: {props: {project: null, panelHidden: false, panelToggleDisabled: false, problems: []}}},
            {id: "project", label: "项目名", input: {props: {project: "长篇小说《雾港》第二部", panelHidden: false, panelToggleDisabled: false, problems: []}}},
            {id: "unsaved", label: "布局未保存", input: {props: {project: "雾港", panelHidden: false, panelToggleDisabled: false, problems: [{record: "customizations", kind: "unsaved", code: "unavailable"}]}}},
            {id: "unread", label: "布局未读取", input: {props: {project: "雾港", panelHidden: false, panelToggleDisabled: false, problems: [{record: "side", kind: "unread", code: "corrupt"}]}}},
            {id: "hidden", label: "面板已隐藏、按钮不可用", input: {props: {project: null, panelHidden: true, panelToggleDisabled: true, problems: []}}},
        ],
        // 场景 `hidden` 一直是英文界面，id 被引用，所以点名。
        load: async () => withWorkbenchText(createSubjectFixture<typeof WorkbenchStatusBar>((await import("nbook/plugins/workbench/web/components/WorkbenchStatusBar.vue")).default, {events: ["toggle-panel", "retry", "discard"], class: "w-full"}), ["hidden"]),
    }),
    defineLabFixture<typeof WorkbenchTitleBar>({
        component: "WorkbenchTitleBar",
        scenes: (() => {
            const entry = (command: string, label: string, extra: {args?: Record<string, unknown>; reason?: string; shortcut?: string; checked?: boolean} = {}) => ({
                id: extra.args === undefined ? command : `${command} ${JSON.stringify(extra.args)}`, command, args: extra.args ?? {}, label,
                enabled: extra.reason === undefined, reason: extra.reason ?? null, shortcut: extra.shortcut ?? null, checked: extra.checked ?? null,
                context: null, icon: null, placement: "inline" as const,
            });
            const menus = [
                {id: "file", label: "文件", sections: [[entry("nbook.project.open", "打开项目")], [entry("nbook.editor.save", "保存", {reason: "活动文档没有需要保存的修改"}), entry("nbook.editor.save-all", "全部保存")]]},
                {id: "edit", label: "编辑", sections: [[entry("nbook.edit.undo", "撤销", {reason: "没有活动的编辑器"}), entry("nbook.edit.redo", "重做", {reason: "没有活动的编辑器"})]]},
                {id: "view", label: "视图", sections: [[entry("nbook.quick-open.open-commands", "命令面板", {shortcut: "Ctrl+Shift+P"})], [entry("nbook.view.set-part-hidden", "侧栏", {args: {part: "sidebar"}, checked: true}), entry("nbook.view.set-part-hidden", "右栏", {args: {part: "auxiliarybar"}, checked: false})], [entry("nbook.app.reload", "重新载入")]]},
                {id: "help", label: "帮助", sections: [[entry("nbook.help.documentation", "文档")]]},
            ];
            const layout = {sidebar: {pressed: true, disabled: false}, panel: {pressed: true, disabled: false}, auxiliarybar: {pressed: false, disabled: false}};
            const base = {menus, searchShortcut: "Ctrl+Shift+P", layout, items: []};
            return [
                {id: "project", label: "打开了项目", input: {props: {...base, project: "长篇小说《雾港》第二部"}}},
                {id: "no-project", label: "没有项目", input: {props: {...base, project: null}}},
                {id: "items", label: "带条目", input: {props: {...base, project: "雾港", items: [{id: "test.items.sync", text: "已同步", title: "同步状态", alignment: "right" as const, order: 0, priority: 0, command: null, tooltip: null, state: "normal" as const, disabledReason: null}]}}},
                {id: "long", label: "长英文项目名、英文界面与条目（窄宽度验收 35）", input: {props: {...base, project: "The Lighthouse Keeper's Chronicle, Volume Two", items: [{id: "test.items.sync", text: "Synced", title: "Sync status", alignment: "right" as const, order: 0, priority: 0, command: null, tooltip: null, state: "normal" as const, disabledReason: null}]}}},
            ];
        })(),
        // 场景 `long` 一直是英文界面，id 被 e2e 引用，所以点名。
        load: async () => withWorkbenchText(createSubjectFixture<typeof WorkbenchTitleBar>((await import("nbook/plugins/workbench/web/components/WorkbenchTitleBar.vue")).default, {events: ["run", "search", "toggle-part", "open-project", "run-item"], class: "w-full"}), ["long"]),
    }),
    defineLabFixture<typeof WorkbenchItemStrip>({
        component: "WorkbenchItemStrip",
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
                {id: "editor", label: "编辑器的三个条目", input: {props: {entries: editor, itemHeight: 20, align: "end"}}},
                {id: "states", label: "出错、禁用与长文字", input: {props: {itemHeight: 20, align: "end", entries: [
                    entry("test.items.failed", "保存失败 1 个", {order: 1, priority: 5, command: true, state: "error", tooltip: "第一章.md：磁盘已满"}),
                    entry("test.items.disabled", "全部保存", {order: 2, priority: 5, command: true, disabledReason: "没有需要保存的文档"}),
                    entry("test.items.long", "一段相当长的条目文字，用来看看三百二十像素的上限与省略号在状态栏里是什么样子", {order: 3, priority: 1}),
                ]}}},
                {id: "many", label: "放不下时收进“更多”", input: {props: {itemHeight: 20, align: "end", entries: Array.from({length: 14}, (_, index) => entry(`test.items.n${String(index)}`, `条目 ${String(index + 1)} · 一些文字`, {order: index, priority: index % 4, command: index % 3 === 0}))}}},
            ];
        })(),
        load: async () => withWorkbenchText(createSubjectFixture<typeof WorkbenchItemStrip>((await import("nbook/plugins/workbench/web/components/WorkbenchItemStrip.vue")).default, {events: ["run"], class: "w-full"})),
    }),
    defineLabFixture<typeof WorkbenchActivityBar>({
        component: "WorkbenchActivityBar",
        scenes: (() => {
            const containers = [
                {id: "view:nbook.files", label: "资源管理器", icon: "i-lucide-files"},
                {id: "view:nbook.search", label: "搜索", icon: "i-lucide-search"},
                {id: "view:nbook.outline", label: "大纲", icon: "i-lucide-list-tree"},
            ];
            const many = Array.from({length: 24}, (_, index) => ({id: `view:test.v${String(index)}`, label: `视图 ${String(index + 1)}`, icon: "i-lucide-square"}));
            // 底段的全局项（ui/workbench-shell.md 输出 40）：头像占位在上、设置齿轮在下。
            const profile = {id: "nbook.workbench.profile", title: "个人资料尚未开放", icon: "i-lucide-user-round", command: null, pressed: null, disabledReason: null};
            const gear = (pressed: boolean, disabledReason: string | null = null) => ({id: "nbook.settings", title: "设置", icon: "i-lucide-settings", command: {id: "nbook.settings.open", args: {}}, pressed, disabledReason});
            return [
                {id: "default", label: "三个容器、Sidebar 可见", input: {props: {label: "活动栏", containers, selected: "view:nbook.files", sidebarVisible: true, items: [profile, gear(false)]}}},
                {id: "settings-open", label: "设置窗口开着：齿轮按下", input: {props: {label: "活动栏", containers, selected: "view:nbook.files", sidebarVisible: true, items: [profile, gear(true)]}}},
                {id: "item-disabled", label: "底段条目的命令不可用", input: {props: {label: "活动栏", containers, selected: "view:nbook.files", sidebarVisible: true, items: [profile, gear(false, "命令 nbook.settings.open 不存在")]}}},
                {id: "sidebar-hidden", label: "Sidebar 隐藏：没有选中标记", input: {props: {label: "活动栏", containers, selected: "view:nbook.files", sidebarVisible: false, items: [profile, gear(false)]}}},
                {id: "empty", label: "没有容器、没有底段条目", input: {props: {label: "活动栏", containers: [], selected: null, sidebarVisible: true}}},
                {id: "many", label: "放不下时卡片内滚动", input: {props: {label: "活动栏", containers: many, selected: "view:test.v3", sidebarVisible: true, items: [profile, gear(false)]}}},
            ];
        })(),
        load: async () => withWorkbenchText(createSubjectFixture<typeof WorkbenchActivityBar>((await import("nbook/plugins/workbench/web/components/WorkbenchActivityBar.vue")).default, {events: ["select", "run-item"], class: "h-full w-[48px]"})),
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
    defineSubjectFixture<typeof TitleActions>({
        component: "TitleActions",
        events: ["run"],
        scenes: (() => {
            const entry = (key: string, command: string, icon: string | null, title: string, extra: {disabledReason?: string; pressed?: boolean} = {}) => ({
                key, command, icon, title,
                disabledReason: extra.disabledReason ?? null,
                ...(extra.pressed === undefined ? {} : {pressed: extra.pressed}),
            });
            const buttons = (manifests: boolean, canCreate: boolean) => [
                entry("own:0", "nbook.files.new-file", "i-lucide-file-plus", "新建文件", canCreate ? {} : {disabledReason: "没有可以新建的位置"}),
                entry("own:1", "nbook.files.new-folder", "i-lucide-folder-plus", "新建文件夹", canCreate ? {} : {disabledReason: "没有可以新建的位置"}),
                entry("own:2", "nbook.view.refresh-files", "i-lucide-refresh-cw", "刷新"),
                entry("own:3", "nbook.files.collapse-all", "i-lucide-copy-minus", "全部收起"),
                entry("own:4", "nbook.files.toggle-manifests", "i-lucide-file-code", "显示清单文件", {pressed: manifests}),
            ];
            const base = {identity: "nbook.files|view:nbook.files|single|published|1", moreLabel: "更多操作"};
            const menu = [
                [entry("own:5", "nbook.files.toggle-hidden", null, "显示隐藏文件", {pressed: true}), entry("own:6", "nbook.files.reveal-in-system", "i-lucide-folder-open", "在系统中显示")],
                [entry("acme.export.selection", "acme.export.selection", "i-lucide-download", "导出选中的章节", {disabledReason: "没有选中的章节"})],
            ];
            return [
                {id: "default", label: "资源管理器的五个动作", input: {props: {...base, model: {buttons: buttons(false, true), menu: []}}}},
                {id: "pressed", label: "开关按下", input: {props: {...base, model: {buttons: buttons(true, true), menu: []}}}},
                {id: "disabled", label: "不可用：禁用并给出原因", input: {props: {...base, model: {buttons: buttons(false, false), menu: []}}}},
                {id: "more", label: "“⋯”：自己的菜单动作与别的插件贡献的（分节、勾选、禁用带原因）", input: {props: {...base, model: {buttons: buttons(false, true), menu}}}},
            ];
        })(),
        subject: () => import("nbook/ui/menus/TitleActions.vue"),
    }),
    defineSubjectFixture<typeof WorkbenchDragFeedback>({
        component: "WorkbenchDragFeedback",
        events: [],
        scenes: [
            {id: "line", label: "Switcher 插入线与拖影", input: {props: {ghost: {label: "资源管理器", icon: "i-lucide-files", x: 220, y: 140}, preview: {areaRect: null, entryRect: null, indicator: {left: 180, top: 96, right: 182, bottom: 128}, orientation: "horizontal"}, label: "新建容器", kind: "detach-view"}}},
            {id: "area", label: "边缘并入的半区", input: {props: {ghost: {label: "终端", icon: "i-lucide-terminal", x: 320, y: 260}, preview: {areaRect: {left: 120, top: 200, right: 520, bottom: 320}, entryRect: null, indicator: null, orientation: "vertical"}, label: "移到这里", kind: "move-view"}}},
            {id: "idle", label: "没有拖动", input: {props: {ghost: null, preview: null, label: "", kind: ""}}},
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
                id, label, input: {props: {container: container(part, views), contextKey: `lab:${id}`, disabled: false}},
            });
            return [
                scene("vertical", "侧栏纵向三个视图", "sidebar", [slot("test.a", "资源管理器"), slot("test.b", "大纲", {size: 160}), slot("test.c", "时间线")]),
                scene("collapsed", "纵向：中间一个收起", "sidebar", [slot("test.a", "资源管理器"), slot("test.b", "大纲", {collapsed: true}), slot("test.c", "时间线")]),
                scene("horizontal", "Panel 横向两个视图，一个收起成竖条", "panel", [slot("test.a", "终端"), slot("test.b", "问题", {collapsed: true}), slot("test.c", "输出")]),
                scene("single", "single：一个视图、没有标题行", "sidebar", [slot("test.a", "资源管理器")]),
            ];
        })(),
        load: async () => withWorkbenchText((await import("./WorkbenchViewContainerHostFixture.vue")).default),
    }),
    defineLabFixture<typeof WorkbenchViewFrame>({
        component: "WorkbenchViewFrame",
        scenes: (() => {
            const base = {viewId: "test.files", layout: "scroll" as const, error: null, component: null, context: null, generation: 1, busy: false};
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
        load: async () => withWorkbenchText(createSubjectFixture<typeof WorkbenchViewFrame>((await import("nbook/plugins/workbench/web/components/WorkbenchViewFrame.vue")).default, {events: ["retry-entry", "reload", "retry-render", "render-error"], class: "h-full w-full"})),
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
    defineLabFixture<typeof ExplorerRow>({
        component: "ExplorerRow",
        scenes: (() => {
            const scene = (id: string, label: string, index: number, extra: {selected?: boolean; active?: boolean; edit?: {name: string; error: string | null; busy: boolean}; hideMarkdownExtension?: boolean} = {}) => ({id, label, input: {props: {row: EXPLORER_ROWS[index] as (typeof EXPLORER_ROWS)[number], domId: `lab-row-${id}`, selected: extra.selected ?? false, active: extra.active ?? false, height: 26, edit: extra.edit ?? null, hideMarkdownExtension: extra.hideMarkdownExtension ?? false}}});
            return [
                scene("node", "内容节点：展示名与真实名字", 3),
                scene("selected", "选中并有焦点框", 3, {selected: true, active: true}),
                scene("no-body", "无正文的节点", 2),
                scene("leaf", "只有正文的节点：没有展开控件", 5),
                scene("missing", "缺失条目", 6),
                scene("unlisted", "未列入项", 7),
                scene("binder", "活页夹：需要剧情插件", 10),
                scene("content-folder", "内容文件夹：去掉后缀", 1),
                scene("manifest-error", "清单不合法", 8),
                scene("loading", "列出中", 11),
                scene("error", "读取失败", 12),
                scene("hide-md", "隐藏 Markdown 扩展名", 14, {hideMarkdownExtension: true}),
                scene("root", "根：分节标题", 0),
                scene("rename", "改名：名字冲突的提示", 3, {selected: true, edit: {name: "alice", error: "已存在同名项", busy: false}}),
            ];
        })(),
        load: async () => withExplorerText(createSubjectFixture<typeof ExplorerRow>((await import("nbook/plugins/explorer/web/components/ExplorerRow.vue")).default, {events: ["press", "activate", "context", "retry"], class: "w-full"})),
    }),
    defineLabFixture<typeof ExplorerTree>({
        component: "ExplorerTree",
        scenes: [
            {id: "kinds", label: "三类文件夹与行上的状态", input: {props: {rows: EXPLORER_ROWS, selected: ["project://lore.content/bob"], focus: "project://lore.content/bob", label: "文件"}}},
            {id: "guides", label: "缩进参考线一直显示、焦点那一层加深", input: {props: {rows: EXPLORER_ROWS, selected: ["project://lore.content/carol"], focus: "project://lore.content/carol", label: "文件", indentGuides: "always"}}},
            {id: "many", label: "五百行：虚拟滚动与长名字", input: {props: {rows: manyRows(500), selected: [], focus: null, label: "文件"}}},
            {id: "english", label: "英文界面", input: {props: {rows: EXPLORER_ROWS, selected: [], focus: null, label: "Files"}}},
        ],
        load: async () => withExplorerText(createSubjectFixture<typeof ExplorerTree>((await import("nbook/plugins/explorer/web/components/ExplorerTree.vue")).default, {
            events: ["row-press", "row-activate", "row-context", "retry", "focus-change"],
            class: "h-full w-full",
            runtimeProps: {handleKey: () => "none" as const},
        })),
    }),
    defineLabFixture<typeof InlineChip>({
        component: "InlineChip",
        scenes: [
            {id: "reference", label: "引用作品里的文件", input: {props: {kind: "reference", label: "林雪", target: "/设定/林雪.md"}}},
            {id: "reference-image", label: "引用一张图片", input: {props: {kind: "reference", label: "地图", target: "/资料/地图.png"}}},
            {id: "attachment", label: "引用会话附件", input: {props: {kind: "reference", label: "截图", target: "session://attachments/截图.png"}}},
            {id: "external", label: "外部链接", input: {props: {kind: "reference", label: "官网", target: "https://example.com"}}},
            {id: "other", label: "旧应用的领域地址", input: {props: {kind: "reference", label: "第一章", target: "chapter://c1"}}},
            {id: "long", label: "过长的名称截断", input: {props: {kind: "reference", label: "一个非常非常非常非常非常非常长的设定文件名字", target: "/设定/很长.md"}}},
            {id: "skill", label: "技能", input: {props: {kind: "skill", label: "reviewer"}}},
            {id: "selection", label: "选区", input: {props: {kind: "selection", label: "第一章.md#L3-L8"}}},
            {id: "command", label: "命令", input: {props: {kind: "command", label: "plan"}}},
            {id: "image", label: "图片 #1", input: {props: {kind: "image", number: 1}}},
            {id: "uploading", label: "文件上传中", input: {props: {kind: "file", label: "笔记.txt", number: 2, state: "uploading"}}},
            {id: "failed", label: "上传失败", input: {props: {kind: "image", number: 3, state: "failed", error: "文件太大"}}},
            {id: "paste", label: "粘贴位置", input: {props: {kind: "paste", number: 4}}},
            {id: "highlighted", label: "联动高亮", input: {props: {kind: "image", number: 1, highlighted: true}}},
            {id: "selected", label: "在选区里", input: {props: {kind: "reference", label: "林雪", target: "/设定/林雪.md", selected: true}}},
            {id: "interactive", label: "可聚焦（静态显示里）", input: {props: {kind: "reference", label: "林雪", target: "/设定/林雪.md", interactive: true}}},
            {id: "english", label: "英文界面", input: {props: {kind: "file", label: "notes.txt", number: 2, state: "uploading"}}},
        ],
        load: async () => withMarkdownSceneText((await import("./InlineChipFixture.vue")).default),
    }),
    defineLabFixture<typeof MarkdownDisplay>({
        component: "MarkdownDisplay",
        scenes: [
            {id: "reply", label: "一条完整的回复（各方言）", input: {props: {text: DISPLAY_REPLY, locale: "zh-CN"}}},
            {id: "streaming", label: "流式追加", input: {props: {text: DISPLAY_REPLY, locale: "zh-CN"}}},
            {id: "conversation", label: "100 条消息的长对话", input: {props: {text: DISPLAY_REPLY, locale: "zh-CN"}}},
            {id: "plain", label: "只有普通 Markdown", input: {props: {text: "## 小结\n\n- 第一章节奏**偏快**\n- 第二章的*伏笔*可以提前，~~旧的开头~~删掉\n\n#### 细节\n\n---\n\n```ts\nconst answer = 42;\n```\n\n| 章 | 字数 |\n|---|---|\n| 一 | 3200 |", locale: "zh-CN"}}},
            {id: "empty", label: "空文本", input: {props: {text: "", locale: "zh-CN"}}},
        ],
        load: async () => withMarkdownSceneText((await import("./MarkdownDisplayFixture.vue")).default),
    }),
    defineLabFixture<typeof PromptEditor>({
        component: "PromptEditor",
        scenes: promptEditorScenes,
        load: async () => withMarkdownSceneText((await import("./prompt-scene/PromptEditorFixture.vue")).default),
    }),
    // 这三个零件经场景端口取文字（`markdown-text.ts`），所以不用 defineSubjectFixture，自己包一层（同 ExplorerTree）。
    defineLabFixture<typeof PromptTextView>({
        component: "PromptTextView",
        scenes: promptTextViewScenes,
        load: async () => withMarkdownSceneText(createSubjectFixture<typeof PromptTextView>(withNbookMarkdownHost((await import("@notnotype/nb-markdown/prompt")).PromptTextView).default, {
            events: ["token-activate"],
            class: "w-full p-4 text-[13px] leading-[1.6] text-[var(--text-main)]",
            runtimeProps: {resolveThumbnail: (target: string) => PROMPT_LAB_THUMBNAILS[target] ?? null},
        })),
    }),
    defineLabFixture<typeof PromptAttachmentStrip>({
        component: "PromptAttachmentStrip",
        scenes: promptAttachmentStripScenes,
        load: async () => withMarkdownSceneText(createSubjectFixture<typeof PromptAttachmentStrip>((await import("@notnotype/nb-markdown/prompt")).PromptAttachmentStrip, {
            events: ["activate", "remove", "retry", "hover"],
            writeBack: {hover: {layer: "props", key: "highlighted"}},
            class: "w-full",
        })),
    }),
    defineLabFixture<typeof PromptPasteFrame>({
        component: "PromptPasteFrame",
        scenes: promptPasteFrameScenes,
        load: async () => withMarkdownSceneText(createSubjectFixture<typeof PromptPasteFrame>((await import("@notnotype/nb-markdown/prompt")).PromptPasteFrame, {
            events: ["hover"],
            class: "w-full",
        })),
    }),
    defineLabFixture<typeof MarkdownImage>({
        component: "MarkdownImage",
        scenes: [
            {id: "shown", label: "显示", input: {props: {src: "images/封面.png", alt: "封面", title: "第一卷封面"}}},
            {id: "loading", label: "读取中", input: {props: {src: "lab://loading", alt: "封面"}}},
            {id: "outside", label: "不在作品里", input: {props: {src: "lab://outside", alt: "外面的图"}}},
            {id: "broken", label: "读不出", input: {props: {src: "lab://broken", alt: "坏图"}}},
            {id: "no-alt", label: "没有说明", input: {props: {src: "lab://outside"}}},
        ],
        load: async () => withMarkdownSceneText((await import("./MarkdownImageFixture.vue")).default),
    }),
    defineLabFixture<typeof FileIcon>({
        component: "FileIcon",
        scenes: [
            {id: "markdown", label: "Markdown 文件", input: {props: {icon: "markdown"}}},
            {id: "content-open", label: "展开的内容文件夹", input: {props: {icon: "folder-content-open"}}},
            {id: "image", label: "图片", input: {props: {icon: "image"}}},
        ],
        load: async () => (await import("./FileIconFixture.vue")).default,
    }),
    defineLabFixture<typeof ExplorerFeedback>({
        component: "ExplorerFeedback",
        scenes: [
            {id: "editor-missing", label: "编辑器尚未接入", input: {props: {notice: {kind: "editor-missing", address: "project://lore.content/bob/index.md"}}}},
            {id: "open-failed", label: "打开失败、长路径", input: {props: {notice: {kind: "open-failed", address: "project://一个非常深的目录/再深一层/还有一层/第一百二十三章 一个相当长的章节标题.md", reason: "not-text：文件含 NUL，不是文本"}}}},
            {id: "none", label: "没有提示", input: {props: {notice: null}}},
        ],
        load: async () => withExplorerText(createSubjectFixture<typeof ExplorerFeedback>((await import("nbook/plugins/explorer/web/components/ExplorerFeedback.vue")).default, {events: ["dismiss"], class: "w-full"})),
    }),
    defineLabFixture<typeof FilesExplorerView>({
        component: "FilesExplorerView",
        scenes: (() => {
            const base = {rows: EXPLORER_ROWS, selected: [], focus: null, ready: true, notice: null, problem: null};
            return [
                // 集成场景：真实的视图宿主、控制器与命令，文件换成内存适配器；输入只是占位，场景不读它。
                {id: "live", label: "内存数据：真实控制器与命令", input: {props: base}},
                {id: "default", label: "浏览", input: {props: base}},
                {id: "unbound", label: "未打开项目、用户资产停止同步", input: {props: {...base, rows: UNBOUND_ROWS}}},
                {id: "unsaved", label: "偏好未保存、编辑器尚未接入", input: {props: {...base, problem: {kind: "unsaved" as const, code: "conflict"}, notice: {kind: "editor-missing" as const, address: "project://plain/a.md"}}}},
                {id: "loading", label: "偏好还在读取", input: {props: {...base, ready: false}}},
                {id: "delete", label: "删除确认：多项与长路径", input: {props: {...base, dialog: {kind: "delete" as const, items: Array.from({length: 12}, (_, index) => ({address: `project://一个很深的目录/第${String(index + 1)}章 一个相当长的章节标题.md`, token: `t${String(index)}`})), busy: false, unsaved: ["project://一个很深的目录/第1章 一个相当长的章节标题.md"]}}}},
                {id: "dirty-copy", label: "复制有未保存修改的文件", input: {props: {...base, dialog: {kind: "dirty-copy" as const, documents: ["project://chapters/第一章.md", "project://chapters/第二章.md"], saveable: true}}}},
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
    defineLabFixture<typeof EditorGroup>({
        component: "EditorGroup",
        // 集成场景：真实的编辑器区控制器、文档模型与控件，文件换成内存适配器；界面语言由场景 id 决定（`english` 用英文），输入只给多行标签。
        scenes: [
            {id: "live", label: "内存数据：两个标签", input: {props: {groupId: "g0", wrapTabs: true}}},
            {id: "split", label: "向右拆分的两组", input: {props: {groupId: "g0", wrapTabs: true}}},
            {id: "english", label: "英文界面", input: {props: {groupId: "g0", wrapTabs: true}}},
            {id: "empty", label: "没有标签：标志与提示", input: {props: {groupId: "g0", wrapTabs: true}}},
            {id: "dialect", label: "Markdown 方言、提示块与原样内容", input: {props: {groupId: "g0", wrapTabs: true}}},
            {id: "unrepresentable", label: "写不出：组顶部的提示", input: {props: {groupId: "g0", wrapTabs: true}}},
        ],
        load: async () => (await import("./editor-scene/EditorAreaFixture.vue")).default,
    }),
    defineLabFixture<typeof ImageViewer>({
        component: "ImageViewer",
        // 字节绑定与图片由夹具生成（这里登记的 binding、host 只占位，夹具换成自己的）；可调的是文件名与界面语言。
        scenes: (() => {
            const base = {binding: null, host: {state: null, dispose: null}, readonly: true, visible: true};
            return [
                {id: "small", label: "比舞台小的图：原尺寸居中", input: {props: {...base, label: "插图.png", locale: "zh-CN" as const}}},
                {id: "large", label: "比舞台大的图：适应、点一下 100%", input: {props: {...base, label: "地图.png", locale: "zh-CN" as const}}},
                {id: "svg", label: "带透明的 SVG：棋盘格", input: {props: {...base, label: "图标.svg", locale: "zh-CN" as const}}},
                {id: "broken", label: "不是图片：说明与重试", input: {props: {...base, label: "坏图.png", locale: "en-US" as const}}},
            ];
        })(),
        load: async () => (await import("./image-viewer-scene/ImageViewerFixture.vue")).default,
    }),
    defineLabFixture<typeof HtmlPreview>({
        component: "HtmlPreview",
        // 文本绑定、令牌服务与时钟由夹具给出（这里登记的 binding、host 只占位）；界面语言由场景 id 决定（`-english` 结尾用英文）。
        scenes: (() => {
            const base = {binding: null, host: {state: null, dispose: null}, readonly: true, visible: true, label: "index.html"};
            return [
                {id: "page", label: "预览一张带脚本的页面", input: {props: base}},
                {id: "user", label: "不是作品里的文件", input: {props: base}},
                {id: "denied", label: "令牌申请失败：说明与重试", input: {props: base}},
                {id: "denied-english", label: "令牌申请失败：英文界面", input: {props: base}},
            ];
        })(),
        load: async () => (await import("./html-preview-scene/HtmlPreviewFixture.vue")).default,
    }),
    defineSubjectFixture<typeof EditorBreadcrumbs>({
        component: "EditorBreadcrumbs",
        events: ["open", "reveal", "escape"],
        class: "w-full",
        scenes: (() => {
            const segments = [
                {kind: "root" as const, label: "长夜", address: "project://"},
                {kind: "dir" as const, label: "正文", address: "project://正文"},
                {kind: "dir" as const, label: "卷一 一个相当长的卷名用来看截断", address: "project://正文/卷一 一个相当长的卷名用来看截断"},
                {kind: "file" as const, label: "第二章 旧城.md", address: "project://正文/卷一 一个相当长的卷名用来看截断/第二章 旧城.md", icon: fileIconForName("第二章 旧城.md")},
            ];
            const outline = {binding: "lab", version: 1, items: [{id: "h0", level: 1, text: "第二章 旧城"}, {id: "h1", level: 2, text: "雨夜的来客"}, {id: "h2", level: 2, text: "旧书店"}], current: "h1"};
            const base = {segments, parent: segments[2]?.address ?? null, locale: "zh-CN" as const};
            return [
                {id: "outline", label: "目录、文件与光标所在的标题", input: {props: {...base, outline}}},
                {id: "plain", label: "不是 Markdown：没有标题段", input: {props: {...base, outline: null}}},
            ];
        })(),
        // 目录下拉的列表：场景里的假数据，点哪个目录都列出同样几项。
        runtimeProps: async () => ({list: async (address: string) => ({ok: true as const, entries: [{name: "卷二", address: `${address}/卷二`, kind: "directory" as const}, {name: "第一章 雨夜.md", address: `${address}/第一章 雨夜.md`, kind: "file" as const}, {name: "第二章 旧城.md", address: `${address}/第二章 旧城.md`, kind: "file" as const}]})}),
        subject: () => import("nbook/plugins/editor/web/components/EditorBreadcrumbs.vue"),
    }),
    defineSubjectFixture<typeof EditorTabBar>({
        component: "EditorTabBar",
        events: ["activate", "keep", "close", "unpin", "move", "menu"],
        class: "w-full",
        scenes: (() => {
            type Extra = {preview?: boolean; dirty?: boolean; active?: boolean; pinned?: boolean; hint?: string};
            const tab = (id: string, label: string, extra: Extra = {}) => ({id, label, title: `project://chapters/${label}`, preview: extra.preview ?? false, dirty: extra.dirty ?? false, active: extra.active ?? false, pinned: extra.pinned ?? false, icon: fileIconForName(label), hint: extra.hint ?? null});
            const base = {label: "打开的编辑器", unsavedLabel: "未保存", pinnedLabel: "已固定"};
            const typical = [
                tab("p1", "大纲.md", {pinned: true}),
                tab("p2", "人物.md", {pinned: true, dirty: true}),
                tab("t1", "第一章 雨夜.md"),
                tab("t2", "第二章 旧城.md", {active: true, dirty: true}),
                tab("t3", "README.md", {hint: "notes"}),
                tab("t4", "README.md", {hint: "drafts"}),
                tab("t5", "cover.png"),
                tab("t6", "第三章 渡口.md", {preview: true}),
            ];
            const many = [tab("p1", "大纲.md", {pinned: true}), ...Array.from({length: 18}, (_, index) => tab(`t${String(index)}`, `第${String(index + 1)}章 一个相当长的章节标题.md`, {active: index === 9, dirty: index % 4 === 0}))];
            return [
                {id: "mixed", label: "固定、未保存、同名、预览与活动标签", input: {props: {...base, tabs: typical}}},
                {id: "many", label: "多行：固定标签单独一行，普通标签至多 3 行后滚动", input: {props: {...base, tabs: many}}},
                {id: "single-line", label: "关掉多行：一行横向滚动", input: {props: {...base, tabs: many, wrap: false}}},
                {id: "inactive-group", label: "不是活动组：活动标签文字为次级色", input: {props: {...base, tabs: typical, groupActive: false}}},
                {id: "single", label: "只有一个预览标签", input: {props: {...base, tabs: [tab("t1", "第一章.md", {preview: true, active: true})]}}},
            ];
        })(),
        runtimeProps: async () => ({closeLabel: (name: string) => `关闭 ${name}`, unpinLabel: (name: string) => `取消固定 ${name}`}),
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
    defineSubjectFixture<typeof NeuroBookLockup>({
        component: "NeuroBookLockup",
        noInput: "字标没有 prop：大小由使用方的 class 给，颜色跟随文字色。",
        scenes: [
            {id: "title", label: "标题栏大小（26px）"},
        ],
        subject: () => import("nbook/ui/brand/NeuroBookLockup.vue"),
        class: "h-[26px] text-[var(--text-main)]",
    }),
    defineSubjectFixture<typeof NeuroBookMark>({
        component: "NeuroBookMark",
        scenes: [
            {id: "titlebar", label: "窄标题栏大小（18px）", input: {props: {decorative: false}}},
            {id: "decorative", label: "纯装饰（对读屏隐藏）", input: {props: {decorative: true}}},
        ],
        subject: () => import("nbook/ui/brand/NeuroBookMark.vue"),
        class: "h-[18px] text-[var(--text-main)]",
    }),
    defineSubjectFixture<typeof NeuroBookMood>({
        component: "NeuroBookMood",
        scenes: [
            {id: "focus", label: "专注（看书）", input: {props: {state: "focus"}}},
            {id: "write", label: "写作中", input: {props: {state: "write"}}},
            {id: "idle", label: "空闲（跟着鼠标看）", input: {props: {state: "idle"}}},
            {id: "think", label: "思考", input: {props: {state: "think"}}},
            {id: "ask", label: "等你选择", input: {props: {state: "ask"}}},
            {id: "done", label: "完成", input: {props: {state: "done"}}},
            {id: "error", label: "出错", input: {props: {state: "error"}}},
            {id: "sleep", label: "睡着", input: {props: {state: "sleep"}}},
            {id: "dark", label: "深色底（透明）", input: {props: {state: "idea", variant: "dark"}}},
        ],
        subject: () => import("nbook/ui/brand/NeuroBookMood.vue"),
        class: "w-28",
    }),
    ...shelfFixtures(),
    ...settingsFixtures(),
    ...nbUiFixtures,
    ...nbFormFixtures,
    ...nbLayoutFixtures,
    ...nbAgentUiFixtures,
];

/** 书架页（docs/specs/workbench/bookshelf.md）：静态稿给开发者看，也是页面接上真实数据之后的回归场景。 */
function shelfFixtures(): LabFixture[] {
    const [first, second, third, , long] = SHELF_ITEMS as [typeof SHELF_ITEMS[number], ...typeof SHELF_ITEMS];
    const page = {status: "ready" as const, items: SHELF_ITEMS, now: SHELF_NOW, library: "/home/writer/Documents/NeuroBook"};
    // 封面图由夹具给：Lab 没有服务端的封面路由，第一部作品用一张内联的 SVG，其余排版封面。
    const covers = async () => ({coverSrc: (item: ShelfItem) => (item.id === first.id ? SHELF_COVER_SRC : null)});
    return [
        defineLabFixture<typeof BookshelfPage>({
            component: "BookshelfPage",
            scenes: [
                {id: "cards", label: "卡片视图，选中一部", input: {props: page, model: {view: "cards", sort: "recent", activeId: first.id}}},
                {id: "list", label: "列表视图", input: {props: page, model: {view: "list", sort: "words", activeId: null}}},
                {id: "one", label: "只有一部", input: {props: {...page, items: [second]}, model: {view: "cards", sort: "recent", activeId: second.id}}},
                {id: "no-record", label: "有作品但没有写作记录", input: {props: {...page, items: [SHELF_ITEMS[3]!]}, model: {view: "cards", sort: "recent", activeId: null}}},
                {id: "empty", label: "空书架", input: {props: {...page, items: []}, model: {view: "cards", sort: "recent", activeId: null}}},
                {id: "loading", label: "加载中", input: {props: {...page, status: "loading", items: []}, model: {view: "cards", sort: "recent", activeId: null}}},
                {id: "error", label: "取数失败", input: {props: {...page, status: "error", error: "书架没取到：服务端暂时不可用", items: []}, model: {view: "cards", sort: "recent", activeId: null}}},
                {id: "english", label: "英文界面", input: {props: {...page}, model: {view: "cards", sort: "recent", activeId: third.id}}},
                {id: "settings-open", label: "设置窗口开着：齿轮按下", input: {props: {...page, settingsOpen: true}, model: {view: "cards", sort: "recent", activeId: first.id}}},
            ],
            load: async () => withProjectsText(createSubjectFixture<typeof BookshelfPage>((await import("nbook/plugins/projects/web/components/BookshelfPage.vue")).default, {events: ["continue", "open", "open-new-window", "edit", "remove", "create", "add-existing", "retry", "open-settings"], class: "h-full w-full", runtimeProps: await covers()})),
        }),
        defineLabFixture<typeof ShelfDesk>({
            component: "ShelfDesk",
            scenes: [
                {id: "writing", label: "今天写了字", input: {props: {items: SHELF_ITEMS, now: SHELF_NOW}}},
                {id: "no-today", label: "今天没写", input: {props: {items: [second, third], now: SHELF_NOW}}},
                {id: "revising", label: "今天净删", input: {props: {items: [SHELF_ITEM_REVISING], now: SHELF_NOW}}},
                {id: "no-record", label: "没有写作记录", input: {props: {items: [SHELF_ITEMS[3]!], now: SHELF_NOW}}},
                {id: "empty", label: "空书架的问候", input: {props: {items: [], now: SHELF_NOW}}},
                {id: "english", label: "英文界面", input: {props: {items: SHELF_ITEMS, now: SHELF_NOW}}},
            ],
            load: async () => withProjectsText(createSubjectFixture<typeof ShelfDesk>((await import("nbook/plugins/projects/web/components/ShelfDesk.vue")).default, {events: ["continue"], class: "w-full"})),
        }),
        defineLabFixture<typeof ShelfCards>({
            component: "ShelfCards",
            scenes: [
                {id: "grid", label: "几部作品", input: {props: {items: SHELF_ITEMS, now: SHELF_NOW, library: "/home/writer/Documents/NeuroBook"}, model: {activeId: first.id}}},
                {id: "many", label: "很多部", input: {props: {items: [...SHELF_ITEMS, ...SHELF_ITEMS].map((item, index) => ({...item, id: `${item.id}-${String(index)}`})), now: SHELF_NOW, library: "/home/writer/Documents/NeuroBook"}, model: {activeId: null}}},
                {id: "empty", label: "空书架的两张卡", input: {props: {items: [], now: SHELF_NOW, library: "/home/writer/Documents/NeuroBook"}, model: {activeId: null}}},
            ],
            load: async () => withProjectsText(createSubjectFixture<typeof ShelfCards>((await import("nbook/plugins/projects/web/components/ShelfCards.vue")).default, {events: ["open", "open-new-window", "edit", "remove", "create", "add-existing"], class: "w-full", runtimeProps: await covers()})),
        }),
        defineLabFixture<typeof BookCard>({
            component: "BookCard",
            scenes: [
                {id: "cover", label: "有封面、正在打开", input: {props: {item: first, now: SHELF_NOW, coverSrc: SHELF_COVER_SRC, active: true}}},
                {id: "typeset", label: "排版封面", input: {props: {item: second, now: SHELF_NOW, coverSrc: null, active: false}}},
                {id: "none", label: "尚未统计、没有简介", input: {props: {item: SHELF_ITEMS[3]!, now: SHELF_NOW, coverSrc: null, active: false}}},
                {id: "long", label: "长书名", input: {props: {item: long, now: SHELF_NOW, coverSrc: null, active: false}}},
            ],
            load: async () => withProjectsText(createSubjectFixture<typeof BookCard>((await import("nbook/plugins/projects/web/components/BookCard.vue")).default, {events: ["pick", "open", "open-new-window", "edit", "remove"], class: "w-full max-w-[360px]"})),
        }),
        defineLabFixture<typeof WelcomePage>({
            component: "WelcomePage",
            scenes: (() => {
                const quick = [
                    {address: "project://大纲.md", name: "大纲.md", kind: "file" as const},
                    {address: "project://设定", name: "设定", kind: "folder" as const},
                ];
                const recent = ["project://正文/第一卷/第一章 灯塔.md", "project://设定/人物.md", "project://大纲.md"];
                const page = {title: first.title ?? first.name, description: first.description, stats: first.stats, now: SHELF_NOW, quick, recent, shortcut: "Ctrl+Shift+P"};
                return [
                    {id: "book", label: "写过一阵的作品", input: {props: page}},
                    {id: "new", label: "新作品：没有简介、尚未统计、没有最近打开", input: {props: {...page, title: "新的一本", description: null, stats: SHELF_ITEMS[3]!.stats, quick: [], recent: []}}},
                    {id: "problem", label: "新建章节失败", input: {props: {...page, problem: "新建章节失败：permission-denied"}}},
                    {id: "unbound", label: "没有打开作品", input: {props: {...page, title: null}}},
                    {id: "english", label: "英文界面", input: {props: {...page}}},
                ];
            })(),
            load: async () => withProjectsText(createSubjectFixture<typeof WelcomePage>((await import("nbook/plugins/projects/web/components/WelcomePage.vue")).default, {events: ["new-chapter", "open", "reveal", "shelf"], class: "w-full"})),
        }),
        defineSubjectFixture<typeof BookCover>({
            component: "BookCover",
            class: "",
            scenes: [
                {id: "image", label: "有图", input: {props: {id: "a", title: "长夜行", color: null, src: SHELF_COVER_SRC, width: 150}}},
                {id: "typeset", label: "排版封面（生成的色档）", input: {props: {id: "8f0c2d4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f", title: "长夜行", color: null, width: 150, caption: "长篇"}}},
                {id: "light", label: "作者给的浅色", input: {props: {id: "b", title: "短篇集：在所有的夜里", color: "#d9c9a3", width: 150}}},
                {id: "small", label: "列表里的小封面", input: {props: {id: "c", title: "北方以北", color: "#7a4b3a", width: 30}}},
                {id: "english", label: "英文长名", input: {props: {id: "d", title: "The Long Dark and the Lighthouse Keeper", color: null, width: 84}}},
            ],
            subject: () => import("nbook/plugins/projects/web/components/BookCover.vue"),
        }),
        defineLabFixture<typeof ShelfList>({
            component: "ShelfList",
            scenes: [
                {id: "books", label: "几部作品", input: {props: {items: SHELF_ITEMS, now: SHELF_NOW}}},
                {id: "english", label: "英文界面", input: {props: {items: SHELF_ITEMS, now: SHELF_NOW}}},
            ],
            load: async () => withProjectsText(createSubjectFixture<typeof ShelfList>((await import("nbook/plugins/projects/web/components/ShelfList.vue")).default, {events: ["open", "open-new-window", "edit", "remove", "create"], class: "w-full", runtimeProps: await covers()})),
        }),
        defineLabFixture<typeof ProjectInfoDialog>({
            component: "ProjectInfoDialog",
            scenes: [
                {id: "create", label: "新建作品", input: {props: {open: true, mode: "create"}, model: {location: "/home/writer/Documents/NeuroBook"}}},
                {id: "create-filled", label: "新建作品（填了书名、自定义色）", input: {props: {open: true, mode: "create", initial: {title: "雪线以北", description: "一个守灯人等一封永远不会来的信。", color: "#d4a017", coverSrc: null}}, model: {location: "/home/writer/Documents/NeuroBook"}}},
                {id: "edit", label: "编辑信息（有封面）", input: {props: {open: true, mode: "edit", initial: {id: first.id, title: first.title ?? first.name, description: first.description ?? "", color: "#2f63a8", coverSrc: SHELF_COVER_SRC}}, model: {location: ""}}},
                {id: "rejected", label: "服务端拒绝了位置", input: {props: {open: true, mode: "create", initial: {title: "长夜行", description: "", color: "#2f63a8", coverSrc: null}, fieldErrors: {location: "作品目录不可用：目录不可读写（/mnt/usb/books）"}}, model: {location: "/mnt/usb/books"}}},
                {id: "busy", label: "提交中", input: {props: {open: true, mode: "edit", initial: {title: "北方以北", description: "", color: null, coverSrc: null}, busy: true}, model: {location: ""}}},
                {id: "english", label: "英文界面", input: {props: {open: true, mode: "create"}, model: {location: "/Users/writer/Documents/NeuroBook"}}},
            ],
            load: async () => withProjectsText(createSubjectFixture<typeof ProjectInfoDialog>((await import("nbook/plugins/projects/web/components/ProjectInfoDialog.vue")).default, {events: ["submit", "cancel", "browse-location"], class: ""})),
        }),
        defineSubjectFixture<typeof FileBrowser>({
            component: "FileBrowser",
            events: ["navigate", "up", "activate"],
            class: "w-full max-w-[560px]",
            scenes: [
                {id: "default", label: "作品目录", input: {props: {
                    segments: [{label: "/", path: "/"}, {label: "home", path: "/home"}, {label: "writer", path: "/home/writer"}, {label: "Documents", path: "/home/writer/Documents"}, {label: "NeuroBook", path: "/home/writer/Documents/NeuroBook"}],
                    entries: [
                        {id: "/home/writer/Documents/NeuroBook/changyexing", name: "changyexing", kind: "directory", badge: "已在书架上", disabled: true, swatch: "#2f5fa0"},
                        {id: "/home/writer/Documents/NeuroBook/beifang", name: "beifang", kind: "directory", badge: "作品 · 北方以北", badgeTone: "accent", swatch: "#8f3f2e"},
                        {id: "/home/writer/Documents/NeuroBook/drafts", name: "drafts", kind: "directory"},
                        {id: "/home/writer/Documents/NeuroBook/old-notes", name: "old-notes", kind: "directory"},
                        {id: "/home/writer/Documents/NeuroBook/notes.md", name: "notes.md", kind: "file"},
                    ],
                    label: "作品目录",
                }, model: {selectedId: "/home/writer/Documents/NeuroBook/beifang"}}},
                {id: "empty", label: "空目录", input: {props: {segments: [{label: "/", path: "/"}, {label: "tmp", path: "/tmp"}], entries: [], emptyText: "这里没有子目录"}, model: {selectedId: null}}},
                {id: "loading", label: "加载中", input: {props: {segments: [{label: "/", path: "/"}], entries: [], loading: true}, model: {selectedId: null}}},
                {id: "error", label: "读不出", input: {props: {segments: [{label: "/", path: "/"}, {label: "root", path: "/root"}], entries: [], error: "目录不可读：/root"}, model: {selectedId: null}}},
            ],
            subject: () => import("nbook/plugins/projects/web/components/FileBrowser.vue"),
        }),
        defineLabFixture<typeof PathPickerDialog>({
            component: "PathPickerDialog",
            scenes: [
                {id: "project", label: "打开已有作品", input: {props: {open: true, mode: "project"}}},
                {id: "directory", label: "选择作品目录", input: {props: {open: true, mode: "directory", initialPath: "/home/writer/Documents"}}},
                {id: "rejected", label: "登记失败", input: {props: {open: true, mode: "project", error: "没有加入书架：目录里的项目身份文件无法读取"}}},
                {id: "english", label: "英文界面", input: {props: {open: true, mode: "project"}}},
            ],
            load: async () => withProjectsText(createSubjectFixture<typeof PathPickerDialog>((await import("nbook/plugins/projects/web/components/PathPickerDialog.vue")).default, {events: ["pick", "cancel"], class: "", runtimeProps: {source: (await import("./path-picker-source")).labPathPickerSource}})),
        }),
        defineLabFixture<typeof WorksSettingsPage>({
            component: "WorksSettingsPage",
            scenes: [
                {id: "unset", label: "还没设（显示缺省目录）", input: {props: {layer: "user"}}},
                {id: "default-unknown", label: "还没设、取不到缺省目录", input: {props: {layer: "user"}}},
                {id: "set", label: "设了（已修改）", input: {props: {layer: "user"}}},
                {id: "long", label: "很长的路径", input: {props: {layer: "user"}}},
                {id: "write-failed", label: "写不进去", input: {props: {layer: "user"}}},
                {id: "invalid", label: "设置文件有错误（停用）", input: {props: {layer: "user"}}},
                {id: "english", label: "英文界面", input: {props: {layer: "user"}}},
            ],
            load: async () => withProjectsText((await import("./WorksSettingsPageFixture.vue")).default),
        }),
        defineLabFixture<typeof PermissionRulesPage>({
            component: "PermissionRulesPage",
            scenes: [
                {id: "rules", label: "我的规则：命令、路径、关键词、放行、自定义条件", input: {props: {rules: [{tool: "shell", when: {type: "command", pattern: "git push *"}, action: "deny" as const, reason: "不要推送，先让用户看"}, {tool: "write", when: {type: "path", glob: "project://正文/**", access: "write"}, action: "ask" as const}, {tool: "*.image-gen", when: {type: "arg", path: "prompt", op: "keywords", value: ["血腥", "暴力"]}, action: "deny" as const}, {tool: "shell", when: {type: "command", pattern: "git diff *"}, action: "allow" as const}, {tool: "ssh", when: {all: [{type: "subject", kind: "host", glob: "prod*"}, {type: "command", pattern: "rm *"}]}, action: "deny" as const}]}}},
                {id: "empty", label: "还没有规则", input: {props: {rules: []}}},
                {id: "project", label: "绑定作品：这本书的规则只读，放行标不生效", input: {props: {rules: [{tool: "shell", when: {type: "command", pattern: "git push *"}, action: "deny" as const, reason: "不要推送，先让用户看"}, {tool: "write", when: {type: "path", glob: "project://正文/**", access: "write"}, action: "ask" as const}, {tool: "*.image-gen", when: {type: "arg", path: "prompt", op: "keywords", value: ["血腥", "暴力"]}, action: "deny" as const}, {tool: "shell", when: {type: "command", pattern: "git diff *"}, action: "allow" as const}, {tool: "ssh", when: {all: [{type: "subject", kind: "host", glob: "prod*"}, {type: "command", pattern: "rm *"}]}, action: "deny" as const}], projectTitle: "雨夜", projectRules: [{tool: "write", when: {type: "path", glob: "project://设定/**", access: "write"}, action: "ask" as const, reason: "设定要作者点头"}, {tool: "shell", action: "allow" as const}]}}},
                {id: "project-invalid", label: "作品的规则文件坏了", input: {props: {rules: [], projectTitle: "雨夜", projectRules: "invalid"}}},
                {id: "add", label: "添加规则：对话框", input: {props: {rules: [], initialEdit: "new"}}},
                {id: "edit", label: "编辑规则：命令", input: {props: {rules: [{tool: "shell", when: {type: "command", pattern: "git push *"}, action: "deny" as const, reason: "不要推送，先让用户看"}, {tool: "write", when: {type: "path", glob: "project://正文/**", access: "write"}, action: "ask" as const}, {tool: "*.image-gen", when: {type: "arg", path: "prompt", op: "keywords", value: ["血腥", "暴力"]}, action: "deny" as const}, {tool: "shell", when: {type: "command", pattern: "git diff *"}, action: "allow" as const}, {tool: "ssh", when: {all: [{type: "subject", kind: "host", glob: "prod*"}, {type: "command", pattern: "rm *"}]}, action: "deny" as const}], initialEdit: 0}}},
                {id: "edit-json", label: "编辑规则：自定义条件是 JSON", input: {props: {rules: [{tool: "shell", when: {type: "command", pattern: "git push *"}, action: "deny" as const, reason: "不要推送，先让用户看"}, {tool: "write", when: {type: "path", glob: "project://正文/**", access: "write"}, action: "ask" as const}, {tool: "*.image-gen", when: {type: "arg", path: "prompt", op: "keywords", value: ["血腥", "暴力"]}, action: "deny" as const}, {tool: "shell", when: {type: "command", pattern: "git diff *"}, action: "allow" as const}, {tool: "ssh", when: {all: [{type: "subject", kind: "host", glob: "prod*"}, {type: "command", pattern: "rm *"}]}, action: "deny" as const}], initialEdit: 4}}},
                {id: "readonly", label: "配置写不了", input: {props: {rules: [{tool: "shell", when: {type: "command", pattern: "git push *"}, action: "deny" as const, reason: "不要推送，先让用户看"}, {tool: "write", when: {type: "path", glob: "project://正文/**", access: "write"}, action: "ask" as const}, {tool: "*.image-gen", when: {type: "arg", path: "prompt", op: "keywords", value: ["血腥", "暴力"]}, action: "deny" as const}, {tool: "shell", when: {type: "command", pattern: "git diff *"}, action: "allow" as const}, {tool: "ssh", when: {all: [{type: "subject", kind: "host", glob: "prod*"}, {type: "command", pattern: "rm *"}]}, action: "deny" as const}], writable: false}}},
            ],
            load: async () => withAgentPageText((await import("./agent-scene/PermissionRulesFixture.vue")).default),
        }),
        defineLabFixture<typeof ProvidersPage>({
            component: "ProvidersPage",
            scenes: [
                {id: "providers", label: "四家服务商：目录、改过地址、自定义、本机", input: {props: {writable: true}}},
                {id: "providers-empty", label: "还没有服务商（引导）", input: {props: {writable: true}}},
                {id: "providers-narrow", label: "560px 宽：左栏收成下拉", input: {props: {writable: true}}},
                {id: "providers-write-failed", label: "写不进去（窗口通知记进事件）", input: {props: {writable: true}}},
                {id: "providers-readonly", label: "模型服务没有运行（只读）", input: {props: {writable: true}}},
                {id: "providers-english", label: "英文界面", input: {props: {writable: true}}},
            ],
            load: async () => withModelsText((await import("./ModelsPageFixture.vue")).default),
        }),
        defineLabFixture<typeof RolesPage>({
            component: "RolesPage",
            scenes: [
                {id: "roles", label: "未绑定、没有密钥、自建角色", input: {props: {writable: true}}},
                {id: "roles-empty", label: "还没有模型，全部未绑定", input: {props: {writable: true}}},
                {id: "roles-readonly", label: "模型服务没有运行（只读）", input: {props: {writable: true}}},
                {id: "roles-english", label: "英文界面", input: {props: {writable: true}}},
            ],
            load: async () => withModelsText((await import("./ModelsPageFixture.vue")).default),
        }),
        defineLabFixture<typeof CapabilityIcons>({
            component: "CapabilityIcons",
            scenes: [
                {id: "all", label: "看图与推理（悬停写推理档）", input: {props: {vision: true, reasoning: true, efforts: ["low", "medium", "high"]}}},
                {id: "vision", label: "只能看图", input: {props: {vision: true, reasoning: false}}},
                {id: "none", label: "都没有（什么都不画）", input: {props: {vision: false, reasoning: false}}},
            ],
            load: async () => withModelsText(createSubjectFixture<typeof CapabilityIcons>((await import("nbook/plugins/models/web/components/CapabilityIcons.vue")).default)),
        }),
        defineLabFixture<typeof HeadersEditor>({
            component: "HeadersEditor",
            scenes: [
                {id: "filled", label: "两行请求头", input: {props: {headers: {"X-Team": "writing", "X-Region": "cn"}, hint: "中转站、网关常要"}}},
                {id: "credential", label: "名称像凭据、值不是 env:（提示）", input: {props: {headers: {"X-Api-Key": "abc"}}}},
                {id: "empty", label: "没有请求头", input: {props: {headers: {}}}},
                {id: "english", label: "英文界面", input: {props: {headers: {"X-Team": "writing"}}}},
            ],
            load: async () => withModelsText(createSubjectFixture<typeof HeadersEditor>((await import("nbook/plugins/models/web/components/HeadersEditor.vue")).default, {events: ["commit"], writeBack: {commit: {layer: "props", key: "headers"}}, class: "w-full max-w-[520px]"})),
        }),
        defineLabFixture<typeof ModelRow>({
            component: "ModelRow",
            scenes: [
                {id: "enabled", label: "启用、带角色小标、检测通过", input: {props: {model: SAMPLE_PROVIDERS[0]!.models[0]!, roles: ["快速", "压缩"], check: {status: "done", at: 0, result: {ok: true}}}}},
                {id: "failed", label: "检测失败（点开看原因）", input: {props: {model: SAMPLE_PROVIDERS[1]!.models[0]!, check: {status: "done", at: 0, result: {ok: false, kind: "auth", code: "401", raw: "{\"type\":\"error\",\"error\":{\"type\":\"authentication_error\"}}"}}}}},
                {id: "running", label: "检测中", input: {props: {model: SAMPLE_PROVIDERS[2]!.models[0]!, check: {status: "running"}}}},
                {id: "incomplete", label: "缺上下文窗口（开关停用）", input: {props: {model: SAMPLE_PROVIDERS[2]!.models[2]!}}},
                {id: "missing", label: "目录里没有了", input: {props: {model: SAMPLE_PROVIDERS[1]!.models[1]!}}},
                {id: "free", label: "免费的本机模型", input: {props: {model: SAMPLE_PROVIDERS[5]!.models[0]!}}},
            ],
            load: async () => withModelsText(createSubjectFixture<typeof ModelRow>((await import("nbook/plugins/models/web/components/ModelRow.vue")).default, {events: ["toggle", "check", "edit"], class: "w-full list-none"})),
        }),
        defineLabFixture<typeof ProviderRail>({
            component: "ProviderRail",
            scenes: [
                {id: "providers", label: "当前是第一家；第二行写密钥问题或模型数", input: {props: {providers: SAMPLE_PROVIDERS, current: "deepseek"}}},
                {id: "all", label: "当前是“全部模型”", input: {props: {providers: SAMPLE_PROVIDERS, current: "all"}}},
            ],
            load: async () => withModelsText(createSubjectFixture<typeof ProviderRail>((await import("nbook/plugins/models/web/components/ProviderRail.vue")).default, {events: ["select", "add"], writeBack: {select: {layer: "props", key: "current"}}, class: "h-[420px]"})),
        }),
        defineLabFixture<typeof ProviderDetail>({
            component: "ProviderDetail",
            scenes: [
                {id: "catalog", label: "目录服务商，密钥已设置", input: {props: {provider: SAMPLE_PROVIDERS[0]!}}},
                {id: "overridden", label: "目录服务商改过地址，环境变量没有值", input: {props: {provider: SAMPLE_PROVIDERS[1]!}}},
                {id: "custom", label: "自定义服务商：接口格式、请求头、缺字段的模型", input: {props: {provider: SAMPLE_PROVIDERS[2]!}}},
                {id: "keyless", label: "不要认证的本机端点（没有密钥框）", input: {props: {provider: SAMPLE_PROVIDERS[5]!}}},
                {id: "no-key", label: "还没有密钥（“未设置”）", input: {props: {provider: SAMPLE_PROVIDERS[3]!}}},
                {id: "env-found", label: "密钥取环境变量、已读到", input: {props: {provider: SAMPLE_PROVIDERS[4]!}}},
                {id: "check-error", label: "没检成（原因写在模型列表头上）", input: {props: {provider: SAMPLE_PROVIDERS[0]!, checkError: "没检成：模型服务没有运行"}}},
                {id: "english", label: "英文界面", input: {props: {provider: SAMPLE_PROVIDERS[2]!}}},
            ],
            load: async () => withModelsText(createSubjectFixture<typeof ProviderDetail>((await import("nbook/plugins/models/web/components/ProviderDetail.vue")).default, {events: ["set-key", "clear-key", "update", "toggle-model", "check", "check-all", "cancel-checks", "edit-model", "add-model", "manage"], class: "w-full"})),
        }),
        defineLabFixture<typeof AllModelsView>({
            component: "AllModelsView",
            scenes: [
                {id: "models", label: "全部启用的模型", input: {props: {providers: SAMPLE_PROVIDERS}}},
                {id: "empty", label: "没有启用的模型", input: {props: {providers: []}}},
            ],
            load: async () => withModelsText(createSubjectFixture<typeof AllModelsView>((await import("nbook/plugins/models/web/components/AllModelsView.vue")).default, {events: ["edit"], class: "w-full"})),
        }),
        defineLabFixture<typeof AddProviderDialog>({
            component: "AddProviderDialog",
            scenes: [
                {id: "catalog", label: "目录列表：已添加、不要密钥、要登录", input: {model: {open: true}, props: {catalog: SAMPLE_CATALOG}}},
                {id: "loading", label: "目录还在读", input: {model: {open: true}, props: {catalog: null}}},
                {id: "english", label: "英文界面", input: {model: {open: true}, props: {catalog: SAMPLE_CATALOG}}},
            ],
            load: async () => withModelsText(createSubjectFixture<typeof AddProviderDialog>((await import("nbook/plugins/models/web/components/AddProviderDialog.vue")).default, {events: ["update:open", "add-catalog", "add-custom"], writeBack: {"update:open": {layer: "model", key: "open"}}})),
        }),
        defineLabFixture<typeof ManageModelsDialog>({
            component: "ManageModelsDialog",
            scenes: [
                {id: "discovered", label: "拉取的结果：已加入、要补字段", input: {model: {open: true}, props: {providerName: "火山方舟", discoverable: true, candidates: SAMPLE_CANDIDATES, current: ["doubao-seed-2-0-pro"]}}},
                {id: "loading", label: "还在拉取", input: {model: {open: true}, props: {providerName: "火山方舟", discoverable: true, candidates: null, current: []}}},
                {id: "failed", label: "拉取失败", input: {model: {open: true}, props: {providerName: "火山方舟", discoverable: true, candidates: null, current: [], error: "鉴权失败：核对密钥"}}},
            ],
            load: async () => withModelsText(createSubjectFixture<typeof ManageModelsDialog>((await import("nbook/plugins/models/web/components/ManageModelsDialog.vue")).default, {events: ["update:open", "refetch", "done"], writeBack: {"update:open": {layer: "model", key: "open"}}})),
        }),
        defineLabFixture<typeof ModelEditDialog>({
            component: "ModelEditDialog",
            scenes: [
                {id: "custom", label: "自定义模型（都能改）", input: {model: {open: true}, props: {providerKind: "custom", model: SAMPLE_PROVIDERS[2]!.models[0]!}}},
                {id: "catalog", label: "目录模型（能力与单价只读）", input: {model: {open: true}, props: {providerKind: "catalog", model: SAMPLE_PROVIDERS[0]!.models[0]!}}},
                {id: "add", label: "手动添加", input: {model: {open: true}, props: {providerKind: "custom", model: null, takenIds: ["doubao-seed-2-0-pro"]}}},
                {id: "error", label: "保存失败（页脚写原因）", input: {model: {open: true}, props: {providerKind: "custom", model: SAMPLE_PROVIDERS[2]!.models[1]!, error: "设置文件有错或写不进去，先修好设置文件"}}},
            ],
            load: async () => withModelsText(createSubjectFixture<typeof ModelEditDialog>((await import("nbook/plugins/models/web/components/ModelEditDialog.vue")).default, {events: ["update:open", "save"], writeBack: {"update:open": {layer: "model", key: "open"}}})),
        }),
        defineLabFixture<typeof PluginsPage>({
            component: "PluginsPage",
            scenes: [
                {id: "pending", label: "有待生效的变化（升级、降级、安装、禁用、卸载）", input: {props: {locale: "zh-CN"}}},
                {id: "problems", label: "显示名、说明，服务端与本窗口的问题（入口失败、受阻、贡献被拒）", input: {props: {locale: "zh-CN"}}},
                {id: "problems-english", label: "显示名、说明与问题，英文界面", input: {props: {locale: "en-US"}}},
                {id: "empty", label: "没有第三方插件", input: {props: {locale: "zh-CN"}}},
                {id: "not-loaded", label: "没有登记：清单无效、不兼容", input: {props: {locale: "zh-CN"}}},
                {id: "safe-mode", label: "安全模式", input: {props: {locale: "zh-CN"}}},
                {id: "long", label: "很长的 id 与版本", input: {props: {locale: "zh-CN"}}},
                {id: "downgrade", label: "安装预览为降级", input: {props: {locale: "zh-CN"}}},
                {id: "blocked", label: "升级预览列出重启后受阻的插件", input: {props: {locale: "zh-CN"}}},
                {id: "blocked-english", label: "升级预览列出重启后受阻的插件，英文界面", input: {props: {locale: "en-US"}}},
                {id: "loading", label: "读取中", input: {props: {locale: "zh-CN"}}},
                {id: "failed", label: "读取失败", input: {props: {locale: "zh-CN"}}},
                {id: "english", label: "英文界面", input: {props: {locale: "en-US"}}},
                {id: "write-failed", label: "写操作失败（点开关看失败说明）", input: {props: {locale: "zh-CN"}}},
                {id: "write-failed-english", label: "写操作失败，英文界面", input: {props: {locale: "en-US"}}},
                {id: "busy", label: "写操作进行中（点开关或卸载后不结算）", input: {props: {locale: "zh-CN"}}},
            ],
            load: async () => (await import("./PluginsPageFixture.vue")).default,
        }),
    ];
}

/**
 * 设置窗口（docs/specs/settings/settings-window.md）与给页面用的两个组件。窗口与 SettingsRow 由设置场景的局部宿主驱动
 * （`settings-scene/`）：产品里同一个窗口模型与配置实例，配置层换成内存里的拥有者。
 */
function settingsFixtures(): LabFixture[] {
    const row = (setting: typeof appearanceSetting | typeof sceneThemeSetting | typeof localeSetting | typeof snippetsSettings.items | typeof rowDemoSettings.workers | typeof rowDemoSettings.library | typeof rowDemoSettings.mode, layer: "user" | "project", wide = false) => ({setting, layer, projectTitle: "雾港", wide});
    /** 状态原因：出错、警告、淡色各一条，看图标取最重的色调、提示逐条列出。 */
    const reasons = [
        {tone: "error" as const, text: "未保存：取值范围为 1–8"},
        {tone: "warning" as const, text: "这个值偏大，抽取会很慢"},
        {tone: "muted" as const, text: "无法加载选项：插件“模型服务”已停止"},
    ];
    return [
        defineLabFixture<typeof SettingsWindow>({
            component: "SettingsWindow",
            noInput: "窗口由场景的局部宿主驱动（窗口模型、配置实例与分区注册表，配置层在内存里），没有可登记的 JSON 输入",
            scenes: SETTINGS_WINDOW_SCENES.map((scene) => ({id: scene.id, label: scene.label})),
            load: async () => (await import("./SettingsWindowFixture.vue")).default,
        }),
        defineLabFixture<typeof SettingsRow>({
            component: "SettingsRow",
            scenes: [
                {id: "modified", label: "用户层已修改", input: {props: row(appearanceSetting, "user")}},
                {id: "overridden", label: "被本作品覆盖", input: {props: row(appearanceSetting, "user")}},
                {id: "inherit", label: "本作品标签：沿用（来自用户设置）", input: {props: row(sceneThemeSetting, "project")}},
                {id: "project-set", label: "本作品标签：单独设置了", input: {props: row(appearanceSetting, "project")}},
                {id: "invalid", label: "层文件有错误（停用）", input: {props: row(appearanceSetting, "user")}},
                {id: "unreachable", label: "层连不上（停用）", input: {props: row(appearanceSetting, "user")}},
                {id: "wide", label: "宽排法：控件另起一行", input: {props: row(snippetsSettings.items, "user", true)}},
                {id: "not-allowed", label: "不允许这一层", input: {props: row(localeSetting, "project")}},
                {id: "multi-reason", label: "多个状态原因（一个图标，色调取最重的）", input: {props: {...row(rowDemoSettings.workers, "user"), reasons}}},
                {id: "read-only", label: "只读：只写值，最右一格是锁", input: {props: row(rowDemoSettings.library, "user")}},
                {id: "project-wide-inherit", label: "本作品标签：宽排法沿用", input: {props: row(snippetsSettings.items, "project", true)}},
                {id: "narrow", label: "560px 宽：控件换到标题下面", input: {props: row(rowDemoSettings.mode, "user")}},
            ],
            load: async () => (await import("./SettingsRowFixture.vue")).default,
        }),
        defineLabFixture<typeof SettingsPageActions>({
            component: "SettingsPageActions",
            noInput: "操作由插槽给出，层能不能写由窗口通道给出，没有可登记的 JSON 输入",
            scenes: [
                {id: "in-place", label: "没有窗口通道：一个操作原位渲染"},
                {id: "multiple", label: "没有窗口通道：多个操作（按钮与图标按钮）"},
                {id: "in-title", label: "有窗口通道：操作画在标题区右侧"},
                {id: "disabled", label: "有窗口通道、这一层不能写：操作整体停用，可切换恢复"},
            ],
            load: async () => (await import("./SettingsPageActionsFixture.vue")).default,
        }),
        defineLabFixture<typeof SettingsSaveBar>({
            component: "SettingsSaveBar",
            scenes: [
                {id: "clean", label: "没有改动：两个按钮停用，不写字", input: {props: {dirty: false, busy: false}}},
                {id: "dirty", label: "有改动：缺省文字，按钮可用", input: {props: {dirty: true, busy: false}}},
                {id: "busy", label: "保存中：按钮停用", input: {props: {dirty: true, busy: true}}},
                {id: "message", label: "自定义文字", input: {props: {dirty: true, busy: false, message: "还没保存：“接口地址”还没有填写"}}},
                {id: "english", label: "英文界面", input: {props: {dirty: true, busy: false}}},
            ],
            load: async () => withSettingsText(createSubjectFixture<typeof SettingsSaveBar>((await import("nbook/ui/settings/SettingsSaveBar.vue")).default, {class: "w-full"})),
        }),
        defineSubjectFixture<typeof HighlightedText>({
            component: "HighlightedText",
            scenes: [
                {id: "single", label: "一个词：标题里的命中", input: {props: {text: "终端字号", words: ["字号"]}}},
                {id: "multi", label: "多个词、每个词的所有命中都标", input: {props: {text: "代码里的字号与行距；字号越大越清楚", words: ["字号", "行距"]}}},
                {id: "case", label: "不分大小写，标出的是原文的写法", input: {props: {text: "Font Size 与 FONT 与 font", words: ["font"]}}},
                {id: "escaped", label: "尖括号、&、正则元字符按文字显示与查找", input: {props: {text: "<b>粗体</b> & (a+b)* .*", words: ["<b>", "&", "(a+b)*", ".*"]}}},
                {id: "none", label: "没有命中：原样显示", input: {props: {text: "界面的主题与语言", words: ["字号"]}}},
            ],
            subject: () => import("nbook/ui/settings/HighlightedText.vue"),
        }),
        defineLabFixture<typeof SettingsPageList>({
            component: "SettingsPageList",
            scenes: (() => {
                const providers = [
                    {id: "deepseek", title: "DeepSeek", description: "https://api.deepseek.com", icon: "i-lucide-server", status: "已连接", tone: "success" as const, modified: true},
                    {id: "ollama", title: "本地 Ollama", description: "http://127.0.0.1:11434/v1", icon: "i-lucide-server", status: "未连接"},
                    {id: "openai", title: "OpenAI", description: "https://api.openai.com/v1", icon: "i-lucide-server", status: "密钥已过期", tone: "warning" as const},
                    {id: "custom", title: "自建服务", description: "http://llm.internal/v1", icon: "i-lucide-server", status: "连接失败", tone: "error" as const},
                ];
                const long = [
                    {id: "a", title: "一个名字很长很长的自建兼容服务（内网环境下的备用线路）", description: "https://llm.internal.example.com/v1/chat/completions/with/a/very/long/path", icon: "i-lucide-server", status: "已连接", tone: "success" as const, modified: true},
                    {id: "b", title: "备用"},
                ];
                return [
                    {id: "list", label: "列表：图标、说明、状态色调（成功、淡色、警告、出错）与改动圆点", input: {props: {items: providers, label: "服务商"}, model: {modelValue: null}}},
                    {id: "long", label: "长标题与长说明截断，状态文字不缩", input: {props: {items: long, label: "服务商"}, model: {modelValue: null}}},
                    {id: "open", label: "打开一项（没有窗口通道）：详情上方自己画“‹ 返回”，返回后焦点回到这一行", input: {props: {items: providers, label: "服务商"}, model: {modelValue: "deepseek"}}},
                    {id: "open-in-title", label: "打开一项（有窗口通道）：标题区换成“‹ 模型服务”与这一项的标题", input: {props: {items: providers, label: "服务商"}, model: {modelValue: "deepseek"}}},
                ];
            })(),
            load: async () => (await import("./SettingsPageListFixture.vue")).default,
        }),
    ];
}

export function findLabFixture(component: string): LabFixture | null {
    return labFixtures.find((fixture) => fixture.component === component) ?? null;
}
