/** nb-ui 控件类（`controls/`）的场景。 */

import {h} from "vue";

import {Button as NbButton, IconButton as NbIconButton} from "@notnotype/nb-ui/components";
import type {
    Button,
    Dropdown,
    Editable,
    IconButton,
    Menubar,
    Pagination,
    SegmentedControl,
    Stepper,
    Switch,
    SwitchField,
    Tabs,
    ToggleGroup,
    Toolbar,
} from "@notnotype/nb-ui/components";

import type {LabFixture} from "../index";
import {defineSubjectFixture} from "../subject-fixture";
import {nbUiSubject} from "./shared";

const DROPDOWN_ITEMS = [
    {label: "重命名", value: "rename", iconClass: "i-lucide-pencil", shortcut: "F2"},
    {label: "复制路径", value: "copy-path", iconClass: "i-lucide-copy"},
    {label: "", value: "sep-1", separator: true},
    {label: "排序方式", value: "sort", iconClass: "i-lucide-arrow-down-wide-narrow", children: [
        {label: "按名称", value: "sort-name", type: "radio" as const, checked: true, group: "sort"},
        {label: "按修改时间", value: "sort-mtime", type: "radio" as const, checked: false, group: "sort"},
    ]},
    {label: "显示隐藏文件", value: "hidden", type: "checkbox" as const, checked: false},
    {label: "", value: "sep-2", separator: true},
    {label: "删除", value: "delete", iconClass: "i-lucide-trash-2", tone: "danger" as const},
];

const MENUBAR_MENUS = [
    {id: "file", label: "文件", items: [
        {label: "新建章节", value: "new-chapter", shortcut: "Ctrl+N", iconClass: "i-lucide-file-plus"},
        {label: "打开项目…", value: "open-project", shortcut: "Ctrl+O"},
        {label: "", value: "sep", separator: true},
        {label: "导出", value: "export", children: [
            {label: "Markdown", value: "export-md"},
            {label: "EPUB", value: "export-epub", disabled: true},
        ]},
    ]},
    {id: "edit", label: "编辑", items: [
        {label: "撤销", value: "undo", shortcut: "Ctrl+Z"},
        {label: "重做", value: "redo", shortcut: "Ctrl+Shift+Z"},
    ]},
    {id: "view", label: "视图", items: [
        {label: "显示侧栏", value: "sidebar", type: "checkbox" as const, checked: true},
        {label: "显示面板", value: "panel", type: "checkbox" as const, checked: false},
    ]},
    {id: "help", label: "帮助", disabled: true, items: []},
];

