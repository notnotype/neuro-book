<script setup lang="ts">
/** 条目页文字分页的编辑视图（同名 .md）：每块一个源文字输入框，块的增、拆、并、删。受控。 */
import {computed, nextTick, shallowRef, watch} from "vue";
import type {Component} from "vue";

import {AlertDialog, Button} from "@notnotype/nb-ui/components";

import {useCanonText} from "../text";
import type {EditorBlock} from "./entry-text-editor";
import PlainSourceInput from "./PlainSourceInput.vue";

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
/** 离开编辑要先问一句：有改动、读不出块（稿还在）、等着上一次提交的结局。没有这些时是“取消”，直接走。 */
const leavingAsks = computed(() => dirty.value || props.frozen || props.phase === "confirming");
const leave = (): void => {
    if (leavingAsks.value) discarding.value = true;
    else emit("cancel");
};

const bar = shallowRef<HTMLElement | null>(null);
// 整批的说明出现时把状态行带进视野：在长条目的下半截用键盘提交的人，否则看不到为什么没发出去。放在视口中间，不会被条目页
// 吸顶的页头盖住。
watch(() => props.message, (now) => {
    if (now !== "") void nextTick(() => bar.value?.scrollIntoView?.({block: "center"}));
});

const savedLabel = computed(() => {
    if (props.saved === "saved") return text("textEdit.saved");
    if (props.saved === "failed") return text("textEdit.notSaved");
    if (props.saved === "too-large") return text("textEdit.tooLargeToSave");
    return props.saved === "diverged" ? text("textEdit.diverged") : "";
});

type Caret = "start" | "end";
interface SourceInput {
    focus(caret?: Caret): void;
    cursorOffset(): number | null;
}
/** 各块的输入框实例：拆开要问光标，加块、并块以后要给焦点。 */
const inputs = new Map<string, SourceInput>();
/** 要给焦点、输入框却还没就绪的那一块：输入框是按需加载的组件时，块挂上了它的实例还要等一会儿才有。 */
let pendingFocus: {readonly key: string; readonly caret: Caret | undefined} | null = null;
const setInput = (key: string, instance: unknown): void => {
    // 按需加载的组件在加载完之前交来的不是输入框（没有 `focus`）：当作还没有。
    if (instance === null || typeof (instance as Partial<SourceInput>).focus !== "function") {
        inputs.delete(key);
        return;
    }
    inputs.set(key, instance as SourceInput);
    if (pendingFocus?.key === key) {
        const caret = pendingFocus.caret;
        pendingFocus = null;
        (instance as SourceInput).focus(caret);
    }
};
const focusBlock = (key: string, caret?: Caret): void => {
    const input = inputs.get(key);
    pendingFocus = input === undefined ? {key, caret} : null;
    input?.focus(caret);
};

/** 发出动作以后等宿主把新的块给回来，再把焦点放过去：`pick` 从新的块序里挑要聚焦的键。 */
const focusAfter = (pick: () => string | undefined, caret?: Caret): void => {
    void nextTick(() => {
        const key = pick();
        if (key !== undefined) focusBlock(key, caret);
    });
};
const add = (after: string | null): void => {
    emit("add", after);
    focusAfter(() => props.blocks[after === null ? 0 : props.blocks.findIndex((block) => block.key === after) + 1]?.key);
};
const split = (block: EditorBlock): void => {
    emit("split", block.key, inputs.get(block.key)?.cursorOffset() ?? block.text.length);
    // 光标原来在切口上：到了新块里是它的开头，接着写的字落在拆开的地方。
    focusAfter(() => props.blocks[props.blocks.findIndex((item) => item.key === block.key) + 1]?.key, "start");
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
    // 没有改动时 Esc 等于“取消”；有改动时不接（免得一下按没了），放弃要点按钮、再确认。输入法正在组字时的 Esc 是取消候选。
    if (event.key === "Escape" && !event.isComposing && !event.defaultPrevented && !leavingAsks.value && props.phase === "idle") emit("cancel");
};

