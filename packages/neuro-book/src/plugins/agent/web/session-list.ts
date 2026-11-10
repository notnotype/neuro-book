/**
 * 会话面板的数据（docs/specs/agent/conversation.md 输出 2、3）：下拉和左栏视图共用一份。列表来自服务端（归档的另取），搜索在这里过滤标题和说明，
 * 运行状态来自活动条目。没有打开作品时只有“全部”。
 */

import {computed, ref, shallowRef} from "vue";
import type {ComputedRef, Ref} from "vue";

import type {AgentSessionListItem, SessionPanelFilter} from "@notnotype/nb-agent-ui";
import type {RemoteClient} from "@notnotype/nb-runtime/remote";

import type {SessionIndexEntry} from "@notnotype/nb-harness/kernel/contracts";

import type {ProfileEntry} from "../shared/contracts";
import type {ActivityItem, agentSessionsContract} from "../shared/remote";

export interface SessionListStore {
    readonly items: ComputedRef<readonly AgentSessionListItem[]>;
    readonly query: Ref<string>;
    readonly scope: Ref<"project" | "all">;
    readonly canScope: boolean;
    readonly profiles: ComputedRef<readonly SessionPanelFilter[]>;
    readonly showArchived: Ref<boolean>;
    readonly loading: Ref<boolean>;
    readonly error: Ref<string | null>;
    /** 分组与时间列按它算，每次刷新更新：空闲时也要跨过午夜。 */
    readonly now: Ref<number>;
    /** 子会话的展开记录（面板受控，关掉再打开还在）。 */
    readonly expanded: Ref<Readonly<Record<string, boolean>>>;
    toggleProfile(id: string): void;
    setScope(scope: "project" | "all"): void;
    setShowArchived(show: boolean): void;
    refresh(): Promise<void>;
}

export function createSessionList(options: {
    readonly remote: RemoteClient<typeof agentSessionsContract>;
    readonly project: string | null;
    readonly profileEntries: () => readonly ProfileEntry[];
    readonly activity: () => readonly ActivityItem[];
    readonly failed: (code: string) => string;
    readonly now: () => number;
}): SessionListStore {
    const entries = shallowRef<readonly SessionIndexEntry[]>([]);
    const query = ref("");
    const scope = ref<"project" | "all">(options.project === null ? "all" : "project");
    const selectedProfiles = ref<ReadonlySet<string>>(new Set());
    const showArchived = ref(false);
    const loading = ref(false);
    const error = ref<string | null>(null);
    const now = ref(options.now());
    const expanded = ref<Readonly<Record<string, boolean>>>({});

    /** 只有最后一次请求的结果算数：换范围时前一次可能还在路上。 */
    let latest = 0;
    async function refresh(): Promise<void> {
        latest += 1;
        const token = latest;
        loading.value = true;
        now.value = options.now();
        const filter = {...(scope.value === "project" && options.project !== null ? {project: options.project} : {}), ...(showArchived.value ? {archived: true} : {})};
        const result = await options.remote.list(filter);
        if (token !== latest) return;
        loading.value = false;
        if (result.ok) {
            entries.value = result.value;
            error.value = null;
        } else error.value = options.failed(result.code);
    }

    const profileById = computed(() => new Map(options.profileEntries().map((profile) => [profile.key, profile])));
    /**
     * 子会话挂在父会话下（conversation.md 输出 3 的子会话部分）：个数与“子代理等你处理”按未过滤的会话算；过滤命中子会话时把它的祖先一并
     * 交进来、标 `dimmed`；父会话的时间取自身与后代中最新的，跟着最新的子代理排到前面。
     */
    const items = computed<readonly AgentSessionListItem[]>(() => {
        const activity = new Map(options.activity().map((item) => [item.id, item.state]));
        const needle = query.value.trim().toLowerCase();
        const all = entries.value as readonly (SessionIndexEntry & {readonly parent?: string})[];
        const byId = new Map(all.map((entry) => [entry.id, entry]));
        const children = new Map<string, string[]>();
        for (const entry of all) if (entry.parent !== undefined && byId.has(entry.parent)) children.set(entry.parent, [...(children.get(entry.parent) ?? []), entry.id]);
        const descendants = (id: string, seen = new Set<string>()): string[] => (children.get(id) ?? []).filter((child) => !seen.has(child) && seen.add(child)).flatMap((child) => [child, ...descendants(child, seen)]);
        const matches = (entry: SessionIndexEntry) => (selectedProfiles.value.size === 0 || selectedProfiles.value.has(entry.profile))
            && (needle === "" || `${entry.title ?? ""}\n${entry.description ?? ""}`.toLowerCase().includes(needle));
        const matched = new Set(all.filter(matches).map((entry) => entry.id));
        // 命中的会话的祖先也列出（弱化）：子会话不会脱离父会话单独出现。
        const listed = new Set(matched);
        for (const id of matched) {
            const seen = new Set<string>();
            for (let parent = byId.get(id)?.parent; parent !== undefined && byId.has(parent) && !seen.has(parent); parent = byId.get(parent)?.parent) {
                seen.add(parent);
                listed.add(parent);
            }
        }
        return all
            .filter((entry) => listed.has(entry.id))
            .map((entry): AgentSessionListItem => {
                const profile = profileById.value.get(entry.profile);
                const below = descendants(entry.id);
                const latest = Math.max(entry.lastActivityAt, ...below.map((id) => byId.get(id)?.lastActivityAt ?? 0));
                const kids = children.get(entry.id)?.length ?? 0;
                return {
                    id: entry.id,
                    title: entry.title ?? "",
                    ...(entry.description === null ? {} : {description: entry.description}),
                    updatedAt: latest,
                    status: activity.get(entry.id) ?? "idle",
                    ...(profile?.icon === undefined ? {} : {icon: profile.icon}),
                    iconTitle: profile?.name ?? entry.profile,
                    ...(entry.archived ? {archived: true} : {}),
                    ...(entry.parent !== undefined && byId.has(entry.parent) ? {parentId: entry.parent} : {}),
                    ...(kids === 0 ? {} : {childCount: kids}),
                    ...(below.some((id) => activity.get(id) === "waiting") ? {childWaiting: true} : {}),
                    ...(matched.has(entry.id) ? {} : {dimmed: true}),
                };
            })
            .sort((a, b) => b.updatedAt - a.updatedAt);
    });
    const profiles = computed<readonly SessionPanelFilter[]>(() => options.profileEntries().filter((profile) => profile.hidden !== true).map((profile) => ({id: profile.key, label: profile.name, ...(profile.icon === undefined ? {} : {icon: profile.icon}), active: selectedProfiles.value.has(profile.key)})));

    return {
        items,
        query,
        scope,
        canScope: options.project !== null,
        profiles,
        showArchived,
        loading,
        error,
        now,
        expanded,
        toggleProfile(id) {
            const next = new Set(selectedProfiles.value);
            if (!next.delete(id)) next.add(id);
            selectedProfiles.value = next;
        },
        setScope(value) {
            scope.value = value;
            void refresh();
        },
        setShowArchived(show) {
            showArchived.value = show;
            void refresh();
        },
        refresh,
    };
}
