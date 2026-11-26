<script setup lang="ts">
/**
 * 账号页的“资料”一节（t10 计划 3.12；`site.accounts` 输出 8；审定 D10 加“头像地址”）：显示名、邮箱、网站、头像地址、签名，
 * 用户名只读。只发改过的项（`PATCH me`）；头像、网站、签名清空时发 `null`，邮箱不能清空（合同里它不能是 `null`）。
 *
 * 没有邮箱的账号（`me.emailPending`）只在邮箱格里多一枚“待补”（t09 第 11 条）。那枚徽标的位置一直留着、有邮箱时看不见，
 * 所以两种账号的输入框一样宽、版式相同；填了字就收起来。
 *
 * 规则取自合同包的字段规则，与服务端同一条：离开一个填了字的格子时查，不合就标红、状态行写规则；保存按钮在没改过或有不合规则的项时
 * 不可用。服务端回的 `email_taken`、`validation_failed` 标对应的格子（做法同稿纸页，`form-feedback.ts`）。
 */

import {BIO, DISPLAY_NAME, EMAIL, WEB_URL, codePointLength, isWebUrl} from "@notnotype/nb-site-identity-contract/constants";
import type {MeResponse, PatchMeRequest} from "@notnotype/nb-site-identity-contract/constants";
import {Badge, Button, Field, Input, Textarea} from "@notnotype/nb-ui/components";
import {computed, shallowRef, useTemplateRef, watch} from "vue";
import type {ShallowRef} from "vue";

import type {Failure} from "../../http/core";
import {useSite} from "../../context";
import {siteRef, useSiteText} from "../../text";
import type {SiteTextKey} from "../../text";
import {useFormFeedback} from "../form-feedback";
import AccountSection from "./AccountSection.vue";

type ProfileField = "displayName" | "email" | "website" | "avatarUrl" | "bio";

/** 表单里的先后：标红时焦点给最靠前的那一项。名字也是 `PATCH me` 请求体里的键（`validation_failed` 的 `fields`）。 */
const FIELDS: readonly ProfileField[] = ["displayName", "email", "website", "avatarUrl", "bio"];

const EMAIL_RULE = new RegExp(EMAIL.pattern, "u");

const props = defineProps<{me: MeResponse}>();

const {identity, account, clock} = useSite();
const t = useSiteText();

/** 资料里一项的原值，按输入框里的写法（没有的是空串）。 */
function original(me: MeResponse, field: ProfileField): string {
    return me[field] ?? "";
}

const drafts: Record<ProfileField, ShallowRef<string>> = {
    displayName: shallowRef(original(props.me, "displayName")),
    email: shallowRef(original(props.me, "email")),
    website: shallowRef(original(props.me, "website")),
    avatarUrl: shallowRef(original(props.me, "avatarUrl")),
    bio: shallowRef(original(props.me, "bio")),
};
const {displayName, email, website, avatarUrl, bio} = drafts;

// 资料换了（保存成功、别的节改了密码之后换上的新资料）：没动过的格子跟着换，正在改的格子留着他写的。
watch(
    () => props.me,
    (next, previous) => {
        for (const field of FIELDS) if (drafts[field].value === original(previous, field)) drafts[field].value = original(next, field);
    },
);

const saving = shallowRef(false);
const form = useTemplateRef<HTMLFormElement>("form");
const feedback = useFormFeedback<ProfileField>(form, clock);
const {status, statusText, statusSpoken, fieldError} = feedback;

const pendingBadgeShown = computed(() => props.me.emailPending && email.value === "");

/** 各项的规则；合规则回 `undefined`，否则回说明规则的那句话的键。 */
const RULES: Record<ProfileField, () => SiteTextKey | undefined> = {
    // 显示名不去首尾空白（字段规则），不能留空。
    displayName: () => {
        const length = codePointLength(displayName.value);
        return length < DISPLAY_NAME.minLength || length > DISPLAY_NAME.maxLength ? "account.rules.displayName" : undefined;
    },
    // 没有邮箱的账号留空就是还没填；有邮箱的不能清空（`PatchMeRequest.email` 不能是 `null`）。
    email: () => {
        if (email.value === "") return props.me.email === null ? undefined : "account.rules.emailRequired";
        return EMAIL_RULE.test(email.value) ? undefined : "account.rules.email";
    },
    website: () => (website.value === "" || isWebUrl(website.value) ? undefined : "account.rules.webUrl"),
    avatarUrl: () => (avatarUrl.value === "" || isWebUrl(avatarUrl.value) ? undefined : "account.rules.webUrl"),
    bio: () => (codePointLength(bio.value) > BIO.maxLength ? "account.rules.bio" : undefined),
};

const changed = computed(() => FIELDS.filter((field) => drafts[field].value !== original(props.me, field)));
const broken = computed(() => FIELDS.filter((field) => RULES[field]() !== undefined));
const canSave = computed(() => changed.value.length > 0 && broken.value.length === 0 && !saving.value && !feedback.waiting.value);

