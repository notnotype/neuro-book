/**
 * 描述登记的纯校验：只看定义、宿主位置、接收者与服务键登记表，不触碰作用域或 runtime.services。
 * 整个定义作为一个单位判定：任一拒绝即全部不登记，调用方据此避免留下部分声明。
 */

import type {RuntimeLocation} from "../lifecycle/lifecycle";
import type {ServiceKey} from "../services/services";

import type {ContributionReceiver, PluginDefinition, RegistrationRejection, RegistrationRejectionReason} from "./contracts";

export interface RegistrationEnvironment {
    readonly location: RuntimeLocation;
    readonly receivers: ReadonlyMap<string, ContributionReceiver>;
    hasKey(key: ServiceKey<unknown>): boolean;
    /** 本位置目录里已被存活登记占用的贡献身份（`capability:id`）。 */
    contributionTaken(capability: string, id: string): boolean;
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
    const entryIds = new Set<string>();
    const localContributions = new Set<string>();
    const providedNames = new Set<string>();
    for (const entry of definition.entries) {
        if (entry.id.trim() === "") {
            rejections.push(rejection("empty-id", {entry: entry.id}));
        }
        if (entryIds.has(entry.id)) {
            rejections.push(rejection("duplicate-entry", {entry: entry.id}));
        }
        entryIds.add(entry.id);
        for (const key of entry.provides ?? []) {
            if (providedNames.has(key.name)) {
                rejections.push(rejection("duplicate-service", {entry: entry.id, detail: key.name}));
            }
            providedNames.add(key.name);
            const prefix = `${definition.id}/`;
            if (!key.name.startsWith(prefix) || key.name.slice(prefix.length).trim() === "") {
                rejections.push(rejection("foreign-service-id", {entry: entry.id, detail: key.name}));
            } else if (key.name.slice(prefix.length) === "channel") {
                rejections.push(rejection("reserved-service-name", {entry: entry.id, detail: key.name}));
            }
        }
        if (entry.location !== environment.location) {
            // 其它位置的入口只进目录描述，不在本宿主校验接收者与服务键。
            continue;
        }
        const provides = entry.provides ?? [];
        for (const key of provides) {
            if (!environment.hasKey(key)) {
                rejections.push(rejection("unknown-service-key", {entry: entry.id, detail: key.name}));
            }
        }
        for (const dependency of entry.dependencies ?? []) {
            if (!environment.hasKey(dependency.key)) {
                rejections.push(rejection("unknown-service-key", {entry: entry.id, detail: dependency.key.name}));
            }
            if (provides.includes(dependency.key)) {
                rejections.push(rejection("self-dependency", {entry: entry.id, detail: dependency.key.name}));
            }
        }
        for (const contribution of entry.contributions ?? []) {
            const identity = `${contribution.capability}:${contribution.id}`;
            if (contribution.id.trim() === "") {
                rejections.push(rejection("empty-id", {entry: entry.id, capability: contribution.capability, contribution: contribution.id}));
            }
            if (localContributions.has(identity) || environment.contributionTaken(contribution.capability, contribution.id)) {
                rejections.push(rejection("duplicate-contribution", {entry: entry.id, capability: contribution.capability, contribution: contribution.id}));
            }
            localContributions.add(identity);
            const receiver = environment.receivers.get(contribution.capability);
            if (receiver === undefined) {
                rejections.push(rejection("unknown-receiver", {entry: entry.id, capability: contribution.capability, contribution: contribution.id}));
                continue;
            }
            const verdict = receiver.validate?.({
                ...contribution,
                plugin: definition.id,
                entry: entry.id,
                location: entry.location,
            });
            if (verdict !== undefined && verdict !== null) {
                rejections.push(rejection("invalid-declaration", {entry: entry.id, capability: contribution.capability, contribution: contribution.id, detail: verdict}));
            }
        }
    }
    return rejections;
}
