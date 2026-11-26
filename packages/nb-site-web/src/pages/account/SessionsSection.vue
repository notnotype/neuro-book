<script setup lang="ts">
/**
 * 账号页的“已登录的设备”一节（t10 计划 3.12；`site.accounts` 输出 17）：每个会话一行，写浏览器与系统的概要、登录时间与最后使用时间，
 * 这台设备的会话带“这台设备”。别的会话可以逐个结束；“退出其它所有设备”逐个结束当前之外的会话。
 *
 * - 结束一个会话回 `not_found`：它已经不在了（到期、在别处被结束），当作结束了。
 * - “退出其它所有设备”串行地发（计划 3.1 的逐页接口表），不并发：一次失败（例如限流）不会连带后面一整批同时撞上。统一处理接管了的
 *   失败（会话没了）停下，人已经被带走。都发完后重取列表；有没结束的写“结束了 N 个，M 个没结束”。
 * - 别处（改密码之后别的会话被结束）要这一节重取时调 `reload`。
 */

import type {SessionItem} from "@notnotype/nb-site-identity-contract/constants";
import {Badge, Button} from "@notnotype/nb-ui/components";
import {computed, shallowRef, useTemplateRef} from "vue";

import type {Failure} from "../../http/core";
import {useSite} from "../../context";
import {locale} from "../../locale";
import {siteRef, useSiteText} from "../../text";
import {useFormFeedback} from "../form-feedback";
import type {RemoteList} from "./account-lists";
import AccountSection from "./AccountSection.vue";

const props = defineProps<{sessions: RemoteList<SessionItem>}>();

const {identity, clock} = useSite();
const t = useSiteText();

const section = useTemplateRef<InstanceType<typeof AccountSection>>("section");
const root = computed(() => section.value?.root ?? null);
const feedback = useFormFeedback<never>(root, clock);
const {status, statusText, statusSpoken} = feedback;

/** 正在结束的那一个（`id`），或正在结束其它所有的（`others`）。 */
const ending = shallowRef<number | "others">();

const others = computed(() => props.sessions.items.value.filter((session) => !session.current));

const timeFormat = computed(() => new Intl.DateTimeFormat(locale.value, {year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"}));

function time(iso: string): string {
    return timeFormat.value.format(new Date(iso));
}

function device(session: SessionItem): string {
    if (session.browser !== null && session.os !== null) return t("account.sessions.device", {browser: session.browser, os: session.os});
    return session.browser ?? session.os ?? t("account.sessions.unknownDevice");
}

/** 要结束的会话已经不在了：当作结束了。 */
function gone(failure: Failure): boolean {
    return failure.kind === "code" && failure.code === "not_found" && failure.handled !== true;
}

async function reload(): Promise<void> {
    const result = await props.sessions.reload();
    if (!result.ok) feedback.showFailure(result.failure);
}

async function endOne(session: SessionItem): Promise<void> {
    if (ending.value !== undefined) return;
    ending.value = session.id;
    feedback.reset();
    try {
        const result = await identity.endSession(session.id);
        if (!result.ok && !gone(result.failure)) {
            feedback.showFailure(result.failure);
            return;
        }
        await reload();
    } finally {
        ending.value = undefined;
    }
}

async function endOthers(): Promise<void> {
    if (ending.value !== undefined || others.value.length === 0) return;
    ending.value = "others";
    feedback.reset();
    let endedCount = 0;
    let failedCount = 0;
    let lastFailure: Failure | undefined;
    try {
        for (const session of others.value) {
            const result = await identity.endSession(session.id);
            if (result.ok || gone(result.failure)) {
                endedCount += 1;
                continue;
            }
            // 会话没了、要先同意：统一处理已经在带人走，剩下的不再发。
            if (result.failure.kind === "code" && result.failure.handled === true) return;
            failedCount += 1;
            lastFailure = result.failure;
        }
        const reloaded = await props.sessions.reload();
        if (failedCount > 0) {
            // 只有一个时，它自己的原因更有用（例如限流的倒数）；多个时写数目。
            if (endedCount === 0 && failedCount === 1 && lastFailure !== undefined) feedback.showFailure(lastFailure);
            else status.value = {reason: "partial", text: siteRef("account.sessions.partial", {ended: endedCount, failed: failedCount})};
        } else if (!reloaded.ok) {
            feedback.showFailure(reloaded.failure);
        } else {
            feedback.showSuccess("ended-others", siteRef("account.sessions.endedOthers"));
        }
    } finally {
        ending.value = undefined;
    }
}

defineExpose({reload});
</script>

<template>
    <AccountSection
        id="sessions"
        ref="section"
        :title="t('account.sessions.title')"
        :status-text="statusText"
        :status-reason="status?.reason"
        :status-spoken="statusSpoken"
        :status-tone="status?.tone === 'success' ? 'success' : 'danger'"
    >
        <TransitionGroup name="account-row" tag="ul" class="account-rows">
            <li v-for="session in props.sessions.items.value" :key="session.id" :data-site-account-session="session.id" :data-site-account-session-current="session.current ? 'true' : undefined">
                <span class="account-rows__main">
                    <span data-site-account-session-device>{{ device(session) }}</span>
                    <Badge v-if="session.current" tone="accent" variant="soft" size="sm">{{ t("account.sessions.current") }}</Badge>
                </span>
                <span class="account-rows__meta account-session-times">
                    <time :datetime="session.createdAt" data-site-account-session-created>{{ t("account.sessions.createdAt", {time: time(session.createdAt)}) }}</time>
                    <span v-if="session.current">{{ t("account.sessions.inUse") }}</span>
                    <time v-else :datetime="session.lastUsedAt" data-site-account-session-last-used>{{ t("account.sessions.lastUsedAt", {time: time(session.lastUsedAt)}) }}</time>
                </span>
                <span v-if="!session.current" class="account-rows__actions">
                    <Button variant="secondary" size="sm" :disabled="ending !== undefined" :loading="ending === session.id" @click="endOne(session)">{{ t("account.sessions.end") }}</Button>
                </span>
            </li>
        </TransitionGroup>
        <template #actions>
            <Button variant="secondary" :disabled="others.length === 0 || ending !== undefined" :loading="ending === 'others'" data-site-account-end-others @click="endOthers">{{ t("account.sessions.endOthers") }}</Button>
        </template>
    </AccountSection>
</template>

<style scoped>
/* 两个时间之间留一个字宽，窄时整段换行，不在时间中间断开。 */
.account-session-times {
    display: inline-flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    column-gap: 1em;
}

.account-session-times > * {
    white-space: nowrap;
}

@media (max-width: 560px) {
    .account-session-times {
        justify-content: flex-start;
    }
}
</style>