const STEPS = [
    {step: 1, title: "选择目录", description: "作品放在哪里", iconClass: "i-lucide-folder"},
    {step: 2, title: "书名与简介", description: "以后可以修改", iconClass: "i-lucide-book"},
    {step: 3, title: "模板", description: "初始的卷与章节", iconClass: "i-lucide-layout-template"},
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
    defineSubjectFixture<typeof Dropdown>({
        component: "Dropdown",
        events: ["select"],
        slotPresets: {default: () => h(NbButton, {variant: "secondary", size: "sm", iconClass: "i-lucide-ellipsis"}, () => "更多操作")},
        scenes: [
            {id: "default", label: "图标、快捷键、子菜单与危险项", input: {props: {items: DROPDOWN_ITEMS, align: "start", side: "bottom"}, model: {open: false}, slots: {default: true}}},
            {id: "compact", label: "紧凑", input: {props: {items: DROPDOWN_ITEMS, compact: true, align: "start", side: "bottom"}, model: {open: false}, slots: {default: true}}},
            {id: "long", label: "很多项时内部滚动", input: {props: {items: Array.from({length: 40}, (_, index) => ({label: `第 ${String(index + 1)} 章`, value: `chapter-${String(index + 1)}`})), menuMaxHeight: "320px", align: "start", side: "bottom"}, model: {open: false}, slots: {default: true}}},
            {id: "disabled", label: "禁用", input: {props: {items: DROPDOWN_ITEMS, disabled: true, align: "start", side: "bottom"}, model: {open: false}, slots: {default: true}}},
        ],
        subject: nbUiSubject("Dropdown"),
    }),
    defineSubjectFixture<typeof Menubar>({
        component: "Menubar",
        events: ["select"],
        class: "w-full",
        scenes: [
            {id: "default", label: "文件、编辑、视图、帮助", input: {props: {menus: MENUBAR_MENUS, size: "sm"}, model: {modelValue: ""}}},
            {id: "medium", label: "中号", input: {props: {menus: MENUBAR_MENUS, size: "md"}, model: {modelValue: ""}}},
        ],
        subject: nbUiSubject("Menubar"),
    }),
    defineSubjectFixture<typeof Editable>({
        component: "Editable",
        events: ["submit", "cancel"],
        scenes: [
            {id: "default", label: "点按编辑", input: {props: {placeholder: "未命名章节", size: "md", showEditTrigger: true}, model: {modelValue: "第十七章 雪线"}}},
            {id: "empty", label: "空值占位", input: {props: {placeholder: "未命名章节", size: "md"}, model: {modelValue: ""}}},
            {id: "auto-resize", label: "随内容变宽", input: {props: {placeholder: "书名", size: "lg", autoResize: true}, model: {modelValue: "长夜行"}}},
            {id: "readonly", label: "只读", input: {props: {readonly: true, size: "md"}, model: {modelValue: "只读的标题"}}},
            {id: "disabled", label: "禁用", input: {props: {disabled: true, size: "sm"}, model: {modelValue: "不可编辑"}}},
        ],
        subject: nbUiSubject("Editable"),
    }),
    defineSubjectFixture<typeof Pagination>({
        component: "Pagination",
        scenes: [
            {id: "middle", label: "中间页", input: {props: {pageCount: 24, siblingCount: 1, ariaLabel: "章节分页"}, model: {page: 8}}},
            {id: "first", label: "第一页", input: {props: {pageCount: 24, ariaLabel: "章节分页"}, model: {page: 1}}},
            {id: "few", label: "只有三页", input: {props: {pageCount: 3, ariaLabel: "章节分页"}, model: {page: 2}}},
        ],
        subject: nbUiSubject("Pagination"),
    }),
    defineSubjectFixture<typeof SegmentedControl>({
        component: "SegmentedControl",
        scenes: [
            {id: "default", label: "三档", input: {props: {options: SEGMENTS, ariaLabel: "画布尺寸", size: "sm"}, model: {modelValue: "free"}}},
            {id: "counts", label: "带计数与强调色", input: {props: {options: [{value: "all", label: "全部", count: 128}, {value: "dirty", label: "未保存", count: 3, tone: "warning" as const}, {value: "conflict", label: "冲突", count: 0, disabled: true}], ariaLabel: "筛选", tone: "accent", size: "sm"}, model: {modelValue: "all"}}},
            {id: "full-width", label: "撑满等分", input: {props: {options: SEGMENTS, ariaLabel: "画布尺寸", size: "sm", fullWidth: true}, model: {modelValue: "phone"}}},
            {id: "xs", label: "最小号", input: {props: {options: SEGMENTS, ariaLabel: "画布尺寸", size: "xs"}, model: {modelValue: "tablet"}}},
        ],
        subject: nbUiSubject("SegmentedControl"),
    }),
    defineSubjectFixture<typeof Stepper>({
        component: "Stepper",
        class: "w-full",
        scenes: [
            {id: "horizontal", label: "横向", input: {props: {steps: STEPS, orientation: "horizontal", linear: true}, model: {modelValue: 2}}},
            {id: "vertical", label: "纵向", input: {props: {steps: STEPS, orientation: "vertical", linear: false}, model: {modelValue: 1}}},
            {id: "disabled", label: "禁用", input: {props: {steps: STEPS, orientation: "horizontal", disabled: true}, model: {modelValue: 3}}},
        ],
        subject: nbUiSubject("Stepper"),
    }),
    defineSubjectFixture<typeof Switch>({
        component: "Switch",
        scenes: [
            {id: "on", label: "开", input: {props: {ariaLabel: "自动保存", size: "md"}, model: {modelValue: true}}},
            {id: "off", label: "关", input: {props: {ariaLabel: "自动保存", size: "md"}, model: {modelValue: false}}},
            {id: "small", label: "小号", input: {props: {ariaLabel: "自动保存", size: "sm"}, model: {modelValue: true}}},
            {id: "disabled", label: "禁用", input: {props: {ariaLabel: "自动保存", size: "md", disabled: true}, model: {modelValue: true}}},
        ],
        subject: nbUiSubject("Switch"),
    }),
    defineSubjectFixture<typeof SwitchField>({
        component: "SwitchField",
        class: "w-full",
        scenes: [
            {id: "default", label: "标签与说明", input: {props: {label: "自动保存", description: "停止输入两秒后写入磁盘"}, model: {modelValue: true}}},
            {id: "long", label: "长说明换行", input: {props: {label: "离开时提醒未保存的修改", description: "关闭窗口、切换项目或刷新页面时，如果还有没写入磁盘的修改，先询问是否保存。这条说明故意写得很长，看换行时开关是否仍与标签对齐。"}, model: {modelValue: false}}},
            {id: "disabled", label: "禁用", input: {props: {label: "同步到云端", description: "这一版还没有", disabled: true}, model: {modelValue: false}}},
        ],
        subject: nbUiSubject("SwitchField"),
    }),
    defineSubjectFixture<typeof Tabs>({
        component: "Tabs",
        class: "w-full",
        scenes: [
            {id: "default", label: "带计数与不可用项", input: {props: {items: TABS, ariaLabel: "检视", size: "md"}, model: {modelValue: "doc"}}},
            {id: "small", label: "小号", input: {props: {items: TABS, ariaLabel: "检视", size: "sm"}, model: {modelValue: "events"}}},
            {id: "overflow", label: "放不下时横向滚动", input: {props: {items: Array.from({length: 16}, (_, index) => ({value: `ch-${String(index)}`, label: `第 ${String(index + 1)} 章`, iconClass: "i-lucide-file-text"})), ariaLabel: "章节", size: "sm"}, model: {modelValue: "ch-0"}}},
        ],
        subject: nbUiSubject("Tabs"),
    }),
    defineSubjectFixture<typeof ToggleGroup>({
        component: "ToggleGroup",
        scenes: [
            {id: "single", label: "单选", input: {props: {type: "single", options: [{value: "left", iconClass: "i-lucide-align-left", title: "左对齐"}, {value: "center", iconClass: "i-lucide-align-center", title: "居中"}, {value: "right", iconClass: "i-lucide-align-right", title: "右对齐"}], size: "md"}, model: {modelValue: "left"}}},
            {id: "multiple", label: "多选", input: {props: {type: "multiple", options: [{value: "bold", iconClass: "i-lucide-bold", title: "粗体"}, {value: "italic", iconClass: "i-lucide-italic", title: "斜体"}, {value: "strike", iconClass: "i-lucide-strikethrough", title: "删除线"}], size: "md"}, model: {modelValue: ["bold"]}}},
            {id: "labels", label: "文字选项", input: {props: {type: "single", options: [{value: "shelf", label: "书架"}, {value: "list", label: "列表"}], size: "sm"}, model: {modelValue: "shelf"}}},
            {id: "vertical", label: "纵向", input: {props: {type: "single", orientation: "vertical", options: [{value: "a", label: "第一卷"}, {value: "b", label: "第二卷"}, {value: "c", label: "第三卷", disabled: true}], size: "md"}, model: {modelValue: "a"}}},
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
        ],
        subject: nbUiSubject("Toolbar"),
    }),
];
