/**
 * 配置项的定义与配置服务的公开接口（docs/specs/settings/configuration.md）。放在 `shared/` 而不是 `nbook.settings`
 * 插件里：每个插件都要在模块加载时调用 `defineSetting`，描述、读取方与配置插件用同一份定义。
 *
 * 声明是贡献点 `settings.properties` 上的一条顶层贡献，贡献 id 就是键；声明只含 JSON 能如实表示的数据，三个运行位置
 * 登记的是同一份。
 */

import type {DeepReadonly} from "@vue/reactivity";
import {Type} from "typebox";
import type {Static, TSchema} from "typebox";
import {Value} from "typebox/value";

import {checkDescription} from "@notnotype/nb-form";

import type {ContributionDeclaration} from "@notnotype/nb-runtime/plugins";
import {encodeJsonValue} from "@notnotype/nb-runtime/remote";

import type {Text} from "@notnotype/nb-ui/text";

import {conventionCompleter} from "nbook/shared/convention-keys";
import {TextSchema} from "nbook/shared/text";

export type {DeepReadonly};

/** 配置项的贡献点，拥有者是 `nbook.settings`。 */
export const SETTINGS_POINT = "settings.properties";

export type SettingLayer = "user" | "project";

export const SETTING_LAYERS: ReadonlyArray<SettingLayer> = ["user", "project"];

/** 改动什么时候完全生效；只给界面提示用，读取照常给最新值。 */
export const SETTING_APPLIES = ["now", "next-run", "next-session", "restart"] as const;

export type SettingApplies = (typeof SETTING_APPLIES)[number];

/** 字面量联合里一个字面量能取的值。 */
export type SettingLiteral = string | number | boolean;

/** 字面量联合的一个选项在界面上的名字。 */
export interface SettingChoiceDeclaration<T = SettingLiteral> {
    readonly value: T;
    readonly title: Text;
    readonly description?: Text;
}

/** 作者写下的选项：`title` 可以省略，登记时补约定键 `settings.<名>.choices.<String(值)>.title`。 */
export type WrittenSettingChoice<T = SettingLiteral> = Omit<SettingChoiceDeclaration<T>, "title"> & {readonly title?: Text};

/**
 * 动态选项：选项由浏览器入口贡献的选项提供者（贡献点 `settings.choices`）在运行时给出，值是字符串。提供者 id 的写法
 * 同分区 id；存不存在不在登记时核对。
 */
export interface SettingChoiceSource {
    readonly from: string;
}

/**
 * 设置窗口画这一项时的界面提示：`ui.forms` 的 `x-form` 里只与单个字段有关的几项（docs/specs/ui/forms.md“输入与
 * 前置条件”）。标题、说明与选项由声明的 `title`、`description`、`choices` 给，不在这里重复。
 */
export interface SettingUiHints {
    /** 例如 `multiline`、`radio`、`json`；要与 schema 的种类相配（同 `ui.forms` 输出 2）。 */
    readonly widget?: string;
    readonly placeholder?: Text;
    readonly unit?: Text;
    readonly rows?: number;
    readonly searchable?: boolean;
    /** 对象列表里当作每项标题的字段名。 */
    readonly itemLabel?: string;
}

const SettingUiHintsSchema = Type.Object({
    widget: Type.Optional(Type.String({minLength: 1})),
    placeholder: Type.Optional(TextSchema),
    unit: Type.Optional(TextSchema),
    rows: Type.Optional(Type.Integer({minimum: 1, maximum: 50})),
    searchable: Type.Optional(Type.Boolean()),
    itemLabel: Type.Optional(Type.String({minLength: 1})),
}, {additionalProperties: false});

/** 贡献点上已接受的一条声明：登记时已补全，`title` 总有值（docs/specs/settings/settings-window.md 的“约定键”）。 */
export interface SettingDeclaration {
    readonly schema: TSchema;
    readonly default: unknown;
    readonly title: Text;
    readonly description?: Text;
    /** 允许写这个键的层，非空。 */
    readonly layers: ReadonlyArray<SettingLayer>;
    /** 设置窗口里所在的分区（贡献点 `settings.sections` 的 id）；分区存不存在不在登记时核对。 */
    readonly section?: string;
    /** 分区里的小组 id；只能和 `section` 一起写。 */
    readonly group?: string;
    /** 小组内的顺序，同值按键。 */
    readonly order?: number;
    /** schema 是字面量联合时，每个字面量恰好一个选项；schema 是字符串时可以改为动态选项。 */
    readonly choices?: ReadonlyArray<SettingChoiceDeclaration> | SettingChoiceSource;
    readonly ui?: SettingUiHints;
    readonly applies: SettingApplies;
    /** 密钥存储尚未实现，声明 `true` 被拒。 */
    readonly secret?: boolean;
}

