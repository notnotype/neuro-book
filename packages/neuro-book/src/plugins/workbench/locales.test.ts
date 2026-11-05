/**
 * `nbook.workbench` 的消息目录（docs/specs/ui/i18n.md 的“目录与键”）。
 *
 * 第一条防止迁移改错文字：`LEGACY` 是迁移前（提交 4e5b99459）代码里的双语字面量，按迁移后的键原样抄下，占位符还是旧的
 * `{name}` 写法；`viewCommands.newContainer.*` 三条是旧代码把“新建容器（在{区域}）”“New Container in {区域}”的模板按区域名
 * 代入后的结果，迁移后拆成每个区域一条，这里写的是代入后的整句；`titlebar.menuItems.*` 是提交 a4a94a451 时标题栏菜单项
 * 写在声明里的双语字面量。`RUNTIME` 是提交 a4a94a451 时只有中文、或由代码拼接的运行期文字：中文是旧代码显示的整句（拼接的
 * 写成代入前的模板），英文是迁入目录时新写的。`REVISED` 是有意改过的文字（旧文字仍在上两张表里），按带复数后缀的完整键给出。
 * 目录里的每个键都要在前两张表里、表里的每个键都要在目录里，值换成 `{{name}}` 后逐字相同。以后有意改文字时，同一次改动里
 * 在 `REVISED` 里登记。
 */

import {describe, expect, it} from "bun:test";

import {flattenCatalog} from "@notnotype/nb-ui/text";

import {testTextPort} from "nbook/shared/testing/text-port";

import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";
import {descriptor} from "./plugin";
import {workbenchText} from "./shared/text";
import {workbenchCatalogs} from "./web/text";
import {WORKBENCH_TITLEBAR_MENU_ITEMS} from "./web/titlebar/menu-items";

