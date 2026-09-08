<script setup lang="ts">
import {colord} from "colord";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import {DialogWindow} from "@notnotype/nb-ui/components";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import ThemeAdvancedVarsSection from "nbook/app/components/novel-ide/settings/theme/ThemeAdvancedVarsSection.vue";
import ThemeCorePaletteSection from "nbook/app/components/novel-ide/settings/theme/ThemeCorePaletteSection.vue";
import ThemePreviewCard from "nbook/app/components/novel-ide/settings/theme/ThemePreviewCard.vue";
import {useThemeManager} from "nbook/app/composables/useThemeManager";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {applyThemeVars} from "nbook/app/utils/theme/apply-theme";
import {resolveTheme} from "nbook/app/utils/theme/resolve-theme";
import {regenerateDerivedVars, resolveDraftThemeVars, themeVarsToCustomVars} from "nbook/app/utils/theme/theme-editor";
import {IDE_THEME_HOST_CLASS, type ThemeVars} from "nbook/app/utils/theme/theme-tokens";
import {themeVarNames, type CustomThemeDto, type ThemeAppearance, type ThemeVarName} from "nbook/shared/theme/theme-vars";

type ThemeEditorMode = "create" | "edit" | "copy";
type ThemeEditorTab = "core" | "advanced" | "preview";

const props = defineProps<{
    modelValue: boolean;
    mode: ThemeEditorMode;
    initialTheme: CustomThemeDto | null;
    existingThemes: CustomThemeDto[];
}>();

const emit = defineEmits<{
    (event: "update:modelValue", value: boolean): void;
    (event: "saved", theme: CustomThemeDto): void;
}>();

const {t} = useI18n();
const novelIdeStore = useNovelIdeStore();
const themeManager = useThemeManager();
const draftTheme = ref<CustomThemeDto>(createEmptyTheme());
const invalidKeys = ref<ThemeVarName[]>([]);
const localError = ref("");
const saving = ref(false);
const activeTab = ref<ThemeEditorTab>("core");

const appearanceOptions = computed<SelectOption[]>(() => [
    {value: "light", label: t("settings.themeEditor.light")},
    {value: "dark", label: t("settings.themeEditor.dark")},
]);
const editorTabs = computed<Array<{value: ThemeEditorTab; label: string}>>(() => [
    {value: "core", label: t("settings.themeEditor.tabCore")},
    {value: "advanced", label: t("settings.themeEditor.tabAdvanced")},
    {value: "preview", label: t("settings.themeEditor.tabPreview")},
]);
const dialogTitle = computed(() => {
    if (props.mode === "edit") {
        return t("settings.themeEditor.titleEdit");
    }
    if (props.mode === "copy") {
        return t("settings.themeEditor.titleCopy");
    }
    return t("settings.themeEditor.titleCreate");
});
const previewVars = computed<ThemeVars>(() => resolveDraftThemeVars(draftTheme.value));
const pickerTheme = computed(() => draftTheme.value.appearance === "dark" ? "black" as const : "white" as const);

/**
 * 创建空白 draft，主要用于组件未打开时的类型占位。
 */
function createEmptyTheme(): CustomThemeDto {
    return {
        id: "custom-theme",
        name: "",
        appearance: "light",
        vars: {},
    };
}

/**
 * 把传入主题补齐为编辑器可直接修改的 36 个具体颜色值。
 */
function normalizeEditableTheme(theme: CustomThemeDto): CustomThemeDto {
    return {
        id: theme.id,
        name: theme.name,
        appearance: theme.appearance,
        vars: themeVarsToCustomVars(resolveDraftThemeVars(theme)),
    };
}

/**
 * 找到当前 IDE 主题宿主节点。
 */
function findThemeHost(): HTMLElement | null {
    if (!import.meta.client || !globalThis.document) {
        return null;
    }
    return document.querySelector<HTMLElement>(`.${IDE_THEME_HOST_CLASS}`);
}

/**
 * 把预览变量应用到当前 IDE 宿主。
 */
function applyPreview(vars: ThemeVars): void {
    const host = findThemeHost();
    if (!host) {
        return;
    }
    applyThemeVars(host, vars);
}

