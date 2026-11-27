<script setup lang="ts">
/**
 * 授权确认页（t10 计划 3.1 的路由表与逐页接口表；t09 第 5、7 条：与登录页同一张稿纸、适配手机；`site.oauth-provider` 输出 3、5、14）。
 *
 * 授权端点把人带来的两种地址：
 * - `?request=<标识>`：要确认的授权请求。取 `GET oauth/authorization` 画出客户端名字、要的范围、回去的主机名，“允许”“拒绝”各发一次
 *   `POST`，回来的地址整页过去（`SiteContext.leave`）。那是客户端的地址，不在站内，不套 `next` 的核对：它由服务端按登记的回调地址给出。
 *   这一种要登录、要交齐同意（路由的 `access`），访客按 `next` 先去登录、登录后回到这里。
 * - `?error=<码>`：客户端没登记或已停用、回调地址不对（输出 3）。不取接口，整张卡片写原因，不画按钮；谁都能看（路由的 `publicWith`）。
 *
 * 取数或提交回 `authorization_expired`、`client_not_found`、`redirect_uri_invalid` 时同样换成整张卡片：这次请求已经没法继续，
 * 留着按钮只会再撞一次。别的失败：取数时在卡片里写原因与重试；提交时写状态行，按钮照常能点。地址上两样都没有时当作过期的请求。
 *
 * 页面级的加载照计划 3.1：取数超过 200 毫秒才显示“正在载入”。
 */

import {OAUTH_ERROR_PARAM, OAUTH_REQUEST_PARAM} from "@notnotype/nb-site-identity-contract/constants";
import type {OAuthAuthorizationResponse, OAuthScope} from "@notnotype/nb-site-identity-contract/constants";
import {Button, Spinner} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {computed, onBeforeUnmount, shallowRef, useTemplateRef, watch} from "vue";
import type {LocationQueryValue} from "vue-router";
import {useRoute, useRouter} from "vue-router";

import FormStatus from "../components/FormStatus.vue";
import {useSite} from "../context";
import type {Failure} from "../http/core";
import {failureText} from "../http/failure-text";
import {createOAuthApi} from "../http/oauth";
import {withNext} from "../session/dispatch";
import {signOut} from "../session/sign-out";
import {useSiteText} from "../text";
import {useFormFeedback} from "./form-feedback";

/** 这几个码说明这次授权请求没法继续了：整张卡片换成原因，不留按钮。 */
const ENDED_CODES = ["authorization_expired", "client_not_found", "redirect_uri_invalid"] as const;
type EndedCode = (typeof ENDED_CODES)[number];

/**
 * 不认识的码附在通用文案后面（ADR 0034 的做法），但这个参数谁都能写进链接里：只附看着像码的（小写字母与下划线），
 * 免得别人借这一页说一句话。
 */
const CODE_LIKE = /^[a-z_]{1,40}$/u;

/** 每个范围前面的图标；类名写全，Tailwind 才扫得到。 */
const SCOPE_ICONS: Readonly<Record<OAuthScope, string>> = {
    openid: "i-lucide-fingerprint",
    profile: "i-lucide-user",
    email: "i-lucide-mail",
};

/** 超过这么久还没取到才显示“正在载入”（计划 3.1“页面级的加载”）。 */
const LOADING_DELAY_MS = 200;

/**
 * - `loading`：在取这次授权请求。
 * - `ready`：取到了，画确认卡片。
 * - `ended`：没法继续（上面的三个码、地址上的 `error`）；`code` 不在 `ENDED_CODES` 里时用通用文案。
 * - `failed`：取数失败但可以重试（网络、限流、没认出的码）。
 */
type PageState =
    | {readonly kind: "loading"}
    | {readonly kind: "ready"; readonly request: string; readonly info: OAuthAuthorizationResponse}
    | {readonly kind: "ended"; readonly code: string}
    | {readonly kind: "failed"; readonly request: string; readonly failure: Failure};

const site = useSite();
const {api, account, identity, storage, clock, leave} = site;
const oauth = createOAuthApi(api);
const route = useRoute();
const router = useRouter();
const t = useSiteText();
const port = useText();

const state = shallowRef<PageState>({kind: "loading"});
const loadingShown = shallowRef(false);

const actions = useTemplateRef<HTMLElement>("actions");
const feedback = useFormFeedback<never>(actions, clock);
const {status, statusText, statusSpoken} = feedback;

/** 正在提交哪一个（按钮上转圈的是它，两个都不能再点），或正在退出当前账号（“换一个账号”）。 */
const deciding = shallowRef<"allow" | "deny">();
const signingOut = shallowRef(false);
const busy = computed(() => deciding.value !== undefined || signingOut.value || feedback.waiting.value);

const me = computed(() => (account.state.value.kind === "signed-in" ? account.state.value.me : undefined));
const initial = computed(() => Array.from(me.value?.displayName ?? me.value?.username ?? "")[0] ?? "");

function first(value: LocationQueryValue | LocationQueryValue[] | undefined): string | undefined {
    const one = Array.isArray(value) ? value[0] : value;
    return typeof one === "string" && one !== "" ? one : undefined;
}

