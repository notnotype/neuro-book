/** nb-ui 控件类（`controls/`）的场景。 */

import {h} from "vue";

import {Button as NbButton, IconButton as NbIconButton} from "@notnotype/nb-ui/components";
import type {
    Button,
    CopyButton,
    DropdownMenu,
    IconButton,
    Menubar,
    SegmentedControl,
    Switch,
    Tabs,
    ToggleGroup,
    Toolbar,
} from "@notnotype/nb-ui/components";

import type {LabFixture} from "../index";
import {defineSubjectFixture} from "../subject-fixture";
import {nbUiSubject} from "./shared";

const DROPDOWN_ITEMS = [
    {label: "重命名", id: "rename", iconClass: "i-lucide-pencil", shortcut: "F2"},
    {label: "复制路径", id: "copy-path", iconClass: "i-lucide-copy"},
    {label: "移到回收站", id: "trash", iconClass: "i-lucide-archive", disabled: true, title: "根目录不能移到回收站"},
    {label: "", id: "sep-1", separator: true},
    {label: "排序方式", id: "sort", iconClass: "i-lucide-arrow-down-wide-narrow", children: [
        {label: "按名称", id: "sort-name", type: "radio" as const, checked: true, group: "sort"},
        {label: "按修改时间", id: "sort-mtime", type: "radio" as const, checked: false, group: "sort"},
    ]},
    {label: "显示隐藏文件", id: "hidden", type: "checkbox" as const, checked: false},
    {label: "", id: "sep-2", separator: true},
    {label: "删除", id: "delete", iconClass: "i-lucide-trash-2", tone: "danger" as const},
];

/** 勾选项也带快捷键：左侧勾选列与右侧快捷键同时出现。 */
const DROPDOWN_CHECKED_ITEMS = [
    {label: "自动换行", id: "wrap", type: "checkbox" as const, checked: true, shortcut: "Alt+Z"},
    {label: "显示行号", id: "line-numbers", type: "checkbox" as const, checked: false},
    {label: "", id: "sep-1", separator: true},
    {label: "浅色", id: "light", type: "radio" as const, checked: false, group: "theme"},
    {label: "深色", id: "dark", type: "radio" as const, checked: true, group: "theme"},
    {label: "跟随系统", id: "system", type: "radio" as const, checked: false, group: "theme"},
];

const MENUBAR_MENUS = [
    {id: "file", label: "文件", items: [
        {label: "新建章节", id: "new-chapter", shortcut: "Ctrl+N", iconClass: "i-lucide-file-plus"},
        {label: "打开项目…", id: "open-project", shortcut: "Ctrl+O"},
        {label: "", id: "sep", separator: true},
        {label: "导出", id: "export", children: [
            {label: "Markdown", id: "export-md"},
            {label: "EPUB", id: "export-epub", disabled: true},
        ]},
    ]},
    {id: "edit", label: "编辑", items: [
        {label: "撤销", id: "undo", shortcut: "Ctrl+Z"},
        {label: "重做", id: "redo", shortcut: "Ctrl+Shift+Z", disabled: true, title: "没有可以重做的操作"},
        {label: "查找", id: "find", shortcut: "Ctrl+F"},
    ]},
    {id: "view", label: "视图", items: [
        {label: "显示侧栏", id: "sidebar", type: "checkbox" as const, checked: true},
        {label: "显示面板", id: "panel", type: "checkbox" as const, checked: false},
    ]},
    {id: "help", label: "帮助", disabled: true, items: []},
];

const TABS = [
    {value: "doc", label: "文档"},
    {value: "element", label: "元素"},
    {value: "events", label: "事件", count: 12},
    {value: "data", label: "数据"},
    {value: "disabled", label: "不可用", disabled: true},
];

const SEGMENTS = [
    {value: "free", label: "随窗口"},
    {value: "tablet", label: "平板"},
    {value: "phone", label: "手机"},
];

