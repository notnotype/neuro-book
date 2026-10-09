<script setup lang="ts">
/** 纯文本控件（同名 .md）：一个 textarea，按编辑器控件合同（`control.ts`）绑定文档。 */
import {onBeforeUnmount, onMounted, ref, watch} from "vue";

import type {EditorControlHandle, ViewBinding} from "../area";
import type {EditorControlEmits} from "../control";

const props = defineProps<{binding: ViewBinding | null; readonly: boolean; visible: boolean; label: string}>();
const emit = defineEmits<EditorControlEmits>();

const area = ref<HTMLTextAreaElement | null>(null);

/** 视图状态：滚动与选区。 */
interface TextViewState {
    readonly scrollTop: number;
    readonly selectionStart: number;
    readonly selectionEnd: number;
}

/** 本控件确认过的修订：文档的修订前进到别的值时说明正文被别处改了。 */
let confirmed = -1;
/** 本绑定的输入成了未裁决输入：保留自己的内容，直到裁决。 */
let held = false;
let detach: (() => void) | null = null;

const commit = (binding: ViewBinding): void => {
    const element = area.value;
    if (element === null || props.readonly) return;
    const result = binding.commit(confirmed, element.value);
    if (result.status === "accepted") {
        confirmed = result.revision;
        held = false;
    } else if (result.status === "conflict") {
        held = true;
    }
};

const leave = (binding: ViewBinding): void => {
    const element = area.value;
    if (element !== null) {
        if (!held && element.value !== binding.document.text.value) commit(binding);
        binding.slot.state = {scrollTop: element.scrollTop, selectionStart: element.selectionStart, selectionEnd: element.selectionEnd} satisfies TextViewState;
    }
    detach?.();
    detach = null;
};

const enter = (binding: ViewBinding): void => {
    const element = area.value;
    if (element === null) return;
    element.value = binding.document.text.value;
    confirmed = binding.document.revision.value;
    held = false;
    const state = binding.slot.state as TextViewState | null;
    if (state !== null) {
        element.setSelectionRange(state.selectionStart, state.selectionEnd);
        element.scrollTop = state.scrollTop;
    }
    detach = binding.attach(() => {
        if (!held && area.value !== null && area.value.value !== binding.document.text.value) commit(binding);
    });
};

watch(() => props.binding, (next, previous) => {
    if (previous !== undefined && previous !== null) leave(previous);
    if (next !== null) enter(next);
}, {flush: "sync"});

// 正文被别处改了（另一个视图、磁盘、重新载入）或自己的未裁决输入被裁决了：按文档的正文重设。
watch(() => [props.binding?.document.revision.value, props.binding?.unresolved()] as const, () => {
    const binding = props.binding;
    const element = area.value;
    if (binding === null || element === null) return;
    if (held && binding.unresolved()) return;
    if (binding.document.revision.value === confirmed && !held) return;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    element.value = binding.document.text.value;
    element.setSelectionRange(Math.min(start, element.value.length), Math.min(end, element.value.length));
    confirmed = binding.document.revision.value;
    held = false;
});

const onInput = (): void => {
    if (props.binding !== null) commit(props.binding);
};

const lineCount = (): number | null => (area.value === null ? null : area.value.value.split("\n").length);

const handle: EditorControlHandle = {
    focus: () => area.value?.focus(),
    flushPendingChange: () => undefined,
    navigation: {
        getLineCount: lineCount,
        revealLine: (line) => {
            const element = area.value;
            const total = lineCount();
            if (element === null || total === null) return {ok: false, reason: "编辑器尚未就绪"};
            if (line < 1 || line > total) return {ok: false, reason: `行号超出范围：${String(line)}`};
            const offset = element.value.split("\n").slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0);
            element.focus();
            element.setSelectionRange(offset, offset);
            return {ok: true, value: {line}};
        },
    },
};

onMounted(() => {
    if (props.binding !== null) enter(props.binding);
    emit("ready", handle);
});

onBeforeUnmount(() => {
    if (props.binding !== null) leave(props.binding);
    emit("ready", null);
});
</script>

<template>
    <textarea
        ref="area"
        class="nb-ui-focus-ring block h-full w-full resize-none border-0 bg-transparent p-4 font-mono text-sm leading-6 text-[var(--text-main)] outline-none"
        :readonly="readonly"
        :aria-label="label"
        spellcheck="false"
        data-editor-control="plain"
        @input="onInput"
        @focus="emit('focus', true)"
        @blur="emit('focus', false)"
    ></textarea>
</template>
