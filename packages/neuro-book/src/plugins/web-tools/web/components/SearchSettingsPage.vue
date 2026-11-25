<script setup lang="ts">
import {Button, Collapsible, SegmentedControl} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {computed, onMounted, reactive, ref, useId, watch} from "vue";

import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import type {SettingsFailure, SettingsService} from "nbook/shared/settings";
import {settingsFailureText} from "nbook/ui/settings/setting-text";
import SettingsRow from "nbook/ui/settings/SettingsRow.vue";

import {PROVIDER_LABELS, WEB_PROVIDERS} from "../../shared/contracts";
import type {WebProviderId} from "../../shared/contracts";
import {webSettings} from "../../shared/settings";
import type {SearchStore, WebFailure} from "../search-store";
import {failureReason, useWebText} from "../text";
import type {WebText} from "../text";
import ApiKeyField from "./ApiKeyField.vue";

/**
 * 设置窗口的“搜索与网页”页（docs/specs/web/settings-page.md）。密钥与检测在数据模块里，这里只读状态、调方法；“使用”哪家是设置项
 * `nbook.web/provider`，经传入的配置服务读写（同“网络”页）。写失败都交给窗口通知。加服务时多一节，版式不变。
 *
 * 动效：选中的那家没有密钥时，“使用”下面的提示经 `Collapsible` 出现与消失（高度与透明度，`--motion-move`）。收起的过程中提示
 * 还在页面上，所以它写的服务名停在最近一次展开时那家（`noKeyLabel`），不跟着已经改选的那家变。
 */
const props = defineProps<{
    store: SearchStore;
    settings: SettingsService;
    writable: boolean;
    reportWriteFailure: SettingsPageContext["reportWriteFailure"];
}>();

const text = useWebText();
const port = useText();
const id = useId();
const {provider: providerSetting} = webSettings.settings;

onMounted(() => void props.store.start());

const disabled = computed(() => !props.store.available.value || !props.writable);
const keysUnreadable = computed(() => props.store.statusFailure.value?.code === "credentials-unavailable");

function keyState(provider: WebProviderId): "loading" | "set" | "unset" {
    const status = props.store.status.value;
    // 没取到状态时不说“未设置”（输出 2）；只有密钥文件读不了时按未设置画：在这里写入会覆盖它。
    if (status === null) return keysUnreadable.value ? "unset" : "loading";
    return status.providers[provider].hasKey ? "set" : "unset";
}

// ---- 使用哪家（输出 11） ----
const selected = computed(() => props.settings.get(providerSetting));
const providerOptions = WEB_PROVIDERS.map((value) => ({value, label: PROVIDER_LABELS[value]}));
/** 选中的那家没有密钥：只在状态取到之后说，读取中不说。 */
const selectedNoKey = computed(() => props.store.status.value !== null && keyState(selected.value) === "unset");
const noKeyId = `${id}-no-key`;
const noKeyLabel = ref(PROVIDER_LABELS[selected.value]);
watch([selectedNoKey, selected], ([open, chosen]) => {
    if (open) noKeyLabel.value = PROVIDER_LABELS[chosen];
}, {immediate: true});

/** “使用”没写成（单选与设置行自己的“恢复默认”都走这里）：原因用设置窗口同一套说法（输出 11）。 */
function reportUseFailure(code: SettingsFailure, detail: string): void {
    props.reportWriteFailure(text("settings.provider.title"), {reason: settingsFailureText(code, detail, port), uncertain: code === "unknown-outcome"});
}

async function choose(value: WebProviderId): Promise<void> {
    if (value === selected.value) return;
    const result = await props.settings.update(providerSetting, value, {layer: "user"});
    // 没写成时单选仍读设置里的值，自己回到写前那家。
    if (!result.ok) reportUseFailure(result.code, result.detail);
}

// ---- 每家的密钥与检测 ----
/** 每家一节的说明（输出 9）。 */
const NOTE_KEYS = {deepseek: "deepseek.note", tavily: "tavily.note"} as const satisfies Record<WebProviderId, Parameters<WebText>[0]>;
/** 框里有失焦就会交出的输入。第一次填写时还没有密钥，点“检测”先让框失焦写入，数据模块让检测排在这次写入后面（输出 8）。 */
const draftPending = reactive<Record<WebProviderId, boolean>>({deepseek: false, tavily: false});

const checking = (provider: WebProviderId): boolean => props.store.checks.get(provider)?.status === "running";
const canCheck = (provider: WebProviderId): boolean => !disabled.value && !checking(provider) && (keyState(provider) === "set" || draftPending[provider] || props.store.writing.has(provider));

const formatTime = (at: number): string => new Date(at).toLocaleTimeString(undefined, {hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false});
function checkLine(provider: WebProviderId): string {
    const state = props.store.checks.get(provider);
    if (state === undefined || state.status === "running") return "";
    const label = PROVIDER_LABELS[provider];
    // 检测不保存东西：结果未知时不借写入的说法（“可能没有保存”），只说不确定发没发出去（发出去了就计过一次费）。
    if (state.status === "error") return state.failure.code === "unknown-outcome" ? text("check.unknown") : text("check.notRun", {reason: failureReason(text, state.failure, label)});
    if (state.result.ok) return text("check.passed", {time: formatTime(state.at)});
    return text("check.failed", {reason: failureReason(text, {code: state.result.code, detail: state.result.detail}, label)});
}
function checkFailed(provider: WebProviderId): boolean {
    const state = props.store.checks.get(provider);
    return state !== undefined && state.status !== "running" && !(state.status === "done" && state.result.ok);
}