/** 标签长短不一：宽度随内容时最长的“跟随系统”也要完整显示。 */
const APPEARANCES = [
    {value: "light", label: "浅色"},
    {value: "dark", label: "深色"},
    {value: "system", label: "跟随系统"},
];

const THINKING_FIVE = [{value: "off", label: "关闭"}, {value: "low", label: "低"}, {value: "medium", label: "中"}, {value: "high", label: "高"}, {value: "xhigh", label: "极高"}];
/** 七档的缩写标签（全名放 title）：窄面板里全名会被截成读不出的样子。 */
const THINKING_SEVEN = [
    {value: "off", label: "Off", title: "Off"}, {value: "minimal", label: "Min", title: "Minimal"}, {value: "low", label: "Low", title: "Low"}, {value: "medium", label: "Med", title: "Medium"},
    {value: "high", label: "High", title: "High"}, {value: "xhigh", label: "XHigh", title: "Extra high"}, {value: "max", label: "Max", title: "Max"},
];

export const controlsFixtures: LabFixture[] = [
    defineSubjectFixture<typeof Button>({
        component: "Button",
        slotPresets: {default: () => "保存草稿"},
        scenes: [
            {id: "primary", label: "主要", input: {props: {variant: "primary", size: "md"}, slots: {default: true}}},
            {id: "secondary", label: "次要", input: {props: {variant: "secondary", size: "md", iconClass: "i-lucide-download"}, slots: {default: true}}},
            {id: "subtle", label: "柔和", input: {props: {variant: "subtle", size: "sm"}, slots: {default: true}}},
            {id: "danger", label: "危险", input: {props: {variant: "danger", size: "md", iconClass: "i-lucide-trash-2"}, slots: {default: true}}},
            {id: "ghost", label: "幽灵", input: {props: {variant: "ghost", size: "md"}, slots: {default: true}}},
            {id: "loading", label: "加载中", input: {props: {variant: "primary", size: "md", loading: true}, slots: {default: true}}},
            {id: "loading-icon", label: "带图标加载中", input: {props: {variant: "secondary", size: "md", iconClass: "i-lucide-download", loading: true}, slots: {default: true}}},
            {id: "disabled", label: "禁用", input: {props: {variant: "primary", size: "md", disabled: true}, slots: {default: true}}},
            {id: "block", label: "撑满宽度", input: {props: {variant: "secondary", size: "lg", block: true}, slots: {default: true}}},
        ],
        subject: nbUiSubject("Button"),
    }),
    defineSubjectFixture<typeof CopyButton>({
        component: "CopyButton",
        scenes: [
            {id: "default", label: "复制一段原文（点一下看回执）", input: {props: {text: "EditorSaveError: EACCES: permission denied\n    trace: 4f2a9c1e"}}},
            {id: "label", label: "自定义按钮文字", input: {props: {text: "4f2a9c1e", label: "复制追踪号"}}},
        ],
        subject: nbUiSubject("CopyButton"),
    }),
    defineSubjectFixture<typeof IconButton>({
        component: "IconButton",
        scenes: [
            {id: "default", label: "默认", input: {props: {title: "刷新", iconClass: "i-lucide-refresh-cw", size: "md", variant: "default"}}},
            {id: "accent", label: "强调", input: {props: {title: "新建", iconClass: "i-lucide-plus", size: "md", variant: "accent"}}},
            {id: "danger", label: "危险", input: {props: {title: "删除", iconClass: "i-lucide-trash-2", size: "md", variant: "danger"}}},
            {id: "small", label: "紧凑", input: {props: {title: "关闭", iconClass: "i-lucide-x", size: "sm", variant: "secondary"}}},
            {id: "disabled", label: "禁用", input: {props: {title: "上移", iconClass: "i-lucide-arrow-up", size: "md", disabled: true}}},
        ],
        subject: nbUiSubject("IconButton"),
    }),
    defineSubjectFixture<typeof DropdownMenu>({
        component: "DropdownMenu",
        events: ["select"],
        slotPresets: {default: () => h(NbButton, {variant: "secondary", size: "sm", iconClass: "i-lucide-ellipsis"}, () => "更多操作")},
        scenes: [
            {id: "default", label: "图标、快捷键、子菜单与危险项", input: {props: {items: DROPDOWN_ITEMS, align: "start", side: "bottom"}, model: {open: false}, slots: {default: true}}},
            {id: "checked", label: "勾选项与快捷键", input: {props: {items: DROPDOWN_CHECKED_ITEMS, align: "start", side: "bottom"}, model: {open: false}, slots: {default: true}}},
            {id: "long", label: "很多项时内部滚动", input: {props: {items: Array.from({length: 40}, (_, index) => ({label: `第 ${String(index + 1)} 章`, id: `chapter-${String(index + 1)}`})), align: "start", side: "bottom"}, model: {open: false}, slots: {default: true}}},
            {id: "disabled", label: "禁用", input: {props: {items: DROPDOWN_ITEMS, disabled: true, align: "start", side: "bottom"}, model: {open: false}, slots: {default: true}}},
            {id: "wrap", label: "长文字换行", input: {props: {items: [{label: "未保存的文档：未保存 3 个（第一章.md、第二章.md、第三章.md）", id: "unsaved"}, {label: "字数：12,345 字", id: "words", disabled: true}, ...DROPDOWN_ITEMS.slice(0, 2)], wrap: true, align: "start", side: "bottom"}, model: {open: false}, slots: {default: true}}},
        ],
        subject: nbUiSubject("DropdownMenu"),
    }),
    defineSubjectFixture<typeof Menubar>({
        component: "Menubar",
        events: ["select"],
        class: "w-full",
        scenes: [
            {id: "default", label: "文件、编辑、视图、帮助", input: {props: {menus: MENUBAR_MENUS, size: "sm"}, model: {modelValue: ""}}},
            {id: "medium", label: "中号", input: {props: {menus: MENUBAR_MENUS, size: "md"}, model: {modelValue: ""}}},
            {id: "flat", label: "嵌进标题栏（flat）", input: {props: {menus: MENUBAR_MENUS, size: "sm", variant: "flat"}, model: {modelValue: ""}}},
        ],
        subject: nbUiSubject("Menubar"),
    }),
    defineSubjectFixture<typeof SegmentedControl>({
        component: "SegmentedControl",
        scenes: [
            {id: "default", label: "三档", input: {props: {options: SEGMENTS, ariaLabel: "画布尺寸", size: "sm"}, model: {modelValue: "free"}}},
            {id: "counts", label: "带计数", input: {props: {options: [{value: "all", label: "全部", count: 128}, {value: "dirty", label: "未保存", count: 3}, {value: "conflict", label: "冲突", count: 0, disabled: true}], ariaLabel: "筛选", size: "sm"}, model: {modelValue: "all"}}},
            {id: "uneven", label: "长短不一：段宽取最长一项", input: {props: {options: APPEARANCES, ariaLabel: "外观", size: "sm"}, model: {modelValue: "system"}}},
            {id: "full-width", label: "撑满等分", input: {props: {options: SEGMENTS, ariaLabel: "画布尺寸", size: "sm", fullWidth: true}, model: {modelValue: "phone"}}},
            {id: "xs", label: "最小号", input: {props: {options: SEGMENTS, ariaLabel: "画布尺寸", size: "xs"}, model: {modelValue: "tablet"}}},
            {id: "readonly", label: "只读（可聚焦，不改值）", input: {props: {options: APPEARANCES, ariaLabel: "外观", size: "sm", readonly: true}, model: {modelValue: "system"}}},
            {id: "disabled", label: "整组停用", input: {props: {options: APPEARANCES, ariaLabel: "外观", size: "sm", disabled: true}, model: {modelValue: "system"}}},
            {id: "invalid", label: "出错", input: {props: {options: APPEARANCES, ariaLabel: "外观", size: "sm", invalid: true}, model: {modelValue: "system"}}},
            // 浮起的外观与跟随来的当前值：思考档用；英文标签与 7 档在窄面板里的样子见 raised-seven。
            {id: "raised", label: "浮起的外观", input: {props: {options: THINKING_FIVE, ariaLabel: "思考档", size: "xs", variant: "raised"}, model: {modelValue: "high"}}},
            {id: "raised-inherited", label: "浮起的外观，跟随来的当前值（只画细框）", input: {props: {options: THINKING_FIVE, ariaLabel: "思考档", size: "xs", variant: "raised", inherited: true}, model: {modelValue: "high"}}},
            {id: "inherited-solid", label: "默认外观，跟随来的当前值", input: {props: {options: THINKING_FIVE, ariaLabel: "思考档", size: "xs", inherited: true}, model: {modelValue: "medium"}}},
            {id: "raised-seven", label: "七档英文，撑满一行（窄面板里标签用缩写）", input: {props: {options: THINKING_SEVEN, ariaLabel: "Thinking level", size: "xs", variant: "raised", fullWidth: true}, model: {modelValue: "xhigh"}}},
            {id: "raised-disabled", label: "浮起的外观，整组停用", input: {props: {options: THINKING_FIVE, ariaLabel: "思考档", size: "xs", variant: "raised", disabled: true}, model: {modelValue: "high"}}},
            // 换行：拖窄画布（或选手机尺寸）看整段换到下一行；选中第二行的那一段，它自己画实底。
            {id: "wrap", label: "换行（选中第二行的一段）", input: {props: {options: [{value: "all", label: "全部", count: 5}, {value: "readerOnly", label: "只有读者知道", count: 0}, {value: "readerUnaware", label: "读者还不知道", count: 2}, {value: "noPlan", label: "没打算怎么揭", count: 1}], ariaLabel: "分段", size: "sm", wrap: true}, model: {modelValue: "noPlan"}}},
        ],
        subject: nbUiSubject("SegmentedControl"),
    }),
    defineSubjectFixture<typeof Switch>({
        component: "Switch",
        scenes: [
            {id: "on", label: "开", input: {props: {ariaLabel: "自动保存", size: "md"}, model: {modelValue: true}}},
            {id: "off", label: "关", input: {props: {ariaLabel: "自动保存", size: "md"}, model: {modelValue: false}}},
            {id: "small", label: "小号", input: {props: {ariaLabel: "自动保存", size: "sm"}, model: {modelValue: true}}},
            {id: "disabled", label: "禁用", input: {props: {ariaLabel: "自动保存", size: "md", disabled: true}, model: {modelValue: true}}},
            {id: "readonly", label: "只读", input: {props: {ariaLabel: "自动保存", size: "md", readonly: true}, model: {modelValue: true}}},
            {id: "invalid", label: "出错", input: {props: {ariaLabel: "自动保存", size: "md", invalid: true}, model: {modelValue: false}}},
        ],
        subject: nbUiSubject("Switch"),
    }),
    defineSubjectFixture<typeof Tabs>({
        component: "Tabs",
        class: "w-full",
        scenes: [
            {id: "default", label: "带计数与不可用项", input: {props: {items: TABS, ariaLabel: "检视", size: "md"}, model: {modelValue: "doc"}}},
            {id: "small", label: "小号", input: {props: {items: TABS, ariaLabel: "检视", size: "sm"}, model: {modelValue: "events"}}},
            {id: "overflow", label: "放不下时横向滚动", input: {props: {items: Array.from({length: 16}, (_, index) => ({value: `ch-${String(index)}`, label: `第 ${String(index + 1)} 章`, iconClass: "i-lucide-file-text"})), ariaLabel: "章节", size: "sm"}, model: {modelValue: "ch-0"}}},
            // 拖画布宽度看四档：完整、截断到 96px、只留图标、收进“更多”。
            {id: "adapt", label: "放不下时逐级让位", input: {props: {items: [
                {value: "terminal", label: "终端", iconClass: "i-lucide-terminal"},
                {value: "output", label: "输出：一个很长的面板标题", iconClass: "i-lucide-scroll-text"},
                {value: "problems", label: "问题", iconClass: "i-lucide-circle-alert", count: 3},
                {value: "history", label: "历史记录", iconClass: "i-lucide-history"},
            ], ariaLabel: "面板", size: "sm", overflow: "adapt"}, model: {modelValue: "problems"}}},
            // 标签上的菜单与附注：带菜单的标签都留箭头格、选中的显出；附注写在标题后。点选中的那个发 menu（菜单由消费方画）。
            {id: "menu", label: "标签上的菜单与附注", input: {props: {items: [
                {value: "person", label: "人物", iconClass: "i-lucide-user-round", menu: {open: false}, note: "AI视图"},
                {value: "look", label: "形象", iconClass: "i-lucide-shirt", menu: {open: false}},
                {value: "text", label: "文字", iconClass: "i-lucide-file-text"},
            ], ariaLabel: "条目的分页", size: "sm"}, model: {modelValue: "person"}}},
        ],
        subject: nbUiSubject("Tabs"),
    }),
    defineSubjectFixture<typeof ToggleGroup>({
        component: "ToggleGroup",
        scenes: [
            {id: "multiple", label: "格式开关", input: {props: {options: [{value: "bold", iconClass: "i-lucide-bold", title: "粗体"}, {value: "italic", iconClass: "i-lucide-italic", title: "斜体"}, {value: "strike", iconClass: "i-lucide-strikethrough", title: "删除线"}], size: "md"}, model: {modelValue: ["bold"]}}},
            {id: "labels", label: "文字选项", input: {props: {options: [{value: "notes", label: "批注"}, {value: "changes", label: "修订"}], size: "sm"}, model: {modelValue: ["notes", "changes"]}}},
            {id: "none", label: "都没按下", input: {props: {options: [{value: "bold", iconClass: "i-lucide-bold", title: "粗体"}, {value: "italic", iconClass: "i-lucide-italic", title: "斜体"}], size: "md"}, model: {modelValue: []}}},
            {id: "vertical", label: "纵向", input: {props: {orientation: "vertical", options: [{value: "a", label: "第一卷"}, {value: "b", label: "第二卷"}, {value: "c", label: "第三卷", disabled: true}], size: "md"}, model: {modelValue: ["a"]}}},
        ],
        subject: nbUiSubject("ToggleGroup"),
    }),
    defineSubjectFixture<typeof Toolbar>({
        component: "Toolbar",
        slotPresets: {
            default: () => [
                h(NbIconButton, {title: "新建文件", iconClass: "i-lucide-file-plus", size: "sm"}),
                h(NbIconButton, {title: "新建文件夹", iconClass: "i-lucide-folder-plus", size: "sm"}),
                h(NbIconButton, {title: "刷新", iconClass: "i-lucide-refresh-cw", size: "sm"}),
                h(NbIconButton, {title: "全部收起", iconClass: "i-lucide-copy-minus", size: "sm"}),
            ],
        },
        scenes: [
            {id: "horizontal", label: "横向", input: {props: {orientation: "horizontal", ariaLabel: "资源管理器工具"}, slots: {default: true}}},
            {id: "vertical", label: "纵向", input: {props: {orientation: "vertical", ariaLabel: "资源管理器工具"}, slots: {default: true}}},
            {id: "flat", label: "没有面板外观", input: {props: {orientation: "horizontal", variant: "flat", ariaLabel: "资源管理器工具"}, slots: {default: true}}},
        ],
        subject: nbUiSubject("Toolbar"),
    }),
];
