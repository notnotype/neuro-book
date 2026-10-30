<script setup lang="ts">
/**
 * 抽屉里的人物卡（viewer 输出 10）：名字、称呼、同一身份；概况、关系、记录、情节四个页签，带条数。
 * 页签停在哪由会话决定（从关系图点进来停在关系），切页签写回会话，所以地址与保存都跟着变。
 */
import {Badge, DropdownMenu, Input, IconButton, SegmentedControl, Tabs} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";

import {useBook, type Tab} from "../host/book";
import {useLayoutMotion} from "../host/motion";
import {usePagedQuery, useStoryQuery} from "../host/query";
import PagedList from "../parts/PagedList.vue";
import PageState from "../parts/PageState.vue";
import CandidateBlock from "../parts/CandidateBlock.vue";
import FoldedBar from "../parts/FoldedBar.vue";
import RecordTags from "../parts/RecordTags.vue";
import RefLink from "../parts/RefLink.vue";
import StateBadge from "../parts/StateBadge.vue";
import TierBadge from "../parts/TierBadge.vue";
import {FLAG_WORDS} from "../parts/tier-words";
import {useMinorCount, useShowMinorRecords} from "../host/show-minor";
import {MARK_WORDS, useRevise} from "../host/revise";
import CardRelations from "./CardRelations.vue";
import ReviseDialog from "./ReviseDialog.vue";

const props = defineProps<{entity: string; tab: Tab}>();
const book = useBook();
/** 称呼默认只列前几个。 */
const NAMES_SHOWN = 8;
const FACETS: Record<string, string> = {overview: "概况", appearance: "外貌", personality: "性格", relations: "关系", history: "过去", abilities: "能力", goals: "目标"};
const STATES = [{value: "", label: "全部"}, {value: "knows", label: "知道"}, {value: "believes", label: "认为"}, {value: "suspects", label: "怀疑"}, {value: "heard", label: "听说"}, {value: "unaware", label: "不知道"}];

const card = useStoryQuery("entity.card", () => ({entity: props.entity}));
/** 知道的秘密只列有记录的（没有记录的收成一句，可展开）。 */
const knownSecrets = computed(() => (card.data.value?.secrets ?? []).filter(secret => secret.state !== "no-record"));
const unrecordedSecrets = computed(() => (card.data.value?.secrets ?? []).filter(secret => secret.state === "no-record"));
const showUnrecorded = ref(false);
// 抽屉正在滑进来时先不渲染页签里的长列表（几十条记录一次渲染在慢机器上要上百毫秒，会卡住滑动），滑完再渲染。
const motion = useLayoutMotion();
const settled = ref(!motion.value);
watch(motion, moving => {
    if (!moving) settled.value = true;
});
const allNames = ref(false);
/** “⋯”菜单与它打开的修订对话框（输出 60）。 */
const reviseMode = ref<"link" | "kind" | "name" | null>(null);
const reviseOpen = computed({get: () => reviseMode.value !== null, set: open => (open ? undefined : (reviseMode.value = null))});
/** 与这个对象有关的修订条数（菜单第四项写出来；按阅读位置算）。 */
const revisionTotal = useStoryQuery("revisions.list", () => ({entity: props.entity, limit: 1}));
const reviseItems = computed<DropdownMenuItemData[]>(() => [
    {value: "link", label: "连到另一个对象……", iconClass: "i-lucide-link-2"},
    {value: "kind", label: "改对象种类……", iconClass: "i-lucide-user-round"},
    {value: "name", label: "某个称呼属于别的对象……", iconClass: "i-lucide-tag"},
    {value: "sep-1", label: "", separator: true},
    {value: "list", label: `这个对象的修订（${revisionTotal.data.value?.total ?? 0}）`, iconClass: "i-lucide-history"},
]);
function onRevise(value: string): void {
    if (value === "list") book.jump("revisions", {kind: "entity", id: props.entity});
    else reviseMode.value = value as "link" | "kind" | "name";
}
/** 断开“同一身份”里的一条连接：驳回把它连进来的那条说法（输出 64）。用户自己加的连接（“你加的”）要到待确认页的已处理里撤销。 */
const {busy: reviseBusy, error: reviseError, run: runRevise} = useRevise();
const unlinked = ref<{text: string; revision: string} | null>(null);
async function unlink(item: {label: string; statement: string | null}): Promise<void> {
    if (item.statement === null) return;
    const result = await runRevise("revisions.reject", {statement: item.statement});
    if (result) unlinked.value = {text: `已断开：${item.label}`, revision: result.revision.id};
}
async function undoUnlink(): Promise<void> {
    const current = unlinked.value;
    if (current && (await runRevise("revisions.undo", {revision: current.revision}))) unlinked.value = null;
}
const recordKind = ref<"knowledge" | "statements">("knowledge");
const stateFilter = ref("");
const recordQuery = ref("");
/** 记录编号默认收起（输出 7）。 */
const showIds = ref(false);

