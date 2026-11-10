/**
 * NeuroBook 的状态根认领档案（docs/specs/runtime/server-host.md 的“实例认领”）：认领协议在 `@notnotype/nb-host/server`，
 * 这里给 NeuroBook 的套接字名前缀、版本与应答里的第三方插件集合，并把档案绑进认领与查询。产品入口、`nbook start`、
 * `nbook plugin` 与测试的子进程入口都经这里认领或查询，应答的形状只有这一份。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import {claimStateRoot, defineClaimProfile, queryInstance} from "@notnotype/nb-host/server";
import type {ClaimOptions, ClaimProfile, ClaimResult as HostClaimResult, InstanceInfo as HostInstanceInfo, InstanceQuery as HostInstanceQuery, StateRootClaim as HostStateRootClaim} from "@notnotype/nb-host/server";

import {NotLoadedSchema} from "nbook/plugin-platform/shared/types";
import {PRODUCT_VERSION} from "nbook/shared/product";

const InstancePluginSchema = Type.Object({
    id: Type.String(),
    version: Type.String(),
    state: Type.Union([Type.Literal("enabled"), Type.Literal("disabled"), Type.Literal("uninstalling")]),
    /** 本次启动没有登记的原因；登记了为 null。 */
    notLoaded: Type.Union([NotLoadedSchema, Type.Null()]),
});
/** 运行中实例的一个第三方插件（本次启动的集合，`nbook plugin list` 拿它算待生效的变化）。 */
export type InstancePlugin = Static<typeof InstancePluginSchema>;

/** 应答里 NeuroBook 自己的字段：本次启动的第三方插件，还没就绪为 null。 */
const NBOOK_FIELDS = {plugins: Type.Object({safeMode: Type.Boolean(), items: Type.Array(InstancePluginSchema)})};
type NeuroBookFields = typeof NBOOK_FIELDS;

export type InstanceInfo = HostInstanceInfo<NeuroBookFields>;
export type StateRootClaim = HostStateRootClaim<NeuroBookFields>;
export type ClaimResult = HostClaimResult<NeuroBookFields>;
export type InstanceQuery = HostInstanceQuery<NeuroBookFields>;

function neuroBookClaim(version: string): ClaimProfile<NeuroBookFields> {
    return defineClaimProfile({socketPrefix: "nbook", version, fields: NBOOK_FIELDS});
}

const NBOOK_CLAIM = neuroBookClaim(PRODUCT_VERSION);

/** 认领状态根。`version` 缺省是本产品的版本，只有测试给别的值（模拟版本不同的已有实例）。 */
export function claimNeuroBook(options: Omit<ClaimOptions<NeuroBookFields>, "profile"> & {readonly version?: string}): Promise<ClaimResult> {
    const profile = options.version === undefined ? NBOOK_CLAIM : neuroBookClaim(options.version);
    return claimStateRoot({stateRoot: options.stateRoot, kind: options.kind, report: options.report, profile});
}

/** 问状态根上有没有实例；应答按 NeuroBook 的形状完整校验。 */
export function queryNeuroBook(stateRoot: string, timeoutMs?: number): Promise<InstanceQuery> {
    return queryInstance(stateRoot, NBOOK_CLAIM, timeoutMs);
}
