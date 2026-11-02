<script setup lang="ts">
import {Button, Dialog, Input, SegmentedControl} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";

import {parseAt, useBook} from "../host/book";
import {ALL_KINDS, KIND_LABEL} from "../host/kinds";
import {usePagedQuery, useStoryQuery} from "../host/query";
import {useRevise} from "../host/revise";
import type {EntityKind} from "../../core/dataset";

const props = defineProps<{open: boolean; mode: "link" | "kind" | "name"; entity: string; label: string; kind: EntityKind; names: string[]}>();
const emit = defineEmits<{"update:open": [value: boolean]}>();

const book = useBook();
const {busy, error, run} = useRevise();

// 对话框由人物卡按需挂载（打开时才有这个组件），所以初值就是“每次打开重新开始”。
const search = ref("");
const target = ref<{id: string; label: string} | null>(null);
const certainty = ref<"candidate" | "certain">("candidate");
const newKind = ref<EntityKind | null>(null);
const name = ref(props.names[0] ?? "");
const evidence = ref<string | null>(null);
const typed = ref("");

const needsTarget = computed(() => props.mode === "link" || props.mode === "name");
const found = useStoryQuery("entities.list", () => (needsTarget.value && search.value.trim() ? {query: search.value.trim(), limit: 8} : null));
const options = computed(() => (found.data.value?.items ?? []).filter(item => !item.entities.includes(props.entity)));
const paragraphs = usePagedQuery("revisions.evidence", () => ({entity: props.entity, ...(props.mode === "name" && name.value ? {text: name.value} : {})}), 20);

/** 手写的“章.段”不能晚于阅读位置（接口没有阅读位置参数，限制在界面）；格式不对也在这里先说。 */
const typedProblem = computed(() => {
    const text = typed.value.trim();
    if (text === "") return "";
    const parsed = parseAt(text);
    if (parsed === null || parsed.paragraph === undefined) return "依据位置要写成“章.段”，例如 5.75";
    const at = book.at.value;
    const later = parsed.chapter > at.chapter || (parsed.chapter === at.chapter && at.paragraph !== undefined && parsed.paragraph > at.paragraph);
    return later ? `${text} 晚于现在的阅读位置，读到它之前看不到` : "";
});
const chosenEvidence = computed(() => (typed.value.trim() !== "" ? typed.value.trim() : evidence.value));
const ready = computed(() => chosenEvidence.value !== null && typedProblem.value === "" && (!needsTarget.value || target.value !== null) && (props.mode !== "name" || name.value !== "") && (props.mode !== "kind" || (newKind.value !== null && newKind.value !== props.kind)));
const status = computed(() => error.value ?? typedProblem.value);

function pickName(text: string): void {
    name.value = text;
    // 依据段按称呼过滤：换了称呼，选过的那一段不一定还在列表里。
    evidence.value = null;
}

const title = computed(() => (props.mode === "link" ? `把“${props.label}”连到另一个对象` : props.mode === "kind" ? `改“${props.label}”的对象种类` : `“${props.label}”的称呼属于别的对象`));
const submitText = computed(() => (props.mode === "link" ? "连接" : props.mode === "kind" ? "改种类" : "挪称呼"));
/** 改完会怎样：人物卡、统计、阅读页链接各一句，写出这次具体的名字与位置。 */
const effects = computed(() => {
    const at = chosenEvidence.value ?? "所选的那一段";
    const other = target.value?.label ?? "所选对象";
    if (props.mode === "link") {
        return [
            certainty.value === "certain" ? `“${props.label}”与“${other}”在人物页合成一个点，身份连接按确定算；` : `“${props.label}”与“${other}”显示为“可能是同一人”，不合并；`,
            `说法在记录里标“你加的”，从 ${at} 起生效，更早的阅读位置看不到；`,
            "阅读页的称呼链接不变；可以在待确认页撤销。",
        ];
    }
    if (props.mode === "kind") {
        const next = newKind.value === null ? "新种类" : KIND_LABEL[newKind.value];
        return [`“${props.label}”从 ${at} 起按${next}算：人物卡、出场与同场的统计、关系图的点都随之变；`, `${at} 之前的阅读位置仍是${KIND_LABEL[props.kind]}；`, "指向它的候选身份保留，不会自动合并；阅读页的称呼链接不变。"];
    }
    return [
        `“${name.value}”从 ${at} 起属于“${other}”：人物卡的称呼表与出场统计随之变；`,
        `${at} 起原文里的“${name.value}”在阅读页链接到“${other}”；`,
        `${at} 之前的出现不变（不剧透、不改过去）。`,
    ];
});

async function submit(): Promise<void> {
    const at = chosenEvidence.value;
    if (at === null || !ready.value) return;
    const done =
        props.mode === "link" && target.value
            ? await run("revisions.link", {a: props.entity, b: target.value.id, evidence: at, certainty: certainty.value})
            : props.mode === "kind" && newKind.value !== null
                ? await run("revisions.kind", {entity: props.entity, kind: newKind.value, evidence: at})
                : props.mode === "name" && target.value
                    ? await run("revisions.moveName", {text: name.value, from: props.entity, to: target.value.id, evidence: at})
                    : null;
    if (done) emit("update:open", false);
}
</script>

