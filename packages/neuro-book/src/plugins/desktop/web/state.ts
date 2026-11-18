/**
 * `nbook.desktop` 的公开状态：`inDesktop` 在浏览器里为 false、桌面里为 true（由 `plugin.ts` 的浏览器入口声明并赋值）。缩放命令与
 * 首次启动向导的命令拿它作 `when`；单独成文件，两个入口都引它而不互相引用。
 */

import {definePublicState} from "nbook/shared/store/public";

import {descriptor} from "../plugin";

export const desktopState = definePublicState(descriptor.id, {
    inDesktop: {type: "boolean", unready: false, reason: {"zh-CN": "只在 NeuroBook 桌面版里可用", "en-US": "Only available in the NeuroBook desktop app"}},
});
