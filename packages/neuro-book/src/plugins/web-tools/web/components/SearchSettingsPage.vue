<script setup lang="ts">
import {Badge, Button, Collapsible, NumberInput, SegmentedControl, Select, TagInput, Input} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {computed, nextTick, onMounted, reactive, ref, useId, watch} from "vue";

import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import type {SettingDefinition, SettingsFailure, SettingsService} from "nbook/shared/settings";
import ProviderLogo from "nbook/ui/provider-icons/ProviderLogo.vue";
import {settingsFailureText} from "nbook/ui/settings/setting-text";
import SettingsRow from "nbook/ui/settings/SettingsRow.vue";

import {PROVIDER_LABELS, WEB_PROVIDERS} from "../../shared/contracts";
import type {WebProviderId} from "../../shared/contracts";
import {MAX_BLOCKED_SITES, RESULT_COUNT_MAX, RESULT_COUNT_MIN, webSettings} from "../../shared/settings";
import {normalizeSite} from "../../shared/sites";
import type {SearchStore, WebFailure} from "../search-store";
import {failureReason, useWebText} from "../text";
import ApiKeyField from "./ApiKeyField.vue";

/**
 * 设置窗口的“搜索与网页”页（docs/specs/web/settings-page.md）：左栏是“搜索规则”与各家服务商，右边是选中项的详情；页面宽不到
 * 600px 时左栏换成顶上的下拉（同“服务商与模型”页）。密钥与检测在数据模块里，各设置项经传入的配置服务读写用户层，写失败都交给
 * 窗口通知。
 *
 * “等着启用”（输出 11）只在页面里：点了一家没密钥的“设为使用中”而使用中的那家能用时，记下这家、把焦点放进它的密钥框，等这家的
 * 密钥写入成功再写设置；换选别的项、清除这家的密钥时作废，页面卸载时随之丢掉。
 *
 * 动效：“高级”的展开收起经 `Collapsible`（高度与透明度）；详情换内容时淡入淡出（`--motion-base`）。
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
const {provider: providerSetting, resultCount, blockedSites, tavilySearchDepth, deepseekBaseUrl, tavilyBaseUrl} = webSettings.settings;
const BASE_URLS: Readonly<Record<WebProviderId, SettingDefinition<string>>> = {deepseek: deepseekBaseUrl, tavily: tavilyBaseUrl};

type Item = "rules" | WebProviderId;

onMounted(() => void props.store.start());

const disabled = computed(() => !props.store.available.value || !props.writable);
const keysUnreadable = computed(() => props.store.statusFailure.value?.code === "credentials-unavailable");

function keyState(provider: WebProviderId): "loading" | "set" | "unset" {
    const status = props.store.status.value;
    // 没取到状态时不说“未设置”（输出 2）；只有密钥文件读不了时按未设置画：在这里写入会覆盖它。
    if (status === null) return keysUnreadable.value ? "unset" : "loading";
    return status.providers[provider].hasKey ? "set" : "unset";
}

// ---- 左栏与选中项 ----
const using = computed(() => props.settings.get(providerSetting));
/** 第一次显示时选中使用中的那家（输出 1）。 */
const current = ref<Item>(using.value);
/** 等着启用的那家（输出 11）；不在等时为 null。 */
const pending = ref<WebProviderId | null>(null);
const items = computed<readonly Item[]>(() => ["rules", ...WEB_PROVIDERS]);

function select(item: Item): void {
    if (item === current.value) return;
    current.value = item;
    pending.value = null;
}

/** 左栏的行尾一格：只在出问题时有图标（输出 11）。 */
function flag(provider: WebProviderId): {readonly icon: string; readonly tone: "danger" | "warning"; readonly text: string} | null {
    const check = props.store.checks.get(provider);
    if (check?.status === "done" && !check.result.ok) return {icon: "i-lucide-circle-alert", tone: "danger", text: text("status.checkFailed")};
    if (provider === using.value && keyState(provider) === "unset") return {icon: "i-lucide-key-round", tone: "warning", text: text("status.noKey")};
    return null;
}
/** 这一行的读屏描述：使用中与状态图标都只是画出来的，另写成文字。 */
const rowDescription = (provider: WebProviderId): string => [provider === using.value ? text("use.badge") : null, flag(provider)?.text ?? null].filter((part) => part !== null).join(text("status.joiner"));

