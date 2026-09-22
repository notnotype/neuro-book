<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {DialogWindow} from "@notnotype/nb-ui/components";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import {
    checkColorwayVarValue,
    colorwayVarGroupOf,
    colorwayVarGroups,
    colorwayVarKeys,
} from "nbook/app/utils/theme/colorway-vars";
import type {ColorwayDraft} from "./FrontendSettingsView.types";
import type {ColorwayVarGroup} from "nbook/app/utils/theme/colorway-vars";
import {MAX_USER_COLORWAY_LABEL_LENGTH} from "nbook/shared/theme/user-colorway";

/**
 * 配色变量编辑器。
 *
 * 草稿在**本组件内**编辑、按「保存并应用」一次性提交：宿主拿到的是完整的一份配色，
 * 不需要知道用户中途改过哪些键。取消（关窗）直接丢掉草稿，无需回滚——
 * 这也意味着编辑器里没有「实时预览」，预览要实时就得让宿主跟着草稿改全局样式，
 * 那条路径在配置写失败时的回滚面会变大，收益不抵（见 README 里配色轴的分工）。
 *
 * 每一行都当场校验：非法值在**这一行**标红并给出原因，保存按钮同时禁用。
 * 值留空是合法的（表示沿用主题自带配色里这个变量的取值），所以空值不标错。
 */
const props = withDefaults(defineProps<{
    modelValue: boolean;
    /** 打开时的起点；`id` 有值 = 改这一套，没有 = 新建 */
    draft: ColorwayDraft | null;
    /** 已有的用户配色才给删除入口 */
    deletable?: boolean;
    /** 写盘期间禁用全部动作 */
    busy?: boolean;
}>(), {
    deletable: false,
    busy: false,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "save", draft: ColorwayDraft): void;
    (e: "delete", colorwayId: string): void;
}>();

const {t} = useI18n();
const label = ref("");
const vars = ref<Record<string, string>>({});
/** 删除按钮的第一下只是把按钮变成「确认删除」：删除是不可逆的，但它不值得再开一个模态 */
const confirmingDelete = ref(false);

watch(() => props.modelValue, (open) => {
    confirmingDelete.value = false;
    if (!open) {
        return;
    }
    label.value = props.draft?.label ?? "";
    vars.value = {...props.draft?.vars};
});

const rows = computed(() => colorwayVarKeys.map((name) => {
    const value = vars.value[name] ?? "";
    return {name, value, issue: checkColorwayVarValue(name, value)};
}));

const groups = computed(() => colorwayVarGroups
    .map((group) => ({group, rows: rows.value.filter((row) => colorwayVarGroupOf(row.name) === group)}))
    .filter((entry) => entry.rows.length > 0));

const invalidCount = computed(() => rows.value.filter((row) => row.issue === "invalid").length);
const canSave = computed(() => label.value.trim().length > 0 && invalidCount.value === 0);

/** 空值不进草稿：空 = 沿用主题自带配色的取值，存下来一个空串反而会把它覆盖成「没有」。 */
function collectVars(): Record<string, string> {
    const collected: Record<string, string> = {};
    for (const row of rows.value) {
        const value = row.value.trim();
        if (value) {
            collected[row.name] = value;
        }
    }
    return collected;
}

function submit(): void {
    if (!canSave.value || props.draft === null) {
        return;
    }
    emit("save", {
        id: props.draft.id,
        label: label.value.trim(),
        appearance: props.draft.appearance,
        vars: collectVars(),
    });
}

function requestDelete(): void {
    if (!confirmingDelete.value) {
        confirmingDelete.value = true;
        return;
    }
    if (props.draft?.id !== undefined) {
        emit("delete", props.draft.id);
    }
}

const groupLabelKeys: Record<ColorwayVarGroup, string> = {
    background: "settings.frontend.colorwayGroupBackground",
    text: "settings.frontend.colorwayGroupText",
    border: "settings.frontend.colorwayGroupBorder",
    accent: "settings.frontend.colorwayGroupAccent",
    status: "settings.frontend.colorwayGroupStatus",
    other: "settings.frontend.colorwayGroupOther",
};
</script>

