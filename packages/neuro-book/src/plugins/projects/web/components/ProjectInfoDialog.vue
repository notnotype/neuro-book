<script setup lang="ts">
/**
 * 作品信息对话框（同名 .md）：新建作品与编辑信息共用的模态 `Dialog`。只收集输入；提交交给宿主。
 *
 * 校验不在字段下插字（表单会跟着重排）：能事先防住的（书名空着、新建时没有位置）让确认按钮不可用；提交之后才知道的
 * （宿主经 `fieldErrors` 放回的服务端拒绝、选的封面文件不合规）把字段标红、焦点移过去，原因写在页脚的状态行。
 * 别的失败由宿主发通知。
 *
 * 点遮罩关闭只在没改过时生效：改过之后误点一下空白就丢掉一整页输入，代价太大；Esc 与“取消”照常关闭。
 *
 * 主题色与保存位置两个字段不用 `Field`：它的根是 `<label>`，点到标签里的空白会把点击转给第一个可标记的控件，色板里那就是
 * “自动”那一格；这两个字段自己画标签行。
 */
import {Button, ColorSwatches, Dialog, Field, Input, Textarea, InfoTip} from "@notnotype/nb-ui/components";
import type {DialogCloseReason} from "@notnotype/nb-ui/components";
import {computed, nextTick, ref, useId, watch} from "vue";

import {PROJECT_COLOR_PATTERN, PROJECT_DESCRIPTION_MAX_LENGTH, PROJECT_TITLE_MAX_LENGTH} from "../../shared/contracts";
import {PROJECT_COVER_MAX_BYTES} from "../../shared/cover";
import {projectDirectoryName} from "../../shared/directory-name";
import {useProjectsText} from "../text";
import type {ProjectCoverChange, ProjectInfoField, ProjectInfoValues} from "../shelf-page";
import {autoBookColor, BOOK_PALETTE} from "../shelf-format";
import BookCover from "./BookCover.vue";

defineOptions({name: "ProjectInfoDialog", inheritAttrs: false});

export interface ProjectInfoSubmit extends ProjectInfoValues {
    /** 新建时作品放在哪个目录下；编辑时为 null。 */
    parent: string | null;
    cover: ProjectCoverChange;
}

const props = withDefaults(defineProps<{
    open: boolean;
    mode: "create" | "edit";
    /** 打开时的初值；每次打开重新取。 */
    initial?: ProjectInfoValues & {readonly coverSrc?: string | null; readonly id?: string};
    busy?: boolean;
    /** 新建时作品放在哪（受控，`update:location`）；编辑时不用。 */
    location?: string;
    /** 服务端针对某个字段的拒绝，已按当前语言写好。 */
    fieldErrors?: Partial<Record<ProjectInfoField, string>>;
}>(), {initial: () => ({title: "", description: "", color: null, coverSrc: null}), busy: false, location: "", fieldErrors: () => ({})});

const emit = defineEmits<{
    (event: "submit", values: ProjectInfoSubmit): void;
    (event: "cancel"): void;
    (event: "update:location", path: string): void;
    /** 用户要用目录选择器换位置。 */
    (event: "browse-location"): void;
}>();

/** 色板就是作品色板的八色，“自动”也从这八色里取（见 shelf-format.ts）。 */
const SWATCHES = BOOK_PALETTE;
const COVER_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const text = useProjectsText();
const length = (value: string): number => Array.from(value).length;

const uid = useId();
const title = ref("");
const description = ref("");
const color = ref<string | null>(null);
const coverChange = ref<ProjectCoverChange>({kind: "keep"});
const coverPreview = ref<string | null>(null);
const coverProblem = ref("");
const fileInput = ref<HTMLInputElement | null>(null);
const formRef = ref<HTMLFormElement | null>(null);
/** 打开时的值：判断“改过没有”用。 */
const opened = ref({title: "", description: "", color: null as string | null, location: ""});

