<script setup lang="ts">
/**
 * 发放注册码的对话框（t10 计划 3.13；`site.admin` 输出 7 与输入表的“注册码”一段）：可用次数（不填是不限）、过期日期（不填是不过期）、
 * 备注（至多 200 个字符）。成功后同一个对话框换成发出来的码与复制按钮（nb-ui 的换内容过渡 `nb-ui-switch`），列表由页面
 * 回到第 1 页重取。码在列表里一直看得到，不是一次性的秘密：点遮罩、按 Esc 照样关。
 *
 * 校验照稿纸页的做法（`form-feedback.ts`）：次数不是正整数、日期早于今天时提交按钮不可用，离开那一项时状态行写规则；
 * 服务端回 `validation_failed` 时按 `fields` 标红。备注的长度靠输入上限。
 *
 * 过期日期按本地时区那一天结束的一刻发出（`format.ts` 的 `endOfLocalDay`），文案写“到这一天结束时失效”。
 */

import {REGISTRATION_CODE_NOTE, codePointLength} from "@notnotype/nb-site-identity-contract/constants";
import type {CreateRegistrationCodeRequest, RegistrationCodeItem} from "@notnotype/nb-site-identity-contract/constants";
import {Button, CopyButton, DateInput, Dialog, Field, Input} from "@notnotype/nb-ui/components";
import {computed, shallowRef, useTemplateRef, watch} from "vue";

import {useSite} from "../../../context";
import type {AdminApi} from "../../../http/admin";
import type {Failure} from "../../../http/core";
import {adminRef, useAdminText} from "../text";
import {useFormFeedback} from "../../form-feedback";
import {endOfLocalDay, localToday} from "../format";

type IssueField = "maxUses" | "expiresAt" | "note";

const props = defineProps<{open: boolean; api: AdminApi}>();
const emit = defineEmits<{
    (event: "update:open", value: boolean): void;
    /** 发出了一个码：列表该重取。 */
    (event: "done", item: RegistrationCodeItem): void;
}>();

const {clock} = useSite();
const t = useAdminText();

const maxUses = shallowRef("");
const expiresAt = shallowRef<string | null>(null);
const note = shallowRef("");
const submitting = shallowRef(false);
/** 发出来的那一项；有它时对话框显示码。 */
const issued = shallowRef<RegistrationCodeItem>();

/** 可用次数：空是不限；否则是不超过 `Number.MAX_SAFE_INTEGER` 的正整数（合同的 `MaxUses`）。 */
const MAX_USES_PATTERN = /^[1-9][0-9]{0,15}$/u;
const maxUsesValue = computed<number | null | undefined>(() => {
    const text = maxUses.value.trim();
    if (text === "") return null;
    if (!MAX_USES_PATTERN.test(text)) return undefined;
    const value = Number(text);
    return Number.isSafeInteger(value) ? value : undefined;
});
const expiresFits = computed(() => expiresAt.value === null || expiresAt.value >= localToday(clock.now()));
const noteFits = computed(() => codePointLength(note.value) <= REGISTRATION_CODE_NOTE.maxLength);

const form = useTemplateRef<HTMLFormElement>("form");
const feedback = useFormFeedback<IssueField>(form, clock, {
    rules: {maxUses: () => (maxUsesValue.value === undefined ? adminRef("admin.codes.issue.rules.maxUses") : undefined)},
});
const {statusSteady, fieldError} = feedback;

const canSubmit = computed(() => maxUsesValue.value !== undefined && expiresFits.value && noteFits.value && !submitting.value && !feedback.waiting.value);

// 每次打开都从空白开始。发出的码也在这里丢：`closed` 只在关完时发，关到一半又打开（人点了“完成”马上又点“发放”）时不发。
watch(
    () => props.open,
    (open) => {
        if (!open) return;
        issued.value = undefined;
        maxUses.value = "";
        expiresAt.value = null;
        note.value = "";
        feedback.reset();
    },
);

// 日期不是输入框，`onLeave` 认不出它：选了一个早于今天的日子就当场写规则，改对了就撤。
watch(expiresFits, (fits) => {
    if (!fits) feedback.showRule(["expiresAt"], adminRef("admin.codes.issue.rules.expiresAt"));
    else if (feedback.status.value?.rule?.includes("expiresAt") === true) feedback.reset();
});

