/**
 * `defineProfile` 与从模块识别 Profile（Spec 输出 12）。标记是本模块的 Symbol：同一进程里只装一份 nb-harness。
 */

import {PROFILE_ID_PATTERN} from "./definitions";
import type {Diagnostic, JsonValue, Profile, ProfileDefinition, ProfileResult} from "./types";
import {profileMarker} from "./types";

export function profileDefinitionProblem(definition: unknown): string | null {
    if (typeof definition !== "object" || definition === null) return "Profile 定义必须是对象";
    const d = definition as Partial<ProfileDefinition>;
    if (typeof d.id !== "string" || !PROFILE_ID_PATTERN.test(d.id)) return "id 必须是 1–64 个字符，[a-z0-9] 开头，其余为 [a-z0-9._-]";
    if (typeof d.name !== "string" || d.name === "") return "name 必须是非空字符串";
    if (typeof d.description !== "string" || d.description === "") return "description 必须是非空字符串";
    if (!Number.isInteger(d.version) || (d.version as number) < 1) return "version 必须是正整数";
    if (d.fields !== undefined && (typeof d.fields !== "object" || d.fields === null || Array.isArray(d.fields))) return "fields 必须是对象";
    if (typeof d.prompt !== "function") return "prompt 必须是函数";
    return null;
}

export function defineProfile(definition: ProfileDefinition): Profile {
    const problem = profileDefinitionProblem(definition);
    if (problem !== null) throw new TypeError(`Profile 定义不合规则：${problem}`);
    const fields: Record<string, JsonValue> = Object.freeze({...(definition.fields ?? {})});
    return Object.freeze({...definition, fields, [profileMarker]: true as const});
}

export const isProfile = (value: unknown): value is Profile =>
    typeof value === "object" && value !== null && (value as {[profileMarker]?: unknown})[profileMarker] === true;

export function profileFromModule(module: unknown, label = "模块"): ProfileResult<Profile> {
    const candidate = typeof module === "object" && module !== null ? (module as {default?: unknown}).default : undefined;
    if (!isProfile(candidate)) {
        const detail = candidate === undefined ? `${label} 没有默认导出` : `${label} 的默认导出不是 defineProfile 的结果`;
        return {ok: false, code: "invalid-profile", detail, diagnostics: []};
    }
    return {ok: true, value: candidate};
}

export function createProfileCatalog(groups: readonly {source: string; profiles: readonly Profile[]}[]): {list(): Profile[]; get(id: string): Profile | undefined; readonly issues: Diagnostic[]} {
    const issues: Diagnostic[] = [];
    const merged = new Map<string, Profile>();
    for (const group of groups) {
        const counts = new Map<string, number>();
        for (const profile of group.profiles) counts.set(profile.id, (counts.get(profile.id) ?? 0) + 1);
        for (const profile of group.profiles) {
            if ((counts.get(profile.id) ?? 0) > 1) {
                issues.push({severity: "error", code: "duplicate-profile", path: `${group.source}:${profile.id}`, detail: `组 ${group.source} 里有多个 id 为 ${profile.id} 的 Profile，都不收录`});
                merged.delete(profile.id);
                continue;
            }
            merged.set(profile.id, profile);
        }
    }
    return {list: () => [...merged.values()], get: (id) => merged.get(id), issues};
}
