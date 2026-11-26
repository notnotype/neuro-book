<script setup lang="ts">
/**
 * 注册页（t10 计划 3.1、3.9；t09 第 7、10 条；审定 D1、D2、D5）：用注册码密码注册，或带齐同样的内容去上游做社交注册。
 * 只有访客进得来，守卫按分派送走已登录的人。登录续接（`continue`）归 B7。
 *
 * - 两个勾选框（D1）：条款与隐私政策一项，境外存放一项；密码注册与社交注册都要两项都勾（`site.accounts` 输出 3、13）。
 * - 显示名可省、邀请码可省（D2）：留空的不进请求。`/register?invite=<码>` 预填邀请码（输出 18）。
 * - 社交注册先在页面上按同样的规则查一遍，过了才发起；服务端再按输出 3 校验，不合格不给上游地址（输出 13）。拿到地址后、
 *   离开之前把表单存成草稿（`host/storage.ts`）；上游带着 `social_error` 回到这一页时还原，注册码在、密码本来就不存。
 * - `meta` 说注册关闭（或提交时回 `registration_closed`）时整张表单不可用，社交注册也不可发起。
 *
 * 失败的显示照三张稿纸页共用的做法（`form-feedback.ts`）：哪个码标哪个字段见下面的 `showFailure`。
 */

import {
    DISPLAY_NAME,
    EMAIL,
    PASSWORD,
    SOCIAL_ERROR_PARAM,
    USERNAME,
    codePointLength,
    parseUsernameInput,
} from "@notnotype/nb-site-identity-contract/constants";
import type {RegisterRequest, SocialProvider, SocialStartRequest} from "@notnotype/nb-site-identity-contract/constants";
import {Button, Checkbox, Field, Input} from "@notnotype/nb-ui/components";
import {computed, onMounted, shallowRef, useTemplateRef, watch} from "vue";
import {RouterLink, useRoute, useRouter} from "vue-router";

import type {Failure} from "../http/core";
import {codeText, socialErrorText} from "../http/failure-text";
import FormStatus from "../components/FormStatus.vue";
import SocialButtons from "../components/SocialButtons.vue";
import {useSite} from "../context";
import type {SocialRegisterDraft} from "../host/storage";
import {enterAfterSignIn} from "../session/enter";
import {siteRef, useSiteText} from "../text";
import type {SiteTextKey} from "../text";
import {useFormFeedback} from "./form-feedback";
import {usePageMeta} from "./use-meta";

/**
 * 能标红的项。前六个是输入框，名字就是请求体里的键（`validation_failed` 的 `fields` 是请求体的键名，`site.accounts` 输出 22）；
 * 两个勾选框的名字与请求体的键对应关系见 `FIELD_OF_KEY`。
 */
type RegisterField = "registrationCode" | "username" | "displayName" | "email" | "password" | "inviteCode" | "termsConsent" | "overseasStorage";

/** 请求体的键到页面上的项：条款版本是第一个勾选框给的，其余同名。 */
const FIELD_OF_KEY: Readonly<Record<string, RegisterField>> = {
    registrationCode: "registrationCode",
    username: "username",
    displayName: "displayName",
    email: "email",
    password: "password",
    inviteCode: "inviteCode",
    termsVersion: "termsConsent",
    overseasStorage: "overseasStorage",
};

/** 按表单里的先后，标红时焦点给最靠前的那一项。 */
const FIELD_ORDER: readonly RegisterField[] = ["registrationCode", "username", "displayName", "email", "password", "inviteCode", "termsConsent", "overseasStorage"];

/** 从上游回来时，哪个码说的是哪一项（输出 13：发起时校验过、回调时已不可用的）。`email_taken` 说的是上游给的邮箱，不是表单里的。 */
const FIELD_OF_SOCIAL_ERROR: Readonly<Record<string, RegisterField>> = {
    registration_code_invalid: "registrationCode",
    invite_code_invalid: "inviteCode",
    username_taken: "username",
};

