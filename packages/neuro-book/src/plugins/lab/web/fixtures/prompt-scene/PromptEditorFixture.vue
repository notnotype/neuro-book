<script setup lang="ts">
/**
 * PromptEditor 的 Lab 夹具（docs/specs/ui/prompt-editor.md）。场景输入（草稿、触发字符、命令、粘贴设置等）可在数据 tab 编辑；
 * 夹具扮演宿主：把 change 写回草稿（同一版本，验证回声被忽略）、发送后清空并记入输入历史、假装上传附件（成功、失败或一直
 * 上传），并提供菜单数据：`@` 没输入时列目录、输入了按目录分组搜索，`$` 技能先“正在加载”再换一个新的 resolveMenu，`/` 命令
 * 只在开头有效。上传完成时给出会话附件地址 `session://attachments/名称`。“模拟”一栏用合成的粘贴事件放入图片、文件与大段文字。按钮带
 * `data-lab-action` 供 e2e 定位。由旧应用的夹具移植（分支 `archive/legacy-ui-tuning`，`865c9f593`）。
 */
import {Button} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, ref} from "vue";

import {provideMarkdownHost} from "@notnotype/nb-markdown/host";
import {PromptEditor} from "@notnotype/nb-markdown/prompt";
import type {PromptEditorAttachment, PromptEditorAttachmentKind, PromptEditorDraft, PromptEditorExpose, PromptEditorMenu, PromptEditorMenuContext} from "@notnotype/nb-markdown/prompt";

import {nbookMarkdownHost} from "nbook/plugins/markdown/web/host";

import {useLabSubject, type LabFixtureProps} from "../../lab-subject";
import LabFixtureControls from "../../LabFixtureControls.vue";
import {referenceMenu, skillMenu} from "./menu";
import {PROMPT_LAB_THUMBNAILS} from "./scenes";

const props = defineProps<LabFixtureProps>();
// 与应用里交出的组件一样用 nbook 的宿主：作品文件的引用是带文件图标的文件小块。
provideMarkdownHost(nbookMarkdownHost({}));

const subject = useLabSubject<typeof PromptEditor>(() => props.input, [
    "change",
    "submit",
    "escape",
    "shift-tab",
    "focus",
    "blur",
    "menu-open",
    "token-activate",
    "attachment-add",
    "attachment-retry",
    "attachment-remove",
    "attachment-reject",
]);

const editorRef = ref<PromptEditorExpose | null>(null);
const bindings = computed(() => subject.bindings.value);
const draft = computed(() => bindings.value.draft as PromptEditorDraft);
const attachments = computed(() => (bindings.value.attachments ?? []) as readonly PromptEditorAttachment[]);

const timers = new Set<ReturnType<typeof setTimeout>>();

function later(ms: number, run: () => void): void {
    const timer = setTimeout(() => {
        timers.delete(timer);
        run();
    }, ms);
    timers.add(timer);
}

onBeforeUnmount(() => {
    timers.forEach((timer) => clearTimeout(timer));
});

// 草稿与发送

const SAMPLE_DRAFTS = [
    "换一份草稿：看 [第二章 旧钟](/正文/第二章.md) 的结尾，$reviewer 给出修改意见。",
    "/rename 雨夜钟表铺",
];
let sampleIndex = 0;

function writeDraft(text: string, bumpVersion: boolean): void {
    subject.write("props", "draft", {text, version: draft.value.version + (bumpVersion ? 1 : 0)});
}

function onSubmit(): void {
    const text = draft.value.text;
    if (!text.trim()) return;
    subject.write("props", "recall", [text, ...((bindings.value.recall ?? []) as readonly string[])]);
    writeDraft("", true);
}

function replaceDraft(): void {
    writeDraft(SAMPLE_DRAFTS[sampleIndex % SAMPLE_DRAFTS.length] as string, true);
    sampleIndex += 1;
}

// 假上传