/** 作者写下的声明（`defineSetting` 的结果）：标题可以省略，由贡献点在登记时补全成 `SettingDeclaration`。 */
export type WrittenSettingDeclaration = Omit<SettingDeclaration, "title" | "choices"> & {
    readonly title?: Text;
    readonly choices?: ReadonlyArray<WrittenSettingChoice> | SettingChoiceSource;
};

declare const settingValue: unique symbol;

/** `defineSetting` 的结果：键、声明、给描述用的贡献，以及只在类型上存在的值类型。 */
export interface SettingDefinition<T> {
    readonly key: string;
    /** 写下的样子；要读补全后的标题，用配置插件经登记交出的声明（设置窗口的 `WindowSetting`）。 */
    readonly declaration: WrittenSettingDeclaration;
    readonly contribution: ContributionDeclaration<WrittenSettingDeclaration>;
    readonly [settingValue]?: T;
}

export interface SettingOptions<Schema extends TSchema> {
    /** 声明者插件的 id；键是 `<plugin>/<name>`。 */
    readonly plugin: string;
    readonly name: string;
    readonly schema: Schema;
    readonly default: Static<Schema>;
    /** 省略时登记处补成约定键 `settings.<名>.title`。 */
    readonly title?: Text;
    readonly description?: Text;
    readonly layers?: ReadonlyArray<SettingLayer>;
    readonly section?: string;
    readonly group?: string;
    readonly order?: number;
    readonly choices?: ReadonlyArray<WrittenSettingChoice<Static<Schema>>> | SettingChoiceSource;
    readonly ui?: SettingUiHints;
    /** 缺省 `now`。 */
    readonly applies?: SettingApplies;
}

/** `defineSettings` 里一项的写法：同 `defineSetting`，插件 id 写在外面，名是这一项的键。 */
export type SettingItemOptions<Schema extends TSchema> = Omit<SettingOptions<Schema>, "plugin" | "name">;

/** `defineSettings` 的结果。定义放在 `settings` 下，不与名叫 `contributions` 的配置项撞。 */
export interface SettingsBundle<Schemas extends Readonly<Record<string, TSchema>>> {
    readonly settings: {readonly [Name in keyof Schemas]: SettingDefinition<Static<Schemas[Name]>>};
    /** 交给插件描述的 `contributions`，按声明的顺序。 */
    readonly contributions: ReadonlyArray<ContributionDeclaration<WrittenSettingDeclaration>>;
}

/** 以点分段的小驼峰：`appearance`、`editor.fontSize`。 */
const NAME = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/u;
const MAX_NAME = 128;
const FIELDS = new Set(["schema", "default", "title", "description", "layers", "section", "group", "order", "choices", "ui", "applies", "secret"]);
const CHOICE_FIELDS = new Set(["value", "title", "description"]);

/**
 * 设置分区 id 的形状（docs/specs/settings/settings-window.md“输入与前置条件”）：点分的小写段、至多 128 个字符，与视图 id
 * 同一写法。前缀归谁由分区的贡献点核对；配置项的 `section` 引用别的插件的分区，只核对形状。
 */
export const SETTINGS_SECTION_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;
export const SETTINGS_SECTION_ID_MAX_LENGTH = 128;
/** 分区里小组 id 的形状：一个小写段、至多 64 个字符。 */
export const SETTINGS_GROUP_ID = /^[a-z][a-z0-9-]*$/u;
export const SETTINGS_GROUP_ID_MAX_LENGTH = 64;
/** 分区与配置项的 `order` 的范围，与视图的 `order` 相同。 */
export const SETTINGS_ORDER_LIMIT = 1_000_000;

export function isSettingsSectionId(value: unknown): value is string {
    return typeof value === "string" && value.length <= SETTINGS_SECTION_ID_MAX_LENGTH && SETTINGS_SECTION_ID.test(value);
}