const LEGACY: Readonly<Record<string, {readonly "zh-CN": string; readonly "en-US": string}>> = {
    "settings.theme.title": {"zh-CN": "主题", "en-US": "Theme"},
    "settings.theme.description": {"zh-CN": "界面的形状、字体与配色", "en-US": "Shape, typography and colors of the interface"},
    "settings.theme.choices.nbook.title": {"zh-CN": "NeuroBook", "en-US": "NeuroBook"},
    "settings.theme.choices.macos.title": {"zh-CN": "macOS", "en-US": "macOS"},
    "settings.appearance.title": {"zh-CN": "明暗", "en-US": "Appearance"},
    "settings.appearance.choices.light.title": {"zh-CN": "浅色", "en-US": "Light"},
    "settings.appearance.choices.dark.title": {"zh-CN": "深色", "en-US": "Dark"},
    "settings.appearance.choices.system.title": {"zh-CN": "跟随系统", "en-US": "System"},
    "titlebar.groups.file": {"zh-CN": "文件", "en-US": "File"},
    "titlebar.groups.edit": {"zh-CN": "编辑", "en-US": "Edit"},
    "titlebar.groups.view": {"zh-CN": "视图", "en-US": "View"},
    "titlebar.groups.help": {"zh-CN": "帮助", "en-US": "Help"},
    "categories.view": {"zh-CN": "视图", "en-US": "View"},
    "categories.help": {"zh-CN": "帮助", "en-US": "Help"},
    "categories.settings": {"zh-CN": "设置", "en-US": "Settings"},
    "commands.nbook.quick-open.open-commands.title": {"zh-CN": "命令面板", "en-US": "Command Palette"},
    "commands.nbook.app.reload.title": {"zh-CN": "重新载入", "en-US": "Reload"},
    "commands.nbook.help.documentation.title": {"zh-CN": "文档", "en-US": "Documentation"},
    "commands.nbook.view.set-panel-position.title": {"zh-CN": "面板位置", "en-US": "Panel Position"},
    "commands.nbook.view.set-panel-alignment.title": {"zh-CN": "面板对齐", "en-US": "Panel Alignment"},
    "commands.nbook.view.set-panel-hidden.title": {"zh-CN": "隐藏/显示面板", "en-US": "Hide or Show Panel"},
    "commands.nbook.view.set-panel-collapsed.title": {"zh-CN": "收起为标题头", "en-US": "Collapse to Title Bar"},
    "commands.nbook.view.toggle-panel-maximized.title": {"zh-CN": "最大化/还原面板", "en-US": "Maximize or Restore Panel"},
    "commands.nbook.view.set-part-hidden.title": {"zh-CN": "切换区域显隐", "en-US": "Toggle Area Visibility"},
    "commands.nbook.settings.switch-theme.title": {"zh-CN": "切换主题", "en-US": "Change Theme"},
    "commands.nbook.settings.switch-appearance.title": {"zh-CN": "切换明暗", "en-US": "Change Appearance"},
    "commands.nbook.view.open.title": {"zh-CN": "打开视图", "en-US": "Open View"},
    "commands.nbook.view.move-view.title": {"zh-CN": "移动视图", "en-US": "Move View"},
    "appCommands.blocked": {"zh-CN": "浏览器拦截了新标签页；请允许本站打开弹出窗口后再试", "en-US": "The browser blocked the new tab; allow pop-ups for this site and try again"},
    "palette.title": {"zh-CN": "命令面板", "en-US": "Command Palette"},
    "palette.placeholder": {"zh-CN": "输入命令，或输入 : 跳到某一行", "en-US": "Type a command, or : to go to a line"},
    "palette.empty": {"zh-CN": "没有匹配的命令", "en-US": "No matching commands"},
    "palette.pickEmpty": {"zh-CN": "没有匹配的项", "en-US": "No matching items"},
    "palette.linePrompt": {"zh-CN": "输入行号（1–{max}）", "en-US": "Type a line number (1–{max})"},
    "palette.goToLine": {"zh-CN": "跳转到第 {line} 行", "en-US": "Go to line {line}"},
    "palette.lineInvalid": {"zh-CN": "行号无效：{text}", "en-US": "Invalid line number: {text}"},
    "palette.lineOutOfRange": {"zh-CN": "行号超出范围：{line}（共 {total} 行）", "en-US": "Line {line} is out of range ({total} lines)"},
    "palette.noEditor": {"zh-CN": "没有活动编辑器", "en-US": "No active editor"},
    "palette.editorGone": {"zh-CN": "原编辑器已关闭或切换", "en-US": "The original editor was closed or switched"},
    "palette.lineUnsupported": {"zh-CN": "当前编辑器不支持行号跳转", "en-US": "The active editor does not support line navigation"},
    "palette.editorNotReady": {"zh-CN": "编辑器尚未就绪", "en-US": "The editor is not ready yet"},
    "palette.commandFailed": {"zh-CN": "{title}没有完成", "en-US": "{title} did not complete"},
    "panelCommands.positions.bottom": {"zh-CN": "底部", "en-US": "Bottom"},
    "panelCommands.positions.top": {"zh-CN": "顶部", "en-US": "Top"},
    "panelCommands.positions.left": {"zh-CN": "左侧", "en-US": "Left"},
    "panelCommands.positions.right": {"zh-CN": "右侧", "en-US": "Right"},
    "panelCommands.alignments.center": {"zh-CN": "居中（只在编辑器下）", "en-US": "Center (under the editor)"},
    "panelCommands.alignments.left": {"zh-CN": "靠左（含侧栏）", "en-US": "Left (with the sidebar)"},
    "panelCommands.alignments.right": {"zh-CN": "靠右（含右栏）", "en-US": "Right (with the auxiliary bar)"},
    "panelCommands.alignments.justify": {"zh-CN": "两端（含左右侧栏）", "en-US": "Justify (both sidebars)"},
    "panelCommands.current": {"zh-CN": "当前", "en-US": "current"},
    "panelCommands.placeholder": {"zh-CN": "选中后立即生效", "en-US": "Takes effect immediately"},
    "partCommands.parts.sidebar": {"zh-CN": "侧栏", "en-US": "Sidebar"},
    "partCommands.parts.auxiliarybar": {"zh-CN": "右栏", "en-US": "Auxiliary Bar"},
    "partCommands.parts.activitybar": {"zh-CN": "活动栏", "en-US": "Activity Bar"},
    "partCommands.visible": {"zh-CN": "显示中", "en-US": "shown"},
    "partCommands.hidden": {"zh-CN": "已隐藏", "en-US": "hidden"},
    "partCommands.placeholder": {"zh-CN": "选中后立即切换", "en-US": "Toggles immediately"},
    "themeCommands.appearances.light": {"zh-CN": "浅色", "en-US": "Light"},
    "themeCommands.appearances.dark": {"zh-CN": "深色", "en-US": "Dark"},
    "themeCommands.appearances.system": {"zh-CN": "跟随系统", "en-US": "Follow System"},
    "viewCommands.parts.sidebar": {"zh-CN": "侧栏", "en-US": "Sidebar"},
    "viewCommands.parts.auxiliarybar": {"zh-CN": "右栏", "en-US": "Secondary Side Bar"},
    "viewCommands.parts.panel": {"zh-CN": "面板", "en-US": "Panel"},
    "viewCommands.pickView": {"zh-CN": "选择要移动的视图", "en-US": "Pick a view to move"},
    "viewCommands.pickOpen": {"zh-CN": "选择要打开的视图", "en-US": "Pick a view to open"},
    "viewCommands.noOpenable": {"zh-CN": "没有可以打开的视图", "en-US": "No view to open"},
    "viewCommands.pickTarget": {"zh-CN": "移动到", "en-US": "Move to"},
    "viewCommands.noViews": {"zh-CN": "没有可以移动的视图", "en-US": "No view can be moved"},
    "views.resetLocation": {"zh-CN": "重置位置", "en-US": "Reset Location"},
    "common.more": {"zh-CN": "更多", "en-US": "More"},
    "common.retry": {"zh-CN": "重试", "en-US": "Retry"},
    "shell.welcome.noProject": {"zh-CN": "工作台已就绪。没有打开项目。", "en-US": "The workbench is ready. No project is open."},
    "shell.welcome.withProject": {"zh-CN": "工作台已就绪。当前项目：{name}", "en-US": "The workbench is ready. Current project: {name}"},
    "shell.panel": {"zh-CN": "面板", "en-US": "Panel"},
    "shell.empty.part": {"zh-CN": "将视图拖动到此处显示", "en-US": "Drag a view here to show it"},
    "shell.empty.container": {"zh-CN": "容器里的视图都已隐藏", "en-US": "All views in this container are hidden"},
    "shell.activityBar": {"zh-CN": "活动栏", "en-US": "Activity Bar"},
    "shell.moveTo": {"zh-CN": "移动到", "en-US": "Move To"},
    "shell.drag.label": {"zh-CN": "拖动 {title}", "en-US": "Drag {title}"},
    "shell.drag.hint": {"zh-CN": "按空格拿起并拖动", "en-US": "Press Space to pick up and drag"},
    "shell.drop.moveView": {"zh-CN": "移到这里", "en-US": "Move here"},
    "shell.drop.detachView": {"zh-CN": "新建容器", "en-US": "New container"},
    "shell.drop.moveContainer": {"zh-CN": "移动容器", "en-US": "Move container"},
    "shell.drop.mergeContainer": {"zh-CN": "并入 {count} 个视图", "en-US": "Merge {count} views"},
    "shell.drop.reveal": {"zh-CN": "放到{part}", "en-US": "Show in {part}"},
    "shell.moreActions": {"zh-CN": "更多操作", "en-US": "More Actions"},
    "shell.drop.before": {"zh-CN": "放在“{title}”前", "en-US": "Place before “{title}”"},
    "shell.drop.after": {"zh-CN": "放在“{title}”后", "en-US": "Place after “{title}”"},
    "views.collapse": {"zh-CN": "收起视图", "en-US": "Collapse View"},
    "views.expand": {"zh-CN": "展开视图", "en-US": "Expand View"},
    "viewFrame.declared": {"zh-CN": "正在等待视图所属的插件启动", "en-US": "Waiting for the view's plugin to start"},
    "viewFrame.blocked": {"zh-CN": "视图所属的插件无法启动：{reason}", "en-US": "The view's plugin cannot start: {reason}"},
    "viewFrame.failed": {"zh-CN": "视图所属的插件启动失败：{reason}", "en-US": "The view's plugin failed to start: {reason}"},
    "viewFrame.stopped": {"zh-CN": "视图所属的插件已停止（{reason}）", "en-US": "The view's plugin stopped ({reason})"},
    "viewFrame.loading": {"zh-CN": "正在加载视图", "en-US": "Loading the view"},
    "viewFrame.loadFailed": {"zh-CN": "视图加载失败：{reason}", "en-US": "The view failed to load: {reason}"},
    "viewFrame.renderFailed": {"zh-CN": "视图出错：{reason}", "en-US": "The view crashed: {reason}"},
    "viewFrame.reload": {"zh-CN": "重新加载", "en-US": "Reload"},
    "viewActions.instanceLoading": {"zh-CN": "视图还没加载好", "en-US": "The view has not loaded yet"},
    "statusBar.label": {"zh-CN": "状态栏", "en-US": "Status bar"},
    "statusBar.noProject": {"zh-CN": "未打开项目", "en-US": "No project open"},
    "statusBar.showPanel": {"zh-CN": "显示面板", "en-US": "Show Panel"},
    "statusBar.hidePanel": {"zh-CN": "隐藏面板", "en-US": "Hide Panel"},
    "statusBar.unsaved": {"zh-CN": "布局未保存：{reason}", "en-US": "Layout not saved: {reason}"},
    "statusBar.unread": {"zh-CN": "布局未读取，正在用默认布局（{reason}）", "en-US": "Layout not loaded; using the default ({reason})"},
    "statusBar.discard": {"zh-CN": "放弃", "en-US": "Discard"},
    "statusBar.reasons.unavailable": {"zh-CN": "存储暂时不可用", "en-US": "storage is unavailable"},
    "statusBar.reasons.conflict": {"zh-CN": "与别的窗口的修改冲突", "en-US": "conflicts with another window"},
    "statusBar.reasons.unknown-outcome": {"zh-CN": "不确定是否已保存", "en-US": "unknown whether it was saved"},
    "statusBar.reasons.io-error": {"zh-CN": "读写出错", "en-US": "read or write error"},
    "statusBar.reasons.corrupt": {"zh-CN": "记录已损坏", "en-US": "the record is corrupt"},
    "statusBar.reasons.unsupported-version": {"zh-CN": "记录的版本不支持", "en-US": "unsupported record version"},
    "statusBar.reasons.provider-stopped": {"zh-CN": "存储服务已停止", "en-US": "storage has stopped"},
    "titlebar.label": {"zh-CN": "标题栏", "en-US": "Title bar"},
    "titlebar.menuButton": {"zh-CN": "菜单", "en-US": "Menu"},
    "titlebar.search": {"zh-CN": "搜索命令", "en-US": "Search commands"},
    "titlebar.openProject": {"zh-CN": "打开项目…", "en-US": "Open Project…"},
    "titlebar.toggle.sidebar": {"zh-CN": "切换侧栏", "en-US": "Toggle Sidebar"},
    "titlebar.toggle.panel": {"zh-CN": "切换面板", "en-US": "Toggle Panel"},
    "titlebar.toggle.auxiliarybar": {"zh-CN": "切换右栏", "en-US": "Toggle Auxiliary Bar"},
    "titlebar.nativeEditing": {"zh-CN": "焦点在输入框里时由它自己撤销", "en-US": "The focused input handles undo itself"},
    "titlebar.menuItems.sidebar": {"zh-CN": "侧栏", "en-US": "Sidebar"},
    "titlebar.menuItems.auxiliarybar": {"zh-CN": "右栏", "en-US": "Auxiliary Bar"},
    "titlebar.menuItems.activitybar": {"zh-CN": "活动栏", "en-US": "Activity Bar"},
    "titlebar.menuItems.panel": {"zh-CN": "面板", "en-US": "Panel"},
    "editorArea.loading": {"zh-CN": "正在加载编辑器…", "en-US": "Loading the editor…"},
    "editorArea.failed": {"zh-CN": "编辑器加载失败：{reason}", "en-US": "The editor failed to load: {reason}"},
    "items.broken": {"zh-CN": "这个条目出错了：{message}", "en-US": "This item failed: {message}"},
    "activityItems.profile.title": {"zh-CN": "个人资料尚未开放", "en-US": "Profile is not available yet"},
    "state.layoutReady.reason": {"zh-CN": "布局还在读取", "en-US": "The layout is still loading"},
    "state.nonCompact.reason": {"zh-CN": "窗口太窄，正在用紧凑布局", "en-US": "The window is too narrow (compact layout)"},
    "state.panelHorizontal.reason": {"zh-CN": "面板不在底部或顶部", "en-US": "The panel is not at the bottom or top"},
    "state.panelMaximizable.reason": {"zh-CN": "面板要显示着，并在左右两侧或底部、顶部居中", "en-US": "The panel must be shown, on a side, or centered at the bottom or top"},
    "state.panelVisible.reason": {"zh-CN": "面板已隐藏或拖到零", "en-US": "The panel is hidden or dragged closed"},
    "state.sidebarVisible.reason": {"zh-CN": "侧栏已隐藏或拖到零", "en-US": "The sidebar is hidden or dragged closed"},
    "state.auxiliaryBarVisible.reason": {"zh-CN": "右栏已隐藏或拖到零", "en-US": "The auxiliary bar is hidden or dragged closed"},
    "state.activityBarVisible.reason": {"zh-CN": "活动栏已隐藏", "en-US": "The activity bar is hidden"},
    "state.panelMaximized.reason": {"zh-CN": "面板没有最大化", "en-US": "The panel is not maximized"},
    "viewCommands.newContainer.sidebar": {"zh-CN": "新建容器（在侧栏）", "en-US": "New Container in Sidebar"},
    "viewCommands.newContainer.auxiliarybar": {"zh-CN": "新建容器（在右栏）", "en-US": "New Container in Secondary Side Bar"},
    "viewCommands.newContainer.panel": {"zh-CN": "新建容器（在面板）", "en-US": "New Container in Panel"},
};

