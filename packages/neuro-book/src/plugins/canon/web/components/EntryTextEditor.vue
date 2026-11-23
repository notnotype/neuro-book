<script setup lang="ts">
/** 条目页文字分页的编辑视图（同名 .md）：每块一个源文字输入框，块的增、拆、并、删。受控。 */
import {computed, nextTick, shallowRef} from "vue";
import type {Component} from "vue";

import {AlertDialog, Button} from "@notnotype/nb-ui/components";

import {useCanonText} from "../text";
import PlainSourceInput from "./PlainSourceInput.vue";

export interface EditorBlock {
    readonly key: string;
    readonly text: string;
    readonly state: "same" | "edited" | "new" | "removed" | "gone";
    readonly story: boolean;
    readonly blocked: {readonly edit: string; readonly remove: string; readonly split: string; readonly merge: string; readonly add: string};
    readonly problem: string;
}

const props = withDefaults(defineProps<{
    blocks: readonly EditorBlock[];
    addFirstBlocked: string;
    count: number;
    saved: "none" | "saved" | "unsaved" | "failed" | "too-large" | "diverged";
    phase: "idle" | "submitting" | "confirming";
    submitBlocked: string;
    message: string;
    frozen?: boolean;
    input?: Component;
    language?: string;
}>(), {frozen: false, input: undefined, language: "markdown"});

const emit = defineEmits<{
    (event: "update", key: string, text: string): void;
    (event: "add", after: string | null): void;
    (event: "split", key: string, offset: number): void;
    (event: "merge", key: string): void;
    (event: "remove", key: string): void;
    (event: "restore", key: string): void;
    (event: "blur"): void;
    (event: "submit"): void;
    (event: "discard"): void;
    (event: "cancel"): void;
    (event: "take-over"): void;
    (event: "adopt"): void;
    (event: "retry"): void;
}>();

const text = useCanonText();

const dirty = computed(() => props.count > 0);
/** 提交在途、等结局、读不出块：都不能改。 */
const locked = computed(() => props.phase !== "idle" || props.frozen);
const discarding = shallowRef(false);

const savedLabel = computed(() => {
    if (props.saved === "saved") return text("textEdit.saved");
    if (props.saved === "failed") return text("textEdit.notSaved");
    if (props.saved === "too-large") return text("textEdit.tooLargeToSave");
    return props.saved === "diverged" ? text("textEdit.diverged") : "";
});

/** 各块的输入框实例：拆开要问光标，加块、并块以后要给焦点。 */
const inputs = new Map<string, {focus(): void; cursorOffset(): number | null}>();
const setInput = (key: string, instance: unknown): void => {
    if (instance === null) inputs.delete(key);
    else inputs.set(key, instance as {focus(): void; cursorOffset(): number | null});
};
const focusBlock = (key: string): void => inputs.get(key)?.focus();

/** 发出动作以后等宿主把新的块给回来，再把焦点放过去：`pick` 从新的块序里挑要聚焦的键。 */
const focusAfter = (pick: () => string | undefined): void => {
    void nextTick(() => {
        const key = pick();
        if (key !== undefined) focusBlock(key);
    });
};
const add = (after: string | null): void => {
    emit("add", after);
    focusAfter(() => props.blocks[after === null ? 0 : props.blocks.findIndex((block) => block.key === after) + 1]?.key);
};
const split = (block: EditorBlock): void => {
    emit("split", block.key, inputs.get(block.key)?.cursorOffset() ?? block.text.length);
    focusAfter(() => props.blocks[props.blocks.findIndex((item) => item.key === block.key) + 1]?.key);
};
const merge = (block: EditorBlock): void => {
    const at = props.blocks.findIndex((item) => item.key === block.key);
    let into: string | undefined;
    for (let index = at - 1; index >= 0 && into === undefined; index -= 1) if (props.blocks[index]!.state !== "removed") into = props.blocks[index]!.key;
    emit("merge", block.key);
    focusAfter(() => into);
};

const sourceLabel = (index: number): string => text("textEdit.sourceLabel", {index: index + 1});
const note = (block: EditorBlock): string => (block.state === "gone" ? text("textEdit.goneBlock") : block.state === "new" ? text("textEdit.newBlock") : block.story ? text("textEdit.storyBlock") : "");

const onKeydown = (event: KeyboardEvent): void => {
    // 没有改动时 Esc 等于“取消”；有改动时不接（免得一下按没了），放弃要点按钮、再确认。
    if (event.key === "Escape" && !dirty.value && props.phase === "idle" && !event.defaultPrevented) emit("cancel");
};