type UploadMode = "success" | "fail" | "hang";
const UPLOAD_MODES: ReadonlyArray<{mode: UploadMode; label: string}> = [{mode: "success", label: "成功"}, {mode: "fail", label: "失败"}, {mode: "hang", label: "一直上传"}];
const UPLOAD_DELAY_MS = 900;
const uploadMode = ref<UploadMode>("success");
/** 宿主给的会话附件地址：文件名去掉空白与括号，重名时加序号。 */
const usedNames = new Set<string>();
const fileNames = new Map<string, string>();

function fakeTarget(localId: string): string {
    const name = (fileNames.get(localId) ?? "file").replace(/[\s()[\]]+/gu, "-");
    const dot = name.lastIndexOf(".");
    const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    let unique = name;
    for (let index = 2; usedNames.has(unique); index += 1) unique = `${stem}-${String(index)}${extension}`;
    usedNames.add(unique);
    return `session://attachments/${unique}`;
}

function writeAttachments(next: PromptEditorAttachment[]): void {
    subject.write("props", "attachments", next);
}

function settle(localId: string, mode: UploadMode): void {
    if (mode === "hang") return;
    later(UPLOAD_DELAY_MS, () => {
        if (!attachments.value.some((item) => item.localId === localId)) return;
        writeAttachments(attachments.value.map((item) => item.localId !== localId
            ? item
            : mode === "success" ? {localId, state: "ready", target: fakeTarget(localId)} : {localId, state: "failed", error: "网络中断，没有上传"}));
    });
}

function onAttachmentAdd(payload: {localId: string; kind: PromptEditorAttachmentKind; file: File}): void {
    fileNames.set(payload.localId, payload.file.name);
    writeAttachments([...attachments.value, {localId: payload.localId, state: "uploading"}]);
    settle(payload.localId, uploadMode.value);
}

function onAttachmentRetry(payload: {localId: string}): void {
    writeAttachments(attachments.value.map((item) => item.localId === payload.localId ? {localId: item.localId, state: "uploading"} : item));
    settle(payload.localId, "success");
}

function onAttachmentRemove(payload: {localId: string}): void {
    writeAttachments(attachments.value.filter((item) => item.localId !== payload.localId));
}

const resolveThumbnail = (target: string): string | null => PROMPT_LAB_THUMBNAILS[target] ?? null;

// 菜单数据

const COMMANDS = [
    {name: "plan", description: "先制定计划再动手"},
    {name: "compact", description: "压缩上下文"},
    {name: "clear", description: "运行中不能清空", disabled: true},
    {name: "rename", description: "重命名会话"},
];

const skillsLoaded = ref(false);

/** 宿主的数据到达时换一个新的函数，编辑器据此按当前查询重新取菜单。 */
const resolveMenu = computed(() => {
    const loaded = skillsLoaded.value;
    return (context: PromptEditorMenuContext): PromptEditorMenu => {
        if (context.trigger === "@") return referenceMenu(context.query);
        if (context.trigger === "$") return skillMenu(loaded, context.query);
        if (context.trigger === "/") {
            if (!context.atStart) return {items: [], emptyText: "命令只能写在正文开头"};
            return {
                title: "命令",
                items: COMMANDS.filter((command) => command.name.includes(context.query.toLowerCase())).map((command) => ({
                    id: command.name, label: `/${command.name}`, description: command.description, iconClass: "i-lucide-square-slash", disabled: command.disabled, insertText: `/${command.name}`,
                })),
            };
        }
        return {items: []};
    };
});

function onMenuOpen(payload: {trigger: string}): void {
    if (payload.trigger === "$" && !skillsLoaded.value) later(700, () => (skillsLoaded.value = true));
}

// 模拟输入

const rootRef = ref<HTMLElement | null>(null);

const lines = (count: number): string => Array.from({length: count}, (_, index) => `line ${String(index + 1).padStart(3, "0")}: clock.tick(${String(index)});`).join("\n");

