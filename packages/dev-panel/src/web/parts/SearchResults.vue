<script setup lang="ts">
import {Badge} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, ref} from "vue";
import {taskLabel, workLabel} from "../host/format.js";
import {snippetAround} from "../host/highlight.js";
import {docHref, isPlainClick, searchRecordHref} from "../host/routes.js";
import type {SearchCheckoutDone, SearchHit, SearchRecordMatch} from "../host/types.js";
import HighlightText from "./HighlightText.vue";

/**
 * 搜索结果：记录类命中在最上面（服务端已按相关度排好），下面按 checkout 分组列文件命中；搜索词高亮；
 * 每组里 `.agents/tasks/` 下的命中（历史 Task 记录）收进组尾，默认折叠（t15 阶段 4 第 5 批）。契约见同名 .md。
 */
const props = defineProps<{records: SearchRecordMatch[]; hits: SearchHit[]; done: SearchCheckoutDone[]; finished: boolean; q: string}>();
const emit = defineEmits<{navigate: [href: string]}>();
function follow(event: MouseEvent, href: string): void {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    emit("navigate", href);
}

const HISTORY = ".agents/tasks/";
const groups = computed(() => {
    const byCheckout = new Map<string, SearchHit[]>();
    for (const hit of props.hits) byCheckout.set(hit.checkout, [...(byCheckout.get(hit.checkout) ?? []), hit]);
    return [...byCheckout.entries()].map(([checkout, hits]) => ({
        checkout,
        hits: hits.filter((hit) => !hit.path.startsWith(HISTORY)),
        history: hits.filter((hit) => hit.path.startsWith(HISTORY)),
        done: props.done.find((entry) => entry.checkout === checkout) ?? null,
    }));
});
/**
 * 内容片段在命中前留多少个字：窄屏（手机）上内容那一行只有约 350px，中文 30 个字就放不下，命中会落在截断之外，所以只留 6 个字。
 * 内容那一行至少 16rem 宽，放不下就换到路径下面独占一行：原来它挤在长路径旁边只剩几个字宽。
 * （2026-10-14 在 390 宽下实测：搜“决定点”，原来 199 行里 129 行的命中看不见。）
 */
const narrowQuery = window.matchMedia("(max-width: 767px)");
const narrow = ref(narrowQuery.matches);
const onNarrow = () => {
    narrow.value = narrowQuery.matches;
};
narrowQuery.addEventListener("change", onNarrow);
onBeforeUnmount(() => narrowQuery.removeEventListener("change", onNarrow));
const snippetBefore = computed(() => (narrow.value ? 6 : 30));
/** 展开了历史记录的 checkout。页面按搜索词给零件加 key，换个搜索词零件重建、历史收起。 */
const historyOpen = ref<Set<string>>(new Set());
function toggleHistory(checkout: string): void {
    const next = new Set(historyOpen.value);
    if (next.has(checkout)) next.delete(checkout);
    else next.add(checkout);
    historyOpen.value = next;
}
const KIND_LABEL: Record<SearchRecordMatch["kind"], string> = {work: "Work", task: "Task", artifact: "产物", session: "会话"};
/** 标题开头常常又写一遍编号（“w00032 t05 Profile 设置页”）：前面已经有“w00032/t05”，去掉重复的（t22）。 */
function withoutLeadingIds(title: string, ids: readonly string[]): string {
    let rest = title;
    for (;;) {
        const head = ids.find((id) => rest.toLowerCase().startsWith(`${id.toLowerCase()} `));
        if (!head) return rest;
        rest = rest.slice(head.length).trimStart();
    }
}
function recordText(match: SearchRecordMatch): string {
    if (match.kind === "session") return match.label ?? match.key ?? "";
    const ids = [match.workId ? workLabel(match.workId) : null, match.taskId ? taskLabel(match.taskId) : null].filter((id): id is string => id !== null);
    const where = ids.join("/");
    const name = match.title ? withoutLeadingIds(match.title, ids) : match.artifactId ?? match.taskId ?? match.workId ?? "";
    return `${where} ${name}`.trim();
}
</script>

