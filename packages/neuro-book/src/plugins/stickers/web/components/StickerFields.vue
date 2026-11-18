<script setup lang="ts">
import {Button, CopyButton, Field, InfoTip, Input, Switch, Textarea} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import {useCommittedText} from "../field-draft";
import {sizeLabel} from "../pack-view";
import type {GridItem} from "../pack-view";
import {useStickersPageText} from "../text";

/** 表情包页属性栏：选中一个格子时（同名 .md）。 */
const props = withDefaults(defineProps<{
    item: GridItem;
    folder: string;
    problem?: boolean;
    unlisted?: boolean;
    readonly?: boolean;
    commit: (change: {name?: string | null; description?: string | null; common?: boolean}) => Promise<string | null>;
}>(), {problem: false, unlisted: false, readonly: false});

const emit = defineEmits<{
    (e: "delete"): void;
    (e: "list"): void;
    (e: "back"): void;
}>();

const text = useStickersPageText();
/** 认不出的图名字还没有：输入框里是空的，要用户写一个。 */
const name = useCommittedText(() => props.item.name ?? "", (value) => props.commit({name: value}));
const description = useCommittedText(() => props.item.description ?? "", (value) => props.commit({description: value}));
const syntax = computed(() => `:${props.folder}/${props.item.name ?? ""}:`);
const status = computed(() => name.error.value || description.error.value || (props.problem ? text("panel.nameRule") : ""));
const failing = computed(() => name.error.value !== "" || description.error.value !== "");
const editable = computed(() => !props.readonly && !props.unlisted);

async function toggle(value: boolean): Promise<void> {
    await props.commit({common: value});
}
</script>

<template>
    <div class="sticker-fields" data-sticker-fields>
        <button type="button" class="sticker-fields__back nb-ui-focus-ring" data-sticker-back @click="emit('back')">
            <span class="i-lucide-chevron-left" aria-hidden="true" />{{ text("panel.back") }}
        </button>
        <span class="sticker-slot sticker-fields__preview" :class="{'is-faded': problem || unlisted}"><img :src="item.url" :alt="item.label" /></span>

        <template v-if="unlisted">
            <p class="sticker-fields__title">{{ item.file }}</p>
            <p class="sticker-fields__muted">{{ text("panel.unlistedHint") }}</p>
            <Button v-if="!readonly" size="sm" icon-class="i-lucide-plus" data-sticker-list @click="emit('list')">{{ text("panel.listIt") }}</Button>
        </template>
        <template v-else-if="readonly">
            <p class="sticker-fields__title">{{ item.label }}</p>
            <p v-if="item.description" class="sticker-fields__muted">{{ item.description }}</p>
        </template>
        <template v-else>
            <Field :label="text('panel.name')" :error="problem && name.draft.value.trim() !== '' && name.error.value !== '' ? name.error.value : ''">
                <Input
                    v-model="name.draft.value"
                    size="sm"
                    :invalid="problem || name.error.value !== ''"
                    data-sticker-name
                    @focus="name.onFocus"
                    @blur="name.onBlur"
                    @keydown.enter.prevent="name.onEnter"
                    @keydown.esc.stop="name.onEscape"
                />
            </Field>
            <Field :label="text('panel.description')">
                <Textarea
                    v-model="description.draft.value"
                    :rows="2"
                    autosize
                    :placeholder="text('panel.placeholder')"
                    :disabled="problem"
                    data-sticker-description
                    @focus="description.onFocus"
                    @blur="description.onBlur"
                    @keydown.esc.stop="description.onEscape"
                />
            </Field>
        </template>

        <div v-if="!unlisted && !problem" class="sticker-fields__syntax">
            <code data-sticker-syntax>{{ syntax }}</code>
            <CopyButton :text="syntax" :label="text('panel.copySyntax')" />
        </div>
        <label v-if="editable || (readonly && !unlisted)" class="sticker-fields__switch">
            <span class="sticker-fields__switch-label">{{ text("panel.common") }}<InfoTip :text="text('group.commonTip')" /></span>
            <Switch :model-value="item.common" size="sm" :disabled="readonly || problem" :aria-label="text('panel.common')" data-sticker-common @update:model-value="toggle" />
        </label>

        <div class="sticker-fields__meta">
            <span>{{ item.file }}</span>
            <span>{{ text("panel.sizeInfo", {width: String(item.width), height: String(item.height), size: sizeLabel(item.bytes)}) }}</span>
        </div>
        <p class="sticker-fields__status" :class="{'is-error': failing}" role="status" data-sticker-status>{{ status }}</p>
        <Button v-if="!readonly" size="sm" variant="ghost" class="sticker-fields__delete" icon-class="i-lucide-trash-2" data-sticker-delete @click="emit('delete')">{{ unlisted ? text("panel.deleteFile") : text("panel.deleteSticker") }}</Button>
    </div>
</template>

<style scoped>
.sticker-fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.sticker-fields__back {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: 2px;
    padding: 0 var(--space-1);
    min-height: var(--control-h-sm);
    font: inherit;
    font-size: var(--text-xs);
    color: var(--text-muted);
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    cursor: pointer;
}

.sticker-fields__back:hover {
    color: var(--text-main);
}

.sticker-slot {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--text-main) 4%, transparent);
}

.sticker-slot > img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
}

.sticker-fields__preview {
    width: 100%;
    height: 144px;
    padding: var(--space-3);
}

.sticker-fields__preview.is-faded > img {
    opacity: 0.5;
}

.sticker-fields__title {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 600;
    text-align: center;
    word-break: break-all;
}

.sticker-fields__muted {
    margin: 0;
    color: var(--text-muted);
    text-align: center;
}

.sticker-fields__syntax {
    display: flex;
    min-height: var(--control-h-sm);
    align-items: center;
    gap: var(--space-2);
}

.sticker-fields__syntax code {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    padding: 3px var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    border-radius: var(--radius-control);
    background: var(--bg-hover);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.sticker-fields__switch {
    display: flex;
    min-height: var(--control-h-sm);
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
}

.sticker-fields__switch-label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
}

.sticker-fields__meta {
    display: flex;
    flex-direction: column;
    font-size: var(--text-xs);
    line-height: 18px;
    color: var(--text-muted);
    word-break: break-all;
}

/* 固定高度：有没有原因都不挪下面的按钮（ui-development-spec 表单校验：不在字段下插字）。 */
.sticker-fields__status {
    min-height: 36px;
    margin: 0;
    font-size: var(--text-xs);
    line-height: 18px;
    color: var(--text-muted);
}

.sticker-fields__status.is-error {
    color: var(--status-danger);
}

.sticker-fields__delete {
    align-self: flex-start;
    margin-left: calc(var(--space-2) * -1);
    color: var(--status-danger);
}
</style>
