/**
 * 装配：把插件贡献的扩展、Profile 的 `extensions` 与 Profile 自己排成顺序并检查（extensions.md 输出 1、3）。
 *
 * 装配序：插件的扩展按依赖拓扑排序、同一层按 id；之后是 Profile 的 `extensions`（同样排序），最后是 Profile 自己。
 * 反应写入、槽拼接、`mount` 按装配序；拦截链从外到里也是这个顺序，审批在最里层之后。
 */

import {createHash} from "node:crypto";
import type {AnyExtension, AnyProfile, ContributedExtension, ExtensionFields, Scope} from "../api/index.js";
import type {Reducer} from "../state/snapshot.js";

/** 运行时看到的扩展：定义对象就是声明本身。 */
export type ExtensionDefinition = AnyExtension & Partial<ExtensionFields<string, any, any, any, any, any>>;

export interface Assembled {
    readonly definition: ExtensionDefinition;
    readonly plugin: string | null;
    readonly role: "plugin" | "profile-extension" | "profile";
    readonly version: string;
}

export interface AssemblyProblem {
    readonly code: "bad-extension-id" | "duplicate-extension-id" | "dependency-missing" | "dependency-cycle";
    readonly extension: string;
    readonly message: string;
    readonly hint: string;
}

export interface Assembly {
    readonly profile: AnyProfile;
    readonly order: readonly Assembled[];
    readonly reducers: readonly Reducer[];
    readonly hash: string;
    readonly manifest: readonly {id: string; version: string; plugin: string | null}[];
}

const PROFILE_ID = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/u;
const EXTENSION_ID = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9_-]*)*$/u;

function dependencyIds(definition: ExtensionDefinition): string[] {
    return (definition.dependsOn ?? []).flatMap((dependency: unknown) => {
        const contract = (dependency as {contract?: {id: string}}).contract ?? (dependency as {id: string});
        const optional = (dependency as {contract?: unknown}).contract !== undefined;
        return optional ? [] : [contract.id];
    });
}

/** 依赖在前、同一层按 id；成环时报问题。依赖不在这一组里的不参与排序（缺失另查）。 */
function topological(items: readonly Assembled[], problems: AssemblyProblem[]): Assembled[] {
    const byId = new Map(items.map((item) => [item.definition.id, item] as const));
    const placed = new Set<string>();
    const out: Assembled[] = [];
    let remaining = [...items].sort((a, b) => (a.definition.id < b.definition.id ? -1 : 1));
    while (remaining.length > 0) {
        const ready = remaining.filter((item) => dependencyIds(item.definition).every((id) => placed.has(id) || !byId.has(id)));
        if (ready.length === 0) {
            for (const item of remaining) problems.push({code: "dependency-cycle", extension: item.definition.id, message: `extension ${item.definition.id} is part of a dependency cycle`, hint: "remove one of the dependsOn entries in the cycle"});
            return [...out, ...remaining];
        }
        for (const item of ready) placed.add(item.definition.id);
        out.push(...ready);
        remaining = remaining.filter((item) => !placed.has(item.definition.id));
    }
    return out;
}

function reducerOf(definition: ExtensionDefinition): Reducer {
    const slices: Record<string, {scope: Scope; initial: unknown; resetOnCompaction: boolean}> = {};
    for (const [name, slice] of Object.entries((definition.state ?? {}) as Record<string, {scope: Scope; initial: unknown; resetOnCompaction: boolean}>)) slices[name] = slice;
    return {id: definition.id, slices, reduce: (definition.reduce ?? {}) as Reducer["reduce"]};
}

export function assemble(profile: AnyProfile, contributed: readonly ContributedExtension[]): {ok: true; assembly: Assembly} | {ok: false; problems: AssemblyProblem[]} {
    const problems: AssemblyProblem[] = [];
    const exclude = profile.pluginExtensions;
    const plugins = exclude === "none" ? [] : contributed.filter(({extension}) => !(exclude?.exclude ?? []).some((tag) => ((extension as ExtensionDefinition).tags ?? []).includes(tag)));
    const asAssembled = (definition: ExtensionDefinition, plugin: string | null, role: Assembled["role"]): Assembled => ({definition, plugin, role, version: definition.version ?? "0"});
    const pluginItems = plugins.map(({extension, plugin}) => asAssembled(extension as ExtensionDefinition, plugin, "plugin"));
    const ownItems = (profile.extensions ?? []).map((extension) => asAssembled(extension as ExtensionDefinition, null, "profile-extension"));
    const profileItem = asAssembled(profile as unknown as ExtensionDefinition, null, "profile");

    if (!PROFILE_ID.test(profile.id)) problems.push({code: "bad-extension-id", extension: profile.id, message: `profile id ${profile.id} must be <source>.<name>`, hint: "use builtin.<name>, user.<name> or <plugin>.<name>"});
    for (const item of [...pluginItems, ...ownItems]) {
        const id = item.definition.id;
        if (!EXTENSION_ID.test(id)) problems.push({code: "bad-extension-id", extension: id, message: `extension id ${id} must be dot-separated lowercase segments`, hint: "use <plugin id> or <plugin id>.<name>"});
        else if (item.plugin !== null && id !== item.plugin && !id.startsWith(`${item.plugin}.`)) problems.push({code: "bad-extension-id", extension: id, message: `extension ${id} is contributed by plugin ${item.plugin} but does not start with its id`, hint: `rename it to ${item.plugin} or ${item.plugin}.<name>`});
    }
    const seen = new Map<string, Assembled>();
    for (const item of [...pluginItems, ...ownItems, profileItem]) {
        const previous = seen.get(item.definition.id);
        if (previous !== undefined) problems.push({code: "duplicate-extension-id", extension: item.definition.id, message: previous.definition === item.definition ? `extension ${item.definition.id} is installed twice` : `extension id ${item.definition.id} is used twice`, hint: "each extension and profile id must be unique in a session"});
        seen.set(item.definition.id, item);
    }
    for (const item of [...pluginItems, ...ownItems, profileItem]) {
        for (const dependency of dependencyIds(item.definition)) {
            if (!seen.has(dependency)) problems.push({code: "dependency-missing", extension: item.definition.id, message: `extension ${item.definition.id} depends on ${dependency}, which is not installed`, hint: `install ${dependency}, or wrap it in optional() if ${item.definition.id} can work without it`});
        }
    }
    const order = [...topological(pluginItems, problems), ...topological(ownItems, problems), profileItem];
    if (problems.length > 0) return {ok: false, problems};
    const manifest = order.map((item) => ({id: item.definition.id, version: item.version, plugin: item.plugin}));
    const hash = createHash("sha256").update(JSON.stringify([profile.id, profile.version, manifest])).digest("hex");
    return {ok: true, assembly: {profile, order, reducers: order.map((item) => reducerOf(item.definition)), hash, manifest}};
}
