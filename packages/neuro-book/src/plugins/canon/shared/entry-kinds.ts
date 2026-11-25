/**
 * 条目的种类（条目的 `type`，一段文字）。两件事放在这里：
 *
 * - 内置的几个词（`ENTRY_KINDS`）：引用字段的 `targets`、设定组的 `kinds` 都按这个词匹配，写在一处，改名时不会一处改了另一处没改；
 * - 贡献点 `canon.entry-kinds`（docs/specs/canon/author-ui.md 输入一节）：登记一个种类默认带哪几组设定。种类仍然只是条目上的
 *   一个词，世界里不存这张表；新建对话框、条目页的分页顺序与 Agent 的新建都经 `defaultComponents` 用它。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import type {ContributionDescriptor, ContributionPointDefinition} from "@notnotype/nb-runtime/plugins";

export const ENTRY_KINDS = {person: "人物", organization: "组织", place: "地点", item: "物品"} as const;

export const CANON_ENTRY_KINDS_POINT = "canon.entry-kinds";

export const EntryKindDeclarationSchema = Type.Object({
    /** 存进条目的那个词，例如“人物”。 */
    kind: Type.String({minLength: 1, pattern: "\\S"}),
    /** 新建这个种类的条目时默认带的设定组（类型 id）。 */
    components: Type.Optional(Type.Array(Type.String({minLength: 1}))),
    /** 新建对话框里的先后，小的在前。 */
    order: Type.Optional(Type.Number()),
    /** 这个种类的条目页标签的图标：lucide 的类名；几条登记都写了时取内置的那一条（workbench/editor.md 输出 53）。 */
    icon: Type.Optional(Type.String({minLength: 1, pattern: "^i-lucide-[a-z0-9-]+$"})),
}, {additionalProperties: false});

export type EntryKindDeclaration = Static<typeof EntryKindDeclarationSchema>;

/** 只有顶层声明；贡献点在每个有本插件的实例里都定义（plugin-manifest.md 输出 11），新建对话框、Agent 工具与项目实例都读得到。 */
export const entryKindsPoint: ContributionPointDefinition<EntryKindDeclaration> = {
    id: CANON_ENTRY_KINDS_POINT,
    implementation: "none",
    idPrefix: "plugin",
    schema: EntryKindDeclarationSchema,
};

/** 一个种类并起来的登记。 */
export interface EntryKind {
    readonly kind: string;
    /** 默认带的设定组（类型 id），内置的在前、去重；还没核对是否登记了。 */
    readonly components: readonly string[];
    readonly order: number;
    readonly icon?: string;
}

/** 内置登记的贡献 id 前缀（设定插件自己的，`plugin.ts` 的插件 id）。 */
const BUILTIN_PREFIX = "nbook.canon.";

/**
 * 同一个词的几条登记并成一条（别的插件可以给“人物”追加默认的设定组）：默认组先是内置的、再是别的插件的（按贡献 id，即
 * `declarations.list` 给的顺序：它按 id 排，第三方的 id 可能排在内置的前面，人物的默认不能因此跑到后面），并起来、去重；
 * `order` 取最小的，没写算最后。结果按 `order`、再按词排。
 */
export function mergeEntryKinds(descriptors: readonly Pick<ContributionDescriptor<EntryKindDeclaration>, "id" | "declaration">[]): readonly EntryKind[] {
    const merged = new Map<string, {components: string[]; order: number; icon?: string}>();
    const builtinFirst = [...descriptors].sort((a, b) => Number(!a.id.startsWith(BUILTIN_PREFIX)) - Number(!b.id.startsWith(BUILTIN_PREFIX)));
    for (const {declaration} of builtinFirst) {
        const kind = declaration.kind.trim();
        const order = declaration.order ?? Number.POSITIVE_INFINITY;
        const held = merged.get(kind);
        if (held === undefined) {
            merged.set(kind, {components: [...new Set(declaration.components ?? [])], order, ...(declaration.icon === undefined ? {} : {icon: declaration.icon})});
            continue;
        }
        for (const type of declaration.components ?? []) if (!held.components.includes(type)) held.components.push(type);
        held.order = Math.min(held.order, order);
        held.icon ??= declaration.icon;
    }
    return [...merged].map(([kind, held]) => ({kind, components: held.components, order: held.order, ...(held.icon === undefined ? {} : {icon: held.icon})}))
        .sort((a, b) => a.order - b.order || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
}

/**
 * 新建这个种类的条目时默认带的设定组：没登记的种类没有默认；默认里写到 `available` 之外（没登记、不可用）的类型当作没写，
 * 诊断由项目入口在登记变化时写（`missingDefaults`）。`kind` 按去掉首尾空白后的词比。
 */
export function defaultComponents(kinds: readonly EntryKind[], kind: string, available: ReadonlySet<string>): readonly string[] {
    const found = kinds.find((candidate) => candidate.kind === kind.trim());
    return found === undefined ? [] : found.components.filter((type) => available.has(type));
}

/** 默认里写到、却不在 `available` 里的类型：`{kind, type}` 一项一条。 */
export function missingDefaults(kinds: readonly EntryKind[], available: ReadonlySet<string>): readonly {readonly kind: string; readonly type: string}[] {
    return kinds.flatMap((entry) => entry.components.filter((type) => !available.has(type)).map((type) => ({kind: entry.kind, type})));
}
