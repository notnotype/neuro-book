/**
 * `nbook.editor` 的消息目录（docs/specs/ui/i18n.md 的“目录与键”）。
 *
 * 第一条防止迁移改错文字：`LEGACY` 是迁移前（提交 660293339）代码里的双语字面量，按迁移后的键原样抄下，占位符还是旧的
 * `{name}` 写法。目录里的每个键都要在表里、表里的每个键都要在目录里，值换成 `{{name}}` 后逐字相同；数字参数（字数、
 * 个数、行列）旧代码按界面语言的千分位格式化后再填，迁移后写成 `{{name, number}}`，由引擎格式化，所以这几个键的占位符
 * 换成 `{{name, number}}`。数量键的各复数形都与旧文字相同。以后有意改文字时，同一次改动里同步改这张表。`RUNTIME` 是
 * 提交 4aabb5ae7 时只有中文、或由代码拼接的运行期文字（编辑器区的提示与各动作、命令的失败原因）：中文是旧代码显示的整句
 * （拼接的写成代入前的模板，`refusal.current*`、`refusal.target*` 是“当前视图”“目标组”代入后的整句），英文是迁入目录时新写的；
 * 数量键英文的单数形另列在 `RUNTIME_ONE` 与 `ENGLISH_ONE`；单复数写法相同的数量键（`ENGLISH_SAME`）英文只写不带后缀的键。
 */

import {describe, expect, it} from "bun:test";

import {flattenCatalog} from "@notnotype/nb-ui/text";

import {testTextPort} from "nbook/shared/testing/text-port";

import {descriptor} from "./plugin";
import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";
import {editorText} from "./shared/text";
import {editorCatalogs} from "./web/text";

