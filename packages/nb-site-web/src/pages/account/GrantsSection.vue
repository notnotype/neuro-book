<script setup lang="ts">
/**
 * 账号页的“已授权的应用”一节（t10 计划 3.12；`site.oauth-provider` 输出 15）：每项授权一行，写客户端名字、给了哪些范围、什么时候给的，
 * 每行可以撤销。列表照服务端给的顺序（给出的先后倒序），不在这里重排。
 *
 * - 给出的时间与“已登录的设备”同一种写法（`recent-time.ts`），只是一小时内写“刚刚”：授权时间是同意那一刻记下的准确时刻，
 *   不像会话的最后使用时间每小时才更新一次。准确时刻放进悬停提示。
 * - 撤销先确认；成功后重取这一份列表。回 `not_found`：别处已经撤销了，或客户端改成了免确认（它的授权不再列出）；写本节状态行并重取。
 */

import type {GrantItem} from "@notnotype/nb-site-identity-contract/constants";
import {AlertDialog, Button} from "@notnotype/nb-ui/components";
import {computed, shallowRef, useTemplateRef} from "vue";

import {useSite} from "../../context";
import {locale} from "../../locale";
import {siteRef, useSiteText} from "../../text";
import {useFormFeedback} from "../form-feedback";
import {accountDate, recentTime} from "../recent-time";
import type {RemoteList} from "./account-lists";
import AccountSection from "./AccountSection.vue";

const props = defineProps<{grants: RemoteList<GrantItem>}>();

const {identity, clock} = useSite();
const t = useSiteText();

const section = useTemplateRef<InstanceType<typeof AccountSection>>("section");
const root = computed(() => section.value?.root ?? null);
const feedback = useFormFeedback<never>(root, clock);
const {status, statusText, statusSpoken} = feedback;

/** 确认对话框开着没有，与要撤销的那一项：分开记，理由同“邀请码”一节（对话框先发 `confirm` 还是先关掉由 reka 定）。 */
const confirmOpen = shallowRef(false);
const confirming = shallowRef<GrantItem>();
const revoking = shallowRef<number>();

const timeFormat = computed(() => new Intl.DateTimeFormat(locale.value, {year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"}));

function grantedAt(iso: string): string {
    const now = clock.now();
    return t("account.apps.granted", {time: recentTime(iso, now, locale.value, t("account.apps.justNow")) ?? accountDate(iso, now, locale.value)});
}

/**
 * 范围逐条分开放：窄屏时在两条之间换行，一条之内不断开（“你是哪一个 NeuroBook 账号”整串不换行时 360 宽放不下）。
 * 分隔符跟在前一条后面，换行不会落在行首的“、”上。
 */
function scopeParts(grant: GrantItem): string[] {
    const join = t("account.apps.scopeJoin");
    return grant.scopes.map((scope, index) => `${t(`account.apps.scopes.${scope}`)}${index < grant.scopes.length - 1 ? join : ""}`);
}

async function reload(): Promise<void> {
    const result = await props.grants.reload();
    if (!result.ok) feedback.showFailure(result.failure);
}

function askRevoke(grant: GrantItem): void {
    confirming.value = grant;
    confirmOpen.value = true;
}

async function revoke(): Promise<void> {
    const grant = confirming.value;
    confirmOpen.value = false;
    if (grant === undefined || revoking.value !== undefined) return;
    revoking.value = grant.id;
    feedback.reset();
    try {
        const result = await identity.revokeGrant(grant.id);
        if (!result.ok) {
            const failure = result.failure;
            if (failure.kind === "code" && failure.code === "not_found" && failure.handled !== true) {
                status.value = {reason: "grant-gone", text: siteRef("account.apps.gone")};
                await reload();
                return;
            }
            feedback.showFailure(failure);
            return;
        }
        await reload();
    } finally {
        revoking.value = undefined;
    }
}
</script>

<template>
    <AccountSection
        id="apps"
        ref="section"
        :title="t('account.apps.title')"
        :status-text="statusText"
        :status-reason="status?.reason"
        :status-spoken="statusSpoken"
    >
        <TransitionGroup name="account-row" tag="ul" class="account-rows">
            <li v-for="grant in props.grants.items.value" :key="grant.id" :data-site-account-grant="grant.id">
                <span class="account-rows__main" data-site-account-grant-client>{{ grant.clientName }}</span>
                <span class="account-rows__meta account-apps__meta">
                    <span class="account-apps__scopes" data-site-account-grant-scopes><span v-for="(part, index) in scopeParts(grant)" :key="index">{{ part }}</span></span>
                    <time :datetime="grant.createdAt" :title="timeFormat.format(new Date(grant.createdAt))" data-site-account-grant-time>{{ grantedAt(grant.createdAt) }}</time>
                </span>
                <span class="account-rows__actions">
                    <Button
                        variant="secondary"
                        size="sm"
                        :disabled="revoking !== undefined"
                        :loading="revoking === grant.id"
                        :aria-label="t('account.apps.revokeNamed', {client: grant.clientName})"
                        data-site-account-grant-revoke
                        @click="askRevoke(grant)"
                    >{{ t("account.apps.revoke") }}</Button>
                </span>
            </li>
            <li v-if="props.grants.items.value.length === 0" key="empty" class="account-apps__empty" data-site-account-grants-empty>{{ t("account.apps.empty") }}</li>
        </TransitionGroup>
        <AlertDialog
            :open="confirmOpen"
            :title="confirming === undefined ? '' : t('account.apps.revokeTitle', {client: confirming.clientName})"
            :description="t('account.apps.revokeDescription')"
            :confirm-label="t('account.apps.revoke')"
            :cancel-label="t('account.cancel')"
            tone="danger"
            @update:open="confirmOpen = $event"
            @confirm="revoke"
        />
    </AccountSection>
</template>

<style scoped>
.account-apps__empty {
    color: var(--text-secondary);
    font-size: var(--text-sm);
}

/* 范围与时间两段之间留一个字宽，窄时整段换行（与“邀请码”一节相同）；时间不断开，范围只在两条之间断开（`scopeParts`）。 */
.account-apps__meta {
    display: inline-flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    column-gap: 1em;
}

.account-apps__meta > time,
.account-apps__scopes > span {
    white-space: nowrap;
}

@media (max-width: 560px) {
    .account-apps__meta {
        justify-content: flex-start;
    }
}
</style>