function showFailure(failure: Failure): void {
    if (!feedback.showFailure(failure) || failure.kind !== "code" || failure.code !== "validation_failed") return;
    const fields: readonly IssueField[] = ["maxUses", "expiresAt", "note"];
    void feedback.mark(fields.filter((field) => failure.fields?.includes(field) === true));
}

async function submit(): Promise<void> {
    const uses = maxUsesValue.value;
    if (!canSubmit.value || uses === undefined) return;
    submitting.value = true;
    feedback.reset();
    const body: CreateRegistrationCodeRequest = {
        maxUses: uses,
        ...(expiresAt.value === null ? {} : {expiresAt: endOfLocalDay(expiresAt.value)}),
        ...(note.value.trim() === "" ? {} : {note: note.value.trim()}),
    };
    try {
        const result = await props.api.createRegistrationCode(body);
        if (!result.ok) {
            showFailure(result.failure);
            return;
        }
        issued.value = result.value;
        emit("done", result.value);
    } finally {
        submitting.value = false;
    }
}
</script>

<template>
    <Dialog
        :open="props.open"
        size="md"
        :title="t(issued === undefined ? 'admin.codes.issue.title' : 'admin.codes.issue.doneTitle')"
        :status="statusSteady"
        :busy="submitting"
        :initial-focus="issued === undefined ? 'input' : undefined"
        data-site-admin-issue-dialog
        :data-site-admin-issue-step="issued === undefined ? 'form' : 'issued'"
        @update:open="emit('update:open', $event)"
        @closed="issued = undefined"
    >
        <Transition name="nb-ui-switch" mode="out-in">
            <form v-if="issued === undefined" key="form" id="admin-issue-form" ref="form" class="site-form" novalidate @submit.prevent="submit" @input="feedback.onEdited" @focusout="feedback.onLeave">
                <Field :label="t('admin.codes.issue.maxUses')" :error="fieldError('maxUses')">
                    <Input v-model="maxUses" name="maxUses" inputmode="numeric" :placeholder="t('admin.codes.issue.maxUsesPlaceholder')" autocomplete="off" />
                </Field>
                <Field :label="t('admin.codes.issue.expiresAt')" :description="t('admin.codes.issue.expiresAtHint')" :error="fieldError('expiresAt')">
                    <DateInput v-model="expiresAt" :aria-label="t('admin.codes.issue.expiresAt')" data-site-admin-issue-expires />
                </Field>
                <Field :label="t('admin.codes.issue.note')" :error="fieldError('note')">
                    <Input v-model="note" name="note" :placeholder="t('admin.codes.issue.notePlaceholder')" :maxlength="REGISTRATION_CODE_NOTE.maxLength" autocomplete="off" />
                </Field>
            </form>
            <div v-else key="issued">
                <p class="admin-issue__text">{{ t("admin.codes.issue.doneDescription") }}</p>
                <div class="admin-issue__code">
                    <code data-site-admin-issued-code>{{ issued.code }}</code>
                    <CopyButton :text="issued.code" />
                </div>
            </div>
        </Transition>
        <template #footer="{cancel}">
            <Transition name="nb-ui-switch" mode="out-in">
                <div v-if="issued === undefined" key="form" class="admin-dialog-buttons">
                    <Button variant="secondary" :disabled="submitting" @click="cancel">{{ t("admin.list.cancel") }}</Button>
                    <Button variant="primary" type="submit" form="admin-issue-form" :disabled="!canSubmit" :loading="submitting" data-site-admin-issue-submit>{{ t("admin.codes.issue.submit") }}</Button>
                </div>
                <div v-else key="issued" class="admin-dialog-buttons">
                    <Button variant="primary" data-site-admin-issue-finish @click="cancel">{{ t("admin.list.done") }}</Button>
                </div>
            </Transition>
        </template>
    </Dialog>
</template>

<style scoped>
.admin-issue__text {
    margin: 0;
    color: var(--text-secondary);
}

.admin-issue__code {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 14px;
    padding: 10px 12px;
    border: var(--border-w) solid var(--border-color);
    border-radius: var(--radius-control);
    background: var(--bg-input);
}

.admin-issue__code code {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    font-family: var(--font-mono);
    font-size: var(--text-md);
    user-select: all;
}
</style>