const rail = ref<HTMLElement | null>(null);
function onRailKeydown(event: KeyboardEvent): void {
    const index = items.value.indexOf(current.value);
    const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? items.value.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const item = items.value[Math.max(0, Math.min(items.value.length - 1, next))]!;
    select(item);
    void nextTick(() => rail.value?.querySelector<HTMLElement>(`[data-search-rail-item="${item}"]`)?.focus());
}

/** 窄布局的下拉：选项是“搜索规则”与各家，使用中的那家写明。 */
const pickerOptions = computed(() => [
    {value: "rules", label: text("rules.title"), iconClass: "i-lucide-sliders-horizontal"},
    ...WEB_PROVIDERS.map((provider) => ({value: provider, label: provider === using.value ? text("use.inUse", {name: PROVIDER_LABELS[provider]}) : PROVIDER_LABELS[provider]})),
]);

// ---- 写设置 ----
function reportSettingFailure(subject: string, code: SettingsFailure, detail: string): void {
    props.reportWriteFailure(subject, {reason: settingsFailureText(code, detail, port), uncertain: code === "unknown-outcome"});
}
async function write<T>(setting: SettingDefinition<T>, subject: string, value: T | undefined): Promise<boolean> {
    const result = await props.settings.update(setting, value as never, {layer: "user"});
    if (!result.ok) reportSettingFailure(subject, result.code, result.detail);
    return result.ok;
}
const settingTitle = (setting: SettingDefinition<unknown>): string => {
    const title = props.settings.declaration(setting)?.title;
    return title === undefined ? setting.key : port.t(title);
};

// ---- 使用哪家（输出 11） ----
const keyFields = reactive<Partial<Record<WebProviderId, {focus(): void} | null>>>({});

async function makeUsing(provider: WebProviderId): Promise<void> {
    if (keyState(provider) !== "set" && keyState(using.value) === "set") {
        pending.value = provider;
        await nextTick();
        keyFields[provider]?.focus();
        return;
    }
    pending.value = null;
    // 写成后按钮换成徽标、焦点会丢：放回左栏这一行（读屏念出“使用中”）。
    if (await write(providerSetting, text("settings.provider.title"), provider)) {
        await nextTick();
        rail.value?.querySelector<HTMLElement>(`[data-search-rail-item="${provider}"]`)?.focus();
    }
}

// ---- 每家的密钥与检测 ----
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

/** 密钥行右边的状态字：等着启用时写怎么启用；使用中却没有密钥时写“未填写”（输出 11）。 */
function keyNotice(provider: WebProviderId): string | undefined {
    if (pending.value === provider) return text("key.pendingUse");
    if (provider === using.value && keyState(provider) === "unset") return text("key.missing");
    return undefined;
}

async function written(provider: WebProviderId, action: "set" | "clear", result: Promise<{readonly ok: true} | {readonly ok: false; readonly failure: WebFailure}>): Promise<void> {
    const outcome = await result;
    if (outcome.ok) {
        if (pending.value !== provider) return;
        pending.value = null;
        // 等着启用的那家有了密钥：替人把它设成使用中（输出 11）；清除了它的密钥则等待作废。
        if (action === "set") await write(providerSetting, text("settings.provider.title"), provider);
        return;
    }
    const label = PROVIDER_LABELS[provider];
    const reason = text("writeFailed", {reason: failureReason(text, outcome.failure, label)});
    props.reportWriteFailure(text("subject.key", {provider: label}), {reason, uncertain: outcome.failure.code === "unknown-outcome"});
}

