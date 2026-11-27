import {createSubjectFixture, defineLabFixture, defineSubjectFixture, type LabFixture} from "nbook/plugins/lab/web/scene-kit";
import type WorkbenchCommandPalette from "nbook/plugins/workbench/web/components/WorkbenchCommandPalette.vue";
import type WorkbenchSurface from "nbook/plugins/workbench/web/components/WorkbenchSurface.vue";
import type WorkbenchPanelHead from "nbook/plugins/workbench/web/components/WorkbenchPanelHead.vue";
import type WorkbenchToolStrip from "nbook/plugins/workbench/web/components/WorkbenchToolStrip.vue";
import type WorkbenchFloatRailHandle from "nbook/plugins/workbench/web/components/WorkbenchFloatRailHandle.vue";
import type WorkbenchRegionStrip from "nbook/plugins/workbench/web/components/WorkbenchRegionStrip.vue";
import type ThemeEditor from "nbook/plugins/workbench/web/components/theme-editor/ThemeEditor.vue";
import {withWorkbenchText} from "./workbench-text";
import type ThemeSettingsPage from "nbook/plugins/workbench/web/components/theme-editor/ThemeSettingsPage.vue";
import type WorkbenchNotificationsView from "nbook/plugins/workbench/web/components/WorkbenchNotificationsView.vue";
import type WorkbenchStatusBar from "nbook/plugins/workbench/web/components/WorkbenchStatusBar.vue";
import type WorkbenchTitleBar from "nbook/plugins/workbench/web/components/WorkbenchTitleBar.vue";
import type WorkbenchItemStrip from "nbook/plugins/workbench/web/components/WorkbenchItemStrip.vue";
import type WorkbenchDragFeedback from "nbook/plugins/workbench/web/components/WorkbenchDragFeedback.vue";
import type WorkbenchViewFrame from "nbook/plugins/workbench/web/components/WorkbenchViewFrame.vue";


