/**
 * `nbook.settings` 的服务键与远程服务合同（docs/specs/settings/configuration.md），以及设置分区的两个贡献点
 * `settings.sections`、`settings.pages` 的声明（docs/specs/settings/settings-window.md）。
 *
 * 两份远程合同的方法与事件相同，只是层不同：`nbook.settings/user` 由服务端实例提供，`nbook.settings/project` 由项目
 * 实例提供。写入的调用方身份由内核填写，输入里没有插件字段。拥有者一侧的失败统一以业务失败码 `settings-failed`
 * 返回，详情里带配置的失败码：配置的 `denied`、`unavailable`、`unknown-outcome` 与路由层失败码同名，不能直接声明为
 * 业务失败码。别的插件只依赖 `settingsKey`，不直接调用这两份合同。
 */

import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";
import {Type} from "typebox";

import type {CommandFailureCode, CommandResult} from "nbook/plugins/commands/shared/contracts";
import type {QuickPick} from "nbook/plugins/workbench/shared/contracts";
import type {DisplayLocale, DisplayText, TextResolver} from "nbook/shared/localized-text";
import {HOST_LOCALES, hostLocaleSchema} from "nbook/shared/host-locales";
import type {HostLocale} from "nbook/shared/host-locales";
import {defineSetting, SETTINGS_FAILURES, SETTINGS_POINT} from "nbook/shared/settings";
import type {SettingDefinition, SettingsFailure, SettingsService} from "nbook/shared/settings";

import type {WrittenSettingsSectionDeclaration} from "./sections";
import {settingsText} from "./text";

export {SETTINGS_POINT};
export {SETTINGS_CHOICES_ACTIVATION_PREFIX, SETTINGS_CHOICES_POINT, SETTINGS_PAGE_ACTIVATION_PREFIX, SETTINGS_PAGES_POINT, SETTINGS_SECTION_CATEGORIES, SETTINGS_SECTIONS_POINT, settingsChoicesEvent, settingsPageEvent} from "./sections";
export type {SettingsChoicesDeclaration, SettingsPageDeclaration, SettingsSectionCategory, SettingsSectionDeclaration} from "./sections";

/** 插件依赖它取得按调用方生成的配置服务。 */
export const settingsKey: ServiceKey<SettingsService> = defineServiceKey<SettingsService>("nbook.settings/settings");

/** 打开本页的设置窗口（docs/specs/settings/settings-window.md 输出 15）；工作台与书架的齿轮执行它。 */
export const OPEN_SETTINGS_COMMAND = "nbook.settings.open";
/** 齿轮执行的：开着就关，关着就开（docs/specs/settings/settings-window.md 输出 15）。 */
export const TOGGLE_SETTINGS_COMMAND = "nbook.settings.toggle";

/** 公开状态：本页的设置窗口开着时为真；齿轮据此画成按下。 */
export const SETTINGS_WINDOW_OPEN_KEY = "nbook.settings/windowOpen";

export const APPEARANCE_SECTION = "nbook.appearance";

/** 外观分区：工作台的主题、明暗（小组 ui）与本插件的界面语言（小组 language）按 `section` 指向它。 */
export const APPEARANCE_SECTION_DECLARATION: WrittenSettingsSectionDeclaration = {
    // 标题与小组标题省略，登记时补约定键 settingsSections.nbook.appearance.*；描述是可选字段，要写出来。
    description: settingsText("settingsSections.nbook.appearance.description"),
    icon: "i-lucide-palette",
    category: "app",
    order: 10,
    groups: [{id: "ui"}, {id: "language"}],
};

/**
 * 界面语言：平台级设置，只允许用户层（项目文件可能来自别人的仓库，不该替用户换语言）。取值与选项由宿主的语言集合生成
 * （`HOST_LOCALES`）；测试用别的集合调这个工厂，核对加一种语言时设置与命令一起变。
 */
export function localeSettingFor(locales: readonly HostLocale[]): SettingDefinition<string> {
    return defineSetting({
        plugin: "nbook.settings",
        name: "locale",
        schema: hostLocaleSchema(locales),
        default: "zh-CN",
        layers: ["user"],
        section: APPEARANCE_SECTION,
        group: "language",
        order: 10,
        choices: locales.map((locale) => ({value: locale.tag, title: {"zh-CN": locale.name, "en-US": locale.name}})),
    });
}

