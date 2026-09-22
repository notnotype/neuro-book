<script setup lang="ts">
import {computed, ref} from "vue";
import type {NbColorwayVars} from "@notnotype/nb-ui/colorway";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import {parseColorwayFileJson} from "nbook/app/utils/theme/colorway-io";
import {productAppearances, type ProductAppearance} from "nbook/shared/theme/theme-axes";
import ColorwayEditorDialog from "./ColorwayEditorDialog.vue";
import {
    buildLocaleOptions,
    buildViewModeOptions,
    type ColorwayDraft,
    type FrontendSettingsViewEmits,
    type FrontendSettingsViewProps,
} from "./FrontendSettingsView.types";

const props = withDefaults(defineProps<FrontendSettingsViewProps>(), {
    disabled: false,
});

const emit = defineEmits<FrontendSettingsViewEmits>();

const {t} = useI18n();

const localeOptions = computed(() => buildLocaleOptions(t));
const viewModeOptions = computed(() => props.viewMode === "custom"
    ? [...buildViewModeOptions(t), {value: "custom", label: t("settings.frontend.viewModeCustom"), disabled: true}]
    : buildViewModeOptions(t));
const reasoningSelectOptions = computed(() => props.reasoningOptions.map((item) => ({value: item, label: item})));

/** 两档配色的展示：文案走 i18n，图标只是明暗提示；顺序取 `productAppearances`（亮在前）。 */
const appearanceDisplay: Record<ProductAppearance, {labelKey: string; iconClass: string}> = {
    light: {labelKey: "settings.frontend.appearanceLight", iconClass: "i-lucide-sun"},
    dark: {labelKey: "settings.frontend.appearanceDark", iconClass: "i-lucide-moon"},
};
const appearanceOptions = computed(() => productAppearances.map((value) => ({
    value,
    label: t(appearanceDisplay[value].labelKey),
    iconClass: appearanceDisplay[value].iconClass,
})));

/* ── 自定义配色 ────────────────────────────────────────────────
 * 草稿与对话窗状态留在视图里（宿主持有数据、视图持有交互），提交时把完整的一份配色交给宿主。
 * 导入的解析**在视图里**做：文件是用户刚从自己机器上选的东西，坏在哪要当场说清；
 * 而写配置失败的回滚与提示仍归宿主（`useThemeSettings`）。
 */
const editorOpen = ref(false);
const editorDraft = ref<ColorwayDraft | null>(null);
const importInputRef = ref<HTMLInputElement | null>(null);
const importError = ref<{messageKey: string; variableName?: string} | null>(null);

/** 当前生效配色若是自己存的，就有「编辑 / 删除」；主题自带配色只能「另存为」。 */
const activeUserColorway = computed(() => props.userColorways.find((colorway) => colorway.id === props.colorwayId) ?? null);

/** 打开编辑器。`"copy"` = 另存为一份新的（主题自带配色只能走这条），
 * `"primary"` = 在当前配色上继续（用户配色就是改它，主题自带配色则等于另存为）。
 */
function openColorwayEditor(mode: "primary" | "copy"): void {
    importError.value = null;
    const active = activeUserColorway.value;
    const asCopy = mode === "copy" || active === null;
    editorDraft.value = {
        id: asCopy ? undefined : active?.id,
        label: asCopy ? "" : (active?.label ?? ""),
        appearance: props.appearance,
        // 改自己的配色时从**存下来的取值**起步，另存为则从当前生效的全量取值起步
        vars: editableVars(asCopy ? props.colorwayVars : active.vars),
    };
    editorOpen.value = true;
}

/** 配色取值表里只有字符串是取值，其余（缺键）丢掉——草稿是一张「用户改过的键」的表。 */
function editableVars(source: NbColorwayVars): Record<string, string> {
    const editable: Record<string, string> = {};
    for (const [name, value] of Object.entries(source)) {
        if (typeof value === "string") {
            editable[name] = value;
        }
    }
    return editable;
}

/** 只有「改一套已经存在的配色」才给删除入口：另存为的草稿还没有 id。 */
const editorDeletable = computed(() => editorDraft.value?.id !== undefined);

function submitColorwayDraft(draft: ColorwayDraft): void {
    emit("save-colorway", draft);
    editorOpen.value = false;
}

function deleteActiveColorway(): void {
    const current = activeUserColorway.value;
    if (current === null) {
        return;
    }
    emit("delete-colorway", current.id);
    editorOpen.value = false;
}

async function importColorwayFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // 清空选择：同一个文件再选一次也必须触发 change，否则第二次导入像没反应
    input.value = "";
    if (file === undefined) {
        return;
    }
    const parsed = parseColorwayFileJson(await file.text());
    if (!parsed.ok) {
        importError.value = {messageKey: parsed.messageKey, variableName: parsed.variableName};
        return;
    }
    importError.value = null;
    emit("save-colorway", {...parsed.payload});
}