// 每次打开按初值重置：上次的输入与校验结果不带到下一次。
watch(() => props.open, (open) => {
    if (!open) return;
    title.value = props.initial.title;
    description.value = props.initial.description;
    color.value = props.initial.color;
    coverChange.value = {kind: "keep"};
    revokePreview();
    coverProblem.value = "";
    opened.value = {title: props.initial.title, description: props.initial.description, color: props.initial.color, location: props.location};
}, {immediate: true});

/** 书名、简介、主题色、保存位置与封面任一和打开时不同。 */
const dirty = computed(() => title.value !== opened.value.title
    || description.value !== opened.value.description
    || color.value !== opened.value.color
    || (props.mode === "create" && props.location !== opened.value.location)
    || coverChange.value.kind !== "keep");

function onRequestClose(reason: DialogCloseReason): void {
    if (reason === "overlay" && dirty.value) return;
    emit("cancel");
}

function revokePreview(): void {
    if (coverPreview.value !== null) URL.revokeObjectURL(coverPreview.value);
    coverPreview.value = null;
}

const windowTitle = computed(() => text(props.mode === "create" ? "projectInfo.createTitle" : "projectInfo.editTitle"));
const confirmLabel = computed(() => text(props.mode === "create" ? "projectInfo.create" : "projectInfo.save"));
const previewTitle = computed(() => (title.value.trim() === "" ? text("projectInfo.title") : title.value.trim()));
const coverSrc = computed(() => (coverChange.value.kind === "remove" ? null : coverPreview.value ?? props.initial.coverSrc ?? null));
const hasCover = computed(() => coverSrc.value !== null);
/** 由书名生成的文件夹名，作路径框的后缀实时变化。 */
const folderName = computed(() => (title.value.trim() === "" ? "" : projectDirectoryName(title.value.trim())));
const locationValue = computed(() => props.location.replace(/[/\\]+$/u, ""));
/** 计数只在接近上限时出现，表单平时保持干净。 */
const titleCount = computed(() => (length(title.value) >= PROJECT_TITLE_MAX_LENGTH * 0.8 ? `${String(length(title.value))} / ${String(PROJECT_TITLE_MAX_LENGTH)}` : ""));
const descriptionCount = computed(() => (length(description.value) >= PROJECT_DESCRIPTION_MAX_LENGTH * 0.8 ? `${String(length(description.value))} / ${String(PROJECT_DESCRIPTION_MAX_LENGTH)}` : ""));
const errorOf = (field: ProjectInfoField): string => props.fieldErrors[field] ?? "";
/** 页脚状态行：一次一条，先字段的拒绝、再封面文件的问题。 */
const status = computed(() => errorOf("title") || errorOf("location") || errorOf("description") || coverProblem.value);

const FIELD_CONTROLS: Record<ProjectInfoField, string> = {
    title: "input[data-project-title], [data-project-title] input",
    location: "input[data-project-location-input], [data-project-location-input] input",
    description: "textarea[data-project-description], [data-project-description] textarea",
};

// 服务端拒绝了某个字段：焦点移到它上面，读屏随之念出原因（字段的 aria-describedby 指向它）。
watch(() => props.fieldErrors, async (errors) => {
    const field = (["title", "location", "description"] as const).find((name) => errors[name] !== undefined);
    if (field === undefined) return;
    await nextTick();
    formRef.value?.querySelector<HTMLElement>(FIELD_CONTROLS[field])?.focus();
});
/** “自动”色块画的就是封面现在用的那个自动色。 */
const autoColor = computed(() => autoBookColor(props.initial.id ?? "new"));

function chooseCover(): void {
    fileInput.value?.click();
}

function onCoverFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file === undefined) return;
    if (!COVER_TYPES.has(file.type)) {
        coverProblem.value = text("projectInfo.coverType");
        return;
    }
    if (file.size > PROJECT_COVER_MAX_BYTES) {
        coverProblem.value = text("projectInfo.coverTooLarge");
        return;
    }
    coverProblem.value = "";
    revokePreview();
    coverPreview.value = URL.createObjectURL(file);
    coverChange.value = {kind: "set", file};
}

