<script setup lang="ts">
/**
 * 登录页，也是主页（t10 计划 3.1；t09 第 1 条；审定 D7：只有登录入口、一行说明与隐私政策、服务条款的链接）。`/` 与 `/login`
 * 用同一个组件；已登录的人进不来，守卫按分派送走。表单下是社交登录的两枚图标（`SocialButtons`）。
 *
 * 从授权请求来的人地址上带续接令牌（`session/continue.ts`）：登录请求与社交登录的发起都带上它，“注册”链接把它带到注册页；
 * 登录响应给了继续地址就去那里（`session/enter.ts`）。带令牌的已登录用户也看得到这张表单（授权请求要求重新登录，守卫放行）。
 * 社交登录没成、上游带 `social_error` 回来时，发起前存下的令牌还原到地址上。
 *
 * 失败的显示照三张稿纸页共用的做法（`form-feedback.ts`）：字段标红并聚焦，原因写在固定位置的状态行；哪个码标哪些字段由这一页定。
 *
 * 稿纸由外壳按路由的 `meta.layout` 套上（`App.vue`），这一页只给卡片里的内容。
 */

import {LOGIN_IDENTIFIER, PASSWORD, SOCIAL_ERROR_PARAM} from "@notnotype/nb-site-identity-contract/constants";
import type {SocialProvider} from "@notnotype/nb-site-identity-contract/constants";
import {Button, Field, Input} from "@notnotype/nb-ui/components";
import {computed, shallowRef, useTemplateRef, watch} from "vue";
import {RouterLink, useRoute, useRouter} from "vue-router";

import type {Failure} from "../http/core";
import {socialErrorText} from "../http/failure-text";
import FormStatus from "../components/FormStatus.vue";
import SocialButtons from "../components/SocialButtons.vue";
import {useSite} from "../context";
import {continuePart, readContinue} from "../session/continue";
import {enterAfterSignIn} from "../session/enter";
import {siteRef, useSiteText} from "../text";
import {useFormFeedback} from "./form-feedback";
import {readSocialError, stripSocialError} from "./social-error";
import {usePageMeta} from "./use-meta";

type LoginField = "identifier" | "password";

/** 两个字段的名字，也是登录请求体里的键：`validation_failed` 的 `fields` 是请求体的键名（`site.accounts` 输出 22）。 */
const LOGIN_FIELDS: readonly LoginField[] = ["identifier", "password"];

const site = useSite();
const {identity, clock, leave, storage} = site;
const route = useRoute();
const router = useRouter();
const t = useSiteText();

const identifier = shallowRef("");
const password = shallowRef("");
const submitting = shallowRef(false);
/** 社交登录的发起：请求在路上，或已拿到上游地址、页面正在离开；从上游点返回、页面从往返缓存恢复时放开（`SiteContext.leave`）。 */
const starting = shallowRef(false);
const form = useTemplateRef<HTMLFormElement>("form");
const feedback = useFormFeedback<LoginField>(form, clock);
const {status, statusText, statusSpoken, fieldError} = feedback;
const meta = usePageMeta(identity);

const filled = computed(() => identifier.value !== "" && password.value !== "");
const busy = computed(() => submitting.value || starting.value || feedback.waiting.value);
const canSubmit = computed(() => filled.value && !busy.value);
const providers = computed(() => meta.latest.value?.providers);
/** 地址上的续接令牌，与它在链接上的样子（去注册页时带着）。 */
const continueToken = computed(() => readContinue(route.query));
const registerLink = computed(() => ({path: "/register", query: continuePart(continueToken.value)}));

// 改了任一字段，标红就过时了（原因还留在状态行，下次提交时换掉）。
watch([identifier, password], () => feedback.unmark());

function showFailure(failure: Failure): void {
    if (!feedback.showFailure(failure) || failure.kind !== "code") return;
    switch (failure.code) {
        case "invalid_credentials":
            // 不说是哪一个错（`site.accounts` 输出 4 对不存在的账号与错的密码回同一个码），两个都标。
            void feedback.mark(LOGIN_FIELDS);
            return;
        case "validation_failed":
            void feedback.mark(LOGIN_FIELDS.filter((field) => failure.fields?.includes(field) === true));
            return;
    }
}