export const fixtures: LabFixture[] = [
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
    defineLabFixture<typeof WorkbenchSurface>({
        component: "WorkbenchSurface",
        // 文档与呈现树由夹具自己算（它扮演工作台），不是 JSON 输入；输入只是占位（类型要求登记必填的 doc、projection），夹具不读它。断言见 e2e/lab-workbench-surface.e2e.ts。
        scenes: (() => {
            const leaf = {kind: "leaf" as const, id: "g0", ref: "panel:g0"};
            const base = {
                contextKey: "lab:surface",
                doc: {version: 1 as const, tree: {version: 2 as const, root: {...leaf, size: {width: 0, height: 0}}}, panels: {g0: {role: "editor" as const, tabs: [], active: null}}, floats: [], hiddenBars: [], currentEditor: "g0"},
                projection: {input: leaf, strips: [], rails: []},
            };
            return [
                {id: "default", label: "侧栏、两个编辑组、右栏、面板（平铺）", input: {props: base}},
                {id: "cards", label: "卡片：缝、圆角、相连按邻接算；右栏与右轨相连，隐藏、显示时角接过去", input: {props: base}},
                {id: "view-head", label: "标题区：右栏的视图接管面板头（左、中、右三列）", input: {props: base}},
            ];
        })(),
        load: async () => (await import("./WorkbenchSurfaceFixture.vue")).default,
    }),
    defineSubjectFixture<typeof WorkbenchPanelHead>({
        component: "WorkbenchPanelHead",
        events: ["activate", "action", "context-menu", "toggle-fold", "own-head-inset"],
        writeBack: {activate: {layer: "props", key: "active"}},
        class: "w-full",
        scenes: (() => {
            const tab = (id: string, label: string, icon: string) => ({id: `view:${id}`, label, icon});
            const tabs = [tab("files", "资源管理器", "i-lucide-files"), tab("search", "搜索", "i-lucide-search"), tab("outline", "大纲", "i-lucide-list-tree"), tab("chat", "对话", "i-lucide-message-square"), tab("output", "输出", "i-lucide-terminal")];
            const named = [
                {id: "float", label: "浮动", icon: "i-lucide-picture-in-picture-2", disabled: false},
                {id: "maximize", label: "最大化", icon: "i-lucide-maximize-2", disabled: false, pressed: false},
                {id: "hide", label: "隐藏", icon: "i-lucide-x", disabled: false},
            ];
            const base = {panelId: "sidebar", label: "侧栏", moreLabel: "更多", active: "view:files"};
            // 分节只写标题（输出 20）：能收成标题行时标题前有展开标记，整行是开关；框架按钮悬停才出，Lab 里指针移上去看。
            const section = {...base, panelId: "section:files", tabs: tabs.slice(0, 1), titleOnly: true, frameActions: named.slice(0, 2)};
            return [
                {id: "default", label: "几个标签、框架按钮", input: {props: {...base, tabs: tabs.slice(0, 3), frameActions: named}}},
                {id: "many", label: "标签多：放不下时逐级让位（拖窄画布看）", input: {props: {...base, tabs, frameActions: named}}},
                {id: "anonymous", label: "无名面板：没有隐藏按钮", input: {props: {...base, panelId: "p-1", label: "面板", tabs: tabs.slice(0, 2), frameActions: named.slice(0, 2)}}},
                {id: "disabled", label: "框架按钮不可用", input: {props: {...base, tabs: tabs.slice(0, 2), frameActions: [{...named[0]!, disabled: true, reason: "这个视图不能浮动"}, named[1]!, named[2]!]}}},
                {id: "empty", label: "没有标签：显示名称", input: {props: {...base, tabs: [], active: null, frameActions: named}}},
                {id: "section", label: "分节：只写标题，不能收起（底部面板的、区域唯一的）", input: {props: section}},
                {id: "fold-open", label: "分节：展开着，标题前的标记朝下", input: {props: {...section, fold: {collapsed: false}}}},
                {id: "fold-collapsed", label: "分节：收成标题行，标记朝右、标题退成次要字色", input: {props: {...section, fold: {collapsed: true}}}},
                {id: "fold-long", label: "分节：英文长标题被截断，标记不被挤掉", input: {props: {...section, tabs: [tab("files", "Workspace Explorer With A Rather Long Title", "i-lucide-files")], fold: {collapsed: false}}}},
                {id: "fold-maximized", label: "分节：最大化着，没有标记，还原按钮按下、一直显示", input: {props: {...section, frameActions: [named[0]!, {...named[1]!, label: "还原", pressed: true}]}}},
                {id: "fold-view-head", label: "分节：视图接管标题区，展开标记是左列最前面单独的按钮", input: {props: {...section, viewHead: {key: "c:1", popup: {expanded: false}}, fold: {collapsed: false}, foldLabel: "收起 资源管理器"}}},
                // 视图自绘头（workbench/views.md 输出 19 的“自绘头”）：盖在内容顶上的一条，只有右端按钮；标题按钮按 Tab 聚焦才在左上角出现。
                {id: "own-head", label: "浮动窗视图自绘头：右端只有按钮，标题聚焦才出现", input: {props: {...section, panelId: "p-float", ownHead: {band: 40}, actionsShown: true, frameActions: [{id: "dock", label: "回到停靠", icon: "i-lucide-panel-right-close", disabled: false}]}}},
            ];
        })(),
        subject: () => import("nbook/plugins/workbench/web/components/WorkbenchPanelHead.vue"),
    }),
    defineSubjectFixture<typeof WorkbenchToolStrip>({
        component: "WorkbenchToolStrip",
        events: ["select", "run-item"],
        class: "h-full",
        scenes: (() => {
            // 只含一个视图的容器：入口就是这个视图的，能拖。
            const entry = (viewId: string, label: string, icon: string, current: boolean) => ({id: `view:${viewId}`, label, icon, tooltip: label, viewId, current, pressed: current});
            const entries = [
                // 声明的容器，含两个视图：悬停文字写出它们，不起拖。
                {id: "nbook.workbench.project", label: "项目", icon: "i-lucide-folder-kanban", tooltip: "项目：会话、资源管理器", viewId: null, current: true, pressed: true},
                entry("search", "搜索", "i-lucide-search", false),
                entry("outline", "大纲", "i-lucide-list-tree", false),
                // 成员视图的声明不在：名称是视图 id，没有图标可取，画占位图标。
                {id: "view:example.gone", label: "example.gone", icon: null, tooltip: "example.gone", viewId: "example.gone", current: false, pressed: false},
            ];
            const items = [
                {id: "profile", title: "个人资料尚未开放", icon: "i-lucide-user", interactive: false, pressed: null, disabledReason: null},
                {id: "settings", title: "设置", icon: "i-lucide-settings", interactive: true, pressed: true, disabledReason: null},
                {id: "sync", title: "同步", icon: "i-lucide-refresh-cw", interactive: true, pressed: null, disabledReason: "没有打开项目"},
            ];
            const base = {label: "活动栏", moreLabel: "更多"};
            return [
                {id: "default", label: "一个容器一个入口：当前容器按下，声明不在的画占位图标，底段全局项", input: {props: {...base, entries, items}}},
                {id: "many", label: "容器多：放不下时后面的收进“更多”，当前容器的总在外面", input: {props: {...base, entries: [...Array.from({length: 24}, (_, index) => entry(`v${String(index)}`, `视图 ${String(index)}`, "i-lucide-square", false)), entry("last", "排在最后的当前容器", "i-lucide-star", true)], items}}},
                {id: "empty", label: "侧栏里没有容器", input: {props: {...base, entries: [], items}}},
                {id: "right", label: "右轨：右栏的容器，没有全局项，提示朝左开", input: {props: {...base, label: "右栏", region: "auxiliarybar" as const, joined: true, entries: entries.slice(0, 2)}}},
                {id: "right-english", label: "Right rail, English tooltips", input: {props: {label: "Secondary side bar", moreLabel: "More", region: "auxiliarybar" as const, entries: [{id: "view:messages", label: "Messages", icon: "i-lucide-message-square", tooltip: "Messages: conversations with bots and agents", viewId: "messages", current: true, pressed: true}, {id: "view:outline", label: "Outline", icon: "i-lucide-list-tree", tooltip: "Outline", viewId: "outline", current: false, pressed: false}]}}},
            ];
        })(),
        subject: () => import("nbook/plugins/workbench/web/components/WorkbenchToolStrip.vue"),
    }),
    defineLabFixture<typeof WorkbenchFloatRailHandle>({
        component: "WorkbenchFloatRailHandle",
        scenes: [
            {id: "default", label: "浮动窗里展开的视图段（260），手柄在它内侧；往左拖变宽、键盘左右每次 10", input: {props: {width: 260, bounds: {minimum: 200, maximum: 420, width: 260}, revision: "lab", label: "调整视图段的宽度"}}},
            {id: "narrowest", label: "拖到最窄 200", input: {props: {width: 200, bounds: {minimum: 200, maximum: 420, width: 260}, revision: "lab", label: "调整视图段的宽度"}}},
        ],
        load: async () => (await import("./WorkbenchFloatRailHandleFixture.vue")).default,
    }),
    defineSubjectFixture<typeof WorkbenchRegionStrip>({
        component: "WorkbenchRegionStrip",
        events: ["select", "context-menu"],
        class: "h-[32px] w-full",
        scenes: (() => {
            const entry = (id: string, label: string, icon: string, current = false) => ({id: `view:${id}`, label, icon, tooltip: label, viewId: id, current, pressed: current});
            const bottom = [entry("tasks", "后台任务", "i-lucide-list-checks", true), entry("notifications", "通知", "i-lucide-bell"), entry("output", "输出", "i-lucide-terminal")];
            const base = {moreLabel: "更多", dragHint: "按空格拿起，方向键移动，回车放下"};
            return [
                {id: "titles", label: "底部面板：标题入口，当前容器带下划线", input: {props: {...base, region: "panel", label: "底部面板的视图容器", entries: bottom}}},
                {id: "narrow", label: "放不下：给并进来的头留 160px，后面的入口收进“更多”，当前容器的总在外面（拖窄画布看）", input: {props: {...base, region: "panel", label: "底部面板的视图容器", entries: [...bottom, entry("problems", "问题", "i-lucide-circle-alert"), entry("terminal", "终端", "i-lucide-square-terminal")], headMinWidth: 160}}},
                {id: "hidden", label: "区域隐藏着：没有按下的入口", input: {props: {...base, region: "panel", label: "底部面板的视图容器", entries: bottom.map((item) => ({...item, pressed: false}))}}},
                {id: "dragging", label: "拖动中：被拖的入口留着位置、看不见，拖着的视图放下会并进的入口高亮", input: {props: {...base, region: "panel", label: "底部面板的视图容器", entries: bottom, placeholder: "view:output", highlighted: "view:notifications"}}},
            ];
        })(),
        subject: () => import("nbook/plugins/workbench/web/components/WorkbenchRegionStrip.vue"),
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
    defineLabFixture<typeof WorkbenchNotificationsView>({
        component: "WorkbenchNotificationsView",
        scenes: (() => {
            // 集成场景：真实的通知服务与中心由包装组件建；输入只是占位，场景不读它。
            const placeholder = {props: {context: {id: "nbook.workbench.notifications", generation: 1, visible: {value: false}, location: {value: "panel" as const}}}};
            return [
                {id: "mixed", label: "五条：两条没看过、带动作与详情（右栏隐藏时的宽度）", input: placeholder},
                {id: "mixed-narrow", label: "默认布局的宽度", input: placeholder},
                {id: "empty", label: "没有通知", input: placeholder},
            ];
        })(),
        load: async () => withWorkbenchText((await import("./NotificationsViewFixture.vue")).default),
    }),
    defineLabFixture<typeof WorkbenchStatusBar>({
        component: "WorkbenchStatusBar",
        scenes: [
            {id: "no-project", label: "未打开项目", input: {props: {project: null, panelHidden: false, panelToggleDisabled: false, problems: []}}},
            {id: "project", label: "项目名", input: {props: {project: "长篇小说《雾港》第二部", panelHidden: false, panelToggleDisabled: false, problems: []}}},
            {id: "unsaved", label: "布局未保存", input: {props: {project: "雾港", panelHidden: false, panelToggleDisabled: false, problems: [{record: "customizations", kind: "unsaved", code: "unavailable"}]}}},
            {id: "unread", label: "布局未读取", input: {props: {project: "雾港", panelHidden: false, panelToggleDisabled: false, problems: [{record: "side", kind: "unread", code: "corrupt"}]}}},
            {id: "hidden", label: "面板已隐藏、按钮不可用", input: {props: {project: null, panelHidden: true, panelToggleDisabled: true, problems: []}}},
            {id: "bell-unread", label: "铃铛：有 2 条没看过的通知", input: {props: {project: "雾港", panelHidden: true, panelToggleDisabled: false, problems: [], unreadNotifications: 2}}},
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
                {id: "file", label: "文件", sections: [[entry("nbook.project.open", "打开项目"), entry("nbook.project.back-to-shelf", "回到书架")], [entry("nbook.editor.save", "保存", {reason: "活动文档没有需要保存的修改"}), entry("nbook.editor.save-all", "全部保存")]]},
                {id: "edit", label: "编辑", sections: [[entry("nbook.edit.undo", "撤销", {reason: "没有活动的编辑器"}), entry("nbook.edit.redo", "重做", {reason: "没有活动的编辑器"})]]},
                {id: "view", label: "视图", sections: [[entry("nbook.quick-open.open-commands", "命令面板", {shortcut: "Ctrl+Shift+P"})], [entry("nbook.view.set-part-hidden", "侧栏", {args: {part: "sidebar"}, checked: true}), entry("nbook.view.set-part-hidden", "右栏", {args: {part: "auxiliarybar"}, checked: false})], [entry("nbook.app.reload", "重新载入")]]},
                {id: "help", label: "帮助", sections: [[entry("nbook.help.documentation", "文档")]]},
            ];
            const layout = {sidebar: {pressed: true, disabled: false}, panel: {pressed: true, disabled: false}, auxiliarybar: {pressed: false, disabled: false}};
            const base = {menus, searchShortcut: "Ctrl+Shift+P", layout, items: []};
            return [
                {id: "project", label: "打开了项目", input: {props: {...base, project: "长篇小说《雾港》第二部", shelf: "回到书架"}}},
                {id: "no-project", label: "没有项目", input: {props: {...base, project: null, shelf: "回到书架"}}},
                {id: "no-shelf", label: "没有书架插件：作品下拉没有“回到书架”，标志不可点", input: {props: {...base, project: "雾港"}}},
                {id: "items", label: "带条目", input: {props: {...base, project: "雾港", items: [{id: "test.items.sync", text: "已同步", title: "同步状态", alignment: "right" as const, order: 0, priority: 0, command: null, tooltip: null, state: "normal" as const, disabledReason: null, icon: null, hover: null}]}}},
                {id: "long", label: "长英文项目名、英文界面与条目（窄宽度验收 35）", input: {props: {...base, project: "The Lighthouse Keeper's Chronicle, Volume Two", items: [{id: "test.items.sync", text: "Synced", title: "Sync status", alignment: "right" as const, order: 0, priority: 0, command: null, tooltip: null, state: "normal" as const, disabledReason: null, icon: null, hover: null}]}}},
            ];
        })(),
        // 场景 `long` 一直是英文界面，id 被 e2e 引用，所以点名。
        load: async () => withWorkbenchText(createSubjectFixture<typeof WorkbenchTitleBar>((await import("nbook/plugins/workbench/web/components/WorkbenchTitleBar.vue")).default, {events: ["run", "search", "toggle-part", "open-project", "run-item", "back-to-shelf"], class: "w-full"}), ["long"]),
    }),
    defineLabFixture<typeof WorkbenchItemStrip>({
        component: "WorkbenchItemStrip",
        scenes: (() => {
            type Extra = {title?: string; order?: number; priority?: number; command?: boolean; state?: "normal" | "warning" | "error"; disabledReason?: string; tooltip?: string; icon?: {name: string; spin: boolean; muted: boolean}};
            const entry = (id: string, text: string, extra: Extra = {}) => ({
                id, text, title: extra.title ?? text, alignment: "right" as const, order: extra.order ?? 0, priority: extra.priority ?? 0,
                command: extra.command === true ? {id: "nbook.editor.save-all", args: {}} : null,
                tooltip: extra.tooltip ?? null, state: extra.state ?? "normal", disabledReason: extra.disabledReason ?? null,
                // 悬停内容带加载函数，不是场景能写的数据；它由 WorkbenchItemStrip.dom.test.ts 测。
                icon: extra.icon ?? null, hover: null,
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
                {id: "icons", label: "图标：转圈加文字、只有图标（淡色与出错）", input: {props: {itemHeight: 20, align: "end", entries: [
                    entry("test.items.running", "3 个任务", {title: "后台任务", order: 1, priority: 5, command: true, icon: {name: "i-lucide-loader-circle", spin: true, muted: false}}),
                    entry("test.items.idle", "", {title: "后台任务", order: 2, priority: 5, command: true, icon: {name: "i-lucide-list-checks", spin: false, muted: true}}),
                    entry("test.items.failed-icon", "", {title: "后台任务：1 个没有成功", order: 3, priority: 5, command: true, state: "error", icon: {name: "i-lucide-circle-x", spin: false, muted: false}}),
                ]}}},
                {id: "many", label: "放不下时收进“更多”", input: {props: {itemHeight: 20, align: "end", entries: Array.from({length: 14}, (_, index) => entry(`test.items.n${String(index)}`, `条目 ${String(index + 1)} · 一些文字`, {order: index, priority: index % 4, command: index % 3 === 0}))}}},
            ];
        })(),
        load: async () => withWorkbenchText(createSubjectFixture<typeof WorkbenchItemStrip>((await import("nbook/plugins/workbench/web/components/WorkbenchItemStrip.vue")).default, {events: ["run"], class: "w-full"})),
    }),
    defineSubjectFixture<typeof WorkbenchDragFeedback>({
        component: "WorkbenchDragFeedback",
        events: [],
        scenes: [
            {id: "line", label: "标签条的插入线与拖影", input: {props: {ghost: {label: "资源管理器", icon: "i-lucide-files"}, ghostAt: {x: 220, y: 140}, preview: {areaRect: null, entryRect: null, indicator: {left: 180, top: 96, right: 182, bottom: 128}, orientation: "horizontal"}, label: "放在这里", kind: "strip"}}},
            {id: "area", label: "拆到一边的矩形", input: {props: {ghost: {label: "终端", icon: "i-lucide-terminal"}, ghostAt: {x: 320, y: 260}, preview: {areaRect: {left: 120, top: 200, right: 520, bottom: 320}, entryRect: null, indicator: null, orientation: "vertical"}, label: "拆到这一边", kind: "edge"}}},
            {id: "idle", label: "没有拖动", input: {props: {ghost: null, preview: null, label: "", kind: ""}}},
        ],
        subject: () => import("nbook/plugins/workbench/web/components/WorkbenchDragFeedback.vue"),
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
];
