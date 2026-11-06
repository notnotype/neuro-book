<script setup lang="ts">
/** 主题编辑器的“图标”分区（同名 .md）：当前明暗下的图标覆盖，每一项把一个 lucide 图标名换成上传的 SVG。 */
import {computed, ref} from "vue";

import {Button, Input} from "@notnotype/nb-ui/components";

import {ICON_NAME} from "../../../shared/themes";
import {useWorkbenchText} from "../../text";
import {userThemeAssetUrl} from "../../themes";
import type {ThemeEditorModel} from "./theme-editor-model";
import type {ThemeTransfer} from "./transfer";
import {useUploadStatus} from "./use-upload-status";

defineOptions({name: "ThemeEditorIcons"});

const props = defineProps<{model: ThemeEditorModel; transfer: ThemeTransfer}>();
const text = useWorkbenchText();
const model = props.model;

const icons = computed(() => Object.entries(model.current.value?.declaration[model.appearance.value].icons ?? {}));
const draft = ref("");
const input = ref<HTMLInputElement | null>(null);
const status = useUploadStatus(model);
/** 输入框里的名字不合规则或为空时的提示（行内，不写声明）。 */
const nameFailure = ref<string | null>(null);
/** 本次要换的图标名：选文件时定下（“添加”取输入框、“更换”取那一行），选完文件仍用它。 */
let pendingName = "";

const trimmed = computed(() => draft.value.trim());
const replacing = computed(() => icons.value.some(([name]) => name === trimmed.value));
/** 输入时就提示不合规则的名字，不等到点“添加”。 */
const nameProblem = computed(() => (trimmed.value === "" || ICON_NAME.test(trimmed.value) ? null : text("themeEditor.icons.nameInvalid")));

const pick = (name: string): void => {
    pendingName = name;
    nameFailure.value = null;
    input.value?.click();
};
const add = (): void => {
    if (status.busy.value) return;
    if (trimmed.value === "") {
        nameFailure.value = text("themeEditor.icons.nameEmpty");
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
    // 目标在发起时定下：主题、明暗、图标名一起冻结；上传期间切了主题、明暗或改了输入框，图标仍落在这一项上，进度与结果也只在那个目标上显示。
    const target = status.current();
    if (target === null) return;
    const name = pendingName;
    status.begin(target);
    try {
        const uploaded = await props.transfer.uploadIcon(file);
        if (!uploaded.ok) {
            status.fail(text("themeEditor.icons.failed", {reason: uploaded.reason}));
            return;
        }
        // 写进声明才算成功：被拒绝或提交失败时原因在编辑器的提示行（`model.rejected`），输入框里的名字留着，不让用户重打。
        if (await model.setIcon(name, uploaded.name, target) && name === trimmed.value) draft.value = "";
    } catch (error) {
        status.fail(text("themeEditor.icons.failed", {reason: error instanceof Error ? error.message : String(error)}));
    } finally {
        status.end();
    }
};

const remove = (name: string): Promise<unknown> => {
    status.clear();
    return model.removeIcon(name);
};
const previewStyle = (asset: string): Record<string, string> => ({"--icon-url": `url("${userThemeAssetUrl(asset) ?? ""}")`});
</script>

<template>
    <div class="theme-editor-icons" data-section="icons">
        <p class="theme-editor-icons__hint">{{ text("themeEditor.icons.hint") }}</p>

        <div class="theme-editor-icons__add" data-icon-add>
            <div class="theme-editor-icons__name">
                <Input v-model="draft" size="sm" :placeholder="text('themeEditor.icons.placeholder')" :aria-label="text('themeEditor.icons.name')" data-icon-name @keydown.enter="add" />
            </div>
            <Button size="sm" :loading="status.shownBusy.value" :disabled="status.busy.value" icon-class="i-lucide-image-plus" data-icon-choose @click="add">{{ replacing ? text("themeEditor.icons.replace") : text("themeEditor.icons.add") }}</Button>
            <Button size="sm" variant="ghost" :disabled="status.busy.value || icons.length === 0" icon-class="i-lucide-copy" data-icons-copy @click="model.copyIconsToOther()">{{ text("themeEditor.icons.copyToOther") }}</Button>
            <input ref="input" type="file" accept=".svg,image/svg+xml" class="theme-editor-icons__file" data-icon-file @change="onFile" />
        </div>
        <p v-if="nameProblem !== null || nameFailure !== null" class="theme-editor-icons__error" role="alert" data-icon-name-problem>{{ nameProblem ?? nameFailure }}</p>
        <p v-if="status.failure.value !== null" class="theme-editor-icons__error" role="alert" data-icon-error>{{ status.failure.value }}</p>

        <p v-if="icons.length === 0" class="theme-editor-icons__empty" data-icons-none>{{ text("themeEditor.icons.none") }}</p>
        <ul v-else class="theme-editor-icons__list" :aria-label="text('themeEditor.icons.list')">
            <li v-for="[name, asset] in icons" :key="name" class="theme-editor-icons__row" :data-icon-row="name">
                <!-- 预览只是名字的装饰画：名字就在旁边，读屏不重复读。 -->
                <span class="theme-editor-icons__preview" :style="previewStyle(asset)" aria-hidden="true" />
                <code class="theme-editor-icons__row-name">{{ name }}</code>
                <Button size="sm" variant="secondary" :disabled="status.busy.value" :aria-label="text('themeEditor.icons.replaceNamed', {name})" @click="pick(name)">{{ text("themeEditor.icons.replace") }}</Button>
                <Button size="sm" variant="ghost" :disabled="status.busy.value" :aria-label="text('themeEditor.icons.removeNamed', {name})" data-icon-remove @click="remove(name)">{{ text("themeEditor.icons.remove") }}</Button>
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

/* 预览用蒙版画（近似工作台里图标的画法），颜色随前景色。 */
.theme-editor-icons__preview {
    flex: none;
    width: 1.5rem;
    height: 1.5rem;
    background-color: currentColor;
    -webkit-mask: var(--icon-url) center / contain no-repeat;
    mask: var(--icon-url) center / contain no-repeat;
}

.theme-editor-icons__row-name {
    flex: 0 1 240px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: var(--text-sm);
}
</style>
