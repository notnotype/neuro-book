<script setup lang="ts">
import {computed} from "vue";

import {useUiText} from "../../text-port";
import Button from "../controls/Button.vue";
import CopyButton from "../controls/CopyButton.vue";
import Dialog from "./Dialog.vue";

const props = withDefaults(defineProps<{
    open: boolean;
    title: string;
    detail: string;
    truncated?: boolean;
}>(), {
    truncated: false,
});

const emit = defineEmits<{(e: "update:open", value: boolean): void; (e: "closed"): void}>();

const text = useUiText();
const lines = computed(() => props.detail.split(/\r\n|\r|\n/u));

/** 与 `.nb-detail-dialog__text` 的 tab-size 一致：算续行缩进时一个制表符按这么多字符宽。 */
const TAB_SIZE = 4;

/**
 * 长行折行时，续行比这一行自己的缩进再多缩 2 个字符：堆栈帧、请求行折成两行时，看得出哪几行是同一行。
 * 用悬挂缩进（padding-left 加负的 text-indent）做，原文里的空白照常保留，选中复制出来的文字不变。
 */
function hanging(line: string): {paddingLeft: string; textIndent: string} {
    let indent = 0;
    for (const char of line) {
        if (char === " ") indent += 1;
        else if (char === "\t") indent += TAB_SIZE;
        else break;
    }
    const width = `${String(indent + 2)}ch`;
    return {paddingLeft: width, textIndent: `-${width}`};
}
</script>

<template>
    <Dialog
        :open="props.open"
        size="md"
        :title="props.title"
        initial-focus="[data-detail-dialog-body]"
        @update:open="emit('update:open', $event)"
        @closed="emit('closed')"
    >
        <!-- 初始焦点的落点：一个真实、可聚焦但不在 Tab 顺序里的容器，免得一打开就在复制按钮上画焦点光晕。
             原文不再套一层盒子（设计语言：对话框里再放一个面，多数情况的正确答案是不给面）；长原文由对话框正文自己滚动。 -->
        <div data-detail-dialog-body tabindex="-1" class="outline-none">
            <!-- 每行一个块：选中多行时按行换行，空行靠最小行高占位、复制出来是空的。 -->
            <pre class="nb-detail-dialog__text" data-detail-dialog-text><span v-for="(line, index) in lines" :key="index" class="nb-detail-dialog__line" :style="hanging(line)">{{ line }}</span></pre>
            <p v-if="props.truncated" class="nb-detail-dialog__note" data-detail-dialog-truncated>{{ text("detailDialog.truncated") }}</p>
        </div>
        <template #footer="{cancel}">
            <CopyButton :text="props.detail" :label="text('detailDialog.copy')" />
            <Button variant="secondary" @click="cancel">{{ text("detailDialog.close") }}</Button>
        </template>
    </Dialog>
</template>

<style scoped>
/* 原文是要读的句子：--text-xs（--text-2xs 只给角标、序号），主文字色；长行折行，URL 这类没有空格的长串也能断开。 */
.nb-detail-dialog__text {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.65;
    color: var(--text-main);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    tab-size: 4;
    user-select: text;
}

.nb-detail-dialog__line {
    display: block;
    min-height: 1lh;
}

.nb-detail-dialog__note {
    margin: 8px 0 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
}
</style>