defineExpose({focusBlock});
</script>

<template>
    <div class="text-editor" data-text-editor :data-text-editor-phase="props.phase" @keydown="onKeydown">
        <div class="text-editor__bar" :data-state="props.message !== '' || props.saved === 'failed' || props.saved === 'too-large' ? 'problem' : dirty ? 'dirty' : 'clean'">
            <p class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2" role="status">
                <Transition name="text-editor-dot"><span v-if="dirty" class="text-editor__dot" aria-hidden="true" /></Transition>
                <span v-if="dirty" class="text-[var(--text-main)]" data-text-count>{{ text("textEdit.count", {count: props.count}) }}</span>
                <span v-if="props.phase === 'confirming'" class="text-[var(--text-muted)]" data-text-confirming>{{ text("textEdit.confirming") }}</span>
                <Transition v-else name="text-editor-dot"><span v-if="savedLabel !== ''" :key="props.saved" class="text-[var(--text-muted)]" :data-text-saved="props.saved">{{ savedLabel }}</span></Transition>
            </p>
            <template v-if="props.saved === 'diverged'">
                <Button size="sm" variant="ghost" data-text-take-over @click="emit('take-over')">{{ text("textEdit.takeOver") }}</Button>
                <Button size="sm" variant="ghost" data-text-adopt @click="emit('adopt')">{{ text("textEdit.adopt") }}</Button>
            </template>
            <Button v-if="props.phase === 'confirming'" size="sm" variant="ghost" data-text-retry @click="emit('retry')">{{ text("textEdit.retry") }}</Button>
            <Button v-if="dirty || props.frozen || props.phase === 'confirming'" size="sm" variant="ghost" :disabled="props.phase === 'submitting'" data-text-discard @click="discarding = true">{{ text("textEdit.discard") }}</Button>
            <Button v-else size="sm" variant="ghost" :disabled="props.phase !== 'idle'" data-text-cancel @click="emit('cancel')">{{ text("textEdit.cancel") }}</Button>
            <Button
                size="sm"
                variant="primary"
                :disabled="!dirty || props.phase !== 'idle' || props.frozen || props.submitBlocked !== '' || props.saved === 'diverged'"
                :loading="props.phase === 'submitting'"
                :title="props.submitBlocked !== '' ? props.submitBlocked : 'Ctrl+S'"
                data-text-submit
                @click="emit('submit')"
            >{{ text("textEdit.submit") }}</Button>
            <p v-if="props.message !== ''" class="basis-full text-[var(--status-danger)]" role="alert" data-text-message>{{ props.message }}</p>
        </div>

        <button v-if="!props.frozen" type="button" class="text-editor__add" :disabled="locked || props.addFirstBlocked !== ''" :title="props.addFirstBlocked !== '' ? props.addFirstBlocked : undefined" data-text-add="first" @click="add(null)">
            <span class="i-lucide-plus size-3.5" aria-hidden="true" />{{ text("textEdit.addFirst") }}
        </button>
        <TransitionGroup name="text-editor-item" tag="ol" class="flex flex-col">
            <li v-for="(block, index) in props.blocks" :key="block.key" class="flex flex-col" :data-text-block="block.key" :data-text-block-state="block.state">
                <div v-if="block.state === 'removed'" class="text-editor__gone">
                    <span class="min-w-0 flex-1 truncate">{{ text("textEdit.removedBlock", {preview: block.text.slice(0, 18)}) }}</span>
                    <Button size="sm" variant="ghost" :disabled="locked" data-text-restore @click="emit('restore', block.key)">{{ text("textEdit.restore") }}</Button>
                </div>
                <div v-else class="text-editor__frame" :data-invalid="block.problem !== '' ? '' : undefined" :data-touched="block.state !== 'same' ? '' : undefined">
                    <div class="text-editor__tools">
                        <span class="mr-auto text-[var(--text-muted)]" data-text-note>{{ note(block) }}</span>
                        <template v-if="!props.frozen">
                            <Button size="sm" variant="ghost" :disabled="locked || block.blocked.split !== ''" :title="block.blocked.split !== '' ? block.blocked.split : undefined" data-text-split @click="split(block)">{{ text("textEdit.split") }}</Button>
                            <Button size="sm" variant="ghost" :disabled="locked || block.blocked.merge !== ''" :title="block.blocked.merge !== '' ? block.blocked.merge : undefined" data-text-merge @click="merge(block)">{{ text("textEdit.merge") }}</Button>
                            <Button size="sm" variant="ghost" :disabled="locked || block.blocked.remove !== ''" :title="block.blocked.remove !== '' ? block.blocked.remove : undefined" data-text-remove @click="emit('remove', block.key)">{{ text("textEdit.remove") }}</Button>
                        </template>
                    </div>
                    <component
                        :is="props.input ?? PlainSourceInput"
                        :ref="(instance: unknown) => setInput(block.key, instance)"
                        :model-value="block.text"
                        :label="sourceLabel(index)"
                        :language="props.language"
                        :readonly="locked || block.blocked.edit !== ''"
                        @update:model-value="(value: string) => emit('update', block.key, value)"
                        @blur="emit('blur')"
                    />
                    <p v-if="block.problem !== ''" class="mt-1 text-[length:var(--text-xs)] text-[var(--status-danger)]" role="alert" data-text-problem>{{ block.problem }}</p>
                </div>
                <button v-if="!props.frozen" type="button" class="text-editor__add" :disabled="locked || block.blocked.add !== ''" :title="block.blocked.add !== '' ? block.blocked.add : undefined" :data-text-add="block.key" @click="add(block.key)">
                    <span class="i-lucide-plus size-3.5" aria-hidden="true" />{{ text("textEdit.addHere") }}
                </button>
            </li>
        </TransitionGroup>

        <AlertDialog
            v-model:open="discarding"
            :title="text('textEdit.discardTitle')"
            :description="text('textEdit.discardDescription')"
            :confirm-label="text('textEdit.discardConfirm')"
            :cancel-label="text('textEdit.discardCancel')"
            @confirm="emit('discard')"
        />
    </div>
