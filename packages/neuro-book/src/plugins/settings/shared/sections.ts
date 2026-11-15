/**
 * 设置窗口的三个贡献点的声明与登记校验（docs/specs/settings/settings-window.md“分区声明”“选项提供者”）：
 *
 * - `settings.sections`：list 分区，顶层声明式贡献，没有实现；三个位置都登记，所以校验函数只看声明，不看位置。
 * - `settings.pages`：page 分区，只接受浏览器入口的贡献；实现（`load()`）与页面上下文依赖 Vue，在 `web/contracts.ts`。
 * - `settings.choices`：动态选项的提供者，只接受浏览器入口的贡献；实现（`source()`）同样在 `web/contracts.ts`。
 *
 * 三个点上的 id 规则相同；同一 id 出现在两个分区点上由设置窗口查（内核只在一个点内去重）。
 */

import {Type} from "typebox";
import type {Static, TSchema} from "typebox";
import {Value} from "typebox/value";

import type {ContributionDescriptor} from "@notnotype/nb-runtime/plugins";

import {conventionCompleter} from "nbook/shared/convention-keys";
import type {Written} from "nbook/shared/convention-keys";
import {TextSchema} from "nbook/shared/text";
import {isSettingsGroupId, isSettingsSectionId, SETTINGS_ORDER_LIMIT, SETTINGS_SECTION_ID_MAX_LENGTH} from "nbook/shared/settings";

export const SETTINGS_SECTIONS_POINT = "settings.sections";
export const SETTINGS_PAGES_POINT = "settings.pages";
export const SETTINGS_CHOICES_POINT = "settings.choices";

/** `nbook.settings` 拥有的激活事件前缀：设置窗口显示一个 page 分区时触发 `onSettingsPage:<分区 id>`。 */
export const SETTINGS_PAGE_ACTIVATION_PREFIX = "onSettingsPage";

/** page 分区的贡献方入口写进 `activationEvents` 的事件：设置窗口显示这个分区时才激活入口。 */
export function settingsPageEvent(sectionId: string): string {
    return `${SETTINGS_PAGE_ACTIVATION_PREFIX}:${sectionId}`;
}

/** `nbook.settings` 拥有的激活事件前缀：设置窗口要一个提供者的选项时触发 `onSettingsChoices:<提供者 id>`。 */
export const SETTINGS_CHOICES_ACTIVATION_PREFIX = "onSettingsChoices";

/** 选项提供者的贡献方入口写进 `activationEvents` 的事件：设置窗口要它的选项时才激活入口。 */
export function settingsChoicesEvent(providerId: string): string {
    return `${SETTINGS_CHOICES_ACTIVATION_PREFIX}:${providerId}`;
}

/** 左栏的三组，自上而下：应用、AI、插件。 */
export const SETTINGS_SECTION_CATEGORIES = ["app", "ai", "plugins"] as const;

export type SettingsSectionCategory = (typeof SETTINGS_SECTION_CATEGORIES)[number];

const Layer = Type.Union([Type.Literal("user"), Type.Literal("project")]);

/** page 分区的 `keywords` 至多这么多个。 */
export const SETTINGS_PAGE_KEYWORDS_LIMIT = 20;

/** 两种分区共有的字段：左栏怎样列出它。 */
const heading = {
    title: TextSchema,
    description: Type.Optional(TextSchema),
    icon: Type.String({pattern: "\\S"}),
    category: Type.Union([Type.Literal("app"), Type.Literal("ai"), Type.Literal("plugins")]),
    order: Type.Optional(Type.Number({minimum: -SETTINGS_ORDER_LIMIT, maximum: SETTINGS_ORDER_LIMIT})),
    /**
     * 只在这种宿主里列出（settings-window.md 的“分区只在某种宿主里列出”）：`desktop` 是桌面壳的窗口。不在时这个分区与指向它的
     * 配置项都不列、不进搜索、不进“其它”。
     */
    host: Type.Optional(Type.Literal("desktop")),
};

export const SettingsSectionDeclarationSchema = Type.Object({
    ...heading,
    groups: Type.Optional(Type.Array(Type.Object({id: Type.String(), title: TextSchema}, {additionalProperties: false}))),
}, {additionalProperties: false});

export const SettingsPageDeclarationSchema = Type.Object({
    ...heading,
    layout: Type.Optional(Type.Union([Type.Literal("column"), Type.Literal("fill")])),
    layers: Type.Optional(Type.Array(Layer, {minItems: 1})),
    /** 设置内搜索时除标题与说明外还比对的词（settings-window.md 输出 21）。 */
    keywords: Type.Optional(Type.Array(TextSchema, {maxItems: SETTINGS_PAGE_KEYWORDS_LIMIT})),
}, {additionalProperties: false});

