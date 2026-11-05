/** nb-ui 控件类（`controls/`）的场景。 */

import {h} from "vue";

import {Button as NbButton, IconButton as NbIconButton} from "@notnotype/nb-ui/components";
import type {
    Button,
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
