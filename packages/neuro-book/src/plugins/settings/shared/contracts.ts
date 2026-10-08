/**
 * `nbook.settings` 的服务键与远程服务合同（docs/specs/settings/configuration.md）。
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
import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, DisplayText, LocalizedText} from "nbook/shared/localized-text";
import {defineSetting, SETTINGS_FAILURES, SETTINGS_POINT} from "nbook/shared/settings";
import type {SettingDefinition, SettingsFailure, SettingsService} from "nbook/shared/settings";

export {SETTINGS_POINT};

/** 插件依赖它取得按调用方生成的配置服务。 */
export const settingsKey: ServiceKey<SettingsService> = defineServiceKey<SettingsService>("nbook.settings/settings");

/** 界面语言：平台级设置，只允许用户层（项目文件可能来自别人的仓库，不该替用户换语言）。 */
export const localeSetting = defineSetting({
    plugin: "nbook.settings",
    name: "locale",
    schema: Type.Union([Type.Literal("zh-CN"), Type.Literal("en-US")]),
    default: "zh-CN",
    title: {"zh-CN": "界面语言", "en-US": "Display Language"},
    layers: ["user"],
});

/** 当前显示语言；在 computed 或 effect 里读时随设置变化重新求值。 */
export function displayLocale(settings: SettingsService): DisplayLocale {
    return settings.get(localeSetting);
}

const RevisionSchema = Type.Object({boot: Type.String(), seq: Type.Integer({minimum: 0})}, {additionalProperties: false});
const ProblemSchema = Type.Object({key: Type.String(), reason: Type.Union([Type.Literal("invalid-value"), Type.Literal("layer-not-allowed")])}, {additionalProperties: false});
const ValuesSchema = Type.Record(Type.String(), Type.Unknown());

export const LayerSnapshotSchema = Type.Union([
    Type.Object({status: Type.Literal("ok"), revision: RevisionSchema, values: ValuesSchema, problems: Type.Array(ProblemSchema)}, {additionalProperties: false}),
    Type.Object({status: Type.Literal("invalid"), revision: RevisionSchema, values: ValuesSchema, problems: Type.Array(ProblemSchema), detail: Type.String()}, {additionalProperties: false}),
]);

const SettingsFailedDetail = Type.Object({code: Type.Enum(SETTINGS_FAILURES), detail: Type.String()}, {additionalProperties: false});
const Written = Type.Object({snapshot: LayerSnapshotSchema}, {additionalProperties: false});
const failures = {"settings-failed": SettingsFailedDetail};

/**
 * 只写调用方插件自己声明的项；成功时带回写后的层快照，调用方据此先更新本实例再结算。删除是单独的方法，不靠 JSON
 * 保留 undefined。
 */
const methods = {
    set: {input: Type.Object({key: Type.String(), value: Type.Unknown()}, {additionalProperties: false}), output: Written, effect: "write", errors: failures},
    remove: {input: Type.Object({key: Type.String()}, {additionalProperties: false}), output: Written, effect: "write", errors: failures},
} as const;

/** 订阅先推一次当前快照，之后层的状态、键值、被丢弃的键或无效原因变化时推送。 */
const events = {layer: {filter: Type.Object({}, {additionalProperties: false}), payload: LayerSnapshotSchema}} as const;

export const userSettingsContract = defineRemoteService({id: "nbook.settings/user", version: 1, provider: "server", callers: ["browser", "tui", "project"], methods, events});

export const projectSettingsContract = defineRemoteService({id: "nbook.settings/project", version: 1, provider: "project", callers: ["browser", "tui"], methods, events});

export type SettingsContract = typeof userSettingsContract | typeof projectSettingsContract;

/** 切换某个配置项的选项：值与它的显示文字。 */
export interface SettingChoice<T extends string> {
    readonly id: T;
    readonly label: DisplayText;
}

const COMMAND_TEXT = {
    current: {"zh-CN": "当前", "en-US": "current"},
    placeholder: {"zh-CN": "选中后立即生效", "en-US": "Takes effect immediately"},
    failed: {"zh-CN": "配置写入失败（{code}）：{detail}", "en-US": "Settings write failed ({code}): {detail}"},
} satisfies Record<string, LocalizedText>;

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
    readonly title: LocalizedText;
}): Promise<CommandResult<null>> {
    const {settings, setting} = options;
    let value = options.value;
    if (value === undefined) {
        const current = settings.get(setting) as T;
        const picked = await options.quickPick.pick({
            title: options.title,
            placeholder: COMMAND_TEXT.placeholder,
            items: options.choices.map((choice) => ({id: choice.id, label: choice.label, ...(choice.id === current ? {detail: COMMAND_TEXT.current} : {})})),
        });
        if (picked.kind === "cancelled") return {ok: true, value: null};
        if (picked.kind === "unavailable") return {ok: false, code: "unavailable", reason: picked.reason};
        const chosen = options.choices.find((choice) => choice.id === (picked.kind === "item" ? picked.id : picked.text));
        if (chosen === undefined) return {ok: true, value: null};
        value = chosen.id;
    }
    const result = await settings.update(setting, value);
    if (result.ok) return {ok: true, value: null};
    const reason = localize(formatText(COMMAND_TEXT.failed, {code: result.code, detail: result.detail}), displayLocale(settings));
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
};