/** 选项提供者的声明没有字段：选项都由实现给出。 */
export const SettingsChoicesDeclarationSchema = Type.Object({}, {additionalProperties: false});

/** list 分区的声明（`settings.sections`）。 */
export type SettingsSectionDeclaration = Static<typeof SettingsSectionDeclarationSchema>;
/** page 分区的声明（`settings.pages`）。 */
export type SettingsPageDeclaration = Static<typeof SettingsPageDeclarationSchema>;
/** 作者写下的 list 分区声明：`title` 与小组的 `title` 可以省略，登记时补成约定键。 */
export type WrittenSettingsSectionDeclaration = Written<Omit<SettingsSectionDeclaration, "groups">, "title"> & {
    readonly groups?: ReadonlyArray<Written<NonNullable<SettingsSectionDeclaration["groups"]>[number], "title">>;
};
/** 作者写下的 page 分区声明：`title` 可以省略，登记时补成约定键。 */
export type WrittenSettingsPageDeclaration = Written<SettingsPageDeclaration, "title">;
/** 选项提供者的声明（`settings.choices`）。 */
export type SettingsChoicesDeclaration = Static<typeof SettingsChoicesDeclarationSchema>;

/**
 * list 分区的补全：没写 `title` 时补约定键 `settingsSections.<本地 id>.title`，小组没写 `title` 时补
 * `settingsSections.<本地 id>.groups.<小组 id>.title`（settings-window.md 的“约定键”）。
 */
export const completeSectionDeclaration = conventionCompleter({
    name: "settingsSections",
    fields: ["title"],
    lists: {groups: {segment: (group) => (typeof group.id === "string" ? group.id : null), fields: ["title"]}},
});

/** page 分区的补全：没写 `title` 时补约定键 `settingsPages.<本地 id>.title`。 */
export const completePageDeclaration = conventionCompleter({name: "settingsPages", fields: ["title"]});

/** id 的形状；前缀由内核按贡献点的 `idPrefix` 核对（同视图）。 */
function idProblem(descriptor: ContributionDescriptor, noun = "Section"): string | null {
    const id = descriptor.id;
    if (!isSettingsSectionId(id)) return `${noun} id must be dot-separated lowercase segments of at most ${String(SETTINGS_SECTION_ID_MAX_LENGTH)} characters: ${id}`;
    return null;
}

function shapeProblem(schema: TSchema, descriptor: ContributionDescriptor, noun = "Section"): string | null {
    if (Value.Check(schema, descriptor.declaration)) return null;
    const first = [...Value.Errors(schema, descriptor.declaration)][0];
    return `${noun} ${descriptor.id} has an invalid declaration: ${first === undefined ? "" : `${first.instancePath === "" ? "/" : first.instancePath}: ${first.message}`}`;
}

/** `settings.sections` 的登记校验：只看这一条声明本身；配置项指向的分区与小组存不存在不在这里核对。 */
export function validateSectionContribution(descriptor: ContributionDescriptor): string | null {
    const problem = idProblem(descriptor) ?? shapeProblem(SettingsSectionDeclarationSchema, descriptor);
    if (problem !== null) return problem;
    const ids = ((descriptor.declaration as SettingsSectionDeclaration).groups ?? []).map((group) => group.id);
    const malformed = ids.find((group) => !isSettingsGroupId(group));
    if (malformed !== undefined) return `Section ${descriptor.id} has a group id that is not a single lowercase segment: ${malformed}`;
    if (new Set(ids).size !== ids.length) return `Section ${descriptor.id} has duplicate group ids`;
    return null;
}

/** `settings.pages` 的登记校验：只接受浏览器入口的贡献。 */
export function validatePageContribution(descriptor: ContributionDescriptor): string | null {
    if (descriptor.location !== "browser") return `${SETTINGS_PAGES_POINT} only accepts contributions from browser entries`;
    const problem = idProblem(descriptor) ?? shapeProblem(SettingsPageDeclarationSchema, descriptor);
    if (problem !== null) return problem;
    const layers = (descriptor.declaration as SettingsPageDeclaration).layers;
    if (layers !== undefined && new Set(layers).size !== layers.length) return `Section ${descriptor.id} has duplicate layers`;
    return null;
}

/** `settings.choices` 的登记校验：只接受浏览器入口的贡献，id 规则同分区（声明里 `choices: {from}` 写的就是它）。 */
export function validateChoiceContribution(descriptor: ContributionDescriptor): string | null {
    if (descriptor.location !== "browser") return `${SETTINGS_CHOICES_POINT} only accepts contributions from browser entries`;
    return idProblem(descriptor, "Choice provider") ?? shapeProblem(SettingsChoicesDeclarationSchema, descriptor, "Choice provider");
}