const RUNTIME: Readonly<Record<string, {readonly "zh-CN": string; readonly "en-US": string}>> = {
    "layout.notOpen": {"zh-CN": "工作台布局没有打开（这个窗口没有显示外壳）", "en-US": "The workbench layout is not open (this window does not show the shell)"},
    "palette.unavailable": {"zh-CN": "当前页面没有命令面板", "en-US": "This page has no command palette"},
    "viewCommands.unknownView": {"zh-CN": "没有这个视图（没有已接受的声明）：{viewId}", "en-US": "No such view (no accepted declaration): {viewId}"},
    "viewCommands.unplaced": {"zh-CN": "视图不在布局里：{viewId}", "en-US": "The view is not in the layout: {viewId}"},
    "viewCommands.partial": {"zh-CN": "要么都不给，要么给 viewId、sourceContainerId 和 targetContainerId、newContainerIn 中的一个", "en-US": "Give nothing, or give viewId, sourceContainerId and one of targetContainerId and newContainerIn"},
    "viewCommands.stale": {"zh-CN": "视图已经不在发起时的容器里，没有移动", "en-US": "The view is no longer in the container it was in when the move started, so it was not moved"},
    // 下面三条旧代码在两种语言下都用全角标点拼接（“项目”+“：”+名字、“搜索命令”+“（”+快捷键+“）”、条目名+“：”+文字）。
    "titlebar.projectButton": {"zh-CN": "项目：{name}", "en-US": "Project: {name}"},
    "titlebar.searchWithShortcut": {"zh-CN": "搜索命令（{shortcut}）", "en-US": "Search commands ({shortcut})"},
    "items.titled": {"zh-CN": "{title}：{text}", "en-US": "{title}: {text}"},
};