</template>

<style scoped>
.text-editor {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
}
.text-editor__bar {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.25rem;
    background: var(--panel-surface);
    font-size: var(--text-sm);
}
.text-editor__dot {
    width: 0.5rem;
    height: 0.5rem;
    flex-shrink: 0;
    border-radius: 9999px;
    background: var(--status-warning);
}
.text-editor__bar[data-state="problem"] .text-editor__dot {
    background: var(--status-danger);
}
.text-editor__frame {
    padding: 0.25rem 0.5rem 0.5rem;
    border: 1px solid var(--divider);
    border-left-width: 3px;
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--text-main) 3%, transparent);
    transition: border-color var(--motion-fast);
}
.text-editor__frame:focus-within {
    border-color: var(--accent-main);
}
.text-editor__frame[data-touched] {
    border-left-color: var(--status-warning);
}
.text-editor__frame[data-invalid] {
    border-color: var(--status-danger);
}
.text-editor__tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.125rem;
    min-height: 1.75rem;
    padding-left: 0.375rem;
    font-size: var(--text-xs);
}
.text-editor__gone {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.125rem 0.875rem;
    border: 1px dashed var(--divider);
    border-radius: var(--radius-control);
    color: var(--text-muted);
    font-size: var(--text-sm);
}
.text-editor__add {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    align-self: flex-start;
    margin: 0.125rem 0;
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-control);
    color: var(--text-muted);
    font-size: var(--text-xs);
    transition: color var(--motion-fast), background-color var(--motion-fast);
}
.text-editor__add:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}
.text-editor__add:not(:disabled):hover,
.text-editor__add:not(:disabled):focus-visible {
    background: var(--bg-hover);
    color: var(--text-main);
}
.text-editor__add:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
}

.text-editor-item-enter-active,
.text-editor-item-leave-active {
    transition: opacity var(--motion-base), transform var(--motion-base);
}
.text-editor-item-enter-from,
.text-editor-item-leave-to {
    opacity: 0;
    transform: translateY(4px);
}
.text-editor-dot-enter-active,
.text-editor-dot-leave-active {
    transition: opacity var(--motion-fast), transform var(--motion-fast);
}
.text-editor-dot-enter-from,
.text-editor-dot-leave-to {
    opacity: 0;
    transform: scale(0.6);
}
@media (prefers-reduced-motion: reduce) {
    .text-editor-item-enter-active,
    .text-editor-item-leave-active,
    .text-editor-dot-enter-active,
    .text-editor-dot-leave-active,
    .text-editor__frame,
    .text-editor__add {
        transition: none;
    }
}
</style>
