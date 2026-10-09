/**
 * 资源管理器的公开状态（docs/specs/workbench/files-explorer.md 的“新应用的插件、命令与界面”）：只有命令 `when` 要读的
 * 布尔键，不公开选择本身。
 */

import {definePublicState} from "nbook/shared/store/public";

export const explorerState = definePublicState("nbook.explorer", {
    ready: {type: "boolean", unready: false, reason: {"zh-CN": "资源管理器尚未打开", "en-US": "The explorer is not open yet"}},
    treeFocused: {type: "boolean", unready: false, reason: {"zh-CN": "焦点不在文件树上", "en-US": "The file tree is not focused"}},
});