/** 有意改过的英文：右栏统一叫 Secondary Side Bar，“Move To” 改成与 viewCommands.pickTarget 相同的 “Move to”，数量键的单数形用单数。 */
const REVISED: Readonly<Record<string, {readonly "zh-CN"?: string; readonly "en-US"?: string}>> = {
    "titlebar.toggle.auxiliarybar": {"en-US": "Toggle Secondary Side Bar"},
    "titlebar.menuItems.auxiliarybar": {"en-US": "Secondary Side Bar"},
    "panelCommands.alignments.right": {"en-US": "Right (with the secondary side bar)"},
    "partCommands.parts.auxiliarybar": {"en-US": "Secondary Side Bar"},
    "state.auxiliaryBarVisible.reason": {"en-US": "The secondary side bar is hidden or dragged closed"},
    "shell.moveTo": {"en-US": "Move to"},
    "shell.drop.mergeContainer_one": {"en-US": "Merge {count} view"},
};

const EXPECTED = {...LEGACY, ...RUNTIME};

const CATALOGS = {"zh-CN": zhCN, "en-US": enUS} as const;

/** 数量键（带 `count` 参数、按复数选形）。 */
const PLURAL_KEYS = ["shell.drop.mergeContainer"];

/** 复数形 `<键>_<类别>` 归到 `<键>`。 */
const baseKey = (key: string): string => key.replace(/_(?:zero|one|two|few|many|other)$/u, "");

