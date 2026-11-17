/**
 * 窗口里的 Skill（docs/specs/agent/skills.md 输出 1、5、26、28）：目录先订阅 `skillsChanged` 再取，`onResync` 重取；`$` 菜单、点开
 * 标签与 Skill 页都读这一份。菜单与点开是纯函数，宿主把目录、白名单与最近用过的交进来。
 */

import {shallowRef} from "vue";
import type {ShallowRef} from "vue";

import {promptSkillText} from "@notnotype/nb-markdown/prompt-text";
import type {TriggerMenu, TriggerMenuItem} from "@notnotype/nb-agent-ui";
import type {RemoteClient} from "@notnotype/nb-runtime/remote";

import type {agentSessionsContract} from "../shared/remote";
import {matchSkillToken} from "../shared/skills";
import type {SkillEntry} from "../shared/skills";

/** `$` 菜单里“打开 Profile 设置”那一项的 id：白名单为空时只有它（输出 26）。 */
export const OPEN_PROFILE_SETTINGS_ITEM = "nbook.agent.skills.open-profile-settings";
/** 最近用过的留几个。 */
const RECENT_LIMIT = 8;

export interface SkillsClient {
    /** null 是还没取到。 */
    readonly entries: ShallowRef<readonly SkillEntry[] | null>;
    /** 本窗口经菜单选过的，新的在前；刷新后清空（输出 26）。 */
    readonly recent: ShallowRef<readonly string[]>;
    /** 第一次用到时订阅并取目录；之后再调不做事。 */
    ensure(): void;
    touch(id: string): void;
}

export function createSkillsClient(remote: RemoteClient<typeof agentSessionsContract>, signal: AbortSignal, report: (message: string) => void): SkillsClient {
    const entries = shallowRef<readonly SkillEntry[] | null>(null);
    const recent = shallowRef<readonly string[]>([]);
    let started = false;
    const load = async (): Promise<void> => {
        const result = await remote.skills({});
        if (result.ok) entries.value = result.value;
        else report(`skills: ${result.code}`);
    };
    return {
        entries,
        recent,
        ensure() {
            if (started) return;
            started = true;
            void (async () => {
                const subscription = await remote.events.skillsChanged.subscribe({}, () => void load(), {onResync: () => void load()});
                if (!subscription.ok) {
                    report(`skills subscribe: ${subscription.code}`);
                    started = false;
                    return;
                }
                signal.addEventListener("abort", () => subscription.value.release(), {once: true});
                await load();
            })().catch((error: unknown) => report(`skills: ${String(error)}`));
        },
        touch(id) {
            recent.value = [id, ...recent.value.filter((other) => other !== id)].slice(0, RECENT_LIMIT);
        },
    };
}

export interface SkillMenuTexts {
    readonly title: string;
    readonly recentGroup: string;
    readonly allGroup: string;
    readonly noMatch: string;
    /** 白名单为空时那一项的名称与说明。 */
    readonly openSettings: string;
    readonly noSkills: string;
    readonly needsInit: string;
    readonly initializing: string;
}

export interface SkillMenuInput {
    readonly entries: readonly SkillEntry[] | null;
    /** 这个会话的 Profile 的白名单（`profileAllowlist`）。 */
    readonly allowed: readonly string[];
    readonly recent: readonly string[];
    readonly texts: SkillMenuTexts;
}

/**
 * `$` 菜单（输出 26）：白名单里、目录中有、不是无效的 Skill；最近用过的在前，其余按名字；同名的显示 id，插入时写 `${id}`。
 * 没有查询词时分“最近用过”“全部”两组，有查询词时不分组。查询词按名字找，带 `.` 时按 id 找（id 都以来源开头，短词按 id
 * 找会命中整个来源）。
 */
export function skillMenu(query: string, input: SkillMenuInput): TriggerMenu {
    const {texts} = input;
    if (input.entries === null) return {title: texts.title, items: [], loading: true};
    const allowed = new Set(input.allowed);
    const usable = input.entries.filter((entry) => allowed.has(entry.id) && entry.status !== "invalid");
    if (usable.length === 0) {
        // 去设置的那一项只在刚打 `$` 时给：它会被回车选中，`$` 后面已经有字（“$50”）时回车要照常发送。
        if (query !== "") return {title: texts.title, items: [], emptyText: texts.noSkills};
        return {title: texts.title, items: [{id: OPEN_PROFILE_SETTINGS_ITEM, label: texts.openSettings, description: texts.noSkills, iconClass: "i-lucide-settings", insertText: "", continues: true}]};
    }
    // 名字认得回它自己才写名字，与服务端认标签同一个规则：同名的另一个哪怕无效，只要在白名单里也算重名。
    const entries = input.entries;
    const byName = (entry: SkillEntry): boolean => {
        const matched = matchSkillToken(entry.name, entries, (each) => each, allowed);
        return matched.ok && matched.item.id === entry.id;
    };
    const needle = query.toLowerCase();
    const matched = needle === "" ? usable : usable.filter((entry) => (needle.includes(".") ? entry.id : entry.name).toLowerCase().includes(needle));
    const rank = new Map(input.recent.map((id, index) => [id, index]));
    const recent = matched.filter((entry) => rank.has(entry.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    const rest = matched.filter((entry) => !rank.has(entry.id)).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const grouped = needle === "" && recent.length > 0;
    const item = (entry: SkillEntry, group: string | undefined): TriggerMenuItem => {
        const duplicated = !byName(entry);
        return {
            id: entry.id,
            label: duplicated ? entry.id : entry.name,
            description: entry.description,
            iconClass: "i-lucide-sparkles",
            ...(group === undefined ? {} : {group}),
            insertText: (duplicated ? null : promptSkillText(entry.name)) ?? promptSkillText(entry.id) ?? entry.id,
            ...(entry.status === "needs-init" ? {status: {label: texts.needsInit, iconClass: "i-lucide-download", tone: "warning" as const}} : {}),
            ...(entry.status === "initializing" ? {status: {label: texts.initializing, busy: true}} : {}),
        };
    };
    return {
        title: texts.title,
        emptyText: texts.noMatch,
        items: [...recent.map((entry) => item(entry, grouped ? texts.recentGroup : undefined)), ...rest.map((entry) => item(entry, grouped ? texts.allGroup : undefined))],
    };
}

/**
 * 点开 Skill 标签要打开的地址（输出 28）：按名字现认（同输出 7），用户的打开 `user://skills/<名字>/SKILL.md`（能改），其余打开
 * `skills://<id>/SKILL.md`（只读）；认不到交回 null。
 */
export function skillAddress(token: string, entries: readonly SkillEntry[], allowed: readonly string[]): string | null {
    const matched = matchSkillToken(token, entries, (entry) => entry, new Set(allowed));
    if (!matched.ok) return null;
    return matched.item.source === "user" ? `user://skills/${matched.item.name}/SKILL.md` : matched.item.location;
}
