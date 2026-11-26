<script setup lang="ts">
/**
 * 账号页的“登录与安全”一节（t10 计划 3.12；`site.accounts` 输出 9、15、16、24）：密码一行，与每个上游一行。
 *
 * - 密码一行写“已设置”或“没有设置”；按钮是“修改密码”或“设置密码”，开 `PasswordDialog`。设好之后别的会话已被结束（输出 9），
 *   发 `password-changed` 让账号页重取设备列表。
 * - 上游一行：关联了的写上游账号的名字（输出 24），可以解绑；没关联的写“没有关联”，可以关联。没开放的上游（`meta`）没关联时不列出：
 *   列出来也关联不了；已关联的照样列出，好让他解绑。
 * - 关联：有密码的账号先在 `LinkDialog` 里填当前密码，没有密码的直接发起（输出 15）。上游带着 `social_error` 回来时，账号页把码交给
 *   这一节（`socialError`），写在这一节的状态行。
 * - 解绑回 `last_login_method`（输出 16）：状态行写“先设一个密码再解绑”，焦点给密码那一行的按钮，下一步就在那里。回 `not_found`
 *   （那个关联已经不在了，输出 24）：状态行写明，重取列表。
 */

import type {IdentityItem, MeResponse, MetaResponse, SocialProvider} from "@notnotype/nb-site-identity-contract/constants";
import {Button} from "@notnotype/nb-ui/components";
import {computed, nextTick, shallowRef, useTemplateRef, watch} from "vue";

import type {Failure} from "../../http/core";
import {socialErrorText} from "../../http/failure-text";
import {useSite} from "../../context";
import {siteRef, useSiteText} from "../../text";
import {useFormFeedback} from "../form-feedback";
import type {RemoteList} from "./account-lists";
import AccountSection from "./AccountSection.vue";
import LinkDialog from "./LinkDialog.vue";
import PasswordDialog from "./PasswordDialog.vue";

/** 上游的先后，与登录页、注册页的两枚图标相同（`SocialButtons.vue`）。 */
const ORDER = ["github", "google"] as const satisfies readonly SocialProvider[];

const props = defineProps<{
    me: MeResponse;
    identities: RemoteList<IdentityItem>;
    /** `meta` 里各上游是否开放；还没取到时是 `undefined`，这时没关联的上游照样列出。 */
    providers: MetaResponse["providers"] | undefined;
    /** 从上游回来时地址上的 `social_error`（账号页读出、从地址去掉之后交来）。 */
    socialError: string | undefined;
}>();
const emit = defineEmits<{(event: "password-changed"): void}>();

const {identity, account, clock, leave} = useSite();
const t = useSiteText();

const section = useTemplateRef<InstanceType<typeof AccountSection>>("section");
const root = computed(() => section.value?.root ?? null);
const feedback = useFormFeedback<never>(root, clock);
const {status, statusText, statusSpoken} = feedback;

const passwordOpen = shallowRef(false);
const linkOpen = shallowRef(false);
const linkProvider = shallowRef<SocialProvider>("github");
/** 正在解绑或正在发起关联的上游；这期间这一节的按钮都不可用。 */
const busyProvider = shallowRef<SocialProvider>();

interface ProviderRow {
    readonly provider: SocialProvider;
    readonly linked: IdentityItem | undefined;
}

const rows = computed<ProviderRow[]>(() =>
    ORDER.map((provider) => ({provider, linked: props.identities.items.value.find((item) => item.provider === provider)})).filter(
        (row) => row.linked !== undefined || props.providers?.[row.provider] !== false,
    ),
);

watch(
    () => props.socialError,
    (code) => {
        if (code === undefined || code === "") return;
        status.value = {reason: `social:${code}`, text: socialErrorText(code)};
    },
    {immediate: true},
);

function providerName(provider: SocialProvider): string {
    return t(`account.security.provider.${provider}`);
}

function onPasswordDone(): void {
    const hadPassword = props.me.hasPassword;
    account.update({...props.me, hasPassword: true});
    feedback.showSuccess("password", siteRef(hadPassword ? "account.security.passwordChanged" : "account.security.passwordCreated"));
    emit("password-changed");
}

async function focusPasswordButton(): Promise<void> {
    await nextTick();
    root.value?.querySelector<HTMLButtonElement>("[data-site-account-password] button")?.focus();
}

