<script setup lang="ts">
import {Badge, EmptyState} from "@notnotype/nb-ui/components";
import {computed} from "vue";
import {sessionName, taskLabel, workLabel} from "../host/format.js";
import {groupInbox} from "../host/inbox.js";
import {artifactHref, docHref, isPlainClick} from "../host/routes.js";
import type {ConflictLocation, InboxItem, SessionTitle} from "../host/types.js";
import ActionLink from "./ActionLink.vue";
import LeaseChip from "./LeaseChip.vue";

/** 首页收件箱：待答的提问按产物合并成一行，正在发生的撞号一条一行。契约见同名 .md。 */
const props = defineProps<{
    items: InboxItem[];
    /** 会话标题（首页数据的 `sessionTitles`，t17），提问者写标题加短键。 */
    sessionTitles: Readonly<Record<string, SessionTitle>>;
}>();
const emit = defineEmits<{navigate: [href: string]}>();
const rows = computed(() => groupInbox(props.items));
/** 撞号的处理办法写在 .agents/works/README.md（先定保留哪个，另一个领新号）。 */
const CONFLICT_HELP = docHref("main", ".agents/works/README.md");
/** 位置写短：worktree 只写目录名；已提交的 ref 只列两个本地分支，其余（远端、别的分支）记个数。 */
function conflictPlaces(locations: readonly ConflictLocation[]): string {
    const places = new Set<string>();
    const branches: string[] = [];
    let otherRefs = 0;
    for (const location of locations) {
        if (location.source === "main") places.add("主工作区");
        else if (location.source === "worktree") places.add(`worktree ${(location.checkout ?? "").split("/").filter(Boolean).at(-1) ?? ""}`);
        else if (location.ref?.startsWith("refs/heads/") && branches.length < 2) branches.push(location.ref.slice("refs/heads/".length));
        else otherRefs += 1;
    }
    if (branches.length > 0) places.add(`已提交在 ${branches.join("、")}${otherRefs > 0 ? ` 等 ${branches.length + otherRefs} 个 ref` : ""}`);
    else if (otherRefs > 0) places.add(`已提交在 ${otherRefs} 个 ref`);
    return [...places].join("、") || "位置未知";
}
/** 一行里列出的题数上限，其余写“等 N 道”。 */
const SHOWN = 3;
function follow(event: MouseEvent, href: string): void {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    emit("navigate", href);
}
</script>

<template>
    <EmptyState v-if="items.length === 0" icon-class="i-lucide-inbox" title="收件箱是空的" description="没有等你答的题，也没有正在发生的撞号" />
    <ul v-else class="flex flex-col">
        <li v-for="row in rows" :key="row.kind === 'artifact' ? row.key : `conflict:${row.label}`" class="border-b last:border-b-0 nbdev-divider">
            <a v-if="row.kind === 'artifact'" :href="artifactHref(row.workId, row.taskId, row.artifactId)" class="flex w-full min-w-0 flex-col gap-1 px-1 py-2 hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)]" @click="follow($event, artifactHref(row.workId, row.taskId, row.artifactId))">
                <span class="flex min-w-0 items-center gap-2">
                    <span class="i-lucide-message-circle-question size-4 shrink-0 nbdev-warn" aria-hidden="true" />
                    <span class="truncate font-medium">{{ row.title ?? row.artifactId }}</span>
                    <Badge class="shrink-0" tone="warning" variant="soft" size="sm">待答 {{ row.questions.length }}</Badge>
                </span>
                <span class="nbdev-secondary min-w-0 pl-6 break-words">
                    {{ row.questions.slice(0, SHOWN).map((question) => question.label).join("；") }}<template v-if="row.questions.length > SHOWN">；等 {{ row.questions.length }} 道</template>
                </span>
                <span class="flex flex-wrap items-center gap-x-2 gap-y-1 pl-6 nbdev-note">
                    <span>{{ workLabel(row.workId) }} / {{ taskLabel(row.taskId) }} · {{ row.artifactId }}</span>
                    <LeaseChip v-for="asker in row.askers" :key="asker.key" :session="sessionName(asker.key, null, sessionTitles)" :ended="asker.active === false" :hint="asker.active === false ? '提问的会话已经不在（租约失效），答了要等别的会话来采纳' : '提问的会话'" />
                    <span v-if="row.askers.length === 0" class="nbdev-empty">提问者未知</span>
                </span>
            </a>
            <div v-else class="flex min-w-0 flex-col gap-1 px-1 py-2">
                <span class="flex min-w-0 flex-wrap items-center gap-2">
                    <span class="i-lucide-triangle-alert size-4 shrink-0 nbdev-danger" aria-hidden="true" />
                    <span class="font-medium">撞号 {{ row.label }}</span>
                    <Badge tone="danger" variant="soft" size="sm">正在发生</Badge>
                </span>
                <!-- 原因：同一个号被哪几个名字用了、各在哪里；只在改名或删除后留下的旧副本里的，标出来。 -->
                <span class="nbdev-secondary min-w-0 pl-6 break-words">{{ row.ids.length }} 个名字用了同一个号：</span>
                <ul class="nbdev-note min-w-0 pl-6">
                    <li v-for="entry in row.ids" :key="entry.id" class="break-words">
                        <span class="font-mono">{{ entry.id }}</span>：{{ conflictPlaces(entry.locations) }}<template v-if="!entry.live">（只在改名或删除后留下的旧副本里）</template>
                    </li>
                </ul>
                <span class="pl-5"><ActionLink :href="CONFLICT_HELP" icon="i-lucide-book-open" @navigate="(href) => emit('navigate', href)">怎么处理</ActionLink></span>
            </div>
        </li>
    </ul>
</template>
