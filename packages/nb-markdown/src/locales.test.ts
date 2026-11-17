/**
 * nb-markdown 自带的目录（docs/specs/ui/i18n.md 的“目录与键”）。
 *
 * 防止迁移改错文字：`LEGACY` 是迁移前（提交 8cbf36165）代码里四张双语表的原样，按迁移后的键（表名加原来的键）抄下，占位符
 * 还是旧的 `{name}` 写法：小块的悬停提示（`chip/chip.ts` 的 `TEXT`）、图片（`display/MarkdownImage.vue` 的 `TEXT`）、HTML
 * 卡片的按钮（`display/static-views.ts` 的 `HTML_LABELS`）与提示词编辑器（`prompt/prompt-labels.ts` 的 `PROMPT_TEXT`）。
 * 目录里的每个键都要在表里、表里的每个键都要在目录里，值换成 `{{name}}` 后逐字相同；再经严格的最小实现按旧代码的参数
 * 翻译一遍，与旧代码代入的结果相同。以后有意改文字时，同一次改动里同步改这张表。
 *
 * 仓库的目录检查（`scripts/ci/message-catalogs.ts`）只查 JSON 目录，这份 `.ts` 目录的键与占位符一致性由这里核对。
 */

import {describe, expect, it} from "bun:test";

import {flattenCatalog} from "@notnotype/nb-ui/text";
import {createMinimalTranslator} from "@notnotype/nb-ui/text/minimal";

import {markdownRef, NB_MARKDOWN_CATALOGS, NB_MARKDOWN_NAMESPACE, NB_MARKDOWN_SOURCE_LOCALE} from "./locales";
import type {MarkdownTextKey} from "./locales";

type Legacy = Readonly<{"zh-CN": string; "en-US": string}>;

