/** nb-ui 反馈与浮层类（`feedback/`）的场景。`NotificationStack` 由夹具自建一份队列传给它，不碰模块级的缺省队列。 */

import {h} from "vue";

import {Button as NbButton} from "@notnotype/nb-ui/components";
import type {AlertDialog, Banner, ContextMenu, Dialog, Drawer, InfoTip, Notification, NotificationStack, Popover, QuickPick, SuggestionMenu, SuggestionMenuGroup, Tooltip} from "@notnotype/nb-ui/components";

import {defineLabFixture} from "../index";
import type {LabFixture} from "../index";
import {defineSubjectFixture} from "../subject-fixture";
import {nbUiSubject} from "./shared";

const trigger = (label: string) => () => h(NbButton, {variant: "secondary", size: "sm"}, () => label);
const paragraph = (text: string) => () => h("p", {class: "max-w-[280px] text-sm leading-relaxed"}, text);

const CONTEXT_ITEMS = [
    {label: "打开", iconClass: "i-lucide-file-text", shortcut: "Enter"},
    {label: "在新组打开", iconClass: "i-lucide-columns-2"},
    {separator: true},
    {label: "移动到", iconClass: "i-lucide-folder-input", children: [{label: "第一卷"}, {label: "第二卷"}, {label: "归档", disabled: true}]},
    {label: "重命名", iconClass: "i-lucide-pencil", shortcut: "F2"},
    {separator: true},
    {label: "删除", iconClass: "i-lucide-trash-2", tone: "danger" as const, shortcut: "Del"},
];

const SUGGESTION_GROUPS: SuggestionMenuGroup[] = [
    {id: "chapters", label: "正文", items: [
        {id: "c1", label: "第一章 渡口", iconClass: "i-lucide-file-text", hint: "正文/第一章.md"},
        {id: "c2", label: "第二章 旧钟", iconClass: "i-lucide-file-text", hint: "正文/第二章.md"},
        {id: "c20", label: "第二十章 回信", iconClass: "i-lucide-file-text", hint: "正文/第二十章.md"},
    ]},
    {id: "settings", label: "设定", items: [
        {id: "s1", label: "钟表铺", iconClass: "i-lucide-map-pin", hint: "设定/地点/钟表铺.md"},
        {id: "s2", label: "林雪", iconClass: "i-lucide-user", hint: "设定/人物/林雪.md"},
        {id: "s3", label: "旧档案（只读）", iconClass: "i-lucide-lock", disabled: true},
    ]},
];
const SUGGESTION_LONG: SuggestionMenuGroup[] = [{id: "chapters", items: Array.from({length: 30}, (_, index) => ({id: `ch-${String(index + 1)}`, label: `第 ${String(index + 1)} 章`, iconClass: "i-lucide-file-text", hint: `正文/第${String(index + 1)}章.md`}))}];
const SUGGESTION_BASE = {label: "引用候选", loadingText: "正在查找…", emptyText: "没有匹配的文件"};

const QUICK_ITEMS = [
    {id: "open-project", label: "打开项目", category: "项目", iconClass: "i-lucide-folder-open", shortcut: "Ctrl+O", labelMatches: [[0, 2]] as const},
    {id: "new-chapter", label: "新建章节", category: "文件", iconClass: "i-lucide-file-plus", shortcut: "Ctrl+N"},
    {id: "toggle-panel", label: "显示或隐藏面板", category: "视图", description: "底部面板", shortcut: "Ctrl+J"},
    {id: "export", label: "导出为 EPUB", category: "文件", disabled: true, description: "还没有导出插件"},
];

const CHAPTER_ITEMS = Array.from({length: 60}, (_, index) => ({
    id: `chapter-${String(index + 1)}`,
    label: `第 ${String(index + 1)} 章`,
    category: index < 30 ? "第一卷 雾港" : "第二卷 雪线",
    iconClass: "i-lucide-file-text",
}));

