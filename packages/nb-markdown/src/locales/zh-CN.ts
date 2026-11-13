/**
 * nb-markdown 自带的中文目录（命名空间 `nb-markdown`，源语言），写法见同目录的 `index.ts`。引用的键类型从这份推出
 * （`MarkdownTextKey`）。
 *
 * `prompt.lines` 带 `count` 参数，但中英两份都只写不带后缀的键：迁移前的英文对任何数量都是“N lines”，写成复数形会让
 * 文字变样（`src/locales.test.ts` 核对）。i18next 与 nb-ui 的最小实现带 `count` 时找不到复数形都落到不带后缀的键。
 */

import type {Catalog} from "@notnotype/nb-ui/text";

export default {
    /** 行内小块的悬停提示（`chip/chip.ts`）。 */
    chip: {
        reference: "引用：{{label}}",
        skill: "Skill：{{name}}",
        selection: "选区：{{label}}",
        command: "命令：/{{name}}",
        image: "图片 #{{number}}",
        file: "文件 #{{number}}：{{name}}",
        paste: "粘贴的文本 #{{number}}",
        uploading: "{{label}}，正在上传",
        failed: "{{label}}，上传失败：{{error}}",
    },
    /** Markdown 里的图片（`display/MarkdownImage.vue`）。 */
    image: {
        image: "图片",
        none: "{{name}}（不显示）",
        failed: "{{name}} 读不出",
    },
    /** 展示器里可渲染 HTML 的源码卡片（`display/static-views.ts`）。 */
    htmlEmbed: {
        render: "渲染",
        viewSource: "查看源码",
        caption: "HTML",
    },
    /** PromptEditor 与 PromptTextView（docs/specs/ui/prompt-editor.md 输出 12）。 */
    prompt: {
        menuLoading: "正在加载",
        menuEmpty: "没有匹配项",
        historyTitle: "输入历史",
        historySearch: "搜索已发送的内容",
        historyEmpty: "没有已发送的内容",
        historyNoMatch: "没有匹配的内容",
        tokenImage: "图片 #{{number}}",
        tokenFile: "文件 #{{number}}：{{name}}",
        pasteTitle: "粘贴的文本",
        lines: "{{count}} 行",
        pasteExpand: "展开",
        pasteCollapse: "收起",
        pasteToText: "转为文字",
        pasteRemove: "删除",
        pasteEdit: "编辑粘贴的文本 #{{number}}",
        pasteInvalidClose: "不能有恰好是 {{tag}} 的一行，这次修改没有生效",
        attachmentLabel: "附件",
        attachmentRemove: "移除",
        attachmentRetry: "重试",
        attachmentUploading: "正在上传",
        attachmentFailed: "上传失败：{{error}}",
    },
} satisfies Catalog;
