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
}): SessionListStore {
    const entries = shallowRef<readonly SessionIndexEntry[]>([]);
    const query = ref("");
    const scope = ref<"project" | "all">(options.project === null ? "all" : "project");
    const selectedProfiles = ref<ReadonlySet<string>>(new Set());
    const showArchived = ref(false);
    const loading = ref(false);
    const error = ref<string | null>(null);

    /** 只有最后一次请求的结果算数：换范围时前一次可能还在路上。 */
    let latest = 0;
    async function refresh(): Promise<void> {
        latest += 1;
        const token = latest;
        loading.value = true;
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
    const items = computed<readonly AgentSessionListItem[]>(() => {
        const activity = new Map(options.activity().map((item) => [item.id, item.state]));
        const needle = query.value.trim().toLowerCase();
        return entries.value
            .filter((entry) => selectedProfiles.value.size === 0 || selectedProfiles.value.has(entry.profile))
            .filter((entry) => needle === "" || `${entry.title ?? ""}\n${entry.description ?? ""}`.toLowerCase().includes(needle))
            .map((entry): AgentSessionListItem => {
                const profile = profileById.value.get(entry.profile);
                return {
                    id: entry.id,
                    title: entry.title ?? "",
                    ...(entry.description === null ? {} : {description: entry.description}),
                    updatedAt: entry.lastActivityAt,
                    status: activity.get(entry.id) ?? "idle",
                    ...(profile?.icon === undefined ? {} : {icon: profile.icon}),
                    iconTitle: profile?.name ?? entry.profile,
                    ...(entry.archived ? {archived: true} : {}),
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
