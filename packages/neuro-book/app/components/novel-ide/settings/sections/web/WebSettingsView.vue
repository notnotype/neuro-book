<script setup lang="ts">
import {computed} from "vue";
import {Badge, Button, FormInput, FormSelect, IconButton, Switch, Tooltip} from "@notnotype/nb-ui/components";
import type {FormSelectOption} from "@notnotype/nb-ui/components";
import {
    SEARCH_PROVIDER_CATALOG,
    WEB_DEFAULTS,
    canMoveProvider,
    findSearchProvider,
    moveProvider,
    normalizeProviderOrder,
    type SearchProviderKey,
    type WebProviderDraft,
    type WebSettingsDraft,
} from "./web-settings-draft";

const props = withDefaults(defineProps<{
    /** 受控草稿；视图只改草稿并通过 update:modelValue 交回宿主 */
    modelValue: WebSettingsDraft;
    disabled?: boolean;
    saving?: boolean;
    saveError?: string;
}>(), {
    disabled: false,
    saving: false,
    saveError: "",
});

const emit = defineEmits<{
    (event: "update:modelValue", value: WebSettingsDraft): void;
}>();

const {t} = useI18n();

/** 服务列表就是优先级顺序：主视图按 order 渲染，服务本身就是数据。 */
const orderedProviders = computed(() => normalizeProviderOrder(props.modelValue.order)
    .flatMap((key) => {
        const definition = findSearchProvider(key);
        return definition ? [{definition, provider: props.modelValue.providers[key]}] : [];
    }));

const defaultProviderOptions = computed<FormSelectOption[]>(() => SEARCH_PROVIDER_CATALOG.map((definition) => ({
    value: definition.key,
    label: definition.label,
    description: t(definition.descriptionKey),
})));

const defaultProvider = computed(() => normalizeProviderOrder(props.modelValue.order)[0] ?? "tavily");

function patch(patchValue: Partial<WebSettingsDraft>): void {
    emit("update:modelValue", {...props.modelValue, ...patchValue});
}

function patchProvider(providerKey: SearchProviderKey, patchValue: Partial<WebProviderDraft>): void {
    patch({providers: {...props.modelValue.providers, [providerKey]: {...props.modelValue.providers[providerKey], ...patchValue}}});
}

function patchExtra(providerKey: SearchProviderKey, fieldKey: string, value: string): void {
    patchProvider(providerKey, {extras: {...props.modelValue.providers[providerKey].extras, [fieldKey]: value}});
}

/** 默认搜索服务就是优先级第一位；选其它服务时把它提到最前。 */
function selectDefaultProvider(value: string): void {
    const order = normalizeProviderOrder(props.modelValue.order);
    patch({order: [value as SearchProviderKey, ...order.filter((key) => key !== value)]});
}

function shiftProvider(providerKey: SearchProviderKey, direction: -1 | 1): void {
    patch({order: moveProvider(props.modelValue.order, providerKey, direction)});
}

function canShift(providerKey: SearchProviderKey, direction: -1 | 1): boolean {
    return canMoveProvider(props.modelValue.order, providerKey, direction);
}

/** 清空 provider 密钥：三处状态一起改，宿主据此写出空串。 */
function clearProviderApiKey(providerKey: SearchProviderKey): void {
    patchProvider(providerKey, {apiKey: "", apiKeyConfigured: false, apiKeyMaskedValue: null, apiKeyCleared: true});
}

function providerApiKeyPlaceholder(provider: WebProviderDraft): string {
    if (provider.apiKeyConfigured) {
        return provider.apiKeyMaskedValue ?? t("settings.panels.web.apiKeyConfigured");
    }
    return t("settings.panels.web.notConfigured");
}

/** 本地抓取的五个限额：字段名 + 文案键 + 默认值，渲染与占位共用一张表。 */
const LOCAL_LIMIT_FIELDS = [
    {key: "timeoutMs", labelKey: "settings.panels.web.timeoutMs", fallback: WEB_DEFAULTS.localFetchTimeoutMs, min: 1000, step: 1000},
    {key: "maxRedirects", labelKey: "settings.panels.web.maxRedirects", fallback: WEB_DEFAULTS.maxRedirects, min: 0, step: 1},
    {key: "maxBytes", labelKey: "settings.panels.web.maxBytes", fallback: WEB_DEFAULTS.maxBytes, min: 1024, step: 1024},
    {key: "maxCharacters", labelKey: "settings.panels.web.maxCharacters", fallback: WEB_DEFAULTS.maxCharacters, min: 1000, step: 1000},
    {key: "minCharactersForLocal", labelKey: "settings.panels.web.fallbackThreshold", fallback: WEB_DEFAULTS.minCharactersForLocal, min: 0, step: 100},
] as const;
</script>