<template>
    <Dialog :open="open" :title="title" size="lg" closable :busy="busy" :status="status" @update:open="emit('update:open', $event)">
        <div class="flex flex-col gap-2" data-testid="revise-dialog" :data-mode="mode">
            <template v-if="mode === 'name'">
                <p id="revise-name-label" class="lab">哪个称呼</p>
                <div class="flex flex-wrap gap-1" role="group" aria-labelledby="revise-name-label">
                    <button v-for="text in names" :key="text" type="button" class="story-chip" :class="{'is-on': name === text}" :aria-pressed="name === text" :data-name="text" @click="pickName(text)">{{ text }}</button>
                </div>
            </template>
            <template v-if="needsTarget">
                <p id="revise-target-label" class="lab">{{ mode === "link" ? "连到谁" : "改挂到" }}</p>
                <Input v-model="search" size="sm" icon-class="i-lucide-search" placeholder="按名字或称呼搜" aria-labelledby="revise-target-label" />
                <ul v-if="options.length" class="list" aria-labelledby="revise-target-label">
                    <li v-for="item in options" :key="item.id">
                        <button type="button" class="row" :class="{on: target?.id === item.id}" :aria-pressed="target?.id === item.id" :data-entity="item.id" @click="target = {id: item.id, label: item.label}"><b>{{ item.label }}</b><span class="muted">{{ KIND_LABEL[item.kind] }} · 出场 {{ item.mentions }}</span></button>
                    </li>
                </ul>
                <p v-else-if="search.trim() && !found.loading.value" class="muted" data-testid="revise-no-match">没有找到叫“{{ search.trim() }}”的对象</p>
                <p v-if="target" class="muted" data-testid="revise-target">已选：{{ target.label }}</p>
            </template>
            <template v-if="mode === 'kind'">
                <p id="revise-kind-label" class="lab">现在是{{ KIND_LABEL[kind] }}，改成</p>
                <SegmentedControl v-model="newKind" size="xs" :options="ALL_KINDS.filter(item => item !== kind).map(item => ({value: item, label: KIND_LABEL[item]}))" aria-label="新种类" />
            </template>
            <p id="revise-evidence-label" class="lab">哪一句话说明了这件事 <span class="muted">必选：修订从这一段起生效，读到它之前看不到</span></p>
            <ul class="list" data-testid="revise-evidence" aria-labelledby="revise-evidence-label">
                <li v-for="item in paragraphs.items.value" :key="item.ref">
                    <button type="button" class="row" :class="{on: evidence === item.ref && typed.trim() === ''}" :aria-pressed="evidence === item.ref && typed.trim() === ''" :data-ref="item.ref" @click="evidence = item.ref; typed = ''"><span class="ref">{{ item.ref }}</span><span class="min-w-0 truncate">{{ item.text }}</span></button>
                </li>
                <li v-if="paragraphs.hasMore.value"><button type="button" class="row muted" @click="paragraphs.more()">更多段落……</button></li>
            </ul>
            <div class="flex items-center gap-2"><span class="muted">或直接写章.段</span><div class="w-28"><Input v-model="typed" size="sm" placeholder="例如 5.75" aria-label="依据位置" /></div></div>
            <template v-if="mode === 'link'">
                <p id="revise-certainty-label" class="lab">这是一条</p>
                <SegmentedControl v-model="certainty" size="xs" :options="[{value: 'candidate', label: '可能是（候选）'}, {value: 'certain', label: '就是（确定）'}]" aria-label="把握" />
            </template>
            <div class="effect" data-testid="revise-effects"><b>改完会怎样</b><ul><li v-for="line in effects" :key="line">{{ line }}</li></ul></div>
        </div>
        <template #footer>
            <div class="flex justify-end gap-2">
                <Button variant="ghost" size="sm" :disabled="busy" @click="emit('update:open', false)">取消</Button>
                <Button size="sm" :disabled="!ready || busy" data-testid="revise-submit" @click="submit">{{ submitText }}</Button>
            </div>
        </template>
    </Dialog>
</template>

<style scoped>
.lab {
    margin-top: 4px;
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
}
.muted {
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: normal;
}
.list {
    display: flex;
    max-height: 9.5rem;
    flex-direction: column;
    overflow-y: auto;
    border: var(--border-w, 1px) solid var(--border-color);
    border-radius: var(--radius-control);
}
.row {
    display: flex;
    width: 100%;
    align-items: baseline;
    gap: 8px;
    padding: 4px 10px;
    text-align: left;
    font-size: var(--text-xs);
    line-height: 1.6;
    border-bottom: var(--border-w, 1px) solid var(--divider);
}
.row.on {
    background: var(--accent-bg);
}
.ref {
    color: var(--accent-text);
    white-space: nowrap;
}
.effect {
    padding: 8px 12px;
    border-radius: var(--radius-control);
    background: var(--bg-hover);
    font-size: var(--text-xs);
    line-height: 1.6;
}
.effect ul {
    margin: 2px 0 0 16px;
    list-style: disc;
}
</style>
