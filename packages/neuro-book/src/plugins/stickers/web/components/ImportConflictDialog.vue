<script setup lang="ts">
import {Button, Dialog} from "@notnotype/nb-ui/components";

import {useStickersPageText} from "../text";

interface PreviewItem {
    readonly url: string;
    readonly label: string;
}

/** 导入同名时的对话框（同名 .md）。 */
withDefaults(defineProps<{
    open: boolean;
    name: string;
    existing: {readonly title: string; readonly count: number; readonly items: readonly PreviewItem[]};
    incoming: {readonly title: string; readonly count: number | null; readonly items: readonly PreviewItem[]};
    copyAs: string | null;
    busy?: boolean;
    status?: string;
}>(), {busy: false, status: ""});

const emit = defineEmits<{
    (e: "update:open", value: boolean): void;
    (e: "choose", mode: "copy" | "replace"): void;
}>();

const text = useStickersPageText();
</script>

<template>
    <Dialog
        :open="open"
        size="sm"
        :title="text('dialog.conflict.title', {name})"
        closable
        :show-footer="true"
        :busy="busy"
        data-sticker-conflict
        @update:open="(value: boolean) => emit('update:open', value)"
    >
        <div class="conflict">
            <div v-for="side in [{id: 'existing', label: text('dialog.conflict.existing'), data: existing}, {id: 'incoming', label: text('dialog.conflict.incoming'), data: incoming}]" :key="side.id" class="conflict__side" :data-conflict-side="side.id">
                <span class="conflict__label">{{ side.label }}</span>
                <div class="conflict__strip">
                    <span v-for="item in side.data.items" :key="item.label" class="conflict__slot"><img :src="item.url" alt="" /></span>
                </div>
                <span class="conflict__title">{{ side.data.title }}</span>
                <span class="conflict__count">{{ side.data.count === null ? text("dialog.conflict.countUnknown") : text("dialog.conflict.count", {count: String(side.data.count)}) }}</span>
            </div>
        </div>
        <p class="conflict__status" :class="{'is-error': status !== ''}" role="status" data-conflict-status>{{ status !== "" ? status : text("dialog.conflict.replaceNote") }}</p>
        <template #footer>
            <div class="conflict__footer">
                <Button size="sm" variant="ghost" :disabled="busy" @click="emit('update:open', false)">{{ text("dialog.cancel") }}</Button>
                <span class="conflict__spacer" />
                <Button size="sm" variant="secondary" :disabled="busy || copyAs === null" data-conflict-copy @click="emit('choose', 'copy')">{{ copyAs === null ? text("dialog.conflict.copyUnavailable") : text("dialog.conflict.copyAs", {name: copyAs}) }}</Button>
                <Button size="sm" variant="danger" :disabled="busy" data-conflict-replace @click="emit('choose', 'replace')">{{ text("dialog.conflict.replace") }}</Button>
            </div>
        </template>
    </Dialog>
</template>

<style scoped>
.conflict {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-5);
}

.conflict__side {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
}

.conflict__label {
    margin-bottom: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.conflict__strip {
    display: flex;
    gap: var(--space-1);
    min-height: 40px;
    margin-bottom: var(--space-2);
}

.conflict__slot {
    display: flex;
    width: 40px;
    height: 40px;
    align-items: center;
    justify-content: center;
    padding: 3px;
    overflow: hidden;
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--text-main) 4%, transparent);
}

.conflict__slot > img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
}

.conflict__title {
    font-weight: 600;
    overflow-wrap: anywhere;
}

.conflict__count {
    font-size: var(--text-xs);
    color: var(--text-muted);
}

/* 固定高度的一行：写“替换会删掉已有的这个包”，失败时换成原因；页脚被自己的按钮占了，Dialog 的状态行出不来。 */
.conflict__status {
    min-height: 36px;
    margin: var(--space-3) 0 0;
    font-size: var(--text-xs);
    line-height: 18px;
    color: var(--text-muted);
}

.conflict__status.is-error {
    color: var(--status-danger);
}

.conflict__footer {
    display: flex;
    width: 100%;
    align-items: center;
    gap: var(--space-2);
}

.conflict__spacer {
    flex: 1;
}
</style>
