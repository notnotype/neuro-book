<script setup lang="ts">
/**
 * 回执页的骨架（docs/specs/canon/author-ui.md 输出 20、27、28、32）：标题与谁、什么时候、种类；“还原这次修订”；它是一次还原时
 * 还原的是哪几次；“改了什么”按新建、修改、删除、章序分节；“带来的变化”。受控：内容由宿主折好（`receipt.ts`），点了什么发出
 * 什么。回执页不改别的东西。
 */
import {Button} from "@notnotype/nb-ui/components";

import type {ReceiptModel} from "../../receipt";
import {useCanonText} from "../../text";
import WorldBanners from "../entry-page/WorldBanners.vue";

export type ReceiptPageStatus = "loading" | "failed" | "missing" | "normal";

const props = withDefaults(defineProps<{
    status: ReceiptPageStatus;
    model?: ReceiptModel | null;
    /** 这次是一次还原时，还原的那几次修订的标题（读不到的为 null）。 */
    reverted?: readonly {readonly id: string; readonly title: string | null}[];
    /** “还原这次修订”不可用时的原因（章序调整；世界写不了）；可用时为空。 */
    revertBlocked?: string;
    /** 有后面的修订依赖它：按钮可用，旁边写一句，对话框里再列出来。 */
    dependents?: number;
    disconnected?: boolean;
    readOnly?: string;
}>(), {model: null, reverted: () => [], revertBlocked: "", dependents: 0, disconnected: false, readOnly: ""});

const emit = defineEmits<{
    (event: "open", ref: {readonly kind: "entry" | "change"; readonly id: string}): void;
    /** 打开另一次修订的回执（还原的是哪一次）。 */
    (event: "receipt", id: string): void;
    (event: "revert"): void;
    (event: "retry"): void;
}>();

const text = useCanonText();
const sectionTitle = (kind: string): string => text(kind === "create" ? "receipt.created" : kind === "modify" ? "receipt.modified" : kind === "delete" ? "receipt.deleted" : "receipt.chapters");
</script>

<template>
    <article class="min-h-full" data-receipt-page>
        <WorldBanners :disconnected="props.disconnected" :read-only="props.readOnly" @retry="emit('retry')" />
        <p v-if="props.status === 'loading'" class="px-8 py-6 text-[length:var(--text-sm)] text-[var(--text-muted)]" role="status" aria-busy="true">{{ text("entries.loading") }}</p>
        <p v-else-if="props.status === 'failed'" class="px-8 py-6 text-[length:var(--text-sm)] text-[var(--status-danger)]" role="alert">{{ text("world.failed") }}</p>
        <p v-else-if="props.status === 'missing'" class="px-8 py-6 text-[length:var(--text-sm)] text-[var(--text-secondary)]">{{ text("receipt.missing") }}</p>
        <div v-else-if="props.model !== null" class="mx-auto max-w-[760px] px-8 py-5 max-[480px]:px-4">
            <header class="flex flex-wrap items-start gap-x-4 gap-y-2 border-b border-[var(--divider)] pb-4">
                <div class="min-w-0 flex-1 basis-64">
                    <h1 class="text-[length:var(--text-xl)] font-semibold text-[var(--text-main)]">{{ props.model.title }}</h1>
                    <p class="mt-1 text-[length:var(--text-sm)] text-[var(--text-secondary)]" data-receipt-meta>{{ text("receipt.meta", {by: props.model.by, time: props.model.time, what: props.model.what}) }}</p>
                    <p v-if="props.reverted.length > 0" class="mt-1 text-[length:var(--text-sm)] text-[var(--text-secondary)]" data-receipt-reverted>
                        {{ text("receipt.revertOf") }}<template v-for="(item, index) in props.reverted" :key="item.id"><span v-if="index > 0">{{ text("value.listSeparator") }}</span><button type="button" class="text-[var(--accent-main)] hover:underline" @click="emit('receipt', item.id)">{{ item.title ?? text("revert.untitled") }}</button></template>
                    </p>
                </div>
                <!-- 宽屏在标题右边、靠右排；窄屏换到标题下面，靠左。 -->
                <div class="flex max-w-full flex-col items-start gap-1 min-[481px]:items-end">
                    <Button size="sm" variant="secondary" :disabled="props.revertBlocked !== ''" @click="emit('revert')">{{ text("receipt.revert") }}</Button>
                    <p v-if="props.revertBlocked !== ''" class="text-[length:var(--text-xs)] text-[var(--text-muted)] min-[481px]:text-right" data-revert-blocked>{{ props.revertBlocked }}</p>
                    <p v-else-if="props.dependents > 0" class="text-[length:var(--text-xs)] text-[var(--text-muted)] min-[481px]:text-right">{{ text("receipt.dependents", {count: props.dependents}) }}</p>
                </div>
            </header>
            <section v-for="section in props.model.sections" :key="section.kind" class="mt-5" :data-receipt-section="section.kind">
                <h2 class="mb-2 text-[length:var(--text-sm)] font-semibold text-[var(--text-secondary)]">{{ sectionTitle(section.kind) }}</h2>
                <ul class="m-0 flex list-none flex-col gap-3 p-0">
                    <li v-for="item in section.items" :key="item.key" data-receipt-item>
                        <button v-if="item.ref !== null" type="button" class="text-[length:var(--text-sm)] font-medium text-[var(--accent-main)] hover:underline" @click="emit('open', item.ref)">{{ item.name }}</button>
                        <span v-else-if="item.name !== ''" class="text-[length:var(--text-sm)] font-medium text-[var(--text-main)]">{{ item.name }}</span>
                        <dl v-if="item.fields.length > 0" class="mt-1 grid grid-cols-[minmax(5rem,max-content)_minmax(0,1fr)] gap-x-4 gap-y-1 text-[length:var(--text-sm)]">
                            <template v-for="field in item.fields" :key="field.label">
                                <dt class="text-[var(--text-secondary)]">{{ field.label }}</dt>
                                <dd class="m-0 min-w-0 break-words text-[var(--text-main)]" data-receipt-field>
                                    <template v-if="field.before !== ''"><span class="text-[var(--text-muted)] line-through">{{ field.before }}</span> → </template>{{ field.after }}
                                </dd>
                            </template>
                        </dl>
                    </li>
                </ul>
            </section>
            <section class="mt-5" data-receipt-impact>
                <h2 class="mb-2 text-[length:var(--text-sm)] font-semibold text-[var(--text-secondary)]">{{ text("receipt.impact") }}</h2>
                <ul class="m-0 list-none p-0 text-[length:var(--text-sm)] text-[var(--text-main)]">
                    <li v-for="(line, index) in props.model.impact" :key="index">{{ line }}</li>
                </ul>
            </section>
        </div>
    </article>
</template>