const LEGACY: Readonly<Record<string, {readonly "zh-CN": string; readonly "en-US": string}>> = {
    "area.label": {"zh-CN": "编辑器", "en-US": "Editor"},
    "area.tabsLabel": {"zh-CN": "打开的编辑器", "en-US": "Open editors"},
    "area.moreActions": {"zh-CN": "更多操作", "en-US": "More Actions"},
    "tab.close": {"zh-CN": "关闭 {name}", "en-US": "Close {name}"},
    "tab.unpin": {"zh-CN": "取消固定 {name}", "en-US": "Unpin {name}"},
    "root.project": {"zh-CN": "作品", "en-US": "Work"},
    "root.user": {"zh-CN": "用户资产", "en-US": "User Assets"},
    "crumbs.label": {"zh-CN": "文件路径", "en-US": "File Path"},
    "crumbs.loading": {"zh-CN": "正在读取", "en-US": "Loading"},
    "crumbs.empty": {"zh-CN": "空", "en-US": "Empty"},
    "crumbs.retry": {"zh-CN": "重试", "en-US": "Retry"},
    "drop.move": {"zh-CN": "移到这里", "en-US": "Move Here"},
    "drop.keep": {"zh-CN": "原位", "en-US": "No Change"},
    "drop.splitLeft": {"zh-CN": "拆分到左侧", "en-US": "Split Left"},
    "drop.splitRight": {"zh-CN": "拆分到右侧", "en-US": "Split Right"},
    "drop.splitTop": {"zh-CN": "拆分到上方", "en-US": "Split Up"},
    "drop.splitBottom": {"zh-CN": "拆分到下方", "en-US": "Split Down"},
    "tab.unsaved": {"zh-CN": "未保存", "en-US": "Unsaved"},
    "tab.pinned": {"zh-CN": "已固定", "en-US": "Pinned"},
    "tab.previewOf": {"zh-CN": "预览 {name}", "en-US": "Preview {name}"},
    "tips.commands": {"zh-CN": "显示所有命令", "en-US": "Show All Commands"},
    "tips.newFile": {"zh-CN": "新建文件", "en-US": "New File"},
    "tips.newFileWhere": {"zh-CN": "资源管理器标题行的“新建文件”", "en-US": "“New File” in the Explorer title bar"},
    "tips.welcome": {"zh-CN": "打开欢迎页", "en-US": "Open Welcome Page"},
    "tips.welcomeWhere": {"zh-CN": "帮助 › 欢迎", "en-US": "Help › Welcome"},
    "page.missing": {"zh-CN": "这个页面已经不在了：贡献它的插件停止了", "en-US": "This page is no longer available: the plugin that provided it has stopped"},
    "area.loading": {"zh-CN": "正在读取…", "en-US": "Reading…"},
    "page.loading": {"zh-CN": "正在加载页面…", "en-US": "Loading page…"},
    "page.failed": {"zh-CN": "页面加载失败：{reason}", "en-US": "The page failed to load: {reason}"},
    "document.openFailed": {"zh-CN": "打不开 {name}：{reason}", "en-US": "Cannot open {name}: {reason}"},
    "document.retry": {"zh-CN": "重试", "en-US": "Retry"},
    "document.notText": {"zh-CN": "{name} 不是 UTF-8 文本（可能是二进制文件或其它编码），不能在这里打开。", "en-US": "{name} is not UTF-8 text (it may be a binary file or use another encoding) and cannot be opened here."},
    "document.binary": {"zh-CN": "{name} 是二进制文件，不能在这里打开。", "en-US": "{name} is a binary file and cannot be opened here."},
    "document.editorGone": {"zh-CN": "打开 {name} 的编辑器已经不在了：贡献它的插件停止了或没有安装。", "en-US": "The editor for {name} is no longer available: the plugin that provided it has stopped or is not installed."},
    "document.reopenDefault": {"zh-CN": "用默认编辑器打开", "en-US": "Open with Default Editor"},
    "document.editorLoading": {"zh-CN": "正在加载编辑器…", "en-US": "Loading editor…"},
    "banner.conflict": {"zh-CN": "磁盘上的文件已被修改，保存没有写入。", "en-US": "The file changed on disk; the save was not written."},
    "banner.reload": {"zh-CN": "重新载入磁盘版本", "en-US": "Reload Disk Version"},
    "banner.overwrite": {"zh-CN": "覆盖磁盘版本", "en-US": "Overwrite Disk Version"},
    "banner.diskChanged": {"zh-CN": "磁盘上的文件已被修改；保存会得到冲突。", "en-US": "The file changed on disk; saving will conflict."},
    "banner.unresolved": {"zh-CN": "另一个视图同时改了这份文档，这里的输入还没有进入正文。", "en-US": "Another view edited this document at the same time; this view's input has not been applied."},
    "banner.adopt": {"zh-CN": "采用当前正文", "en-US": "Use Current Text"},
    "banner.unrepresentable": {"zh-CN": "这个视图的第 {index} 块{excerpt}写不回 Markdown，输入没有进入正文，也不能保存。改一改这一块的格式，或采用当前正文。", "en-US": "Block {index}{excerpt} in this view cannot be written back as Markdown; the input has not been applied and cannot be saved. Change the formatting of that block, or use the current text."},
    "banner.unrepresentableExcerpt": {"zh-CN": "（“{excerpt}”）", "en-US": " (“{excerpt}”)"},
    "banner.locate": {"zh-CN": "定位", "en-US": "Show Block"},
    "banner.keep": {"zh-CN": "保留本视图的内容", "en-US": "Keep This View's Text"},
    "banner.deleted": {"zh-CN": "文件已被删除。保存会在原位置重新创建它。", "en-US": "The file was deleted. Saving recreates it at the same place."},
    "banner.deletedClean": {"zh-CN": "文件已被删除。", "en-US": "The file was deleted."},
    "banner.ended": {"zh-CN": "文件服务已结束（{reason}），不能保存。", "en-US": "The file service ended ({reason}); saving is not possible."},
    "banner.saveFailed": {"zh-CN": "保存失败：{reason}", "en-US": "Save failed: {reason}"},
    "banner.saveUnknown": {"zh-CN": "保存的结果未知，正在核对磁盘。", "en-US": "The save outcome is unknown; checking the disk."},
    "area.dismiss": {"zh-CN": "关闭提示", "en-US": "Dismiss"},
    "closeDialog.title": {"zh-CN": "保存对 {name} 的修改？", "en-US": "Save changes to {name}?"},
    "closeDialog.body": {"zh-CN": "不保存的话，修改会丢失。", "en-US": "Your changes will be lost if you don't save them."},
    "closeDialog.titleUnrepresentable": {"zh-CN": "放弃对 {name} 的修改？", "en-US": "Discard changes to {name}?"},
    "closeDialog.bodyUnrepresentable": {"zh-CN": "这个视图有一块写不回 Markdown，不能保存；关闭会丢掉这个视图的修改。", "en-US": "A block in this view cannot be written back as Markdown, so it cannot be saved; closing discards this view's changes."},
    "closeDialog.save": {"zh-CN": "保存", "en-US": "Save"},
    "closeDialog.discard": {"zh-CN": "不保存", "en-US": "Don't Save"},
    "closeDialog.cancel": {"zh-CN": "取消", "en-US": "Cancel"},
    "settingsSections.nbook.editor.title": {"zh-CN": "编辑器", "en-US": "Editor"},
    "settingsSections.nbook.editor.description": {"zh-CN": "标签栏与面包屑", "en-US": "Tabs and breadcrumbs"},
    "settingsSections.nbook.editor.groups.tabs.title": {"zh-CN": "标签", "en-US": "Tabs"},
    "settingsSections.nbook.editor.groups.code.title": {"zh-CN": "代码编辑器", "en-US": "Code Editor"},
    "settings.enablePreview.title": {"zh-CN": "预览标签页", "en-US": "Preview Tabs"},
    "settings.enablePreview.description": {"zh-CN": "单击打开的文件先占一个可被替换的标签，编辑或双击后转为常驻", "en-US": "A single click opens a replaceable tab that becomes permanent once edited or double-clicked"},
    "settings.wrapTabs.title": {"zh-CN": "多行标签", "en-US": "Wrap Tabs"},
    "settings.wrapTabs.description": {"zh-CN": "标签放不下时换行，固定的标签单独一行", "en-US": "Wrap tabs that do not fit; pinned tabs get a row of their own"},
    "settings.breadcrumbs.title": {"zh-CN": "面包屑", "en-US": "Breadcrumbs"},
    "settings.breadcrumbs.description": {"zh-CN": "标签栏下面显示文件的路径与光标所在的标题", "en-US": "Show the file path and the current heading below the tabs"},
    "settings.code.fontFamily.title": {"zh-CN": "字体", "en-US": "Font Family"},
    "settings.code.fontFamily.description": {"zh-CN": "CSS 的 font-family 写法；留空跟随主题的等宽字体", "en-US": "A CSS font-family list; leave empty to use the theme's monospace font"},
    "settings.code.fontSize.title": {"zh-CN": "字号", "en-US": "Font Size"},
    // 字号的单位晚于上面的迁移：抄自提交 452ae72bf 的 `shared/settings.ts`（当时写的语言映射）。
    "settings.code.fontSize.unit": {"zh-CN": "像素", "en-US": "px"},
    "settings.code.lineHeight.title": {"zh-CN": "行高", "en-US": "Line Height"},
    "settings.code.lineHeight.description": {"zh-CN": "0 按字号自动；小于 8 是字号的倍数，8 以上是像素", "en-US": "0 follows the font size; below 8 multiplies the font size, 8 and above is in pixels"},
    "settings.code.tabSize.title": {"zh-CN": "Tab 宽度", "en-US": "Tab Size"},
    "settings.code.tabSize.description": {"zh-CN": "一级缩进占几个空格；推测缩进打开时，只在推测不出时用它", "en-US": "Spaces per indentation level; with indentation detection on, used only when nothing can be detected"},
    "settings.code.detectIndentation.title": {"zh-CN": "推测缩进", "en-US": "Detect Indentation"},
    "settings.code.detectIndentation.description": {"zh-CN": "按文件内容推测用空格还是制表符、缩进几格；关掉时一律用上面的 Tab 宽度与空格", "en-US": "Guess spaces or tabs and the indentation size from the file; when off, always use the tab size above with spaces"},
    "settings.code.lineNumbers.title": {"zh-CN": "行号", "en-US": "Line Numbers"},
    "settings.code.lineNumbers.choices.on.title": {"zh-CN": "显示", "en-US": "On"},
    "settings.code.lineNumbers.choices.off.title": {"zh-CN": "不显示", "en-US": "Off"},
    "settings.code.lineNumbers.choices.relative.title": {"zh-CN": "相对", "en-US": "Relative"},
    "settings.code.minimap.title": {"zh-CN": "缩略图", "en-US": "Minimap"},
    "settings.code.wordWrap.title": {"zh-CN": "自动换行", "en-US": "Word Wrap"},
    "categories.editor": {"zh-CN": "编辑器", "en-US": "Editor"},
    "categories.edit": {"zh-CN": "编辑", "en-US": "Edit"},
    "commands.open.title": {"zh-CN": "打开文件", "en-US": "Open File"},
    "commands.open-page.title": {"zh-CN": "打开页面", "en-US": "Open Page"},
    "commands.save.title": {"zh-CN": "保存", "en-US": "Save"},
    "commands.save-all.title": {"zh-CN": "全部保存", "en-US": "Save All"},
    "commands.revert.title": {"zh-CN": "还原为磁盘版本", "en-US": "Revert to Disk Version"},
    "commands.close.title": {"zh-CN": "关闭编辑器", "en-US": "Close Editor"},
    "commands.close-others.title": {"zh-CN": "关闭其它编辑器", "en-US": "Close Other Editors"},
    "commands.close-to-right.title": {"zh-CN": "关闭右侧编辑器", "en-US": "Close Editors to the Right"},
    "commands.close-saved.title": {"zh-CN": "关闭已保存的编辑器", "en-US": "Close Saved Editors"},
    "commands.pin-tab.title": {"zh-CN": "固定编辑器", "en-US": "Pin Editor"},
    "commands.unpin-tab.title": {"zh-CN": "取消固定编辑器", "en-US": "Unpin Editor"},
    "commands.copy-path.title": {"zh-CN": "复制路径", "en-US": "Copy Path"},
    "commands.copy-relative-path.title": {"zh-CN": "复制相对路径", "en-US": "Copy Relative Path"},
    "commands.split-right.title": {"zh-CN": "向右拆分编辑器", "en-US": "Split Editor Right"},
    "commands.split-down.title": {"zh-CN": "向下拆分编辑器", "en-US": "Split Editor Down"},
    "commands.reopen-with.title": {"zh-CN": "用其它编辑器重新打开", "en-US": "Reopen Editor With"},
    "commands.open-preview.title": {"zh-CN": "打开预览", "en-US": "Open Preview"},
    "commands.change-language.title": {"zh-CN": "更改语言模式", "en-US": "Change Language Mode"},
    "commands.focus-breadcrumbs.title": {"zh-CN": "聚焦面包屑", "en-US": "Focus Breadcrumbs"},
    "commands.focus.title": {"zh-CN": "聚焦编辑器", "en-US": "Focus Editor"},
    "commands.nbook.edit.undo.title": {"zh-CN": "撤销", "en-US": "Undo"},
    "commands.nbook.edit.redo.title": {"zh-CN": "重做", "en-US": "Redo"},
    "commands.go-to-line.title": {"zh-CN": "跳转到行", "en-US": "Go to Line"},
    "quickPick.reopenWith.title": {"zh-CN": "用其它编辑器重新打开", "en-US": "Reopen Editor With"},
    "quickPick.reopenWith.placeholder": {"zh-CN": "选择打开这个文件的编辑器", "en-US": "Select an editor for this file"},
    "quickPick.reopenWith.current": {"zh-CN": "当前", "en-US": "Current"},
    "quickPick.changeLanguage.title": {"zh-CN": "更改语言模式", "en-US": "Change Language Mode"},
    "quickPick.changeLanguage.placeholder": {"zh-CN": "选择语言", "en-US": "Select a language"},
    "quickPick.changeLanguage.current": {"zh-CN": "{id}（当前）", "en-US": "{id} (current)"},
    "state.focused.reason": {"zh-CN": "编辑区没有焦点", "en-US": "The editor does not have focus"},
    "state.active.reason": {"zh-CN": "没有活动的编辑器", "en-US": "There is no active editor"},
    "state.writable.reason": {"zh-CN": "活动的编辑器是只读的", "en-US": "The active editor is read-only"},
    "state.lineNavigation.reason": {"zh-CN": "活动的编辑器不支持跳转到行", "en-US": "The active editor cannot go to a line"},
    "state.dirty.reason": {"zh-CN": "活动文档没有未保存的修改", "en-US": "The active document has no unsaved changes"},
    "state.hasUnsavedDocuments.reason": {"zh-CN": "没有需要保存的文档", "en-US": "No document needs saving"},
    "state.hasCursorPosition.reason": {"zh-CN": "活动的编辑器不给出光标位置", "en-US": "The active editor does not report a cursor position"},
    "state.ready.reason": {"zh-CN": "编辑器区还没建立", "en-US": "The editor area is not ready yet"},
    "state.hasDocument.reason": {"zh-CN": "活动的编辑器没有文本", "en-US": "The active editor has no text"},
    "state.hasPreview.reason": {"zh-CN": "这个文件没有预览", "en-US": "This file has no preview"},
    "state.hasEditorStatus.reason": {"zh-CN": "活动的编辑器没有状态可显示", "en-US": "The active editor reports no status"},
    "state.hasLanguage.reason": {"zh-CN": "活动的编辑器不分语言", "en-US": "The active editor has no language mode"},
    "statusItems.unsaved.title": {"zh-CN": "未保存的文档", "en-US": "Unsaved documents"},
    "statusItems.word-count.title": {"zh-CN": "字数", "en-US": "Word count"},
    "statusItems.editor-status.title": {"zh-CN": "编辑器状态", "en-US": "Editor status"},
    "statusItems.language.title": {"zh-CN": "语言模式", "en-US": "Language mode"},
    "statusItems.cursor.title": {"zh-CN": "光标位置", "en-US": "Cursor position"},
    "status.unsaved": {"zh-CN": "未保存 {count} 个", "en-US": "{count} unsaved"},
    "status.saving": {"zh-CN": "正在保存", "en-US": "Saving"},
    "status.failed": {"zh-CN": "保存失败：{path}（{reason}）", "en-US": "Save failed: {path} ({reason})"},
    "status.more": {"zh-CN": "等 {count} 个", "en-US": "and {count} more"},
    "status.words": {"zh-CN": "{count} 字", "en-US": "{count} words"},
    "status.cursor": {"zh-CN": "第 {line} 行，第 {column} 列", "en-US": "Ln {line}, Col {column}"},
    "editors.markdown.title": {"zh-CN": "Markdown 编辑器", "en-US": "Markdown Editor"},
    "editors.code.title": {"zh-CN": "源码编辑器", "en-US": "Source Editor"},
    "languages.plaintext": {"zh-CN": "纯文本", "en-US": "Plain Text"},
    "titleActions.openPreviewSide": {"zh-CN": "在侧边打开预览", "en-US": "Open Preview to the Side"},
    "tabMenu.close": {"zh-CN": "关闭", "en-US": "Close"},
    "tabMenu.closeOthers": {"zh-CN": "关闭其他", "en-US": "Close Others"},
    "tabMenu.closeToRight": {"zh-CN": "关闭右侧", "en-US": "Close to the Right"},
    "tabMenu.closeSaved": {"zh-CN": "关闭已保存", "en-US": "Close Saved"},
    "tabMenu.pin": {"zh-CN": "固定", "en-US": "Pin"},
    "tabMenu.unpin": {"zh-CN": "取消固定", "en-US": "Unpin"},
    "tabMenu.splitRight": {"zh-CN": "向右拆分", "en-US": "Split Right"},
    "tabMenu.splitDown": {"zh-CN": "向下拆分", "en-US": "Split Down"},
    "tabMenu.copyPath": {"zh-CN": "复制路径", "en-US": "Copy Path"},
    "tabMenu.copyRelativePath": {"zh-CN": "复制相对路径", "en-US": "Copy Relative Path"},
    "tabMenu.reveal": {"zh-CN": "在资源管理器中显示", "en-US": "Reveal in Explorer"},
};

