<script setup lang="ts">
import type {SnapshotProvider} from "@notnotype/nb-models/contract";
import {Button, IconButton, Input, Popover, SegmentedControl, Tooltip} from "@notnotype/nb-ui/components";
import {computed, nextTick, ref, watch} from "vue";

import {IconScaleError, scaleIcon} from "../icon-scale";
import type {IconCodec} from "../icon-scale";
import {useModelsText} from "../text";
import ProviderIcon from "./ProviderIcon.vue";

/**
 * 服务商详情的标题区（docs/specs/models/settings-pages.md 输出 4）：图标（点开换图标）、名称（就地改）、“复制一份”。删除仍在左栏
 * 条目上（决定 19）。受控：改了什么就发对应的事件，写入由页面做。
 */
type IconChoice = {kind: "upload"; png: string} | {kind: "builtin"; key: string} | {kind: "initial"} | null;

const props = withDefaults(defineProps<{
    provider: SnapshotProvider;
    /** 别家的名称（小写）：改名重名时行内写原因，不发事件。 */
    takenNames?: ReadonlySet<string>;
    /** 内置图标可选的键（模板用到的、图标表里有的）。 */
    builtinKeys?: readonly string[];
    disabled?: boolean;
    /** 换图标写入中：面板里的控件停用。 */
    iconBusy?: boolean;
    /** 换图标失败的原因（面板内一行）。 */
    iconError?: string;
    /** 复制写入中。 */
    duplicating?: boolean;
    /** 缩图用的解码与编码；缺省是浏览器的画布（dom 测试给假的）。 */
    codec?: IconCodec;
}>(), {takenNames: () => new Set(), builtinKeys: () => [], disabled: false, iconBusy: false, iconError: "", duplicating: false, codec: undefined});

const emit = defineEmits<{
    (e: "rename", name: string): void;
    (e: "set-icon", icon: IconChoice): void;
    (e: "duplicate"): void;
}>();

const text = useModelsText();

// ---- 名称 ----
const editing = ref(false);
const draft = ref(props.provider.name);
const nameProblem = ref("");
const nameInput = ref<{$el?: HTMLElement} | HTMLElement | null>(null);
const editButton = ref<HTMLElement | null>(null);

async function startEditing(): Promise<void> {
    if (props.disabled) return;
    draft.value = props.provider.name;
    nameProblem.value = "";
    editing.value = true;
    await nextTick();
    const element = nameInput.value instanceof HTMLElement ? nameInput.value : nameInput.value?.$el;
    (element instanceof HTMLInputElement ? element : element?.querySelector("input"))?.focus();
}

function commit(): void {
    if (!editing.value) return;
    const value = draft.value.trim();
    // 空名回退，不报错；重名行内写原因、停在编辑状态。
    if (value === "" || value === props.provider.name) {
        editing.value = false;
        return;
    }
    if (props.takenNames.has(value.toLowerCase())) {
        nameProblem.value = text("header.nameTaken");
        return;
    }
    editing.value = false;
    emit("rename", value);
}

async function cancel(): Promise<void> {
    editing.value = false;
    nameProblem.value = "";
    await nextTick();
    editButton.value?.focus();
}
watch(() => props.provider.name, (name) => {
    if (!editing.value) draft.value = name;
});

// ---- 图标 ----
const iconOpen = ref(false);
type Tab = "builtin" | "upload" | "initial";
const tab = ref<Tab>("builtin");
const search = ref("");
const uploadError = ref("");
const uploading = ref(false);
const tabs = computed(() => [
    {value: "builtin", label: text("header.icon.tabBuiltin")},
    {value: "upload", label: text("header.icon.tabUpload")},
    {value: "initial", label: text("header.icon.tabInitial")},
]);
const keys = computed(() => {
    const needle = search.value.trim().toLowerCase();
    return props.builtinKeys.filter((key) => needle === "" || key.toLowerCase().includes(needle));
});
const customIcon = computed(() => props.provider.icon !== null);

watch(iconOpen, (open) => {
    if (open) {
        search.value = "";
        uploadError.value = "";
        tab.value = "builtin";
    }
});

function choose(icon: IconChoice): void {
    uploadError.value = "";
    emit("set-icon", icon);
}

async function onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file === undefined) return;
    uploadError.value = "";
    uploading.value = true;
    try {
        choose({kind: "upload", png: await scaleIcon(file, props.codec)});
    } catch (error) {
        const reason = error instanceof IconScaleError ? error.reason : "read-failed";
        uploadError.value = reason === "svg" ? text("header.icon.errors.svg") : reason === "not-image" ? text("header.icon.errors.notImage") : reason === "too-large" ? text("header.icon.errors.tooLarge") : text("header.icon.errors.readFailed");
    } finally {
        uploading.value = false;
    }
}
const shownError = computed(() => (uploadError.value !== "" ? uploadError.value : props.iconError));
</script>

