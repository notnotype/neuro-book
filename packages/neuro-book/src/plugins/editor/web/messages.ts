/**
 * 编辑器区的界面文字：中英两份，显示时按当前语言取。
 */

import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

const TEXT = {
    areaLabel: {"zh-CN": "编辑器", "en-US": "Editor"},
    tabsLabel: {"zh-CN": "打开的编辑器", "en-US": "Open editors"},
    close: {"zh-CN": "关闭", "en-US": "Close"},
    closeTab: {"zh-CN": "关闭 {name}", "en-US": "Close {name}"},
    unsaved: {"zh-CN": "未保存", "en-US": "Unsaved"},
    preview: {"zh-CN": "预览", "en-US": "Preview"},
    empty: {"zh-CN": "在资源管理器里打开一个文件", "en-US": "Open a file from the explorer"},
    loading: {"zh-CN": "正在读取…", "en-US": "Reading…"},
    openFailed: {"zh-CN": "打不开 {name}：{reason}", "en-US": "Cannot open {name}: {reason}"},
    retry: {"zh-CN": "重试", "en-US": "Retry"},
    conflict: {"zh-CN": "磁盘上的文件已被修改，保存没有写入。", "en-US": "The file changed on disk; the save was not written."},
    reload: {"zh-CN": "重新载入磁盘版本", "en-US": "Reload Disk Version"},
    overwrite: {"zh-CN": "覆盖磁盘版本", "en-US": "Overwrite Disk Version"},
    diskChanged: {"zh-CN": "磁盘上的文件已被修改；保存会得到冲突。", "en-US": "The file changed on disk; saving will conflict."},
    unresolved: {"zh-CN": "另一个视图同时改了这份文档，这里的输入还没有进入正文。", "en-US": "Another view edited this document at the same time; this view's input has not been applied."},
    adopt: {"zh-CN": "采用当前正文", "en-US": "Use Current Text"},
    keep: {"zh-CN": "保留本视图的内容", "en-US": "Keep This View's Text"},
    deleted: {"zh-CN": "文件已被删除。保存会在原位置重新创建它。", "en-US": "The file was deleted. Saving recreates it at the same place."},
    deletedClean: {"zh-CN": "文件已被删除。", "en-US": "The file was deleted."},
    ended: {"zh-CN": "文件服务已结束（{reason}），不能保存。", "en-US": "The file service ended ({reason}); saving is not possible."},
    saveFailed: {"zh-CN": "保存失败：{reason}", "en-US": "Save failed: {reason}"},
    saveUnknown: {"zh-CN": "保存的结果未知，正在核对磁盘。", "en-US": "The save outcome is unknown; checking the disk."},
    dismiss: {"zh-CN": "关闭提示", "en-US": "Dismiss"},
    closeTitle: {"zh-CN": "保存对 {name} 的修改？", "en-US": "Save changes to {name}?"},
    closeBody: {"zh-CN": "不保存的话，修改会丢失。", "en-US": "Your changes will be lost if you don't save them."},
    save: {"zh-CN": "保存", "en-US": "Save"},
    discard: {"zh-CN": "不保存", "en-US": "Don't Save"},
    cancel: {"zh-CN": "取消", "en-US": "Cancel"},
} satisfies Record<string, LocalizedText>;

export type EditorMessage = keyof typeof TEXT;

export function editorText(locale: DisplayLocale, key: EditorMessage, values: Readonly<Record<string, string | number>> = {}): string {
    return localize(formatText(TEXT[key], values), locale);
}

/** 地址的最后一段：标签与提示里的文件名。 */
export function nameOf(address: string): string {
    const path = address.replace(/^[a-z]+:\/\//u, "");
    return path.slice(path.lastIndexOf("/") + 1) || address;
}