const tabs = computed(() => {
    const counts = card.data.value?.counts;
    return [
        {value: "summary", label: "概况"},
        {value: "relations", label: "关系", count: counts?.relations},
        {value: "records", label: "记录", count: counts ? counts.knowledge + counts.statements : undefined},
        {value: "episodes", label: "情节", count: counts?.episodes},
    ];
});

const knowledge = usePagedQuery("entity.knowledge", () =>
    props.tab === "records" && recordKind.value === "knowledge"
        ? {entity: props.entity, ...(stateFilter.value ? {state: stateFilter.value as "knows"} : {}), ...(recordQuery.value.trim() ? {query: recordQuery.value.trim()} : {})}
        : null,
);
/** 次要（3 级）说法默认收起（viewer 输出 56）；收起时只取 1、2 级，条数取页上的 `tiers`。 */
const showMinor = useShowMinorRecords();
const statements = usePagedQuery("entity.statements", () =>
    props.tab === "records" && recordKind.value === "statements"
        ? {entity: props.entity, ...(recordQuery.value.trim() ? {query: recordQuery.value.trim()} : {}), ...(showMinor.value ? {} : {maxTier: 2 as const})}
        : null,
);
const minor = useMinorCount(statements.extra, () => JSON.stringify([props.entity, recordQuery.value.trim(), book.at.value]), showMinor);
const episodes = usePagedQuery("entity.episodes", () => (props.tab === "episodes" ? {entity: props.entity} : null));

function setTab(value: string): void {
    book.openCard(props.entity, value as Tab);
}
const STATE_WORD = {knows: "知道", believes: "认为", suspects: "怀疑", heard: "听说", read: "读到", unaware: "不知道"} as const;
const FAMILY_WORD: Record<string, string> = {
    kinship: "亲属", social: "交往", membership: "所属", attitude: "态度", identity: "身份", event: "事件", goal: "打算", trait: "特点",
    rule: "规则", possession: "拥有", location: "位置", other: "其他",
};
</script>

