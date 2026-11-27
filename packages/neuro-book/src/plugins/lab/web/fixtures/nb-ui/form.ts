/**
 * nb-ui 表单类（`form/`）的场景。`DateInput` 的值是 `YYYY-MM-DD` 字符串，与别的字段一样受控。
 */

import type {
    CheckboxGroup,
    ColorSwatches,
    Checkbox,
    DateInput,
    Field,
    Input,
    NumberInput,
    SearchSelect,
    Select,
    TagInput,
    Textarea,
    RadioGroup,
    Slider,
    SelectOption,
} from "@notnotype/nb-ui/components";
import {h} from "vue";

import {Input as NbInput} from "@notnotype/nb-ui/components";

import type {LabFixture} from "../define";
import {defineSubjectFixture} from "../subject-fixture";
import {nbUiSubject} from "./shared";

/** 作品主题色的八档推荐色（与作品信息对话框一致）。 */
const BOOK_SWATCHES = ["#2f63a8", "#2e7d55", "#b8423a", "#c8692a", "#7351a8", "#1d8a8c", "#b08328", "#4a4f57"];

const GENRES = [
    {value: "mystery", label: "悬疑", description: "推理、犯罪与解谜"},
    {value: "fantasy", label: "奇幻", description: "架空世界与魔法体系"},
    {value: "romance", label: "言情"},
    {value: "scifi", label: "科幻", disabled: true},
];
const SELECT_OPTIONS = [
    {value: "zh-CN", label: "简体中文", iconClass: "i-lucide-languages"},
    {value: "en-US", label: "English"},
    {value: "ja-JP", label: "日本語", description: "尚未完整翻译", disabled: true},
];
/** 导出格式：长列表（超过五项时下拉按截半高度收起）与富选项（图标、说明、状态点、禁用项）。 */
/** 可搜索下拉的模型列表：带说明、有一项停用。 */
const MODEL_OPTIONS = [
    {value: "gpt", label: "GPT-5", description: "OpenAI"},
    {value: "claude-opus", label: "Claude Opus", description: "Anthropic"},
    {value: "claude-instant", label: "Claude Instant", description: "已下线", disabled: true},
    {value: "deepseek", label: "DeepSeek V4", description: "DeepSeek"},
    {value: "qwen", label: "Qwen 3 Max", description: "阿里云"},
];

const EXPORT_FORMATS = [
    {value: "docx", label: "Word 文档（.docx）", iconClass: "i-lucide-file-text", description: "保留标题层级与批注"},
    {value: "epub", label: "EPUB 电子书（.epub）", iconClass: "i-lucide-book-open", description: "按卷生成目录"},
    {value: "md", label: "Markdown（.md）", iconClass: "i-lucide-file-code"},
    {value: "txt", label: "纯文本（.txt）", iconClass: "i-lucide-file"},
    {value: "pdf", label: "PDF 文档（暂不可用）", iconClass: "i-lucide-file-x", disabled: true, description: "排版插件还没装"},
    {value: "html", label: "网页（.html）", iconClass: "i-lucide-globe"},
    {value: "odt", label: "OpenDocument（.odt）", iconClass: "i-lucide-file-text"},
    {value: "rtf", label: "富文本（.rtf）", iconClass: "i-lucide-file-type"},
    {value: "fb2", label: "FictionBook（.fb2）", iconClass: "i-lucide-book"},
    {value: "mobi", label: "Kindle（.mobi）", iconClass: "i-lucide-tablet"},
    {value: "json", label: "结构化数据（.json）", iconClass: "i-lucide-braces"},
    {value: "csv", label: "章节统计表（.csv）", iconClass: "i-lucide-table"},
    {value: "zip", label: "整本打包（.zip）", iconClass: "i-lucide-archive"},
    {value: "nbook", label: "NeuroBook 备份（.nbook）", iconClass: "i-lucide-save"},
];
const STATUS_OPTIONS: SelectOption[] = [
    {value: "draft", label: "草稿", tone: "warning", description: "还在写"},
    {value: "review", label: "待校对", tone: "info", description: "交给编辑"},
    {value: "done", label: "定稿", tone: "success", description: "不再改动"},
];

