import type {ContextKeyTable} from "nbook/plugins/commands/shared/context-keys";

/**
 * Lab 命令场景的本地命令表认识的上下文键：编辑器的四个键与面板可见。产品命令表里这些键由各自的拥有者登记
 * （编辑器插件、工作台），见 workbench.commands 的上下文键一节。
 */
export const LAB_CONTEXT_KEYS: ContextKeyTable = {
    "editor-focus": "需要编辑区焦点",
    "editor-active": "需要活动编辑器",
    "editor-writable": "当前编辑器不可写",
    "editor-line-navigation": "当前编辑器不支持行号跳转",
    "quick-open-visible": "需要打开命令面板",
};
