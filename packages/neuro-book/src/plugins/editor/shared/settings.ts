/**
 * 编辑器区的设置项与它们所在的设置分区（docs/specs/workbench/editor.md 输出 52）。声明是纯数据：设置项与 list 分区都写在
 * 插件描述的顶层。必填的标题省略，登记时补成约定键；可选的说明写文字引用（`shared/text.ts`）。
 */

import {Type} from "typebox";

import type {WrittenSettingsSectionDeclaration} from "nbook/plugins/settings/shared/sections";
import {defineSetting, defineSettings} from "nbook/shared/settings";

import {IMAGE_FOLDER_DEFAULT} from "./image-location";
import {editorText} from "./text";

export const EDITOR_SECTION = "nbook.editor";

export const EDITOR_SECTION_DECLARATION: WrittenSettingsSectionDeclaration = {
    description: editorText("settingsSections.nbook.editor.description"),
    icon: "i-lucide-square-pen",
    category: "app",
    order: 30,
    groups: [
        {id: "tabs"},
        {id: "saving"},
        {id: "images"},
        {id: "code"},
    ],
};

/** 预览标签页：关掉时单击打开也是常驻标签，已有的 preview 标签立即转正。 */
export const enablePreviewSetting = defineSetting({
    plugin: "nbook.editor",
    name: "enablePreview",
    schema: Type.Boolean(),
    default: true,
    description: editorText("settings.enablePreview.description"),
    section: EDITOR_SECTION,
    group: "tabs",
    order: 10,
});

/** 多行标签：放不下时换行，固定标签单独一行；关掉时一行横向滚动。 */
export const wrapTabsSetting = defineSetting({
    plugin: "nbook.editor",
    name: "wrapTabs",
    schema: Type.Boolean(),
    default: true,
    description: editorText("settings.wrapTabs.description"),
    section: EDITOR_SECTION,
    group: "tabs",
    order: 20,
});

/** 面包屑：标签栏下面的路径与 Markdown 的标题。 */
export const breadcrumbsSetting = defineSetting({
    plugin: "nbook.editor",
    name: "breadcrumbs",
    schema: Type.Boolean(),
    default: true,
    description: editorText("settings.breadcrumbs.description"),
    section: EDITOR_SECTION,
    group: "tabs",
    order: 30,
});

/** Markdown 编辑器的固定工具栏（docs/specs/workbench/markdown-editing.md 输出 4）。 */
export const markdownToolbarSetting = defineSetting({
    plugin: "nbook.editor",
    name: "markdownToolbar",
    schema: Type.Boolean(),
    default: true,
    description: editorText("settings.markdownToolbar.description"),
    section: EDITOR_SECTION,
    group: "tabs",
    order: 40,
});

/** 固定工具栏的位置（docs/specs/workbench/markdown-editing.md 输出 2）。 */
export const markdownToolbarPlacementSetting = defineSetting({
    plugin: "nbook.editor",
    name: "markdownToolbarPlacement",
    schema: Type.Union([Type.Literal("full"), Type.Literal("merged"), Type.Literal("bottom")]),
    default: "full",
    description: editorText("settings.markdownToolbarPlacement.description"),
    section: EDITOR_SECTION,
    group: "tabs",
    order: 45,
    choices: [
        {value: "full"},
        {value: "merged"},
        {value: "bottom"},
    ],
});

/** 自动保存的模式（docs/specs/workbench/editor.md 输出 63）；取值与 VS Code 的 `files.autoSave` 相同。 */
export const autoSaveSetting = defineSetting({
    plugin: "nbook.editor",
    name: "autoSave",
    schema: Type.Union([Type.Literal("off"), Type.Literal("afterDelay"), Type.Literal("onFocusChange"), Type.Literal("onWindowChange")]),
    default: "onFocusChange",
    description: editorText("settings.autoSave.description"),
    section: EDITOR_SECTION,
    group: "saving",
    order: 10,
    choices: [
        {value: "off"},
        {value: "afterDelay"},
        {value: "onFocusChange"},
        {value: "onWindowChange"},
    ],
});