const LEGACY: Readonly<Record<string, Legacy>> = {
    // chip/chip.ts 的 TEXT
    "chip.reference": {"zh-CN": "引用：{label}", "en-US": "Reference: {label}"},
    "chip.skill": {"zh-CN": "Skill：{name}", "en-US": "Skill: {name}"},
    "chip.selection": {"zh-CN": "选区：{label}", "en-US": "Selection: {label}"},
    "chip.command": {"zh-CN": "命令：/{name}", "en-US": "Command: /{name}"},
    "chip.image": {"zh-CN": "图片 #{number}", "en-US": "Image #{number}"},
    "chip.file": {"zh-CN": "文件 #{number}：{name}", "en-US": "File #{number}: {name}"},
    "chip.paste": {"zh-CN": "粘贴的文本 #{number}", "en-US": "Pasted text #{number}"},
    "chip.uploading": {"zh-CN": "{label}，正在上传", "en-US": "{label}, uploading"},
    "chip.failed": {"zh-CN": "{label}，上传失败：{error}", "en-US": "{label}, upload failed: {error}"},
    // display/MarkdownImage.vue 的 TEXT
    "image.image": {"zh-CN": "图片", "en-US": "Image"},
    "image.none": {"zh-CN": "{name}（不显示）", "en-US": "{name} (not shown)"},
    "image.failed": {"zh-CN": "{name} 读不出", "en-US": "Cannot read {name}"},
    // display/static-views.ts 的 HTML_LABELS
    "htmlEmbed.render": {"zh-CN": "渲染", "en-US": "Render"},
    "htmlEmbed.viewSource": {"zh-CN": "查看源码", "en-US": "View Source"},
    "htmlEmbed.caption": {"zh-CN": "HTML", "en-US": "HTML"},
    // prompt/prompt-labels.ts 的 PROMPT_TEXT
    "prompt.menuLoading": {"zh-CN": "正在加载", "en-US": "Loading"},
    "prompt.menuEmpty": {"zh-CN": "没有匹配项", "en-US": "No matches"},
    "prompt.historyTitle": {"zh-CN": "输入历史", "en-US": "Input history"},
    "prompt.historySearch": {"zh-CN": "搜索已发送的内容", "en-US": "Search sent messages"},
    "prompt.historyEmpty": {"zh-CN": "没有已发送的内容", "en-US": "Nothing sent yet"},
    "prompt.historyNoMatch": {"zh-CN": "没有匹配的内容", "en-US": "No matching messages"},
    "prompt.tokenImage": {"zh-CN": "图片 #{number}", "en-US": "Image #{number}"},
    "prompt.tokenFile": {"zh-CN": "文件 #{number}：{name}", "en-US": "File #{number}: {name}"},
    "prompt.pasteTitle": {"zh-CN": "粘贴的文本", "en-US": "Pasted text"},
    "prompt.lines": {"zh-CN": "{count} 行", "en-US": "{count} lines"},
    "prompt.pasteExpand": {"zh-CN": "展开", "en-US": "Expand"},
    "prompt.pasteCollapse": {"zh-CN": "收起", "en-US": "Collapse"},
    "prompt.pasteToText": {"zh-CN": "转为文字", "en-US": "Convert to text"},
    "prompt.pasteRemove": {"zh-CN": "删除", "en-US": "Delete"},
    "prompt.pasteEdit": {"zh-CN": "编辑粘贴的文本 #{number}", "en-US": "Edit pasted text #{number}"},
    "prompt.pasteInvalidClose": {"zh-CN": "不能有恰好是 {tag} 的一行，这次修改没有生效", "en-US": "A line can't be exactly {tag}; this change wasn't applied"},
    "prompt.attachmentLabel": {"zh-CN": "附件", "en-US": "Attachments"},
    "prompt.attachmentRemove": {"zh-CN": "移除", "en-US": "Remove"},
    "prompt.attachmentRetry": {"zh-CN": "重试", "en-US": "Retry"},
    "prompt.attachmentUploading": {"zh-CN": "正在上传", "en-US": "Uploading"},
    "prompt.attachmentFailed": {"zh-CN": "上传失败：{error}", "en-US": "Upload failed: {error}"},
    // 属性面板（w00025 t10 新增）
    "properties.title": {"zh-CN": "属性", "en-US": "Properties"},
    "properties.summaryProblem": {"zh-CN": "YAML 有误", "en-US": "The YAML has an error"},
    "properties.source": {"zh-CN": "YAML 源码", "en-US": "YAML source"},
    "properties.add": {"zh-CN": "添加属性", "en-US": "Add property"},
    "properties.newName": {"zh-CN": "属性名", "en-US": "Property name"},
    "properties.rename": {"zh-CN": "属性名：{name}", "en-US": "Property name: {name}"},
    "properties.remove": {"zh-CN": "移除属性 {name}", "en-US": "Remove property {name}"},
    "properties.editSource": {"zh-CN": "在源码里改 {name}", "en-US": "Edit {name} in source"},
    "properties.duplicate": {"zh-CN": "已有同名属性", "en-US": "A property with this name exists"},
    "properties.kindMenu": {"zh-CN": "类型：{kind}", "en-US": "Type: {kind}"},
    "properties.yes": {"zh-CN": "是", "en-US": "Yes"},
    "properties.no": {"zh-CN": "否", "en-US": "No"},
    "properties.listSeparator": {"zh-CN": "、", "en-US": ", "},
    "properties.problemHint": {"zh-CN": "改好之前属性按源码显示。", "en-US": "Properties are shown as source until this is fixed."},
    "properties.fence": {"zh-CN": "不能有只写着 --- 的一行，它会让属性提前结束；这次修改没有写回。", "en-US": "A line can't be just ---, which would end the properties early; this change wasn't saved."},
    "properties.kinds.text": {"zh-CN": "文字", "en-US": "Text"},
    "properties.kinds.number": {"zh-CN": "数字", "en-US": "Number"},
    "properties.kinds.checkbox": {"zh-CN": "勾选", "en-US": "Checkbox"},
    "properties.kinds.date": {"zh-CN": "日期", "en-US": "Date"},
    "properties.kinds.list": {"zh-CN": "列表", "en-US": "List"},
    "properties.kinds.complex": {"zh-CN": "复杂的值", "en-US": "Complex value"},
    "properties.problem.syntax": {"zh-CN": "第 {line} 行：YAML 写法有误。", "en-US": "Line {line}: invalid YAML."},
    "properties.problem.duplicateKey": {"zh-CN": "第 {line} 行：属性名重复。", "en-US": "Line {line}: duplicate property name."},
    "properties.problem.notMapping": {"zh-CN": "第 {line} 行：顶层不是“名字: 值”的属性。", "en-US": "Line {line}: the top level isn't name: value properties."},
    "properties.problem.multipleDocuments": {"zh-CN": "第 {line} 行：有多个 YAML 文档。", "en-US": "Line {line}: more than one YAML document."},
    "properties.problem.documentMarker": {"zh-CN": "第 {line} 行：有 YAML 文档标记或指令。", "en-US": "Line {line}: YAML document marker or directive."},
    // 图片粘贴（w00025 t09 新增）
    "imagePaste.uploading": {"zh-CN": "正在上传 {count} 张图片", "en-US": "Uploading {count} image(s)"},
    "properties.problem.flowMapping": {"zh-CN": "第 {line} 行：属性写在一行的花括号里，不能按属性改。", "en-US": "Line {line}: properties inside braces on one line can't be edited as properties."},
};

