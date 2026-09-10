<script setup lang="ts">
import {Tooltip} from "@notnotype/nb-ui/components";
import type {EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";
import NovelIdeModelSelect from "../providers/components/NovelIdeModelSelect.vue";

const props = withDefaults(defineProps<{
    /** 默认模型 key；project 作用域下 null 表示跟随全局 */
    modelKey: string | null;
    models: EnabledModelOptionDto[];
    isProjectScope: boolean;
    targetLabel: string;
    saving?: boolean;
    saveError?: string;
}>(), {
    saving: false,
    saveError: "",
});

const emit = defineEmits<{
    (event: "update:modelKey", value: string | null): void;
}>();

const {t} = useI18n();
</script>

<template>
    <!-- 阅读型区段：内容列封顶由区段体自己负责（外壳不封，两栏型区段需要整幅宽度） -->
    <div class="default-model-view-root flex min-w-0 max-w-3xl flex-col" data-lab-subject>
        <header class="flex min-w-0 shrink-0 items-center gap-[var(--space-2)]">
            <h2 class="text-[var(--text-base)] [font-weight:var(--weight-strong)] leading-[var(--leading-ui)] text-[var(--text-main)]">
                {{ props.isProjectScope ? t("settings.panels.models.projectDefaultTitle") : t("settings.panels.models.globalDefaultTitle") }}
            </h2>
            <!-- 说明「会写到哪里」属于元信息：走 tooltip，不单独占一行 -->
            <Tooltip :text="props.isProjectScope
                ? t('settings.panels.models.projectDescription', {target: props.targetLabel || t('settings.panels.models.currentProject')})
                : t('settings.panels.models.globalDescription')">
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

        <div class="mt-[var(--space-4)] border-t border-[var(--divider)] pt-[var(--space-4)]">
            <NovelIdeModelSelect
                :model-value="props.modelKey"
                :models="props.models"
                :allow-default="props.isProjectScope"
                :default-label="t('settings.panels.models.followGlobalDefault')"
                :placeholder="t('settings.panels.models.noEnabledModels')"
                :disabled="props.saving"
                @update:model-value="emit('update:modelKey', $event)"
            />
            <!-- 这一句讲的是「改了会怎样」，是影响判断的正文，不是元信息，所以留在页面上 -->
            <p class="mt-[var(--space-2)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">
                {{ props.isProjectScope ? t("settings.panels.models.projectDefaultDescription") : t("settings.panels.models.globalDefaultDescription") }}
            </p>
        </div>
    </div>
</template>
