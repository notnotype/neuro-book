/** nb-ui 反馈与浮层类（`feedback/`）的场景。`NotificationViewport` 读写全局通知队列，按标签不可挂载。 */

import {h} from "vue";

import {Button as NbButton} from "@notnotype/nb-ui/components";
import type {AlertDialog, ContextMenu, Dialog, DialogWindow, Drawer, HoverCard, Notification, Popover, QuickInput, Tooltip} from "@notnotype/nb-ui/components";

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
        slots: ["default", "header-extra"],
        scenes: [
            {id: "default", label: "确认与取消", input: {props: {title: "从书架移除", size: "default", showFooter: true, showCancel: true, confirmLabel: "移除", cancelLabel: "取消", closable: true, closeOnEsc: true, closeOnOverlay: true}, model: {modelValue: true}, slots: {default: true, "header-extra": true}}},
            {id: "busy", label: "提交中", input: {props: {title: "正在移除", size: "default", showFooter: true, busy: true, confirmLabel: "移除"}, model: {modelValue: true}, slots: {default: true}}},
            {id: "large", label: "大号、不带页脚", input: {props: {title: "导入素材", size: "lg", showFooter: false, overlayType: "blur"}, model: {modelValue: true}, slots: {default: true}}},
            {id: "closed", label: "关闭（用控制区打开）", input: {props: {title: "从书架移除", size: "sm", showFooter: true}, model: {modelValue: false}, slots: {default: true}}},
        ],
        load: async () => (await import("./DialogFixture.vue")).default,
    }),
    defineLabFixture<typeof DialogWindow>({
        component: "DialogWindow",
        slots: ["default", "footer"],
        scenes: [
            {id: "default", label: "可拖动", input: {props: {title: "新建作品", size: "md", closable: true, closeOnEsc: true}, model: {modelValue: true}, slots: {default: true, footer: true}}},
            {id: "resizable", label: "可缩放", input: {props: {title: "素材预览", size: "lg", resizable: true, minWidth: 360, minHeight: 240}, model: {modelValue: true, width: 640, height: 420}, slots: {default: true}}},
            {id: "busy", label: "忙碌", input: {props: {title: "正在创建", size: "sm", busy: true}, model: {modelValue: true}, slots: {default: true, footer: true}}},
        ],
        load: async () => (await import("./DialogWindowFixture.vue")).default,
    }),
    defineSubjectFixture<typeof AlertDialog>({
        component: "AlertDialog",
        events: ["confirm", "cancel", "closed"],
        slotPresets: {trigger: trigger("删除章节…")},
        scenes: [
            {id: "danger", label: "危险操作", input: {props: {title: "删除「第十七章 雪线」？", description: "文件会移到系统回收站，编辑器里未保存的修改一并丢弃。", confirmText: "删除", cancelText: "取消", tone: "danger"}, model: {open: false}, slots: {trigger: true}}},
            {id: "warning", label: "警告", input: {props: {title: "外部修改", description: "磁盘上的文件已被其它程序改动，覆盖会丢掉那些改动。", confirmText: "覆盖", cancelText: "重新载入", tone: "warning"}, model: {open: true}, slots: {trigger: true}}},
        ],
        subject: nbUiSubject("AlertDialog"),
    }),
    defineLabFixture<typeof ContextMenu>({
        component: "ContextMenu",
        scenes: [
            {id: "default", label: "图标、快捷键、子菜单与危险项", input: {props: {visible: false, x: 0, y: 0, items: CONTEXT_ITEMS}}},
            {id: "open", label: "一打开就显示", input: {props: {visible: true, x: 240, y: 180, items: CONTEXT_ITEMS}}},
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
    defineSubjectFixture<typeof HoverCard>({
        component: "HoverCard",
        slotPresets: {trigger: trigger("沈屿"), default: paragraph("沈屿：港口巡夜人，第三章登场。性格沉默，怕水。")},
        scenes: [
            {id: "default", label: "悬停打开", input: {props: {side: "bottom", align: "start", openDelay: 300, closeDelay: 150, arrow: true}, model: {open: false}, slots: {trigger: true, default: true}}},
            {id: "open", label: "已打开（右侧）", input: {props: {side: "right", align: "center", arrow: false}, model: {open: true}, slots: {trigger: true, default: true}}},
        ],
        subject: nbUiSubject("HoverCard"),
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
            {id: "top", label: "上方", input: {props: {text: "保存（Ctrl+S）", placement: "top", delay: 300}, slots: {default: true}}},
            {id: "right", label: "右侧、长文字", input: {props: {text: "这一条提示故意写得比较长，用来看提示框的最大宽度与换行。", placement: "right", delay: 0}, slots: {default: true}}},
            {id: "disabled", label: "禁用", input: {props: {text: "不会出现", placement: "top", disabled: true}, slots: {default: true}}},
        ],
        subject: nbUiSubject("Tooltip"),
    }),
    defineSubjectFixture<typeof Notification>({
        component: "Notification",
        events: ["action", "dismiss"],
        class: "w-full max-w-[420px]",
        scenes: [
            {id: "info", label: "信息", input: {props: {tone: "info", title: "已切换到项目「长夜行」", message: "上次的标签与展开的目录已恢复。", dismissible: true, closeLabel: "关闭"}}},
            {id: "success", label: "成功", input: {props: {tone: "success", title: "已保存", message: "第十七章 雪线", dismissible: true}}},
            {id: "warning", label: "警告与操作", input: {props: {tone: "warning", title: "布局没保存上", message: "存储暂时不可用，修改只在这个窗口里。", actionLabel: "重试", dismissible: true}}},
            {id: "error", label: "错误", input: {props: {tone: "error", title: "保存失败", message: "磁盘已满（ENOSPC）。", actionLabel: "重试", dismissible: false}}},
        ],
        subject: nbUiSubject("Notification"),
    }),
    defineLabFixture<typeof QuickInput>({
        component: "QuickInput",
        scenes: [
            {id: "default", label: "命令列表", input: {props: {items: QUICK_ITEMS, title: "命令", placeholder: "输入命令名称", emptyText: "没有匹配的命令"}, model: {open: true, query: "", activeId: "open-project"}}},
            {id: "empty", label: "没有匹配", input: {props: {items: [], title: "命令", placeholder: "输入命令名称", emptyText: "没有匹配的命令"}, model: {open: true, query: "导出 PDF", activeId: null}}},
            {id: "loading", label: "加载中", input: {props: {items: [], title: "打开项目", placeholder: "输入项目名称或路径", emptyText: "没有项目", loading: true, message: "正在列出已登记的项目…"}, model: {open: true, query: "", activeId: null}}},
            {id: "long-list", label: "长列表", input: {props: {items: CHAPTER_ITEMS, title: "跳到章节", placeholder: "输入章节名", emptyText: "没有匹配的章节"}, model: {open: true, query: "", activeId: "chapter-1"}}},
        ],
        load: async () => (await import("./QuickInputFixture.vue")).default,
    }),
];
