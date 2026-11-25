/**
 * `nbook.web` 对其它插件公开的合同（docs/specs/web/tools.md）：两个工具的 id、失败码，与设置页用的远程合同
 * `nbook.web/settings`（输出 16 到 19）。
 */

import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import {Type} from "typebox";
import type {Static} from "typebox";

export {SEARCH_SECTION} from "./settings";
export {isWebProvider, PROVIDER_LABELS, WEB_PROVIDERS} from "./providers";
export type {WebProviderId} from "./providers";

export const SEARCH_TOOL = "nbook.web.search";
export const FETCH_TOOL = "nbook.web.fetch";

/** 服务客户端的失败分类（输出 12 与“失败与恢复”）。 */
export const PROVIDER_FAILURE_CODES = ["auth", "quota", "rate-limited", "invalid-request", "rejected", "not-found", "unreachable", "timeout", "too-large", "bad-response", "failed"] as const;
export type ProviderFailureCode = (typeof PROVIDER_FAILURE_CODES)[number];

/** 工具与检测交回的失败码：服务的失败加上密钥这一侧的两种。 */
export const WEB_FAILURE_CODES = [...PROVIDER_FAILURE_CODES, "no-key", "credentials-unavailable"] as const;
export type WebFailureCode = (typeof WEB_FAILURE_CODES)[number];

const Detail = Type.Object({detail: Type.String()}, {additionalProperties: false});
/** 不在合同里限定取值：不认识的服务（含空串）由实现报 `invalid-value`（docs/specs/web/tools.md 输出 17），不是合同层的 `invalid-input`。 */
const ProviderSchema = Type.String();

const ProviderStatusSchema = Type.Object({hasKey: Type.Boolean()}, {additionalProperties: false});
/** 每家一条（输出 16）；加服务时这里多一条。 */
const StatusSchema = Type.Object({
    providers: Type.Object({deepseek: ProviderStatusSchema, tavily: ProviderStatusSchema}, {additionalProperties: false}),
}, {additionalProperties: false});
export type WebKeyStatus = Static<typeof StatusSchema>;

const CheckResultSchema = Type.Union([
    Type.Object({ok: Type.Literal(true)}, {additionalProperties: false}),
    Type.Object({ok: Type.Literal(false), code: Type.Enum(WEB_FAILURE_CODES), detail: Type.Optional(Type.String())}, {additionalProperties: false}),
]);
export type WebCheckResult = Static<typeof CheckResultSchema>;

/**
 * 设置页用的远程合同（输出 16 到 19）。`setKey`、`clearKey` 交回写后的状态；`check` 会发一次计费的搜索，所以按写处理：
 * 链路中断时调用方得 `unknown-outcome`，运行时不重放（docs/specs/runtime/plugin-channel.md）。
 */
export const webSettingsContract = defineRemoteService({
    id: "nbook.web/settings",
    version: 1,
    provider: "server",
    callers: ["browser"],
    methods: {
        status: {input: Type.Object({}, {additionalProperties: false}), output: StatusSchema, effect: "read", errors: {"credentials-unavailable": Detail}},
        setKey: {input: Type.Object({provider: ProviderSchema, key: Type.String()}, {additionalProperties: false}), output: StatusSchema, effect: "write", errors: {"invalid-value": Detail, "credentials-unavailable": Detail}},
        clearKey: {input: Type.Object({provider: ProviderSchema}, {additionalProperties: false}), output: StatusSchema, effect: "write", errors: {"invalid-value": Detail, "credentials-unavailable": Detail}},
        check: {input: Type.Object({provider: ProviderSchema}, {additionalProperties: false}), output: CheckResultSchema, effect: "write", errors: {"invalid-value": Detail}},
    },
});
