<script setup lang="ts">
import {Button} from "@notnotype/nb-ui/components";
import {computed, onMounted, useId} from "vue";

import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";

import type {SearchStore, WebFailure} from "../search-store";
import {failureReason, useWebText} from "../text";
import ApiKeyField from "./ApiKeyField.vue";

/**
 * 设置窗口的“搜索与网页”页（docs/specs/web/settings-page.md）。数据与写入在数据模块里，这里只读状态、调方法，写失败交给窗口
 * 通知。第一版只有 DeepSeek 一节；以后加服务时多一节，版式不变。
 */
const props = defineProps<{
    store: SearchStore;
    writable: boolean;
    reportWriteFailure: SettingsPageContext["reportWriteFailure"];
}>();

const text = useWebText();
const id = useId();
const provider = "deepseek" as const;
const label = computed(() => text("deepseek.title"));

onMounted(() => void props.store.start());

const disabled = computed(() => !props.store.available.value || !props.writable);
const keyState = computed(() => {
    const status = props.store.status.value;
    // 没取到状态时不说“未设置”（输出 2）；只有密钥文件读不了时按未设置画：在这里写入会覆盖它。
    if (status === null) return props.store.statusFailure.value?.code === "credentials-unavailable" ? ("unset" as const) : ("loading" as const);
    return status.providers.deepseek.hasKey ? ("set" as const) : ("unset" as const);
});
const keysUnreadable = computed(() => props.store.statusFailure.value?.code === "credentials-unavailable");
const check = computed(() => props.store.checks.get(provider));
const checking = computed(() => check.value?.status === "running");

const formatTime = (at: number): string => new Date(at).toLocaleTimeString(undefined, {hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false});
const checkLine = computed(() => {
    const state = check.value;
    if (state === undefined || state.status === "running") return "";
    if (state.status === "error") return text("check.notRun", {reason: failureReason(text, state.failure)});
    if (state.result.ok) return text("check.passed", {time: formatTime(state.at)});
    return text("check.failed", {reason: failureReason(text, {code: state.result.code, detail: state.result.detail})});
});
const checkFailed = computed(() => check.value !== undefined && check.value.status !== "running" && !(check.value.status === "done" && check.value.result.ok));

async function written(result: Promise<{readonly ok: true} | {readonly ok: false; readonly failure: WebFailure}>): Promise<void> {
    const outcome = await result;
    if (outcome.ok) return;
    const reason = `${failureReason(text, outcome.failure)}；${text("failure.retry")}`;
    props.reportWriteFailure(text("subject.key", {provider: label.value}), {reason, uncertain: outcome.failure.code === "unknown-outcome"});
}
</script>

<template>
    <div class="search-settings" data-search-settings>
        <p v-if="!store.available.value" class="search-settings__notice" role="status" data-search-readonly>{{ text("readOnly") }}</p>
        <p v-else-if="keysUnreadable" class="search-settings__notice search-settings__notice--error" role="alert" data-search-keys-unreadable>{{ text("keysUnreadable") }}</p>
        <section class="search-settings__provider" :aria-labelledby="`${id}-title`" data-search-provider="deepseek">
            <h3 :id="`${id}-title`" class="search-settings__title">{{ label }}</h3>
            <div class="search-settings__form">
                <ApiKeyField
                    :state="keyState"
                    :disabled="disabled"
                    :described-by="`${id}-note`"
                    @set="(value) => written(store.setKey(provider, value))"
                    @clear="written(store.clearKey(provider))"
                />
                <div class="search-settings__check">
                    <Button
                        size="sm"
                        variant="secondary"
                        :disabled="disabled || keyState !== 'set' || checking"
                        :aria-label="text('check.actionFor', {provider: label})"
                        data-search-check
                        @click="store.check(provider)"
                    >{{ checking ? text("check.running") : text("check.action") }}</Button>
                    <span class="search-settings__muted">{{ text("check.cost") }}</span>
                </div>
                <p
                    class="search-settings__result"
                    :class="{'search-settings__result--error': checkFailed}"
                    role="status"
                    data-search-check-result
                >{{ checkLine }}</p>
                <p :id="`${id}-note`" class="search-settings__muted">{{ text("deepseek.note") }}</p>
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