async function unlink(item: IdentityItem): Promise<void> {
    if (busyProvider.value !== undefined) return;
    busyProvider.value = item.provider;
    feedback.reset();
    try {
        const result = await identity.unlinkIdentity(item.id);
        if (result.ok) {
            await reloadIdentities();
            return;
        }
        showUnlinkFailure(result.failure);
    } finally {
        busyProvider.value = undefined;
    }
}

function showUnlinkFailure(failure: Failure): void {
    if (failure.kind === "code" && failure.code === "not_found" && failure.handled !== true) {
        status.value = {reason: "identity-gone", text: siteRef("account.security.identityGone")};
        void reloadIdentities();
        return;
    }
    if (!feedback.showFailure(failure)) return;
    if (failure.kind === "code" && failure.code === "last_login_method") void focusPasswordButton();
}

/** 重取上游身份；失败时留着旧的列表，原因写状态行。 */
async function reloadIdentities(): Promise<void> {
    const result = await props.identities.reload();
    if (!result.ok) feedback.showFailure(result.failure);
}

async function link(provider: SocialProvider): Promise<void> {
    if (busyProvider.value !== undefined) return;
    if (props.me.hasPassword) {
        linkProvider.value = provider;
        linkOpen.value = true;
        return;
    }
    // 没有密码的账号免填当前密码（输出 15），直接发起。成功就离开，按钮不再放开。
    busyProvider.value = provider;
    feedback.reset();
    const result = await identity.socialStart(provider, {intent: "link"});
    if (result.ok) {
        leave(result.value.url);
        return;
    }
    busyProvider.value = undefined;
    feedback.showFailure(result.failure);
}
</script>

<template>
    <AccountSection
        id="security"
        ref="section"
        :title="t('account.security.title')"
        :status-text="statusText"
        :status-reason="status?.reason"
        :status-spoken="statusSpoken"
        :status-tone="status?.tone === 'success' ? 'success' : 'danger'"
    >
        <ul class="account-rows">
            <li data-site-account-password :data-site-account-password-set="props.me.hasPassword ? 'true' : 'false'">
                <span class="account-rows__main">{{ t("account.security.password") }}</span>
                <Transition name="account-swap" mode="out-in">
                    <span :key="String(props.me.hasPassword)" class="account-rows__meta">{{ t(props.me.hasPassword ? "account.security.passwordSet" : "account.security.passwordUnset") }}</span>
                </Transition>
                <span class="account-rows__actions">
                    <Button variant="secondary" size="sm" @click="passwordOpen = true">{{ t(props.me.hasPassword ? "account.security.changePassword" : "account.security.setPassword") }}</Button>
                </span>
            </li>
            <li v-for="row in rows" :key="row.provider" :data-site-account-identity="row.provider" :data-site-account-linked="row.linked === undefined ? 'false' : 'true'">
                <span class="account-rows__main">{{ providerName(row.provider) }}</span>
                <Transition name="account-swap" mode="out-in">
                    <span :key="row.linked?.accountName ?? ''" class="account-rows__meta">{{ row.linked?.accountName ?? t("account.security.notLinked") }}</span>
                </Transition>
                <span class="account-rows__actions">
                    <Button
                        v-if="row.linked !== undefined"
                        variant="secondary"
                        size="sm"
                        :disabled="busyProvider !== undefined"
                        :loading="busyProvider === row.provider"
                        @click="unlink(row.linked)"
                    >{{ t("account.security.unlink") }}</Button>
                    <Button
                        v-else
                        variant="secondary"
                        size="sm"
                        :disabled="busyProvider !== undefined"
                        :loading="busyProvider === row.provider"
                        @click="link(row.provider)"
                    >{{ t("account.security.link") }}</Button>
                </span>
            </li>
        </ul>
        <PasswordDialog v-model:open="passwordOpen" :has-password="props.me.hasPassword" @done="onPasswordDone" />
        <LinkDialog v-model:open="linkOpen" :provider="linkProvider" />
    </AccountSection>
</template>

<style scoped>
.account-swap-enter-active,
.account-swap-leave-active {
    transition: opacity var(--motion-fast) var(--ease-layout);
}

.account-swap-enter-from,
.account-swap-leave-to {
    opacity: 0;
}
</style>