const EMAIL_RULE = new RegExp(EMAIL.pattern, "u");

const {identity, account, clock, storage, leave} = useSite();
const route = useRoute();
const router = useRouter();
const t = useSiteText();

const registrationCode = shallowRef("");
const username = shallowRef("");
const displayName = shallowRef("");
const email = shallowRef("");
const password = shallowRef("");
const inviteCode = shallowRef("");
const agreeTerms = shallowRef(false);
const agreeOverseas = shallowRef(false);
const submitting = shallowRef(false);
/** 社交注册的发起：请求在路上，或已拿到上游地址、页面正在离开（离开之后页面就卸载了，所以成功时不再放开）。 */
const starting = shallowRef(false);
/** 提交或发起时服务端回了 `registration_closed`：`meta` 取得早，注册可能在那之后关掉。 */
const closedByServer = shallowRef(false);

const form = useTemplateRef<HTMLFormElement>("form");
const feedback = useFormFeedback<RegisterField>(form, clock);
const {status, statusText, statusSpoken, fieldError, isInvalid} = feedback;
const meta = usePageMeta(identity);

const closed = computed(() => closedByServer.value || (meta.state.value.kind === "ready" && !meta.state.value.meta.registrationOpen));
const busy = computed(() => submitting.value || starting.value || feedback.waiting.value);
const providers = computed(() => (meta.state.value.kind === "ready" ? meta.state.value.meta.providers : undefined));

/** 各项的规则（取自合同包的字段规则，与服务端同一条）；合规则回 `undefined`，否则回说明规则的那句话的键。 */
const RULES: Partial<Record<RegisterField, () => SiteTextKey | undefined>> = {
    // 注册码与邀请码的首尾空白由服务端去掉（`RegisterRequest` 的说明），所以只有空白的注册码算没填。
    registrationCode: () => (registrationCode.value.trim() === "" ? "register.rules.registrationCode" : undefined),
    username: () => (parseUsernameInput(username.value) === undefined ? "register.rules.username" : undefined),
    // 显示名不去首尾空白（字段规则），留空就是省略。
    displayName: () => (displayName.value !== "" && codePointLength(displayName.value) > DISPLAY_NAME.maxLength ? "register.rules.displayName" : undefined),
    email: () => (EMAIL_RULE.test(email.value) ? undefined : "register.rules.email"),
    password: () => {
        const length = codePointLength(password.value);
        return length < PASSWORD.minLength || length > PASSWORD.maxLength ? "register.rules.password" : undefined;
    },
};

/** 社交注册不带邮箱与密码（邮箱回调时取上游的，账号没有密码；`SocialStartRequest`）。 */
const SOCIAL_FIELDS: readonly RegisterField[] = ["registrationCode", "username", "displayName"];
const PASSWORD_FIELDS: readonly RegisterField[] = [...SOCIAL_FIELDS, "email", "password"];

function brokenRules(fields: readonly RegisterField[]): RegisterField[] {
    return fields.filter((field) => RULES[field]?.() !== undefined);
}

const agreed = computed(() => agreeTerms.value && agreeOverseas.value);
const canSubmit = computed(() => !closed.value && !busy.value && agreed.value && brokenRules(PASSWORD_FIELDS).length === 0);

/**
 * 他改了任一项（表单上冒上来的 `input`、`change`），标红就过时了。服务端给的原因留在状态行，下次提交时换掉；页面自己查出的
 * 规则说明跟着撤掉，离开字段时再查。只听他的输入、不 `watch` 这些值：还原草稿、版本变了撤掉勾选这些页面自己写的值不撤标红，
 * 否则从上游回来时刚标上的字段会被还原的赋值撤掉。
 */
function onEdited(): void {
    feedback.unmark();
    if (status.value?.reason.startsWith("rule:") === true) status.value = undefined;
}

