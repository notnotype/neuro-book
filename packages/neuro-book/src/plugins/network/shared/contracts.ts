/**
 * `nbook.network` 对其它插件公开的合同（docs/specs/network/egress.md）：进程内服务 `networkKey`（模型服务与网页工具经它选路
 * 发请求）与网络页用的远程合同 `nbook.network/settings`。
 */

import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";
import {Type} from "typebox";
import type {Static} from "typebox";

/** 别的插件读本插件的设置项（`nbook.models` 读“自动更新模型列表”）经这里：跨插件只导入对方的合同模块。 */
export {networkSettings} from "./settings";

/** 一份代理设置（应用级的，或某家服务商自己的）；`url` 只在 `custom` 时用。形状同 nb-host 的 `ProxySetting`。 */
export interface ProxyOverride {
    readonly mode: "system" | "custom" | "direct";
    readonly url?: string | null;
}

/** 一次请求的路：`proxy` 交给 Bun 的按次 `proxy`；失败时请求不发。形状同 nb-host 的 `EgressRoute`。 */
export type NetworkRouteResult = {readonly ok: true; readonly proxy: string | false} | {readonly ok: false; readonly code: Static<typeof FailureCode>; readonly message: string};

/**
 * 网络出口（实现是 nb-host 的 `createEgress`；这里不导入它：`shared/` 也进浏览器的类型检查，那边是 Bun 的代码）。`override`
 * 是某家服务商自己的代理设置，不给时用应用级的（设置项现读）。`fetchFor` 选不出路时 reject nb-host 的 `EgressError`，请求没有
 * 发出；不改 `redirect`。
 */
export interface NetworkService {
    routeFor(override?: ProxyOverride): (url: URL) => Promise<NetworkRouteResult>;
    fetchFor(override?: ProxyOverride): typeof fetch;
    describe(target?: URL, override?: ProxyOverride): Promise<EgressSummaryView>;
}

export const networkKey: ServiceKey<NetworkService> = defineServiceKey<NetworkService>("nbook.network/egress");

const FailureCode = Type.Union([Type.Literal("proxy-unsupported"), Type.Literal("proxy-invalid"), Type.Literal("proxy-unreadable")]);
const NullableString = Type.Union([Type.String(), Type.Null()]);

/** 选路的说明（nb-host 的 `EgressSummary`）：不含用户名密码。 */
export const EgressSummarySchema = Type.Object({
    mode: Type.Union([Type.Literal("system"), Type.Literal("custom"), Type.Literal("direct")]),
    route: Type.Union([Type.Literal("proxy"), Type.Literal("bypassed"), Type.Literal("direct")]),
    source: Type.Union([
        Type.Object({kind: Type.Literal("setting")}, {additionalProperties: false}),
        Type.Object({kind: Type.Literal("direct")}, {additionalProperties: false}),
        Type.Object({kind: Type.Literal("env"), name: Type.String()}, {additionalProperties: false}),
        Type.Object({kind: Type.Literal("system"), name: Type.Union([Type.Literal("gnome"), Type.Literal("kde"), Type.Literal("macos"), Type.Literal("windows")])}, {additionalProperties: false}),
        Type.Object({kind: Type.Literal("none")}, {additionalProperties: false}),
        Type.Object({kind: Type.Literal("local")}, {additionalProperties: false}),
    ]),
    origin: NullableString,
    hasCredentials: Type.Boolean(),
    error: Type.Union([Type.Object({code: FailureCode, message: Type.String()}, {additionalProperties: false}), Type.Null()]),
}, {additionalProperties: false});
export type EgressSummaryView = Static<typeof EgressSummarySchema>;

export const EgressTestSchema = Type.Union([
    Type.Object({ok: Type.Literal(true), summary: EgressSummarySchema, ip: NullableString, elapsedMs: Type.Integer({minimum: 0})}, {additionalProperties: false}),
    Type.Object({
        ok: Type.Literal(false),
        summary: EgressSummarySchema,
        reason: Type.Union([FailureCode, Type.Literal("unreachable"), Type.Literal("timeout"), Type.Literal("cancelled"), Type.Literal("bad-response")]),
        status: Type.Union([Type.Integer(), Type.Null()]),
        message: Type.String(),
    }, {additionalProperties: false}),
]);
export type EgressTestView = Static<typeof EgressTestSchema>;

const Empty = Type.Object({}, {additionalProperties: false});

/**
 * 网络页用的远程合同：`describe` 现在的设置下测试目标会怎么走（跟随系统时写出用的代理与来源）；`test` 经选出的路请求一次测试目标
 * （Cloudflare 的 trace），交回出口 IP 与耗时。`test` 对外发请求但不改任何状态，重放无害，按读处理；调用方中止即取消。
 */
export const networkSettingsContract = defineRemoteService({
    id: "nbook.network/settings",
    version: 1,
    provider: "server",
    callers: ["browser"],
    methods: {
        describe: {input: Empty, output: EgressSummarySchema, effect: "read", errors: {}},
        test: {input: Empty, output: EgressTestSchema, effect: "read", errors: {}},
    },
});
