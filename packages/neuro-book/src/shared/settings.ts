/**
 * 配置项的定义与配置服务的公开接口（docs/specs/settings/configuration.md）。放在 `shared/` 而不是 `nbook.settings`
 * 插件里：每个插件都要在模块加载时调用 `defineSetting`，描述、读取方与配置插件用同一份定义。
 *
 * 声明是贡献点 `settings.properties` 上的一条顶层贡献，贡献 id 就是键；声明只含 JSON 能如实表示的数据，三个运行位置
 * 登记的是同一份。
 */

import type {DeepReadonly} from "@vue/reactivity";
import type {Static, TSchema} from "typebox";
import {Value} from "typebox/value";

import type {ContributionDeclaration} from "@notnotype/nb-runtime/plugins";
import {encodeJsonValue} from "@notnotype/nb-runtime/remote";

import {LocalizedTextSchema} from "nbook/shared/localized-text";
import type {LocalizedText} from "nbook/shared/localized-text";

export type {DeepReadonly};

/** 配置项的贡献点，拥有者是 `nbook.settings`。 */
export const SETTINGS_POINT = "settings.properties";

export type SettingLayer = "user" | "project";

export const SETTING_LAYERS: ReadonlyArray<SettingLayer> = ["user", "project"];

/** 贡献点上的一条声明。 */
export interface SettingDeclaration {
    readonly schema: TSchema;
    readonly default: unknown;
    readonly title: LocalizedText;
    readonly description?: LocalizedText;
    /** 允许写这个键的层，非空。 */
    readonly layers: ReadonlyArray<SettingLayer>;
    /** 改后要重启才完全生效；只给界面提示用，读取照常给最新值。 */
    readonly restart: boolean;
    /** 密钥存储尚未实现，声明 `true` 被拒。 */
    readonly secret?: boolean;
}

declare const settingValue: unique symbol;

/** `defineSetting` 的结果：键、声明、给描述用的贡献，以及只在类型上存在的值类型。 */
export interface SettingDefinition<T> {
    readonly key: string;
    readonly declaration: SettingDeclaration;
    readonly contribution: ContributionDeclaration<SettingDeclaration>;
    readonly [settingValue]?: T;
}

export interface SettingOptions<Schema extends TSchema> {
    /** 声明者插件的 id；键是 `<plugin>/<name>`。 */
    readonly plugin: string;
    readonly name: string;
    readonly schema: Schema;
    readonly default: Static<Schema>;
    readonly title: LocalizedText;
    readonly description?: LocalizedText;
    readonly layers?: ReadonlyArray<SettingLayer>;
    readonly restart?: boolean;
}

/** 以点分段的小驼峰：`appearance`、`editor.fontSize`。 */
const NAME = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/u;
const MAX_NAME = 128;
const FIELDS = new Set(["schema", "default", "title", "description", "layers", "restart", "secret"]);

/** 在模块加载时校验定义，不合规则抛 TypeError；返回冻结对象。 */
export function defineSetting<Schema extends TSchema>(options: SettingOptions<Schema>): SettingDefinition<Static<Schema>> {
    const key = `${options.plugin}/${options.name}`;
    const raw: SettingDeclaration = {
        schema: options.schema,
        default: options.default,
        title: options.title,
        ...(options.description === undefined ? {} : {description: options.description}),
        layers: [...(options.layers ?? SETTING_LAYERS)],
        restart: options.restart ?? false,
    };
    // 先校验再冻结：默认值不是 JSON 时复制它本身就会抛出别的错误。
    const problem = settingDeclarationProblem(options.plugin, key, raw);
    if (problem !== null) throw new TypeError(problem);
    const declaration: SettingDeclaration = Object.freeze({...raw, default: freezeJson(raw.default), layers: Object.freeze(raw.layers)});
    return Object.freeze({key, declaration, contribution: Object.freeze({capability: SETTINGS_POINT, id: key, declaration})});
}

/**
 * 贡献点的校验（configuration.md 输出 1）：纯函数，只看这一条。`defineSetting` 在加载时先跑一遍，作者尽早看到错；
 * 不经 `defineSetting` 写出的声明（以后的清单 JSON）在登记时由贡献点再跑。同键的两条由内核的去重拒绝。
 */
export function settingDeclarationProblem(plugin: string, key: string, declaration: unknown): string | null {
    const prefix = `${plugin}/`;
    if (!key.startsWith(prefix)) return `配置项 ${key} 必须写成 ${prefix}<名>`;
    const name = key.slice(prefix.length);
    if (name.length > MAX_NAME || !NAME.test(name)) return `配置项名 ${name} 不合规则：以点分段的小驼峰，至多 ${String(MAX_NAME)} 个字符`;
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
    if (!Value.Check(LocalizedTextSchema, fields.title)) return `配置项 ${key} 的 title 必须是中英两份文本`;
    if (fields.description !== undefined && !Value.Check(LocalizedTextSchema, fields.description)) return `配置项 ${key} 的 description 必须是中英两份文本`;
    if (typeof fields.restart !== "boolean") return `配置项 ${key} 的 restart 必须是布尔`;
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
}

/** 配置服务（`settingsKey`，按调用方生成）：所有已声明的项都可读，只写调用方插件自己声明的项。 */
export interface SettingsService {
    /** 同步、不失败；值深冻结。在 `@vue/reactivity` 的 computed 或 effect 里读，值变化时重新求值。 */
    get<T>(setting: SettingDefinition<T>): DeepReadonly<T>;
    /** 有效值、来源层、默认值与各层的情况；层状态变化时同样重新求值。 */
    inspect<T>(setting: SettingDefinition<T>): SettingInspection<T>;
    /** 本实例里有效值变化的键；同一次层更新只调用一次。返回取消函数。 */
    onDidChange(listener: (keys: ReadonlySet<string>) => void): () => void;
    /** `value` 为 undefined 表示删除这一层里的这个键。 */
    update<T>(setting: SettingDefinition<T>, value: T | undefined, options?: SettingUpdateOptions): Promise<SettingWriteResult>;
}