export function isSettingsGroupId(value: unknown): value is string {
    return typeof value === "string" && value.length <= SETTINGS_GROUP_ID_MAX_LENGTH && SETTINGS_GROUP_ID.test(value);
}

export function isSettingsOrder(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= SETTINGS_ORDER_LIMIT;
}

/** 在模块加载时校验定义，不合规则抛 TypeError；返回冻结对象。 */
export function defineSetting<Schema extends TSchema>(options: SettingOptions<Schema>): SettingDefinition<Static<Schema>> {
    const key = `${options.plugin}/${options.name}`;
    const raw: WrittenSettingDeclaration = {
        schema: options.schema,
        default: options.default,
        ...(options.title === undefined ? {} : {title: options.title}),
        ...(options.description === undefined ? {} : {description: options.description}),
        layers: [...(options.layers ?? SETTING_LAYERS)],
        ...(options.section === undefined ? {} : {section: options.section}),
        ...(options.group === undefined ? {} : {group: options.group}),
        ...(options.order === undefined ? {} : {order: options.order}),
        ...(options.choices === undefined ? {} : {choices: options.choices}),
        ...(options.ui === undefined ? {} : {ui: options.ui}),
        applies: options.applies ?? "now",
    };
    // 先校验再冻结：默认值不是 JSON 时复制它本身就会抛出别的错误。按登记时补全后的样子校验，所以省略的标题不算错；
    // 存下的仍是写下的样子，补全只在登记时做一次（贡献点的 `complete`）。
    const problem = settingDeclarationProblem(options.plugin, key, completeSettingDeclaration({plugin: options.plugin, id: key, declaration: raw}));
    if (problem !== null) throw new TypeError(problem);
    const declaration: WrittenSettingDeclaration = Object.freeze({
        ...raw,
        default: freezeJson(raw.default),
        layers: Object.freeze(raw.layers),
        ...(raw.choices === undefined ? {} : {choices: freezeJson(raw.choices)}),
        ...(raw.ui === undefined ? {} : {ui: freezeJson(raw.ui)}),
    });
    return Object.freeze({key, declaration, contribution: Object.freeze({capability: SETTINGS_POINT, id: key, declaration})});
}

/**
 * 一次声明一个插件的多条配置项，插件 id 只写一次；每项的值类型由它自己的 schema 推出，`default` 与 `update` 按它核对。
 * 每项照 `defineSetting` 校验，结果与逐条 `defineSetting` 相同。
 */
export function defineSettings<Schemas extends Readonly<Record<string, TSchema>>>(
    plugin: string,
    items: {readonly [Name in keyof Schemas]: SettingItemOptions<Schemas[Name]>},
): SettingsBundle<Schemas> {
    const settings: Record<string, SettingDefinition<unknown>> = {};
    for (const [name, options] of Object.entries(items) as Array<[string, SettingItemOptions<TSchema>]>) {
        settings[name] = defineSetting({...options, plugin, name});
    }
    return Object.freeze({
        settings: Object.freeze(settings) as SettingsBundle<Schemas>["settings"],
        contributions: Object.freeze(Object.values(settings).map((definition) => definition.contribution)),
    });
}

/**
 * `settings.properties` 的补全：给文字引用补命名空间；没写 `title` 时补约定键 `settings.<名>.title`，字面量选项没写
 * `title` 时补 `settings.<名>.choices.<String(值)>.title`（settings-window.md 的“约定键”）。键是 `<插件>/<名>`，本地 id 取名。
 */
export const completeSettingDeclaration = conventionCompleter({
    name: "settings",
    fields: ["title"],
    lists: {choices: {segment: (choice) => (isSettingLiteral(choice.value) ? String(choice.value) : null), fields: ["title"]}},
    localId: (plugin, key) => (key.startsWith(`${plugin}/`) ? key.slice(plugin.length + 1) : key),
});