/** “停手后”的延迟。下限 100 毫秒：再短就是每次交出输入都写盘。 */
export const autoSaveDelaySetting = defineSetting({
    plugin: "nbook.editor",
    name: "autoSaveDelay",
    schema: Type.Integer({minimum: 100, maximum: 600000}),
    default: 1000,
    description: editorText("settings.autoSaveDelay.description"),
    section: EDITOR_SECTION,
    group: "saving",
    order: 20,
    ui: {unit: editorText("settings.autoSaveDelay.unit")},
});

/** 粘贴与上传的图片存进哪个目录（docs/specs/workbench/markdown-editing.md 输出 56）：合成规则在 `image-location.ts`。 */
export const imageLocationSetting = defineSetting({
    plugin: "nbook.editor",
    name: "imageLocation",
    schema: Type.Union([Type.Literal("folder"), Type.Literal("root"), Type.Literal("same"), Type.Literal("sibling")]),
    default: "folder",
    description: editorText("settings.imageLocation.description"),
    section: EDITOR_SECTION,
    group: "images",
    order: 10,
    choices: [
        {value: "folder"},
        {value: "root"},
        {value: "same"},
        {value: "sibling"},
    ],
});

/**
 * 存放目录的名字：`folder` 时是作品根下的目录，`sibling` 时是当前文件所在目录下的子目录。设置窗口里不检查它合不合规
 * （schema 只限长度与控制字符），用到时由 `normalizeImageFolder` 判断，不合规按缺省。
 */
export const imageFolderSetting = defineSetting({
    plugin: "nbook.editor",
    name: "imageFolder",
    schema: Type.String({maxLength: 200, pattern: "^[^\\u0000-\\u001f\\u007f]*$"}),
    default: IMAGE_FOLDER_DEFAULT,
    description: editorText("settings.imageFolder.description"),
    section: EDITOR_SECTION,
    group: "images",
    order: 20,
});

/**
 * 源码编辑器（Monaco）的排版（settings-window 的“代码编辑器”小组）。Markdown 正文的排版不在这里。改动立即生效：编辑器
 * 不重建，缩进两项同时用到已打开的文件。
 */
export const {settings: codeSettings, contributions: codeSettingContributions} = defineSettings("nbook.editor", {
    "code.fontFamily": {
        schema: Type.String({maxLength: 200}),
        default: "",
        description: editorText("settings.code.fontFamily.description"),
        section: EDITOR_SECTION, group: "code", order: 10,
    },
    "code.fontSize": {
        schema: Type.Integer({minimum: 8, maximum: 40}),
        default: 14,
        section: EDITOR_SECTION, group: "code", order: 20,
        ui: {unit: editorText("settings.code.fontSize.unit")},
    },
    "code.lineHeight": {
        schema: Type.Number({minimum: 0, maximum: 100}),
        default: 0,
        description: editorText("settings.code.lineHeight.description"),
        section: EDITOR_SECTION, group: "code", order: 30,
    },
    "code.tabSize": {
        schema: Type.Integer({minimum: 1, maximum: 8}),
        default: 4,
        description: editorText("settings.code.tabSize.description"),
        section: EDITOR_SECTION, group: "code", order: 40,
    },
    "code.detectIndentation": {
        schema: Type.Boolean(),
        default: true,
        description: editorText("settings.code.detectIndentation.description"),
        section: EDITOR_SECTION, group: "code", order: 50,
    },
    "code.lineNumbers": {
        schema: Type.Union([Type.Literal("on"), Type.Literal("off"), Type.Literal("relative")]),
        default: "on",
        choices: [
            {value: "on"},
            {value: "off"},
            {value: "relative"},
        ],
        section: EDITOR_SECTION, group: "code", order: 60,
    },
    "code.minimap": {
        schema: Type.Boolean(),
        default: false,
        section: EDITOR_SECTION, group: "code", order: 70,
    },
    "code.wordWrap": {
        schema: Type.Boolean(),
        default: true,
        section: EDITOR_SECTION, group: "code", order: 80,
    },
});