<template>
    <div class="flex h-full flex-col" data-testid="entity-card">
        <PageState class="px-3" :loading="card.loading.value && !card.data.value" :error="card.error.value?.code === 'entity_not_found' ? '这个对象在当前阅读位置还没出现' : (card.error.value?.message ?? null)" @retry="card.reload()" />
        <template v-if="card.data.value">
            <header class="flex flex-col gap-1 border-b border-[var(--divider)] px-3 pb-2 pt-3">
                <div class="flex items-center gap-2">
                    <h2 class="text-[length:var(--text-lg)] font-[var(--weight-strong)]" data-testid="card-name">{{ card.data.value.label }}</h2>
                    <span class="ml-auto flex items-center gap-0.5">
                        <DropdownMenu :items="reviseItems" align="end" menu-class="min-w-[220px]" @select="onRevise"><IconButton size="xs" icon-class="i-lucide-ellipsis" aria-label="修改" data-testid="card-revise-menu" /></DropdownMenu>
                        <IconButton size="xs" icon-class="i-lucide-x" aria-label="关闭" @click="book.closeDrawer()" />
                    </span>
                </div>
                <p class="text-[length:var(--text-sm)] text-[var(--text-secondary)]" data-testid="card-names">
                    称呼：<template v-for="(name, index) in (allNames ? card.data.value.names : card.data.value.names.slice(0, NAMES_SHOWN))" :key="name.text">{{ index ? "、" : "" }}{{ name.text }}</template>
                    <button v-if="card.data.value.names.length > NAMES_SHOWN" type="button" class="ml-1 text-[var(--accent-text)]" @click="allNames = !allNames">{{ allNames ? "收起" : `等 ${card.data.value.names.length} 个` }}</button>
                </p>
                <CandidateBlock :entity="props.entity" />
                <p v-if="card.data.value.identities.length" class="text-[length:var(--text-sm)]" data-testid="card-identities">
                    同一身份：<span v-for="item in card.data.value.identities" :key="item.id" class="mr-2">{{ item.label }} <RefLink :ref-text="item.ref" /><Badge v-if="item.mark" size="sm" variant="soft" tone="success" class="ml-1" data-testid="identity-mark">{{ MARK_WORDS[item.mark] }}</Badge><IconButton v-if="item.statement !== null && item.mark !== 'added'" size="xs" icon-class="i-lucide-unlink" :aria-label="`断开与${item.label}的连接`" :disabled="reviseBusy" class="ml-0.5 align-middle" data-testid="identity-unlink" @click="unlink(item)" /></span>
                </p>
                <p v-if="unlinked" class="text-[length:var(--text-xs)]" data-testid="identity-unlinked"><span role="status">{{ unlinked.text }}</span><button type="button" class="ml-2 text-[var(--accent-text)]" data-testid="identity-unlink-undo" @click="undoUnlink">撤销</button></p>
                <p v-if="reviseError" class="text-[length:var(--text-xs)] text-[var(--status-danger)]" role="alert">{{ reviseError }}</p>
            </header>
            <ReviseDialog v-if="reviseMode" v-model:open="reviseOpen" :mode="reviseMode" :entity="card.data.value.id" :label="card.data.value.label" :kind="card.data.value.kind" :names="card.data.value.names.map(item => item.text)" />
            <Tabs class="px-3" size="sm" :model-value="tab" :items="tabs" aria-label="人物卡" @update:model-value="setTab" />
            <div class="story-scroll-y min-h-0 flex-1 px-3 pb-2">
                <template v-if="tab === 'summary'">
                    <section v-for="facet in card.data.value.facets" :key="facet.facet" class="mb-3">
                        <h3 class="text-[length:var(--text-sm)] font-[var(--weight-strong)]">{{ FACETS[facet.facet] ?? facet.facet }} <span class="text-[length:var(--text-2xs)] text-[var(--text-muted)]">归纳到第 {{ facet.through }} 章</span></h3>
                        <p v-for="(item, index) in facet.items" :key="index" class="text-[length:var(--text-sm)] leading-relaxed">{{ item }}</p>
                    </section>
                    <section v-if="card.data.value.secrets.length" class="mb-3" data-testid="card-secrets">
                        <h3 class="text-[length:var(--text-sm)] font-[var(--weight-strong)]">知道的秘密 <span class="text-[length:var(--text-2xs)] font-normal text-[var(--text-secondary)]">{{ knownSecrets.length }} 个有记录</span></h3>
                        <ul class="flex flex-col">
                            <li v-for="secret in knownSecrets" :key="secret.id" class="record-row">
                                <span><StateBadge :state="secret.state" /></span><span class="min-w-0">{{ secret.title }}</span><span class="refs"><RefLink v-if="secret.ref" :ref-text="secret.ref" /></span>
                            </li>
                        </ul>
                        <button v-if="unrecordedSecrets.length" type="button" class="mt-1 text-[length:var(--text-xs)] text-[var(--accent-text)]" data-testid="toggle-unrecorded" @click="showUnrecorded = !showUnrecorded">
                            {{ showUnrecorded ? "收起" : `另有 ${unrecordedSecrets.length} 个秘密没有他的记录` }}
                        </button>
                        <ul v-if="showUnrecorded" class="mt-1 flex flex-col text-[length:var(--text-xs)] text-[var(--text-secondary)]">
                            <li v-for="secret in unrecordedSecrets" :key="secret.id">{{ secret.title }}</li>
                        </ul>
                        <p v-if="unrecordedSecrets.length" class="mt-1 text-[length:var(--text-2xs)] text-[var(--text-secondary)]">“没有记录”不等于不知道：原文没写他对这件事的反应。</p>
                    </section>
                </template>
                <p v-else-if="!settled" class="py-2 text-[length:var(--text-xs)] text-[var(--text-secondary)]">正在打开……</p>
                <CardRelations v-else-if="tab === 'relations'" :entity="card.data.value.id" />
                <template v-else-if="tab === 'records'">
                    <div class="flex flex-wrap items-center gap-2 py-1">
                        <SegmentedControl v-model="recordKind" size="xs" :options="[{value: 'knowledge', label: `他知道的 ${card.data.value.counts.knowledge}`}, {value: 'statements', label: `关于他的 ${card.data.value.counts.statements}`}]" aria-label="记录的种类" />
                        <SegmentedControl v-if="recordKind === 'knowledge'" v-model="stateFilter" size="xs" :options="STATES" aria-label="按状态筛" />
                        <div class="w-32"><Input v-model="recordQuery" size="sm" icon-class="i-lucide-search" placeholder="按字搜" /></div>
                        <button type="button" class="story-chip" :class="showIds ? 'is-on' : ''" :aria-pressed="showIds" @click="showIds = !showIds">编号</button>
                        <button type="button" class="story-chip" data-testid="open-wide" @click="book.wideRecords.value = card.data.value!.id">在主区打开</button>
                    </div>
                    <PagedList v-if="recordKind === 'knowledge'" :items="knowledge.items.value" :total="knowledge.total.value" :loading="knowledge.loading.value" :has-more="knowledge.hasMore.value" :error="knowledge.error.value?.message ?? null" @more="knowledge.more()" @retry="knowledge.reload()">
                        <template #item="{item, index}">
                            <h4 v-if="index === 0 || knowledge.items.value[index - 1]!.chapter !== item.chapter" class="chapter-head">第 {{ item.chapter }} 章</h4>
                            <div class="record-row" data-testid="record">
                                <span class="state" :data-state="item.state">{{ STATE_WORD[item.state] }}</span>
                                <span class="min-w-0">
                                    {{ item.text }}
                                    <span v-if="item.how" class="how">（{{ item.how }}）</span>
                                    <RecordTags :tags="item.tags" />
                                    <span v-if="showIds" class="ml-1 text-[length:var(--text-2xs)] text-[var(--text-muted)]" data-testid="record-id">{{ item.id }}</span>
                                </span>
                                <span class="refs"><RefLink v-for="ref in item.refs.slice(0, 2)" :key="ref" :ref-text="ref" /></span>
                            </div>
                        </template>
                    </PagedList>
                    <template v-else>
                        <FoldedBar v-if="minor.visible.value" v-model:open="showMinor" :count="minor.count.value" class="mb-1" data-testid="toggle-minor-records" />
                        <PagedList :items="statements.items.value" :total="statements.total.value" :loading="statements.loading.value" :has-more="statements.hasMore.value" :error="statements.error.value?.message ?? null" @more="statements.more()" @retry="statements.reload()">
                            <template #item="{item, index}">
                                <h4 v-if="index === 0 || statements.items.value[index - 1]!.chapter !== item.chapter" class="chapter-head">第 {{ item.chapter }} 章</h4>
                                <div class="record-row" :class="item.tier === 3 ? 'is-minor' : ''" data-testid="record" :data-tier="item.tier">
                                    <span class="state">{{ FAMILY_WORD[item.family] ?? item.family }}</span>
                                    <span class="min-w-0">
                                        <TierBadge :tier="item.tier" :flag="item.tierFlag" :explain="item.id" :family="item.family" />{{ item.text }}
                                        <Badge v-if="item.mark" size="sm" variant="soft" :tone="item.mark === 'candidate' ? 'warning' : 'success'" class="ml-1" data-testid="statement-mark">{{ MARK_WORDS[item.mark] }}</Badge>
                                        <RecordTags :tags="item.tags" />
                                        <Badge v-if="item.tierFlag" size="sm" variant="soft" tone="neutral" class="ml-1" data-testid="tier-flag">{{ FLAG_WORDS[item.tierFlag] }}</Badge>
                                        <span v-if="showIds" class="ml-1 text-[length:var(--text-2xs)] text-[var(--text-muted)]" data-testid="record-id">{{ item.id }}</span>
                                    </span>
                                    <span class="refs"><RefLink v-for="ref in item.refs.slice(0, 2)" :key="ref" :ref-text="ref" /></span>
                                </div>
                            </template>
                        </PagedList>
                    </template>
                </template>
                <PagedList v-else :items="episodes.items.value" :total="episodes.total.value" :loading="episodes.loading.value" :has-more="episodes.hasMore.value" :error="episodes.error.value?.message ?? null" @more="episodes.more()" @retry="episodes.reload()">
                    <template #item="{item, index}">
                        <h4 v-if="index === 0 || episodes.items.value[index - 1]!.chapter !== item.chapter" class="chapter-head">第 {{ item.chapter }} 章</h4>
                        <div class="record-row is-two">
                            <button type="button" class="min-w-0 text-left" @click="book.jump('episodes', {kind: 'episode', id: item.id})"><TierBadge :tier="item.tier" />{{ item.title }}</button>
                            <span class="refs"><RefLink v-for="ref in item.refs.slice(0, 1)" :key="ref" :ref-text="ref" /></span>
                        </div>
                    </template>
                </PagedList>
            </div>
        </template>
    </div>