function isEnded(code: string): code is EndedCode {
    return (ENDED_CODES as readonly string[]).includes(code);
}

/** 整张卡片的标题与说明。 */
const ended = computed(() => {
    if (state.value.kind !== "ended") return undefined;
    const code = state.value.code;
    if (isEnded(code)) return {title: t(`oauthConsent.ended.${code}.title`), detail: t(`oauthConsent.ended.${code}.detail`)};
    return {
        title: t("oauthConsent.ended.unknown.title"),
        detail: CODE_LIKE.test(code) ? t("oauthConsent.ended.unknown.code", {code}) : t("oauthConsent.ended.unknown.detail"),
    };
});

let stopLoadingDelay: (() => void) | undefined;

function stopDelay(): void {
    stopLoadingDelay?.();
    stopLoadingDelay = undefined;
    loadingShown.value = false;
}

/** 这一次取数的序号：地址换了（后退到另一次授权请求）时，先发起的那次结果到了就丢掉。 */
let generation = 0;

async function load(request: string): Promise<void> {
    const mine = ++generation;
    stopDelay();
    state.value = {kind: "loading"};
    feedback.reset();
    stopLoadingDelay = clock.every(LOADING_DELAY_MS, () => {
        stopLoadingDelay?.();
        stopLoadingDelay = undefined;
        loadingShown.value = true;
    });
    const result = await oauth.authorization(request);
    if (mine !== generation) return;
    stopDelay();
    if (result.ok) {
        state.value = {kind: "ready", request, info: result.value};
        return;
    }
    const failure = result.failure;
    if (failure.kind === "code" && failure.handled === true) {
        // 统一处理已经把人带去登录页或同意页：留在“正在载入”，不在离开前闪一下失败。
        state.value = {kind: "loading"};
        return;
    }
    if (failure.kind === "code" && isEnded(failure.code)) {
        state.value = {kind: "ended", code: failure.code};
        return;
    }
    state.value = {kind: "failed", request, failure};
}

watch(
    () => [first(route.query[OAUTH_ERROR_PARAM]), first(route.query[OAUTH_REQUEST_PARAM])] as const,
    ([error, request]) => {
        if (error !== undefined) {
            generation++;
            stopDelay();
            state.value = {kind: "ended", code: error};
            return;
        }
        if (request === undefined) {
            generation++;
            stopDelay();
            state.value = {kind: "ended", code: "authorization_expired"};
            return;
        }
        void load(request);
    },
    {immediate: true},
);

onBeforeUnmount(() => {
    generation++;
    stopDelay();
});

const loadFailureText = computed(() => (state.value.kind === "failed" ? port.t(failureText("identity", state.value.failure)) : ""));

function retry(): void {
    if (state.value.kind === "failed") void load(state.value.request);
}

async function decide(accept: boolean): Promise<void> {
    const current = state.value;
    if (current.kind !== "ready" || busy.value) return;
    deciding.value = accept ? "allow" : "deny";
    feedback.reset();
    try {
        const result = await oauth.decide({request: current.request, accept});
        if (!result.ok) {
            const failure = result.failure;
            if (failure.kind === "code" && failure.handled !== true && isEnded(failure.code)) {
                state.value = {kind: "ended", code: failure.code};
                return;
            }
            feedback.showFailure(failure);
            return;
        }
        const protocol = protocolOf(result.value.redirectUrl);
        if (protocol !== "https:" && protocol !== "http:") {
            // 服务端按登记的回调地址给出回跳地址，正常不会走到这里；万一给了 `javascript:` 一类，宁可不走。
            // 诊断只记协议：地址里带着授权码。
            console.warn("授权确认之后的回跳地址不是 http 或 https，没有离开", protocol);
            feedback.showFailure({kind: "malformed", status: 200});
            return;
        }
        // 页面随之卸载；从往返缓存回来时 resolve，按钮放开（`SiteContext.leave`）。
        await leave(result.value.redirectUrl);
    } finally {
        deciding.value = undefined;
    }
}

/** 地址的协议（带冒号）；不是合法的绝对地址时回 `undefined`。 */
function protocolOf(url: string): string | undefined {
    return URL.canParse(url) ? new URL(url).protocol : undefined;
}

/** 换一个账号：退出当前的，带着这一页去登录，登录后回来接着确认。 */
async function switchAccount(): Promise<void> {
    if (busy.value) return;
    signingOut.value = true;
    feedback.reset();
    try {
        const result = await signOut(identity, account, storage);
        if (!result.ok) {
            feedback.showFailure(result.failure);
            return;
        }
        await router.replace(withNext("/login", route.fullPath));
    } catch (error) {
        // 已经登出、当前账号已清空，只是去登录页的跳转没成：守卫在下一次导航时照样把他当访客带去登录。
        console.warn("退出当前账号之后没能打开登录页", error);
    } finally {
        signingOut.value = false;
    }
}
</script>