/**
 * 取消或关闭编辑器时恢复当前已保存主题。
 */
function restoreActiveTheme(): void {
    const host = findThemeHost();
    if (!host) {
        return;
    }
    const vars = novelIdeStore.themeVarsSnapshot
        ?? resolveTheme(novelIdeStore.activeThemeId, novelIdeStore.customThemes).vars;
    applyThemeVars(host, vars);
}

/**
 * 打开窗口时重置本地 draft。
 */
function resetDraft(): void {
    activeTab.value = "core";
    if (!props.initialTheme) {
        draftTheme.value = createEmptyTheme();
        return;
    }
    draftTheme.value = normalizeEditableTheme(props.initialTheme);
    invalidKeys.value = [];
    localError.value = "";
    void nextTick(() => applyPreview(previewVars.value));
}

/**
 * 切换标签页。draft 里只存合法颜色，切页会重挂字段，顺手清掉残留的非法标记。
 */
function setActiveTab(tab: ThemeEditorTab): void {
    activeTab.value = tab;
    invalidKeys.value = [];
}

/**
 * 更新主题名称。
 */
function updateName(value: string): void {
    draftTheme.value = {
        ...draftTheme.value,
        name: value,
    };
    localError.value = "";
}

/**
 * 更新 appearance，并按当前核心色重新派生高级变量。
 */
function updateAppearance(value: string): void {
    if (value !== "light" && value !== "dark") {
        return;
    }
    const appearance = value as ThemeAppearance;
    draftTheme.value = {
        ...draftTheme.value,
        appearance,
        vars: regenerateDerivedVars(draftTheme.value.vars, appearance),
    };
}

/**
 * 更新 draft 变量表。
 */
function updateVars(vars: CustomThemeDto["vars"]): void {
    draftTheme.value = {
        ...draftTheme.value,
        vars,
    };
    localError.value = "";
}

/**
 * 记录颜色字段的本地合法性。
 */
function updateColorValidity(key: ThemeVarName, valid: boolean): void {
    invalidKeys.value = valid
        ? invalidKeys.value.filter((item) => item !== key)
        : [...new Set([...invalidKeys.value, key])];
}

/**
 * 手动按核心色重新生成派生变量。
 */
function regenerateVars(): void {
    draftTheme.value = {
        ...draftTheme.value,
        vars: regenerateDerivedVars(draftTheme.value.vars, draftTheme.value.appearance),
    };
}

/**
 * 校验当前 draft 是否可以保存。
 */
function validateDraft(): string | null {
    const name = draftTheme.value.name.trim();
    if (!name) {
        return t("settings.themeEditor.errorNameRequired");
    }
    if (invalidKeys.value.length > 0) {
        return t("settings.themeEditor.errorInvalidColors");
    }
    for (const key of themeVarNames) {
        const value = draftTheme.value.vars[key];
        if (!value || !colord(value).isValid()) {
            return t("settings.themeEditor.errorMissingColor", {variable: `--${key}`});
        }
    }
    return null;
}

/**
 * 保存自定义主题并关闭窗口。
 */
async function saveDraft(): Promise<void> {
    const error = validateDraft();
    if (error) {
        localError.value = error;
        return;
    }

    saving.value = true;
    const nextTheme: CustomThemeDto = {
        id: draftTheme.value.id,
        name: draftTheme.value.name.trim(),
        appearance: draftTheme.value.appearance,
        vars: {...draftTheme.value.vars},
    };
    const nextThemes = [
        ...props.existingThemes.filter((theme) => theme.id !== nextTheme.id),
        nextTheme,
    ];
    const saved = await themeManager.saveThemeConfig(nextTheme.id, nextThemes);
    saving.value = false;
    if (!saved) {
        return;
    }
    emit("saved", nextTheme);
    emit("update:modelValue", false);
}

/**
 * 放弃编辑并恢复当前主题。
 */
function cancelEditing(): void {
    restoreActiveTheme();
    emit("update:modelValue", false);
}

watch(() => props.modelValue, (open) => {
    if (open) {
        resetDraft();
    } else {
        restoreActiveTheme();
    }
}, {immediate: true});

