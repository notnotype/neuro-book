/**
 * 条目的种类（条目的 `type`，一段文字）。两件事放在这里：
 *
 * - 内置的几个词（`ENTRY_KINDS`）：引用字段的 `targets`、设定组的 `kinds` 都按这个词匹配，写在一处，改名时不会一处改了另一处没改；
 * - 贡献点 `canon.entry-kinds`（docs/specs/canon/author-ui.md 输入一节）：登记一个种类默认带哪几组设定、有哪几种有名字的预设。
 *   种类仍然只是条目上的一个词，世界里不存这张表；新建对话框、条目页的分页顺序与 Agent 的新建都经 `defaultComponents` 用默认组，
 *   加设定组与新建条目的勾选列表经 `kindPresets` 用预设。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import type {ContributionDescriptor, ContributionPointDefinition} from "@notnotype/nb-runtime/plugins";

export const ENTRY_KINDS = {person: "人物", organization: "组织", place: "地点", item: "物品"} as const;

export const CANON_ENTRY_KINDS_POINT = "canon.entry-kinds";

/** 一种有名字的预设：点一下勾上它的几组设定（加设定组与新建条目的勾选列表，author-ui 输出 4、38）。 */
export const EntryKindPresetSchema = Type.Object({
    /** 同一个种类里唯一（去掉首尾空白比）；别的插件写同一个 id 是往这个预设里追加设定组。 */
    id: Type.String({minLength: 1, pattern: "\\S"}),
    /** 显示名；几条登记都写了时取第一条（内置在前）。 */
    label: Type.Optional(Type.String({minLength: 1, pattern: "\\S"})),
    /** 这个预设勾上的设定组（类型 id）。 */
    components: Type.Array(Type.String({minLength: 1}), {minItems: 1}),
}, {additionalProperties: false});

export type EntryKindPresetDeclaration = Static<typeof EntryKindPresetSchema>;

export const EntryKindDeclarationSchema = Type.Object({
    /** 存进条目的那个词，例如“人物”。 */
    kind: Type.String({minLength: 1, pattern: "\\S"}),
    /** 新建这个种类的条目时默认带的设定组（类型 id）。 */
    components: Type.Optional(Type.Array(Type.String({minLength: 1}))),
    /** 新建对话框里的先后，小的在前。 */
    order: Type.Optional(Type.Number()),
    /** 这个种类的条目页标签的图标：lucide 的类名；几条登记都写了时取内置的那一条（workbench/editor.md 输出 53）。 */
    icon: Type.Optional(Type.String({minLength: 1, pattern: "^i-lucide-[a-z0-9-]+$"})),
    /** 这个种类的几种有名字的预设。 */
    presets: Type.Optional(Type.Array(EntryKindPresetSchema, {maxItems: 20})),
}, {additionalProperties: false});

export type EntryKindDeclaration = Static<typeof EntryKindDeclarationSchema>;

/** 只有顶层声明；贡献点在每个有本插件的实例里都定义（plugin-manifest.md 输出 11），新建对话框、Agent 工具与项目实例都读得到。 */
export const entryKindsPoint: ContributionPointDefinition<EntryKindDeclaration> = {
    id: CANON_ENTRY_KINDS_POINT,
    implementation: "none",
    idPrefix: "plugin",
    schema: EntryKindDeclarationSchema,
};

/** 一种预设并起来的样子：几条登记里同一个 id 的设定组并起来、去重，内置的在前；显示名取第一条写了的。 */
export interface EntryKindPreset {
    readonly id: string;
    readonly label?: string;
    /** 还没核对是否登记了。 */
    readonly components: readonly string[];
}

/** 一个种类并起来的登记。 */
export interface EntryKind {
    readonly kind: string;
    /** 默认带的设定组（类型 id），内置的在前、去重；还没核对是否登记了。 */
    readonly components: readonly string[];
    readonly order: number;
    readonly icon?: string;
    /** 有名字的预设，按第一次出现的先后（内置的在前，别的插件按贡献 id）。 */
    readonly presets: readonly EntryKindPreset[];
}

/** 内置登记的贡献 id 前缀（设定插件自己的，`plugin.ts` 的插件 id）。 */
const BUILTIN_PREFIX = "nbook.canon.";

/**
 * 同一个词的几条登记并成一条（别的插件可以给“人物”追加默认的设定组）：默认组先是内置的、再是别的插件的（按贡献 id，即
 * `declarations.list` 给的顺序：它按 id 排，第三方的 id 可能排在内置的前面，人物的默认不能因此跑到后面），并起来、去重；
 * `order` 取最小的，没写算最后。预设按同一个 id 并：设定组并起来、去重，显示名取第一条写了的。结果按 `order`、再按词排。
 */