function isSettingLiteral(value: unknown): value is SettingLiteral {
    return typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

/**
 * 贡献点的校验（configuration.md 输出 1）：纯函数，只看这一条。`defineSetting` 在加载时先跑一遍，作者尽早看到错；
 * 不经 `defineSetting` 写出的声明（以后的清单 JSON）在登记时由贡献点再跑。同键的两条由内核的去重拒绝。
 */
export function settingDeclarationProblem(plugin: string, key: string, declaration: unknown): string | null {
    const prefix = `${plugin}/`;
    if (!key.startsWith(prefix)) return `配置项 ${key} 必须写成 ${prefix}<名>`;
    const name = key.slice(prefix.length);
    if (name.length > MAX_NAME || !NAME.test(name)) return `设置项名 ${name} 不合规则：以点分段的小驼峰（例如 dailyGoal、editor.fontSize），至多 ${String(MAX_NAME)} 个字符`;
    if (typeof declaration !== "object" || declaration === null) return `配置项 ${key} 的声明必须是对象`;
    const fields = declaration as Record<string, unknown>;
    const extra = Object.keys(fields).filter((field) => !FIELDS.has(field));
    if (extra.length > 0) return `配置项 ${key} 的声明有未知字段：${extra.join("、")}`;
    if (fields.secret === true) return `配置项 ${key} 声明了 secret：密钥存储尚未实现`;
    if (fields.secret !== undefined && fields.secret !== false) return `配置项 ${key} 的 secret 必须是布尔`;
    if (!isJson(fields.schema) || typeof fields.schema !== "object" || fields.schema === null) return `配置项 ${key} 的 schema 必须是可 JSON 序列化的 TypeBox schema`;
    if (!isJson(fields.default)) return `配置项 ${key} 的默认值不是 JSON 能如实表示的值`;
    if (!Value.Check(fields.schema as TSchema, fields.default)) return `配置项 ${key} 的默认值不符合 schema`;
    const layers = fields.layers;
    if (!Array.isArray(layers) || layers.length === 0 || layers.some((layer) => !(SETTING_LAYERS as ReadonlyArray<unknown>).includes(layer)) || new Set(layers).size !== layers.length) {
        return `配置项 ${key} 的 layers 必须是 user、project 的非空子集`;
    }
    if (!Value.Check(TextSchema, fields.title)) return `配置项 ${key} 的 title 必须是文字（字符串、语言映射或文字引用）`;
    if (fields.description !== undefined && !Value.Check(TextSchema, fields.description)) return `配置项 ${key} 的 description 必须是文字（字符串、语言映射或文字引用）`;
    if (fields.section !== undefined && !isSettingsSectionId(fields.section)) return `配置项 ${key} 的 section 必须是分区 id：点分的小写段，至多 ${String(SETTINGS_SECTION_ID_MAX_LENGTH)} 个字符`;
    if (fields.group !== undefined && fields.section === undefined) return `配置项 ${key} 写了 group 却没有 section：小组只在分区里有意义`;
    if (fields.group !== undefined && !isSettingsGroupId(fields.group)) return `配置项 ${key} 的 group 必须是小组 id：一个小写段，至多 ${String(SETTINGS_GROUP_ID_MAX_LENGTH)} 个字符`;
    if (fields.order !== undefined && !isSettingsOrder(fields.order)) return `配置项 ${key} 的 order 必须是 -${String(SETTINGS_ORDER_LIMIT)} 到 ${String(SETTINGS_ORDER_LIMIT)} 之间的数`;
    if (fields.choices !== undefined) {
        const problem = choicesProblem(fields.schema as TSchema, fields.choices);
        if (problem !== null) return `配置项 ${key} 的 choices ${problem}`;
    }
    if (fields.ui !== undefined) {
        const problem = uiProblem(fields.schema as TSchema, fields.ui, fields.choices);
        if (problem !== null) return `配置项 ${key} 的 ui ${problem}`;
    }
    if (!(SETTING_APPLIES as ReadonlyArray<unknown>).includes(fields.applies)) return `配置项 ${key} 的 applies 必须是 ${SETTING_APPLIES.join("、")} 之一`;
    return null;
}

/**
 * schema 是字面量联合（`Type.Union` 的成员全是 `Type.Literal`）时，它的全部字面量；否则为 null。字面量只取 JSON 的
 * 标量：字符串、有限数与布尔。
 */
export function literalUnionValues(schema: unknown): ReadonlyArray<SettingLiteral> | null {
    if (typeof schema !== "object" || schema === null) return null;
    const members = (schema as {readonly anyOf?: unknown}).anyOf;
    if (!Array.isArray(members) || members.length === 0) return null;
    const values: SettingLiteral[] = [];
    for (const member of members) {
        if (typeof member !== "object" || member === null || !Object.hasOwn(member, "const")) return null;
        const value = (member as {readonly const: unknown}).const;
        if (typeof value !== "string" && typeof value !== "boolean" && !(typeof value === "number" && Number.isFinite(value))) return null;
        values.push(value);
    }
    return values;
}

/**
 * `choices` 与 schema 的字面量一一对应：每个字面量恰好一个选项，没有多出的值。动态选项 `{from}` 只用在字符串 schema
 * 上（选项的值是字符串，`ui.forms` 输出 11）。
 */
function choicesProblem(schema: TSchema, choices: unknown): string | null {
    if (typeof choices === "object" && choices !== null && !Array.isArray(choices)) {
        const fields = choices as Record<string, unknown>;
        const extra = Object.keys(fields).filter((field) => field !== "from");
        if (extra.length > 0) return `有未知字段：${extra.join("、")}`;
        if (!isSettingsSectionId(fields.from)) return `的 from 必须是选项提供者 id：点分的小写段，至多 ${String(SETTINGS_SECTION_ID_MAX_LENGTH)} 个字符`;
        if ((schema as {readonly type?: unknown}).type !== "string") return "的动态选项只能用在字符串的 schema 上";
        return null;
    }
    const literals = literalUnionValues(schema);
    if (literals === null) return "只能用在字面量联合的 schema 上";
    if (!Array.isArray(choices)) return "必须是数组";
    const seen: SettingLiteral[] = [];
    for (const choice of choices as ReadonlyArray<unknown>) {
        if (typeof choice !== "object" || choice === null || Array.isArray(choice)) return "的每一项必须是对象";
        const fields = choice as Record<string, unknown>;
        const extra = Object.keys(fields).filter((field) => !CHOICE_FIELDS.has(field));
        if (extra.length > 0) return `有未知字段：${extra.join("、")}`;
        if (!Value.Check(TextSchema, fields.title)) return "的 title 必须是文字（字符串、语言映射或文字引用）";
        if (fields.description !== undefined && !Value.Check(TextSchema, fields.description)) return "的 description 必须是文字（字符串、语言映射或文字引用）";
        if (!literals.includes(fields.value as SettingLiteral)) return `里的 ${JSON.stringify(fields.value)} 不是 schema 的字面量`;
        if (seen.includes(fields.value as SettingLiteral)) return `里的 ${JSON.stringify(fields.value)} 出现了不止一次`;
        seen.push(fields.value as SettingLiteral);
    }
    const missing = literals.filter((literal) => !seen.includes(literal));
    if (missing.length > 0) return `缺少字面量 ${missing.map((literal) => JSON.stringify(literal)).join("、")} 的选项`;
    return null;
}

/**
 * `ui` 的形状，以及写的控件能不能用在这个 schema 上：后者交给 `ui.forms` 的描述检查（它的 `widget-mismatch`），设置不另
 * 记一份“哪种值能用哪个控件”。动态选项 `{from}` 对应 `x-form.options`：有它时文字的下拉才成立，写多行反而不生效。
 */
function uiProblem(schema: TSchema, ui: unknown, choices: unknown): string | null {
    if (!Value.Check(SettingUiHintsSchema, ui)) return "的形状不对：只能有 widget、placeholder、unit、rows、searchable、itemLabel，文字要是字符串、语言映射或文字引用";
    const from = typeof choices === "object" && choices !== null && !Array.isArray(choices) ? (choices as Partial<SettingChoiceSource>).from : undefined;
    const check = checkDescription({...schema, "x-form": {...(ui as SettingUiHints), ...(from === undefined ? {} : {options: from})}});
    const mismatch = check.problems.find((problem) => problem.code === "widget-mismatch" || problem.code === "item-label-unknown");
    if (mismatch !== undefined) return mismatch.code === "widget-mismatch" ? `的控件 ${String((ui as SettingUiHints).widget)} 用不到这种值上` : `的 itemLabel 不是列表项的字段`;
    return null;
}

/** JSON 能如实表示（规则同远程服务的帧编码：没有 undefined、非有限数、类实例、函数、循环）。 */
export function isJson(value: unknown): boolean {
    if (value === undefined) return false;
    try {
        encodeJsonValue(value);
        return true;
    } catch (error) {
        if (error instanceof TypeError) return false;
        throw error;
    }
}

/** 复制一份 JSON 值并逐层冻结：读取方拿到的值改不动，也影响不到别的读取方。调用方先确认 `isJson`。 */
export function freezeJson<T>(value: T): DeepReadonly<T> {
    return deepFreeze(structuredClone(value)) as DeepReadonly<T>;
}

function deepFreeze(value: unknown): unknown {
    if (typeof value === "object" && value !== null) {
        for (const item of Object.values(value)) deepFreeze(item);
        Object.freeze(value);
    }
    return value;
}

/** 配置写入与读取的失败码（configuration.md“失败与恢复”）。 */
export const SETTINGS_FAILURES = [
    "denied",
    "undeclared",
    "invalid-value",
    "layer-not-allowed",
    "no-project",
    "layer-invalid",
    "write-failed",
    "unavailable",
    "unknown-outcome",
    /** 整份读写设置文件（设置窗口的“设置文件”视图）：文件存在但读不了。 */
    "read-failed",
    /** 整份写入：文件在读出之后被别处改过（修订号对不上）；带 `expect` 的写入：这一层的当前值不是期望的。 */
    "conflict",
    /** 整份写入：文本不是合格的设置文件（语法、根不是对象、重复键）。 */
    "invalid-text",
] as const;

export type SettingsFailure = (typeof SETTINGS_FAILURES)[number];

export type SettingWriteResult = {readonly ok: true} | {readonly ok: false; readonly code: SettingsFailure; readonly detail: string};

export type SettingSource = "default" | SettingLayer;

/** 一层里这个键的情况；`value` 缺省表示这层没有这个键。 */
export type LayerInspection<T> =
    | {readonly status: "ok"; readonly value?: DeepReadonly<T>}
    /** 文件当前无效；`value` 来自上一份有效内容。 */
    | {readonly status: "invalid"; readonly detail: string; readonly value?: DeepReadonly<T>}
    | {readonly status: "unavailable"}
    /** 本实例没有这一层（服务端、未绑定项目的窗口没有项目层）。 */
    | {readonly status: "absent"};

export interface SettingInspection<T> {
    readonly value: DeepReadonly<T>;
    readonly source: SettingSource;
    readonly default: DeepReadonly<T>;
    readonly user: LayerInspection<T>;
    readonly project: LayerInspection<T>;
}

export interface SettingUpdateOptions {
    /** 缺省 `auto`：本实例的项目层有这个键就写项目层，否则写用户层；只允许用户层的项总写用户层。 */
    readonly layer?: SettingLayer | "auto";
    /**
     * 比较后写入：只在目标层里这个键当前的值（按规范化文本比）等于 `expect.value` 时写，否则得 `conflict`、文件不变；
     * `value` 为 undefined 表示期望这一层还没有这个键。拥有者在写入队列里、以磁盘上的当前文本比较，所以“读 → 合并 →
     * 写回”的调用方不会盖掉期间别处（设置文件视图、外部编辑、另一个窗口）写入的内容（configuration.md 输出 25）。
     */
    readonly expect?: {readonly value: unknown};
}

/** 配置服务（`settingsKey`，按调用方生成）：所有已声明的项都可读，只写调用方插件自己声明的项。 */
export interface SettingsService {
    /** 同步、不失败；值深冻结。在 `@vue/reactivity` 的 computed 或 effect 里读，值变化时重新求值。 */
    get<T>(setting: SettingDefinition<T>): DeepReadonly<T>;
    /** 有效值、来源层、默认值与各层的情况；层状态变化时同样重新求值。 */
    inspect<T>(setting: SettingDefinition<T>): SettingInspection<T>;
    /**
     * 本实例接受的这一项的声明：登记时补全过，标题总有值；本实例没有接受这一项时为 null。画设置行时从这里取标题与选项名：
     * 插件自己拿着的定义是写下的样子，省略的标题不在里面（settings-window.md 的“约定键”）。
     */
    declaration(setting: SettingDefinition<unknown>): SettingDeclaration | null;
    /** 本实例里有效值变化的键；同一次层更新只调用一次。返回取消函数。 */
    onDidChange(listener: (keys: ReadonlySet<string>) => void): () => void;
    /**
     * `value` 为 undefined 表示删除这一层里的这个键。`T` 只从定义推出（`NoInfer`）：否则字面量联合之外的值会把 `T`
     * 放宽成 `string`，写错的值也能编译。
     */
    update<T>(setting: SettingDefinition<T>, value: NoInfer<T> | undefined, options?: SettingUpdateOptions): Promise<SettingWriteResult>;
}