async function submit(): Promise<void> {
    if (!canSubmit.value) return;
    submitting.value = true;
    feedback.reset();
    try {
        const result = await identity.login({identifier: identifier.value, password: password.value, ...continuePart(continueToken.value)});
        if (!result.ok) {
            showFailure(result.failure);
            return;
        }
        const outcome = await enterAfterSignIn(site, router, result.value.continueUrl);
        if (outcome === "anonymous") status.value = {reason: "not-applied", text: siteRef("login.notApplied")};
    } catch (error) {
        // 会话已经建起来了，只是守卫或页面加载出了错：告诉他刷新，诊断留在控制台。
        console.warn("登录成功之后没能打开下一页", error);
        status.value = {reason: "not-entered", text: siteRef("login.notEntered")};
    } finally {
        submitting.value = false;
    }
}

/** 社交登录的发起（`site.accounts` 输出 11）：拿到上游地址就带浏览器过去；失败（`provider_disabled`、`unavailable`、`rate_limited` 等）写状态行。 */
async function startSocial(provider: SocialProvider): Promise<void> {
    if (busy.value) return;
    starting.value = true;
    feedback.reset();
    const token = continueToken.value;
    const result = await identity.socialStart(provider, {intent: "login", ...continuePart(token)});
    if (result.ok) {
        // 上游带着 `social_error` 回来时地址上没有令牌（回调地址是服务端定的）：先存下，回来时还原（`host/storage.ts`）。
        if (token === undefined) storage.clearSocialLoginContinue();
        else storage.saveSocialLoginContinue(token);
        await leave(result.value.url);
        starting.value = false;
        return;
    }
    starting.value = false;
    showFailure(result.failure);
}

// 社交登录没完成时上游把人带回 `/login?social_error=<码>`（`site.accounts` 输出 23）：显示在状态行，再把参数从地址里去掉
// （`social-error.ts`），同一次替换里把发起前存下的续接令牌写回地址。去掉参数之后组件不重建，状态行留着。
// 不带 `social_error` 的（空值也算不带）删掉存着的令牌：上一次没走完的社交登录不该在下一次进来时冒出来。
watch(
    () => route.query[SOCIAL_ERROR_PARAM],
    () => {
        const code = readSocialError(route.query);
        if (code === undefined) {
            storage.clearSocialLoginContinue();
            stripSocialError(route, router);
            return;
        }
        status.value = {reason: "social_error", text: socialErrorText(code), ...(code === "social_not_registered" ? {action: "register" as const} : {})};
        const stored = storage.takeSocialLoginContinue();
        stripSocialError(route, router, {add: continueToken.value === undefined ? continuePart(stored) : {}});
    },
    {immediate: true},
);
</script>

<template>
    <div :data-site-page="String(route.name)">
        <h1>{{ t("login.title") }}</h1>
        <form ref="form" class="site-form" novalidate @submit.prevent="submit">
            <Field :label="t('login.identifier')" :error="fieldError('identifier')">
                <Input v-model="identifier" name="identifier" autocomplete="username" :maxlength="LOGIN_IDENTIFIER.maxLength" />
            </Field>
            <Field :label="t('login.password')" :error="fieldError('password')">
                <Input v-model="password" name="password" type="password" autocomplete="current-password" :maxlength="PASSWORD.maxLength" />
            </Field>
            <FormStatus class="site-form-status" :text="statusText" :spoken="statusSpoken" :reason="status?.reason">
                <template v-if="status?.action === 'register'" #action>
                    <RouterLink :to="registerLink" class="site-link">{{ t("login.goRegister") }}</RouterLink>
                </template>
            </FormStatus>
            <Button type="submit" block :disabled="!canSubmit" :loading="submitting">{{ t("login.submit") }}</Button>
        </form>
        <SocialButtons intent="login" :providers="providers" :disabled="busy" @start="startSocial" />
        <p class="site-form-alt">
            {{ t("login.noAccount") }}<RouterLink :to="registerLink" class="site-link">{{ t("login.register") }}</RouterLink>
        </p>
    </div>
</template>
