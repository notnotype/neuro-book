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
    /** 属性面板（`editor/properties/MarkdownProperties.vue`，docs/specs/workbench/markdown-editing.md 输出 39–51）。 */
    properties: {
        title: "属性",
        summaryProblem: "YAML 有误",
        source: "YAML 源码",
        add: "添加属性",
        newName: "属性名",
        rename: "属性名：{{name}}",
        remove: "移除属性 {{name}}",
        editSource: "在源码里改 {{name}}",
        duplicate: "已有同名属性",
        kindMenu: "类型：{{kind}}",
        yes: "是",
        no: "否",
        listSeparator: "、",
        problemHint: "改好之前属性按源码显示。",
        fence: "不能有只写着 --- 的一行，它会让属性提前结束；这次修改没有写回。",
        kinds: {
            text: "文字",
            number: "数字",
            checkbox: "勾选",
            date: "日期",
            list: "列表",
            complex: "复杂的值",
        },
        problem: {
            syntax: "第 {{line}} 行：YAML 写法有误。",
            duplicateKey: "第 {{line}} 行：属性名重复。",
            notMapping: "第 {{line}} 行：顶层不是“名字: 值”的属性。",
            multipleDocuments: "第 {{line}} 行：有多个 YAML 文档。",
            documentMarker: "第 {{line}} 行：有 YAML 文档标记或指令。",
            flowMapping: "第 {{line}} 行：属性写在一行的花括号里，不能按属性改。",
        },
    },
} satisfies Catalog;
