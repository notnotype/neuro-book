/** nb-ui 展示类（`display/`）与导航类（`navigation/`）的场景。`Avatar` 会加载图片地址（`io:read`），按标签不可挂载。 */

import type {Badge, Breadcrumb, EmptyState, FileTree, Kbd, NavigationMenu, Progress, Rating, Skeleton, Spinner, Table, Tree} from "@notnotype/nb-ui/components";
import {h} from "vue";

import {Button as NbButton} from "@notnotype/nb-ui/components";

import type {LabFixture} from "../index";
import {defineSubjectFixture} from "../subject-fixture";
import {nbUiSubject} from "./shared";

const CHAPTER_ROWS = [
    {title: "第一章 灯塔", words: 3182, status: "已定稿", updated: "10-02"},
    {title: "第二章 雾中城", words: 4410, status: "修改中", updated: "10-05"},
    {title: "第三章 巡夜人", words: 2876, status: "草稿", updated: "10-08"},
    {title: "第四章 一个非常长的章节标题，用来看单元格放不下时怎样截断或换行", words: 512, status: "草稿", updated: "10-10"},
];
type ChapterRow = (typeof CHAPTER_ROWS)[number];
/**
 * `Table` 是泛型组件（`generic="Row"`），场景的类型推导只认组件构造器：按章节行实例化它的 props，
 * 拼成同形状的构造器类型。props 仍取自组件本身，Table 改了签名这里一起变。
 */
type ChapterTable = new () => {$props: Parameters<typeof Table<ChapterRow>>[0]};
const CHAPTER_COLUMNS = [
    {key: "title" as const, label: "章节"},
    {key: "words" as const, label: "字数", width: "80px", align: "right" as const},
    {key: "status" as const, label: "状态", width: "80px"},
    {key: "updated" as const, label: "修改", width: "64px", align: "center" as const},
];

const FILE_NODES = [
    {id: "manuscript", label: "manuscript", kind: "directory" as const, children: [
        {id: "volume-1", label: "第一卷", kind: "directory" as const, children: [
            {id: "ch-1", label: "第一章 灯塔.md", kind: "file" as const},
            {id: "ch-2", label: "第二章 雾中城.md", kind: "file" as const},
        ]},
        {id: "volume-2", label: "第二卷", kind: "directory" as const, children: []},
    ]},
    {id: "lorebook", label: "lorebook", kind: "directory" as const, children: [
        {id: "shen-yu", label: "沈屿.md", kind: "file" as const},
        {id: "locked", label: "只读素材.md", kind: "file" as const, disabled: true},
    ]},
    {id: "readme", label: "README.md", kind: "file" as const},
];

const TREE_ITEMS = [
    {id: "outline", title: "大纲", iconClass: "i-lucide-list-tree", children: [
        {id: "act-1", title: "第一幕：雾港", children: [{id: "scene-1", title: "灯塔熄灭"}, {id: "scene-2", title: "巡夜人"}]},
        {id: "act-2", title: "第二幕：雪线", children: [{id: "scene-3", title: "渡口", disabled: true}]},
    ]},
    {id: "characters", title: "人物", iconClass: "i-lucide-users", children: [{id: "shen-yu", title: "沈屿"}, {id: "lin-wan", title: "林晚"}]},
];

const NAV_ITEMS = [
    {id: "write", label: "写作", links: [
        {title: "继续写作", description: "回到上次停下的章节", iconClass: "i-lucide-pen-line"},
        {title: "新建章节", description: "在当前卷末尾", iconClass: "i-lucide-file-plus"},
    ]},
    {id: "world", label: "世界", links: [
        {title: "人物", description: "角色卡与关系", iconClass: "i-lucide-users"},
        {title: "地点", description: "地图与场景", iconClass: "i-lucide-map"},
    ]},
    {id: "docs", label: "文档", href: "#docs"},
];