<template>
    <div class="flex flex-col gap-5">
        <section v-if="records.length > 0" class="flex flex-col gap-1">
            <h2 class="nbdev-heading">Work、Task、产物与会话</h2>
            <ul class="flex flex-col">
                <li v-for="(match, index) in records" :key="index">
                    <!-- 手机上一行放不下：最多折成两行，命中的字不会被截在省略号后面（t22）。 -->
                    <a :href="searchRecordHref(match)" class="flex w-full items-start gap-2 px-1 py-1 hover:bg-[var(--bg-hover)]" @click="follow($event, searchRecordHref(match))">
                        <Badge class="mt-0.5 shrink-0" tone="neutral" variant="outline" size="sm">{{ KIND_LABEL[match.kind] }}</Badge><span class="line-clamp-2 min-w-0"><HighlightText :text="recordText(match)" :q="q" /></span>
                    </a>
                </li>
            </ul>
        </section>
        <section v-for="group in groups" :key="group.checkout" class="flex flex-col gap-1">
            <h2 class="flex flex-wrap items-center gap-2 nbdev-heading">
                {{ group.checkout }}
                <span class="nbdev-note font-normal">{{ group.hits.length + group.history.length }} 条<template v-if="group.done"> · {{ group.done.elapsedMs }} 毫秒</template></span>
                <Badge v-if="group.done?.truncated" tone="warning" variant="soft" size="sm">截断了</Badge>
                <Badge v-if="group.done?.error" tone="danger" variant="soft" size="sm">出错</Badge>
            </h2>
            <ul class="flex flex-col nbdev-small">
                <li v-for="(hit, index) in [...group.hits, ...(historyOpen.has(group.checkout) ? group.history : [])]" :key="index" class="min-w-0">
                    <a v-if="hit.path.endsWith('.md')" :href="docHref(hit.checkout, hit.path)" class="flex w-full min-w-0 flex-wrap items-baseline gap-x-2 px-1 py-0.5 hover:bg-[var(--bg-hover)]" @click="follow($event, docHref(hit.checkout, hit.path))">
                        <span class="font-medium"><HighlightText :text="hit.path" :q="hit.kind === 'name' ? q : ''" /><template v-if="hit.line">:{{ hit.line }}</template></span>
                        <code v-if="hit.text" class="min-w-[16rem] max-w-full flex-1 truncate nbdev-secondary"><HighlightText :text="snippetAround(hit.text, q, snippetBefore)" :q="q" /></code>
                    </a>
                    <div v-else class="flex w-full min-w-0 flex-wrap items-baseline gap-x-2 px-1 py-0.5">
                        <span><HighlightText :text="hit.path" :q="hit.kind === 'name' ? q : ''" /><template v-if="hit.line">:{{ hit.line }}</template></span>
                        <code v-if="hit.text" class="min-w-[16rem] max-w-full flex-1 truncate nbdev-secondary"><HighlightText :text="snippetAround(hit.text, q, snippetBefore)" :q="q" /></code>
                    </div>
                </li>
            </ul>
            <button v-if="group.history.length > 0" type="button" class="nbdev-secondary nbdev-small flex items-center gap-1 self-start px-1" :aria-expanded="historyOpen.has(group.checkout)" @click="toggleHistory(group.checkout)">
                <span :class="historyOpen.has(group.checkout) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5" aria-hidden="true" />{{ historyOpen.has(group.checkout) ? "收起" : "展开" }}历史 Task 记录（.agents/tasks）{{ group.history.length }} 条
            </button>
        </section>
        <p class="nbdev-empty" v-if="finished && records.length === 0 && hits.length === 0">没有找到</p>
    </div>
</template>
