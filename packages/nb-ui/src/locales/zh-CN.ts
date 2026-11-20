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
    copyButton: {
        copy: "复制",
        copied: "已复制",
        failed: "复制失败，请手动选择文字",
    },
    detailDialog: {
        copy: "复制原文",
        close: "关闭",
        truncated: "原文过长，已截断",
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
    dateInput: {
        open: "选择日期",
        previousMonth: "上个月",
        nextMonth: "下个月",
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
    imagePreviewDialog: {
        close: "关闭",
        downloadOriginal: "下载原图",
        loading: "正在加载原图",
        loadFailed: "原图加载失败",
        retry: "重试",
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
        detail: "详情",
        detailTitle: "{{title}}：详情",
        region: "通知",
        folded: "还有 {{count}} 条较早的通知",
        collapse: "收起",
    },
    numberInput: {
        increase: "增加",
        decrease: "减少",
    },
    searchSelect: {
        empty: "没有匹配的选项",
        clear: "清除选择",
    },
    slider: {
        thumb: "滑块 {{index}}",
    },
    spinner: {
        loading: "加载中",
    },
    table: {
        empty: "暂无数据",
    },
    tabs: {
        more: "更多",
    },
    tagInput: {
        remove: "移除 {{item}}",
    },
    toolbar: {
        label: "工具栏",
    },
} satisfies Catalog;
