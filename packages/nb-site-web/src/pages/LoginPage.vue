<script setup lang="ts">
/**
 * 登录页，也是主页（t10 计划 3.1；t09 第 1 条；审定 D7：只有登录入口、一行说明与隐私政策、服务条款的链接）。`/` 与 `/login`
 * 用同一个组件；已登录的人进不来，守卫按分派送走。社交登录的两枚图标归 B3，登录续接（`continue`）归 B7。
 *
 * 失败的显示照计划 3.1“状态行与表单错误”与审定 D9：提交之后才知道的错，对应字段标红并得到焦点，原因写在卡片里固定位置的
 * 状态行（`FormStatus`），不在字段下插字；按码分支，不按文案。标红经 nb-ui `Field` 的 `error`：给的是状态行上的同一句话，
 * 读屏读字段时连原因一起读，看得见的只有状态行这一处。
 *
 * 稿纸由外壳按路由的 `meta.layout` 套上（`App.vue`），这一页只给卡片里的内容。
 */

import {LOGIN_IDENTIFIER, PASSWORD, SOCIAL_ERROR_PARAM} from "@notnotype/nb-site-identity-contract/constants";
import {Button, Field, Input} from "@notnotype/nb-ui/components";
import type {TextRef} from "@notnotype/nb-ui/text";
import {useText} from "@notnotype/nb-ui/text-port";
import {computed, nextTick, onBeforeUnmount, shallowRef, useTemplateRef, watch} from "vue";
import {RouterLink, useRoute, useRouter} from "vue-router";

import {RETRY_AFTER_FALLBACK_SECONDS} from "../http/core";
import type {Failure} from "../http/core";
import {codeText, failureText, socialErrorText} from "../http/failure-text";
import FormStatus from "../components/FormStatus.vue";
import {useSite} from "../context";
import {enterAfterSignIn} from "../session/enter";
import {siteRef, useSiteText} from "../text";

type LoginField = "identifier" | "password";

/** 两个字段的名字，也是登录请求体里的键：`validation_failed` 的 `fields` 是请求体的键名（`site.accounts` 输出 22）。 */
const LOGIN_FIELDS: readonly LoginField[] = ["identifier", "password"];

/** 状态行上的一条：`reason` 是哪件事（失败码，或页面自己判出的），`action` 是跟在原因后面的链接。 */
interface Status {
    readonly reason: string;
    readonly text: TextRef;
    readonly action?: "register";
}

const {identity, account, clock} = useSite();
const route = useRoute();
const router = useRouter();
const t = useSiteText();
const port = useText();

const identifier = shallowRef("");
const password = shallowRef("");
const submitting = shallowRef(false);
const status = shallowRef<Status>();
const invalid = shallowRef<ReadonlySet<LoginField>>(new Set());
const form = useTemplateRef<HTMLFormElement>("form");

// `rate_limited` 的倒数：到 `retryAt` 之前提交按钮不可用，状态行每秒改一次秒数（计划 3.1）。时间取注入的时钟（`host/clock.ts`）。
const retryAt = shallowRef<number>();
const now = shallowRef(clock.now());
let stopTicking: (() => void) | undefined;

const waitSeconds = computed(() => (retryAt.value === undefined ? 0 : Math.max(0, Math.ceil((retryAt.value - now.value) / 1000))));
const filled = computed(() => identifier.value !== "" && password.value !== "");
const canSubmit = computed(() => filled.value && !submitting.value && retryAt.value === undefined);

const statusText = computed(() => {
    const current = status.value;
    if (current === undefined) return "";
    if (current.reason === "rate_limited") return port.t(codeText("identity", "rate_limited", {seconds: waitSeconds.value}));
    return port.t(current.text);
});

// 倒数时看得见的字每秒一变，读屏只听一句不带秒数的（`FormStatus` 的 `spoken`）；字段的 `error` 也给这句，读字段时不读过时的秒数。
const statusSpoken = computed(() => (status.value?.reason === "rate_limited" ? port.t(siteRef("login.rateLimitedSpoken")) : ""));

/** 标红的字段给 `Field` 的 `error`：状态行上的那句话。 */
function fieldError(field: LoginField): string {
    return invalid.value.has(field) ? statusSpoken.value || statusText.value : "";
}

function stopCountdown(): void {
    stopTicking?.();
    stopTicking = undefined;
}

function startCountdown(seconds: number): void {
    stopCountdown();
    now.value = clock.now();
    // 至少等一秒：`Retry-After: 0` 时按钮也先不可用一下，免得连点又撞上同一次限流。
    const until = now.value + Math.max(1, seconds) * 1000;
    retryAt.value = until;
    stopTicking = clock.every(1000, () => {
        now.value = clock.now();
        if (now.value < until) return;
        stopCountdown();
        retryAt.value = undefined;
        if (status.value?.reason === "rate_limited") status.value = undefined;
    });
}

onBeforeUnmount(stopCountdown);

/** 标红这些字段，焦点给第一个。标红要等这一轮渲染之后才落到控件上，所以聚焦放在 `nextTick`。 */
async function markFields(fields: readonly LoginField[]): Promise<void> {
    invalid.value = new Set(fields);
    const first = fields[0];
    if (first === undefined) return;
    await nextTick();
    form.value?.querySelector<HTMLInputElement>(`input[name="${first}"]`)?.focus();
}

