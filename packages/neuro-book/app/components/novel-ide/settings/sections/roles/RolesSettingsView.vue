<script setup lang="ts">
import {computed} from "vue";
import {Badge, FormInput, FormSelect, IconButton, Tooltip} from "@notnotype/nb-ui/components";
import type {FormSelectOption} from "@notnotype/nb-ui/components";
import type {EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";
import {
    addSpecialistRole,
    removeRole as removeRoleFromDraft,
    roleConfigIssues,
    type ModelRoleAxis,
    type ModelRoleDraft,
    type RolesSettingsDraft,
} from "./roles-settings-draft";

const props = withDefaults(defineProps<{
    /** 受控草稿；视图只改草稿并通过 update:modelValue 交回宿主 */
    modelValue: RolesSettingsDraft;
    /** 可选模型清单 */
    models: EnabledModelOptionDto[];
    disabled?: boolean;
    saving?: boolean;
    saveError?: string;
}>(), {
    disabled: false,
    saving: false,
    saveError: "",
});

const emit = defineEmits<{
    (event: "update:modelValue", value: RolesSettingsDraft): void;
}>();

const {t} = useI18n();

const modelOptions = computed<FormSelectOption[]>(() => props.models.map((model) => ({
    value: model.key,
    label: model.label,
})));

const axisSections = computed<Array<{axis: ModelRoleAxis; title: string; hint: string; roles: ModelRoleDraft[]}>>(() => [
    {
        axis: "gradient",
        title: t("settings.panels.roles.axisGradient"),
        hint: t("settings.panels.roles.axisGradientHint"),
        roles: props.modelValue.gradient,
    },
    {
        axis: "specialist",
        title: t("settings.panels.roles.axisSpecialist"),
        hint: t("settings.panels.roles.axisSpecialistHint"),
        roles: props.modelValue.specialist,
    },
]);

const issues = computed(() => roleConfigIssues(props.modelValue));

function hasIssue(id: string, reason: "missing-model" | "missing-description"): boolean {
    return issues.value.some((issue) => issue.id === id && issue.reason === reason);
}

function patchRole(axis: ModelRoleAxis, id: string, patchValue: Partial<ModelRoleDraft>): void {
    const list = props.modelValue[axis].map((role) => (role.id === id ? {...role, ...patchValue} : role));
    emit("update:modelValue", {...props.modelValue, [axis]: list});
}

function addRole(): void {
    emit("update:modelValue", addSpecialistRole(props.modelValue, t));
}

function removeRole(id: string): void {
    emit("update:modelValue", removeRoleFromDraft(props.modelValue, id));
}

function suggestedTip(role: ModelRoleDraft): string {
    return t("settings.panels.roles.suggestedModel", {model: role.suggestedModel ?? ""});
}
</script>

<template>
    <div class="roles-view-root flex min-w-0 flex-col" data-lab-subject>
        <header class="flex min-w-0 shrink-0 items-center gap-[var(--space-2)]">
            <h2 class="text-[var(--text-base)] [font-weight:var(--weight-strong)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.panels.roles.title") }}</h2>
            <Tooltip :text="t('settings.panels.roles.description')">
                <button type="button" class="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--text-muted)] transition-colors hover:text-[var(--text-main)]" aria-label="这一页说明">
                    <span class="i-lucide-info h-3.5 w-3.5" aria-hidden="true"></span>
                </button>
            </Tooltip>
        </header>

        <p v-if="props.saveError" class="mt-[var(--space-3)] truncate text-[var(--text-xs)] text-[var(--status-danger)]">
            {{ t("settings.panels.roles.saveFailed") + "：" + props.saveError }}
        </p>
        <p v-else-if="props.saving" class="mt-[var(--space-3)] flex items-center gap-[var(--space-1)] text-[var(--text-xs)] text-[var(--status-info)]">
            <span class="i-lucide-loader-2 h-3 w-3 animate-spin" aria-hidden="true"></span>
            {{ t("common.saving") }}
        </p>

        <section
            v-for="axis in axisSections"
            :key="axis.axis"
            class="mt-[var(--space-4)] border-t border-[var(--divider)] pt-[var(--space-4)]"
        >
            <div class="min-w-0">
                <h3 class="text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ axis.title }}</h3>
                <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ axis.hint }}</p>
            </div>

            <div class="mt-[var(--space-3)] flex flex-col">
                <article
                    v-for="role in axis.roles"
                    :key="role.id"
                    data-role-row
                    class="role-grid grid items-start gap-[var(--space-3)] border-b border-[var(--divider)] py-[var(--space-3)] last:border-b-0"
                >
                    <div class="min-w-0">
                        <div class="flex items-center gap-[var(--space-2)]">
                            <span class="h-4 w-4 shrink-0 text-[var(--text-muted)]" :class="role.iconClass" aria-hidden="true"></span>
                            <FormInput
                                v-if="role.removable"
                                class="role-name-input"
                                :model-value="role.name"
                                :placeholder="t('settings.panels.roles.roleName')"
                                :aria-label="t('settings.panels.roles.roleName')"
                                :disabled="props.disabled"
                                @update:model-value="patchRole(axis.axis, role.id, {name: $event})"
                            />
                            <span v-else class="truncate text-[var(--text-sm)] [font-weight:var(--weight-medium)] text-[var(--text-main)]">{{ role.name }}</span>
                            <Badge v-if="hasIssue(role.id, 'missing-model')" variant="soft" tone="danger" size="sm">
                                {{ t("settings.panels.roles.notConfigured") }}
                            </Badge>
                            <Tooltip v-if="role.suggestedModel" :text="suggestedTip(role)">
                                <button type="button" class="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--text-muted)] transition-colors hover:text-[var(--text-main)]" :aria-label="suggestedTip(role)">
                                    <span class="i-lucide-info h-3.5 w-3.5" aria-hidden="true"></span>
                                </button>
                            </Tooltip>
                        </div>

                        <FormInput
                            v-if="role.removable"
                            class="role-description-input mt-[var(--space-2)]"
                            :model-value="role.description"
                            :placeholder="t('settings.panels.roles.roleDescription')"
                            :aria-label="t('settings.panels.roles.roleDescription')"
                            :disabled="props.disabled"
                            @update:model-value="patchRole(axis.axis, role.id, {description: $event})"
                        />
                        <p v-else class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">
                            {{ role.description }}
                            <span class="ml-[var(--space-2)] font-mono text-[var(--text-2xs)] text-[var(--text-muted)]">{{ role.id }}</span>
                        </p>
                        <p v-if="hasIssue(role.id, 'missing-description')" class="mt-[var(--space-1)] text-[var(--text-2xs)] text-[var(--status-danger)]">
                            {{ t("settings.panels.roles.roleDescriptionRequired") }}
                        </p>
                    </div>

                    <!-- 模型下拉与删除同一个操作区：窄容器里它们一起换行，不会各自独占一行 -->
                    <div class="role-actions flex items-center gap-[var(--space-2)]">
                        <FormSelect
                            class="min-w-0 flex-1"
                            :model-value="role.modelKey ?? ''"
                            :options="modelOptions"
                            :placeholder="t('settings.panels.roles.notConfigured')"
                            :aria-label="role.name"
                            :dropdown-direction="axis.axis === 'gradient' ? 'down' : 'auto'"
                            :disabled="props.disabled"
                            @update:model-value="patchRole(axis.axis, role.id, {modelKey: $event || null})"
                        />
                        <IconButton
                            v-if="role.removable"
                            class="shrink-0"
                            :title="t('settings.panels.roles.removeRole')"
                            icon-class="i-lucide-trash-2"
                            variant="danger"
                            size="sm"
                            :disabled="props.disabled"
                            @click="removeRole(role.id)"
                        />
                        <span v-else class="w-7 shrink-0"></span>
                    </div>
                </article>
            </div>

            <button
                v-if="axis.axis === 'specialist'"
                type="button"
                data-add-role
                class="mt-[var(--space-3)] inline-flex items-center gap-[var(--space-1)] text-[var(--text-xs)] [font-weight:var(--weight-medium)] text-[var(--status-info)] transition-colors hover:opacity-80 disabled:opacity-50"
                :disabled="props.disabled"
                @click="addRole"
            >
                <span class="i-lucide-plus h-3.5 w-3.5" aria-hidden="true"></span>
                {{ t("settings.panels.roles.addRole") }}
            </button>
        </section>
    </div>
</template>

<style scoped>
.roles-view-root {
    container-type: inline-size;
}

/* 窄容器一行一件事，宽一些再把模型下拉和删除并到右侧，且各角色对齐。 */
@container (min-width: 620px) {
    .role-grid {
        grid-template-columns: minmax(0, 1fr) 260px;
    }
}

/* 名字输入始终收窄：它是行内标题，不该长得像一整块输入框 */
.role-name-input {
    width: min(200px, 100%);
}
</style>