export const feedbackFixtures: LabFixture[] = [
    defineLabFixture<typeof Dialog>({
        component: "Dialog",
        slots: ["default", "header-extra", "footer"],
        scenes: [
            {id: "default", label: "确认与取消", input: {props: {title: "从书架移除", size: "default", showFooter: true, showCancel: true, confirmLabel: "移除", cancelLabel: "取消", closable: true, closeOnEsc: true, closeOnOverlay: true}, model: {open: true}, slots: {default: true, "header-extra": true}}},
            {id: "busy", label: "提交中", input: {props: {title: "正在移除", size: "default", showFooter: true, busy: true, confirmLabel: "移除"}, model: {open: true}, slots: {default: true}}},
            {id: "large", label: "大号、不带页脚", input: {props: {title: "导入素材", size: "lg", showFooter: false, overlayType: "blur"}, model: {open: true}, slots: {default: true}}},
            {id: "with-select", label: "里面放下拉（下拉要在对话框之上）", input: {props: {title: "新建作品", size: "md", showFooter: true, showCancel: true}, model: {open: true}, slots: {default: true}}},
            {id: "stacked", label: "叠一层（后开的在上面）", input: {props: {title: "新建作品", size: "md", showFooter: true, showCancel: true}, model: {open: true}, slots: {default: true}}},
            {id: "window", label: "浮动窗口：可拖动，点外面不关", input: {props: {title: "新建作品", modal: false, closable: true}, model: {open: true, width: 560}, slots: {default: true, footer: true}}},
            {id: "window-headerless", label: "浮动窗口：没有标题栏，关闭按钮在右上角，留白可拖", input: {props: {title: "素材", modal: false, closable: true, showHeader: false, showFooter: false}, model: {open: true, width: 480}, slots: {default: true}}},
            {id: "window-resizable", label: "浮动窗口：可缩放", input: {props: {title: "素材预览", modal: false, closable: true, showFooter: false, resizable: true, minWidth: 360, minHeight: 240}, model: {open: true, width: 640, height: 420}, slots: {default: true}}},
            {id: "closed", label: "关闭（用控制区打开）", input: {props: {title: "从书架移除", size: "sm", showFooter: true}, model: {open: false}, slots: {default: true}}},
        ],
        load: async () => (await import("./DialogFixture.vue")).default,
    }),
    defineSubjectFixture<typeof AlertDialog>({
        component: "AlertDialog",
        events: ["confirm", "cancel", "closed"],
        slotPresets: {trigger: trigger("删除章节…")},
        scenes: [
            {id: "danger", label: "危险操作", input: {props: {title: "删除「第十七章 雪线」？", description: "文件会移到系统回收站，编辑器里未保存的修改一并丢弃。", confirmLabel: "删除", cancelLabel: "取消", tone: "danger"}, model: {open: false}, slots: {trigger: true}}},
            {id: "neutral", label: "普通确认", input: {props: {title: "外部修改", description: "磁盘上的文件已被其它程序改动，覆盖会丢掉那些改动。", confirmLabel: "覆盖", cancelLabel: "重新载入", tone: "neutral"}, model: {open: true}, slots: {trigger: true}}},
        ],
        subject: nbUiSubject("AlertDialog"),
    }),
    defineLabFixture<typeof ContextMenu>({
        component: "ContextMenu",
        scenes: [
            {id: "default", label: "图标、快捷键、子菜单与危险项", input: {props: {x: 0, y: 0, items: CONTEXT_ITEMS}, model: {open: false}}},
            {id: "open", label: "一打开就显示", input: {props: {x: 240, y: 180, items: CONTEXT_ITEMS}, model: {open: true}}},
        ],
        load: async () => (await import("./ContextMenuFixture.vue")).default,
    }),
    defineSubjectFixture<typeof Drawer>({
        component: "Drawer",
        rootless: true,
        slotPresets: {trigger: trigger("打开抽屉"), default: paragraph("抽屉里的内容：章节的修订历史、批注或素材。")},
        scenes: [
            {id: "right", label: "右侧", input: {props: {direction: "right", title: "修订历史", description: "最近 20 次保存", modal: true, handle: false}, model: {open: false}, slots: {trigger: true, default: true}}},
            {id: "bottom", label: "底部（带把手）", input: {props: {direction: "bottom", title: "批注", modal: true, handle: true}, model: {open: true}, slots: {trigger: true, default: true}}},
            {id: "left", label: "左侧、非模态", input: {props: {direction: "left", title: "素材", modal: false}, model: {open: false}, slots: {trigger: true, default: true}}},
        ],
        subject: nbUiSubject("Drawer"),
    }),
    defineSubjectFixture<typeof Popover>({
        component: "Popover",
        slotPresets: {trigger: trigger("字数目标"), default: paragraph("今天的目标：3000 字。已写 1240 字。")},
        scenes: [
            {id: "default", label: "点击打开", input: {props: {side: "bottom", align: "start", arrow: true, modal: false}, model: {open: false}, slots: {trigger: true, default: true}}},
            {id: "open", label: "已打开（上方）", input: {props: {side: "top", align: "center", arrow: false}, model: {open: true}, slots: {trigger: true, default: true}}},
        ],
        subject: nbUiSubject("Popover"),
    }),
    defineSubjectFixture<typeof Tooltip>({
        component: "Tooltip",
        slotPresets: {default: trigger("悬停看提示")},
        scenes: [
            {id: "top", label: "上方", input: {props: {text: "保存（Ctrl+S）", side: "top", delay: 300}, slots: {default: true}}},
            {id: "right", label: "右侧、长文字", input: {props: {text: "这一条提示故意写得比较长，用来看提示框的最大宽度与换行。", side: "right", delay: 0}, slots: {default: true}}},
            {id: "disabled", label: "禁用", input: {props: {text: "不会出现", side: "top", disabled: true}, slots: {default: true}}},
        ],
        subject: nbUiSubject("Tooltip"),
    }),
    defineSubjectFixture<typeof InfoTip>({
        component: "InfoTip",
        scenes: [
            {id: "default", label: "字段说明", input: {props: {text: "目录不存在会在新建时一并创建。", side: "top"}}},
            {id: "long", label: "长说明、右侧", input: {props: {text: "作品色只落在封面上：作者指定了就用它，没有时按作品在八档色相里取一档，卡片本身不带色条。", label: "主题色说明", side: "right"}}},
        ],
        subject: nbUiSubject("InfoTip"),
    }),
    defineSubjectFixture<typeof Notification>({
        component: "Notification",
        events: ["action", "dismiss"],
        class: "w-full max-w-[420px]",
        scenes: [
            {id: "info", label: "信息", input: {props: {tone: "info", title: "已切换到项目「长夜行」", message: "上次的标签与展开的目录已恢复。", dismissible: true, closeLabel: "关闭"}}},
            {id: "success", label: "成功", input: {props: {tone: "success", title: "已保存", message: "第十七章 雪线", dismissible: true}}},
            {id: "warning", label: "警告与操作", input: {props: {tone: "warning", title: "布局没保存上", message: "存储暂时不可用，修改只在这个窗口里。", actionLabel: "重试", dismissible: true}}},
            {id: "error", label: "错误", input: {props: {tone: "danger", title: "保存失败", message: "磁盘已满（ENOSPC）。", actionLabel: "重试", dismissible: false}}},
            {id: "progress", label: "确定进度", input: {props: {tone: "info", title: "正在统计字数", message: "已统计 2 部，共 6 部", progress: 33, dismissible: true}}},
            {id: "indeterminate", label: "不确定进度", input: {props: {tone: "info", title: "正在连接", message: "等待服务端回应…", progress: null, dismissible: true}}},
        ],
        subject: nbUiSubject("Notification"),
    }),
    defineLabFixture<typeof NotificationStack>({
        component: "NotificationStack",
        scenes: [
            {id: "bottom-right", label: "右下", input: {props: {position: "bottom-right"}}},
            {id: "bottom-center", label: "底部居中", input: {props: {position: "bottom-center"}}},
            {id: "top-right", label: "右上", input: {props: {position: "top-right"}}},
        ],
        load: async () => (await import("./NotificationStackFixture.vue")).default,
    }),
    defineSubjectFixture<typeof Banner>({
        component: "Banner",
        events: ["dismiss"],
        class: "w-full max-w-[640px]",
        slotPresets: {actions: () => [h(NbButton, {variant: "secondary", size: "sm"}, () => "重新载入"), h(NbButton, {variant: "secondary", size: "sm"}, () => "用我的覆盖")]},
        scenes: [
            {id: "warning", label: "已断开", input: {props: {tone: "warning", title: "已与服务端断开", message: "正在重新连接，未保存的修改留在这个窗口里。"}}},
            {id: "actions", label: "带两个动作", input: {props: {tone: "danger", message: "磁盘上的文件已被修改，和你没保存的修改冲突。"}, slots: {actions: true}}},
            {id: "info", label: "可关闭", input: {props: {tone: "info", title: "NeuroBook 已更新", message: "刷新页面后使用新版本。", dismissible: true}}},
            {id: "icon", label: "自定图标", input: {props: {tone: "info", iconClass: "i-lucide-refresh-cw", message: "后端代码已改动，重启服务后生效。"}}},
            {id: "success", label: "成功", input: {props: {tone: "success", message: "已重新连接。", dismissible: true}}},
        ],
        subject: nbUiSubject("Banner"),
    }),
    defineLabFixture<typeof SuggestionMenu>({
        component: "SuggestionMenu",
        scenes: [
            {id: "caret", label: "贴光标（下方放得下）", input: {props: {...SUGGESTION_BASE, groups: SUGGESTION_GROUPS, activeId: "c2"}}},
            {id: "caret-bottom", label: "贴光标（下方不够时往上翻）", input: {props: {...SUGGESTION_BASE, groups: SUGGESTION_GROUPS, activeId: "c2"}}},
            {id: "match-width", label: "与输入框同宽", input: {props: {...SUGGESTION_BASE, groups: SUGGESTION_GROUPS, activeId: "s1"}}},
            {id: "loading", label: "加载中（已有项照常显示）", input: {props: {...SUGGESTION_BASE, groups: SUGGESTION_GROUPS.slice(0, 1), activeId: "c1", loading: true}}},
            {id: "empty", label: "没有结果", input: {props: {...SUGGESTION_BASE, groups: [], activeId: null}}},
            {id: "long", label: "长列表", input: {props: {...SUGGESTION_BASE, groups: SUGGESTION_LONG, activeId: "ch-1"}}},
        ],
        load: async () => (await import("./SuggestionMenuFixture.vue")).default,
    }),
    defineLabFixture<typeof QuickPick>({
        component: "QuickPick",
        scenes: [
            {id: "default", label: "命令列表", input: {props: {items: QUICK_ITEMS, title: "命令", placeholder: "输入命令名称", emptyText: "没有匹配的命令"}, model: {open: true, query: "", activeId: "open-project"}}},
            {id: "empty", label: "没有匹配", input: {props: {items: [], title: "命令", placeholder: "输入命令名称", emptyText: "没有匹配的命令"}, model: {open: true, query: "导出 PDF", activeId: null}}},
            {id: "loading", label: "加载中", input: {props: {items: [], title: "打开项目", placeholder: "输入项目名称或路径", emptyText: "没有项目", loading: true, message: "正在列出已登记的项目…"}, model: {open: true, query: "", activeId: null}}},
            {id: "long-list", label: "长列表", input: {props: {items: CHAPTER_ITEMS, title: "跳到章节", placeholder: "输入章节名", emptyText: "没有匹配的章节"}, model: {open: true, query: "", activeId: "chapter-1"}}},
        ],
        load: async () => (await import("./QuickPickFixture.vue")).default,
    }),
];
