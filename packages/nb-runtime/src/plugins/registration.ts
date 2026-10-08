/**
 * 描述登记的纯结构校验：只看定义、宿主位置与贡献点占用。
 * 贡献点存在性、声明规则与重复贡献属于单条动态结果，不在这里拒绝整个插件。
 */

import type {RuntimeLocation} from "../lifecycle/lifecycle";

import type {PluginDefinition, RegistrationRejection, RegistrationRejectionReason} from "./contracts";

/** 内核保留的激活事件前缀；插件不能声明，也不能经 triggerActivationEvent 触发。 */
export const KERNEL_ACTIVATION_PREFIXES: ReadonlyArray<string> = ["onRemote"];

/** `<前缀>:<参数>` 拆开；`onStartup` 与格式不对的返回 null。 */
export function parseActivationEvent(event: string): {readonly prefix: string; readonly parameter: string} | null {
    const separator = event.indexOf(":");
    if (separator <= 0 || separator === event.length - 1) {
        return null;
    }
    return {prefix: event.slice(0, separator), parameter: event.slice(separator + 1)};
}

export interface RegistrationEnvironment {
    readonly location: RuntimeLocation;
    /** 本位置存活登记中已被其它插件占用的贡献点 id。 */
    contributionPointTaken(id: string): boolean;
}

function rejection(
    reason: RegistrationRejectionReason,
    detail: {readonly entry?: string | null; readonly capability?: string | null; readonly contribution?: string | null; readonly detail?: string | null} = {},
): RegistrationRejection {
    return {
        reason,
        entry: detail.entry ?? null,
        capability: detail.capability ?? null,
        contribution: detail.contribution ?? null,
        detail: detail.detail ?? null,
    };
}

export function validateDefinition(definition: PluginDefinition, environment: RegistrationEnvironment): RegistrationRejection[] {
    const rejections: RegistrationRejection[] = [];
    if (definition.id.trim() === "") {
        rejections.push(rejection("empty-id"));
    }
    if (definition.entries.length === 0) {
        rejections.push(rejection("no-entries"));
    }

    const prefixes = new Set<string>();
    for (const prefix of definition.activationEventPrefixes ?? []) {
        if (prefix.trim() === "" || prefix.includes(":") || prefixes.has(prefix)) {
            rejections.push(rejection("invalid-activation-prefix", {detail: prefix}));
        } else if (prefix === "onStartup" || KERNEL_ACTIVATION_PREFIXES.includes(prefix)) {
            rejections.push(rejection("reserved-activation-prefix", {detail: prefix}));
        }
        prefixes.add(prefix);
    }

    const pointIds = new Set<string>();
    for (const point of definition.contributionPoints ?? []) {
        if (point.id.trim() === "") {
            rejections.push(rejection("empty-id", {capability: point.id}));
        }
        if (pointIds.has(point.id)) {
            rejections.push(rejection("duplicate-contribution-point", {capability: point.id}));
        }
        if (environment.contributionPointTaken(point.id)) {
            rejections.push(rejection("duplicate-contribution-point", {capability: point.id}));
        }
        pointIds.add(point.id);
    }

    const entryIds = new Set<string>();
    // 服务属于实例：同一运行位置的入口之间不重复，不同位置的入口可以提供同一个 id（docs/adr/0026-plugin-definitions-as-constants.md）。
    const providedByLocation = new Map<RuntimeLocation, Set<string>>();
    const receiversByLocation = new Map<RuntimeLocation, Set<string>>();
    for (const entry of definition.entries) {
        if (entry.id.trim() === "") {
            rejections.push(rejection("empty-id", {entry: entry.id}));
        }
        if (entryIds.has(entry.id)) {
            rejections.push(rejection("duplicate-entry", {entry: entry.id}));
        }
        entryIds.add(entry.id);

        const localProvided = providedByLocation.get(entry.location) ?? new Set<string>();
        providedByLocation.set(entry.location, localProvided);
        for (const key of entry.provides ?? []) {
            if (localProvided.has(key.name)) {
                rejections.push(rejection("duplicate-service", {entry: entry.id, detail: key.name}));
            }
            localProvided.add(key.name);
            const prefix = `${definition.id}/`;
            if (!key.name.startsWith(prefix) || key.name.slice(prefix.length).trim() === "") {
                rejections.push(rejection("foreign-service-id", {entry: entry.id, detail: key.name}));
            } else if (key.name.slice(prefix.length) === "channel") {
                rejections.push(rejection("reserved-service-name", {entry: entry.id, detail: key.name}));
            }
        }

        const receives = entry.receives ?? [];
        const localReceivers = receiversByLocation.get(entry.location) ?? new Set<string>();
        for (const pointId of receives) {
            if (!pointIds.has(pointId)) {
                rejections.push(rejection("unknown-contribution-point", {entry: entry.id, capability: pointId}));
            }
            if (localReceivers.has(pointId)) {
                rejections.push(rejection("duplicate-receiver", {entry: entry.id, capability: pointId}));
            }
            localReceivers.add(pointId);
        }
        receiversByLocation.set(entry.location, localReceivers);

        for (const contribution of entry.contributions ?? []) {
            if (contribution.capability.trim() === "") {
                rejections.push(rejection("empty-id", {entry: entry.id, capability: contribution.capability, contribution: contribution.id}));
            }
            if (contribution.id.trim() === "") {
                rejections.push(rejection("empty-id", {entry: entry.id, capability: contribution.capability, contribution: contribution.id}));
            }
        }
        if (entry.location !== environment.location) {
            // 其它位置的入口只进目录描述，不在本宿主校验服务依赖。
            continue;
        }
        const provides = (entry.provides ?? []).map((key) => key.name);
        for (const dependency of entry.dependencies ?? []) {
            if (provides.includes(dependency.key.name)) {
                rejections.push(rejection("self-dependency", {entry: entry.id, detail: dependency.key.name}));
            }
        }
    }

    for (const contribution of definition.contributions ?? []) {
        if (contribution.capability.trim() === "") {
            rejections.push(rejection("empty-id", {capability: contribution.capability, contribution: contribution.id}));
        }
        if (contribution.id.trim() === "") {
            rejections.push(rejection("empty-id", {capability: contribution.capability, contribution: contribution.id}));
        }
    }
    return rejections;
}