const LOCALES = ["zh-CN", "en-US"] as const;

/** 旧代码的代入（`locale.ts` 的 `say`）：没有的占位原样留着。 */
const fill = (template: string, params: Readonly<Record<string, string | number>>): string => template.replace(/\{(\w+)\}/gu, (placeholder, name: string) => (name in params ? String(params[name]) : placeholder));

describe("nb-markdown 的目录", () => {
    it("每个键的文字与迁移前的字面量逐字相同（占位符从 {name} 换成 {{name}}），两边的键一一对应", () => {
        for (const locale of LOCALES) {
            const flat = flattenCatalog(NB_MARKDOWN_CATALOGS[locale] ?? {});
            expect({locale, keys: Object.keys(flat).sort()}).toEqual({locale, keys: Object.keys(LEGACY).sort()});
            for (const [key, value] of Object.entries(flat)) {
                expect({locale, key, value}).toEqual({locale, key, value: LEGACY[key]![locale].replace(/\{(\w+)\}/gu, "{{$1}}")});
            }
        }
    });

    it("按旧代码的参数翻译，与旧代码代入的结果相同：数量取 1、2 与 1000（不加千分位），参数里的标签原样", () => {
        const translator = createMinimalTranslator({catalogs: {[NB_MARKDOWN_NAMESPACE]: NB_MARKDOWN_CATALOGS}, strict: true});
        for (const locale of LOCALES) {
            for (const [key, legacy] of Object.entries(LEGACY)) {
                const names = [...legacy[locale].matchAll(/\{(\w+)\}/gu)].map((match) => match[1]!);
                const samples = names.includes("count")
                    ? [1, 2, 1000].map((count) => ({count}))
                    : [Object.fromEntries(names.map((name) => [name, name === "tag" ? "</paste>" : `<${name}>`]))];
                for (const params of samples) {
                    const translated = translator.translate(markdownRef(key as MarkdownTextKey, params), locale);
                    expect({locale, key, params, translated}).toEqual({locale, key, params, translated: fill(legacy[locale], params)});
                }
            }
        }
    });

    it("命名空间与源语言；引用带着命名空间", () => {
        expect([NB_MARKDOWN_NAMESPACE, NB_MARKDOWN_SOURCE_LOCALE]).toEqual(["nb-markdown", "zh-CN"]);
        expect(markdownRef("prompt.lines", {count: 3})).toEqual({kind: "text", ns: "nb-markdown", key: "prompt.lines", params: {count: 3}});
    });
});