/** 他改了任一项：标红过时了；页面自己查出的规则说明跟着撤掉，服务端给的原因留到下次保存。 */
function onEdited(): void {
    feedback.unmark();
    if (status.value?.reason.startsWith("rule:") === true) status.value = undefined;
}

/** 离开一个填了字的格子时查它的规则：不合就标红、状态行写规则，焦点不拉回来。 */
function onFocusOut(event: FocusEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    const field = FIELDS.find((candidate) => candidate === target.name);
    if (field === undefined || drafts[field].value === "") return;
    const rule = RULES[field]();
    if (rule === undefined) return;
    status.value = {reason: `rule:${field}`, text: siteRef(rule)};
    void feedback.mark([field], {focus: false});
}

/** 请求体：只放改过的项。头像、网站、签名留空是清掉（`null`）；邮箱留空的情形规则已经挡下了。 */
function patchBody(): PatchMeRequest {
    const body: {-readonly [Key in keyof PatchMeRequest]: PatchMeRequest[Key]} = {};
    for (const field of changed.value) {
        const value = drafts[field].value;
        if (field === "displayName" || field === "email") body[field] = value;
        else body[field] = value === "" ? null : value;
    }
    return body;
}

function showFailure(failure: Failure): void {
    if (!feedback.showFailure(failure) || failure.kind !== "code") return;
    switch (failure.code) {
        case "email_taken":
            void feedback.mark(["email"]);
            return;
        case "validation_failed":
            void feedback.mark(FIELDS.filter((field) => failure.fields?.includes(field) === true));
            return;
    }
}

async function save(): Promise<void> {
    if (!canSave.value) return;
    saving.value = true;
    feedback.reset();
    try {
        const result = await identity.patchMe(patchBody());
        if (!result.ok) {
            showFailure(result.failure);
            return;
        }
        account.update(result.value);
        feedback.showSuccess("saved", siteRef("account.saved"));
    } finally {
        saving.value = false;
    }
}
</script>

<template>
    <AccountSection id="profile" :title="t('account.profile.title')" :status-text="statusText" :status-reason="status?.reason" :status-spoken="statusSpoken" :status-tone="status?.tone === 'success' ? 'success' : 'danger'">
        <form id="account-profile-form" ref="form" class="account-profile" novalidate @submit.prevent="save" @input="onEdited" @change="onEdited" @focusout="onFocusOut">
            <Field :label="t('account.profile.username')">
                <Input :model-value="props.me.username" name="username" readonly autocomplete="username" />
            </Field>
            <Field :label="t('account.profile.displayName')" :error="fieldError('displayName')">
                <Input v-model="displayName" name="displayName" autocomplete="nickname" />
            </Field>
            <Field :label="t('account.profile.email')" :error="fieldError('email')">
                <Input v-model="email" name="email" inputmode="email" autocomplete="email" :maxlength="EMAIL.maxLength">
                    <!-- 徽标一直在，没有待补时只是看不见：输入框的宽度不随有没有邮箱变。 -->
                    <template #suffix>
                        <Badge class="account-pending" :class="{'is-shown': pendingBadgeShown}" tone="warning" variant="soft" size="sm" :aria-hidden="pendingBadgeShown ? undefined : 'true'" data-site-account-email-pending>{{ t("account.profile.emailPending") }}</Badge>
                    </template>
                </Input>
            </Field>
            <Field :label="t('account.profile.website')" :error="fieldError('website')">
                <Input v-model="website" name="website" inputmode="url" autocomplete="url" :maxlength="WEB_URL.maxLength" />
            </Field>
            <Field class="account-profile__wide" :label="t('account.profile.avatarUrl')" :error="fieldError('avatarUrl')">
                <Input v-model="avatarUrl" name="avatarUrl" inputmode="url" autocomplete="photo" :maxlength="WEB_URL.maxLength" />
            </Field>
            <Field class="account-profile__wide" :label="t('account.profile.bio')" :error="fieldError('bio')">
                <Textarea v-model="bio" name="bio" :rows="2" />
            </Field>
        </form>
        <template #actions>
            <Button type="submit" form="account-profile-form" :disabled="!canSave" :loading="saving" data-site-account-save>{{ t("account.save") }}</Button>
        </template>
    </AccountSection>
</template>

<style scoped>
.account-profile {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px 16px;
}

.account-profile__wide {
    grid-column: 1 / -1;
}

/* 节窄到放不下两列时并成一列（`AccountSection` 是尺寸容器）。 */
@container (max-width: 480px) {
    .account-profile {
        grid-template-columns: minmax(0, 1fr);
    }
}

.account-pending {
    visibility: hidden;
    opacity: 0;
    transition: opacity var(--motion-base) var(--ease-layout), visibility 0s linear var(--motion-base);
}

.account-pending.is-shown {
    visibility: visible;
    opacity: 1;
    transition: opacity var(--motion-base) var(--ease-layout), visibility 0s;
}
</style>
