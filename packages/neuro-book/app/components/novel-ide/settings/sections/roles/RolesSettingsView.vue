<script setup lang="ts">
import {computed} from "vue";
import {Tooltip} from "@notnotype/nb-ui/components";
import type {EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";
import NovelIdeModelSelect from "../providers/components/NovelIdeModelSelect.vue";
import {
    MODEL_ROLE_CATALOG,
    resolveEffectiveRole,
    type ModelRoleDefinition,
    type ModelRoleId,
    type RolesSettingsDraft,
} from "./roles-settings-draft";

const props = withDefaults(defineProps<{
    /** 角色绑定草稿；null 表示未配置，实际生效看回落链 */
    modelValue: RolesSettingsDraft;
    models: EnabledModelOptionDto[];
    saving?: boolean;
    saveError?: string;
}>(), {
    saving: false,
    saveError: "",
});

const emit = defineEmits<{
    (event: "update:modelValue", value: RolesSettingsDraft): void;
}>();

const {t} = useI18n();

const gradientRoles = computed(() => MODEL_ROLE_CATALOG.filter((role) => role.axis === "gradient"));
const specialistRoles = computed(() => MODEL_ROLE_CATALOG.filter((role) => role.axis === "specialist"));

/** 这一行当前实际用谁的模型：自己绑了、回落到了谁、还是必须先配（视觉这种不能回落的）。 */
function effectiveLabel(role: ModelRoleDefinition): string {
    if (props.modelValue.roles[role.id]) {
        return t("settings.panels.roles.boundHere");
    }
    if (role.fallback === null) {
        return t("settings.panels.roles.mustConfigure");
    }
    const effective = resolveEffectiveRole(props.modelValue, role.id);
    return effective === null
        ? t("settings.panels.roles.fallbackUnbound", {role: role.fallback})
        : t("settings.panels.roles.fallbackTo", {role: effective});
}

function fallbackOptionLabel(role: ModelRoleDefinition): string {
    return role.fallback === null
        ? t("settings.panels.roles.notConfigured")
        : t("settings.panels.roles.followRole", {role: role.fallback});
}

function updateRole(id: ModelRoleId, value: string | null): void {
    emit("update:modelValue", {roles: {...props.modelValue.roles, [id]: value}});
}
</script>

<template>
    <div class="roles-view-root flex min-w-0 max-w-3xl flex-col" data-lab-subject>
        <header class="flex min-w-0 shrink-0 items-center gap-[var(--space-2)]">
            <h2 class="text-[var(--text-base)] [font-weight:var(--weight-strong)] leading-[var(--leading-ui)] text-[var(--text-main)]">
                {{ t("settings.section.roles.label") }}
            </h2>
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

        <section v-for="axis in [
            {key: 'gradient', label: t('settings.panels.roles.axisGradient'), hint: t('settings.panels.roles.axisGradientHint'), roles: gradientRoles},
            {key: 'specialist', label: t('settings.panels.roles.axisSpecialist'), hint: t('settings.panels.roles.axisSpecialistHint'), roles: specialistRoles},
        ]" :key="axis.key" class="mt-[var(--space-4)] border-t border-[var(--divider)] pt-[var(--space-4)]">
            <div class="min-w-0">
                <h3 class="text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ axis.label }}</h3>
                <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ axis.hint }}</p>
            </div>

            <div class="mt-[var(--space-3)] flex flex-col">
                <div
                    v-for="role in axis.roles"
                    :key="role.id"
                    data-role-row
                    class="grid gap-[var(--space-3)] border-b border-[var(--divider)] py-[var(--space-3)] last:border-b-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                >
                    <div class="min-w-0">
                        <div class="flex items-baseline gap-[var(--space-2)]">
                            <code class="font-mono text-[var(--text-xs)] text-[var(--text-main)]">{{ role.id }}</code>
                            <span class="text-[var(--text-2xs)] leading-[var(--leading-ui)] text-[var(--text-muted)]">{{ effectiveLabel(role) }}</span>
                        </div>
                        <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t(role.purposeKey) }}</p>
                        <p class="mt-[var(--space-1)] text-[var(--text-2xs)] leading-[var(--leading-ui)] text-[var(--text-muted)]">
                            {{ t("settings.panels.roles.suggestedChain") + "：" + role.suggestedChain.join(" → ") }}
                        </p>
                    </div>
                    <div class="min-w-0">
                        <NovelIdeModelSelect
                            :model-value="props.modelValue.roles[role.id]"
                            :models="props.models"
                            :allow-default="role.fallback !== null"
                            :default-label="fallbackOptionLabel(role)"
                            :placeholder="t('settings.panels.roles.notConfigured')"
                            :disabled="props.saving"
                            @update:model-value="updateRole(role.id, $event)"
                        />
                    </div>
                </div>
            </div>
        </section>
    </div>
</template>