export const localeSetting = localeSettingFor(HOST_LOCALES);

/** 当前显示语言；在 computed 或 effect 里读时随设置变化重新求值。 */
export function displayLocale(settings: SettingsService): DisplayLocale {
    return settings.get(localeSetting);
}

const RevisionSchema = Type.Object({boot: Type.String(), seq: Type.Integer({minimum: 0})}, {additionalProperties: false});
const ProblemSchema = Type.Object({key: Type.String(), reason: Type.Union([Type.Literal("invalid-value"), Type.Literal("layer-not-allowed")])}, {additionalProperties: false});
const ValuesSchema = Type.Record(Type.String(), Type.Unknown());
const PositionSchema = Type.Object({line: Type.Integer({minimum: 1}), column: Type.Integer({minimum: 1})}, {additionalProperties: false});

/**
 * `path`：这一层文件的绝对路径，拥有者不发时缺省（configuration.md 输出 23）；`reason`、`position`：无效时不含位置的原因与
 * 出错处，没有语法位置的无效（读不出文件）缺省（输出 5）。都只加可选字段，合同版本不变。
 */
export const LayerSnapshotSchema = Type.Union([
    Type.Object({status: Type.Literal("ok"), revision: RevisionSchema, values: ValuesSchema, problems: Type.Array(ProblemSchema), path: Type.Optional(Type.String())}, {additionalProperties: false}),
    Type.Object({status: Type.Literal("invalid"), revision: RevisionSchema, values: ValuesSchema, problems: Type.Array(ProblemSchema), detail: Type.String(), reason: Type.Optional(Type.String()), position: Type.Optional(PositionSchema), path: Type.Optional(Type.String())}, {additionalProperties: false}),
]);

/** `position`：`invalid-text` 时文本里出错的地方。 */
const SettingsFailedDetail = Type.Object({code: Type.Enum(SETTINGS_FAILURES), detail: Type.String(), position: Type.Optional(PositionSchema)}, {additionalProperties: false});
const Written = Type.Object({snapshot: LayerSnapshotSchema}, {additionalProperties: false});
/** 设置文件的全文；`revision` 是原始文本的摘要，文件不存在时 `exists` 为假、`text` 为空串。 */
const TextRead = Type.Object({text: Type.String(), revision: Type.String(), exists: Type.Boolean()}, {additionalProperties: false});
const TextInput = Type.Object({text: Type.String(), revision: Type.String()}, {additionalProperties: false});
const TextWritten = Type.Object({revision: Type.String(), snapshot: LayerSnapshotSchema}, {additionalProperties: false});
const failures = {"settings-failed": SettingsFailedDetail};

/** 比较后写入的期望（`SettingUpdateOptions.expect`）；用户编辑的 `edit`、`unset` 不带。 */
const Expectation = Type.Union([Type.Object({present: Type.Literal(false)}, {additionalProperties: false}), Type.Object({present: Type.Literal(true), value: Type.Unknown()}, {additionalProperties: false})]);
const SetInput = Type.Object({key: Type.String(), value: Type.Unknown(), expect: Type.Optional(Expectation)}, {additionalProperties: false});
const KeyInput = Type.Object({key: Type.String(), expect: Type.Optional(Expectation)}, {additionalProperties: false});

/**
 * `set`、`remove` 只写调用方插件自己声明的项；`edit`、`unset` 是用户编辑（configuration.md 输出 19），写任何已声明项，
 * 只接受内核填写的调用方是 `nbook.settings` 且没有经过代理的请求。成功时都带回写后的层快照，调用方据此先更新本实例
 * 再结算。删除是单独的方法，不靠 JSON 保留 undefined。`readText`、`writeText` 整份读写这一层的设置文件（输出 24），
 * 同样只接受用户编辑的调用方。
 */