</template>

<style scoped>
.chapter-head {
    position: sticky;
    top: 0;
    background: var(--bg-panel);
    font-size: var(--text-xs);
    color: var(--text-muted);
    padding: 4px 0 2px;
}
/* 记录一行三列：状态或类别 | 正文（带来由与标记）| 出处，逐行对齐，方便一行行扫 */
.record-row {
    display: grid;
    grid-template-columns: 3.5em minmax(0, 1fr) auto;
    gap: 8px;
    align-items: baseline;
    padding: 4px 0;
    border-bottom: var(--border-w, 1px) solid var(--divider);
    font-size: var(--text-sm);
    line-height: 1.55;
}
/* 展开后的次要说法淡一些（viewer 输出 56）；色块与依据照常可点 */
.record-row.is-minor {
    color: var(--text-secondary);
}
.record-row.is-two {
    grid-template-columns: minmax(0, 1fr) auto;
}
.record-row .state {
    font-size: var(--text-xs);
    color: var(--text-secondary);
}
.record-row .state[data-state="unaware"] {
    color: var(--status-danger);
}
.record-row .state[data-state="knows"],
.record-row .state[data-state="read"] {
    color: var(--status-success);
}
.record-row .how {
    font-size: var(--text-xs);
    color: var(--text-secondary);
}
.record-row .refs {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    font-size: var(--text-2xs);
    white-space: nowrap;
}
</style>
