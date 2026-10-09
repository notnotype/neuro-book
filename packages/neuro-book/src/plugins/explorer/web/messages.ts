/** 资源管理器的文案：中英两份写在一起，按显示语言取一份。 */

import {localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

const MESSAGES = {
    title: {"zh-CN": "资源管理器", "en-US": "Explorer"},
    tree: {"zh-CN": "文件", "en-US": "Files"},
    projectRoot: {"zh-CN": "项目", "en-US": "Project"},
    userRoot: {"zh-CN": "用户资产", "en-US": "User Assets"},
    noProject: {"zh-CN": "尚未打开项目", "en-US": "No project open"},
    openProject: {"zh-CN": "打开项目", "en-US": "Open Project"},
    loading: {"zh-CN": "正在读取…", "en-US": "Loading…"},
    empty: {"zh-CN": "空目录", "en-US": "Empty folder"},
    readFailed: {"zh-CN": "读取失败：{reason}", "en-US": "Could not read: {reason}"},
    retry: {"zh-CN": "重试", "en-US": "Retry"},
    manifestUnreadable: {"zh-CN": "清单读不出，按普通文件夹显示：{reason}", "en-US": "Manifest unreadable, shown as a plain folder: {reason}"},
    manifestInvalid: {"zh-CN": "清单不合法，按普通文件夹显示：{reason}", "en-US": "Invalid manifest, shown as a plain folder: {reason}"},
    ended: {"zh-CN": "已停止同步：{reason}", "en-US": "Stopped syncing: {reason}"},
    reconnect: {"zh-CN": "重新连接", "en-US": "Reconnect"},
    missing: {"zh-CN": "缺失", "en-US": "Missing"},
    unlisted: {"zh-CN": "未列入", "en-US": "Not listed"},
    noBody: {"zh-CN": "无正文", "en-US": "No content"},
    needsPlot: {"zh-CN": "需要剧情插件", "en-US": "Needs the plot plugin"},
    newFile: {"zh-CN": "新建文件", "en-US": "New File"},
    newFolder: {"zh-CN": "新建文件夹", "en-US": "New Folder"},
    refresh: {"zh-CN": "刷新", "en-US": "Refresh"},
    collapseAll: {"zh-CN": "全部收起", "en-US": "Collapse All"},
    showManifests: {"zh-CN": "显示清单文件", "en-US": "Show Manifest Files"},
    editorMissing: {"zh-CN": "编辑器尚未接入，不能打开 {address}", "en-US": "The editor is not available yet; cannot open {address}"},
    openFailed: {"zh-CN": "打开 {address} 失败：{reason}", "en-US": "Could not open {address}: {reason}"},
    dismiss: {"zh-CN": "关闭", "en-US": "Dismiss"},
    prefsUnread: {"zh-CN": "资源管理器偏好未读取，正在用缺省值（{reason}）", "en-US": "Explorer preferences not loaded; using defaults ({reason})"},
    prefsProtected: {"zh-CN": "资源管理器偏好记录无法使用，修改不会保存（{reason}）", "en-US": "Explorer preferences record is unusable; changes will not be saved ({reason})"},
    prefsUnsaved: {"zh-CN": "展开与显示偏好未保存（{reason}）", "en-US": "Expansion and display preferences not saved ({reason})"},
    reload: {"zh-CN": "重新读取", "en-US": "Reload"},
    discard: {"zh-CN": "放弃", "en-US": "Discard"},
    notReady: {"zh-CN": "资源管理器尚未打开", "en-US": "The explorer is not open yet"},
    staleView: {"zh-CN": "资源管理器视图已重建", "en-US": "The explorer view was recreated"},
} satisfies Record<string, LocalizedText>;

export type ExplorerMessage = keyof typeof MESSAGES;

/** 取当前显示语言的文案并代入 `{name}` 占位。 */
export function explorerText(locale: DisplayLocale, key: ExplorerMessage, params: Readonly<Record<string, string | number>> = {}): string {
    return localize(MESSAGES[key], locale).replace(/\{(\w+)\}/gu, (placeholder, name: string) => (name in params ? String(params[name]) : placeholder));
}

/** 声明里用的中英两份（命令标题等）。 */
export function explorerLocalized(key: ExplorerMessage): LocalizedText {
    return MESSAGES[key];
}
