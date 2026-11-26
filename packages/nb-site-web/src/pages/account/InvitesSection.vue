<script setup lang="ts">
/**
 * 账号页的“邀请码”一节（t10 计划 3.12；`site.accounts` 输出 18；审定 D10 加“停用”）：每个码一行，写已用次数、可用次数与过期时间，
 * 还能用的可以复制邀请链接（`/register?invite=<码>`，注册页会预填）与停用。
 *
 * - 同时有效的码到了上限（`INVITE_CODE_ACTIVE_LIMIT`）时“生成邀请码”不可用，旁边写原因；没到时写还能生成几个。列表可能是旧的，
 *   服务端仍可能回 `invite_code_limit`：写状态行、重取列表。
 * - 停用不能撤回，先确认。已停用的再停用照样成功（合同），所以回来的那一项直接换上。
 */

import {INVITE_CODE_ACTIVE_LIMIT} from "@notnotype/nb-site-identity-contract/constants";
import type {InviteCodeItem} from "@notnotype/nb-site-identity-contract/constants";
import {AlertDialog, Button, CopyButton} from "@notnotype/nb-ui/components";
import {computed, shallowRef, useTemplateRef} from "vue";

import {useSite} from "../../context";
import {locale} from "../../locale";
import {useSiteText} from "../../text";
import {useFormFeedback} from "../form-feedback";
import type {RemoteList} from "./account-lists";
import AccountSection from "./AccountSection.vue";

const props = defineProps<{invites: RemoteList<InviteCodeItem>}>();

const {identity, clock} = useSite();
const t = useSiteText();

const section = useTemplateRef<InstanceType<typeof AccountSection>>("section");
const root = computed(() => section.value?.root ?? null);
const feedback = useFormFeedback<never>(root, clock);
const {status, statusText, statusSpoken} = feedback;

const generating = shallowRef(false);
/**
 * 确认停用的对话框开着没有，与要停用的那个码。分开记：对话框的“停用”先发 `confirm` 还是先关掉（`update:open`）由 reka 定，
 * 关掉时清掉要停用的码就可能让 `confirm` 扑空。
 */
const confirmOpen = shallowRef(false);
const confirming = shallowRef<InviteCodeItem>();
const disabling = shallowRef<number>();

const usableCount = computed(() => props.invites.items.value.filter((item) => item.usable).length);
const full = computed(() => usableCount.value >= INVITE_CODE_ACTIVE_LIMIT);

const dateFormat = computed(() => new Intl.DateTimeFormat(locale.value, {year: "numeric", month: "numeric", day: "numeric"}));

/** 邀请链接：注册页认 `?invite=` 并预填（`site.accounts` 输出 18）。 */
function inviteLink(item: InviteCodeItem): string {
    return new URL(`/register?invite=${encodeURIComponent(item.code)}`, window.location.origin).href;
}

function usage(item: InviteCodeItem): string {
    return item.maxUses === null ? t("account.invites.used", {count: item.usedCount}) : t("account.invites.usedOf", {count: item.usedCount, max: item.maxUses});
}

async function reload(): Promise<void> {
    const result = await props.invites.reload();
    if (!result.ok) feedback.showFailure(result.failure);
}

async function generate(): Promise<void> {
    if (generating.value || full.value) return;
    generating.value = true;
    feedback.reset();
    try {
        const result = await identity.createInviteCode();
        if (!result.ok) {
            feedback.showFailure(result.failure);
            // 列表旧了（别的标签页刚生成过）：重取，按钮跟着变成不可用。
            if (result.failure.kind === "code" && result.failure.code === "invite_code_limit") await props.invites.reload();
            return;
        }
        await reload();
    } finally {
        generating.value = false;
    }
}

function askDisable(item: InviteCodeItem): void {
    confirming.value = item;
    confirmOpen.value = true;
}

async function disable(): Promise<void> {
    const item = confirming.value;
    confirmOpen.value = false;
    if (item === undefined || disabling.value !== undefined) return;
    disabling.value = item.id;
    feedback.reset();
    try {
        const result = await identity.disableInviteCode(item.id);
        if (!result.ok) {
            feedback.showFailure(result.failure);
            if (result.failure.kind === "code" && result.failure.code === "not_found") await props.invites.reload();
            return;
        }
        await reload();
    } finally {
        disabling.value = undefined;
    }
}
</script>

<template>
    <AccountSection
        id="invites"
        ref="section"
        :title="t('account.invites.title')"
        :status-text="statusText"
        :status-reason="status?.reason"
        :status-spoken="statusSpoken"
        :status-tone="status?.tone === 'success' ? 'success' : 'danger'"
    >
        <TransitionGroup name="account-row" tag="ul" class="account-rows">
            <li v-for="item in props.invites.items.value" :key="item.id" :data-site-account-invite="item.code" :data-site-account-invite-usable="item.usable ? 'true' : 'false'">
                <span class="account-rows__main account-code">{{ item.code }}</span>
                <span class="account-rows__meta account-invites__meta">
                    <template v-if="item.usable">
                        <span>{{ usage(item) }}</span>
                        <time v-if="item.expiresAt !== null" :datetime="item.expiresAt">{{ t("account.invites.expires", {time: dateFormat.format(new Date(item.expiresAt))}) }}</time>
                    </template>
                    <span v-else>{{ t("account.invites.unusable") }}</span>
                </span>
                <span v-if="item.usable" class="account-rows__actions">
                    <CopyButton :text="inviteLink(item)" :label="t('account.invites.copy')" data-site-account-invite-copy />
                    <Button variant="secondary" size="sm" :disabled="disabling !== undefined" :loading="disabling === item.id" data-site-account-invite-disable @click="askDisable(item)">{{ t("account.invites.disable") }}</Button>
                </span>
            </li>
            <li v-if="props.invites.items.value.length === 0" key="empty" class="account-invites__empty">{{ t("account.invites.empty") }}</li>
        </TransitionGroup>
        <template #actions>
            <Button variant="secondary" :disabled="full || generating" :loading="generating" aria-describedby="account-invites-quota" data-site-account-invite-generate @click="generate">{{ t("account.invites.generate") }}</Button>
            <span id="account-invites-quota" class="account-invites__quota" data-site-account-invite-quota>{{
                full ? t("account.invites.full", {limit: INVITE_CODE_ACTIVE_LIMIT}) : t("account.invites.remaining", {count: INVITE_CODE_ACTIVE_LIMIT - usableCount})
            }}</span>
        </template>
        <AlertDialog
            :open="confirmOpen"
            :title="confirming === undefined ? '' : t('account.invites.disableTitle', {code: confirming.code})"
            :description="t('account.invites.disableDescription')"
            :confirm-label="t('account.invites.disable')"
            :cancel-label="t('account.cancel')"
            tone="danger"
            @update:open="confirmOpen = $event"
            @confirm="disable"
        />
    </AccountSection>
</template>

<style scoped>
.account-invites__empty {
    color: var(--text-muted);
    font-size: var(--text-sm);
}

/* 两段说明之间留一个字宽，窄时整段换行，不在一段中间断开。 */
.account-invites__meta {
    display: inline-flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    column-gap: 1em;
}

.account-invites__meta > * {
    white-space: nowrap;
}

@media (max-width: 560px) {
    .account-invites__meta {
        justify-content: flex-start;
    }
}

.account-invites__quota {
    min-width: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
}
</style>