export function mergeEntryKinds(descriptors: readonly Pick<ContributionDescriptor<EntryKindDeclaration>, "id" | "declaration">[]): readonly EntryKind[] {
    const merged = new Map<string, {components: string[]; order: number; icon?: string; presets: {id: string; label?: string; components: string[]}[]}>();
    for (const {declaration} of builtinFirst(descriptors)) {
        const kind = declaration.kind.trim();
        const order = declaration.order ?? Number.POSITIVE_INFINITY;
        let held = merged.get(kind);
        if (held === undefined) {
            held = {components: [], order, presets: []};
            merged.set(kind, held);
        }
        for (const type of declaration.components ?? []) if (!held.components.includes(type)) held.components.push(type);
        held.order = Math.min(held.order, order);
        held.icon ??= declaration.icon;
        for (const preset of declaration.presets ?? []) {
            const id = preset.id.trim();
            let target = held.presets.find((candidate) => candidate.id === id);
            if (target === undefined) {
                target = {id, components: []};
                held.presets.push(target);
            }
            target.label ??= preset.label;
            for (const type of preset.components) if (!target.components.includes(type)) target.components.push(type);
        }
    }
    return [...merged].map(([kind, held]) => ({
        kind,
        components: held.components,
        order: held.order,
        ...(held.icon === undefined ? {} : {icon: held.icon}),
        presets: held.presets.map((preset) => ({id: preset.id, ...(preset.label === undefined ? {} : {label: preset.label}), components: preset.components})),
    })).sort((a, b) => a.order - b.order || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
}

/** 内置的登记排在最前、别的照 `declarations.list` 给的顺序（按贡献 id）：并的时候内置的总在前。 */
function builtinFirst<T extends Pick<ContributionDescriptor<EntryKindDeclaration>, "id">>(descriptors: readonly T[]): readonly T[] {
    return [...descriptors].sort((a, b) => Number(!a.id.startsWith(BUILTIN_PREFIX)) - Number(!b.id.startsWith(BUILTIN_PREFIX)));
}

/**
 * 新建这个种类的条目时默认带的设定组：没登记的种类没有默认；默认里写到 `available` 之外（没登记、不可用）的类型当作没写，
 * 诊断由项目入口在登记变化时写（`missingDefaults`）。`kind` 按去掉首尾空白后的词比。
 */
export function defaultComponents(kinds: readonly EntryKind[], kind: string, available: ReadonlySet<string>): readonly string[] {
    const found = kinds.find((candidate) => candidate.kind === kind.trim());
    return found === undefined ? [] : found.components.filter((type) => available.has(type));
}

/**
 * 这个种类能用的预设（勾选列表顶上的一排，author-ui 输出 4、38）：写到 `available` 之外的类型当作没写；没有显示名、或一组能用的
 * 也没有的预设不给。诊断由项目入口写（`presetProblems`）。
 */
export function kindPresets(kinds: readonly EntryKind[], kind: string, available: ReadonlySet<string>): readonly {readonly id: string; readonly label: string; readonly components: readonly string[]}[] {
    const found = kinds.find((candidate) => candidate.kind === kind.trim());
    return (found?.presets ?? []).flatMap((preset) => {
        const components = preset.components.filter((type) => available.has(type));
        return preset.label === undefined || components.length === 0 ? [] : [{id: preset.id, label: preset.label, components}];
    });
}

/** 预设的问题，一项一条：写到不可用的类型、并完没有显示名、几条登记写了不同的显示名（后写的不用）。 */
export type PresetProblem =
    | {readonly kind: string; readonly preset: string; readonly problem: "missing-component"; readonly type: string}
    | {readonly kind: string; readonly preset: string; readonly problem: "no-label" | "label-conflict"};

export function presetProblems(descriptors: readonly Pick<ContributionDescriptor<EntryKindDeclaration>, "id" | "declaration">[], available: ReadonlySet<string>): readonly PresetProblem[] {
    const problems: PresetProblem[] = [];
    for (const entry of mergeEntryKinds(descriptors)) {
        for (const preset of entry.presets) {
            for (const type of preset.components) if (!available.has(type)) problems.push({kind: entry.kind, preset: preset.id, problem: "missing-component", type});
            if (preset.label === undefined) problems.push({kind: entry.kind, preset: preset.id, problem: "no-label"});
            const labels = new Set(builtinFirst(descriptors).filter(({declaration}) => declaration.kind.trim() === entry.kind).flatMap(({declaration}) => (declaration.presets ?? []).filter((candidate) => candidate.id.trim() === preset.id && candidate.label !== undefined).map((candidate) => candidate.label!)));
            if (labels.size > 1) problems.push({kind: entry.kind, preset: preset.id, problem: "label-conflict"});
        }
    }
    return problems;
}

/** 默认里写到、却不在 `available` 里的类型：`{kind, type}` 一项一条。 */
export function missingDefaults(kinds: readonly EntryKind[], available: ReadonlySet<string>): readonly {readonly kind: string; readonly type: string}[] {
    return kinds.flatMap((entry) => entry.components.filter((type) => !available.has(type)).map((type) => ({kind: entry.kind, type})));
}