<template>
    <div :data-site-page="String(route.name)" class="oauth-consent">
        <Transition name="oauth-consent-fade" mode="out-in">
            <div v-if="state.kind === 'loading'" key="loading" class="oauth-consent__state" aria-busy="true" data-site-oauth-loading>
                <template v-if="loadingShown">
                    <Spinner />
                    <p role="status">{{ t("oauthConsent.loading") }}</p>
                </template>
            </div>

            <div v-else-if="state.kind === 'failed'" key="failed" class="oauth-consent__state" role="alert" data-site-oauth-failed>
                <p>{{ t("oauthConsent.loadFailed") }}</p>
                <p class="oauth-consent__reason">{{ loadFailureText }}</p>
                <Button variant="secondary" @click="retry">{{ t("oauthConsent.retry") }}</Button>
            </div>

            <div v-else-if="state.kind === 'ended' && ended !== undefined" key="ended" :data-site-oauth-ended="state.code">
                <h1>{{ ended.title }}</h1>
                <p class="oauth-consent__detail">{{ ended.detail }}</p>
            </div>

            <div v-else-if="state.kind === 'ready'" key="ready" data-site-oauth-ready>
                <h1 class="oauth-consent__heading" data-site-oauth-heading>{{ t("oauthConsent.heading", {client: state.info.clientName}) }}</h1>
                <div v-if="me !== undefined" class="oauth-consent__who">
                    <span class="oauth-consent__avatar" aria-hidden="true">{{ initial }}</span>
                    <span class="oauth-consent__name">{{ me.username }}</span>
                    <button type="button" class="site-link oauth-consent__switch" :disabled="busy" data-site-oauth-switch @click="switchAccount">{{ t("oauthConsent.switchAccount") }}</button>
                </div>
                <p class="oauth-consent__gets">{{ t("oauthConsent.gets") }}</p>
                <ul class="oauth-consent__scopes">
                    <li v-for="scope in state.info.scopes" :key="scope" :data-site-oauth-scope="scope">
                        <span :class="SCOPE_ICONS[scope]" aria-hidden="true" />{{ t(`oauthConsent.scopes.${scope}`) }}
                    </li>
                </ul>
                <div ref="actions" class="oauth-consent__decide">
                    <FormStatus class="site-form-status" :text="statusText" :spoken="statusSpoken" :reason="status?.reason" />
                    <div class="oauth-consent__actions">
                        <Button variant="secondary" block :disabled="busy" :loading="deciding === 'deny'" data-site-oauth-deny @click="decide(false)">{{ t("oauthConsent.deny") }}</Button>
                        <Button variant="primary" block :disabled="busy" :loading="deciding === 'allow'" data-site-oauth-allow @click="decide(true)">{{ t("oauthConsent.allow") }}</Button>
                    </div>
                </div>
                <p class="site-form-alt" data-site-oauth-return>{{ t("oauthConsent.returnTo", {host: state.info.redirectHost}) }}</p>
            </div>
        </Transition>
    </div>
</template>

<style scoped>
/* 客户端名字可以是一长串不带空格的字（驼峰的包名一类）：不折行的话伸出卡片、被稿纸裁掉，看不全是谁在要授权。 */
.oauth-consent__heading {
    overflow-wrap: anywhere;
}

.oauth-consent__state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    min-height: 200px;
    color: var(--text-secondary);
    text-align: center;
}

.oauth-consent__state p {
    margin: 0;
}

.oauth-consent__reason {
    font-size: var(--text-sm);
}

.oauth-consent__detail {
    margin: 0;
    color: var(--text-secondary);
    line-height: 1.7;
}

.oauth-consent__who {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 20px;
    font-size: var(--text-sm);
}

.oauth-consent__name {
    min-width: 0;
    margin-right: auto;
    overflow: hidden;
    font-size: var(--text-md);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.oauth-consent__avatar {
    display: grid;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--accent-bg);
    color: var(--accent-text);
    font-weight: 600;
}

/* “换一个账号”是链接的样子、按钮的行为（它要先退出当前账号，不是去一个地址）。 */
.oauth-consent__switch {
    flex: none;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    cursor: pointer;
}

.oauth-consent__switch:disabled {
    cursor: default;
    opacity: 0.5;
}

.oauth-consent__gets {
    margin: 0 0 8px;
    color: var(--text-secondary);
    font-size: var(--text-sm);
}

.oauth-consent__scopes {
    display: grid;
    gap: 10px;
    margin: 0 0 12px;
    padding: 0;
    list-style: none;
}

.oauth-consent__scopes li {
    display: flex;
    align-items: center;
    gap: 10px;
}

.oauth-consent__scopes span {
    flex: none;
    color: var(--text-muted);
}

.oauth-consent__decide {
    display: grid;
    gap: 10px;
}

.oauth-consent__actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
}

.oauth-consent-fade-enter-active,
.oauth-consent-fade-leave-active {
    transition: opacity var(--motion-base) var(--ease-layout);
}

.oauth-consent-fade-enter-from,
.oauth-consent-fade-leave-to {
    opacity: 0;
}
</style>