// ---- 高级（输出 13） ----
const ADVANCED: Readonly<Record<WebProviderId, readonly SettingDefinition<unknown>[]>> = {deepseek: [deepseekBaseUrl], tavily: [tavilyBaseUrl, tavilySearchDepth]};
/** 用户层里这一项写了的值；没写、层不可用时为 undefined。 */
function userValue<T>(setting: SettingDefinition<T>): unknown {
    const layer = props.settings.inspect(setting).user;
    return layer.status === "ok" || layer.status === "invalid" ? layer.value : undefined;
}
const changedInUser = (setting: SettingDefinition<unknown>): boolean => userValue(setting) !== undefined;
/** 有改过的高级项时默认展开；之后按用户的开合。 */
const advancedOpen = reactive<Record<WebProviderId, boolean>>({
    deepseek: ADVANCED.deepseek.some(changedInUser),
    tavily: ADVANCED.tavily.some(changedInUser),
});

/** 接口地址要能解析成 http 或 https 网址、带主机、不含空白（输出 13）。 */
function isHttpUrl(value: string): boolean {
    if (/\s/u.test(value)) return false;
    try {
        const url = new URL(value);
        return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
    } catch {
        return false;
    }
}

/** 接口地址框里的草稿：改过、还没交出去时不被设置的变化打断；失焦或回车时交出。 */
const urlDrafts = reactive<Record<WebProviderId, string | null>>({deepseek: null, tavily: null});
const urlProblems = reactive<Record<WebProviderId, string>>({deepseek: "", tavily: ""});
const urlValue = (provider: WebProviderId): string => urlDrafts[provider] ?? (userValue(BASE_URLS[provider]) as string | undefined) ?? "";
function commitUrl(provider: WebProviderId): void {
    const draft = urlDrafts[provider];
    if (draft === null) return;
    const value = draft.trim();
    if (value !== "" && !isHttpUrl(value)) {
        urlProblems[provider] = text("advanced.urlInvalid");
        return;
    }
    urlProblems[provider] = "";
    urlDrafts[provider] = null;
    // 清空：去掉用户层的值，回到缺省地址。
    void write(BASE_URLS[provider], settingTitle(BASE_URLS[provider]), value === "" ? undefined : value);
}
const depthOptions = computed(() => [
    {value: "basic", label: text("settings.tavilySearchDepth.choices.basic.title")},
    {value: "advanced", label: text("settings.tavilySearchDepth.choices.advanced.title")},
]);

// ---- 搜索规则（输出 12） ----
const countDraft = ref<string | null>(null);
const countProblem = ref("");
const countValue = computed(() => countDraft.value ?? String(props.settings.get(resultCount)));
function editCount(value: string): void {
    countDraft.value = value;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < RESULT_COUNT_MIN || parsed > RESULT_COUNT_MAX) {
        countProblem.value = text("rules.countInvalid", {min: RESULT_COUNT_MIN, max: RESULT_COUNT_MAX});
        return;
    }
    countProblem.value = "";
    void write(resultCount, settingTitle(resultCount), parsed).then(() => {
        if (countDraft.value === value) countDraft.value = null;
    });
}

const blockedProblem = ref("");
const blocked = computed(() => props.settings.get(blockedSites));
/**
 * 标签输入交来的整串：一项里有空白（粘贴了几行或几个空格隔开的域名）时先拆开，再逐项归一化（shared/sites.ts）。有一项不像域名、
 * 或多于上限时原位提示、整串不写（输出 12）。
 */
function editBlocked(values: readonly string[]): void {
    const next: string[] = [];
    for (const value of values.flatMap((item) => item.split(/\s+/u)).filter((item) => item !== "")) {
        const site = normalizeSite(value);
        if (site === null) {
            blockedProblem.value = text("rules.blockedInvalid", {value});
            return;
        }
        if (!next.includes(site)) next.push(site);
    }
    if (next.length > MAX_BLOCKED_SITES) {
        blockedProblem.value = text("rules.blockedTooMany", {max: MAX_BLOCKED_SITES});
        return;
    }
    blockedProblem.value = "";
    void write(blockedSites, settingTitle(blockedSites), next);
}

/**
 * 粘贴几行：单行输入框会把换行直接去掉（`a.com⏎b.com` 变成 `a.comb.com`），所以在粘贴时先拿剪贴板原文按空白拆开，自己加进去；
 * 不含空白的照常交给标签输入（它按逗号、顿号拆）。
 */
