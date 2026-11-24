<script setup lang="ts">
/** 条目页文字分页的编辑视图（同名 .md）：一个整篇源文字的输入框，上面一行状态与动作。受控。 */
import {computed, nextTick, shallowRef, watch} from "vue";
import type {Component} from "vue";

import {AlertDialog, Button, DropdownMenu} from "@notnotype/nb-ui/components";

import {useCanonText} from "../text";
import type {InsertItem} from "./entry-text-editor";
import PlainSourceInput from "./PlainSourceInput.vue";

const props = withDefaults(defineProps<{
    text: string;
    problem: string;
    dirty: boolean;
    saved: "none" | "saved" | "unsaved" | "failed" | "too-large" | "diverged";
    phase: "idle" | "submitting" | "confirming";
    submitBlocked: string;
    message: string;
    frozen?: boolean;
    inserts?: readonly InsertItem[];
    input?: Component;
    language?: string;
}>(), {frozen: false, inserts: () => [], input: undefined, language: "markdown"});

const emit = defineEmits<{
    (event: "update", text: string): void;
    (event: "insert", snippet: string, offset: number | null): void;
    (event: "blur"): void;
    (event: "submit"): void;
    (event: "discard"): void;
    (event: "cancel"): void;
    (event: "take-over"): void;
    (event: "adopt"): void;
    (event: "retry"): void;
}>();

const text = useCanonText();

/** 提交在途、等结局、读不出块：都不能改。 */
const locked = computed(() => props.phase !== "idle" || props.frozen);
const discarding = shallowRef(false);
/** 离开编辑要先问一句：有改动、读不出块（稿还在）、等着上一次提交的结局。没有这些时是“取消”，直接走。 */
const leavingAsks = computed(() => props.dirty || props.frozen || props.phase === "confirming");
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

interface SourceInput {
    focus(caret?: "start" | "end"): void;
    cursorOffset(): number | null;
}
let input: SourceInput | null = null;
/** 要给焦点、输入框却还没就绪：输入框是按需加载的组件时，它的实例要等一会儿才有。 */
let pendingFocus = false;
const setInput = (instance: unknown): void => {
    // 按需加载的组件在加载完之前交来的不是输入框（没有 `focus`）：当作还没有。
    input = instance !== null && typeof (instance as Partial<SourceInput>).focus === "function" ? instance as SourceInput : null;
    if (input !== null && pendingFocus) {
        pendingFocus = false;
        input.focus();
    }
};
const focus = (): void => {
    pendingFocus = input === null;
    input?.focus();
};

const insertItems = computed(() => props.inserts.map((item) => ({id: item.snippet, label: item.label})));
/** 菜单开着的时候焦点不在输入框里：输入框记着光标的位置，选完以后照它插入，再把焦点还回去。 */
const insert = (snippet: string): void => {
    emit("insert", snippet, input?.cursorOffset() ?? null);
    void nextTick(focus);
};

const onKeydown = (event: KeyboardEvent): void => {
    // 没有改动时 Esc 等于“取消”；有改动时不接（免得一下按没了），放弃要点按钮、再确认。输入法正在组字时的 Esc 是取消候选。
    if (event.key === "Escape" && !event.isComposing && !event.defaultPrevented && !leavingAsks.value && props.phase === "idle") emit("cancel");
};

defineExpose({focus});
</script>

<template>
    <div class="text-editor" data-text-editor :data-text-editor-phase="props.phase" @keydown="onKeydown">
        <div ref="bar" class="text-editor__bar" :data-state="props.message !== '' || props.saved === 'failed' || props.saved === 'too-large' ? 'problem' : props.dirty ? 'dirty' : 'clean'">
            <!-- 基准宽度 14rem：右边的按钮多到剩不下这么宽时，这一行自己占一行、按钮换到下一行，不把字挤成一词一行。 -->
            <p class="flex min-w-0 flex-[1_1_14rem] flex-wrap items-center gap-x-2" role="status">
                <Transition name="text-editor-dot"><span v-if="props.dirty" class="text-editor__dot" aria-hidden="true" /></Transition>
                <Transition name="text-editor-fade"><span v-if="props.dirty" class="text-[var(--text-main)]" data-text-dirty>{{ text("textEdit.dirty") }}</span></Transition>
                <Transition name="text-editor-fade" mode="out-in">
                    <span v-if="props.phase === 'confirming'" key="confirming" class="text-[var(--text-muted)]" data-text-confirming>{{ text("textEdit.confirming") }}</span>
                    <span v-else-if="savedLabel !== ''" :key="props.saved" class="text-[var(--text-muted)]" :data-text-saved="props.saved">{{ savedLabel }}</span>
                </Transition>
                <!-- “提交”点不了的原因：按钮上的悬停文字键盘与读屏都读不到，写在这一行。整批的说明里正写着同一句时不重复。 -->
                <Transition name="text-editor-fade"><span v-if="props.dirty && props.submitBlocked !== '' && props.message !== props.submitBlocked" class="text-[var(--text-muted)]" data-text-submit-blocked>{{ props.submitBlocked }}</span></Transition>
            </p>
            <Transition name="text-editor-fade">
                <span v-if="props.saved === 'diverged'" class="flex items-center gap-2">
                    <Button size="sm" variant="ghost" data-text-take-over @click="emit('take-over')">{{ text("textEdit.takeOver") }}</Button>
                    <Button size="sm" variant="ghost" data-text-adopt @click="emit('adopt')">{{ text("textEdit.adopt") }}</Button>
                </span>
            </Transition>
            <Transition name="text-editor-fade"><Button v-if="props.phase === 'confirming'" size="sm" variant="ghost" data-text-retry @click="emit('retry')">{{ text("textEdit.retry") }}</Button></Transition>
            <DropdownMenu v-if="!props.frozen && insertItems.length > 0" align="end" :items="insertItems" :disabled="locked" @select="insert">
                <Button size="sm" variant="ghost" :disabled="locked" data-text-insert><span class="i-lucide-plus size-3.5" aria-hidden="true" />{{ text("textEdit.insert") }}</Button>
            </DropdownMenu>
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
                :disabled="!props.dirty || props.phase !== 'idle' || props.frozen || props.submitBlocked !== '' || props.saved === 'diverged'"
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

        <div class="text-editor__frame" :data-invalid="props.problem !== '' ? '' : undefined" data-text-source>
            <component
                :is="props.input ?? PlainSourceInput"
                :ref="setInput"
                :model-value="props.text"
                :label="text('textEdit.sourceLabel')"
                :language="props.language"
                :readonly="locked"
                @update:model-value="(value: string) => emit('update', value)"
                @blur="emit('blur')"
            />
            <Transition name="text-editor-note">
                <div v-if="props.problem !== ''" class="text-editor__note">
                    <p class="pt-1 text-[length:var(--text-xs)] text-[var(--status-danger)]" role="alert" data-text-problem>{{ props.problem }}</p>
                </div>
            </Transition>
        </div>

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
    padding: 0.5rem;
    border: 1px solid var(--divider);
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--text-main) 3%, transparent);
    transition: border-color var(--motion-fast) var(--ease-layout);
}
.text-editor__frame:focus-within {
    border-color: var(--accent-main);
}
.text-editor__frame[data-invalid] {
    border-color: var(--status-danger);
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