/** 合成一次粘贴：先聚焦正文，再在正文元素上派发带剪贴板数据的 paste 事件。 */
function simulatePaste(fill: (data: DataTransfer) => void): void {
    editorRef.value?.focus();
    const target = rootRef.value?.querySelector(".ProseMirror");
    if (!target) return;
    const data = new DataTransfer();
    fill(data);
    target.dispatchEvent(new ClipboardEvent("paste", {clipboardData: data, bubbles: true, cancelable: true}));
}

function pasteImage(): void {
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'><rect width='80' height='80' fill='#cfd8e3'/><circle cx='40' cy='40' r='22' fill='#7a5c9e'/></svg>";
    simulatePaste((data) => data.items.add(new File([svg], "截图.svg", {type: "image/svg+xml"})));
}

function pastePdf(): void {
    simulatePaste((data) => data.items.add(new File(["%PDF-1.4 lab"], "采访记录.pdf", {type: "application/pdf"})));
}

function pasteText(count: number): void {
    simulatePaste((data) => data.setData("text/plain", lines(count)));
}

function openMenu(trigger: string): void {
    editorRef.value?.focus();
    editorRef.value?.insertText(trigger);
}
</script>

<template>
    <div ref="rootRef" class="h-full w-full">
        <div class="h-full" :class="bindings.bare ? 'rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)]' : ''" data-lab-host="bare 时外框由宿主画：Agent 输入框的外框">
            <PromptEditor
                ref="editorRef"
                data-lab-subject
                v-bind="bindings"
                :resolve-menu="resolveMenu"
                :resolve-thumbnail="resolveThumbnail"
                @change="(text: string) => writeDraft(text, false)"
                @submit="onSubmit"
                @menu-open="onMenuOpen"
                @attachment-add="onAttachmentAdd"
                @attachment-retry="onAttachmentRetry"
                @attachment-remove="onAttachmentRemove"
            />
        </div>
    </div>
    <LabFixtureControls>
        <div class="flex flex-col gap-2 text-xs">
            <div class="flex flex-wrap items-center gap-2">
                <span class="text-[var(--text-secondary)]">草稿</span>
                <Button size="sm" variant="ghost" data-lab-action="clear" @click="writeDraft('', true)">清空（新版本）</Button>
                <Button size="sm" variant="ghost" data-lab-action="replace" @click="replaceDraft">换一份</Button>
                <Button size="sm" variant="ghost" data-lab-action="insert" @click="editorRef?.insertText('$writer ')">插入文字</Button>
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <span class="text-[var(--text-secondary)]">模拟</span>
                <Button size="sm" variant="ghost" data-lab-action="menu-at" @click="openMenu('@')">@ 菜单</Button>
                <Button size="sm" variant="ghost" data-lab-action="menu-skill" @click="openMenu('$')">$ 菜单</Button>
                <Button size="sm" variant="ghost" data-lab-action="paste-image" @click="pasteImage">粘贴图片</Button>
                <Button size="sm" variant="ghost" data-lab-action="paste-pdf" @click="pastePdf">粘贴 PDF</Button>
                <Button size="sm" variant="ghost" data-lab-action="paste-medium" @click="pasteText(30)">粘贴 30 行</Button>
                <Button size="sm" variant="ghost" data-lab-action="paste-large" @click="pasteText(150)">粘贴 150 行</Button>
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <span class="text-[var(--text-secondary)]">上传</span>
                <Button v-for="option in UPLOAD_MODES" :key="option.mode" size="sm" :variant="uploadMode === option.mode ? 'secondary' : 'ghost'" :data-lab-action="`upload-${option.mode}`" @click="uploadMode = option.mode">{{ option.label }}</Button>
                <Button size="sm" variant="ghost" data-lab-action="reset-skills" @click="skillsLoaded = false">技能改回未加载</Button>
            </div>
        </div>
    </LabFixtureControls>
</template>