describe("nbook.workbench 的目录", () => {
    it("每个键的文字与迁移前的字面量逐字相同（占位符从 {name} 换成 {{name}}），有意改过的按 REVISED，两边的键一一对应", () => {
        for (const [locale, catalog] of Object.entries(CATALOGS)) {
            const flat = flattenCatalog(catalog);
            expect({locale, keys: [...new Set(Object.keys(flat).map(baseKey))].sort()}).toEqual({locale, keys: Object.keys(EXPECTED).sort()});
            for (const [key, value] of Object.entries(flat)) {
                const written = REVISED[key]?.[locale as keyof typeof CATALOGS] ?? EXPECTED[baseKey(key)]![locale as keyof typeof CATALOGS];
                expect({locale, key, value}).toEqual({locale, key, value: written.replace(/\{(\w+)\}/gu, "{{$1}}")});
            }
        }
    });

    it("REVISED 登记的键都在目录里", () => {
        for (const [key, revised] of Object.entries(REVISED)) {
            for (const locale of Object.keys(revised)) expect({locale, key, present: Object.hasOwn(flattenCatalog(CATALOGS[locale as keyof typeof CATALOGS]), key)}).toEqual({locale, key, present: true});
        }
    });

    it("数量键：中文有 _other，英文有 _one 与 _other", () => {
        const flatZh = Object.keys(flattenCatalog(zhCN));
        const flatEn = Object.keys(flattenCatalog(enUS));
        for (const key of PLURAL_KEYS) {
            expect(flatZh.filter((candidate) => baseKey(candidate) === key)).toEqual([`${key}_other`]);
            expect(flatEn.filter((candidate) => baseKey(candidate) === key)).toEqual([`${key}_one`, `${key}_other`]);
        }
    });

    it("数量键经引擎取文字：英文一个用单数、多个用复数，中文同一句", () => {
        const zh = testTextPort("zh-CN", {"nbook.workbench": workbenchCatalogs});
        const en = testTextPort("en-US", {"nbook.workbench": workbenchCatalogs});
        expect(en.t(workbenchText("shell.drop.mergeContainer", {count: 1}))).toBe("Merge 1 view");
        expect(en.t(workbenchText("shell.drop.mergeContainer", {count: 3}))).toBe("Merge 3 views");
        expect(zh.t(workbenchText("shell.drop.mergeContainer", {count: 1}))).toBe("并入 1 个视图");
    });

    it("工作台自己的标题栏菜单项名字走目录：中文与原文相同，英文统一叫 Secondary Side Bar", () => {
        const zh = testTextPort("zh-CN", {"nbook.workbench": workbenchCatalogs});
        const en = testTextPort("en-US", {"nbook.workbench": workbenchCatalogs});
        const labels = WORKBENCH_TITLEBAR_MENU_ITEMS.flatMap(({id, declaration}) => (declaration.label === undefined ? [] : [[id, zh.t(declaration.label), en.t(declaration.label)]]));
        expect(labels).toEqual([
            ["nbook.workbench.menu.sidebar", "侧栏", "Sidebar"],
            ["nbook.workbench.menu.auxiliarybar", "右栏", "Secondary Side Bar"],
            ["nbook.workbench.menu.activitybar", "活动栏", "Activity Bar"],
            ["nbook.workbench.menu.panel", "面板", "Panel"],
        ]);
    });

    it("文字引用的命名空间就是插件 id", () => {
        expect(workbenchText("shell.panel").ns).toBe(descriptor.id);
    });
});
