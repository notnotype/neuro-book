<script setup lang="ts">
import {Tooltip} from "@notnotype/nb-ui/components";
import type {EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";
import AgentVisibleModelsEditor from "../providers/components/AgentVisibleModelsEditor.vue";
import type {AgentVisibleModelDraft} from "../providers/model-settings-draft";

const props = withDefaults(defineProps<{
    /** 有序的可见模型清单；顺序就是提示词里的展示顺序 */
    modelValue: AgentVisibleModelDraft[];
    models: EnabledModelOptionDto[];
    defaultModelKey: string | null;
    /** 这一页只有 global 有内容：清单写在全局配置里 */
    isProjectScope: boolean;
    saving?: boolean;
    saveError?: string;
}>(), {
    saving: false,
    saveError: "",
});

const emit = defineEmits<{
    (event: "update:modelValue", value: AgentVisibleModelDraft[]): void;
}>();

const {t} = useI18n();
</script>

<template>
    <div class="agent-visible-models-view-root flex min-w-0 max-w-3xl flex-col" data-lab-subject>
        <header class="flex min-w-0 shrink-0 items-center gap-[var(--space-2)]">
            <h2 class="text-[var(--text-base)] [font-weight:var(--weight-strong)] leading-[var(--leading-ui)] text-[var(--text-main)]">
                {{ t("settings.panels.models.agentVisibleModelsTitle") }}
            </h2>
            <Tooltip :text="t('settings.panels.models.agentVisibleModelsDescription')">
                <button type="button" class="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--text-muted)] transition-colors hover:text-[var(--text-main)]" aria-label="这一页说明">
                    <span class="i-lucide-info h-3.5 w-3.5" aria-hidden="true"></span>
                </button>
            </Tooltip>
        </header>

        <p v-if="props.saveError" class="mt-[var(--space-3)] truncate text-[var(--text-xs)] text-[var(--status-danger)]">
            {{ t("settings.panels.models.saveFailed") + "：" + props.saveError }}
        </p>
        <p v-else-if="props.saving" class="mt-[var(--space-3)] flex items-center gap-[var(--space-1)] text-[var(--text-xs)] text-[var(--status-info)]">
            <span class="i-lucide-loader-2 h-3 w-3 animate-spin" aria-hidden="true"></span>
            {{ t("common.saving") }}
        </p>

        <!-- 清单写在全局配置里：项目作用域不提供覆盖，只说明去哪改 -->
        <div v-if="props.isProjectScope" class="mt-[var(--space-4)] border-t border-[var(--divider)] pt-[var(--space-4)]">
            <p class="text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">
                {{ t("settings.panels.models.agentVisibleModelsGlobalOnly") }}
            </p>
        </div>
        <div v-else class="mt-[var(--space-4)] border-t border-[var(--divider)] pt-[var(--space-4)]">
            <AgentVisibleModelsEditor
                :model-value="props.modelValue"
                :models="props.models"
                :default-model-key="props.defaultModelKey"
                @update:model-value="emit('update:modelValue', $event)"
            />
        </div>
    </div>
</template>
