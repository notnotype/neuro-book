<script setup lang="ts">
/**
 * 待处理视图里选中那一条的详情（同名 .md；docs/specs/canon/author-ui.md 输出 23）。受控：内容由宿主按种类折好（`pending.ts`）。
 */
import {Button} from "@notnotype/nb-ui/components";

import type {PendingDetailModel, PendingTarget} from "../../pending";
import {useCanonText} from "../../text";

const props = defineProps<{
    detail: PendingDetailModel;
}>();

const emit = defineEmits<{
    (event: "open", target: PendingTarget): void;
    (event: "open-chapter", chapter: string): void;
}>();

const text = useCanonText();
</script>

<template>
    <div class="pending-detail" data-pending-detail>
        <div>
            <h2 class="pending-detail__title" data-pending-detail-title>{{ props.detail.title }}</h2>
            <p v-if="props.detail.place !== ''" class="pending-detail__muted">{{ props.detail.place }}</p>
        </div>
        <div v-if="props.detail.quote !== null" class="pending-detail__quote" data-pending-detail-quote>
            <blockquote class="m-0">{{ text("change.quote", {quote: props.detail.quote.text}) }}</blockquote>
            <Button v-if="props.detail.quote.chapter !== null" size="sm" variant="ghost" data-pending-open-chapter @click="emit('open-chapter', props.detail.quote.chapter)">{{ text("change.openChapter") }}</Button>
        </div>
        <dl v-if="props.detail.facts.length > 0" class="pending-detail__facts" data-pending-detail-facts>
            <template v-for="fact in props.detail.facts" :key="fact.label">
                <dt>{{ fact.label }}</dt>
                <dd>{{ fact.value }}</dd>
            </template>
        </dl>
        <section v-if="props.detail.suspects.length > 0" data-pending-detail-suspects>
            <h3 class="pending-detail__subtitle">{{ text("pending.detail.suspects") }}</h3>
            <ul class="pending-detail__suspects">
                <li v-for="suspect in props.detail.suspects" :key="suspect.key" class="pending-detail__suspect" :data-suspect="suspect.key">
                    <span class="pending-detail__suspect-text">
                        <span>{{ suspect.text }}</span>
                        <span v-if="suspect.place !== ''" class="pending-detail__muted">{{ suspect.place }}</span>
                        <span v-if="suspect.estimate" class="pending-detail__estimate" data-suspect-estimate>{{ text("pending.detail.estimate") }}</span>
                    </span>
                    <Button size="sm" variant="ghost" data-suspect-open @click="emit('open', suspect.target)">{{ text(suspect.initial ? "pending.detail.openEntry" : "origin.editStep") }}</Button>
                </li>
            </ul>
        </section>
        <div v-if="props.detail.links.length > 0" class="pending-detail__links" data-pending-detail-links>
            <Button v-for="link in props.detail.links" :key="`${link.target.kind}:${link.target.id}`" size="sm" variant="ghost" class="max-w-full" :title="link.label" data-pending-detail-link @click="emit('open', link.target)">
                <span class="min-w-0 truncate">{{ link.label }}</span>
            </Button>
        </div>
    </div>
</template>

<style scoped>
.pending-detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    font-size: var(--text-sm);
}

.pending-detail__title {
    margin: 0;
    overflow-wrap: anywhere;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
}

.pending-detail__muted {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.pending-detail__quote {
    display: flex;
    overflow-wrap: anywhere;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding-left: var(--space-3);
    border-left: 2px solid var(--divider);
    color: var(--text-secondary);
}

.pending-detail__facts {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--space-1) var(--space-3);
    margin: 0;
}

.pending-detail__facts dt {
    color: var(--text-muted);
}

.pending-detail__facts dd {
    margin: 0;
    overflow-wrap: anywhere;
}

.pending-detail__subtitle {
    margin: 0 0 var(--space-1);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
}

.pending-detail__suspects {
    margin: 0;
    padding: 0;
    list-style: none;
}

.pending-detail__suspect {
    display: flex;
    min-height: 32px;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
}

.pending-detail__suspect-text {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
    overflow-wrap: anywhere;
}

.pending-detail__estimate {
    color: var(--status-warning);
    font-size: var(--text-xs);
}

/* 链接的文字可能是整句情节：按钮不换行，放不下时截断、悬停看全文，不撑出横向滚动（输出 32）。 */
.pending-detail__links {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    gap: var(--space-1);
}
</style>
