<script setup lang="ts">
import {Badge, EmptyState} from "@notnotype/nb-ui/components";
import {computed} from "vue";
import {taskLabel, workLabel} from "../host/format.js";
import {artifactHref, docHref, isPlainClick, taskHref} from "../host/routes.js";
import type {ArtifactListItem, DocumentListItem, EvidenceListItem} from "../host/types.js";

const props = defineProps<{artifacts: ArtifactListItem[]; documents: DocumentListItem[]; evidences: EvidenceListItem[]}>();
const emit = defineEmits<{navigate: [href: string]}>();
function follow(event: MouseEvent, href: string): void {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    emit("navigate", href);
}

const GROUPS: Array<{key: ArtifactListItem["category"]; title: string}> = [
    {key: "design", title: "设计稿"}, {key: "report", title: "讲解与报告"}, {key: "review", title: "审查报告"},
    {key: "questions", title: "提问集"}, {key: "unpublished", title: "还没发布的"}, {key: "other", title: "其它"},
];
const groups = computed(() => GROUPS.map((group) => ({...group, items: props.artifacts.filter((item) => item.category === group.key)})).filter((group) => group.items.length > 0));
const ADOPTION: Record<string, string> = {waiting: "等会话采纳", adopted: "已采纳"};
const where = (workId: string, taskId: string | null) => `${workLabel(workId)}${taskId ? ` / ${taskLabel(taskId)}` : ""}`;
</script>

<template>
    <EmptyState v-if="artifacts.length === 0 && documents.length === 0 && evidences.length === 0" icon-class="i-lucide-files" title="没有产物" description="还没有 Task 发布过产物，也没有文档类产物与证据" />
    <div v-else class="flex flex-col gap-6">
        <section v-for="group in groups" :key="group.key" class="flex flex-col gap-1">
            <h2 class="nbdev-heading">{{ group.title }} <span class="nbdev-secondary">{{ group.items.length }}</span></h2>
            <ul class="flex flex-col">
                <li v-for="item in group.items" :key="`${item.workId}/${item.taskId}/${item.artifactId}`" class="border-b last:border-b-0 nbdev-divider">
                    <a :href="artifactHref(item.workId, item.taskId, item.artifactId)" class="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-1 py-1.5 hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)]" @click="follow($event, artifactHref(item.workId, item.taskId, item.artifactId))">
                        <span class="min-w-0 flex-1 truncate font-medium">{{ item.title ?? item.artifactId }}</span>
                        <span class="nbdev-note">{{ where(item.workId, item.taskId) }} · {{ item.artifactId }}<template v-if="item.version"> · v{{ item.version }}</template></span>
                        <Badge v-if="item.state === 'closed'" tone="neutral" variant="outline" size="sm">已关闭</Badge>
                        <Badge v-if="item.waiting > 0" tone="warning" variant="soft" size="sm">待答 {{ item.waiting }}</Badge>
                        <Badge v-if="item.adoption && ADOPTION[item.adoption]" :tone="item.adoption === 'waiting' ? 'accent' : 'success'" variant="soft" size="sm">{{ ADOPTION[item.adoption] }}</Badge>
                    </a>
                </li>
            </ul>
        </section>
        <section v-if="documents.length > 0" class="flex flex-col gap-1">
            <h2 class="nbdev-heading">文档类产物 <span class="nbdev-secondary">{{ documents.length }}</span></h2>
            <ul class="flex flex-col">
                <li v-for="item in documents" :key="item.path" class="border-b last:border-b-0 nbdev-divider">
                    <a :href="docHref(item.checkoutKey ?? 'main', item.path)" class="flex w-full min-w-0 flex-wrap items-center gap-x-2 px-1 py-1.5 hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)]" @click="follow($event, docHref(item.checkoutKey ?? 'main', item.path))">
                        <span class="min-w-0 flex-1 truncate">{{ item.title ?? item.path.slice(item.path.lastIndexOf("/") + 1) }}</span>
                        <span class="nbdev-note">{{ where(item.workId, item.taskId) }}</span>
                    </a>
                </li>
            </ul>
        </section>
        <section v-if="evidences.length > 0" class="flex flex-col gap-1">
            <h2 class="nbdev-heading">证据 <span class="nbdev-secondary">{{ evidences.length }} 个 Task</span></h2>
            <ul class="flex flex-wrap gap-2">
                <li v-for="item in evidences" :key="`${item.workId}/${item.taskId}`">
                    <a :href="taskHref(item.workId, item.taskId)" class="nbdev-divider nbdev-small inline-block rounded-[var(--radius-control)] border px-2 py-1 hover:bg-[var(--bg-hover)]" @click="follow($event, taskHref(item.workId, item.taskId))">
                        {{ where(item.workId, item.taskId) }} · {{ item.count }} 份
                    </a>
                </li>
            </ul>
        </section>
    </div>
</template>
