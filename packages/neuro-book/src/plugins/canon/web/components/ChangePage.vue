<script setup lang="ts">
/**
 * 变更详情页的骨架（docs/specs/canon/author-ui.md 输出 21、27、28、30、32）：文字、安放、已写还是计划、生效状态（待定时写原因
 * 与“改成生效”）、原句（出处是章节正文的有“打开这一章”）、涉及的条目、每一处改动（数的改动旁有“改”）。受控：内容由宿主折好
 * （`change.ts`），确认条由宿主放进 `bar` 插槽（贴在内容顶上）；“改成生效”的确认在页面里，状态由宿主给。
 */
import {Button} from "@notnotype/nb-ui/components";

import type {ChangeModel} from "../change";
import type {ChangeWriteFeedback} from "../change-edit";
import {useCanonText} from "../text";
import WorldBanners from "./WorldBanners.vue";

export type ChangePageStatus = "loading" | "failed" | "missing" | "normal";

const props = withDefaults(defineProps<{
    status: ChangePageStatus;
    model?: ChangeModel | null;
    /** 写入入口不可用的原因（只读、独占、断开）；可以写时为空。 */
    blocked?: string;
    /** “改成生效”的确认开着时：预览与原因。 */
    activation?: ChangeWriteFeedback | null;
    /** 没找到文件的那一章（“打开这一章”失败）。 */
    chapterMissing?: string | null;
    disconnected?: boolean;
    readOnly?: string;
}>(), {model: null, blocked: "", activation: null, chapterMissing: null, disconnected: false, readOnly: ""});

const emit = defineEmits<{
    (event: "open-entry", id: string): void;
    (event: "open-chapter", chapter: string): void;
    /** 点了一处改动旁的“改”。 */
    (event: "edit", index: number): void;
    /** 点了“改成生效”。 */
    (event: "activate"): void;
    (event: "activation-save"): void;
    (event: "activation-cancel"): void;
    (event: "retry"): void;
}>();

defineSlots<{
    /** 改一处的确认条。 */
    bar?(): unknown;
}>();

const text = useCanonText();
</script>