/** 离开一个填了字的输入框时查它的规则：不合就标红、状态行写规则，焦点不拉回来。没填的不说，提交按钮本来就不可用。 */
function checkOnBlur(field: RegisterField, value: string): void {
    if (value === "") return;
    const rule = RULES[field]?.();
    if (rule === undefined) return;
    status.value = {reason: `rule:${field}`, text: siteRef(rule)};
    void feedback.mark([field], {focus: false});
}

/**
 * 发起社交注册前在页面上查一遍：不合规则的标红、焦点给第一个、状态行写它的规则；规则都过了而没勾同意的，标两个勾选框。
 * 都合格回 `true`。
 */
function checkBeforeSocial(): boolean {
    const broken = brokenRules(SOCIAL_FIELDS);
    const first = broken[0];
    if (first !== undefined) {
        status.value = {reason: `rule:${first}`, text: siteRef(RULES[first]!()!)};
        void feedback.mark(broken);
        return false;
    }
    if (!agreed.value) {
        status.value = {reason: "consent-missing", text: siteRef("register.consentMissing")};
        void feedback.mark([...(agreeTerms.value ? [] : ["termsConsent" as const]), ...(agreeOverseas.value ? [] : ["overseasStorage" as const])]);
        return false;
    }
    return true;
}

function showRegistrationClosed(): void {
    status.value = {reason: "registration_closed", text: codeText("identity", "registration_closed")};
}

// 注册关闭时一进来（或一知道）就把原因写在状态行；表单与社交图标由 `closed` 挡住。
watch(closed, (isClosed) => {
    if (isClosed) showRegistrationClosed();
});

/**
 * 回了 `consent_required`（输出 3）：条款版本可能刚换了。重取 `meta`，版本变了就撤掉两个勾（他同意的是旧版），再标红两个勾选框。
 * 原因已经由 `showFailure` 写在状态行。
 */
async function onConsentRequired(sentVersion: string): Promise<void> {
    const state = await meta.refresh();
    if (state.kind === "ready" && state.meta.termsVersion !== sentVersion) {
        agreeTerms.value = false;
        agreeOverseas.value = false;
        status.value = {reason: "terms-changed", text: siteRef("register.termsChanged")};
    }
    await feedback.mark(["termsConsent", "overseasStorage"]);
}

/** 一次接口失败落在哪：状态行由 `feedback.showFailure` 写，这里按码标字段、挡表单。 */
function showFailure(failure: Failure, sentVersion: string): void {
    if (!feedback.showFailure(failure) || failure.kind !== "code") return;
    switch (failure.code) {
        case "registration_code_invalid":
            void feedback.mark(["registrationCode"]);
            return;
        case "invite_code_invalid":
            void feedback.mark(["inviteCode"]);
            return;
        case "username_taken":
            void feedback.mark(["username"]);
            return;
        case "email_taken":
            void feedback.mark(["email"]);
            return;
        case "validation_failed": {
            const marked = new Set((failure.fields ?? []).flatMap((key) => (FIELD_OF_KEY[key] === undefined ? [] : [FIELD_OF_KEY[key]])));
            void feedback.mark(FIELD_ORDER.filter((field) => marked.has(field)));
            return;
        }
        case "consent_required":
            void onConsentRequired(sentVersion);
            return;
        case "registration_closed":
            closedByServer.value = true;
            return;
    }
}

/** 提交与发起都要当前的条款版本（`meta`）。取不到时把原因写上状态行，回 `undefined`。 */
async function termsVersion(): Promise<string | undefined> {
    const state = await meta.ensure();
    if (state.kind === "ready") return state.meta.termsVersion;
    if (state.kind === "failed") feedback.showFailure(state.failure);
    return undefined;
}

/** 留空的可选项不进请求（D2）：显示名省略时服务端取用户名；只有空白的邀请码当没填。 */
function optionalParts(): Pick<RegisterRequest, "displayName" | "inviteCode"> {
    return {
        ...(displayName.value === "" ? {} : {displayName: displayName.value}),
        ...(inviteCode.value.trim() === "" ? {} : {inviteCode: inviteCode.value}),
    };
}

