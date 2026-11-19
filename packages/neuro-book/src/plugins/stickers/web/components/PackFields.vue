<script setup lang="ts">
import {Button, Field, InfoTip, Input, Switch, Textarea} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import type {StickerPackDetail} from "../../shared/contracts";
import {useCommittedText} from "../field-draft";
import {useStickersPageText} from "../text";

/** 表情包页属性栏：没选表情时（同名 .md）。 */
const props = withDefaults(defineProps<{
    detail: StickerPackDetail;
    readonly?: boolean;
    commit: (change: {title?: string | null; description?: string | null}) => Promise<string | null>;
    /** 这个包按不按贴纸显示（输出 47）；null 时不画这个开关（没有偏好服务）。 */
    stickerDisplay?: boolean | null;
}>(), {readonly: false, stickerDisplay: null});

const emit = defineEmits<{
    (e: "rename"): void;
    (e: "update:stickerDisplay", on: boolean): void;
}>();

const text = useStickersPageText();
const summary = computed(() => props.detail.summary);
const title = useCommittedText(() => summary.value.title, (value) => props.commit({title: value}));
const description = useCommittedText(() => summary.value.description ?? "", (value) => props.commit({description: value}));
const status = computed(() => title.error.value || description.error.value);
const common = computed(() => props.detail.stickers.filter((sticker) => sticker.common).length);
</script>

<template>
    <div class="pack-fields" data-pack-fields>
        <template v-if="readonly">
            <p class="pack-fields__title">{{ summary.title }}</p>
            <p v-if="summary.description" class="pack-fields__muted">{{ summary.description }}</p>
            <p class="pack-fields__muted">{{ text("panel.pluginNote") }}</p>
        </template>
        <template v-else>
            <Field :label="text('panel.displayName')">
                <Input v-model="title.draft.value" size="sm" data-pack-title @focus="title.onFocus" @blur="title.onBlur" @keydown.enter="title.onEnter" @keydown.esc.stop="title.onEscape" />
            </Field>
            <Field :label="text('panel.description')">
                <Textarea v-model="description.draft.value" :rows="2" autosize :placeholder="text('panel.placeholder')" data-pack-description @focus="description.onFocus" @blur="description.onBlur" @keydown.esc.stop="description.onEscape" />
            </Field>
        </template>
        <div class="pack-fields__row">
            <span class="pack-fields__label">{{ text("panel.packName") }}</span>
            <code>{{ summary.folder }}</code>
            <Button v-if="!readonly" size="sm" variant="ghost" class="pack-fields__rename" data-pack-rename @click="emit('rename')">{{ text("panel.changePackName") }}</Button>
        </div>
        <div class="pack-fields__meta">
            <span>{{ text("panel.syntax") }} <code>:{{ summary.writing ?? summary.folder }}/…:</code></span>
            <span>{{ text("panel.packSummary", {count: String(summary.count), common: String(common)}) }}</span>
        </div>
        <!-- 偏好，不是包的内容：插件与内置的包也能设。 -->
        <label v-if="stickerDisplay !== null" class="pack-fields__switch">
            <span class="pack-fields__switch-label">{{ text("panel.stickerDisplay") }}<InfoTip :text="text('panel.stickerDisplayTip')" /></span>
            <Switch :model-value="stickerDisplay" size="sm" :aria-label="text('panel.stickerDisplay')" data-pack-sticker-display @update:model-value="emit('update:stickerDisplay', $event)" />
        </label>
        <p class="pack-fields__status is-error" role="status" data-pack-status>{{ status }}</p>
    </div>
</template>

<style scoped>
.pack-fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.pack-fields__title {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 600;
}

.pack-fields__muted {
    margin: 0;
    color: var(--text-muted);
}

/* 同 StickerFields 的“常用”一行：名字带问号说明在左、开关在右。 */
.pack-fields__switch {
    display: flex;
    min-height: var(--control-h-sm);
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
}

.pack-fields__switch-label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
}

.pack-fields__row {
    display: flex;
    min-height: var(--control-h-sm);
    align-items: center;
    gap: var(--space-2);
}

.pack-fields__row code,
.pack-fields__meta code {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
}

.pack-fields__label {
    color: var(--text-muted);
}

.pack-fields__rename {
    margin-left: auto;
}

.pack-fields__meta {
    display: flex;
    flex-direction: column;
    font-size: var(--text-xs);
    line-height: 18px;
    color: var(--text-muted);
}

.pack-fields__status {
    min-height: 36px;
    margin: 0;
    font-size: var(--text-xs);
    line-height: 18px;
    color: var(--status-danger);
}
</style>
