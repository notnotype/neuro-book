<script setup lang="ts">
/**
 * 账号页的“已登录的设备”一节（t10 计划 3.12；`site.accounts` 输出 17）：每个会话一行，写浏览器与系统的概要与最后使用时间，
 * 这台设备的会话带“这台设备”、写“正在使用”。别的会话可以逐个结束；“退出其它所有设备”逐个结束当前之外的会话。
 *
 * - 最后使用时间只写一个相对的说法，粒度到小时（“1 小时内”“3 小时前”“昨天”，更早的写日期；`recent-time.ts`）：服务端每小时
 *   至多更新一次（输出 17），写到分钟是假精度。登录时间放进那一格的悬停提示。
 * - 结束一个会话回 `not_found`：它已经不在了（到期、在别处被结束），当作结束了。
 * - “退出其它所有设备”串行地发（计划 3.1 的逐页接口表），碰到 `not_found` 之外的第一次失败就停：剩下的不发，免得一整批接着撞上同一次
 *   限流或同一个坏掉的服务。停下后重取列表，状态行写失败的原因（限流照常倒数）；之前结束过的，原因前面写“结束了 N 个，M 个没结束”。
 *   统一处理接管了的失败（会话没了）也停下，人已经被带走。
 * - 倒数期间这一节的按钮都不可用（计划 3.1“倒数完之前提交按钮不可用”）。
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
import {accountDate, recentTime} from "../recent-time";
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

/** 他能不能点这一节的按钮：没有在结束的、不在倒数。 */
const idle = computed(() => ending.value === undefined && !feedback.waiting.value);

const timeFormat = computed(() => new Intl.DateTimeFormat(locale.value, {year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"}));

/** 登录时间（悬停提示里）：服务端记的是准确时刻，写到分钟。 */
function time(iso: string): string {
    return timeFormat.value.format(new Date(iso));
}

/**
 * 最后使用时间的相对说法。“现在”取注入的时钟，在这一节每次重画时取，不另起计时：粒度是小时，停在页面上一阵子略旧可以接受，
 * 下一次重取列表或别的变化重画时就新了。
 */
function lastUsed(iso: string): string {
    const now = clock.now();
    return recentTime(iso, now, locale.value, t("account.sessions.withinHour")) ?? accountDate(iso, now, locale.value);
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
    if (!idle.value) return;
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
    if (!idle.value || others.value.length === 0) return;
    ending.value = "others";
    feedback.reset();
    const targets = others.value;
    let endedCount = 0;
    let stopped: Failure | undefined;
    try {
        for (const session of targets) {
            const result = await identity.endSession(session.id);
            if (result.ok || gone(result.failure)) {
                endedCount += 1;
                continue;
            }
            // 会话没了、要先同意：统一处理已经在带人走，剩下的不再发。
            if (result.failure.kind === "code" && result.failure.handled === true) return;
            stopped = result.failure;
            break;
        }
        const reloaded = await props.sessions.reload();
        if (stopped !== undefined) {
            // 一个都没结束时只写原因；结束过的，原因前面写做到了哪里（没结束的含停下那个与没发的）。
            const lead = endedCount === 0 ? undefined : siteRef("account.sessions.partial", {ended: endedCount, failed: targets.length - endedCount});
            feedback.showFailure(stopped, lead === undefined ? undefined : {lead});
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
                <span class="account-rows__meta" :title="t('account.sessions.createdAt', {time: time(session.createdAt)})" :data-site-account-session-created="session.createdAt">
                    <span v-if="session.current">{{ t("account.sessions.inUse") }}</span>
                    <time v-else :datetime="session.lastUsedAt" data-site-account-session-last-used>{{ lastUsed(session.lastUsedAt) }}</time>
                </span>
                <span v-if="!session.current" class="account-rows__actions">
                    <Button
                        variant="secondary"
                        size="sm"
                        :aria-label="t('account.sessions.endNamed', {device: device(session)})"
                        :disabled="!idle"
                        :loading="ending === session.id"
                        @click="endOne(session)"
                    >{{ t("account.sessions.end") }}</Button>
                </span>
            </li>
        </TransitionGroup>
        <template #actions>
            <Button variant="secondary" :disabled="others.length === 0 || !idle" :loading="ending === 'others'" data-site-account-end-others @click="endOthers">{{ t("account.sessions.endOthers") }}</Button>
        </template>
    </AccountSection>
</template>