export const displayFixtures: LabFixture[] = [
    defineSubjectFixture<typeof Badge>({
        component: "Badge",
        slotPresets: {default: () => "草稿"},
        scenes: [
            {id: "soft", label: "柔和", input: {props: {tone: "neutral", variant: "soft", size: "sm"}, slots: {default: true}}},
            {id: "accent", label: "强调、实心", input: {props: {tone: "accent", variant: "solid", size: "md"}, slots: {default: true}}},
            {id: "outline", label: "描边、带图标", input: {props: {tone: "success", variant: "outline", size: "sm", iconClass: "i-lucide-check"}, slots: {default: true}}},
            {id: "dot", label: "状态点", input: {props: {tone: "warning", variant: "soft", size: "sm", dot: true}, slots: {default: true}}},
            {id: "count", label: "计数", input: {props: {tone: "danger", variant: "solid", size: "sm", count: 128}, slots: {default: false}}},
        ],
        subject: nbUiSubject("Badge"),
    }),
    defineSubjectFixture<typeof EmptyState>({
        component: "EmptyState",
        class: "w-full",
        slotPresets: {action: () => h(NbButton, {size: "sm", iconClass: "i-lucide-plus"}, () => "新建作品")},
        scenes: [
            {id: "default", label: "图标、标题与操作", input: {props: {iconClass: "i-lucide-book-open", title: "书架上还没有作品", description: "新建一部作品，或把已有的目录加入书架。"}, slots: {action: true}}},
            {id: "plain", label: "只有说明", input: {props: {description: "没有匹配的结果"}, slots: {action: false}}},
        ],
        subject: nbUiSubject("EmptyState"),
    }),
    defineSubjectFixture<typeof Kbd>({
        component: "Kbd",
        slotPresets: {default: () => "Ctrl+Shift+P"},
        scenes: [
            {id: "md", label: "默认", input: {props: {size: "md"}, slots: {default: true}}},
            {id: "sm", label: "小号", input: {props: {size: "sm"}, slots: {default: true}}},
            {id: "lg", label: "大号", input: {props: {size: "lg"}, slots: {default: true}}},
        ],
        subject: nbUiSubject("Kbd"),
    }),
    defineSubjectFixture<typeof Progress>({
        component: "Progress",
        class: "w-full max-w-[360px]",
        scenes: [
            {id: "accent", label: "进行中", input: {props: {modelValue: 42, max: 100, tone: "accent", size: "md"}}},
            {id: "success", label: "完成", input: {props: {modelValue: 3000, max: 3000, tone: "success", size: "sm"}}},
            {id: "danger", label: "超出（危险色）", input: {props: {modelValue: 96, max: 100, tone: "danger", size: "lg"}}},
        ],
        subject: nbUiSubject("Progress"),
    }),
    defineSubjectFixture<typeof Rating>({
        component: "Rating",
        scenes: [
            {id: "default", label: "可评分", input: {props: {max: 5, size: "md"}, model: {modelValue: 3}}},
            {id: "half", label: "半星", input: {props: {max: 5, size: "lg", allowHalf: true}, model: {modelValue: 3.5}}},
            {id: "readonly", label: "只读", input: {props: {max: 5, size: "sm", readonly: true}, model: {modelValue: 4}}},
        ],
        subject: nbUiSubject("Rating"),
    }),
    defineSubjectFixture<typeof Skeleton>({
        component: "Skeleton",
        class: "w-full max-w-[360px]",
        scenes: [
            {id: "text", label: "一行文字", input: {props: {shape: "text", width: "80%"}}},
            {id: "block", label: "块", input: {props: {shape: "block", width: "100%", height: "120px"}}},
            {id: "circle", label: "圆", input: {props: {shape: "circle", width: "48px", height: "48px"}}},
        ],
        subject: nbUiSubject("Skeleton"),
    }),
    defineSubjectFixture<typeof Spinner>({
        component: "Spinner",
        scenes: [
            {id: "md", label: "默认", input: {props: {size: "md", label: "正在载入"}}},
            {id: "label", label: "显示文字", input: {props: {size: "sm", label: "正在载入章节", showLabel: true}}},
            {id: "lg", label: "大号", input: {props: {size: "lg", label: "正在载入"}}},
        ],
        subject: nbUiSubject("Spinner"),
    }),
    defineSubjectFixture<ChapterTable>({
        component: "Table",
        events: ["row-click"],
        class: "w-full",
        scenes: [
            {id: "default", label: "章节表", input: {props: {columns: CHAPTER_COLUMNS, rows: CHAPTER_ROWS, rowKey: "title", hoverable: true, density: "default"}}},
            {id: "compact", label: "紧凑", input: {props: {columns: CHAPTER_COLUMNS, rows: CHAPTER_ROWS, rowKey: "title", density: "compact"}}},
            {id: "loading", label: "加载中", input: {props: {columns: CHAPTER_COLUMNS, rows: [], loading: true}}},
            {id: "empty", label: "空表", input: {props: {columns: CHAPTER_COLUMNS, rows: [], emptyText: "这一卷还没有章节"}}},
        ],
        subject: nbUiSubject("Table"),
    }),
    defineSubjectFixture<typeof Breadcrumb>({
        component: "Breadcrumb",
        events: ["click"],
        scenes: [
            {id: "default", label: "三级", input: {props: {items: [{label: "长夜行", iconClass: "i-lucide-book"}, {label: "第二卷"}, {label: "第十七章 雪线", current: true}]}}},
            {id: "long", label: "很多级", input: {props: {items: ["manuscript", "第二卷", "上部", "雪线", "草稿", "第十七章 雪线（修订三）"].map((label, index, all) => ({label, current: index === all.length - 1}))}}},
        ],
        subject: nbUiSubject("Breadcrumb"),
    }),
    defineSubjectFixture<typeof FileTree>({
        component: "FileTree",
        events: ["select", "activate", "move", "contextmenu"],
        writeBack: {select: {layer: "props", key: "selectedId"}},
        class: "h-full w-full",
        scenes: [
            {id: "default", label: "目录与文件", input: {props: {nodes: FILE_NODES, selectedId: "ch-2", ariaLabel: "项目文件", draggable: true, indent: 12}, model: {expandedIds: ["manuscript", "volume-1"]}}},
            {id: "collapsed", label: "全部收起", input: {props: {nodes: FILE_NODES, selectedId: null, ariaLabel: "项目文件"}, model: {expandedIds: []}}},
            {id: "empty", label: "空", input: {props: {nodes: [], ariaLabel: "项目文件"}, model: {expandedIds: []}}},
        ],
        subject: nbUiSubject("FileTree"),
    }),
    defineSubjectFixture<typeof NavigationMenu>({
        component: "NavigationMenu",
        events: ["select"],
        scenes: [
            {id: "horizontal", label: "横向", input: {props: {items: NAV_ITEMS, orientation: "horizontal"}, model: {modelValue: ""}}},
            {id: "vertical", label: "纵向", input: {props: {items: NAV_ITEMS, orientation: "vertical"}, model: {modelValue: "write"}}},
        ],
        subject: nbUiSubject("NavigationMenu"),
    }),
    defineSubjectFixture<typeof Tree>({
        component: "Tree",
        events: ["select"],
        class: "h-full w-full",
        scenes: [
            {id: "card", label: "卡片面", input: {props: {items: TREE_ITEMS, surface: "card"}, model: {modelValue: "scene-2", expanded: ["outline", "act-1"]}}},
            {id: "plain", label: "平面、多选", input: {props: {items: TREE_ITEMS, surface: "plain", multiple: true}, model: {modelValue: ["shen-yu", "lin-wan"], expanded: ["characters"]}}},
            {id: "disabled", label: "禁用", input: {props: {items: TREE_ITEMS, surface: "card", disabled: true}, model: {modelValue: "act-1", expanded: ["outline"]}}},
        ],
        subject: nbUiSubject("Tree"),
    }),
];
