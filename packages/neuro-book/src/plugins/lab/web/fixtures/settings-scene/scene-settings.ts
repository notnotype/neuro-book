/**
 * 设置场景里示例插件的配置项、分区 id 与窗口的场景清单：“笔记”的项都没写分区（有一项指向不存在的分区），落到“其它”，
 * 覆盖通用列表的每种控件；“常用片段”“模型服务”的项指向自己的 page 分区，由页面画（“模型服务”是 page 分区用草稿、
 * 未保存保护与动态选项的样板）。单独放一个轻的模块：场景登记表在
 * Lab 启动时就加载，示例页面与场景数据也都引用它，场景数据本身要等选中场景才加载。
 */

import {Type} from "typebox";

import {defineSetting} from "nbook/shared/settings";
import {workbenchText} from "nbook/plugins/workbench/shared/text";

/**
 * 主题项在产品里的选项来自工作台的提供者（docs/specs/theme/skins.md），场景没有工作台的入口。这里给同一个键一份静态选项，
 * 窗口的层、覆盖与写入失败这些场景不靠它；下拉与动态选项由 `choices` 系列场景与 `e2e/settings.e2e.ts` 看。
 */
export const sceneThemeSetting = defineSetting({
    plugin: "nbook.workbench",
    name: "theme",
    schema: Type.Union([Type.Literal("nbook"), Type.Literal("macos")]),
    default: "nbook",
    description: workbenchText("settings.theme.description"),
    section: "nbook.appearance",
    group: "ui",
    order: 10,
    choices: [{value: "nbook", title: workbenchText("themes.nbook.title")}, {value: "macos", title: workbenchText("themes.macos.title")}],
});

export const SNIPPETS_SECTION = "example.snippets.main";
/** “笔记”的选项提供者：新笔记可以套用的模板。 */
export const TEMPLATES_PROVIDER = "example.notes.templates";
export const MODELS_SECTION = "example.models.main";

export const notesSettings = {
    autosave: defineSetting({plugin: "example.notes", name: "autosave", schema: Type.Boolean(), default: true, title: {"zh-CN": "自动保存草稿", "en-US": "Autosave Drafts"}, description: {"zh-CN": "离开输入框时把草稿存到本地", "en-US": "Keep drafts locally when leaving a field"}}),
    interval: defineSetting({plugin: "example.notes", name: "interval", schema: Type.Integer({minimum: 5, maximum: 600}), default: 30, title: {"zh-CN": "保存间隔（秒）", "en-US": "Save Interval (s)"}, applies: "next-session"}),
    signature: defineSetting({plugin: "example.notes", name: "signature", schema: Type.String({maxLength: 40}), default: "", title: {"zh-CN": "落款", "en-US": "Signature"}, description: {"zh-CN": "导出笔记时附在末尾", "en-US": "Appended when exporting notes"}}),
    sort: defineSetting({
        plugin: "example.notes",
        name: "sort",
        schema: Type.Union([Type.Literal("title"), Type.Literal("modified"), Type.Literal("created"), Type.Literal("words")]),
        default: "modified",
        title: {"zh-CN": "排序", "en-US": "Sort By"},
        choices: [
            {value: "title", title: {"zh-CN": "按标题", "en-US": "Title"}},
            {value: "modified", title: {"zh-CN": "按修改时间", "en-US": "Last Modified"}},
            {value: "created", title: {"zh-CN": "按创建时间", "en-US": "Created"}},
            {value: "words", title: {"zh-CN": "按字数", "en-US": "Word Count"}},
        ],
    }),
    tags: defineSetting({plugin: "example.notes", name: "tags", schema: Type.Array(Type.String({minLength: 1})), default: ["人物", "地点", "伏笔"], title: {"zh-CN": "常用标签", "en-US": "Frequent Tags"}, applies: "restart"}),
    // 排在“其它”的最前：动态选项的几个场景截图时这一行在可视区里。
    template: defineSetting({plugin: "example.notes", name: "template", schema: Type.String(), default: "", order: -1, title: {"zh-CN": "新笔记的模板", "en-US": "Template for New Notes"}, description: {"zh-CN": "选项来自模板库", "en-US": "Options come from the template library"}, choices: {from: TEMPLATES_PROVIDER}}),
    legacy: defineSetting({plugin: "example.notes", name: "legacy", schema: Type.Boolean(), default: false, title: {"zh-CN": "旧版目录结构", "en-US": "Legacy Layout"}, section: "example.missing"}),
};