<template>
    <div class="provider-header" data-provider-header>
        <Popover v-model:open="iconOpen" side="bottom" align="start" content-class="provider-header__panel">
            <template #trigger>
                <button type="button" class="provider-header__icon nb-ui-focus-ring" :aria-label="text('header.icon.button', {name: provider.name})" :disabled="disabled" data-provider-icon-button>
                    <ProviderIcon :icon="provider.icon" :template="provider.template" :name="provider.name" :size="28" />
                </button>
            </template>
            <div class="provider-header__popover" data-provider-icon-panel>
                <SegmentedControl v-model="tab" :options="tabs" :aria-label="text('header.icon.title')" size="sm" />
                <template v-if="tab === 'builtin'">
                    <Input v-model="search" size="sm" icon-class="i-lucide-search" :placeholder="text('header.icon.search')" :aria-label="text('header.icon.search')" :disabled="iconBusy" data-icon-search />
                    <ul v-if="keys.length > 0" class="provider-header__grid">
                        <li v-for="key in keys" :key="key">
                            <button type="button" class="provider-header__choice nb-ui-focus-ring" :title="key" :aria-label="key" :disabled="iconBusy" :data-icon-choice="key" @click="choose({kind: 'builtin', key})">
                                <ProviderIcon :icon="null" :template="key" :name="key" :size="22" />
                            </button>
                        </li>
                    </ul>
                    <p v-else class="provider-header__muted">{{ text("header.icon.none") }}</p>
                </template>
                <template v-else-if="tab === 'upload'">
                    <label class="provider-header__upload">
                        <Button size="sm" variant="secondary" icon-class="i-lucide-upload" :disabled="iconBusy || uploading">{{ uploading || iconBusy ? text("header.icon.uploading") : text("header.icon.chooseFile") }}</Button>
                        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="provider-header__file" :disabled="iconBusy || uploading" data-icon-file @change="onFile">
                    </label>
                    <p class="provider-header__muted">{{ text("header.icon.uploadHint") }}</p>
                </template>
                <template v-else>
                    <Button size="sm" variant="secondary" :disabled="iconBusy" data-icon-initial @click="choose({kind: 'initial'})">
                        <ProviderIcon :icon="{kind: 'initial'}" :template="provider.template" :name="provider.name" :size="18" /> {{ provider.name }}
                    </Button>
                </template>
                <p v-if="shownError !== ''" class="provider-header__error" role="alert" data-icon-error>{{ shownError }}</p>
                <Button v-if="customIcon" size="sm" variant="ghost" icon-class="i-lucide-rotate-ccw" :disabled="iconBusy" data-icon-restore @click="choose(null)">{{ text("header.icon.restore") }}</Button>
            </div>
        </Popover>
        <div class="provider-header__name">
            <template v-if="!editing">
                <h3 class="provider-header__title" tabindex="-1" data-provider-name>{{ provider.name }}</h3>
                <Tooltip :text="text('header.rename')">
                    <IconButton ref="editButton" size="sm" icon-class="i-lucide-pencil" :aria-label="text('header.rename')" :disabled="disabled" data-provider-rename @click="startEditing" />
                </Tooltip>
            </template>
            <div v-else class="provider-header__edit">
                <Input ref="nameInput" v-model="draft" size="sm" :aria-label="text('header.nameLabel')" :invalid="nameProblem !== ''" data-provider-name-input @keydown.enter.prevent="commit" @keydown.esc.prevent.stop="cancel" @blur="commit" />
                <p v-if="nameProblem !== ''" class="provider-header__error" role="alert" data-name-problem>{{ nameProblem }}</p>
            </div>
        </div>
        <Tooltip :text="text('header.duplicateTip')">
            <Button size="sm" variant="ghost" icon-class="i-lucide-copy" :disabled="disabled || duplicating" data-provider-duplicate @click="emit('duplicate')">{{ text("header.duplicate") }}</Button>
        </Tooltip>
    </div>
</template>

<style scoped>
.provider-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    margin: 0 0 var(--space-5);
}

.provider-header__icon {
    display: inline-flex;
    padding: var(--space-2);
    border: var(--border-w) solid var(--divider);
    border-radius: var(--radius-control);
    background: none;
    color: inherit;
    cursor: pointer;
}

.provider-header__icon:hover:not(:disabled) {
    background: color-mix(in srgb, var(--text-main) 6%, transparent);
}

.provider-header__name {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    gap: var(--space-2);
}

.provider-header__title {
    margin: 0;
    overflow: hidden;
    font-size: var(--text-lg);
    font-weight: var(--weight-strong);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.provider-header__edit {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: var(--space-1);
}

.provider-header__popover {
    display: flex;
    width: 280px;
    max-width: 100%;
    flex-direction: column;
    gap: var(--space-3);
}

.provider-header__grid {
    display: grid;
    max-height: 200px;
    grid-template-columns: repeat(auto-fill, minmax(36px, 1fr));
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
}

.provider-header__choice {
    display: inline-flex;
    width: 100%;
    justify-content: center;
    padding: var(--space-2);
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: inherit;
    cursor: pointer;
}

.provider-header__choice:hover:not(:disabled) {
    background: color-mix(in srgb, var(--text-main) 8%, transparent);
}

.provider-header__upload {
    display: inline-flex;
    position: relative;
    align-self: flex-start;
}

.provider-header__file {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
}

.provider-header__muted {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.provider-header__error {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--status-danger);
}
</style>