function removeCover(): void {
    revokePreview();
    coverProblem.value = "";
    coverChange.value = {kind: "remove"};
}

/**
 * 能提交时的值；不能提交时为 null，确认按钮不可用。规则与服务端相同（服务端仍是最终判定）：长度平时由输入上限挡住，
 * 颜色只从色板与取色面板来，这里再核一遍。
 */
const submittable = computed<ProjectInfoSubmit | null>(() => {
    const trimmedTitle = title.value.trim();
    if (trimmedTitle === "" || length(trimmedTitle) > PROJECT_TITLE_MAX_LENGTH) return null;
    if (length(description.value) > PROJECT_DESCRIPTION_MAX_LENGTH) return null;
    if (color.value !== null && !PROJECT_COLOR_PATTERN.test(color.value)) return null;
    if (props.mode === "create" && locationValue.value.trim() === "") return null;
    return {title: trimmedTitle, description: description.value.trim(), color: color.value, parent: props.mode === "create" ? locationValue.value : null, cover: coverChange.value};
});

function onConfirm(): void {
    if (props.busy || submittable.value === null) return;
    emit("submit", submittable.value);
}
</script>

<template>
    <Dialog
        :model-value="open"
        :title="windowTitle"
        size="lg"
        :width="700"
        :busy="busy"
        :status="status"
        :initial-focus="`[id='${uid}-title']`"
        body-class="project-info__body"
        @request-close="onRequestClose"
    >
        <form ref="formRef" class="project-info" data-project-info @submit.prevent="onConfirm">
            <div class="project-info__side">
                <div class="project-info__cover">
                    <BookCover :id="initial.id ?? 'new'" :title="previewTitle" :color="color" :src="coverSrc" :width="150" />
                    <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" hidden data-project-cover-input @change="onCoverFile">
                    <div class="project-info__cover-actions">
                        <Button variant="ghost" size="sm" :disabled="busy" data-project-cover-pick @click="chooseCover">{{ text(hasCover ? 'projectInfo.replaceCover' : 'projectInfo.uploadCover') }}</Button>
                        <InfoTip :text="text('projectInfo.coverHint')" :label="text('projectInfo.coverInfo')" side="bottom" />
                    </div>
                    <Button v-if="hasCover" variant="ghost" size="sm" :disabled="busy" data-project-cover-remove @click="removeCover">{{ text('projectInfo.removeCover') }}</Button>
                </div>
                <div class="project-info__field project-info__field--plain">
                    <span :id="`${uid}-color`" class="project-info__label">
                        <span>{{ text('projectInfo.color') }}</span>
                        <InfoTip :text="text('projectInfo.colorHint')" :label="text('projectInfo.colorInfo')" />
                    </span>
                    <ColorSwatches
                        :model-value="color"
                        :colors="SWATCHES"
                        :auto-label="text('projectInfo.auto')"
                        :auto-color="autoColor"
                        :custom-label="text('projectInfo.custom')"
                        :columns="5"
                        :label="text('projectInfo.color')"
                        :disabled="busy"
                        data-project-color
                        @update:model-value="(value: string | null) => { color = value; }"
                    />
                </div>
            </div>
            <div class="project-info__fields">
                <div class="project-info__field">
                    <Field :for="`${uid}-title`" :label="text('projectInfo.title')" required :error="errorOf('title')">
                        <Input v-model="title" :maxlength="PROJECT_TITLE_MAX_LENGTH" :disabled="busy" data-project-title />
                    </Field>
                    <span v-if="titleCount !== ''" class="project-info__count">{{ titleCount }}</span>
                </div>
                <div class="project-info__field project-info__field--grow">
                    <Field :label="text('projectInfo.description')" :error="errorOf('description')">
                        <Textarea v-model="description" :rows="3" :maxlength="PROJECT_DESCRIPTION_MAX_LENGTH" :placeholder="text('projectInfo.descriptionPlaceholder')" :disabled="busy" class="project-info__description" data-project-description />
                    </Field>
                    <span v-if="descriptionCount !== ''" class="project-info__count">{{ descriptionCount }}</span>
                </div>
                <div v-if="mode === 'create'" class="project-info__field project-info__field--plain">
                    <label :for="`${uid}-location`" class="project-info__label">
                        <span>{{ text('projectInfo.location') }}</span>
                        <InfoTip :text="text('projectInfo.locationHint')" :label="text('projectInfo.locationInfo')" />
                    </label>
                    <!-- 没有标题的 Field：只为让路径框随服务端的拒绝标红；标签行在上面自己画（要放说明图标）。 -->
                    <Field :for="`${uid}-location`" :error="errorOf('location')">
                        <div class="project-info__location" data-project-location>
                            <Input :model-value="location" :disabled="busy" class="project-info__path" data-project-location-input @update:model-value="emit('update:location', $event)">
                                <template #suffix>
                                    <span v-if="folderName !== ''" class="project-info__folder" data-project-folder>/{{ folderName }}</span>
                                </template>
                            </Input>
                            <Button variant="secondary" :disabled="busy" data-project-browse @click="emit('browse-location')">{{ text('projectInfo.browse') }}</Button>
                        </div>
                    </Field>
                </div>
            </div>
            <!-- 让回车提交；按钮本身在窗口页脚。 -->
            <button type="submit" hidden tabindex="-1" aria-hidden="true" />
        </form>
        <template #footer>
            <Button variant="secondary" :disabled="busy" data-project-cancel @click="emit('cancel')">{{ text('projectInfo.cancel') }}</Button>
            <Button variant="primary" :loading="busy" :disabled="submittable === null" data-project-confirm @click="onConfirm">{{ confirmLabel }}</Button>
        </template>
    </Dialog>