const methods = {
    set: {input: SetInput, output: Written, effect: "write", errors: failures},
    remove: {input: KeyInput, output: Written, effect: "write", errors: failures},
    edit: {input: SetInput, output: Written, effect: "write", errors: failures},
    unset: {input: KeyInput, output: Written, effect: "write", errors: failures},
    readText: {input: Type.Object({}, {additionalProperties: false}), output: TextRead, effect: "read", errors: failures},
    writeText: {input: TextInput, output: TextWritten, effect: "write", errors: failures},
} as const;

const NoFilter = Type.Object({}, {additionalProperties: false});

/**
 * `layer`：订阅先推一次当前快照，之后层的状态、键值、被丢弃的键或无效原因变化时推送。`text`：订阅先推一次当前文本的
 * 修订号，之后文件的原始文本变了就推（只改注释、格式也推），设置文件视图据此知道别处改过。
 */
const events = {
    layer: {filter: NoFilter, payload: LayerSnapshotSchema},
    text: {filter: NoFilter, payload: Type.Object({revision: Type.String()}, {additionalProperties: false})},
} as const;

/** 版本 2 加了 `readText`、`writeText` 与 `text` 事件（两份合同一起升）。 */
export const userSettingsContract = defineRemoteService({id: "nbook.settings/user", version: 2, provider: "server", callers: ["browser", "tui", "project"], methods, events});

export const projectSettingsContract = defineRemoteService({id: "nbook.settings/project", version: 2, provider: "project", callers: ["browser", "tui"], methods, events});

export type SettingsContract = typeof userSettingsContract | typeof projectSettingsContract;

/** 切换某个配置项的选项：值与它的显示文字。 */
export interface SettingChoice<T extends string> {
    readonly id: T;
    readonly label: DisplayText;
}

/**
 * 三条设置命令（切换界面语言、主题、明暗）共用的执行：给了值就直接写，不打开选择；没给时经命令面板的选择模式列出
 * 选项，取消为成功、无副作用。写入失败按 docs/specs/workbench/commands.md 的“命令目录（设置）”转换为命令失败。
 */
export async function switchSetting<T extends string>(options: {
    readonly settings: SettingsService;
    readonly quickPick: QuickPick;
    readonly setting: SettingDefinition<T>;
    readonly value: T | undefined;
    readonly choices: ReadonlyArray<SettingChoice<T>>;
    /** 选择的标题，通常就是命令的标题。 */
    readonly title: DisplayText;
    /** 解析失败原因里的目录文字；原因进命令结果，是给人读的字符串。 */
    readonly text: TextResolver;
}): Promise<CommandResult<null>> {
    const {settings, setting} = options;
    let value = options.value;
    if (value === undefined) {
        const current = settings.get(setting) as T;
        const picked = await options.quickPick.pick({
            title: options.title,
            placeholder: settingsText("switch.placeholder"),
            items: options.choices.map((choice) => ({id: choice.id, label: choice.label, ...(choice.id === current ? {detail: settingsText("switch.current")} : {})})),
        });
        if (picked.kind === "cancelled") return {ok: true, value: null};
        if (picked.kind === "unavailable") return {ok: false, code: "unavailable", reason: picked.reason};
        const chosen = options.choices.find((choice) => choice.id === (picked.kind === "item" ? picked.id : picked.text));
        if (chosen === undefined) return {ok: true, value: null};
        value = chosen.id;
    }
    const result = await settings.update(setting, value);
    if (result.ok) return {ok: true, value: null};
    const reason = options.text.t(settingsText("switch.failed", {code: result.code, detail: result.detail}));
    return {ok: false, code: COMMAND_FAILURES[result.code], reason};
}

const COMMAND_FAILURES: Record<SettingsFailure, CommandFailureCode> = {
    "denied": "denied",
    "unavailable": "unavailable",
    "no-project": "unavailable",
    "invalid-value": "invalid-args",
    "undeclared": "execution-error",
    "layer-not-allowed": "execution-error",
    "layer-invalid": "execution-error",
    "write-failed": "execution-error",
    "unknown-outcome": "execution-error",
    "read-failed": "execution-error",
    "conflict": "execution-error",
    "invalid-text": "execution-error",
};