/**
 * 只给 `SettingsRow` 的 Lab 场景用的项（没有分区，设置窗口的场景不收它们）：带生效时机的数字、只读的字符串，以及一个横排
 * 单选组很宽的选项，看窄行里控件换到标题下面。
 */
export const rowDemoSettings = {
    workers: defineSetting({plugin: "example.rows", name: "workers", schema: Type.Integer({minimum: 1, maximum: 8}), default: 2, title: {"zh-CN": "并发数", "en-US": "Workers"}, description: {"zh-CN": "同时抽取的章节数", "en-US": "Chapters extracted at once"}, applies: "restart"}),
    library: defineSetting({plugin: "example.rows", name: "library", schema: Type.String({readOnly: true}), default: "wugang-main", title: {"zh-CN": "书库", "en-US": "Library"}, description: {"zh-CN": "由作品决定", "en-US": "Decided by the book"}}),
    mode: defineSetting({
        plugin: "example.rows",
        name: "mode",
        schema: Type.Union([Type.Literal("chapter"), Type.Literal("volume"), Type.Literal("whole")]),
        default: "chapter",
        title: {"zh-CN": "抽取范围", "en-US": "Extraction Scope"},
        description: {"zh-CN": "一次交给模型多少内容", "en-US": "How much text goes to the model at once"},
        choices: [
            {value: "chapter", title: {"zh-CN": "逐章抽取并实时校对", "en-US": "Chapter by chapter, checked live"}, description: {"zh-CN": "最稳，也最慢", "en-US": "Safest, slowest"}},
            {value: "volume", title: {"zh-CN": "按卷抽取后统一校对", "en-US": "Volume by volume, checked after"}, description: {"zh-CN": "折中", "en-US": "A balance"}},
            {value: "whole", title: {"zh-CN": "整本一次抽取", "en-US": "The whole book at once"}, description: {"zh-CN": "最快，易丢细节", "en-US": "Fastest, may lose detail"}},
        ],
    }),
};

/** page 分区自己画的项：通用列表不画它们。 */
export const snippetsSettings = {
    items: defineSetting({
        plugin: "example.snippets",
        name: "items",
        schema: Type.Array(Type.Object({
            name: Type.String({"x-form": {label: {"zh-CN": "名字", "en-US": "Name"}}}),
            text: Type.String({"x-form": {label: {"zh-CN": "内容", "en-US": "Text"}}}),
        }, {additionalProperties: false})),
        default: [],
        ui: {itemLabel: "name"},
        title: {"zh-CN": "片段", "en-US": "Snippets"},
        description: {"zh-CN": "在编辑器里输入名字即可插入", "en-US": "Type the name in the editor to insert"},
        section: SNIPPETS_SECTION,
    }),
    autoInsert: defineSetting({plugin: "example.snippets", name: "autoInsert", schema: Type.Boolean(), default: false, title: {"zh-CN": "输入名字后自动插入", "en-US": "Insert on Name"}, section: SNIPPETS_SECTION}),
};

/** “模型服务”的选项提供者：已保存的服务商的模型，给“默认模型”用。 */
export const MODELS_PROVIDER = "example.models.models";

const text = (zh: string, en: string) => ({"zh-CN": zh, "en-US": en});

/** 一家服务商。API Key 是普通的字符串字段（凭据先不做加密，开发者 2026-10-20 定），控件提示写成密钥输入。 */
export const ProviderSchema = Type.Object({
    id: Type.String({minLength: 1, pattern: "^[a-z0-9-]+$", "x-form": {label: text("标识", "ID"), help: text("小写字母、数字与连字符，默认模型按它引用", "Lowercase letters, digits and hyphens; the default model refers to it")}}),
    name: Type.String({minLength: 1, "x-form": {label: text("名称", "Name")}}),
    baseUrl: Type.String({minLength: 1, "x-form": {label: text("接口地址", "Base URL"), placeholder: "https://api.example.com/v1"}}),
    timeout: Type.Integer({minimum: 1, maximum: 600, "x-form": {label: text("超时", "Timeout"), unit: text("秒", "s")}}),
    // 本地服务不用密钥，没有模型的服务商先存着：两项都可以不填。
    apiKey: Type.Optional(Type.String({"x-form": {label: text("API Key", "API Key"), widget: "secret"}})),
    models: Type.Optional(Type.Array(Type.String({minLength: 1}), {"x-form": {label: text("模型", "Models")}})),
}, {additionalProperties: false});