function pasteBlocked(event: ClipboardEvent): void {
    const pasted = event.clipboardData?.getData("text/plain") ?? "";
    if (!/\s/u.test(pasted.trim())) return;
    event.preventDefault();
    editBlocked([...blocked.value, ...pasted.split(/[\s,，、]+/u)]);
}

// 换了选中项：草稿与原位提示不跨项留。
watch(current, () => {
    for (const provider of WEB_PROVIDERS) {
        urlDrafts[provider] = null;
        urlProblems[provider] = "";
    }
    countDraft.value = null;
    countProblem.value = "";
    blockedProblem.value = "";
});
// 设置的值从别处变了（设置行的“恢复默认”、设置文件、另一个窗口）：框里的草稿与原位提示作废，跟着新值。
watch(() => props.settings.get(resultCount), () => {
    countDraft.value = null;
    countProblem.value = "";
});
// 屏蔽网站没写成的输入在标签输入自己手里，跟着新值的是标签；这里只清原位提示。拼成串比较：取值可能每次是新数组。
watch(() => props.settings.get(blockedSites).join("\n"), () => {
    blockedProblem.value = "";
});
watch(() => WEB_PROVIDERS.map((provider) => props.settings.get(BASE_URLS[provider])).join("\n"), () => {
    for (const provider of WEB_PROVIDERS) {
        urlDrafts[provider] = null;
        urlProblems[provider] = "";
    }
});
</script>