watch(() => props.initialTheme, () => {
    if (props.modelValue) {
        resetDraft();
    }
});

watch(previewVars, (vars) => {
    if (props.modelValue) {
        applyPreview(vars);
    }
});
</script>

<template>
    <!-- 主题编辑器浮动窗口：无遮罩，可拖动，整个 IDE 即实时预览 -->
    <DialogWindow
        :model-value="modelValue"
        :title="dialogTitle"
        :width="560"
        height="min(760px, calc(100vh - 88px))"
        teleport-target=".novel-ide-theme"
        :busy="saving"
        body-class="flex min-h-0 flex-1 flex-col overflow-hidden"
        @request-close="cancelEditing"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <!-- 名称与外观 -->
        <div class="shrink-0 border-b border-[var(--border-color)] px-4 pb-3 pt-3">
            <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
                <label class="block">
                    <span class="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.themeEditor.name") }}</span>
                    <input class="h-9 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" :value="draftTheme.name" :placeholder="t('settings.themeEditor.namePlaceholder')" :disabled="saving" @input="updateName(($event.target as HTMLInputElement).value)">
                </label>
                <label class="block">
                    <span class="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.themeEditor.appearance") }}</span>
                    <FormSelect :model-value="draftTheme.appearance" :options="appearanceOptions" :disabled="saving" @update:model-value="updateAppearance" />
                </label>
            </div>

            <div class="mt-2.5 flex items-center justify-between gap-3">
                <p class="min-w-0 flex-1 truncate text-[11px] text-[var(--text-muted)]" :title="t('settings.themeEditor.regenerateHint')">{{ t("settings.themeEditor.floatHint") }}</p>
                <button type="button" class="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-xs font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50" :title="t('settings.themeEditor.regenerateHint')" :disabled="saving" @click="regenerateVars">
                    <span class="i-lucide-wand-sparkles h-3.5 w-3.5"></span>
                    <span>{{ t("settings.themeEditor.regenerate") }}</span>
                </button>
            </div>

            <p v-if="localError" class="mt-2.5 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-xs text-[var(--status-danger)]">{{ localError }}</p>
        </div>

        <!-- Tab 栏 -->
        <div class="flex shrink-0 items-center gap-1 border-b border-[var(--border-color)] px-4">
            <button v-for="tab in editorTabs" :key="tab.value" type="button" class="-mb-px border-b-2 px-2.5 py-2 text-xs font-medium transition-colors" :class="activeTab === tab.value ? 'border-[var(--accent-main)] text-[var(--accent-text)]' : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-main)]'" @click="setActiveTab(tab.value)">
                {{ tab.label }}
            </button>
        </div>

        <!-- Tab 内容 -->
        <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <ThemeCorePaletteSection v-if="activeTab === 'core'" :model-value="draftTheme.vars" :appearance="draftTheme.appearance" :picker-theme="pickerTheme" :disabled="saving" @update:model-value="updateVars" @valid-change="updateColorValidity" />
            <ThemeAdvancedVarsSection v-else-if="activeTab === 'advanced'" :model-value="draftTheme.vars" :picker-theme="pickerTheme" :disabled="saving" @update:model-value="updateVars" @valid-change="updateColorValidity" />
            <ThemePreviewCard v-else :name="draftTheme.name" :appearance="draftTheme.appearance" :vars="previewVars" />
        </div>

        <template #footer>
            <button type="button" class="inline-flex h-8 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-4 text-[13px] font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="saving" @click="cancelEditing">{{ t("common.cancel") }}</button>
            <button type="button" class="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-transparent bg-[var(--accent-main)] px-4 text-[13px] font-medium text-[var(--text-inverse)] transition-opacity hover:opacity-90 disabled:opacity-50" :disabled="saving" @click="void saveDraft()">
                <span v-if="saving" class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin"></span>
                <span v-else class="i-lucide-save h-3.5 w-3.5"></span>
                <span>{{ saving ? t("common.saving") : t("common.save") }}</span>
            </button>
        </template>
    </DialogWindow>
</template>
