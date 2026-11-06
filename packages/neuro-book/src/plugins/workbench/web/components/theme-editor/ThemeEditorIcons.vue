<script setup lang="ts">
/** 主题编辑器的“图标”分区（同名 .md）：当前明暗下的图标覆盖，每一项把一个 lucide 图标名换成上传的 SVG。 */
import {computed, ref} from "vue";

import {Button, Input} from "@notnotype/nb-ui/components";

import {useWorkbenchText} from "../../text";
import {userThemeAssetUrl} from "../../themes";
import type {ThemeEditorModel} from "./theme-editor-model";
import type {ThemeTransfer} from "./transfer";

defineOptions({name: "ThemeEditorIcons"});

const props = defineProps<{model: ThemeEditorModel; transfer: ThemeTransfer}>();
const text = useWorkbenchText();
const model = props.model;

/** lucide 的写法：小写字母、数字与连字符（与声明校验同一条规则）。 */
const ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const icons = computed(() => Object.entries(model.current.value?.declaration[model.appearance.value].icons ?? {}));
const draft = ref("");
const input = ref<HTMLInputElement | null>(null);
const busy = ref(false);
const failure = ref<string | null>(null);
/** 本次要换的图标名：选文件时定下（“添加”取输入框、“更换”取那一行），选完文件仍用它。 */
let pendingName = "";

const trimmed = computed(() => draft.value.trim());
const replacing = computed(() => icons.value.some(([name]) => name === trimmed.value));
const nameProblem = computed(() => (trimmed.value === "" || ICON_NAME.test(trimmed.value) ? null : text("themeEditor.icons.nameInvalid")));

const pick = (name: string): void => {
    pendingName = name;
    failure.value = null;
    input.value?.click();
};
const add = (): void => {
    if (trimmed.value === "") {
        failure.value = text("themeEditor.icons.nameEmpty");
        return;
    }
    if (nameProblem.value !== null) return;
    pick(trimmed.value);
};

const onFile = async (event: Event): Promise<void> => {
    const element = event.target as HTMLInputElement;
    const file = element.files?.[0];
    element.value = "";
    if (file === undefined) return;
    // 目标在发起时定下：主题、明暗、图标名一起冻结；上传期间切了主题、明暗或改了输入框，图标仍落在这一项上。
    const current = model.current.value;
    if (current === null) return;
    const target = {id: current.id, appearance: model.appearance.value};
    const name = pendingName;
    busy.value = true;
    failure.value = null;
    try {
        const uploaded = await props.transfer.uploadIcon(file);
        if (!uploaded.ok) {
            failure.value = text("themeEditor.icons.failed", {reason: uploaded.reason});
            return;
        }
        await model.setIcon(name, uploaded.name, target);
        if (name === trimmed.value) draft.value = "";
    } catch (error) {
        failure.value = text("themeEditor.icons.failed", {reason: error instanceof Error ? error.message : String(error)});
    } finally {
        busy.value = false;
    }
};

const remove = (name: string): Promise<unknown> => model.removeIcon(name);
const previewStyle = (asset: string): Record<string, string> => ({"--icon-url": `url("${userThemeAssetUrl(asset) ?? ""}")`});
</script>

<template>
    <div class="theme-editor-icons" data-section="icons">
        <p class="theme-editor-icons__hint">{{ text("themeEditor.icons.hint") }}</p>

        <div class="theme-editor-icons__add" data-icon-add>
            <div class="theme-editor-icons__name">
                <Input v-model="draft" size="sm" :placeholder="text('themeEditor.icons.placeholder')" :aria-label="text('themeEditor.icons.name')" data-icon-name @keydown.enter="add" />
            </div>
            <Button size="sm" :loading="busy" icon-class="i-lucide-image-plus" data-icon-choose @click="add">{{ replacing ? text("themeEditor.icons.replace") : text("themeEditor.icons.add") }}</Button>
            <Button size="sm" variant="ghost" :disabled="busy || icons.length === 0" icon-class="i-lucide-copy" data-icons-copy @click="model.copyIconsToOther()">{{ text("themeEditor.icons.copyToOther") }}</Button>
            <input ref="input" type="file" accept=".svg,image/svg+xml" class="theme-editor-icons__file" data-icon-file @change="onFile" />
        </div>
        <p v-if="nameProblem !== null" class="theme-editor-icons__error" role="alert" data-icon-name-problem>{{ nameProblem }}</p>
        <p v-if="failure !== null" class="theme-editor-icons__error" role="alert" data-icon-error>{{ failure }}</p>

        <p v-if="icons.length === 0" class="theme-editor-icons__empty" data-icons-none>{{ text("themeEditor.icons.none") }}</p>
        <ul v-else class="theme-editor-icons__list" :aria-label="text('themeEditor.icons.list')">
            <li v-for="[name, asset] in icons" :key="name" class="theme-editor-icons__row" :data-icon-row="name">
                <span class="theme-editor-icons__preview" :style="previewStyle(asset)" role="img" :aria-label="text('themeEditor.icons.preview', {name})" />
                <code class="theme-editor-icons__row-name">{{ name }}</code>
                <Button size="sm" variant="secondary" :disabled="busy" @click="pick(name)">{{ text("themeEditor.icons.replace") }}</Button>
                <Button size="sm" variant="ghost" :disabled="busy" data-icon-remove @click="remove(name)">{{ text("themeEditor.icons.remove") }}</Button>
            </li>
        </ul>
    </div>
</template>

<style scoped>
.theme-editor-icons {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.theme-editor-icons__hint {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.theme-editor-icons__add {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
}

.theme-editor-icons__name {
    flex: 1 1 160px;
    min-width: 0;
    max-width: 280px;
}

.theme-editor-icons__file {
    display: none;
}

.theme-editor-icons__error {
    margin: 0;
    color: var(--status-danger);
    font-size: var(--text-xs);
}

.theme-editor-icons__empty {
    margin: 0;
    padding: var(--space-8);
    border: var(--border-w) dashed var(--border-color);
    border-radius: var(--radius-control);
    color: var(--text-muted);
    font-size: var(--text-sm);
    text-align: center;
}

.theme-editor-icons__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.theme-editor-icons__row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
}

/* 预览用蒙版画：和工作台里的图标同一种画法，颜色随前景色。 */
.theme-editor-icons__preview {
    flex: none;
    width: 1.5rem;
    height: 1.5rem;
    background-color: currentColor;
    -webkit-mask: var(--icon-url) center / contain no-repeat;
    mask: var(--icon-url) center / contain no-repeat;
}

.theme-editor-icons__row-name {
    flex: 1 1 120px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: var(--text-sm);
}
</style>
