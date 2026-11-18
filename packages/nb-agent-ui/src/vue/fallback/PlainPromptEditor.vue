<script setup lang="ts">
import {nextTick, ref, watch} from "vue";

import type {PromptAttachment, PromptDraft, PromptEditorPortExpose, PromptLocale, PromptMenu, PromptMenuContext, PromptPastePolicy} from "../../ports";

/**
 * 宿主没有注入提示词编辑器时的缺省实现：一个普通文本框，只认草稿版本、回车与 Ctrl/⌘+回车、Escape、Shift+Tab。
 * 没有标签、附件、粘贴块与触发菜单；属性里收这些是为了与真编辑器同形，多出来的一律不用。
 * 草稿的约定同 docs/specs/ui/prompt-editor.md：版本号变化时替换正文，同一版本内的文字变化是自己的回声。
 */
const props = withDefaults(defineProps<{
    draft: PromptDraft;
    locale: PromptLocale;
    placeholder?: string;
    ariaLabel?: string;
    readonly?: boolean;
    enterSubmits?: boolean;
    fill?: boolean;
    bare?: boolean;
    // 下面这些与真编辑器同形、这里用不上；声明出来，免得 Vue 把它们当透传属性写到 <textarea> 上（输入历史、函数源码都会进 DOM）。
    triggers?: readonly string[];
    resolveMenu?: (context: PromptMenuContext) => PromptMenu;
    commands?: readonly string[];
    acceptImages?: boolean;
    acceptFiles?: boolean;
    attachments?: readonly PromptAttachment[];
    resolveThumbnail?: (target: string) => string | null;
    pastePolicy?: Partial<PromptPastePolicy>;
    recall?: readonly string[];
}>(), {
    placeholder: "",
    ariaLabel: "",
    readonly: false,
    enterSubmits: true,
    fill: false,
    bare: false,
});

const emit = defineEmits<{
    (e: "change", text: string): void;
    (e: "submit", payload: {mod: boolean}): void;
    (e: "escape"): void;
    (e: "shift-tab"): void;
}>();

const textarea = ref<HTMLTextAreaElement | null>(null);
const value = ref(props.draft.text);

watch(() => props.draft.version, () => {
    value.value = props.draft.text;
});

function onInput(event: Event) {
    value.value = (event.target as HTMLTextAreaElement).value;
    emit("change", value.value);
}

function onKeydown(event: KeyboardEvent) {
    // WebKit 在组字结束之后才派发确认用的回车，那时 isComposing 已是 false，只有 keyCode 229 认得出（同真编辑器）。
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
        emit("escape");
        return;
    }
    if (event.key === "Tab" && event.shiftKey) {
        event.preventDefault();
        emit("shift-tab");
        return;
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    const mod = event.ctrlKey || event.metaKey;
    if (!mod && !props.enterSubmits) return;
    event.preventDefault();
    emit("submit", {mod});
}

const expose: PromptEditorPortExpose = {
    focus(at = "end") {
        void nextTick(() => {
            const element = textarea.value;
            if (element === null) return;
            element.focus();
            if (at === "keep") return;
            const position = at === "start" ? 0 : element.value.length;
            element.setSelectionRange(position, position);
        });
    },
    insertText(text) {
        const element = textarea.value;
        if (element === null || props.readonly) return;
        const start = element.selectionStart;
        value.value = value.value.slice(0, start) + text + value.value.slice(element.selectionEnd);
        emit("change", value.value);
        // 换了值浏览器会把光标放到末尾：放回插入的文字后面。
        void nextTick(() => element.setSelectionRange(start + text.length, start + text.length));
    },
    // 普通文本框收不了附件；输入框在缺省实现下不显示“添加附件”。
    insertFiles() {},
    // 普通文本框没有触发菜单：照样插到末尾（前一个字不是空白时补空格），用户接着手打。
    openTrigger(char) {
        if (props.readonly) return;
        const needsSpace = value.value !== "" && !/\s$/u.test(value.value);
        value.value = `${value.value}${needsSpace ? " " : ""}${char}`;
        emit("change", value.value);
        expose.focus("end");
    },
};

defineExpose(expose);
</script>

<template>
    <textarea
        ref="textarea"
        class="plain-prompt-editor"
        :class="{'is-bare': props.bare, 'is-fill': props.fill}"
        :value="value"
        :placeholder="props.placeholder"
        :aria-label="props.ariaLabel || undefined"
        :readonly="props.readonly"
        rows="2"
        @input="onInput"
        @keydown="onKeydown"
    />
</template>

<style scoped>
.plain-prompt-editor {
    display: block;
    width: 100%;
    min-height: 36px;
    max-height: 200px;
    padding: 8px 10px;
    border: var(--border-w, 1px) solid var(--border-color);
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--text-main);
    font: inherit;
    line-height: 1.6;
    resize: none;
}

.plain-prompt-editor.is-bare {
    border: none;
    border-radius: 0;
}

.plain-prompt-editor.is-fill {
    height: 100%;
    max-height: none;
}

/* 去掉外框时焦点由外层（输入框外框的 focus-within）表示。 */
.plain-prompt-editor.is-bare:focus-visible {
    outline: none;
}
</style>
