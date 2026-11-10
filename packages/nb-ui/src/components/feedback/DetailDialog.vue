<script setup lang="ts">
import {computed} from "vue";

import {useUiText} from "../../text-port";
import Button from "../controls/Button.vue";
import CopyButton from "../controls/CopyButton.vue";
import CodeBlock from "../display/CodeBlock.vue";
import Dialog from "./Dialog.vue";

const props = withDefaults(defineProps<{
    open: boolean;
    title: string;
    detail: string;
    truncated?: boolean;
}>(), {
    truncated: false,
});

const emit = defineEmits<{(e: "update:open", value: boolean): void}>();

const text = useUiText();
const lines = computed(() => props.detail.split(/\r\n|\r|\n/u).map((line) => ({text: line})));

/**
 * 原文块的最大高度：对话框 md 档最多 85cqh，减去标题区、正文内边距、块的标题行与页脚（合计约 190px），
 * 让超长原文只在块内滚动、对话框正文不再出第二层滚动条。cqh 在没有尺寸容器时按小视口高度算，与 Dialog 同一基准。
 */
const BLOCK_MAX_HEIGHT = "min(480px, calc(85cqh - 190px))";
/** 原文是要读的句子，用 xs；CodeBlock 缺省的 2xs 只给角标、序号一类（theme.css 的字号说明）。 */
const BLOCK_STYLE = {fontSize: "var(--text-xs)"};
</script>

<template>
    <Dialog
        :open="props.open"
        size="md"
        :title="props.title"
        initial-focus="[data-detail-dialog-body]"
        @update:open="emit('update:open', $event)"
    >
        <!-- 初始焦点的落点：一个真实、可聚焦但不在 Tab 顺序里的容器，免得一打开就在复制按钮上画焦点光晕。 -->
        <div data-detail-dialog-body tabindex="-1" class="outline-none">
            <CodeBlock
                :label="text('detailDialog.source')"
                :lines="lines"
                :truncated="props.truncated"
                :truncated-text="text('detailDialog.truncated')"
                :max-height="BLOCK_MAX_HEIGHT"
                :style="BLOCK_STYLE"
            >
                <template #actions>
                    <!-- 标题行四周没有余地，外扩光晕会被块的圆角裁掉，所以用内嵌焦点线。 -->
                    <CopyButton :text="props.detail" focus-ring="inset" />
                </template>
            </CodeBlock>
        </div>
        <template #footer="{cancel}">
            <Button variant="secondary" @click="cancel">{{ text("detailDialog.close") }}</Button>
        </template>
    </Dialog>
</template>