<template>
    <DialogWindow
        :model-value="props.modelValue"
        size="md"
        :busy="props.busy"
        teleport-target=".novel-ide-theme"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <template #header>
            <span class="text-[var(--text-main)]">{{ t("settings.frontend.colorwayEditorTitle") }}</span>
            <span class="ml-1.5 text-[var(--text-muted)]">{{ t("settings.frontend.colorwayEditorSubtitle") }}</span>
        </template>

        <div class="flex min-w-0 flex-col gap-3">
            <label class="grid grid-cols-[11rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
                <span class="text-[var(--text-xs)] text-[var(--text-secondary)]">{{ t("settings.frontend.colorwayNameLabel") }}</span>
                <span class="min-w-0" data-testid="colorway-name-input">
                    <FormInput
                        :model-value="label"
                        :placeholder="t('settings.frontend.colorwayNamePlaceholder')"
                        :disabled="props.busy"
                        @update:model-value="label = $event.slice(0, MAX_USER_COLORWAY_LABEL_LENGTH)"
                    />
                </span>
            </label>
            <p class="text-[11px] leading-[var(--leading-ui)] text-[var(--text-muted)]">
                {{ t("settings.frontend.colorwayEditorAppearance", {value: props.draft?.appearance === "dark" ? t("settings.frontend.appearanceDark") : t("settings.frontend.appearanceLight")}) }}
                · {{ t("settings.frontend.colorwayEditorHint") }}
            </p>

            <div class="flex min-w-0 flex-col gap-3 border-t border-[var(--divider)] pt-3">
                <section v-for="entry in groups" :key="entry.group" class="flex min-w-0 flex-col gap-1.5">
                    <h4 class="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{{ t(groupLabelKeys[entry.group]) }}</h4>
                    <div
                        v-for="row in entry.rows"
                        :key="row.name"
                        class="grid grid-cols-[11rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1"
                        :data-colorway-row="row.name"
                    >
                        <code class="min-w-0 truncate font-mono text-[11px] text-[var(--text-secondary)]" :title="row.name">{{ row.name }}</code>
                        <span
                            class="flex min-w-0 items-center gap-1.5 rounded-md"
                            :class="row.issue === 'invalid' ? 'ring-1 ring-[var(--status-danger)]' : ''"
                        >
                            <span
                                v-if="row.issue === null"
                                class="h-3.5 w-3.5 shrink-0 rounded-sm border border-[var(--border-color)]"
                                :style="{backgroundColor: row.value.trim()}"
                                aria-hidden="true"
                            ></span>
                            <span class="min-w-0 flex-1" :data-colorway-input="row.name">
                                <FormInput
                                    :model-value="row.value"
                                    :placeholder="t('settings.frontend.colorwayValueInherit')"
                                    :disabled="props.busy"
                                    @update:model-value="vars = {...vars, [row.name]: $event}"
                                />
                            </span>
                        </span>
                        <p v-if="row.issue === 'invalid'" class="col-start-2 text-[11px] leading-[var(--leading-ui)] text-[var(--status-danger)]" :data-colorway-error="row.name">
                            {{ t("settings.frontend.colorwayInvalidValue", {name: row.name}) }}
                        </p>
                    </div>
                </section>
            </div>
        </div>

        <template #footer>
            <button
                v-if="props.deletable"
                type="button"
                class="mr-auto inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs transition-colors disabled:pointer-events-none disabled:opacity-50"
                :class="confirmingDelete
                    ? 'border-[var(--status-danger)] text-[var(--status-danger)]'
                    : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-main)]'"
                :disabled="props.busy"
                data-testid="colorway-delete"
                @click="requestDelete"
            >
                <span class="i-lucide-trash-2 h-3.5 w-3.5 shrink-0" aria-hidden="true"></span>
                {{ confirmingDelete ? t("settings.frontend.colorwayDeleteConfirm") : t("settings.frontend.colorwayDelete") }}
            </button>
            <button
                type="button"
                class="inline-flex h-8 items-center rounded-md border border-[var(--border-color)] px-3 text-xs text-[var(--text-main)] transition-colors hover:border-[var(--border-strong)] disabled:pointer-events-none disabled:opacity-50"
                :disabled="props.busy"
                @click="emit('update:modelValue', false)"
            >
                {{ t("settings.frontend.colorwayCancel") }}
            </button>
            <button
                type="button"
                class="inline-flex h-8 items-center rounded-md border border-[var(--accent-main)] bg-[var(--accent-bg)] px-3 text-xs text-[var(--text-main)] transition-colors disabled:pointer-events-none disabled:opacity-50"
                :disabled="props.busy || !canSave"
                data-testid="colorway-save"
                @click="submit"
            >
                {{ t("settings.frontend.colorwaySave") }}
            </button>
        </template>
    </DialogWindow>
</template>