<template>
    <div class="search-settings" data-search-settings>
        <p v-if="!store.available.value" class="search-settings__notice" role="status" data-search-readonly>{{ text("readOnly") }}</p>
        <p v-else-if="keysUnreadable" class="search-settings__notice search-settings__notice--error" role="alert" data-search-keys-unreadable>{{ text("keysUnreadable") }}</p>
        <div class="search-settings__body">
            <nav ref="rail" class="search-settings__rail" :aria-label="text('rail.label')" data-search-rail @keydown="onRailKeydown">
                <button
                    type="button"
                    class="search-settings__item nb-ui-focus-ring-inset"
                    :aria-current="current === 'rules' ? 'page' : undefined"
                    :aria-describedby="blocked.length > 0 ? `${id}-rules-row` : undefined"
                    :tabindex="current === 'rules' ? 0 : -1"
                    data-search-rail-item="rules"
                    @click="select('rules')"
                >
                    <span class="i-lucide-sliders-horizontal search-settings__item-icon" aria-hidden="true" />
                    <!-- 这一行不会有“使用中”：名称占掉那一格，行尾的计数仍与各家的状态格同列。 -->
                    <span class="search-settings__item-name">{{ text("rules.title") }}</span>
                    <span class="search-settings__item-end search-settings__count" aria-hidden="true">{{ blocked.length > 0 ? blocked.length : "" }}</span>
                    <span v-if="blocked.length > 0" :id="`${id}-rules-row`" hidden>{{ text("rules.blockedCount", {count: blocked.length}) }}</span>
                </button>
                <div class="search-settings__divider" />
                <button
                    v-for="provider in WEB_PROVIDERS"
                    :key="provider"
                    type="button"
                    class="search-settings__item nb-ui-focus-ring-inset"
                    :aria-current="current === provider ? 'page' : undefined"
                    :aria-describedby="rowDescription(provider) === '' ? undefined : `${id}-${provider}-row`"
                    :tabindex="current === provider ? 0 : -1"
                    :title="flag(provider)?.text"
                    :data-search-rail-item="provider"
                    @click="select(provider)"
                >
                    <ProviderLogo :id="provider" :name="PROVIDER_LABELS[provider]" :size="16" />
                    <span class="search-settings__item-name">{{ PROVIDER_LABELS[provider] }}</span>
                    <span class="search-settings__item-use"><Badge v-if="provider === using" size="sm" tone="accent" variant="soft" data-search-in-use>{{ text("use.badge") }}</Badge></span>
                    <span class="search-settings__item-end" aria-hidden="true"><span v-if="flag(provider) !== null" :class="[flag(provider)!.icon, `search-settings__flag--${flag(provider)!.tone}`]" class="search-settings__flag" :data-search-flag="flag(provider)!.tone" /></span>
                    <span :id="`${id}-${provider}-row`" hidden>{{ rowDescription(provider) }}</span>
                </button>
            </nav>

            <div class="search-settings__detail">
                <!-- 包一层控制显隐：Select 的根不是触发器，作用域样式挂不到它身上（同“服务商与模型”页）。 -->
                <div class="search-settings__picker">
                    <Select
                        class="search-settings__picker-select"
                        :model-value="current"
                        :options="pickerOptions"
                        :aria-label="text('rail.label')"
                        data-search-picker
                        @update:model-value="(value) => select(value as Item)"
                    />
                </div>
                <Transition name="search-settings-swap" mode="out-in">
                    <section v-if="current === 'rules'" key="rules" class="search-settings__pane" :aria-labelledby="`${id}-rules-title`" data-search-detail="rules">
                        <header class="search-settings__header">
                            <span class="i-lucide-sliders-horizontal search-settings__header-icon" aria-hidden="true" />
                            <h3 :id="`${id}-rules-title`" class="search-settings__title">{{ text("rules.title") }}</h3>
                        </header>
                        <div class="search-settings__rows">
                            <SettingsRow :settings="settings" :setting="resultCount" layer="user">
                                <template #default="row">
                                    <NumberInput
                                        :id="row.id"
                                        class="search-settings__number"
                                        :model-value="countValue"
                                        :min="String(RESULT_COUNT_MIN)"
                                        :max="String(RESULT_COUNT_MAX)"
                                        :invalid="countProblem !== ''"
                                        :disabled="row.disabled || disabled"
                                        :aria-describedby="row.describedby"
                                        data-search-count
                                        @update:model-value="editCount"
                                    />
                                </template>
                                <template #below>
                                    <p v-if="countProblem !== ''" class="search-settings__problem" role="alert">{{ countProblem }}</p>
                                </template>
                            </SettingsRow>
                            <SettingsRow :settings="settings" :setting="blockedSites" layer="user" wide>
                                <template #default="row">
                                    <div class="search-settings__blocked" @paste.capture="pasteBlocked">
                                        <TagInput
                                            :id="row.id"
                                            :model-value="[...blocked]"
                                            :placeholder="text('rules.blockedPlaceholder')"
                                            :invalid="blockedProblem !== ''"
                                            :disabled="row.disabled || disabled"
                                            :aria-describedby="row.describedby"
                                            data-search-blocked
                                            @update:model-value="editBlocked"
                                        />
                                    </div>
                                </template>
                                <template #below>
                                    <p v-if="blockedProblem !== ''" class="search-settings__problem" role="alert">{{ blockedProblem }}</p>
                                </template>
                            </SettingsRow>
                        </div>
                    </section>

                    <section v-else :key="current" class="search-settings__pane" :aria-labelledby="`${id}-${current}-title`" :data-search-detail="current">
                        <header class="search-settings__header">
                            <ProviderLogo :id="current" :name="PROVIDER_LABELS[current]" :size="28" />
                            <h3 :id="`${id}-${current}-title`" class="search-settings__title">{{ PROVIDER_LABELS[current] }}</h3>
                            <span class="search-settings__header-end">
                                <Badge v-if="current === using" tone="accent" variant="soft" icon-class="i-lucide-check" data-search-in-use>{{ text("use.badge") }}</Badge>
                                <Button v-else size="sm" variant="secondary" :disabled="disabled" data-search-use-action @click="makeUsing(current)">{{ text("use.action") }}</Button>
                            </span>
                        </header>
                        <div class="search-settings__rows">
                            <ApiKeyField
                                :ref="(field) => (keyFields[current as WebProviderId] = field as {focus(): void} | null)"
                                :state="keyState(current)"
                                :service="PROVIDER_LABELS[current]"
                                :disabled="disabled"
                                :tip="current === 'deepseek' ? text('key.deepseekTip') : undefined"
                                :notice="keyNotice(current)"
                                @set="(value) => written(current as WebProviderId, 'set', store.setKey(current as WebProviderId, value))"
                                @clear="written(current as WebProviderId, 'clear', store.clearKey(current as WebProviderId))"
                                @pending="(value) => (draftPending[current as WebProviderId] = value)"
                            />
                            <div class="search-settings__check">
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    :disabled="!canCheck(current)"
                                    :aria-label="text('check.actionFor', {provider: PROVIDER_LABELS[current]})"
                                    data-search-check
                                    @click="store.check(current)"
                                >{{ checking(current) ? text("check.running") : text("check.action") }}</Button>
                                <span class="search-settings__muted">{{ text("check.cost") }}</span>
                            </div>
                            <p
                                class="search-settings__result"
                                :class="{'search-settings__result--error': checkFailed(current)}"
                                role="status"
                                data-search-check-result
                            >{{ checkLine(current) }}<span v-if="checking(current)" class="sr-only">{{ text("check.running") }}</span></p>
                            <Collapsible :open="advancedOpen[current]">
                                <template #trigger>
                                    <button
                                        type="button"
                                        class="search-settings__advanced nb-ui-focus-ring"
                                        :aria-expanded="advancedOpen[current]"
                                        data-search-advanced
                                        @click="advancedOpen[current] = !advancedOpen[current]"
                                    >
                                        <span class="i-lucide-chevron-right search-settings__chevron" :class="{'is-open': advancedOpen[current]}" aria-hidden="true" />
                                        {{ text("advanced.title") }}
                                        <span class="search-settings__muted">{{ current === "tavily" ? text("advanced.summary.tavily") : text("advanced.summary.deepseek") }}</span>
                                    </button>
                                </template>
                                <div class="search-settings__advanced-body">
                                    <SettingsRow :settings="settings" :setting="BASE_URLS[current]" layer="user" wide>
                                        <template #default="row">
                                            <Input
                                                :id="row.id"
                                                size="sm"
                                                :model-value="urlValue(current)"
                                                :placeholder="String(props.settings.inspect(BASE_URLS[current]).default)"
                                                :invalid="urlProblems[current] !== ''"
                                                :disabled="row.disabled || disabled"
                                                :aria-describedby="row.describedby"
                                                data-search-base-url
                                                @update:model-value="(value) => (urlDrafts[current as WebProviderId] = value)"
                                                @keydown.enter="commitUrl(current)"
                                                @focusout="commitUrl(current)"
                                            />
                                        </template>
                                        <template #below>
                                            <p v-if="urlProblems[current] !== ''" class="search-settings__problem" role="alert">{{ urlProblems[current] }}</p>
                                        </template>
                                    </SettingsRow>
                                    <SettingsRow v-if="current === 'tavily'" :settings="settings" :setting="tavilySearchDepth" layer="user">
                                        <template #default="row">
                                            <SegmentedControl
                                                :model-value="row.value as string"
                                                :options="depthOptions"
                                                size="sm"
                                                :aria-label="row.label"
                                                :disabled="row.disabled || disabled"
                                                data-search-depth
                                                @update:model-value="(value) => write(tavilySearchDepth, row.label, value as 'basic' | 'advanced')"
                                            />
                                        </template>
                                    </SettingsRow>
                                </div>
                            </Collapsible>
                        </div>
                    </section>
                </Transition>
            </div>
        </div>
    </div>