async function submit(): Promise<void> {
    if (!canSubmit.value) return;
    submitting.value = true;
    feedback.reset();
    try {
        const version = await termsVersion();
        if (version === undefined) return;
        const result = await identity.register({
            username: username.value,
            email: email.value,
            password: password.value,
            registrationCode: registrationCode.value,
            ...optionalParts(),
            termsVersion: version,
            overseasStorage: agreeOverseas.value,
        });
        if (!result.ok) {
            showFailure(result.failure, version);
            return;
        }
        // 注册成功（落到别的页）时草稿就没用了（计划 3.9）。
        storage.clearSocialRegisterDraft();
        const outcome = await enterAfterSignIn(account, router);
        if (outcome === "anonymous") status.value = {reason: "not-applied", text: siteRef("register.notApplied")};
    } catch (error) {
        // 账号与会话已经建起来了，只是守卫或页面加载出了错：告诉他刷新，诊断留在控制台。
        console.warn("注册成功之后没能打开下一页", error);
        status.value = {reason: "not-entered", text: siteRef("register.notEntered")};
    } finally {
        submitting.value = false;
    }
}

async function startSocial(provider: SocialProvider): Promise<void> {
    if (closed.value || busy.value) return;
    feedback.reset();
    if (!checkBeforeSocial()) return;
    starting.value = true;
    const version = await termsVersion();
    if (version === undefined) {
        starting.value = false;
        return;
    }
    const body: SocialStartRequest = {
        intent: "register",
        username: username.value,
        registrationCode: registrationCode.value,
        ...optionalParts(),
        termsVersion: version,
        overseasStorage: agreeOverseas.value,
    };
    const result = await identity.socialStart(provider, body);
    if (!result.ok) {
        starting.value = false;
        showFailure(result.failure, version);
        return;
    }
    // 先存草稿再离开：上游带着 `social_error` 回来时靠它还原表单（计划 3.9“什么时候写”）。密码不存，社交注册也用不到。
    storage.saveSocialRegisterDraft({
        provider,
        username: username.value,
        displayName: displayName.value,
        inviteCode: inviteCode.value,
        registrationCode: registrationCode.value,
        consent: {termsVersion: version, overseas: agreeOverseas.value},
    });
    leave(result.value.url);
}

/** 草稿填回表单。同意只在版本仍是当前版本时勾回去：条款在这期间换了，他同意的是旧版。 */
function restore(draft: SocialRegisterDraft): void {
    registrationCode.value = draft.registrationCode;
    username.value = draft.username;
    displayName.value = draft.displayName;
    inviteCode.value = draft.inviteCode;
    void meta.ensure().then((state) => {
        if (state.kind !== "ready" || state.meta.termsVersion !== draft.consent.termsVersion) return;
        agreeTerms.value = true;
        agreeOverseas.value = draft.consent.overseas;
    });
}

function firstQuery(value: unknown): string | undefined {
    const first = Array.isArray(value) ? value[0] : value;
    return typeof first === "string" ? first : undefined;
}

// 进页时只看一次地址（计划 3.1“`social_error`”、3.9“什么时候读与清”）：带 `social_error` 时显示它、取出草稿还原（读一次就删），
// 再把参数从地址里去掉，刷新时不再显示一遍；不带时删掉草稿（上一次没走完的社交注册不该在下一次进来时冒出来）。
// 去掉参数是同一页面上的跳转，组件不重建，这段不会再跑。
const socialError = firstQuery(route.query[SOCIAL_ERROR_PARAM]);
let markOnMount: RegisterField | undefined;
let restored = false;
if (socialError === undefined) {
    storage.clearSocialRegisterDraft();
} else {
    const draft = storage.takeSocialRegisterDraft();
    if (draft !== undefined) {
        restore(draft);
        restored = true;
    }
    if (socialError !== "") {
        status.value = {reason: `social:${socialError}`, text: socialErrorText(socialError)};
        markOnMount = FIELD_OF_SOCIAL_ERROR[socialError];
    }
    const {[SOCIAL_ERROR_PARAM]: _shown, ...query} = route.query;
    router.replace({path: route.path, query, hash: route.hash}).catch((error: unknown) => {
        console.warn(`没能把 ${SOCIAL_ERROR_PARAM} 从地址里去掉`, error);
    });
}

