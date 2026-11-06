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
    "themes.nbook.title": {"zh-CN": "NeuroBook", "en-US": "NeuroBook"},
    "themes.macos.title": {"zh-CN": "macOS", "en-US": "macOS"},
    "themes.eyeGreen.title": {"zh-CN": "护眼绿", "en-US": "Eye Care Green"},
    "commands.nbook.settings.open-theme-editor.title": {"zh-CN": "打开主题编辑器", "en-US": "Open Theme Editor"},
    "commands.nbook.settings.open-theme-editor-floating.title": {"zh-CN": "在浮动窗口中打开主题编辑器", "en-US": "Open Theme Editor in a Floating Window"},
    "editorPages.theme-editor.title": {"zh-CN": "主题编辑器", "en-US": "Theme Editor"},
    "themeEditor.title": {"zh-CN": "主题编辑器", "en-US": "Theme editor"},
    "themeEditor.close": {"zh-CN": "关闭", "en-US": "Close"},
    "themeEditor.empty.title": {"zh-CN": "还没有我的主题", "en-US": "No themes of your own yet"},
    "themeEditor.empty.hint": {"zh-CN": "新建一套，或从现有主题复制起步。", "en-US": "Create one, or start from a copy of an existing theme."},
    "themeEditor.library.label": {"zh-CN": "我的主题", "en-US": "My themes"},
    "themeEditor.library.new": {"zh-CN": "新建", "en-US": "New"},
    "themeEditor.library.duplicate": {"zh-CN": "复制", "en-US": "Duplicate"},
    "themeEditor.library.delete": {"zh-CN": "删除", "en-US": "Delete"},
    "themeEditor.library.copyFrom": {"zh-CN": "复制自…", "en-US": "Copy from…"},
    "themeEditor.library.loading": {"zh-CN": "正在读取我的主题", "en-US": "Reading your themes"},
    "themeEditor.library.failed": {"zh-CN": "我的主题读不出来：{reason}", "en-US": "Your themes could not be read: {reason}"},
    "themeEditor.library.deleteConfirm": {"zh-CN": "确认删除", "en-US": "Confirm delete"},
    "themeEditor.library.export": {"zh-CN": "导出…", "en-US": "Export…"},
    "themeEditor.library.import": {"zh-CN": "导入…", "en-US": "Import…"},
    "themeEditor.appearance.label": {"zh-CN": "正在编辑的明暗", "en-US": "Appearance being edited"},
    "themeEditor.appearance.light": {"zh-CN": "亮色", "en-US": "Light"},
    "themeEditor.appearance.dark": {"zh-CN": "暗色", "en-US": "Dark"},
    "themeEditor.sections.label": {"zh-CN": "分区", "en-US": "Sections"},
    "themeEditor.sections.basic": {"zh-CN": "基本信息", "en-US": "Basics"},
    "themeEditor.sections.colors": {"zh-CN": "配色", "en-US": "Colors"},
    "themeEditor.sections.fonts": {"zh-CN": "字体", "en-US": "Fonts"},
    "themeEditor.sections.chrome": {"zh-CN": "活动栏与画框", "en-US": "Activity bar and frame"},
    "themeEditor.sections.scene": {"zh-CN": "场景与取景", "en-US": "Scene and framing"},
    "themeEditor.sections.contrast": {"zh-CN": "对比度检查", "en-US": "Contrast check"},
    "themeEditor.basic.titleZh": {"zh-CN": "标题（中文）", "en-US": "Title (Chinese)"},
    "themeEditor.basic.titleEn": {"zh-CN": "标题（英文）", "en-US": "Title (English)"},
    "themeEditor.basic.base": {"zh-CN": "主题包", "en-US": "Theme pack"},
    "themeEditor.basic.baseNbook": {"zh-CN": "NeuroBook", "en-US": "NeuroBook"},
    "themeEditor.basic.baseMacos": {"zh-CN": "macOS", "en-US": "macOS"},
    "themeEditor.basic.baseHint": {"zh-CN": "决定形状、密度与动效；颜色在“配色”里改。", "en-US": "Sets shape, density and motion; colors are edited under Colors."},
    "themeEditor.colors.seeds": {"zh-CN": "主色", "en-US": "Key colors"},
    "themeEditor.colors.seedBackground": {"zh-CN": "背景", "en-US": "Background"},
    "themeEditor.colors.seedText": {"zh-CN": "文字", "en-US": "Text"},
    "themeEditor.colors.seedAccent": {"zh-CN": "强调", "en-US": "Accent"},
    "themeEditor.colors.derive": {"zh-CN": "推导整套", "en-US": "Derive the set"},
    "themeEditor.colors.deriveHint": {"zh-CN": "只填没手改过的项，主色不变。", "en-US": "Fills only the entries you have not edited by hand; key colors stay."},
    "themeEditor.colors.fromOther": {"zh-CN": "从{other}派生", "en-US": "Derive from {other}"},
    "themeEditor.colors.deriveFailed": {"zh-CN": "主色里有读不懂的颜色，没有推导", "en-US": "A key color could not be read; nothing was derived"},
    "themeEditor.colors.groupBackground": {"zh-CN": "背景", "en-US": "Background"},
    "themeEditor.colors.groupText": {"zh-CN": "文字", "en-US": "Text"},
    "themeEditor.colors.groupBorder": {"zh-CN": "边框", "en-US": "Border"},
    "themeEditor.colors.groupAccent": {"zh-CN": "强调", "en-US": "Accent"},
    "themeEditor.colors.groupStatus": {"zh-CN": "状态", "en-US": "Status"},
    "themeEditor.colors.groupOther": {"zh-CN": "其它", "en-US": "Other"},
    "themeEditor.colors.touched": {"zh-CN": "手改过", "en-US": "Edited by hand"},
    "themeEditor.colors.reset": {"zh-CN": "还原为推导值", "en-US": "Restore the derived value"},
    "themeEditor.colors.pick": {"zh-CN": "取色", "en-US": "Pick color"},
    "themeEditor.colors.value": {"zh-CN": "颜色值", "en-US": "Color value"},
    "themeEditor.colors.advanced": {"zh-CN": "高级：角色变量", "en-US": "Advanced: role variables"},
    "themeEditor.colors.advancedHint": {"zh-CN": "控件、按钮、面板等的面与分隔线；写颜色或渐变，不能引图片。", "en-US": "Surfaces and dividers for controls, buttons and panels; write a color or gradient, no images."},
    "themeEditor.colors.clear": {"zh-CN": "清除", "en-US": "Clear"},
    "settingsPages.themes.title": {"zh-CN": "主题", "en-US": "Themes"},
    "settingsPages.themes.description": {"zh-CN": "做自己的主题，或查看正在用的主题", "en-US": "Make a theme of your own, or see the one in use"},
    "themeEditor.entry.heroTitle": {"zh-CN": "主题编辑器", "en-US": "Theme editor"},
    "themeEditor.entry.openTab": {"zh-CN": "在页签中打开", "en-US": "Open in a tab"},
    "themeEditor.entry.openFloating": {"zh-CN": "在浮动窗口中打开", "en-US": "Open in a floating window"},
    "themeEditor.entry.intro": {"zh-CN": "做自己的主题：配色、字体、活动栏、场景图都能改，改动立刻出现在真实的工作台上。", "en-US": "Make a theme of your own: colors, fonts, the activity bar and scene images are all editable, and the real workbench changes as you edit."},
    "themeEditor.entry.current": {"zh-CN": "正在使用", "en-US": "In use"},
    "themeEditor.entry.switchHint": {"zh-CN": "要换用别的主题，在“外观”里选。", "en-US": "To use another theme, pick it under Appearance."},
    "themeEditor.entry.mine": {"zh-CN": "我的主题", "en-US": "My themes"},
    "themeEditor.entry.mineEmpty": {"zh-CN": "还没有自己的主题。打开编辑器新建一套，或从任一主题复制起步。", "en-US": "You have no themes of your own yet. Open the editor to make one, or start from any theme."},
    "themeEditor.entry.inUse": {"zh-CN": "使用中", "en-US": "In use"},
    "themeEditor.contrast.unknown": {"zh-CN": "没有算出对比度：写法编辑器不解析", "en-US": "No contrast computed: the editor does not parse this form"},
    "themeEditor.contrast.against": {"zh-CN": "落在 {surface} 上最差", "en-US": "Worst on {surface}"},
    "themeEditor.contrast.failingCount": {"zh-CN": "{count} 项不合格", "en-US": "{count} below the bar"},
    "themeEditor.contrast.allPass": {"zh-CN": "全部合格", "en-US": "All pass"},
    "themeEditor.contrast.sampleText": {"zh-CN": "Aa 示例文字", "en-US": "Aa Sample text"},
    "themeEditor.contrast.sampleLabel": {"zh-CN": "这个文字色落在底色上的样子", "en-US": "How this text color looks on its background"},
    "themeEditor.contrast.locate": {"zh-CN": "去修改", "en-US": "Fix it"},
    "themeEditor.contrast.grade.low": {"zh-CN": "不合格", "en-US": "Fail"},
    "themeEditor.contrast.grade.aa": {"zh-CN": "AA", "en-US": "AA"},
    "themeEditor.contrast.grade.aaa": {"zh-CN": "AAA", "en-US": "AAA"},
    "themeEditor.contrast.none": {"zh-CN": "没有不合格的项", "en-US": "No entry is below the bar"},
    "themeEditor.contrast.legend": {"zh-CN": "文字、次要文字、弱化文字、链接与状态色，对各自的底色不低于 4.5。导出时有不合格项只提示。", "en-US": "Text, secondary text, muted text, links and status colors against their own backgrounds, at least 4.5. Exporting with entries below the bar only warns."},
    "themeEditor.contrast.summary1": {"zh-CN": "对比度 {ratio}，落在 {surface} 上最差", "en-US": "Contrast {ratio}, worst on {surface}"},
    "themeEditor.contrast.summaryLow": {"zh-CN": "对比度 {ratio}，低于 4.5，落在 {surface} 上最差", "en-US": "Contrast {ratio}, below 4.5, worst on {surface}"},
    "themeEditor.fonts.display": {"zh-CN": "欢迎页标题", "en-US": "Welcome page title"},
    "themeEditor.fonts.prose": {"zh-CN": "正文", "en-US": "Body text"},
    "themeEditor.fonts.placeholder": {"zh-CN": "字体栈，例如 \"Noto Serif CJK SC\", serif", "en-US": "Font stack, for example \"Noto Serif CJK SC\", serif"},
    "themeEditor.fonts.serif": {"zh-CN": "衬线", "en-US": "Serif"},
    "themeEditor.fonts.sans": {"zh-CN": "无衬线", "en-US": "Sans-serif"},
    "themeEditor.fonts.mono": {"zh-CN": "等宽", "en-US": "Monospace"},
    "themeEditor.fonts.clear": {"zh-CN": "用现有字体", "en-US": "Use the current font"},
    "themeEditor.fonts.hint": {"zh-CN": "浏览器列不出本机字体，所以字体栈要自己写；不填就用现有字体。", "en-US": "The browser cannot list installed fonts, so write the stack yourself; leave empty to keep the current font."},
    "themeEditor.fonts.sampleDisplay": {"zh-CN": "NeuroBook · 欢迎回来", "en-US": "NeuroBook · Welcome back"},
    "themeEditor.fonts.sampleProse": {"zh-CN": "雨从傍晚开始下，一直没有停。", "en-US": "Rain began at dusk and never let up."},
    "themeEditor.chrome.activityBar": {"zh-CN": "活动栏", "en-US": "Activity bar"},
    "themeEditor.chrome.activityBarOn": {"zh-CN": "使用自己的活动栏", "en-US": "Use its own activity bar"},
    "themeEditor.chrome.surface": {"zh-CN": "面（颜色或渐变）", "en-US": "Surface (color or gradient)"},
    "themeEditor.chrome.foreground": {"zh-CN": "前景", "en-US": "Foreground"},
    "themeEditor.chrome.active": {"zh-CN": "当前项", "en-US": "Current item"},
    "themeEditor.chrome.ornament": {"zh-CN": "两端装饰", "en-US": "End ornaments"},
    "themeEditor.chrome.frame": {"zh-CN": "浮层画框", "en-US": "Overlay frame"},
    "themeEditor.chrome.frameLine": {"zh-CN": "线色", "en-US": "Line color"},
    "themeEditor.chrome.frameHint": {"zh-CN": "菜单、对话框与设置窗口的描边里面再画一道细线。", "en-US": "Draws a thin line inside the outline of menus, dialogs and the settings window."},
    "themeEditor.scene.upload": {"zh-CN": "上传场景图", "en-US": "Upload scene image"},
    "themeEditor.scene.replace": {"zh-CN": "更换场景图", "en-US": "Replace scene image"},
    "themeEditor.scene.remove": {"zh-CN": "移除", "en-US": "Remove"},
    "themeEditor.scene.none": {"zh-CN": "这一套明暗还没有场景图", "en-US": "This appearance has no scene image yet"},
    "themeEditor.scene.uploading": {"zh-CN": "正在处理图片", "en-US": "Processing the image"},
    "themeEditor.scene.failed": {"zh-CN": "上传失败：{reason}", "en-US": "Upload failed: {reason}"},
    "themeEditor.scene.large": {"zh-CN": "图片 {kb} KB，超过建议的 300 KB", "en-US": "The image is {kb} KB, over the suggested 300 KB"},
    "themeEditor.scene.stored": {"zh-CN": "{kb} KB", "en-US": "{kb} KB"},
    "themeEditor.scene.loadFailed": {"zh-CN": "图片加载失败", "en-US": "The image could not be loaded"},
    "themeEditor.scene.region.empty": {"zh-CN": "空状态", "en-US": "Empty state"},
    "themeEditor.scene.region.marginLeft": {"zh-CN": "正文左", "en-US": "Text left"},
    "themeEditor.scene.region.marginRight": {"zh-CN": "正文右", "en-US": "Text right"},
    "themeEditor.scene.region.sidebarCorner": {"zh-CN": "侧栏下角", "en-US": "Sidebar corner"},
    "themeEditor.scene.region.auxiliaryCorner": {"zh-CN": "右栏下角", "en-US": "Right bar corner"},
    "themeEditor.scene.size": {"zh-CN": "大小", "en-US": "Size"},
    "themeEditor.scene.position": {"zh-CN": "位置", "en-US": "Position"},
    "themeEditor.scene.contentX": {"zh-CN": "内容中心", "en-US": "Content center"},
    "themeEditor.scene.clear": {"zh-CN": "清除这个位置的取景", "en-US": "Clear this position's framing"},
    "themeEditor.scene.unparsable": {"zh-CN": "这个位置的写法编辑器读不懂：框不可拖，数值照常能改。", "en-US": "The editor cannot read this position's value: the frame is not draggable, the values still edit."},
    "themeEditor.scene.hint": {"zh-CN": "在图上拖框、拉右下角缩放；工作台里对应位置同时变化。框是示意，真实位置随窗口尺寸变。", "en-US": "Drag a frame on the image and pull its lower-right corner to scale; the workbench changes at the same place. Frames are approximate; real positions follow the window size."},
    "themeEditor.scene.frame": {"zh-CN": "{region}取景框", "en-US": "{region} frame"},
    "themeEditor.scene.image": {"zh-CN": "场景图", "en-US": "Scene image"},
    "themeEditor.scene.regions": {"zh-CN": "取景位置", "en-US": "Framing positions"},
    "themeEditor.transfer.exported": {"zh-CN": "已导出 {name}", "en-US": "Exported {name}"},
    "themeEditor.transfer.exportedWarn": {"zh-CN": "已导出 {name}，但有 {count} 项对比度不合格", "en-US": "Exported {name}; entries below the contrast bar: {count}"},
    "themeEditor.transfer.exportFailed": {"zh-CN": "导出失败：读不到场景图 {reason}", "en-US": "Export failed: cannot read scene image {reason}"},
    "themeEditor.transfer.imported": {"zh-CN": "已导入 {count} 套主题", "en-US": "Themes imported: {count}"},
    "themeEditor.transfer.importFailed": {"zh-CN": "导入失败：{reason}", "en-US": "Import failed: {reason}"},
    "themeEditor.transfer.unexpected": {"zh-CN": "出了点意外：{reason}", "en-US": "Something went wrong: {reason}"},
    "themeEditor.transfer.copyFailed": {"zh-CN": "复制失败：读不到或传不上场景图 {reason}", "en-US": "Copy failed: the scene image {reason} could not be read or uploaded"},
    "themeEditor.rejected.titleEmpty": {"zh-CN": "标题不能为空，没有写入", "en-US": "The title cannot be empty; nothing was saved"},
    "themeEditor.rejected.invalid": {"zh-CN": "这个取值写不进去：{reason}", "en-US": "This value cannot be saved: {reason}"},
    "themeEditor.rejected.saveFailed": {"zh-CN": "没有保存：{code}，这次改动已撤回", "en-US": "Not saved: {code}; the change was undone"},
    "themes.mine": {"zh-CN": "我的", "en-US": "Mine"},
    "themes.eyeSepia.title": {"zh-CN": "护眼米黄", "en-US": "Eye Care Sepia"},
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
    "commands.nbook.view.focus-next-pane.title": {"zh-CN": "聚焦下一个面板", "en-US": "Focus Next Pane"},
    "commands.nbook.view.focus-previous-pane.title": {"zh-CN": "聚焦上一个面板", "en-US": "Focus Previous Pane"},
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
    "themeCommands.unknownTheme": {"zh-CN": "没有这个主题：{id}。已有：{ids}", "en-US": "No such theme: {id}. Installed: {ids}"},
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