</template>

<style scoped>
/* 左栏：封面、封面操作与主题色（主题色改的就是封面，放在它下面改了立刻看到）；右栏：书名、简介、保存位置。
   两栏底部对齐：简介的输入框占满右栏剩下的高度。左栏与封面同宽（模板里 BookCover 的 width），主题色的标签与色板和封面
   左右对齐。 */
.project-info {
    display: grid;
    grid-template-columns: 150px minmax(0, 1fr);
    gap: var(--space-6);
}

.project-info__side {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.project-info__cover {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding-top: var(--space-1);
}

.project-info__cover-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
}

.project-info__fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.project-info__field {
    position: relative;
}

.project-info__field--grow {
    display: flex;
    flex: 1;
    flex-direction: column;
}

/* Field 的根是单根的 label，带着本组件的作用域属性；让它与里面的输入框一起撑开。 */
.project-info__field--grow > label {
    display: flex;
    flex: 1;
    flex-direction: column;
}

.project-info__description {
    flex: 1;
    min-height: 88px;
    resize: none;
}

/* 计数靠在标签行右端：标签由 Field 画，计数不占行。 */
.project-info__count {
    position: absolute;
    top: 0;
    right: 0;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.5;
}

.project-info__field--plain {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.project-info__label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-main);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
}

.project-info__location {
    display: flex;
    gap: var(--space-2);
    align-items: center;
}

.project-info__path {
    flex: 1;
    min-width: 0;
}

.project-info__folder {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    white-space: nowrap;
}

/* 窄时上下排：左栏仍与封面同宽、居中，色板不被拉到整行那么稀。 */
@container (max-width: 560px) {
    .project-info {
        grid-template-columns: minmax(0, 1fr);
    }

    .project-info__side {
        width: 150px;
        justify-self: center;
    }
}
</style>

<style>
/* 两栏改上下排的容器查询按正文宽度算；留白由对话框的面板一处给。 */
.project-info__body {
    container-type: inline-size;
}
</style>