<template>
    <article class="min-h-full" data-change-page>
        <WorldBanners :disconnected="props.disconnected" :read-only="props.readOnly" @retry="emit('retry')" />
        <p v-if="props.status === 'loading'" class="px-8 py-6 text-[length:var(--text-sm)] text-[var(--text-muted)]" role="status" aria-busy="true">{{ text("entries.loading") }}</p>
        <p v-else-if="props.status === 'failed'" class="px-8 py-6 text-[length:var(--text-sm)] text-[var(--status-danger)]" role="alert">{{ text("world.failed") }}</p>
        <p v-else-if="props.status === 'missing'" class="px-8 py-6 text-[length:var(--text-sm)] text-[var(--text-secondary)]">{{ text("change.missing") }}</p>
        <div v-else-if="props.model !== null" class="mx-auto max-w-[760px] px-8 py-5 max-[480px]:px-4">
            <slot name="bar" />
            <header class="border-b border-[var(--divider)] pb-4">
                <h1 class="text-[length:var(--text-xl)] font-semibold text-[var(--text-main)]">{{ props.model.text }}</h1>
                <p class="mt-1 flex flex-wrap items-center gap-x-2 text-[length:var(--text-sm)] text-[var(--text-secondary)]" data-change-meta>
                    <span>{{ props.model.place }}</span>
                    <span aria-hidden="true">·</span>
                    <span>{{ props.model.kind }}</span>
                    <span aria-hidden="true">·</span>
                    <span :class="props.model.status === 'active' ? '' : 'text-[var(--status-warning)]'">{{ props.model.statusText }}</span>
                </p>
                <div v-if="props.model.status === 'held'" class="mt-3 rounded-[var(--radius-control)] bg-[var(--bg-subtle)] px-3 py-2 text-[length:var(--text-sm)]" data-change-held>
                    <div class="flex flex-wrap items-center gap-2">
                        <p class="min-w-0 flex-1 text-[var(--text-secondary)]">{{ props.model.heldReason }}</p>
                        <Button variant="primary" v-if="props.activation === null" size="sm" :disabled="props.blocked !== ''" :title="props.blocked === '' ? undefined : props.blocked" @click="emit('activate')">{{ text("change.activate") }}</Button>
                    </div>
                    <div v-if="props.activation !== null" class="mt-2" data-change-activation>
                        <p v-if="props.activation.previewing" class="text-[var(--text-muted)]">{{ text("edit.previewing") }}</p>
                        <ul v-else-if="props.activation.preview !== null" class="m-0 list-none p-0 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
                            <li v-for="(line, index) in props.activation.preview" :key="index">{{ line }}</li>
                        </ul>
                        <p v-if="props.activation.error !== ''" role="alert" class="mt-1 text-[var(--status-danger)]">{{ props.activation.error }}</p>
                        <div class="mt-2 flex justify-end gap-2">
                            <Button size="sm" variant="ghost" @click="emit('activation-cancel')">{{ text("edit.cancel") }}</Button>
                            <Button variant="primary" size="sm" :disabled="props.activation.preview === null || props.activation.previewing || props.activation.saving || props.activation.locked" @click="emit('activation-save')">{{ text("change.activate") }}</Button>
                        </div>
                    </div>
                </div>
                <p v-else-if="props.model.undoneReason !== ''" class="mt-2 text-[length:var(--text-sm)] text-[var(--text-secondary)]">{{ text("change.undoneReason", {reason: props.model.undoneReason}) }}</p>
            </header>
            <section v-if="props.model.quotes.length > 0" class="mt-5" data-change-quotes>
                <h2 class="mb-2 text-[length:var(--text-sm)] font-semibold text-[var(--text-secondary)]">{{ text("change.quotes") }}</h2>
                <ul class="m-0 flex list-none flex-col gap-2 p-0 text-[length:var(--text-sm)]">
                    <li v-for="quote in props.model.quotes" :key="quote.key" data-change-quote>
                        <p class="text-[var(--text-main)]">{{ text("change.quote", {quote: quote.quote}) }}</p>
                        <p class="flex flex-wrap items-center gap-2 text-[length:var(--text-xs)] text-[var(--text-muted)]">
                            <span>{{ quote.source }}</span>
                            <button v-if="quote.chapter !== null" type="button" class="text-[var(--accent-main)] hover:underline" @click="emit('open-chapter', quote.chapter)">{{ text("change.openChapter") }}</button>
                            <span v-if="quote.chapter !== null && props.chapterMissing === quote.chapter" role="alert" class="text-[var(--status-warning)]">{{ text("change.chapterMissing") }}</span>
                        </p>
                    </li>
                </ul>
            </section>
            <section v-if="props.model.involved.length > 0" class="mt-5" data-change-involved>
                <h2 class="mb-2 text-[length:var(--text-sm)] font-semibold text-[var(--text-secondary)]">{{ text("change.involved") }}</h2>
                <p class="flex flex-wrap gap-x-3 gap-y-1 text-[length:var(--text-sm)]">
                    <button v-for="entry in props.model.involved" :key="entry.id" type="button" class="text-[var(--accent-main)] hover:underline" @click="emit('open-entry', entry.id)">{{ entry.name }}</button>
                </p>
            </section>
            <section class="mt-5" data-change-patches>
                <h2 class="mb-2 text-[length:var(--text-sm)] font-semibold text-[var(--text-secondary)]">{{ text("change.patches") }}</h2>
                <p v-if="props.model.patches.length === 0" class="text-[length:var(--text-sm)] text-[var(--text-muted)]">{{ text("change.noPatches") }}</p>
                <ul v-else class="m-0 flex list-none flex-col gap-1.5 p-0 text-[length:var(--text-sm)]">
                    <li v-for="patch in props.model.patches" :key="patch.index" class="flex flex-wrap items-baseline gap-x-2" data-change-patch>
                        <span class="text-[var(--text-main)]">{{ patch.line }}</span>
                        <span v-if="patch.basis !== undefined" :class="patch.basis.estimate ? 'text-[var(--status-warning)]' : 'text-[var(--text-muted)]'">{{ text("change.basis", {basis: patch.basis.text}) }}</span>
                        <Button
                            v-if="patch.editable"
                            size="sm"
                            variant="ghost"
                            :data-edit-patch="patch.index"
                            :aria-label="text('edit.label', {label: patch.label})"
                            :disabled="props.blocked !== ''"
                            :title="props.blocked === '' ? undefined : props.blocked"
                            @click="emit('edit', patch.index)"
                        >{{ text("edit.button") }}</Button>
                    </li>
                </ul>
            </section>
        </div>
    </article>
</template>