</template>

<style scoped>
.search-settings {
    display: flex;
    height: 100%;
    min-height: 0;
    flex-direction: column;
    gap: var(--space-3);
    container-type: inline-size;
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

.search-settings__body {
    display: flex;
    min-height: 0;
    flex: 1;
}

/* 左栏同“服务商与模型”页：定宽、不随详情滚动，行高同设置窗口左栏；比那边宽一些，多了“使用中”一格。 */
.search-settings__rail {
    display: flex;
    width: 200px;
    flex-shrink: 0;
    flex-direction: column;
    gap: 2px;
    padding: 0 var(--space-3) var(--space-2) var(--space-2);
    overflow-y: auto;
    border-right: var(--border-w) solid var(--divider);
}

.search-settings__divider {
    height: var(--border-w);
    margin: var(--space-1) var(--space-3);
    background: var(--divider);
}

.search-settings__item {
    display: flex;
    width: 100%;
    min-height: var(--control-h-sm);
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-1) 0 var(--space-3);
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: inherit;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
}

/* 设置窗口是玻璃面：悬停与当前项用半透明叠色，同窗口左栏。 */
.search-settings__item:hover {
    background: color-mix(in srgb, var(--text-main) 6%, transparent);
}

.search-settings__item[aria-current="page"] {
    background: var(--overlay-item-active);
}