// 改了任一字段，标红就过时了（原因还留在状态行，下次提交时换掉）。
watch([identifier, password], () => {
    if (invalid.value.size > 0) invalid.value = new Set();
});

function showFailure(failure: Failure): void {
    // 统一处理已经接管的码（会话没了、同意门槛）：它会把人带走，页面不再显示。
    if (failure.kind === "code" && failure.handled === true) return;
    status.value = {reason: failure.kind === "code" ? failure.code : failure.kind, text: failureText("identity", failure)};
    if (failure.kind !== "code") return;
    switch (failure.code) {
        case "invalid_credentials":
            // 不说是哪一个错（`site.accounts` 输出 4 对不存在的账号与错的密码回同一个码），两个都标。
            void markFields(LOGIN_FIELDS);
            return;
        case "validation_failed":
            void markFields(LOGIN_FIELDS.filter((field) => failure.fields?.includes(field) === true));
            return;
        case "rate_limited":
            startCountdown(failure.retryAfterSeconds ?? RETRY_AFTER_FALLBACK_SECONDS);
            return;
    }
}

async function submit(): Promise<void> {
    if (!canSubmit.value) return;
    submitting.value = true;
    // 先清掉上一次的原因：再错同一个码时状态行淡出又淡入，看得出这次提交确实有了回答。
    status.value = undefined;
    invalid.value = new Set();
    try {
        const result = await identity.login({identifier: identifier.value, password: password.value});
        if (!result.ok) {
            showFailure(result.failure);
            return;
        }
        const outcome = await enterAfterSignIn(account, router);
        if (outcome === "anonymous") status.value = {reason: "not-applied", text: siteRef("login.notApplied")};
    } catch (error) {
        // 会话已经建起来了，只是守卫或页面加载出了错：告诉他刷新，诊断留在控制台。
        console.warn("登录成功之后没能打开下一页", error);
        status.value = {reason: "not-entered", text: siteRef("login.notEntered")};
    } finally {
        submitting.value = false;
    }
}

// 社交登录没完成时上游把人带回 `/login?social_error=<码>`（`site.accounts` 输出 23）：显示在状态行，再把参数从地址里去掉，
// 刷新时不再显示一遍。去掉参数是同一页面上的跳转，组件不重建，状态行留着。
watch(
    () => route.query[SOCIAL_ERROR_PARAM],
    (value) => {
        if (value === undefined) return;
        const code = (Array.isArray(value) ? value[0] : value) ?? "";
        if (code !== "") {
            status.value = {reason: `social:${code}`, text: socialErrorText(code), ...(code === "social_not_registered" ? {action: "register" as const} : {})};
        }
        const {[SOCIAL_ERROR_PARAM]: _shown, ...query} = route.query;
        router.replace({path: route.path, query, hash: route.hash}).catch((error: unknown) => {
            console.warn(`没能把 ${SOCIAL_ERROR_PARAM} 从地址里去掉`, error);
        });
    },
    {immediate: true},
);
</script>

<template>
    <div :data-site-page="String(route.name)">
        <h1>{{ t("login.title") }}</h1>
        <form ref="form" class="login-form" novalidate @submit.prevent="submit">
            <Field :label="t('login.identifier')" :error="fieldError('identifier')">
                <Input v-model="identifier" name="identifier" autocomplete="username" :maxlength="LOGIN_IDENTIFIER.maxLength" />
            </Field>
            <Field :label="t('login.password')" :error="fieldError('password')">
                <Input v-model="password" name="password" type="password" autocomplete="current-password" :maxlength="PASSWORD.maxLength" />
            </Field>
            <FormStatus class="login-status" :text="statusText" :spoken="statusSpoken" :reason="status?.reason">
                <template v-if="status?.action === 'register'" #action>
                    <RouterLink to="/register" class="login-link">{{ t("login.goRegister") }}</RouterLink>
                </template>
            </FormStatus>
            <Button type="submit" block :disabled="!canSubmit" :loading="submitting">{{ t("login.submit") }}</Button>
        </form>
        <p class="login-alt">
            {{ t("login.noAccount") }}<RouterLink to="/register" class="login-link">{{ t("login.register") }}</RouterLink>
        </p>
    </div>
</template>

<style scoped>
.login-form {
    display: grid;
    gap: 14px;
}

/* 状态行夹在密码与按钮之间：收一点上下的间距，空着时这一块不显得像漏了东西。 */
.login-status {
    margin-block: -4px;
}

.login-alt {
    margin: 20px 0 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    text-align: center;
}

/* 行内链接静止时也带下划线：与周围文字只差颜色时，分不清颜色的人认不出它（WCAG 1.4.1）。悬停时加粗下划线。 */
.login-link {
    flex-shrink: 0;
    color: var(--accent-text);
    text-decoration-line: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
}

.login-link:hover {
    text-decoration-thickness: 2px;
}

.login-link:focus-visible {
    outline: 2px solid var(--accent-main);
    outline-offset: 2px;
    border-radius: 2px;
}
</style>
