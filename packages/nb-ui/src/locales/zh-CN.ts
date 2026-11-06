/**
 * nb-ui 自带的中文目录（命名空间 `nb-ui`，源语言）。组件里写死的中文默认文案在这里（w00028 t03 的 nb-ui 一片）；
 * 调用方显式传属性（`closeLabel` 等）时以属性为准，不经这份目录。
 * 键类型从这份推出（`NbUiTextKey`，`./index.ts`），组件经 `useUiText()` 取，写错键编译不过。
 */

import type {Catalog} from "../text";

export default {
    alertDialog: {
        title: "确认操作",
        confirm: "确定",
        cancel: "取消",
    },
    banner: {
        close: "关闭",
    },
    breadcrumb: {
        label: "面包屑导航",
    },
    codeBlock: {
        empty: "无内容",
        truncated: "只公开了部分内容",
    },
    diffView: {
        mode: "显示方式",
        inline: "行内",
        split: "两栏",
        unchanged: "没有改动",
        foldedLines: "展开 {{count}} 行没变的内容",
        foldedChars: "…（{{count}} 字）…",
    },
    colorPicker: {
        value: "颜色值",
        presets: "预设颜色",
    },
    colorSwatches: {
        label: "颜色",
    },
    dialog: {
        untitled: "对话框",
        cancel: "取消",
        confirm: "确认",
        close: "关闭",
    },
    drawer: {
        untitled: "面板",
        close: "关闭",
    },
    emptyState: {
        title: "暂无数据",
    },
    floatingWindow: {
        resizeWidth: "调整窗口宽度",
        resizeHeight: "调整窗口高度",
        resize: "调整窗口大小",
    },
    infoTip: {
        label: "说明",
    },
    input: {
        clear: "清空输入",
    },
    notification: {
        close: "关闭通知",
        inProgress: "进行中",
    },
    numberInput: {
        increase: "增加",
        decrease: "减少",
    },
    searchSelect: {
        empty: "没有匹配的选项",
    },
    slider: {
        thumb: "滑块 {{index}}",
    },
    spinner: {
        loading: "加载中",
    },
    splitter: {
        resizeWidth: "调整 {{before}} 与 {{after}} 的宽度",
        resizeHeight: "调整 {{before}} 与 {{after}} 的高度",
        collapsed: "已收起",
        pixels: "{{size}} 像素",
    },
    table: {
        empty: "暂无数据",
    },
    tabs: {
        more: "更多",
    },
    toolbar: {
        label: "工具栏",
    },
} satisfies Catalog;
