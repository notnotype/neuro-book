/**
 * `nbook.explorer` 的消息目录（docs/specs/ui/i18n.md 的“目录与键”）。
 *
 * 第一条防止迁移改错文字：`LEGACY` 是迁移前（提交 5b52fe5d5）代码里的双语字面量，按迁移后的键原样抄下，占位符还是旧的
 * `{name}` 写法。目录里的每个键都要在表里、表里的每个键都要在目录里，值换成 `{{name}}` 后逐字相同；数量键的各复数形都与
 * 旧文字相同，英文的单数形另列在 `ENGLISH_ONE`。以后有意改文字时，同一次改动里同步改这张表。
 */

import {describe, expect, it} from "bun:test";

import {flattenCatalog} from "@notnotype/nb-ui/text";

import {descriptor} from "./plugin";
import {explorerText} from "./shared/text";
import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";

const LEGACY: Readonly<Record<string, {readonly "zh-CN": string; readonly "en-US": string}>> = {
    "commands.category": {"zh-CN": "文件", "en-US": "Files"},
    "commands.nbook.files.new-file.title": {"zh-CN": "新建文件", "en-US": "New File"},
    "commands.nbook.files.new-folder.title": {"zh-CN": "新建文件夹", "en-US": "New Folder"},
    "commands.nbook.files.collapse-all.title": {"zh-CN": "全部收起", "en-US": "Collapse All"},
    "commands.nbook.files.toggle-manifests.title": {"zh-CN": "显示清单文件", "en-US": "Show Manifest Files"},
    "commands.nbook.files.rename.title": {"zh-CN": "重命名", "en-US": "Rename"},
    "commands.nbook.files.delete.title": {"zh-CN": "删除", "en-US": "Delete"},
    "commands.nbook.files.create-content.title": {"zh-CN": "创建内容", "en-US": "Create Content"},
    "commands.nbook.files.convert.title": {"zh-CN": "转换文件夹类型", "en-US": "Convert Folder"},
    "commands.nbook.files.set-display.title": {"zh-CN": "修改展示名与图标", "en-US": "Edit Display Name and Icon"},
    "commands.nbook.files.include.title": {"zh-CN": "加入清单", "en-US": "Add to Manifest"},
    "commands.nbook.files.drop-entry.title": {"zh-CN": "从清单移除", "en-US": "Remove from Manifest"},
    "commands.nbook.files.move-up.title": {"zh-CN": "上移", "en-US": "Move Up"},
    "commands.nbook.files.move-down.title": {"zh-CN": "下移", "en-US": "Move Down"},
    "commands.nbook.files.copy.title": {"zh-CN": "复制", "en-US": "Copy"},
    "commands.nbook.files.cut.title": {"zh-CN": "剪切", "en-US": "Cut"},
    "commands.nbook.files.paste.title": {"zh-CN": "粘贴", "en-US": "Paste"},
    "commands.nbook.files.clear-cut.title": {"zh-CN": "清除剪切标记", "en-US": "Clear Cut"},
    "commands.nbook.files.retry-list.title": {"zh-CN": "重试", "en-US": "Retry"},
    "commands.nbook.files.open.title": {"zh-CN": "打开", "en-US": "Open"},
    "commands.nbook.files.open-to-side.title": {"zh-CN": "在侧边打开", "en-US": "Open to the Side"},
    "commands.nbook.files.copy-path.title": {"zh-CN": "复制路径", "en-US": "Copy Path"},
    "commands.nbook.files.copy-relative-path.title": {"zh-CN": "复制相对路径", "en-US": "Copy Relative Path"},
    "commands.nbook.view.refresh-files.title": {"zh-CN": "刷新", "en-US": "Refresh"},
    "commands.nbook.files.reveal.title": {"zh-CN": "在资源管理器中显示", "en-US": "Reveal in Explorer"},
    "views.nbook.explorer.title": {"zh-CN": "资源管理器", "en-US": "Explorer"},
    "views.nbook.explorer.actions.nbook.files.new-file.title": {"zh-CN": "新建文件", "en-US": "New File"},
    "views.nbook.explorer.actions.nbook.files.new-folder.title": {"zh-CN": "新建文件夹", "en-US": "New Folder"},
    "views.nbook.explorer.actions.nbook.view.refresh-files.title": {"zh-CN": "刷新", "en-US": "Refresh"},
    "views.nbook.explorer.actions.nbook.files.collapse-all.title": {"zh-CN": "全部收起", "en-US": "Collapse All"},
    "views.nbook.explorer.actions.nbook.files.toggle-manifests.title": {"zh-CN": "显示清单文件", "en-US": "Show Manifest Files"},
    "settingsSections.nbook.explorer.title": {"zh-CN": "资源管理器", "en-US": "Explorer"},
    "settingsSections.nbook.explorer.description": {"zh-CN": "文件树的显示", "en-US": "How the file tree looks"},
    "settingsSections.nbook.explorer.groups.tree.title": {"zh-CN": "文件树", "en-US": "File Tree"},
    "settings.indentGuides.title": {"zh-CN": "缩进参考线", "en-US": "Indent Guides"},
    "settings.indentGuides.description": {"zh-CN": "每层一条竖线，焦点所在那一层加深", "en-US": "A line per level; the focused level is darker"},
    "settings.indentGuides.choices.none.title": {"zh-CN": "不显示", "en-US": "None"},
    "settings.indentGuides.choices.hover.title": {"zh-CN": "悬停时显示", "en-US": "On Hover"},
    "settings.indentGuides.choices.always.title": {"zh-CN": "一直显示", "en-US": "Always"},
    "settings.hideMarkdownExtension.title": {"zh-CN": "隐藏 Markdown 扩展名", "en-US": "Hide Markdown Extension"},
    "settings.hideMarkdownExtension.description": {"zh-CN": "改名时仍显示完整名字", "en-US": "Renaming still shows the full name"},
    "state.ready.reason": {"zh-CN": "资源管理器尚未打开", "en-US": "The explorer is not open yet"},
    "state.canCreate.reason": {"zh-CN": "没有可以新建的位置", "en-US": "No place to create in"},
    "state.hasSelection.reason": {"zh-CN": "没有选中资源", "en-US": "Nothing is selected"},
    "state.canPaste.reason": {"zh-CN": "剪贴板为空、没有可以粘贴的位置，或上一次批量的结果未知", "en-US": "The clipboard is empty, there is no place to paste, or the last batch outcome is unknown"},
    "state.canReorder.reason": {"zh-CN": "选中的项不能在清单里调整顺序", "en-US": "The selection cannot be reordered"},
    "state.canCreateContent.reason": {"zh-CN": "选中的不是没有正文的内容节点", "en-US": "The selection is not a content node without content"},
    "state.canConvert.reason": {"zh-CN": "选中的不是可以转换的文件夹", "en-US": "The selection is not a folder that can be converted"},
    "state.canEditManifest.reason": {"zh-CN": "选中的项不在内容文件夹里", "en-US": "The selection is not in a content folder"},
    "state.showManifests.reason": {"zh-CN": "清单文件没有显示", "en-US": "Manifest files are hidden"},
    "menu.newFile": {"zh-CN": "新建文件", "en-US": "New File"},
    "menu.newFolder": {"zh-CN": "新建文件夹", "en-US": "New Folder"},
    "menu.paste": {"zh-CN": "粘贴", "en-US": "Paste"},
    "menu.open": {"zh-CN": "打开", "en-US": "Open"},
    "menu.openToSide": {"zh-CN": "在侧边打开", "en-US": "Open to the Side"},
    "menu.cut": {"zh-CN": "剪切", "en-US": "Cut"},
    "menu.copy": {"zh-CN": "复制", "en-US": "Copy"},
    "menu.copyPath": {"zh-CN": "复制路径", "en-US": "Copy Path"},
    "menu.copyRelativePath": {"zh-CN": "复制相对路径", "en-US": "Copy Relative Path"},
    "menu.rename": {"zh-CN": "重命名", "en-US": "Rename"},
    "menu.createContent": {"zh-CN": "创建内容", "en-US": "Create Content"},
    "menu.convertToPlain": {"zh-CN": "转为普通文件夹", "en-US": "Convert to Plain Folder"},
    "menu.convertToContent": {"zh-CN": "转为内容文件夹", "en-US": "Convert to Content Folder"},
    "menu.include": {"zh-CN": "加入清单", "en-US": "Add to Manifest"},
    "menu.drop": {"zh-CN": "从清单移除", "en-US": "Remove from Manifest"},
    "menu.setDisplay": {"zh-CN": "修改展示名与图标", "en-US": "Edit Display Name and Icon"},
    "menu.moveUp": {"zh-CN": "上移", "en-US": "Move Up"},
    "menu.moveDown": {"zh-CN": "下移", "en-US": "Move Down"},
    "menu.delete": {"zh-CN": "删除", "en-US": "Delete"},
    "tree.label": {"zh-CN": "文件", "en-US": "Files"},
    "tree.projectRoot": {"zh-CN": "项目", "en-US": "Project"},
    "tree.userRoot": {"zh-CN": "用户资产", "en-US": "User Assets"},
    "tree.noProject": {"zh-CN": "尚未打开项目", "en-US": "No project open"},
    "tree.loading": {"zh-CN": "正在读取…", "en-US": "Loading…"},
    "tree.readFailedRetry": {"zh-CN": "读取失败：{reason}。点击重试", "en-US": "Could not read: {reason}. Click to retry"},
    "tree.manifestUnreadable": {"zh-CN": "清单读不出，按普通文件夹显示：{reason}", "en-US": "Manifest unreadable, shown as a plain folder: {reason}"},
    "tree.manifestInvalid": {"zh-CN": "清单不合法，按普通文件夹显示：{reason}", "en-US": "Invalid manifest, shown as a plain folder: {reason}"},
    "tree.marks.missing": {"zh-CN": "缺失", "en-US": "Missing"},
    "tree.marks.unlisted": {"zh-CN": "未列入", "en-US": "Not listed"},
    "tree.marks.noBody": {"zh-CN": "无正文", "en-US": "No content"},
    "tree.marks.needsPlot": {"zh-CN": "需要剧情插件", "en-US": "Needs the plot plugin"},
    "tree.marks.cutMark": {"zh-CN": "剪切中", "en-US": "Cut"},
    "tree.newFileName": {"zh-CN": "新文件的名字", "en-US": "New file name"},
    "tree.newFolderName": {"zh-CN": "新文件夹的名字", "en-US": "New folder name"},
    "tree.renameLabel": {"zh-CN": "重命名 {name}", "en-US": "Rename {name}"},
    "tree.drop.into": {"zh-CN": "移入 {name}", "en-US": "Move into {name}"},
    "tree.drop.intoLast": {"zh-CN": "移入 {name}（放在最后）", "en-US": "Move into {name} (at the end)"},
    "tree.drop.after": {"zh-CN": "放到 {name} 之后", "en-US": "Place after {name}"},
    "tree.drop.before": {"zh-CN": "放到 {name} 之前", "en-US": "Place before {name}"},
    "tree.drop.afterInto": {"zh-CN": "放到 {name} 之后（移入 {target}）", "en-US": "Place after {name} (into {target})"},
    "tree.drop.beforeInto": {"zh-CN": "放到 {name} 之前（移入 {target}）", "en-US": "Place before {name} (into {target})"},
    "tree.drop.openSome": {"zh-CN": "{label}（另 {skipped} 项不打开）", "en-US": "{label} ({skipped} more not opened)"},
    "tree.dragItems": {"zh-CN": "{count} 项", "en-US": "{count} items"},
    "view.openProject": {"zh-CN": "打开项目", "en-US": "Open Project"},
    "view.ended": {"zh-CN": "已停止同步：{reason}", "en-US": "Stopped syncing: {reason}"},
    "view.reconnect": {"zh-CN": "重新连接", "en-US": "Reconnect"},
    "view.prefsUnread": {"zh-CN": "资源管理器偏好未读取，正在用缺省值（{reason}）", "en-US": "Explorer preferences not loaded; using defaults ({reason})"},
    "view.prefsProtected": {"zh-CN": "资源管理器偏好记录无法使用，修改不会保存（{reason}）", "en-US": "Explorer preferences record is unusable; changes will not be saved ({reason})"},
    "view.prefsUnsaved": {"zh-CN": "展开与显示偏好未保存（{reason}）", "en-US": "Expansion and display preferences not saved ({reason})"},
    "view.reload": {"zh-CN": "重新读取", "en-US": "Reload"},
    "view.retry": {"zh-CN": "重试", "en-US": "Retry"},
    "view.discard": {"zh-CN": "放弃", "en-US": "Discard"},
    "common.cancel": {"zh-CN": "取消", "en-US": "Cancel"},
    "dialog.delete.title": {"zh-CN": "删除 {count} 项？", "en-US": "Delete {count} items?"},
    "dialog.delete.confirm": {"zh-CN": "删除", "en-US": "Delete"},
    "dialog.delete.description": {"zh-CN": "将删除下列项及其中的全部内容，删除后不能恢复。", "en-US": "These items and everything inside them will be deleted. This cannot be undone."},
    "dialog.delete.unsaved": {"zh-CN": "这些打开的文件有未保存的修改，删除后会丢失：", "en-US": "These open files have unsaved changes that will be lost:"},
    "dialog.dirtyCopy.title": {"zh-CN": "要复制的文件有未保存的修改", "en-US": "Files to copy have unsaved changes"},
    "dialog.dirtyCopy.body": {"zh-CN": "先保存再复制，副本包含最新正文；复制磁盘版本，副本不含未保存的修改。", "en-US": "Save first so the copies include the latest text, or copy the versions on disk without the unsaved changes."},
    "dialog.dirtyCopy.unrepresentable": {"zh-CN": "其中有文档的视图写不回 Markdown，不能先保存；可以复制磁盘版本，副本不含未保存的修改。", "en-US": "A view of one of these documents cannot be written back as Markdown, so it cannot be saved first; copy the versions on disk without the unsaved changes."},
    "dialog.dirtyCopy.save": {"zh-CN": "先保存再复制", "en-US": "Save, Then Copy"},
    "dialog.dirtyCopy.disk": {"zh-CN": "复制磁盘版本", "en-US": "Copy Disk Versions"},
    "dialog.display.title": {"zh-CN": "展示名与图标：{name}", "en-US": "Display name and icon: {name}"},
    "dialog.display.name": {"zh-CN": "展示名", "en-US": "Display name"},
    "dialog.display.icon": {"zh-CN": "图标", "en-US": "Icon"},
    "dialog.display.hint": {"zh-CN": "留空则去掉，只改清单，不改文件名。", "en-US": "Leave empty to remove. Only the manifest changes, not the file name."},
    "dialog.display.save": {"zh-CN": "保存", "en-US": "Save"},
    "dialog.collision.title": {"zh-CN": "已存在同名项", "en-US": "An item with this name exists"},
    "dialog.collision.source": {"zh-CN": "源", "en-US": "Source"},
    "dialog.collision.target": {"zh-CN": "目标", "en-US": "Target"},
    "dialog.collision.name": {"zh-CN": "新名字", "en-US": "New name"},
    "dialog.collision.rename": {"zh-CN": "改名", "en-US": "Rename"},
    "dialog.collision.skip": {"zh-CN": "跳过", "en-US": "Skip"},
    "dialog.collision.cancel": {"zh-CN": "取消剩余", "en-US": "Cancel the rest"},
    "dialog.collision.all": {"zh-CN": "对其余同名项都这样", "en-US": "Do this for the remaining collisions"},
    "feedback.dismiss": {"zh-CN": "关闭", "en-US": "Dismiss"},
    "feedback.running": {"zh-CN": "正在{action} {count} 项…", "en-US": "{action}: {count} items in progress…"},
    "feedback.notice.editorMissing": {"zh-CN": "编辑器尚未接入，不能打开 {address}", "en-US": "The editor is not available yet; cannot open {address}"},
    "feedback.notice.openFailed": {"zh-CN": "打开 {address} 失败：{reason}", "en-US": "Could not open {address}: {reason}"},
    "feedback.notice.failed": {"zh-CN": "{action}没有完成（{address}）：{reason}", "en-US": "{action} failed ({address}): {reason}"},
    "feedback.manifestNotUpdated": {"zh-CN": "{action}已完成，但清单 {path} 没有更新：{reason}", "en-US": "{action} done, but the manifest {path} was not updated: {reason}"},
    "feedback.unknown.title": {"zh-CN": "{action} {count} 项的结果未知。在放弃之前，复制、剪切、粘贴、拖动与删除都不可用。", "en-US": "The outcome of {action} for {count} items is unknown. Copy, cut, paste, drag and delete are unavailable until you dismiss it."},
    "feedback.unknown.hint": {"zh-CN": "放弃不会取消可能仍在后台执行的操作，剪贴板里的这批项也会清掉。", "en-US": "Dismissing does not cancel an operation that may still be running; these clipboard items are cleared too."},
    "feedback.unknown.recheck": {"zh-CN": "重新列出", "en-US": "Refresh"},
    "feedback.unknown.abandon": {"zh-CN": "放弃", "en-US": "Dismiss"},
    "feedback.report.title": {"zh-CN": "{action}：{done} 项完成，{other} 项没有完成", "en-US": "{action}: {done} done, {other} not done"},
    "feedback.report.truncated": {"zh-CN": "结果已省略，请重新列出核对", "en-US": "Results were omitted; refresh to check"},
    "feedback.item.done": {"zh-CN": "完成", "en-US": "done"},
    "feedback.item.failed": {"zh-CN": "失败：{reason}", "en-US": "failed: {reason}"},
    "feedback.item.skipped": {"zh-CN": "跳过（与其它项重复）", "en-US": "skipped (duplicate)"},
    "feedback.item.notRun": {"zh-CN": "未执行", "en-US": "not run"},
    "feedback.item.cancelled": {"zh-CN": "已取消", "en-US": "cancelled"},
    "feedback.item.removed": {"zh-CN": "已删除：{paths}", "en-US": "removed: {paths}"},
    "feedback.item.residual": {"zh-CN": "残留：{paths}", "en-US": "left behind: {paths}"},
    "feedback.item.omitted": {"zh-CN": "（路径已省略）", "en-US": "(paths omitted)"},
    "feedback.item.declinedSkip": {"zh-CN": "跳过（同名）", "en-US": "skipped (name exists)"},
    "feedback.item.declinedCancel": {"zh-CN": "未执行（已取消剩余）", "en-US": "not run (rest cancelled)"},
    "actions.create": {"zh-CN": "新建", "en-US": "Create"},
    "actions.rename": {"zh-CN": "重命名", "en-US": "Rename"},
    "actions.delete": {"zh-CN": "删除", "en-US": "Delete"},
    "actions.create-content": {"zh-CN": "创建内容", "en-US": "Create content"},
    "actions.convert": {"zh-CN": "转换", "en-US": "Convert"},
    "actions.display": {"zh-CN": "修改展示名", "en-US": "Edit display name"},
    "actions.include": {"zh-CN": "加入清单", "en-US": "Add to manifest"},
    "actions.drop": {"zh-CN": "从清单移除", "en-US": "Remove from manifest"},
    "actions.reorder": {"zh-CN": "调整顺序", "en-US": "Reorder"},
    "actions.copy": {"zh-CN": "复制", "en-US": "Copy"},
    "actions.cut": {"zh-CN": "剪切", "en-US": "Cut"},
    "actions.move": {"zh-CN": "移动", "en-US": "Move"},
    "reasons.conflict": {"zh-CN": "已存在同名项", "en-US": "an item with that name already exists"},
    "reasons.source-changed": {"zh-CN": "源已被替换或移走，请重新选择", "en-US": "the source was replaced or moved; select it again"},
    "reasons.permission-denied": {"zh-CN": "没有权限", "en-US": "permission denied"},
    "reasons.busy": {"zh-CN": "另一个文件操作正在进行，请稍后重试", "en-US": "another file operation is in progress; try again later"},
    "reasons.not-found": {"zh-CN": "不存在", "en-US": "not found"},
    "reasons.unknown-outcome": {"zh-CN": "结果未知，请重新列出核对", "en-US": "the outcome is unknown; refresh to check"},
    "reasons.document-unsettled": {"zh-CN": "打开的文档有未裁决的输入、写不回的修改或磁盘冲突，先在编辑器里处理", "en-US": "an open document has unresolved input, changes that cannot be written back, or a disk conflict; resolve it in the editor first"},
    "nameErrors.empty": {"zh-CN": "名字不能为空", "en-US": "The name cannot be empty"},
    "nameErrors.invalid": {"zh-CN": "名字不能含 / 或 \\，也不能是 . 或 ..", "en-US": "The name cannot contain / or \\, or be . or .."},
    "nameErrors.unsettled": {"zh-CN": "{documents} 有未裁决的输入、写不回的修改或磁盘冲突，先在编辑器里处理", "en-US": "{documents} has unresolved input, changes that cannot be written back, or a disk conflict; resolve it in the editor first"},
    "unavailable.noTarget": {"zh-CN": "没有可以新建的位置：先选中一个目录", "en-US": "No place to create in: select a folder first"},
    "unavailable.noSelection": {"zh-CN": "没有选中可以操作的项", "en-US": "Nothing suitable is selected"},
    "unavailable.notApplicable": {"zh-CN": "这个动作不适用于选中的项", "en-US": "This action does not apply to the selection"},
    "unavailable.busy": {"zh-CN": "另一个批量操作还在进行", "en-US": "Another batch operation is still running"},
    "unavailable.notReady": {"zh-CN": "资源管理器尚未打开", "en-US": "The explorer is not open yet"},
    "unavailable.unknown": {"zh-CN": "上一次批量操作的结果未知：先核对，再在结果区放弃它", "en-US": "The last batch outcome is unknown: check it, then dismiss it in the results area"},
    "unavailable.emptyClipboard": {"zh-CN": "剪贴板是空的", "en-US": "The clipboard is empty"},
    "unavailable.crossRoot": {"zh-CN": "不能在项目与用户资产之间复制或移动", "en-US": "Cannot copy or move between the project and user assets"},
    "unavailable.copyFailed": {"zh-CN": "没能复制路径", "en-US": "Could not copy the path"},
    "unavailable.notVisible": {"zh-CN": "资源管理器没有显示", "en-US": "The explorer is not visible"},
    "unavailable.staleView": {"zh-CN": "资源管理器视图已重建", "en-US": "The explorer view was recreated"},
};

