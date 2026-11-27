<script setup lang="ts">
import {Button} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";

import {useBook} from "../host/book";
import {useStoryQuery} from "../host/query";
import {focusedRevision, SOURCE_WORDS, statementOf, useRevise, type RevisionItem} from "../host/revise";
import EvidenceQuote from "./EvidenceQuote.vue";
import NameLink from "./NameLink.vue";

const props = defineProps<{entity: string}>();
const SHOWN = 5;
const book = useBook();
const list = useStoryQuery("revisions.list", () => ({entity: props.entity, state: "pending" as const, limit: SHOWN}));
const {busy, error, run} = useRevise();
/** 刚做完的一件事，给“撤销”的提示。 */
const done = ref<{text: string; revision: string} | null>(null);
const more = computed(() => (list.data.value ? list.data.value.total - list.data.value.items.length : 0));

async function decide(item: RevisionItem, method: "revisions.confirm" | "revisions.reject"): Promise<void> {
    const statement = statementOf(item);
    if (statement === null) return;
    const result = await run(method, {statement});
    if (result) done.value = {text: `${method === "revisions.confirm" ? "已确认" : "已驳回"}：${item.summary}`, revision: result.revision.id};
}
async function undo(): Promise<void> {
    const current = done.value;
    if (current && (await run("revisions.undo", {revision: current.revision}))) done.value = null;
}
</script>

<template>
    <div v-if="list.data.value?.items.length || done" class="flex flex-col gap-1" data-testid="candidate-block">
        <section v-for="item in list.data.value?.items ?? []" :key="item.id" class="candidate" :class="{'is-focused': focusedRevision === item.id}" :data-statement="item.id">
            <p class="flex flex-wrap items-baseline gap-x-2 text-[length:var(--text-sm)]">
                <b>{{ item.summary }}</b>
                <span class="text-[length:var(--text-xs)] text-[var(--text-secondary)]">{{ SOURCE_WORDS[item.source] }}</span>
            </p>
            <p class="text-[length:var(--text-xs)] text-[var(--text-secondary)]">涉及：<NameLink v-for="other in item.entities.filter(entity => entity.id !== props.entity)" :id="other.id" :key="other.id" :label="other.label" class="mr-1" /></p>
            <EvidenceQuote :ref-text="item.evidence" :text="item.quote" />
            <div class="flex items-center gap-1.5">
                <Button variant="primary" size="sm" icon-class="i-lucide-check" :disabled="busy" data-testid="candidate-confirm" @click="decide(item, 'revisions.confirm')">确认是同一人</Button>
                <Button size="sm" variant="ghost" :disabled="busy" data-testid="candidate-reject" @click="decide(item, 'revisions.reject')">不是</Button>
            </div>
            <p class="text-[length:var(--text-2xs)] text-[var(--text-secondary)]">确认后从第 {{ item.evidence.split('.')[0] }} 章第 {{ item.evidence.split('.')[1] }} 段起生效，读到它之前仍看不到。</p>
        </section>
        <button v-if="more > 0" type="button" class="text-left text-[length:var(--text-xs)] text-[var(--accent-text)]" data-testid="candidate-more" @click="book.jump('revisions', {kind: 'entity', id: props.entity})">还有 {{ more }} 条待确认，去待确认页看</button>
        <p v-if="done" class="done" data-testid="candidate-done"><span role="status">{{ done.text }}</span><button type="button" class="ml-2 text-[var(--accent-text)]" data-testid="candidate-undo" @click="undo">撤销</button></p>
        <p v-if="error" class="text-[length:var(--text-xs)] text-[var(--status-danger)]" role="alert">{{ error }}</p>
    </div>
</template>

<style scoped>
.candidate {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    border: var(--border-w, 1px) solid var(--border-accent);
    border-radius: var(--radius-panel);
    background: var(--accent-bg);
}
.candidate.is-focused {
    outline: 2px solid var(--accent-text);
}
.done {
    padding: 6px 10px;
    border: var(--border-w, 1px) solid var(--border-color);
    border-radius: var(--radius-panel);
    background: var(--bg-panel);
    font-size: var(--text-xs);
}
</style>
