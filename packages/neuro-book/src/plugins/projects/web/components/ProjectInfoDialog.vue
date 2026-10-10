<script setup lang="ts">
/** 作品信息对话框（同名 .md）：新建与编辑信息共用；只收集与校验输入，提交的结果与服务端的失败原因由宿主给。 */
import {Button, ColorPicker, Dialog, FormField, FormInput, FormTextarea} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";

import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

import {PROJECT_COLOR_PATTERN, PROJECT_DESCRIPTION_MAX_LENGTH, PROJECT_TITLE_MAX_LENGTH} from "../../shared/contracts";

defineOptions({name: "ProjectInfoDialog"});

export interface ProjectInfoFormValues {
    title: string;
    description: string;
    color: string | null;
}

const props = withDefaults(defineProps<{
    locale: DisplayLocale;
    open: boolean;
    mode: "create" | "edit";
    /** 打开时的初值；每次打开重新取。 */
    initial?: ProjectInfoFormValues;
    /** 提交中：禁止再次提交与关闭。 */
    busy?: boolean;
    /** 宿主给的失败原因（服务端拒绝），已按当前语言写好。 */
    error?: string;
}>(), {initial: () => ({title: "", description: "", color: null}), busy: false, error: ""});

const emit = defineEmits<{
    (event: "submit", values: ProjectInfoFormValues): void;
    (event: "cancel"): void;
}>();

const TEXT = {
    createTitle: {"zh-CN": "新建作品", "en-US": "New Book"},
    editTitle: {"zh-CN": "编辑作品信息", "en-US": "Edit Book Info"},
    title: {"zh-CN": "书名", "en-US": "Title"},
    description: {"zh-CN": "简介", "en-US": "Description"},
    descriptionHint: {"zh-CN": "一两句话，显示在书架的扉页与列表里", "en-US": "A sentence or two, shown on the shelf"},
    color: {"zh-CN": "主题色", "en-US": "Color"},
    colorHint: {"zh-CN": "书脊的颜色；不指定时按作品取一档", "en-US": "The spine color; a hue is picked for the book when unset"},
    clearColor: {"zh-CN": "不指定", "en-US": "Unset"},
    create: {"zh-CN": "新建", "en-US": "Create"},
    save: {"zh-CN": "保存", "en-US": "Save"},
    cancel: {"zh-CN": "取消", "en-US": "Cancel"},
    titleRequired: {"zh-CN": "书名不能为空", "en-US": "The title is required"},
    titleTooLong: {"zh-CN": "书名至多 {max} 个字符", "en-US": "The title can have at most {max} characters"},
    descriptionTooLong: {"zh-CN": "简介至多 {max} 个字符", "en-US": "The description can have at most {max} characters"},
    colorInvalid: {"zh-CN": "颜色要写成 #rrggbb", "en-US": "The color must be #rrggbb"},
} satisfies Record<string, LocalizedText>;

const text = (value: LocalizedText): string => localize(value, props.locale);

const title = ref("");
const description = ref("");
const color = ref<string | null>(null);
const problems = ref<{title?: string; description?: string; color?: string}>({});

// 每次打开按初值重置：上次的输入与校验结果不带到下一次。
watch(() => props.open, (open) => {
    if (!open) return;
    title.value = props.initial.title;
    description.value = props.initial.description;
    color.value = props.initial.color;
    problems.value = {};
}, {immediate: true});

const dialogTitle = computed(() => text(props.mode === "create" ? TEXT.createTitle : TEXT.editTitle));
const confirmLabel = computed(() => text(props.mode === "create" ? TEXT.create : TEXT.save));

function onColor(value: string): void {
    color.value = value.toLowerCase();
}

/** 与服务端相同的规则先在本地校验，省一次往返；服务端仍是最终判定。 */
function validate(): ProjectInfoFormValues | null {
    const trimmedTitle = title.value.trim();
    const next: typeof problems.value = {};
    if (trimmedTitle === "") next.title = text(TEXT.titleRequired);
    else if (trimmedTitle.length > PROJECT_TITLE_MAX_LENGTH) next.title = text(formatText(TEXT.titleTooLong, {max: String(PROJECT_TITLE_MAX_LENGTH)}));
    if (description.value.length > PROJECT_DESCRIPTION_MAX_LENGTH) next.description = text(formatText(TEXT.descriptionTooLong, {max: String(PROJECT_DESCRIPTION_MAX_LENGTH)}));
    if (color.value !== null && !PROJECT_COLOR_PATTERN.test(color.value)) next.color = text(TEXT.colorInvalid);
    problems.value = next;
    if (Object.keys(next).length > 0) return null;
    return {title: trimmedTitle, description: description.value.trim(), color: color.value};
}

function onConfirm(): void {
    if (props.busy) return;
    const values = validate();
    if (values !== null) emit("submit", values);
}
</script>

<template>
    <Dialog
        :model-value="open"
        :title="dialogTitle"
        size="md"
        show-cancel
        :busy="busy"
        :cancel-label="text(TEXT.cancel)"
        :confirm-label="confirmLabel"
        body-class="project-info-dialog__body"
        @confirm="onConfirm"
        @request-close="emit('cancel')"
    >
        <form class="project-info-dialog" data-project-info-dialog @submit.prevent="onConfirm">
            <FormField :label="text(TEXT.title)" required :error="problems.title ?? ''">
                <FormInput v-model="title" :maxlength="PROJECT_TITLE_MAX_LENGTH" autofocus :disabled="busy" data-project-title />
            </FormField>
            <FormField :label="text(TEXT.description)" :description="text(TEXT.descriptionHint)" :error="problems.description ?? ''">
                <FormTextarea v-model="description" :rows="3" :maxlength="PROJECT_DESCRIPTION_MAX_LENGTH" :disabled="busy" data-project-description />
            </FormField>
            <FormField v-if="mode === 'edit'" :label="text(TEXT.color)" :description="text(TEXT.colorHint)" :error="problems.color ?? ''">
                <div class="project-info-dialog__color">
                    <ColorPicker :model-value="color ?? undefined" size="sm" :disabled="busy" @update:model-value="onColor" />
                    <span v-if="color !== null" class="project-info-dialog__swatch-text" data-project-color>{{ color }}</span>
                    <Button v-if="color !== null" variant="ghost" size="sm" :disabled="busy" @click="color = null">{{ text(TEXT.clearColor) }}</Button>
                </div>
            </FormField>
            <p v-if="error !== ''" class="project-info-dialog__error" role="alert" data-project-info-error>{{ error }}</p>
            <!-- 让回车提交；按钮本身由 Dialog 的页脚提供。 -->
            <button type="submit" hidden tabindex="-1" aria-hidden="true" />
        </form>
    </Dialog>
</template>

<style scoped>
.project-info-dialog {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.project-info-dialog__color {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.project-info-dialog__swatch-text {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
}

.project-info-dialog__error {
    margin: 0;
    color: var(--danger);
    font-size: var(--text-sm);
}
</style>
