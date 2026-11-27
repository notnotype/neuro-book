/**
 * 贡献点 `canon.components`（docs/specs/canon/components.md 输入与前置条件、输出 1）：贡献 id 是类型 id
 * （`<插件 id>.<名>`，由 `idPrefix` 核对），声明是除 id 以外的部分。声明只看它自己（内核的单条校验）：命名空间撞名
 * 要看全部登记，由接收方建登记表时判断（输出 2）。
 */

import type {ContributionDescriptor, ContributionPointDefinition} from "@notnotype/nb-runtime/plugins";
import {buildRegistry} from "@notnotype/nb-canon/schema";
import type {ComponentDeclaration} from "@notnotype/nb-canon/schema";

import {ENTRY_KINDS} from "./entry-kinds";
import type {EntryKindDeclaration} from "./entry-kinds";

export const CANON_COMPONENTS_POINT = "canon.components";
/** 标注种类与诊断的贡献点（声明的校验在项目入口，`backend/points.ts`）；名字放在这里，插件的描述符引用它不带进后端代码。 */
export const CANON_MARKS_POINT = "canon.marks";
export const CANON_DIAGNOSTICS_POINT = "canon.diagnostics";

export type ComponentContribution = Omit<ComponentDeclaration, "id">;

/** 一条声明连同贡献 id 交给 nb-canon 的登记校验；不过时返回原因。 */
export function componentDeclarationProblem(contribution: ContributionDescriptor): string | null {
    const declaration = contribution.declaration;
    if (typeof declaration !== "object" || declaration === null || Array.isArray(declaration)) return `Component 类型 ${contribution.id} 的声明必须是对象`;
    if ("id" in declaration) return `Component 类型 ${contribution.id} 的声明里不写 id，id 就是贡献 id`;
    const [problem] = buildRegistry([{...(declaration as ComponentContribution), id: contribution.id}]).diagnostics;
    if (problem === undefined) return null;
    return problem.code === "component-declaration-invalid" ? `${problem.path}：${problem.message}` : problem.code;
}

export const componentsPoint: ContributionPointDefinition<ComponentContribution> = {
    id: CANON_COMPONENTS_POINT,
    implementation: "none",
    idPrefix: "plugin",
    validate: componentDeclarationProblem,
};

/** 内置人物的类型 id（别的插件的附加分页按它 `requires`）。 */
export const PERSON_COMPONENT = "nbook.canon.person";
/** 内置形象的类型 id（人物的界面读它的立绘）。 */
export const LOOK_COMPONENT = "nbook.canon.look";
export const PANEL_COMPONENT = "nbook.canon.panel";

/**
 * 内置的类型（w00039 t10 的清单第一期）：人物只放每本书都用得上的，长什么样单独成组，都允许作者在某个条目上再加自己的项。
 * 字段的 id 就是显示名。人物的 id 除“性格”外不沿用重整之前的（外观、状态、态度、身体、样子）：类型版本没有升，沿用的话
 * 旧数据里的值与补丁会按新的意思回来（例如旧的普通文字“状态”变成语义档的起点）。
 */
export const BUILTIN_COMPONENTS: readonly ComponentDeclaration[] = [
    {
        id: PERSON_COMPONENT,
        label: "人物",
        namespace: "character",
        version: 1,
        instanceFields: true,
        kinds: [ENTRY_KINDS.person],
        fields: [
            {id: "性别", label: "性别", kind: "text", suggestions: ["男", "女", "不明"]},
            {id: "年龄", label: "年龄", kind: "text"},
            {id: "身份", label: "身份", kind: "text"},
            {id: "所属", label: "所属", kind: "ref", targets: [ENTRY_KINDS.organization]},
            {id: "性格", label: "性格", kind: "text", retold: true},
            {id: "背景", label: "背景", kind: "text"},
            {id: "说话方式", label: "说话方式", kind: "text", retold: true},
            {id: "现在的状态", label: "现在的状态", kind: "text", precision: "semantic"},
            {id: "现在在哪", label: "现在在哪", kind: "ref", targets: [ENTRY_KINDS.place]},
            {id: "生死", label: "生死", kind: "text", suggestions: ["活着", "已故", "失踪"]},
        ],
        presets: ["种族", "生日", "身高", "喜好", "弱点", "动机", "初次登场"].map((name) => ({id: name, label: name, kind: "text"})),
    },
    {
        id: LOOK_COMPONENT,
        label: "形象",
        namespace: "look",
        version: 1,
        instanceFields: true,
        kinds: [ENTRY_KINDS.person],
        fields: [
            {id: "立绘", label: "立绘", kind: "image"},
            {id: "外貌", label: "外貌", kind: "text", retold: true},
            // 衣柜：一套一个元素，名字用元素自带的 `label`。
            {id: "服装", label: "服装", kind: "list", item: [{id: "样子", label: "样子", kind: "text"}, {id: "图片", label: "图片", kind: "image"}]},
            {id: "现在穿的", label: "现在穿的", kind: "text"},
        ],
    },
    {
        id: PANEL_COMPONENT,
        label: "数值",
        namespace: "panel",
        version: 1,
        instanceFields: true,
        kinds: [ENTRY_KINDS.person],
    },
];

/** 人物的“主要角色”预设的 id：别的插件往里追加设定组时写它。 */
export const PERSON_MAIN_PRESET = "main";

/**
 * 内置的四个种类（`canon.entry-kinds`，author-ui.md 输入一节）：新建人物默认带人物与形象；人物另有两种预设，“基本”同默认，
 * “主要角色”再加数值（剧情插件往它里面追加知情与态度，`plot/plugin.ts`）。组织、地点、物品现在没有默认的设定组与预设
 * （内置设定组清单的第三期补）。顶层声明，插件描述里登记。
 */
export const BUILTIN_ENTRY_KINDS: readonly {readonly id: string; readonly declaration: EntryKindDeclaration}[] = [
    {id: "nbook.canon.person", declaration: {kind: ENTRY_KINDS.person, components: [PERSON_COMPONENT, LOOK_COMPONENT], order: 0, icon: "i-lucide-user-round", presets: [
        {id: "basic", label: "基本", components: [PERSON_COMPONENT, LOOK_COMPONENT]},
        {id: PERSON_MAIN_PRESET, label: "主要角色", components: [PERSON_COMPONENT, LOOK_COMPONENT, PANEL_COMPONENT]},
    ]}},
    {id: "nbook.canon.organization", declaration: {kind: ENTRY_KINDS.organization, order: 1, icon: "i-lucide-building-2"}},
    {id: "nbook.canon.place", declaration: {kind: ENTRY_KINDS.place, order: 2, icon: "i-lucide-map-pin"}},
    {id: "nbook.canon.item", declaration: {kind: ENTRY_KINDS.item, order: 3, icon: "i-lucide-package"}},
];