/**
 * 数量键英文的单数形（`_one`）：旧英文不分单复数（`{count} items`），迁移时两形抄成一样；w00028 t03 审查第 9 条改成正确的
 * 单数，这里逐字列出。单复数写法本来就相同的键英文只写不带后缀的键，不在这里。
 */
const ENGLISH_ONE: Readonly<Record<string, string>> = {
    "feedback.running_one": "{action}: {count} item in progress…",
    "feedback.unknown.title_one": "The outcome of {action} for {count} item is unknown. Copy, cut, paste, drag and delete are unavailable until you dismiss it.",
    "dialog.delete.title_one": "Delete {count} item?",
    "tree.dragItems_one": "{count} item",
};

const CATALOGS = {"zh-CN": zhCN, "en-US": enUS} as const;

/** 复数形 `<键>_<类别>` 归到 `<键>`。 */
const baseKey = (key: string): string => key.replace(/_(?:zero|one|two|few|many|other)$/u, "");

describe("nbook.explorer 的目录", () => {
    it("每个键的文字与迁移前的字面量逐字相同（占位符从 {name} 换成 {{name}}），两边的键一一对应", () => {
        for (const [locale, catalog] of Object.entries(CATALOGS)) {
            const flat = flattenCatalog(catalog);
            expect({locale, keys: [...new Set(Object.keys(flat).map(baseKey))].sort()}).toEqual({locale, keys: Object.keys(LEGACY).sort()});
            for (const [key, value] of Object.entries(flat)) {
                const written = (locale === "en-US" ? ENGLISH_ONE[key] : undefined) ?? LEGACY[baseKey(key)]![locale as keyof typeof CATALOGS];
                const legacy = written.replace(/\{(\w+)\}/gu, "{{$1}}");
                expect({locale, key, value}).toEqual({locale, key, value: legacy});
            }
        }
    });

    it("数量键：中文有 _other，英文有 _one 与 _other", () => {
        const flatZh = Object.keys(flattenCatalog(zhCN));
        const flatEn = Object.keys(flattenCatalog(enUS));
        for (const key of ["feedback.running", "feedback.unknown.title", "dialog.delete.title", "tree.dragItems"]) {
            expect(flatZh.filter((candidate) => baseKey(candidate) === key)).toEqual([`${key}_other`]);
            expect(flatEn.filter((candidate) => baseKey(candidate) === key)).toEqual([`${key}_one`, `${key}_other`]);
        }
    });

    it("文字引用的命名空间就是插件 id", () => {
        expect(explorerText("commands.category").ns).toBe(descriptor.id);
    });
});