.search-settings__item-icon {
    width: 16px;
    height: 16px;
    flex: none;
    color: var(--text-secondary);
}

.search-settings__item-name {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

/* 定宽两格：“使用中”一列、问题图标一列，名称不随状态挪动（同种零件同列）。 */
.search-settings__item-use {
    display: inline-flex;
    width: 46px;
    flex-shrink: 0;
    justify-content: flex-end;
}

.search-settings__item-end {
    display: inline-flex;
    width: 18px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
}

.search-settings__count {
    color: var(--text-muted);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
}

.search-settings__flag {
    display: block;
    width: 14px;
    height: 14px;
}

.search-settings__flag--warning {
    color: var(--status-warning);
}

.search-settings__flag--danger {
    color: var(--status-danger);
}

/* 自己纵向滚动；上边与右边留出焦点环的位置，贴边的“清除”、输入框与恢复默认的焦点环不被裁掉。 */
.search-settings__detail {
    min-width: 0;
    flex: 1;
    overflow-y: auto;
    padding: var(--space-2) var(--space-2) var(--space-5) var(--space-5);
}

.search-settings__picker {
    display: none;
}

.search-settings__pane {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.search-settings__header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding-bottom: var(--space-3);
    border-bottom: var(--border-w) solid var(--divider);
}

.search-settings__header-icon {
    width: 24px;
    height: 24px;
    color: var(--text-secondary);
}

.search-settings__title {
    margin: 0;
    flex: 1;
    font-size: var(--text-md);
    font-weight: var(--weight-strong);
    line-height: var(--leading-ui);
}

/* 徽标与按钮在同一格里互换：宽度按按钮定，换的时候标题不挪。 */
.search-settings__header-end {
    display: inline-flex;
    min-width: 96px;
    justify-content: flex-end;
}

/* 标签在上的表单，宽度封顶（同模型页的连接一节）。 */
.search-settings__rows {
    display: flex;
    max-width: 560px;
    flex-direction: column;
    gap: var(--space-4);
}

.search-settings__blocked {
    width: 100%;
}

.search-settings__number {
    width: 120px;
}

.search-settings__check {
    display: flex;
    align-items: center;
    gap: var(--space-3);
}

.search-settings__muted {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-muted);
}

/* 检测结果在按钮下面预留的一行：没有结果时这一行照样空着，出现与消失不推动下面的“高级”；原因长时折行，全文看得到（输出 8）。 */
.search-settings__result {
    min-height: calc(var(--text-xs) * var(--leading-ui));
    margin: calc(-1 * var(--space-3)) 0 0;
    /* 检测失败的原因要能复制（nb-ui 规范的“文字能否选中”）。 */
    user-select: text;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-secondary);
}

.search-settings__result--error {
    color: var(--status-danger);
}

.search-settings__advanced {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-main);
    font-size: var(--text-sm);
    cursor: pointer;
}

.search-settings__chevron {
    width: 14px;
    height: 14px;
    transition: transform var(--motion-fast) var(--ease-layout);
}

.search-settings__chevron.is-open {
    transform: rotate(90deg);
}

.search-settings__advanced-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3) 0 0 var(--space-5);
}

.search-settings__problem {
    margin: 0;
    padding-top: var(--space-2);
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--status-danger);
}

.search-settings-swap-enter-active,
.search-settings-swap-leave-active {
    transition: opacity var(--motion-base) var(--ease-layout);
}

.search-settings-swap-enter-from,
.search-settings-swap-leave-to {
    opacity: 0;
}

/* 页面不到 600px：左栏收成顶上的下拉（输出 1，同“服务商与模型”页）。 */
@container (max-width: 600px) {
    .search-settings__rail {
        display: none;
    }

    .search-settings__detail {
        padding-left: var(--space-2);
    }

    .search-settings__picker {
        display: flex;
        margin-bottom: var(--space-4);
    }

    .search-settings__picker > :first-child {
        flex: 1;
    }
}
</style>