// 邀请链接预填邀请码（输出 18）；从上游回来、草稿里已有邀请码时以草稿为准。
const invited = firstQuery(route.query.invite);
if (!restored && invited !== undefined) inviteCode.value = invited;

// 焦点要等表单挂上之后才给得出去。
onMounted(() => {
    if (markOnMount !== undefined) void feedback.mark([markOnMount]);
});
</script>

<template>
    <div :data-site-page="String(route.name)">
        <h1>{{ t("register.title") }}</h1>
        <form ref="form" class="site-form" novalidate @submit.prevent="submit" @input="onEdited" @change="onEdited">
            <Field :label="t('register.registrationCode')" :error="fieldError('registrationCode')">
                <Input v-model="registrationCode" name="registrationCode" autocomplete="off" :disabled="closed" @blur="checkOnBlur('registrationCode', registrationCode)" />
            </Field>
            <Field :label="t('register.username')" :error="fieldError('username')">
                <Input v-model="username" name="username" autocomplete="username" :maxlength="USERNAME.maxLength" :disabled="closed" @blur="checkOnBlur('username', username)" />
            </Field>
            <!-- 显示名与密码不设 `maxlength`：它数的是 UTF-16 码元，规则数的是码点，表情这类字会被早早截断。超长由规则查出。 -->
            <Field :label="t('register.displayName')" :error="fieldError('displayName')">
                <Input v-model="displayName" name="displayName" autocomplete="nickname" :disabled="closed" @blur="checkOnBlur('displayName', displayName)" />
            </Field>
            <Field :label="t('register.email')" :error="fieldError('email')">
                <Input v-model="email" name="email" inputmode="email" autocomplete="email" :maxlength="EMAIL.maxLength" :disabled="closed" @blur="checkOnBlur('email', email)" />
            </Field>
            <Field :label="t('register.password')" :error="fieldError('password')">
                <Input v-model="password" name="password" type="password" autocomplete="new-password" :disabled="closed" @blur="checkOnBlur('password', password)" />
            </Field>
            <Field :label="t('register.inviteCode')" :error="fieldError('inviteCode')">
                <Input v-model="inviteCode" name="inviteCode" autocomplete="off" :disabled="closed" />
            </Field>
            <div class="register-consents">
                <Checkbox v-model="agreeTerms" name="termsConsent" :invalid="isInvalid('termsConsent')" :disabled="closed">
                    <span>
                        {{ t("form.agreeTermsBefore") }}<RouterLink to="/terms" target="_blank" rel="noopener" class="site-link">{{ t("legal.terms.title") }}</RouterLink>{{ t("form.agreeTermsJoin") }}<RouterLink to="/privacy" target="_blank" rel="noopener" class="site-link">{{ t("legal.privacy.title") }}</RouterLink>
                    </span>
                </Checkbox>
                <Checkbox v-model="agreeOverseas" name="overseasStorage" :invalid="isInvalid('overseasStorage')" :disabled="closed">
                    {{ t("form.agreeOverseas") }}
                </Checkbox>
            </div>
            <FormStatus class="site-form-status" :text="statusText" :spoken="statusSpoken" :reason="status?.reason" />
            <Button type="submit" block :disabled="!canSubmit" :loading="submitting">{{ t("register.submit") }}</Button>
        </form>
        <SocialButtons intent="register" :providers="providers" :disabled="closed || busy" @start="startSocial" />
        <p class="site-form-alt">
            {{ t("register.hasAccount") }}<RouterLink to="/login" class="site-link">{{ t("register.login") }}</RouterLink>
        </p>
    </div>
</template>

<style scoped>
.register-consents {
    display: grid;
    gap: 10px;
    margin-top: 2px;
}
</style>