export const formFixtures: LabFixture[] = [
    defineSubjectFixture<typeof Input>({
        component: "Input",
        events: ["clear", "focus"],
        class: "w-full max-w-[360px]",
        slotPresets: {prefix: () => h("span", {class: "i-lucide-book-open shrink-0 text-[var(--text-muted)]", "aria-hidden": "true"})},
        scenes: [
            {id: "default", label: "默认", input: {props: {placeholder: "书名", size: "md"}, model: {modelValue: ""}}},
            {id: "search", label: "搜索、可清空", input: {props: {type: "search", placeholder: "搜组件名", iconClass: "i-lucide-search", clearable: true, size: "sm"}, model: {modelValue: "Tree"}}},
            {id: "password", label: "密码", input: {props: {type: "password", placeholder: "API Key"}, model: {modelValue: "sk-test"}}},
            {id: "readonly", label: "只读", input: {props: {readonly: true}, model: {modelValue: "/home/writer/works/长夜行"}}},
            {id: "disabled", label: "禁用", input: {props: {disabled: true, placeholder: "不可用"}, model: {modelValue: ""}}},
            {id: "prefix", label: "前缀插槽", input: {props: {placeholder: "书名"}, model: {modelValue: "长夜行"}, slots: {prefix: true}}},
            {id: "bare", label: "无外框（卡片里原地编辑）", input: {props: {variant: "bare", size: "sm", placeholder: "注音"}, model: {modelValue: "lín xī"}}},
        ],
        subject: nbUiSubject("Input"),
    }),
    defineSubjectFixture<typeof DateInput>({
        component: "DateInput",
        scenes: [
            {id: "default", label: "章节的故事时间", input: {props: {}, model: {modelValue: "2025-12-21"}}},
            {id: "empty", label: "没有日期", input: {props: {}, model: {modelValue: null}}},
            {id: "bare", label: "无外框（卡片里原地编辑）", input: {props: {variant: "bare", size: "sm"}, model: {modelValue: "2025-12-21"}}},
            {id: "readonly", label: "只读", input: {props: {readonly: true}, model: {modelValue: "2025-12-21"}}},
            {id: "disabled", label: "禁用", input: {props: {disabled: true}, model: {modelValue: "2025-12-21"}}},
            {id: "invalid", label: "出错", input: {props: {invalid: true}, model: {modelValue: "2025-12-21"}}},
        ],
        subject: nbUiSubject("DateInput"),
    }),
    defineSubjectFixture<typeof TagInput>({
        component: "TagInput",
        class: "w-full max-w-[360px]",
        scenes: [
            {id: "default", label: "这一章的地点", input: {props: {}, model: {modelValue: ["青石镇", "北山"]}}},
            {id: "empty", label: "没有项：占位", input: {props: {placeholder: "地点"}, model: {modelValue: []}}},
            {id: "wrap", label: "项多换行", input: {props: {}, model: {modelValue: ["青石镇", "北山", "渡口", "客栈二楼", "井台", "林家老宅", "沈舟的船"]}}},
            {id: "bare", label: "无外框（卡片里原地编辑）", input: {props: {variant: "bare", size: "sm"}, model: {modelValue: ["林雪", "沈舟"]}}},
            {id: "readonly", label: "只读", input: {props: {readonly: true}, model: {modelValue: ["青石镇", "北山"]}}},
            {id: "disabled", label: "禁用", input: {props: {disabled: true}, model: {modelValue: ["青石镇", "北山"]}}},
        ],
        subject: nbUiSubject("TagInput"),
    }),
    defineSubjectFixture<typeof NumberInput>({
        component: "NumberInput",
        events: ["submit"],
        class: "w-full max-w-[200px]",
        scenes: [
            {id: "default", label: "字数目标", input: {props: {min: "0", max: "20000", step: "500", title: "每日字数目标"}, model: {modelValue: "3000"}}},
            {id: "small", label: "小号", input: {props: {size: "sm", min: "1", max: "10"}, model: {modelValue: "3"}}},
            {id: "disabled", label: "禁用", input: {props: {disabled: true}, model: {modelValue: "12"}}},
        ],
        subject: nbUiSubject("NumberInput"),
    }),
    defineSubjectFixture<typeof Textarea>({
        component: "Textarea",
        class: "w-full max-w-[420px]",
        scenes: [
            {id: "default", label: "简介", input: {props: {placeholder: "一句话简介", rows: 4, maxlength: 200}, model: {modelValue: "港口城市终年大雾。巡夜人沈屿在灯塔熄灭的那一夜，捡到一封写给自己的信。"}}},
            {id: "empty", label: "空", input: {props: {placeholder: "一句话简介", rows: 3}, model: {modelValue: ""}}},
            {id: "readonly", label: "只读", input: {props: {readonly: true, rows: 2}, model: {modelValue: "只读的长文本。"}}},
            {id: "bare", label: "bare：放在已有外框的容器里原地编辑（批注卡片）", input: {props: {variant: "bare", rows: 2}, model: {modelValue: "这里节奏太快：读者还不知道两人的过去。"}}},
            {id: "autosize", label: "autosize：高度随内容增减，至多 maxRows 行再滚动", input: {props: {variant: "bare", autosize: true, rows: 1, maxRows: 4}, model: {modelValue: "第一行\n第二行\n第三行\n第四行\n第五行\n第六行"}}},
        ],
        subject: nbUiSubject("Textarea"),
    }),
    defineSubjectFixture<typeof Select>({
        component: "Select",
        events: ["focus"],
        class: "w-full max-w-[280px]",
        scenes: [
            {id: "default", label: "界面语言", input: {props: {options: SELECT_OPTIONS, placeholder: "选择语言"}, model: {modelValue: "zh-CN"}}},
            {id: "placeholder", label: "未选择", input: {props: {options: SELECT_OPTIONS, placeholder: "选择语言", size: "sm"}, model: {modelValue: ""}}},
            {id: "up", label: "向上展开", input: {props: {options: SELECT_OPTIONS, dropdownDirection: "up"}, model: {modelValue: "en-US"}}},
            {id: "disabled", label: "禁用", input: {props: {options: SELECT_OPTIONS, disabled: true}, model: {modelValue: "zh-CN"}}},
            {id: "readonly", label: "只读", input: {props: {options: SELECT_OPTIONS, readonly: true}, model: {modelValue: "zh-CN"}}},
            {id: "invalid", label: "出错", input: {props: {options: SELECT_OPTIONS, invalid: true, placeholder: "选择语言"}, model: {modelValue: ""}}},
            {id: "long", label: "长列表（14 项，截半收起）", input: {props: {options: EXPORT_FORMATS, placeholder: "导出格式", dropdownDirection: "down"}, model: {modelValue: "docx"}}},
            {id: "rich", label: "富选项：状态点与说明", input: {props: {options: STATUS_OPTIONS, placeholder: "章节状态"}, model: {modelValue: "review"}}},
        ],
        subject: nbUiSubject("Select"),
    }),
    defineSubjectFixture<typeof Checkbox>({
        component: "Checkbox",
        events: ["focus"],
        scenes: [
            {id: "checked", label: "已勾选", input: {props: {label: "显示清单文件", description: "内容文件夹里的 _manifest.json"}, model: {modelValue: true}}},
            {id: "unchecked", label: "未勾选", input: {props: {label: "显示隐藏文件"}, model: {modelValue: false}}},
            {id: "indeterminate", label: "部分", input: {props: {label: "全选本卷章节", indeterminate: true}, model: {modelValue: "indeterminate"}}},
            {id: "disabled", label: "禁用", input: {props: {label: "同步到云端", disabled: true}, model: {modelValue: false}}},
            {id: "readonly", label: "只读", input: {props: {label: "同步到云端", readonly: true}, model: {modelValue: true}}},
            {id: "invalid", label: "出错", input: {props: {label: "同意条款", invalid: true}, model: {modelValue: false}}},
            {id: "checked-invalid", label: "已勾选、出错", input: {props: {label: "同意条款", invalid: true}, model: {modelValue: true}}},
            {id: "no-label", label: "没有标签：显示勾选值", input: {props: {}, model: {modelValue: true}}},
        ],
        subject: nbUiSubject("Checkbox"),
    }),
    defineSubjectFixture<typeof SearchSelect>({
        component: "SearchSelect",
        class: "w-full max-w-[360px]",
        scenes: [
            {id: "default", label: "默认", input: {props: {options: MODEL_OPTIONS, placeholder: "选择模型"}, model: {modelValue: "claude-opus"}}},
            {id: "empty", label: "未选", input: {props: {options: MODEL_OPTIONS, placeholder: "选择模型", size: "sm"}, model: {modelValue: ""}}},
            {id: "long", label: "长列表（14 项）", input: {props: {options: EXPORT_FORMATS, placeholder: "导出格式"}, model: {modelValue: "docx"}}},
            {id: "readonly", label: "只读", input: {props: {options: MODEL_OPTIONS, readonly: true}, model: {modelValue: "gpt"}}},
            {id: "disabled", label: "禁用", input: {props: {options: MODEL_OPTIONS, disabled: true}, model: {modelValue: "gpt"}}},
            {id: "invalid", label: "出错", input: {props: {options: MODEL_OPTIONS, invalid: true, placeholder: "选择模型"}, model: {modelValue: ""}}},
            {id: "clearable", label: "可清空", input: {props: {options: MODEL_OPTIONS, clearable: true}, model: {modelValue: "claude-opus"}}},
            {
                id: "remote",
                label: "远程模式：当前值不在这一批结果里",
                input: {props: {filter: false, options: [{value: "e2", label: "星瑾", description: "人物"}, {value: "e3", label: "星辰议会", description: "组织"}], selectedLabel: "星瑕", clearable: true, placeholder: "找一个条目"}, model: {modelValue: "e1"}},
            },
        ],
        subject: nbUiSubject("SearchSelect"),
    }),
    defineSubjectFixture<typeof Field>({
        component: "Field",
        class: "w-full max-w-[360px]",
        slotPresets: {default: () => h(NbInput, {modelValue: "长夜行", placeholder: "书名"})},
        scenes: [
            {id: "default", label: "标签与说明", input: {props: {label: "书名", description: "显示在书架与标题栏", required: true}, slots: {default: true}}},
            {id: "error", label: "错误", input: {props: {label: "作品目录", description: "作品文件放在这里", error: "目录不存在或没有写入权限"}, slots: {default: true}}},
            // 没有说明的一对：控件是最后一个子元素，出错与否要量出同样的版面（`e2e/lab-nb-ui.e2e.ts`）。
            {id: "plain", label: "只有标签", input: {props: {label: "书名"}, slots: {default: true}}},
            {id: "plain-error", label: "只有标签、出错", input: {props: {label: "书名", error: "已有同名的书"}, slots: {default: true}}},
        ],
        subject: nbUiSubject("Field"),
    }),
    defineSubjectFixture<typeof CheckboxGroup>({
        component: "CheckboxGroup",
        scenes: [
            {id: "vertical", label: "纵向", input: {props: {options: GENRES, orientation: "vertical"}, model: {modelValue: ["mystery"]}}},
            {id: "horizontal", label: "横向", input: {props: {options: GENRES, orientation: "horizontal"}, model: {modelValue: ["mystery", "romance"]}}},
            {id: "disabled", label: "禁用", input: {props: {options: GENRES, disabled: true}, model: {modelValue: ["fantasy"]}}},
            {id: "readonly", label: "只读", input: {props: {options: GENRES, readonly: true}, model: {modelValue: ["mystery"]}}},
            {id: "invalid", label: "出错（含已勾选）", input: {props: {options: GENRES, invalid: true}, model: {modelValue: ["fantasy"]}}},
        ],
        subject: nbUiSubject("CheckboxGroup"),
    }),
    defineSubjectFixture<typeof RadioGroup>({
        component: "RadioGroup",
        scenes: [
            {id: "vertical", label: "纵向、带说明", input: {props: {options: GENRES, orientation: "vertical", size: "md"}, model: {modelValue: "fantasy"}}},
            {id: "horizontal", label: "横向小号", input: {props: {options: GENRES, orientation: "horizontal", size: "sm"}, model: {modelValue: "mystery"}}},
            {id: "disabled", label: "禁用", input: {props: {options: GENRES, disabled: true}, model: {modelValue: "romance"}}},
            {id: "readonly", label: "只读", input: {props: {options: GENRES, orientation: "horizontal", size: "sm", readonly: true}, model: {modelValue: "mystery"}}},
            {id: "invalid", label: "出错", input: {props: {options: GENRES, orientation: "horizontal", size: "sm", invalid: true}, model: {modelValue: ""}}},
        ],
        subject: nbUiSubject("RadioGroup"),
    }),
    defineSubjectFixture<typeof ColorSwatches>({
        component: "ColorSwatches",
        scenes: [
            {id: "book", label: "作品主题色：自动、八色、自定义（两行）", input: {props: {colors: BOOK_SWATCHES, autoLabel: "自动", autoColor: "#7351a8", customLabel: "自定义", columns: 5, label: "主题色"}, model: {modelValue: null}}},
            {id: "listed", label: "选中色板里的色", input: {props: {colors: BOOK_SWATCHES, autoLabel: "自动", customLabel: "自定义", columns: 5}, model: {modelValue: "#2e7d55"}}},
            {id: "custom", label: "自定义色", input: {props: {colors: BOOK_SWATCHES, autoLabel: "自动", customLabel: "自定义", columns: 5}, model: {modelValue: "#d4a017"}}},
            {id: "row-small", label: "一行、小号、无自动", input: {props: {colors: BOOK_SWATCHES, size: "sm"}, model: {modelValue: "#b8423a"}}},
            {id: "disabled", label: "禁用", input: {props: {colors: BOOK_SWATCHES, autoLabel: "自动", customLabel: "自定义", disabled: true}, model: {modelValue: "#2f63a8"}}},
        ],
        subject: nbUiSubject("ColorSwatches"),
    }),
    defineSubjectFixture<typeof Slider>({
        component: "Slider",
        events: ["valueCommit"],
        class: "w-full max-w-[320px]",
        scenes: [
            {id: "single", label: "单值", input: {props: {min: 0, max: 100, step: 1, ariaLabel: "缩放", size: "md"}, model: {modelValue: 60}}},
            {id: "range", label: "区间", input: {props: {min: 0, max: 50, step: 1, ariaLabel: "章节范围"}, model: {modelValue: [8, 24]}}},
            {id: "disabled", label: "禁用", input: {props: {disabled: true, size: "sm"}, model: {modelValue: 30}}},
        ],
        subject: nbUiSubject("Slider"),
    }),
];