/**
 * 连接信息与凭据只允许用户层：项目层的文件在作品目录里，可能进 Git、给别人（configuration.md 作者规则）。page 分区的
 * `layers` 也只写 user。
 */
export const modelsSettings = {
    providers: defineSetting({
        plugin: "example.models",
        name: "providers",
        schema: Type.Array(ProviderSchema),
        default: [],
        title: text("服务商", "Providers"),
        layers: ["user"],
        section: MODELS_SECTION,
        ui: {itemLabel: "name"},
    }),
    defaultModel: defineSetting({
        plugin: "example.models",
        name: "defaultModel",
        schema: Type.String(),
        default: "",
        title: text("默认模型", "Default Model"),
        description: text("写作助手没有指定模型时用它", "Used when the assistant does not pick a model"),
        layers: ["user"],
        section: MODELS_SECTION,
        choices: {from: MODELS_PROVIDER},
    }),
    effort: defineSetting({
        plugin: "example.models",
        name: "effort",
        schema: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
        default: "medium",
        title: text("推理强度", "Reasoning Effort"),
        layers: ["user"],
        section: MODELS_SECTION,
        choices: [
            {value: "low", title: text("低", "Low")},
            {value: "medium", title: text("中", "Medium")},
            {value: "high", title: text("高", "High")},
        ],
    }),
};

/** 默认模型的值：`服务商标识/模型名`。 */
export function modelChoice(provider: string, model: string): string {
    return `${provider}/${model}`;
}

export type SettingsWindowSceneId =
    | "user" | "project" | "unbound" | "user-invalid" | "project-invalid" | "unreachable" | "write-failed" | "other"
    | "choices" | "choices-lazy" | "choices-unavailable" | "file" | "file-invalid"
    | "search" | "page-declared" | "page-blocked" | "page-failed" | "page-stopped" | "page-load-failed" | "page-column" | "page-fill" | "long-titles";

export const SETTINGS_WINDOW_SCENES: ReadonlyArray<{readonly id: SettingsWindowSceneId; readonly label: string}> = [
    {id: "user", label: "用户标签：已修改、被本作品覆盖"},
    {id: "project", label: "本作品标签：沿用（来自用户设置）、单独设置了、只能用户层的项"},
    {id: "unbound", label: "未绑定作品（没有标签）"},
    {id: "user-invalid", label: "用户层文件有错误"},
    {id: "project-invalid", label: "本作品层文件有错误（带路径）"},
    {id: "unreachable", label: "本作品层连不上"},
    {id: "write-failed", label: "写入失败（发通知、回到实际值）"},
    {id: "other", label: "“其它”分区：每种控件，含可编辑的字符串列表"},
    {id: "choices", label: "动态选项：提供者已交付，当前值已不在选项里"},
    {id: "choices-lazy", label: "动态选项：打开时才激活提供者（先显示加载中）"},
    {id: "choices-unavailable", label: "动态选项：提供者的入口激活失败"},
    {id: "file", label: "设置文件：整份编辑用户层的文件（带注释）"},
    {id: "file-invalid", label: "设置文件：层文件有错误（标题区写出错位置，光标在出错处）"},
    {id: "search", label: "搜索结果：“分区名 › 小组名”的组标题、命中标底色、最后的“页面”组"},
    {id: "page-declared", label: "page 分区：入口还在启动"},
    {id: "page-blocked", label: "page 分区：入口受阻"},
    {id: "page-failed", label: "page 分区：入口激活失败（可重试）"},
    {id: "page-stopped", label: "page 分区：已撤回"},
    {id: "page-load-failed", label: "page 分区：加载失败（可重新加载）"},
    {id: "page-column", label: "page 分区：column 页面"},
    {id: "page-fill", label: "page 分区：fill 页面"},
    {id: "long-titles", label: "左栏长标题：中英文各一个被截断的分区，悬停显示全名"},
];