const RUNTIME: Readonly<Record<string, {readonly "zh-CN": string; readonly "en-US": string}>> = {
    // Markdown 的编辑命令与菜单（docs/specs/workbench/markdown-editing.md）。
    "categories.view": {"zh-CN": "视图", "en-US": "View"},
    "commands.nbook.edit.align.title": {"zh-CN": "对齐", "en-US": "Align"},
    "commands.nbook.edit.bilingual.title": {"zh-CN": "双语对照", "en-US": "Bilingual"},
    "commands.nbook.edit.bold.title": {"zh-CN": "粗体", "en-US": "Bold"},
    "commands.nbook.edit.bullet-list.title": {"zh-CN": "无序列表", "en-US": "Bulleted List"},
    "commands.nbook.edit.callout.title": {"zh-CN": "提示块", "en-US": "Callout"},
    "commands.nbook.edit.clear-format.title": {"zh-CN": "清除格式", "en-US": "Clear Formatting"},
    "commands.nbook.edit.code-block.title": {"zh-CN": "代码块", "en-US": "Code Block"},
    "commands.nbook.edit.code.title": {"zh-CN": "行内代码", "en-US": "Inline Code"},
    "commands.nbook.edit.divider.title": {"zh-CN": "分割线", "en-US": "Divider"},
    "commands.nbook.edit.heading-1.title": {"zh-CN": "标题 1", "en-US": "Heading 1"},
    "commands.nbook.edit.heading-2.title": {"zh-CN": "标题 2", "en-US": "Heading 2"},
    "commands.nbook.edit.heading-3.title": {"zh-CN": "标题 3", "en-US": "Heading 3"},
    "commands.nbook.edit.highlight.title": {"zh-CN": "高亮", "en-US": "Highlight"},
    "commands.nbook.edit.italic.title": {"zh-CN": "斜体", "en-US": "Italic"},
    "commands.nbook.edit.ordered-list.title": {"zh-CN": "有序列表", "en-US": "Numbered List"},
    "commands.nbook.edit.paragraph.title": {"zh-CN": "正文", "en-US": "Paragraph"},
    "commands.nbook.edit.quote.title": {"zh-CN": "引用", "en-US": "Quote"},
    "commands.nbook.edit.ruby.title": {"zh-CN": "注音", "en-US": "Ruby"},
    "commands.nbook.edit.strike.title": {"zh-CN": "删除线", "en-US": "Strikethrough"},
    "commands.nbook.edit.subscript.title": {"zh-CN": "下标", "en-US": "Subscript"},
    "commands.nbook.edit.superscript.title": {"zh-CN": "上标", "en-US": "Superscript"},
    "commands.nbook.edit.table.title": {"zh-CN": "表格", "en-US": "Table"},
    "commands.nbook.edit.task-list.title": {"zh-CN": "任务列表", "en-US": "Task List"},
    "commands.nbook.edit.text-color.title": {"zh-CN": "文字颜色", "en-US": "Text Color"},
    "commands.nbook.view.toggle-editor-toolbar.title": {"zh-CN": "显示编辑器工具栏", "en-US": "Show Editor Toolbar"},
    "menus.align-center": {"zh-CN": "居中", "en-US": "Center"},
    "menus.align-justify": {"zh-CN": "两端对齐", "en-US": "Justify"},
    "menus.align-left": {"zh-CN": "左对齐", "en-US": "Align Left"},
    "menus.align-right": {"zh-CN": "右对齐", "en-US": "Align Right"},
    "menus.blockType": {"zh-CN": "块类型", "en-US": "Block Type"},
    "menus.color-amber": {"zh-CN": "琥珀", "en-US": "Amber"},
    "menus.color-blue": {"zh-CN": "蓝", "en-US": "Blue"},
    "menus.color-emerald": {"zh-CN": "绿", "en-US": "Green"},
    "menus.color-green": {"zh-CN": "绿", "en-US": "Green"},
    "menus.color-neutral": {"zh-CN": "浅灰", "en-US": "Light Gray"},
    "menus.color-orange": {"zh-CN": "橙", "en-US": "Orange"},
    "menus.color-pink": {"zh-CN": "粉", "en-US": "Pink"},
    "menus.color-purple": {"zh-CN": "紫", "en-US": "Purple"},
    "menus.color-red": {"zh-CN": "红", "en-US": "Red"},
    "menus.color-sky": {"zh-CN": "蓝", "en-US": "Blue"},
    "menus.color-slate": {"zh-CN": "灰", "en-US": "Slate"},
    "menus.color-stone": {"zh-CN": "米色", "en-US": "Beige"},
    "menus.color-violet": {"zh-CN": "紫", "en-US": "Purple"},
    "menus.color-yellow": {"zh-CN": "黄", "en-US": "Yellow"},
    "menus.colorNone": {"zh-CN": "默认", "en-US": "Default"},
    "menus.more": {"zh-CN": "更多操作", "en-US": "More Actions"},
    "menus.toolbar": {"zh-CN": "格式", "en-US": "Formatting"},
    "refusal.editingUnavailable": {"zh-CN": "这里不能用这个动作", "en-US": "This action is not available here"},
    "refusal.editingUnsupported": {"zh-CN": "活动的编辑器不支持这个动作", "en-US": "The active editor does not support this action"},
    "settings.markdownToolbar.description": {"zh-CN": "Markdown 编辑器顶部的工具栏", "en-US": "The toolbar above the Markdown editor"},
    "settings.markdownToolbar.title": {"zh-CN": "编辑器工具栏", "en-US": "Editor Toolbar"},
    "state.canConvertBlock.reason": {"zh-CN": "光标所在的地方不能换块类型", "en-US": "The block type cannot be changed here"},
    "state.canFormat.reason": {"zh-CN": "光标所在的地方不能加格式", "en-US": "Formatting is not available here"},
    "state.hasSelection.reason": {"zh-CN": "没有选中内容", "en-US": "Nothing is selected"},
    "state.toolbarVisible.reason": {"zh-CN": "工具栏没有打开", "en-US": "The toolbar is hidden"},
    "notice.lastEditMissing": {"zh-CN": "上次编辑的片段已不在原处：{address}", "en-US": "The passage you last edited is no longer where it was: {address}"},
    "notice.unresolved": {"zh-CN": "有未裁决的输入：先在组顶部选择采用当前正文或保留本视图的内容", "en-US": "This view has unresolved input: first choose Use Current Text or Keep This View's Text at the top of the group"},
    "notice.unrepresentable": {"zh-CN": "这个视图有一块写不回 Markdown：先在组顶部定位并修改它，或采用当前正文", "en-US": "A block in this view cannot be written back as Markdown: first use Show Block at the top of the group and change it, or choose Use Current Text"},
    "notice.continueOutsideProject": {"zh-CN": "不能打开 {address}：继续写作只能打开项目里的文件", "en-US": "Cannot open {address}: only files in the project can be opened to continue writing"},
    "refusal.currentUnresolved": {"zh-CN": "当前视图有未裁决的输入", "en-US": "The current view has unresolved input"},
    "refusal.currentUnrepresentable": {"zh-CN": "当前视图有一块写不回 Markdown", "en-US": "A block in the current view cannot be written back as Markdown"},
    "refusal.targetUnresolved": {"zh-CN": "目标组有未裁决的输入", "en-US": "The target group has unresolved input"},
    "refusal.targetUnrepresentable": {"zh-CN": "目标组有一块写不回 Markdown", "en-US": "A block in the target group cannot be written back as Markdown"},
    "refusal.disposed": {"zh-CN": "编辑器已关闭", "en-US": "The editor is closed"},
    "refusal.unsavedBeforeBytes": {"zh-CN": "有未保存的修改：先保存或放弃修改，再换成按字节显示的编辑器", "en-US": "There are unsaved changes: save or discard them before switching to an editor that shows bytes"},
    "refusal.batchRunning": {"zh-CN": "正在关闭编辑器", "en-US": "Editors are already being closed"},
    "refusal.batchCancelled": {"zh-CN": "关了 {count} 个，在 {address} 处取消", "en-US": "Closed {count} editors, cancelled at {address}"},
    "refusal.batchSaveFailed": {"zh-CN": "关了 {count} 个，{address} 保存失败", "en-US": "Closed {count} editors; saving {address} failed"},
    "refusal.tabClosed": {"zh-CN": "标签已关闭", "en-US": "The tab is closed"},
    "refusal.groupClosed": {"zh-CN": "编辑组已关闭", "en-US": "The editor group is closed"},
    "refusal.saveFailed": {"zh-CN": "保存失败", "en-US": "Save failed"},
    "refusal.cancelled": {"zh-CN": "已取消", "en-US": "Cancelled"},
    "refusal.samePlace": {"zh-CN": "位置没有变化", "en-US": "The position did not change"},
    "refusal.pageAddress": {"zh-CN": "页面用 nbook.editor.open-page 打开", "en-US": "Pages are opened with nbook.editor.open-page"},
    "refusal.noPreview": {"zh-CN": "活动标签的文件没有预览", "en-US": "The active tab's file has no preview"},
    "refusal.notFileTab": {"zh-CN": "活动的不是文件标签", "en-US": "The active tab is not a file tab"},
    "refusal.pagePin": {"zh-CN": "页面标签不能固定", "en-US": "Page tabs cannot be pinned"},
    "refusal.cannotSplit": {"zh-CN": "不能再拆分", "en-US": "Cannot split any further"},
    "refusal.noActiveTab": {"zh-CN": "没有活动标签", "en-US": "There is no active tab"},
    "refusal.pageSplit": {"zh-CN": "页面只开一个，不能拆分", "en-US": "A page opens only once and cannot be split"},
    "refusal.pageEditor": {"zh-CN": "页面不是文件，不能换编辑器", "en-US": "A page is not a file, so its editor cannot be changed"},
    "refusal.noActiveFileTab": {"zh-CN": "没有活动的文件标签", "en-US": "There is no active file tab"},
    "refusal.noActiveDocument": {"zh-CN": "没有活动文档", "en-US": "There is no active document"},
    "refusal.saveUnrepresentable": {"zh-CN": "有视图写不回 Markdown，没有保存：先在组顶部定位并修改，或采用当前正文", "en-US": "A view cannot be written back as Markdown, so nothing was saved: first use Show Block at the top of the group and change it, or choose Use Current Text"},
    "refusal.noEditor": {"zh-CN": "没有编辑器 {editor}", "en-US": "There is no editor {editor}"},
    "refusal.editorCannotOpen": {"zh-CN": "编辑器 {editor} 不能打开 {name}", "en-US": "Editor {editor} cannot open {name}"},
    "refusal.notReady": {"zh-CN": "编辑器尚未就绪", "en-US": "The editor is not ready yet"},
    "refusal.pageNoPath": {"zh-CN": "页面标签没有路径", "en-US": "Page tabs have no path"},
    "refusal.noClipboard": {"zh-CN": "剪贴板不可用", "en-US": "The clipboard is not available"},
    "refusal.realPathFailed": {"zh-CN": "取不到 {address} 的绝对路径：{code}", "en-US": "Cannot get the absolute path of {address}: {code}"},
    "refusal.clipboardFailed": {"zh-CN": "写剪贴板失败：{message}", "en-US": "Writing to the clipboard failed: {message}"},
    "refusal.undoUnsupported": {"zh-CN": "当前编辑器不支持撤销", "en-US": "The current editor does not support undo"},
    "refusal.redoUnsupported": {"zh-CN": "当前编辑器不支持重做", "en-US": "The current editor does not support redo"},
    "refusal.noPage": {"zh-CN": "没有页面 {id}，或贡献它的插件还没就绪", "en-US": "There is no page {id}, or the plugin that provides it is not ready yet"},
    "refusal.closeCancelled": {"zh-CN": "用户取消了关闭", "en-US": "The user cancelled closing"},
    "refusal.noPicker": {"zh-CN": "没有选择服务，请给出 {arg} 参数", "en-US": "There is no picker; give the {arg} argument"},
    "refusal.areaChanged": {"zh-CN": "选择期间编辑器区已经换了", "en-US": "The editor area changed while picking"},
    "refusal.tabChanged": {"zh-CN": "选择期间活动标签已经换了", "en-US": "The active tab changed while picking"},
    "refusal.noLanguage": {"zh-CN": "活动的编辑器不分语言", "en-US": "The active editor has no language mode"},
    "refusal.unknownLanguage": {"zh-CN": "没有登记语言 {language}", "en-US": "Language {language} is not registered"},
    "refusal.nothingToFocus": {"zh-CN": "当前没有可聚焦的编辑器", "en-US": "There is no editor to focus"},
    "refusal.noActiveEditor": {"zh-CN": "当前没有活动编辑器", "en-US": "There is no active editor"},
    "refusal.targetChanged": {"zh-CN": "目标编辑器已关闭或切换", "en-US": "The target editor was closed or switched"},
    "refusal.lineUnsupported": {"zh-CN": "当前编辑器不支持行号跳转", "en-US": "The active editor does not support line navigation"},
    "refusal.lineOutOfRangeOf": {"zh-CN": "行号超出范围：{line}（共 {total} 行）", "en-US": "Line {line} is out of range ({total} lines)"},
    "refusal.lineOutOfRange": {"zh-CN": "行号超出范围：{line}", "en-US": "Line {line} is out of range"},
    "rescue.lostFormat": {"zh-CN": "这个视图有写不回 Markdown 的块，那些块只留下了文字（格式丢了）", "en-US": "This view has blocks that cannot be written back as Markdown; only their text was kept (the formatting is lost)"},
};