async function written(provider: WebProviderId, result: Promise<{readonly ok: true} | {readonly ok: false; readonly failure: WebFailure}>): Promise<void> {
    const outcome = await result;
    if (outcome.ok) return;
    const label = PROVIDER_LABELS[provider];
    const reason = text("writeFailed", {reason: failureReason(text, outcome.failure, label)});
    props.reportWriteFailure(text("subject.key", {provider: label}), {reason, uncertain: outcome.failure.code === "unknown-outcome"});
}
</script>

<template>
    <div class="search-settings" data-search-settings>
        <p v-if="!store.available.value" class="search-settings__notice" role="status" data-search-readonly>{{ text("readOnly") }}</p>
        <p v-else-if="keysUnreadable" class="search-settings__notice search-settings__notice--error" role="alert" data-search-keys-unreadable>{{ text("keysUnreadable") }}</p>
        <SettingsRow :settings="settings" :setting="providerSetting" layer="user" @write-failed="(failure) => reportUseFailure(failure.code, failure.detail)">
            <template #default="row">
                <SegmentedControl
                    :model-value="selected"
                    :options="providerOptions"
                    size="sm"
                    :aria-label="row.label"
                    :describedby="[row.describedby, selectedNoKey ? noKeyId : undefined].filter((part) => part !== undefined).join(' ')"
                    :disabled="row.disabled || disabled"
                    data-search-use
                    @update:model-value="(value) => choose(value as WebProviderId)"
                />
            </template>
            <template #below>
                <Collapsible :open="selectedNoKey">
                    <p :id="noKeyId" class="search-settings__hint" data-search-use-no-key>
                        <span class="search-settings__hint-icon i-lucide-triangle-alert" aria-hidden="true" />{{ text("provider.noKey", {provider: noKeyLabel}) }}
                    </p>
                </Collapsible>
                <!-- 改选之后读屏也要听到：提示随内容进出页面，不当播报区用。 -->
                <span class="sr-only" role="status">{{ selectedNoKey ? text("provider.noKey", {provider: noKeyLabel}) : "" }}</span>
            </template>
        </SettingsRow>
        <section
            v-for="provider in WEB_PROVIDERS"
            :key="provider"
            class="search-settings__provider"
            :aria-labelledby="`${id}-${provider}-title`"
            :data-search-provider="provider"
        >
            <h3 :id="`${id}-${provider}-title`" class="search-settings__title">{{ PROVIDER_LABELS[provider] }}</h3>
            <div class="search-settings__form">
                <ApiKeyField
                    :state="keyState(provider)"
                    :service="PROVIDER_LABELS[provider]"
                    :disabled="disabled"
                    :described-by="`${id}-${provider}-note`"
                    @set="(value) => written(provider, store.setKey(provider, value))"
                    @clear="written(provider, store.clearKey(provider))"
                    @pending="(value) => (draftPending[provider] = value)"
                />
                <div class="search-settings__check">
                    <Button
                        size="sm"
                        variant="secondary"
                        :disabled="!canCheck(provider)"
                        :aria-label="text('check.actionFor', {provider: PROVIDER_LABELS[provider]})"
                        data-search-check
                        @click="store.check(provider)"
                    >{{ checking(provider) ? text("check.running") : text("check.action") }}</Button>
                    <span class="search-settings__muted">{{ text("check.cost") }}</span>
                </div>
                <p
                    class="search-settings__result"
                    :class="{'search-settings__result--error': checkFailed(provider)}"
                    role="status"
                    data-search-check-result
                >{{ checkLine(provider) }}<span v-if="checking(provider)" class="sr-only">{{ text("check.running") }}</span></p>
                <p :id="`${id}-${provider}-note`" class="search-settings__muted">{{ text(NOTE_KEYS[provider]) }}</p>
            </div>
        </section>
    </div>
</template>

<style scoped>
.search-settings {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
}

.search-settings__notice {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-ui);
    color: var(--text-secondary);
}

.search-settings__notice--error {
    color: var(--status-danger);
}

.search-settings__title {
    margin: 0 0 var(--space-2);
    padding-bottom: var(--space-4);
    border-bottom: var(--border-w) solid var(--divider);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    line-height: var(--leading-ui);
    color: var(--text-main);
}

/* 标签在上的表单，宽度封顶（同模型设置页的连接一节）。 */
.search-settings__form {
    display: flex;
    max-width: 560px;
    flex-direction: column;
    gap: var(--space-3);
    padding-top: var(--space-2);
}

/* 窄窗口与英文时说明换到按钮下面，不撑出页面。 */
.search-settings__check {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
}

/* 行下的提示自己留上边距（设置行的 below 槽抵掉了行间距，同“网络”页的行下说明）；选中的那家用不了，用警告色。 */
.search-settings__hint {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    margin: 0;
    padding-top: var(--space-3);
    user-select: text;
    color: var(--status-warning);
}

.search-settings__hint-icon {
    width: var(--text-sm);
    height: var(--text-sm);
    flex-shrink: 0;
    margin-top: 2px;
}

.search-settings__muted {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-muted);
}

.search-settings__result {
    margin: 0;
    min-height: calc(var(--text-xs) * var(--leading-ui));
    /* 检测失败的原因要能复制（nb-ui 规范的“文字能否选中”）。 */
    user-select: text;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-secondary);
}

.search-settings__result--error {
    color: var(--status-danger);
}
</style>
