<script setup lang="ts">
/**
 * 同意页（t10 计划 3.1；t09 第 7 条；审定 D1）：缺同意的用户（条款换了版本、导入的旧账号、没同意境外存放）在这里补交
 * （`site.accounts` 输出 10）。守卫只让缺同意的人进来；别的页撞上同意门槛时带着 `next` 来这里（`site.ts` 的统一处理），
 * 补交之后对当前地址再走一遍守卫，按分派回 `next`。授权端点把会话不满足门槛的人带到 `/consent?continue=<令牌>`
 * （`site.oauth-provider` 输出 12）：补交请求带上令牌，响应给了继续地址就去那里回到授权请求（`session/enter.ts`）。
 *
 * 两项都勾了才能提交：条款与隐私政策一项、境外存放一项（D1）。失败都写状态行（计划 3.1 的逐页表）；补交时回 `consent_required`
 * 是版本刚又换了，重取 `meta`、撤掉两个勾。
 */

import {Button, Checkbox} from "@notnotype/nb-ui/components";
import {computed, shallowRef, useTemplateRef} from "vue";
import {RouterLink, useRoute, useRouter} from "vue-router";

import type {Failure} from "../http/core";
import FormStatus from "../components/FormStatus.vue";
import {useSite} from "../context";
import {continuePart, readContinue} from "../session/continue";
import {enterAfterSignIn} from "../session/enter";
import {signOut} from "../session/sign-out";
import {siteRef, useSiteText} from "../text";
import type {SiteTextKey} from "../text";
import {useFormFeedback} from "./form-feedback";
import {usePageMeta} from "./use-meta";

type ConsentField = "termsConsent" | "overseasStorage";

/** 列出的两份条款：共用一个版本号（`site.accounts` 的条款版本是日期，两份文件同一个，S5）。 */
const DOCUMENTS: readonly {readonly path: string; readonly title: SiteTextKey}[] = [
    {path: "/terms", title: "legal.terms.title"},
    {path: "/privacy", title: "legal.privacy.title"},
];

const site = useSite();
const {identity, account, clock, storage} = site;
const route = useRoute();
const router = useRouter();
const t = useSiteText();

const agreeTerms = shallowRef(false);
const agreeOverseas = shallowRef(false);
const submitting = shallowRef(false);
const signingOut = shallowRef(false);
const form = useTemplateRef<HTMLFormElement>("form");
const feedback = useFormFeedback<ConsentField>(form, clock);
const {status, statusText, statusSpoken, isInvalid} = feedback;
const meta = usePageMeta(identity);

const version = computed(() => (meta.state.value.kind === "ready" ? meta.state.value.meta.termsVersion : ""));
const busy = computed(() => submitting.value || signingOut.value || feedback.waiting.value);
const canSubmit = computed(() => agreeTerms.value && agreeOverseas.value && !busy.value);

/** 他动了勾选框，标红就过时了；原因留在状态行，下次提交时换掉。 */
function onEdited(): void {
    feedback.unmark();
}

async function onConsentRequired(sentVersion: string): Promise<void> {
    const state = await meta.refresh();
    if (state.kind === "ready" && state.meta.termsVersion !== sentVersion) {
        agreeTerms.value = false;
        agreeOverseas.value = false;
        status.value = {reason: "terms-changed", text: siteRef("consent.termsChanged")};
    }
    await feedback.mark(["termsConsent", "overseasStorage"]);
}

function showFailure(failure: Failure, sentVersion: string): void {
    if (!feedback.showFailure(failure) || failure.kind !== "code") return;
    if (failure.code === "consent_required") void onConsentRequired(sentVersion);
}

async function submit(): Promise<void> {
    if (!canSubmit.value) return;
    submitting.value = true;
    feedback.reset();
    try {
        const state = await meta.ensure();
        if (state.kind !== "ready") {
            if (state.kind === "failed") feedback.showFailure(state.failure);
            return;
        }
        const sent = state.meta.termsVersion;
        const result = await identity.consent({termsVersion: sent, overseasStorage: agreeOverseas.value, ...continuePart(readContinue(route.query))});
        if (!result.ok) {
            showFailure(result.failure, sent);
            return;
        }
        // 没有继续地址时：重取账号之后“还缺同意”是假的，守卫对 `/consent` 按分派送走，带着的 `next` 照同样的规则校验
        // （`session/enter.ts`）。
        await enterAfterSignIn(site, router, result.value.continueUrl);
    } catch (error) {
        console.warn("补交同意之后没能打开下一页", error);
        status.value = {reason: "not-entered", text: siteRef("consent.notEntered")};
    } finally {
        submitting.value = false;
    }
}

async function leaveAccount(): Promise<void> {
    if (busy.value) return;
    signingOut.value = true;
    feedback.reset();
    try {
        const result = await signOut(identity, account, storage);
        if (!result.ok) {
            feedback.showFailure(result.failure);
            return;
        }
        await router.replace("/");
    } catch (error) {
        // 已经登出、当前账号已清空，只是去首页的跳转没成：守卫在下一次导航时照样把他当访客。
        console.warn("登出之后没能回到首页", error);
    } finally {
        signingOut.value = false;
    }
}
</script>

<template>
    <div :data-site-page="String(route.name)">
        <h1>{{ t("consent.heading") }}</h1>
        <p class="consent-lead">{{ t("consent.lead") }}</p>
        <ul class="consent-docs">
            <li v-for="doc in DOCUMENTS" :key="doc.path" class="consent-doc">
                <RouterLink :to="doc.path" target="_blank" rel="noopener" class="site-link">{{ t(doc.title) }}</RouterLink>
                <!-- 版本号在 `meta` 回来之前空着，这一行的高度不变。 -->
                <span class="consent-version" data-site-consent-version>{{ version === "" ? "" : t("consent.version", {version}) }}</span>
            </li>
        </ul>
        <form ref="form" class="site-form" novalidate @submit.prevent="submit" @change="onEdited">
            <div class="consent-checks">
                <Checkbox v-model="agreeTerms" name="termsConsent" :invalid="isInvalid('termsConsent')">{{ t("consent.agreeTerms") }}</Checkbox>
                <Checkbox v-model="agreeOverseas" name="overseasStorage" :invalid="isInvalid('overseasStorage')">{{ t("form.agreeOverseas") }}</Checkbox>
            </div>
            <FormStatus class="site-form-status" :text="statusText" :spoken="statusSpoken" :reason="status?.reason" />
            <Button type="submit" block :disabled="!canSubmit" :loading="submitting">{{ t("consent.submit") }}</Button>
        </form>
        <Button class="consent-sign-out" variant="ghost" block :disabled="busy" :loading="signingOut" @click="leaveAccount">{{ t("consent.signOut") }}</Button>
    </div>
</template>

<style scoped>
.consent-lead {
    margin: 0 0 16px;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    line-height: 1.7;
}

.consent-docs {
    display: grid;
    gap: 8px;
    margin: 0 0 20px;
    padding: 0;
    list-style: none;
}

.consent-doc {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    font-size: var(--text-sm);
}

.consent-version {
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
}

.consent-checks {
    display: grid;
    gap: 10px;
}

.consent-sign-out {
    margin-top: 10px;
}
</style>