/** 运行期数量键英文的单数形（`RUNTIME` 里写的是复数形）。 */
const RUNTIME_ONE: Readonly<Record<string, string>> = {
    "refusal.batchCancelled_one": "Closed {count} editor, cancelled at {address}",
    "refusal.batchSaveFailed_one": "Closed {count} editor; saving {address} failed",
};

/**
 * 数量键英文的单数形（`_one`）：旧英文不分单复数（`{count} items`），迁移时两形抄成一样；w00028 t03 审查第 9 条改成正确的
 * 单数，这里逐字列出。单复数写法本来就相同的键英文只写不带后缀的键，不在这里。
 */
const ENGLISH_ONE: Readonly<Record<string, string>> = {
    "status.words_one": "{count} word",
};

/** 英文单复数写法相同的数量键：英文只写不带后缀的键，中文照常写 `_other`。 */
const ENGLISH_SAME: ReadonlySet<string> = new Set(["status.unsaved", "status.more"]);

const EXPECTED = {...LEGACY, ...RUNTIME};

const CATALOGS = {"zh-CN": zhCN, "en-US": enUS} as const;

/** 旧代码里先按界面语言格式化成字符串再填的数字参数，迁移后由 `{{name, number}}` 格式化。 */
const NUMBER_KEYS: ReadonlySet<string> = new Set(["status.unsaved", "status.more", "status.words", "status.cursor"]);
/** 数量键（带 `count` 参数、按复数选形）。 */
const PLURAL_KEYS = ["status.unsaved", "status.more", "status.words", "refusal.batchCancelled", "refusal.batchSaveFailed"];