defineExpose({focusBlock: (key: string): void => focusBlock(key)});
</script>

<template>
    <div class="text-editor" data-text-editor :data-text-editor-phase="props.phase" @keydown="onKeydown">
        <div ref="bar" class="text-editor__bar" :data-state="props.message !== '' || props.saved === 'failed' || props.saved === 'too-large' ? 'problem' : dirty ? 'dirty' : 'clean'">
            <!-- 基准宽度 14rem：右边的按钮多到剩不下这么宽时，这一行自己占一行、按钮换到下一行，不把字挤成一词一行。 -->
            <p class="flex min-w-0 flex-[1_1_14rem] flex-wrap items-center gap-x-2" role="status">
                <Transition name="text-editor-dot"><span v-if="dirty" class="text-editor__dot" aria-hidden="true" /></Transition>
                <Transition name="text-editor-fade"><span v-if="dirty" class="text-[var(--text-main)]" data-text-count>{{ text("textEdit.count", {count: props.count}) }}</span></Transition>
                <Transition name="text-editor-fade" mode="out-in">
                    <span v-if="props.phase === 'confirming'" key="confirming" class="text-[var(--text-muted)]" data-text-confirming>{{ text("textEdit.confirming") }}</span>
                    <span v-else-if="savedLabel !== ''" :key="props.saved" class="text-[var(--text-muted)]" :data-text-saved="props.saved">{{ savedLabel }}</span>
                </Transition>
                <!-- “提交”点不了的原因：按钮上的悬停文字键盘与读屏都读不到，写在这一行。整批的说明里正写着同一句时不重复。 -->
                <Transition name="text-editor-fade"><span v-if="dirty && props.submitBlocked !== '' && props.message !== props.submitBlocked" class="text-[var(--text-muted)]" data-text-submit-blocked>{{ props.submitBlocked }}</span></Transition>
            </p>
            <Transition name="text-editor-fade">
                <span v-if="props.saved === 'diverged'" class="flex items-center gap-2">
                    <Button size="sm" variant="ghost" data-text-take-over @click="emit('take-over')">{{ text("textEdit.takeOver") }}</Button>
                    <Button size="sm" variant="ghost" data-text-adopt @click="emit('adopt')">{{ text("textEdit.adopt") }}</Button>
                </span>
            </Transition>
            <Transition name="text-editor-fade"><Button v-if="props.phase === 'confirming'" size="sm" variant="ghost" data-text-retry @click="emit('retry')">{{ text("textEdit.retry") }}</Button></Transition>
            <!-- 一个按钮两种说法：没有东西可丢时是“取消”，否则是“放弃”（先问一句）。 -->
            <Button
                size="sm"
                variant="ghost"
                :disabled="props.phase === 'submitting'"
                :data-text-discard="leavingAsks ? '' : undefined"
                :data-text-cancel="leavingAsks ? undefined : ''"
                @click="leave()"
            >{{ text(leavingAsks ? "textEdit.discard" : "textEdit.cancel") }}</Button>
            <Button
                size="sm"
                variant="primary"
                :disabled="!dirty || props.phase !== 'idle' || props.frozen || props.submitBlocked !== '' || props.saved === 'diverged'"
                :loading="props.phase === 'submitting'"
                :title="props.submitBlocked !== '' ? props.submitBlocked : undefined"
                data-text-submit
                @click="emit('submit')"
            >{{ text("textEdit.submit") }}</Button>
            <Transition name="text-editor-note">
                <div v-if="props.message !== ''" class="text-editor__note basis-full">
                    <p class="text-[var(--status-danger)]" role="alert" data-text-message>{{ props.message }}</p>
                </div>
            </Transition>
        </div>

        <button v-if="!props.frozen" type="button" class="text-editor__add" :disabled="locked || props.addFirstBlocked !== ''" :title="props.addFirstBlocked !== '' ? props.addFirstBlocked : undefined" data-text-add="first" @click="add(null)">
            <span class="i-lucide-plus size-3.5" aria-hidden="true" />{{ text("textEdit.addFirst") }}
        </button>
        <!-- 列表是普通的块（不是 flex）：离开的块脱离文档流时留在原来的位置上淡出。 -->
        <TransitionGroup name="text-editor-item" tag="ol" class="relative">
            <li v-for="(block, index) in props.blocks" :key="block.key" class="flex flex-col" :data-text-block="block.key" :data-text-block-state="block.state">
                <Transition name="text-editor-fade" mode="out-in">
                <div v-if="block.state === 'removed'" key="removed" class="text-editor__gone">
                    <span class="min-w-0 flex-1 truncate">{{ text("textEdit.removedBlock", {preview: block.text.slice(0, 18)}) }}</span>
                    <Button size="sm" variant="ghost" :disabled="locked" data-text-restore @click="emit('restore', block.key)">{{ text("textEdit.restore") }}</Button>
                </div>
                <div v-else key="frame" class="text-editor__frame" :data-invalid="block.problem !== '' ? '' : undefined" :data-touched="block.state !== 'same' ? '' : undefined">
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
                    <Transition name="text-editor-note">
                        <div v-if="block.problem !== ''" class="text-editor__note">
                            <p class="pt-1 text-[length:var(--text-xs)] text-[var(--status-danger)]" role="alert" data-text-problem>{{ block.problem }}</p>
                        </div>
                    </Transition>
                </div>
                </Transition>
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
/* 不吸顶：条目页的页头已经吸在滚动区顶上，两个吸顶的条会叠在一起。 */
.text-editor__bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.25rem;
    font-size: var(--text-sm);
}
/* 说明这一类的行：出现时从 0 长到自己的高度，下面的内容跟着让开。 */
.text-editor__note {
    display: grid;
    grid-template-rows: 1fr;
}
.text-editor__note > * {
    min-height: 0;
    overflow: hidden;
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
    transition: border-color var(--motion-fast) var(--ease-layout);
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
    transition: color var(--motion-fast) var(--ease-layout), background-color var(--motion-fast) var(--ease-layout);
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

/* 块的进出：新块从下方 8px 淡入；离开的块淡出并让出位置（脱离文档流），后面的块滑上来。时长取令牌，减少动效的偏好由令牌置零。 */
.text-editor-item-enter-active {
    transition: opacity var(--motion-move) var(--ease-layout), transform var(--motion-move) var(--ease-layout);
}
.text-editor-item-leave-active {
    position: absolute;
    right: 0;
    left: 0;
    transition: opacity var(--motion-fast) var(--ease-dialog-leave);
}
.text-editor-item-move {
    transition: transform var(--motion-move) var(--ease-layout);
}
.text-editor-item-enter-from {
    opacity: 0;
    transform: translateY(8px);
}
.text-editor-item-leave-to {
    opacity: 0;
}
.text-editor-dot-enter-active,
.text-editor-dot-leave-active {
    transition: opacity var(--motion-fast) var(--ease-layout), transform var(--motion-fast) var(--ease-layout);
}
.text-editor-dot-enter-from,
.text-editor-dot-leave-to {
    opacity: 0;
    transform: scale(0.6);
}
.text-editor-fade-enter-active,
.text-editor-fade-leave-active {
    transition: opacity var(--motion-fast) var(--ease-layout);
}
.text-editor-fade-enter-from,
.text-editor-fade-leave-to {
    opacity: 0;
}
.text-editor-note-enter-active,
.text-editor-note-leave-active {
    transition: grid-template-rows var(--motion-move) var(--ease-layout), opacity var(--motion-fast) var(--ease-layout);
}
.text-editor-note-enter-from,
.text-editor-note-leave-to {
    grid-template-rows: 0fr;
    opacity: 0;
}
</style>
