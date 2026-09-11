<script setup lang="ts">
import {computed} from "vue";
import {Badge, Button, FormSelect} from "@notnotype/nb-ui/components";
import type {FormSelectOption} from "@notnotype/nb-ui/components";
import type {ModelSettingsProviderDraft} from "../model-settings-draft";

const props = withDefaults(defineProps<{
    providers: ModelSettingsProviderDraft[];
    /** 当前选中 Provider 的 localKey */
    activeKey: string;
    /** 新建 Provider 用的模板；入口在这一栏的底部，不占内容区顶部一整行 */
    templates: Array<{id: string; name: string; description?: string}>;
    selectedTemplate: string;
    disabled?: boolean;
}>(), {
    disabled: false,
});

const emit = defineEmits<{
    (event: "select", key: string): void;
    (event: "update:selectedTemplate", value: string): void;
    (event: "add"): void;
}>();

const templateOptions = computed<FormSelectOption[]>(() => props.templates.map((item) => ({
    value: item.id,
    label: item.name,
    description: item.description,
})));

const {t} = useI18n();

/** Provider 行上只显示可运行数量：停用的 Provider 一律显示 0，避免误读成"还有 N 个可用"。 */
function enabledModelCount(provider: ModelSettingsProviderDraft): number {
    return provider.models.filter((model) => model.enabled).length;
}
</script>

<template>
    <div class="model-provider-rail flex min-h-0 min-w-0 flex-col">
        <div class="flex shrink-0 items-baseline justify-between gap-[var(--space-2)]">
            <h3 class="text-[var(--text-2xs)] [font-weight:var(--weight-strong)] uppercase tracking-[0.2em] text-[var(--text-muted)]">Providers</h3>
            <span class="text-[var(--text-2xs)] leading-[var(--leading-ui)] text-[var(--text-muted)]">{{ t("settings.panels.models.providersHint") }}</span>
        </div>

        <!-- 新增 Provider：在列表上方，不随列表滚动；它是这一栏的第一个动作，不是列表的尾部 -->
        <div class="mt-[var(--space-3)] flex shrink-0 items-center gap-[var(--space-2)] border-b border-[var(--divider)] pb-[var(--space-3)]">
            <FormSelect
                size="sm"
                class="min-w-0 flex-1"
                :model-value="props.selectedTemplate"
                :options="templateOptions"
                :disabled="props.disabled"
                :aria-label="t('settings.panels.models.addProvider')"
                @update:model-value="emit('update:selectedTemplate', $event)"
            />
            <Button size="sm" variant="secondary" class="shrink-0" :disabled="props.disabled" @click="emit('add')">
                <span class="i-lucide-plus mr-1 h-3.5 w-3.5" aria-hidden="true"></span>
                {{ t("settings.panels.models.add") }}
            </Button>
        </div>

        <p v-if="props.providers.length === 0" class="mt-[var(--space-3)] shrink-0 text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">
            {{ t("settings.panels.models.noProviders") }}
        </p>

        <ul v-else class="custom-scrollbar mt-[var(--space-2)] flex min-h-0 flex-1 flex-col gap-[var(--space-1)] overflow-y-auto">
            <li v-for="provider in props.providers" :key="provider.localKey">
                <button
                    type="button"
                    data-provider-row
                    :aria-current="provider.localKey === props.activeKey ? 'page' : undefined"
                    class="flex w-full items-center gap-[var(--space-2)] rounded-[var(--radius-control)] px-[var(--space-2)] py-[var(--space-1-5,0.375rem)] text-left transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)]"
                    :class="provider.localKey === props.activeKey
                        ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                    @click="emit('select', provider.localKey)"
                >
                    <span
                        class="h-4 w-4 shrink-0"
                        :class="provider.enabled ? 'i-lucide-server' : 'i-lucide-server-off'"
                        aria-hidden="true"
                    ></span>
                    <span class="min-w-0 flex-1 truncate text-[var(--text-sm)] [font-weight:var(--weight-medium)]">{{ provider.name }}</span>
                    <span v-if="!provider.enabled" class="shrink-0">
                        <Badge variant="soft" tone="warning" size="sm">{{ t("settings.panels.models.providerDisabled") }}</Badge>
                    </span>
                    <span class="shrink-0 text-[var(--text-2xs)] text-[var(--text-muted)]">
                        {{ t("settings.panels.models.modelCount", {count: provider.enabled ? enabledModelCount(provider) : 0}) }}
                    </span>
                </button>
            </li>
        </ul>
    </div>
</template>