/** 复数形 `<键>_<类别>` 归到 `<键>`。 */
const baseKey = (key: string): string => key.replace(/_(?:zero|one|two|few|many|other)$/u, "");

/** 旧的 `{name}` 占位符换成目录的写法。 */
const migrated = (key: string, legacy: string): string => legacy.replace(/\{(\w+)\}/gu, NUMBER_KEYS.has(key) ? "{{$1, number}}" : "{{$1}}");

describe("nbook.editor 的目录", () => {
    it("每个键的文字与迁移前的字面量逐字相同（占位符从 {name} 换成 {{name}}），运行期文字按 RUNTIME，两边的键一一对应", () => {
        for (const [locale, catalog] of Object.entries(CATALOGS)) {
            const flat = flattenCatalog(catalog);
            expect({locale, keys: [...new Set(Object.keys(flat).map(baseKey))].sort()}).toEqual({locale, keys: Object.keys(EXPECTED).sort()});
            for (const [key, value] of Object.entries(flat)) {
                const written = (locale === "en-US" ? RUNTIME_ONE[key] ?? ENGLISH_ONE[key] : undefined) ?? EXPECTED[baseKey(key)]![locale as keyof typeof CATALOGS];
                const legacy = migrated(baseKey(key), written);
                expect({locale, key, value}).toEqual({locale, key, value: legacy});
            }
        }
    });

    it("数量键：中文有 _other，英文有 _one 与 _other；英文单复数相同的只写不带后缀的键", () => {
        const flatZh = Object.keys(flattenCatalog(zhCN));
        const flatEn = Object.keys(flattenCatalog(enUS));
        for (const key of PLURAL_KEYS) {
            expect(flatZh.filter((candidate) => baseKey(candidate) === key)).toEqual([`${key}_other`]);
            expect(flatEn.filter((candidate) => baseKey(candidate) === key)).toEqual(ENGLISH_SAME.has(key) ? [key] : [`${key}_one`, `${key}_other`]);
        }
    });

    it("数字参数经引擎按界面语言格式化：千分位保留，英文一个时也是同一句", () => {
        const zh = testTextPort("zh-CN", {"nbook.editor": editorCatalogs});
        const en = testTextPort("en-US", {"nbook.editor": editorCatalogs});
        expect(zh.t(editorText("status.words", {count: 1234567}))).toBe("1,234,567 字");
        expect(en.t(editorText("status.words", {count: 1234567}))).toBe("1,234,567 words");
        expect(en.t(editorText("status.unsaved", {count: 1}))).toBe("1 unsaved");
        expect(zh.t(editorText("status.cursor", {line: 1200, column: 3}))).toBe("第 1,200 行，第 3 列");
    });

    it("批量关闭停下时的原因：英文一个用单数、多个用复数，中文同一句", () => {
        const zh = testTextPort("zh-CN", {"nbook.editor": editorCatalogs});
        const en = testTextPort("en-US", {"nbook.editor": editorCatalogs});
        expect(en.t(editorText("refusal.batchCancelled", {count: 1, address: "project://a.md"}))).toBe("Closed 1 editor, cancelled at project://a.md");
        expect(en.t(editorText("refusal.batchCancelled", {count: 2, address: "project://a.md"}))).toBe("Closed 2 editors, cancelled at project://a.md");
        expect(en.t(editorText("refusal.batchSaveFailed", {count: 0, address: "project://a.md"}))).toBe("Closed 0 editors; saving project://a.md failed");
        expect(zh.t(editorText("refusal.batchCancelled", {count: 1, address: "project://a.md"}))).toBe("关了 1 个，在 project://a.md 处取消");
        expect(zh.t(editorText("refusal.batchSaveFailed", {count: 2, address: "project://a.md"}))).toBe("关了 2 个，project://a.md 保存失败");
    });

    it("文字引用的命名空间就是插件 id", () => {
        expect(editorText("area.label").ns).toBe(descriptor.id);
    });
});