<template>
    <div class="web-view-root flex min-w-0 flex-col" data-lab-subject>
        <header class="flex min-w-0 shrink-0 items-center gap-[var(--space-2)]">
            <h2 class="text-[var(--text-base)] [font-weight:var(--weight-strong)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.panels.web.title") }}</h2>
            <Tooltip :text="t('settings.panels.web.description')">
                <button type="button" class="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--text-muted)] transition-colors hover:text-[var(--text-main)]" aria-label="这一页说明">
                    <span class="i-lucide-info h-3.5 w-3.5" aria-hidden="true"></span>
                </button>
            </Tooltip>
        </header>

        <p v-if="props.saveError" class="mt-[var(--space-3)] truncate text-[var(--text-xs)] text-[var(--status-danger)]">
            {{ t("settings.panels.web.saveFailed") + "：" + props.saveError }}
        </p>
        <p v-else-if="props.saving" class="mt-[var(--space-3)] flex items-center gap-[var(--space-1)] text-[var(--text-xs)] text-[var(--status-info)]">
            <span class="i-lucide-loader-2 h-3 w-3 animate-spin" aria-hidden="true"></span>
            {{ t("common.saving") }}
        </p>

        <!-- 搜索服务：每个服务一块，块内只有这个服务的东西 -->
        <section class="mt-[var(--space-4)] border-t border-[var(--divider)] pt-[var(--space-4)]">
            <div class="min-w-0">
                <h3 class="text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.panels.web.searchProvider") }}</h3>
                <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.web.searchProviderDescription") }}</p>
            </div>

            <div class="mt-[var(--space-3)] flex flex-col">
                <article
                    v-for="entry in orderedProviders"
                    :key="entry.definition.key"
                    data-search-provider
                    class="border-b border-[var(--divider)] py-[var(--space-3)] last:border-b-0"
                >
                    <div class="flex flex-wrap items-center gap-[var(--space-3)]">
                        <span class="h-4 w-4 shrink-0 text-[var(--text-muted)]" :class="entry.definition.iconClass" aria-hidden="true"></span>
                        <div class="min-w-0 flex-1">
                            <div class="flex flex-wrap items-center gap-[var(--space-2)]">
                                <span class="text-[var(--text-sm)] [font-weight:var(--weight-medium)] text-[var(--text-main)]">{{ entry.definition.label }}</span>
                                <Badge variant="soft" :tone="entry.provider.apiKeyConfigured ? 'success' : 'neutral'" size="sm">
                                    {{ entry.provider.apiKeyConfigured ? t("settings.panels.web.apiKeyConfigured") : t("settings.panels.web.noKey") }}
                                </Badge>
                            </div>
                            <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t(entry.definition.descriptionKey) }}</p>
                        </div>
                        <IconButton
                            :title="t('settings.panels.web.moveUp')"
                            size="sm"
                            class="shrink-0"
                            :disabled="props.disabled || !canShift(entry.definition.key, -1)"
                            icon-class="i-lucide-arrow-up"
                            @click="shiftProvider(entry.definition.key, -1)"
                        />
                        <IconButton
                            :title="t('settings.panels.web.moveDown')"
                            size="sm"
                            class="shrink-0"
                            :disabled="props.disabled || !canShift(entry.definition.key, 1)"
                            icon-class="i-lucide-arrow-down"
                            @click="shiftProvider(entry.definition.key, 1)"
                        />
                        <Switch
                            :model-value="entry.provider.enabled"
                            :disabled="props.disabled"
                            :aria-label="entry.definition.label"
                            class="shrink-0"
                            @update:model-value="patchProvider(entry.definition.key, {enabled: $event})"
                        />
                    </div>

                    <div class="web-grid mt-[var(--space-3)] grid gap-[var(--space-3)]">
                        <label class="web-span block min-w-0">
                            <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.web.apiKey") }}</span>
                            <span class="mt-[var(--space-2)] flex gap-[var(--space-2)]">
                                <FormInput
                                    class="min-w-0 flex-1"
                                    type="password"
                                    :model-value="entry.provider.apiKey"
                                    :placeholder="providerApiKeyPlaceholder(entry.provider)"
                                    :disabled="props.disabled"
                                    @update:model-value="patchProvider(entry.definition.key, {apiKey: $event, apiKeyCleared: false})"
                                />
                                <Button
                                    v-if="entry.provider.apiKeyConfigured"
                                    class="shrink-0"
                                    size="sm"
                                    variant="danger"
                                    :disabled="props.disabled"
                                    @click="clearProviderApiKey(entry.definition.key)"
                                >
                                    {{ t("settings.panels.web.clear") }}
                                </Button>
                            </span>
                        </label>

                        <label class="block min-w-0">
                            <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.web.timeoutMs") }}</span>
                            <FormInput
                                class="mt-[var(--space-2)]"
                                type="number"
                                inputmode="numeric"
                                min="1"
                                step="1000"
                                :model-value="entry.provider.timeoutMs"
                                :placeholder="String(WEB_DEFAULTS.providerTimeoutMs)"
                                :disabled="props.disabled"
                                @update:model-value="patchProvider(entry.definition.key, {timeoutMs: $event})"
                            />
                        </label>

                        <label v-for="field in entry.definition.extraFields" :key="field.key" class="block min-w-0">
                            <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t(field.labelKey) }}</span>
                            <FormInput
                                class="mt-[var(--space-2)]"
                                :model-value="entry.provider.extras[field.key]"
                                :minlength="field.minLength"
                                :maxlength="field.maxLength"
                                :placeholder="field.placeholder"
                                :disabled="props.disabled"
                                @update:model-value="patchExtra(entry.definition.key, field.key, $event)"
                            />
                        </label>
                    </div>
                </article>
            </div>
        </section>

        <!-- 通用设置：跨服务的东西只有三件——默认服务、本地抓取、兜底 -->
        <section class="mt-[var(--space-6)] border-t border-[var(--divider)] pt-[var(--space-4)]">
            <div class="min-w-0">
                <h3 class="text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.panels.web.generalSettings") }}</h3>
            </div>

            <div class="mt-[var(--space-3)] flex flex-col">
                <div class="border-b border-[var(--divider)] pb-[var(--space-3)]">
                    <div class="text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.web.defaultSearchProvider") }}</div>
                    <div class="mt-[var(--space-2)] max-w-[280px]">
                        <FormSelect
                            :model-value="defaultProvider"
                            :options="defaultProviderOptions"
                            :disabled="props.disabled"
                            :aria-label="t('settings.panels.web.defaultSearchProvider')"
                            @update:model-value="selectDefaultProvider"
                        />
                    </div>
                </div>

                <div class="border-b border-[var(--divider)] py-[var(--space-3)]">
                    <div class="flex items-start gap-[var(--space-3)]">
                        <span class="min-w-0 flex-1">
                            <span class="block text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.panels.web.localFetch") }}</span>
                            <span class="mt-[var(--space-1)] block text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.web.localFirstDescription") }}</span>
                        </span>
                        <Switch
                            :model-value="props.modelValue.localFetch.enabled"
                            :disabled="props.disabled"
                            :aria-label="t('settings.panels.web.localFetch')"
                            class="mt-[var(--space-1)] shrink-0"
                            @update:model-value="patch({localFetch: {...props.modelValue.localFetch, enabled: $event}})"
                        />
                    </div>
                    <div class="web-grid mt-[var(--space-3)] grid gap-[var(--space-3)]">
                        <label v-for="field in LOCAL_LIMIT_FIELDS" :key="field.key" class="block min-w-0">
                            <span class="block text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t(field.labelKey) }}</span>
                            <FormInput
                                class="mt-[var(--space-2)]"
                                type="number"
                                inputmode="numeric"
                                :min="String(field.min)"
                                :step="String(field.step)"
                                :model-value="props.modelValue.localFetch[field.key]"
                                :placeholder="String(field.fallback)"
                                :disabled="props.disabled || !props.modelValue.localFetch.enabled"
                                @update:model-value="patch({localFetch: {...props.modelValue.localFetch, [field.key]: $event}})"
                            />
                        </label>
                    </div>
                </div>

                <div class="pt-[var(--space-3)]">
                    <div class="flex items-start gap-[var(--space-3)]">
                        <span class="min-w-0 flex-1">
                            <span class="block text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.panels.web.tavilyFallback") }}</span>
                            <span class="mt-[var(--space-1)] block text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.web.tavilyFallbackDescription") }}</span>
                        </span>
                        <Switch
                            :model-value="props.modelValue.tavilyFallback.enabled"
                            :disabled="props.disabled"
                            :aria-label="t('settings.panels.web.tavilyFallback')"
                            class="mt-[var(--space-1)] shrink-0"
                            @update:model-value="patch({tavilyFallback: {...props.modelValue.tavilyFallback, enabled: $event}})"
                        />
                    </div>
                    <div class="mt-[var(--space-3)] max-w-[220px]">
                        <FormInput
                            type="number"
                            inputmode="numeric"
                            min="1"
                            step="1000"
                            :model-value="props.modelValue.tavilyFallback.timeoutMs"
                            :placeholder="String(WEB_DEFAULTS.tavilyFallbackTimeoutMs)"
                            :disabled="props.disabled || !props.modelValue.tavilyFallback.enabled"
                            :aria-label="t('settings.panels.web.fallbackTimeoutMs')"
                            @update:model-value="patch({tavilyFallback: {...props.modelValue.tavilyFallback, timeoutMs: $event}})"
                        />
                    </div>
                </div>
            </div>
        </section>
    </div>
</template>

<style scoped>
.web-view-root {
    container-type: inline-size;
}

/* 字段并排由视图自身容器宽度决定，不看窗口宽度。 */
@container (min-width: 620px) {
    .web-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .web-grid .web-span {
        grid-column: span 2;
    }
}
</style>