const importErrorText = computed(() => importError.value === null
    ? ""
    : t(importError.value.messageKey, {name: importError.value.variableName ?? ""}));
</script>

<template>
    <div class="flex min-w-0 flex-col" data-lab-subject>
        <div class="grid gap-3">
            <section class="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
                <div class="min-w-0">
                    <h3 class="flex items-center gap-[var(--space-2)] text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">
                        <span class="i-lucide-languages h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                        {{ t("settings.frontend.languageTitle") }}
                    </h3>
                    <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.frontend.languageDescription") }}</p>
                </div>
                <div class="w-48 shrink-0">
                    <FormSelect :model-value="props.locale" :options="localeOptions" :disabled="props.disabled" @update:model-value="emit('update:locale', $event)" />
                </div>
            </section>

            <section class="mt-[var(--space-4)] border-t border-[var(--divider)] pt-[var(--space-4)]">
                <!-- 主题两轴：主题包定材质、排版与控件密度，配色定明暗；两轴各自独立生效 -->
                <div class="min-w-0">
                    <h3 class="flex items-center gap-[var(--space-2)] text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">
                        <span class="i-lucide-palette h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                        {{ t("settings.frontend.themeTitle") }}
                    </h3>
                    <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.frontend.themeDescription") }}</p>
                </div>

                <!-- 主题包 -->
                <div class="mt-[var(--space-3)]">
                    <div class="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{{ t("settings.frontend.themePackLabel") }}</div>
                    <div class="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
                        <button
                            v-for="option in props.themeOptions"
                            :key="option.id"
                            type="button"
                            class="flex min-w-0 flex-col items-start gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:pointer-events-none disabled:opacity-50"
                            :class="props.themeId === option.id
                                ? 'border-[var(--accent-main)] bg-[var(--bg-hover)]'
                                : 'border-[var(--border-color)] bg-[var(--bg-input)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'"
                            :disabled="props.disabled"
                            :aria-pressed="props.themeId === option.id"
                            @click="emit('select-theme', option.id)"
                        >
                            <span class="flex w-full min-w-0 items-center gap-1.5">
                                <span class="min-w-0 flex-1 truncate text-xs text-[var(--text-main)]">{{ option.name }}</span>
                                <span v-if="props.themeId === option.id" class="i-lucide-check h-3.5 w-3.5 shrink-0 text-[var(--accent-main)]" aria-hidden="true"></span>
                            </span>
                            <span class="min-w-0 truncate text-[11px] leading-[var(--leading-ui)] text-[var(--text-muted)]">{{ option.tagline }}</span>
                        </button>
                    </div>
                </div>

                <!-- 配色明暗 -->
                <div class="mt-[var(--space-3)]">
                    <div class="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{{ t("settings.frontend.appearanceLabel") }}</div>
                    <div class="flex flex-wrap gap-2.5">
                        <button
                            v-for="option in appearanceOptions"
                            :key="option.value"
                            type="button"
                            class="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs text-[var(--text-main)] transition-colors disabled:pointer-events-none disabled:opacity-50"
                            :class="props.appearance === option.value && !props.colorwayIsUser
                                ? 'border-[var(--accent-main)] bg-[var(--bg-hover)]'
                                : 'border-[var(--border-color)] bg-[var(--bg-input)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'"
                            :disabled="props.disabled"
                            :aria-pressed="props.appearance === option.value && !props.colorwayIsUser"
                            @click="emit('select-appearance', option.value)"
                        >
                            <span class="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" :class="option.iconClass" aria-hidden="true"></span>
                            <span>{{ option.label }}</span>
                            <span v-if="props.appearance === option.value && !props.colorwayIsUser" class="i-lucide-check h-3.5 w-3.5 shrink-0 text-[var(--accent-main)]" aria-hidden="true"></span>
                        </button>
                    </div>
                </div>

                <!-- 自定义配色：与主题自带配色走同一条应用路径（变量 + data-nb-appearance + colorScheme） -->
                <div class="mt-[var(--space-3)]">
                    <div class="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{{ t("settings.frontend.customColorwayLabel") }}</div>
                    <div class="flex flex-wrap items-center gap-2.5">
                        <p v-if="props.userColorways.length === 0" class="text-[11px] leading-[var(--leading-ui)] text-[var(--text-muted)]" data-testid="colorway-empty">
                            {{ t("settings.frontend.customColorwayEmpty") }}
                        </p>
                        <button
                            v-for="colorway in props.userColorways"
                            :key="colorway.id"
                            type="button"
                            class="inline-flex h-8 max-w-56 items-center gap-1.5 rounded-md border px-3 text-xs text-[var(--text-main)] transition-colors disabled:pointer-events-none disabled:opacity-50"
                            :class="props.colorwayId === colorway.id
                                ? 'border-[var(--accent-main)] bg-[var(--bg-hover)]'
                                : 'border-[var(--border-color)] bg-[var(--bg-input)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'"
                            :disabled="props.disabled"
                            :aria-pressed="props.colorwayId === colorway.id"
                            :data-colorway-option="colorway.id"
                            @click="emit('select-colorway', colorway.id)"
                        >
                            <span class="h-3.5 w-3.5 shrink-0 rounded-sm border border-[var(--border-color)]" :style="{backgroundColor: colorway.swatch}" aria-hidden="true"></span>
                            <span class="min-w-0 truncate">{{ colorway.label }}</span>
                            <span v-if="props.colorwayId === colorway.id" class="i-lucide-check h-3.5 w-3.5 shrink-0 text-[var(--accent-main)]" aria-hidden="true"></span>
                        </button>
                    </div>
                    <div class="mt-2 flex flex-wrap gap-2">
                        <button
                            type="button"
                            class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs text-[var(--text-main)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] disabled:pointer-events-none disabled:opacity-50"
                            :disabled="props.disabled"
                            data-testid="colorway-create"
                            @click="openColorwayEditor('primary')"
                        >
                            <span class="i-lucide-plus h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                            {{ props.colorwayIsUser ? t("settings.frontend.colorwayEdit") : t("settings.frontend.colorwayCreate") }}
                        </button>
                        <button
                            v-if="props.colorwayIsUser"
                            type="button"
                            class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs text-[var(--text-main)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] disabled:pointer-events-none disabled:opacity-50"
                            :disabled="props.disabled"
                            data-testid="colorway-save-as"
                            @click="openColorwayEditor('copy')"
                        >
                            {{ t("settings.frontend.colorwaySaveAs") }}
                        </button>
                        <button
                            type="button"
                            class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs text-[var(--text-main)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] disabled:pointer-events-none disabled:opacity-50"
                            :disabled="props.disabled"
                            data-testid="colorway-import"
                            @click="importInputRef?.click()"
                        >
                            <span class="i-lucide-upload h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                            {{ t("settings.frontend.colorwayImport") }}
                        </button>
                        <button
                            type="button"
                            class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs text-[var(--text-main)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] disabled:pointer-events-none disabled:opacity-50"
                            :disabled="props.disabled"
                            data-testid="colorway-export"
                            @click="emit('export-colorway')"
                        >
                            <span class="i-lucide-download h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                            {{ t("settings.frontend.colorwayExport") }}
                        </button>
                        <span class="hidden" aria-hidden="true">
                            <!-- 隐藏的文件选择器：导入按钮只负责点它 -->
                            <input ref="importInputRef" type="file" accept="application/json,.json" data-testid="colorway-import-input" @change="importColorwayFile">
                        </span>
                    </div>
                    <p v-if="importError" class="mt-1.5 text-[11px] leading-[var(--leading-ui)] text-[var(--status-danger)]" data-testid="colorway-import-error">
                        {{ importErrorText }}
                    </p>
                </div>
            </section>

            <section class="mt-[var(--space-4)] flex flex-wrap items-center justify-between gap-[var(--space-3)] border-t border-[var(--divider)] pt-[var(--space-4)]">
                <div class="min-w-0">
                    <h3 class="flex items-center gap-[var(--space-2)] text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">
                        <span class="i-lucide-brain-circuit h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                        {{ t("settings.frontend.reasoningTitle") }}
                    </h3>
                    <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.frontend.reasoningDescription") }}</p>
                </div>
                <div class="w-40 shrink-0">
                    <FormSelect :model-value="props.reasoning" :options="reasoningSelectOptions" :disabled="props.disabled" @update:model-value="emit('update:reasoning', $event)" />
                </div>
            </section>

            <section class="mt-[var(--space-4)] flex flex-wrap items-center justify-between gap-[var(--space-3)] border-t border-[var(--divider)] pt-[var(--space-4)]">
                <div class="min-w-0">
                    <h3 class="flex items-center gap-[var(--space-2)] text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">
                        <span class="i-lucide-layout h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                        {{ t("settings.frontend.viewModeTitle") }}
                    </h3>
                    <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.frontend.viewModeDescription") }}</p>
                    <p v-if="props.viewModeProjectOverride" class="text-[var(--text-xs)] text-[var(--text-secondary)]">{{ t("settings.frontend.viewModeProjectOverride") }}</p>
                    <p v-if="props.viewModeSaving" role="status" class="text-[var(--text-xs)] text-[var(--text-secondary)]">{{ t("settings.frontend.viewModeSaving") }}</p>
                </div>
                <div class="w-40 shrink-0">
                    <FormSelect :model-value="props.viewMode" :options="viewModeOptions" :disabled="props.disabled || props.viewModeSaving" @update:model-value="emit('update:viewMode', $event)" />
                </div>
            </section>
        </div>

        <ColorwayEditorDialog
            v-model="editorOpen"
            :draft="editorDraft"
            :deletable="editorDeletable"
            @save="submitColorwayDraft"
            @delete="deleteActiveColorway"
        />
    </div>
</template>
