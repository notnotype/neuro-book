<script setup lang="ts">
import {computed, nextTick, ref, watch} from "vue";
import {Button, DropdownMenu, IconButton} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData} from "@notnotype/nb-ui/components";
import type {
    PromptAttachmentKind,
    PromptEditorPortExpose,
    PromptMenu,
    PromptMenuContext,
    PromptToken,
} from "../../ports";
import type {AgentConversationContext, AgentConversationServices} from "../../types";
import {visibleEntries, type AgentViewRegistry, type ToolbarButtonEntry} from "../../registry";
import {commandMenu, nextMode, resolveSubmission, sendBlockedReason} from "../../composer-actions";
import AgentContextMeter from "./AgentContextMeter.vue";
import AgentModelPicker from "./AgentModelPicker.vue";
import AgentRoleModelPicker from "./AgentRoleModelPicker.vue";
import AgentQueuedMessages from "./AgentQueuedMessages.vue";
import {useAgentRenderers, useAgentText} from "../host";
import {useEditorHandle} from "./use-editor-handle";
import {tokenAction, type ViewAction} from "../view-action";

const props = withDefaults(defineProps<{
    ctx: AgentConversationContext;
    services: AgentConversationServices;
    registry: AgentViewRegistry;
    /** `stacked`：正文在上、工具栏在下（缺省）；`inline`：正文与控件同一行（见同名 .md 的“单行版式”）。 */
    layout?: "stacked" | "inline";
}>(), {
    layout: "stacked",
});

const emit = defineEmits<{
    (e: "action", action: ViewAction): void;
}>();

const {t, text, locale} = useAgentText();
const renderers = useAgentRenderers();

const {editorRef, withEditor} = useEditorHandle<PromptEditorPortExpose>();
const fileInputRef = ref<HTMLInputElement | null>(null);

const composer = computed(() => props.ctx.composer);
const running = computed(() => props.ctx.run.status !== "idle");
const readonly = computed(() => props.ctx.availability.status !== "ready" || !props.ctx.interaction.canSend);
const frameRef = ref<HTMLElement | null>(null);
/** 模型解析不了（`profile-unavailable`）时还得能在这里改模型，否则走不出来；别的不可用都不能改。 */
const runtimeDisabled = computed(() => !props.ctx.interaction.canChangeRuntime || !props.ctx.interaction.canSend || !["ready", "profile-unavailable"].includes(props.ctx.availability.status));

// ─── 登记项 ─────────────────────────────────────────────────────────────

const commands = computed(() => visibleEntries(props.registry.list("commands"), props.ctx));
const commandNames = computed(() => commands.value.map((entry) => entry.name));
// 没有 resolveTriggerMenu 时只剩 `/` 命令：别的触发字符没有菜单可开，不交给编辑器，免得打开空菜单。
const triggers = computed(() => visibleEntries(props.registry.list("triggers"), props.ctx)
    .map((entry) => entry.char)
    .filter((char) => char === "/" || props.services.resolveTriggerMenu !== undefined));
const toolbarButtons = computed(() => visibleEntries(props.registry.list("toolbarButtons"), props.ctx));
const leadingButtons = computed(() => toolbarButtons.value.filter((button) => button.placement === "leading"));
const trailingButtons = computed(() => toolbarButtons.value.filter((button) => button.placement !== "leading"));

/** 带 `trigger` 的按钮往编辑器里插触发字符、打开它的菜单（编辑器负责聚焦与补空格），其余发出登记的 action。 */
function onToolbarButton(button: ToolbarButtonEntry): void {
    if (button.trigger !== undefined) {
        const trigger = button.trigger;
        withEditor((editor) => editor.openTrigger(trigger));
    }
    else if (button.action !== undefined) emit("action", button.action);
}

/**
 * 编辑器在函数身份变化时按当前查询重新取菜单：宿主换了 resolveTriggerMenu、登记的命令或界面语言变了，
 * 这里都会给出新函数。
 */
const resolveMenu = computed(() => {
    const resolve = props.services.resolveTriggerMenu;
    const list = commands.value.map((entry) => ({
        id: entry.id,
        name: entry.name,
        description: text(entry.description),
        argsHint: entry.argsHint === undefined ? null : text(entry.argsHint),
    }));
    const labels = {title: t("composer.commandMenu.title"), empty: t("composer.commandMenu.empty")};
    return (context: PromptMenuContext): PromptMenu => context.trigger === "/" && context.atStart
        ? commandMenu(list, context.query, labels)
        : resolve?.(context) ?? fallbackMenu(context);
});

/**
 * 宿主没有 resolveTriggerMenu 时编辑器只拿到 `/`；它在正文中间也会打开菜单（编辑器不区分位置），这时说明命令要写在开头，
 * 不给一个只写“无匹配”的空菜单。
 */
function fallbackMenu(context: PromptMenuContext): PromptMenu {
    return context.trigger === "/" ? {items: [], emptyText: t("composer.commandMenu.notAtStart")} : {items: []};
}

// ─── 正文与发送 ─────────────────────────────────────────────────────────

/**
 * 被拒收时的说明；手动关闭、发送或宿主换了草稿时消失。不跟着 change 消失：附件就绪时编辑器把标签写回文字也会发出 change，
 * 提示会在用户读到之前就没了。
 */
const rejectNotice = ref<string | null>(null);

/** 编辑器最新的文字；宿主换草稿版本时以草稿为准。只用来决定发送按钮是不是停止。 */
const currentText = ref(composer.value.draft.text);

watch(() => composer.value.draft.version, () => {
    currentText.value = composer.value.draft.text;
    rejectNotice.value = null;
});

/**
 * 编辑器发出过、还没移除的附件。没就绪的附件不在文字里，这时发送附件就丢了，所以有它们时不能发送；
 * 就绪后编辑器把标签写回文字，宿主随后可以把它从 attachments 里去掉，这里也就不再记它。
 */
const liveAttachments = ref(new Set<string>());

const attachmentStates = computed(() => new Map(composer.value.attachments.map((item) => [item.localId, item])));

watch(attachmentStates, (states) => {
    const ready = [...liveAttachments.value].filter((localId) => states.get(localId)?.state === "ready");
    if (ready.length > 0) {
        liveAttachments.value = new Set([...liveAttachments.value].filter((localId) => !ready.includes(localId)));
    }
});

const blockedReason = computed(() => {
    switch (sendBlockedReason(liveAttachments.value, attachmentStates.value)) {
        case "failed": return t("composer.blockedFailed");
        case "uploading": return t("composer.blockedUploading");
        case null: return null;
    }
});

const deliveries = computed(() => ({steer: props.ctx.interaction.canSteer, followup: props.ctx.interaction.canQueue}));

/** 按当前文字算出一次发送的结果；按钮按回车的规则发，所以 mod 为假。 */
function resolve(mod: boolean) {
    return resolveSubmission({text: currentText.value, mod, running: running.value, commands: commandNames.value, deliveries: deliveries.value});
}

const showStop = computed(() => running.value && currentText.value.trim() === "" && props.ctx.interaction.canStop);
// 运行中两种投递都不允许时能写不能发；登记的命令不受限制，所以按算出的结果判断，不只看开关。
const sendDisabled = computed(() => readonly.value || blockedReason.value !== null || (resolve(false) === null && !resuming.value));
const showResume = computed(() => resuming.value && currentText.value.trim() === "");

const sendTitle = computed(() => {
    if (showStop.value) {
        return t("composer.stop");
    }
    if (blockedReason.value !== null) return blockedReason.value;
    if (showResume.value) return t("composer.resume");
    // 运行中也照常执行的命令：标题写“发送”，不写“运行结束后发送”。
    if (!running.value || resolve(false)?.kind === "command") return t("composer.send");
    if (deliveries.value.steer) return t("composer.sendRunning");
    return deliveries.value.followup ? t("composer.sendQueued") : t("composer.sendAfterRun");
});

/** 上次运行被中断：空着也能发，发出去就是继续（docs/specs/agent/conversation.md 输出 9）。 */
const resuming = computed(() => composer.value.resume === true && !running.value);

const placeholder = computed(() => {
    if (resuming.value) return t("composer.placeholderResume");
    if (!running.value) return t("composer.placeholder");
    const {steer, followup} = deliveries.value;
    if (steer && followup) return t("composer.placeholderRunning");
    if (steer) return t("composer.placeholderRunningSteer");
    return followup ? t("composer.placeholderRunningQueue") : t("composer.placeholderRunningNone");
});

function onChange(value: string): void {
    currentText.value = value;
    emit("action", {type: "composer.draftChanged", text: value});
}

/** 发送后不清空：宿主受理后给出新版本的空草稿，发送失败时文字就不会丢。 */
function submit(mod: boolean): void {
    if (readonly.value || blockedReason.value !== null) {
        return;
    }
    // 展开时回车是换行，Ctrl/⌘+回车是唯一的键盘发送；不允许排队时它按回车的规则发（补充说明），否则只许补充说明的宿主没法用键盘发送。
    if (showResume.value) {
        emit("action", {type: "run.continue"});
        return;
    }
    const result = resolve(mod && !(expanded.value && !deliveries.value.followup));
    if (result !== null) {
        rejectNotice.value = null;
    }
    if (result?.kind === "command") {
        emit("action", {type: "command.run", name: result.name, argsText: result.argsText});
    }
    else if (result?.kind === "message") {
        emit("action", {type: "composer.submit", text: result.text, delivery: result.delivery});
    }
}

function onPrimaryButton(): void {
    if (showStop.value) {
        emit("action", {type: "composer.stop"});
        return;
    }
    submit(false);
}

// ─── 运行设置 ───────────────────────────────────────────────────────────

const currentMode = computed(() => composer.value.modes.find((mode) => mode.key === composer.value.mode) ?? composer.value.modes[0] ?? null);
const modeIsDefault = computed(() => currentMode.value === null || currentMode.value.key === composer.value.modes[0]?.key);

function cycleMode(): void {
    if (runtimeDisabled.value) {
        return;
    }
    const next = nextMode(composer.value.modes, composer.value.mode);
    if (next !== null) {
        emit("action", {type: "mode.set", mode: next});
    }
}

const approvalMenu = computed<DropdownMenuItemData[]>(() => (composer.value.approval?.options ?? []).map((option) => ({
    id: option.key,
    label: text(option.label),
    title: text(option.description),
    iconClass: option.icon,
    type: "radio",
    group: "approval",
    checked: option.key === composer.value.approval?.value,
    ...(option.danger === true ? {tone: "danger" as const} : {}),
})));
const currentApproval = computed(() => composer.value.approval?.options.find((option) => option.key === composer.value.approval?.value) ?? null);

function descriptionOf(id: string): string {
    const option = composer.value.approval?.options.find((item) => item.key === id);
    return option === undefined ? "" : text(option.description);
}

// ─── 附件 ───────────────────────────────────────────────────────────────

const currentModel = computed(() => composer.value.models.find((model) => model.key === composer.value.modelKey) ?? null);
// 缺省的普通文本框收不了附件（host.ts 的 plainEditor）。
const acceptFiles = computed(() => props.ctx.interaction.canRegisterAttachments && !renderers.value.plainEditor);
const acceptImages = computed(() => acceptFiles.value && (currentModel.value?.supportsImages ?? false));

// ─── 单行版式 ───────────────────────────────────────────────────────────

/** 单行版式没有附件条的位置：宿主收附件时退回两层。 */
const inline = computed(() => props.layout === "inline" && !acceptFiles.value);
/** 上下文大小只在单行版式里画（两层版式的宿主由状态栏显示用量）；不知道窗口或还没有用量时不画。 */
const contextMeter = computed(() => {
    const {contextTokens, contextLimit} = props.ctx.usage;
    return inline.value && contextLimit !== null && contextLimit > 0 && contextTokens > 0 ? {used: contextTokens, limit: contextLimit} : null;
});

function onAttachmentAdd(payload: {localId: string; kind: PromptAttachmentKind; file: File}): void {
    liveAttachments.value = new Set(liveAttachments.value).add(payload.localId);
    emit("action", {type: "composer.attachmentAdded", localId: payload.localId, kind: payload.kind, file: payload.file});
}

function onAttachmentRemove(payload: {localId: string}): void {
    const next = new Set(liveAttachments.value);
    next.delete(payload.localId);
    liveAttachments.value = next;
    emit("action", {type: "composer.attachmentRemoved", localId: payload.localId});
}

function onAttachmentReject(payload: {kind: PromptAttachmentKind; count: number}): void {
    if (payload.kind === "file") {
        rejectNotice.value = t("composer.reject.file", {count: payload.count});
    }
    else {
        rejectNotice.value = acceptFiles.value
            ? t("composer.reject.imageModel", {count: payload.count})
            : t("composer.reject.imageSession", {count: payload.count});
    }
}

function chooseFiles(): void {
    fileInputRef.value?.click();
}

function onFilesChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = [...input.files ?? []];
    // 清空后再选同一个文件也会触发 change。
    input.value = "";
    if (files.length > 0) {
        withEditor((editor) => {
            editor.insertFiles(files);
            editor.focus("end");
        });
    }
}

function resolveThumbnail(target: string): string | null {
    return props.services.resolveAttachmentUrl?.(target, "thumbnail") ?? null;
}

function onTokenActivate(token: PromptToken): void {
    const action = tokenAction(token, (number) => t("imagePreview.image", {number}));
    if (action !== null) emit("action", action);
}

// ─── 展开 ───────────────────────────────────────────────────────────────

const expanded = ref(false);

async function toggleExpanded(): Promise<void> {
    expanded.value = !expanded.value;
    await nextTick();
    withEditor((editor) => editor.focus("end"));
}

defineExpose({
    focus(): void {
        withEditor((editor) => editor.focus("end"));
    },
});
</script>

<template>
    <footer class="acv-composer" :class="{'is-expanded': expanded}" data-agent-composer>
        <AgentQueuedMessages :queued="composer.queued" @edit="emit('action', {type: 'queued.edit', id: $event})" @remove="emit('action', {type: 'queued.remove', id: $event})" />
        <p v-if="props.ctx.availability.message !== ''" class="acv-composer__notice" role="status" data-composer-availability>
            <span class="i-lucide-info acv-composer__notice-icon" aria-hidden="true" />
            <span class="acv-composer__notice-text">{{ props.ctx.availability.message }}</span>
            <Button v-for="item in props.ctx.availability.actions" :key="item.id" size="sm" variant="subtle" :data-availability-action="item.id" @click="emit('action', {type: 'availability.act', action: item.id})">{{ item.label }}</Button>
        </p>
        <p v-if="composer.notice !== undefined" class="acv-composer__notice" role="status" data-composer-notice>
            <span class="i-lucide-info acv-composer__notice-icon" aria-hidden="true" />
            <span class="acv-composer__notice-text">{{ text(composer.notice) }}</span>
        </p>
        <p v-if="rejectNotice !== null" class="acv-composer__notice" role="status">
            <span class="i-lucide-info acv-composer__notice-icon" aria-hidden="true" />
            <span class="acv-composer__notice-text">{{ rejectNotice }}</span>
            <IconButton
                size="sm"
                icon-class="i-lucide-x"
                :title="t('composer.reject.dismiss')"
                :aria-label="t('composer.reject.dismiss')"
                @click="rejectNotice = null"
            />
        </p>
        <div ref="frameRef" class="acv-composer__frame" :class="{'is-readonly': readonly, 'is-inline': inline}" :data-composer-layout="inline ? 'inline' : 'stacked'">
            <div v-if="inline && leadingButtons.length > 0" class="acv-composer__leading">
                <IconButton
                    v-for="button in leadingButtons"
                    :key="button.id"
                    size="sm"
                    :icon-class="button.icon"
                    :disabled="readonly"
                    :title="text(button.label)"
                    :aria-label="text(button.label)"
                    :data-composer-toolbar="button.id"
                    @click="onToolbarButton(button)"
                />
            </div>
            <div class="acv-composer__editor">
                <component
                    :is="renderers.promptEditor"
                    ref="editorRef"
                    :draft="composer.draft"
                    :locale="locale"
                    :placeholder="placeholder"
                    :aria-label="t('composer.label')"
                    :readonly="readonly"
                    :enter-submits="!expanded"
                    :triggers="triggers"
                    :resolve-menu="resolveMenu"
                    :commands="commandNames"
                    :accept-images="acceptImages"
                    :accept-files="acceptFiles"
                    :attachments="composer.attachments"
                    :resolve-thumbnail="resolveThumbnail"
                    :paste-policy="composer.pastePolicy"
                    :recall="composer.recall"
                    :fill="expanded"
                    bare
                    @change="onChange"
                    @submit="submit($event.mod)"
                    @shift-tab="cycleMode"
                    @menu-open="emit('action', {type: 'menu.opened', trigger: $event.trigger})"
                    @token-activate="onTokenActivate"
                    @attachment-add="onAttachmentAdd"
                    @attachment-retry="emit('action', {type: 'composer.attachmentRetry', localId: $event.localId})"
                    @attachment-remove="onAttachmentRemove"
                    @attachment-reject="onAttachmentReject"
                />
            </div>
            <div class="acv-composer__toolbar">
                <div class="acv-composer__tools">
                    <template v-if="!inline">
                        <IconButton
                            v-for="button in leadingButtons"
                            :key="button.id"
                            size="sm"
                            :icon-class="button.icon"
                            :disabled="readonly"
                            :title="text(button.label)"
                            :aria-label="text(button.label)"
                            :data-composer-toolbar="button.id"
                            @click="onToolbarButton(button)"
                        />
                    </template>
                    <IconButton
                        v-if="acceptFiles"
                        size="sm"
                        icon-class="i-lucide-paperclip"
                        :disabled="readonly"
                        :title="t('composer.attach')"
                        :aria-label="t('composer.attach')"
                        data-composer-action="attach"
                        @click="chooseFiles"
                    />
                    <input ref="fileInputRef" type="file" multiple class="acv-composer__file-input" tabindex="-1" aria-hidden="true" @change="onFilesChosen">
                    <button
                        v-if="currentMode !== null"
                        type="button"
                        class="acv-composer__chip acv-composer__mode"
                        :class="{'is-accent': !modeIsDefault}"
                        :disabled="runtimeDisabled || composer.modes.length < 2"
                        :title="t('composer.mode', {mode: currentMode.label})"
                        :aria-label="t('composer.mode', {mode: currentMode.label})"
                        data-composer-action="mode"
                        @click="cycleMode"
                    >
                        <span :class="currentMode.icon ?? 'i-lucide-circle-dot'" class="acv-composer__chip-icon" aria-hidden="true" />
                        <span class="acv-composer__mode-label">{{ currentMode.label }}</span>
                    </button>
                    <DropdownMenu
                        v-if="composer.approval !== undefined && currentApproval !== null"
                        :items="approvalMenu"
                        :disabled="runtimeDisabled"
                        wrap
                        align="start"
                        side="top"
                        @select="emit('action', {type: 'approval.set', mode: $event})"
                    >
                        <button
                            type="button"
                            class="acv-composer__chip acv-composer__mode"
                            :class="{'is-accent': currentApproval.danger === true}"
                            :disabled="runtimeDisabled"
                            :title="t('composer.approvalMode', {mode: text(currentApproval.label)})"
                            :aria-label="t('composer.approvalMode', {mode: text(currentApproval.label)})"
                            data-composer-action="approval"
                        >
                            <span :class="currentApproval.icon" class="acv-composer__chip-icon" aria-hidden="true" />
                            <span class="acv-composer__mode-label">{{ text(currentApproval.label) }}</span>
                        </button>
                        <template #item="{item}">
                            <span class="acv-composer__approval-item">
                                <span>{{ item.label }}</span>
                                <small>{{ descriptionOf(item.id) }}</small>
                            </span>
                        </template>
                    </DropdownMenu>
                    <AgentRoleModelPicker
                        v-if="(composer.roles?.length ?? 0) > 0"
                        :roles="composer.roles ?? []"
                        :models="composer.models"
                        :model-key="composer.modelKey"
                        :effective-model="composer.effectiveModel ?? null"
                        :thinking-levels="composer.thinkingLevels"
                        :thinking="composer.thinking"
                        :anchor="frameRef"
                        :disabled="runtimeDisabled"
                        :show-image-support="acceptFiles"
                        :can-manage="props.ctx.interaction.canManageModels"
                        @select-model="emit('action', {type: 'model.set', modelKey: $event})"
                        @select-thinking="emit('action', {type: 'thinking.set', level: $event})"
                        @manage="emit('action', {type: 'model.manage'})"
                    />
                    <AgentModelPicker
                        v-else-if="composer.models.length > 0 || composer.thinkingLevels.length > 0"
                        :models="composer.models"
                        :model-key="composer.modelKey"
                        :thinking-levels="composer.thinkingLevels"
                        :thinking="composer.thinking"
                        :disabled="runtimeDisabled"
                        :show-image-support="acceptFiles"
                        :can-manage="props.ctx.interaction.canManageModels"
                        @select-model="emit('action', {type: 'model.set', modelKey: $event})"
                        @select-thinking="emit('action', {type: 'thinking.set', level: $event})"
                        @manage="emit('action', {type: 'model.manage'})"
                    />
                    <AgentContextMeter v-if="contextMeter !== null" :used="contextMeter.used" :limit="contextMeter.limit" />
                    <IconButton
                        v-for="button in trailingButtons"
                        :key="button.id"
                        size="sm"
                        :icon-class="button.icon"
                        :disabled="readonly"
                        :title="text(button.label)"
                        :aria-label="text(button.label)"
                        :data-composer-toolbar="button.id"
                        @click="onToolbarButton(button)"
                    />
                </div>
                <div class="acv-composer__send">
                    <IconButton
                        size="sm"
                        :icon-class="expanded ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'"
                        :title="expanded ? t('composer.collapse') : t('composer.expand')"
                        :aria-label="expanded ? t('composer.collapse') : t('composer.expand')"
                        :aria-pressed="expanded"
                        data-composer-action="expand"
                        @click="toggleExpanded"
                    />
                    <IconButton
                        class="acv-composer__primary"
                        :class="{'is-stop': showStop}"
                        :icon-class="showStop ? 'i-lucide-square' : showResume ? 'acv-composer__resume-icon' : 'i-lucide-arrow-up'"
                        size="sm"
                        :disabled="showStop ? false : sendDisabled"
                        :title="sendTitle"
                        :aria-label="sendTitle"
                        :data-composer-action="showStop ? 'stop' : showResume ? 'resume' : 'send'"
                        @click="onPrimaryButton"
                    />
                </div>
            </div>
        </div>
    </footer>
</template>

<style scoped>
.acv-composer {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    gap: 6px;
    padding: 8px 12px;
    border-top: var(--border-w) solid var(--border-color);
    container-type: inline-size;
}

/* 展开后占视图高度的大部分，消息流让出高度；百分比相对对话视图这一列。 */
.acv-composer.is-expanded {
    height: min(55%, 560px);
}

.acv-composer__approval-item {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.acv-composer__approval-item small {
    color: var(--text-muted);
    font-size: var(--text-2xs);
}

/*
 * 继续按钮的 >>>：lucide 没有三个的箭头，用同样的线宽画一个遮罩，宽高和别的图标相同（IconButton 把图标放在按钮正中），所以和发送的箭头
 * 同一个中心。开发者看过盖上去的版本没居中，这里是按钮自己的图标。
 */
:global(.acv-composer__resume-icon) {
    display: inline-block;
    background: currentColor;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 7l5 5-5 5M10 7l5 5-5 5M17 7l5 5-5 5'/%3E%3C/svg%3E") center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 7l5 5-5 5M10 7l5 5-5 5M17 7l5 5-5 5'/%3E%3C/svg%3E") center / contain no-repeat;
}

.acv-composer__notice {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 6px;
    margin: 0;
    padding-left: 8px;
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.acv-composer__notice-icon {
    flex: none;
    width: 13px;
    height: 13px;
}

.acv-composer__notice-text {
    min-width: 0;
    flex: 1 1 auto;
}

.acv-composer__frame {
    display: flex;
    min-height: 0;
    flex-direction: column;
    border: var(--border-w) solid var(--border-color);
    border-radius: var(--radius-panel);
    background: var(--bg-input);
    transition: border-color var(--motion-fast) var(--ease-standard);
}

.acv-composer.is-expanded .acv-composer__frame {
    flex: 1 1 auto;
}

.acv-composer__frame:focus-within {
    border-color: var(--focus-outline);
}

.acv-composer__frame.is-readonly {
    background: var(--bg-subtle);
}

.acv-composer__editor {
    min-height: 0;
    padding: 4px 4px 0;
}

.acv-composer.is-expanded .acv-composer__editor {
    flex: 1 1 auto;
}

.acv-composer__toolbar {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    padding: 2px 6px 6px;
}

.acv-composer__tools {
    display: flex;
    min-width: 0;
    flex: 1 1 auto;
    align-items: center;
    gap: 2px;
}

.acv-composer__send {
    display: flex;
    flex: none;
    align-items: center;
    gap: 4px;
}

/* 发送是这一行唯一的主操作，用实心的强调色；停止用危险色。不可用时沿用 IconButton 的半透明。 */
.acv-composer__primary {
    background: var(--accent-main);
    color: var(--text-inverse);
}

.acv-composer__primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent-main) 86%, var(--text-main));
    color: var(--text-inverse);
}

.acv-composer__primary.is-stop {
    background: var(--status-danger);
}

.acv-composer__primary.is-stop:hover {
    background: color-mix(in srgb, var(--status-danger) 86%, var(--text-main));
}

.acv-composer__file-input {
    display: none;
}

.acv-composer__chip {
    display: inline-flex;
    flex: none;
    height: 26px;
    align-items: center;
    gap: 4px;
    padding: 0 6px;
    border-radius: var(--radius-control);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    transition: background-color var(--motion-fast) var(--ease-standard), color var(--motion-fast) var(--ease-standard);
}

.acv-composer__chip:hover:not(:disabled) {
    background: color-mix(in srgb, var(--text-main) 10%, transparent);
    color: var(--text-main);
}

.acv-composer__chip:focus-visible {
    outline: 2px solid var(--focus-outline);
    outline-offset: 1px;
}

.acv-composer__chip:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}

.acv-composer__chip.is-accent {
    background: var(--accent-bg);
    color: var(--accent-text);
}

.acv-composer__chip-icon {
    width: 13px;
    height: 13px;
}

/*
 * 单行版式：正文与控件同一行，控件贴在右下（正文长高时它们留在底边）。容器窄于 520px 时控件整排折到正文下面，
 * 前置按钮（`+`）留在正文前。按容器宽度定折行点，不靠 flex-wrap 按内容挤：模型名变长时换行点不至于跟着跳。
 */
.acv-composer__frame.is-inline {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 2px;
    padding: 4px 6px;
}

/*
 * 控件贴底，并与正文最后一行的中线对齐：编辑器一行比控件高，上下留白对称，控件底下垫上半个差值（单行时与文字齐平，
 * 多行时对着最后一行）。编辑器由宿主注入，行高不归本组件管，这里按 nb-markdown 的 PromptEditor 实测：一行 36.8px
 * （14px × 1.6 加上下各 7.2px 内边距），控件 26px，垫 6px 时字形中线与控件中线差 0.1px 以内。换了编辑器或它的内边距要重量。
 */
.acv-composer__leading,
.acv-composer__frame.is-inline .acv-composer__toolbar {
    margin-bottom: 6px;
}

.acv-composer__leading {
    display: flex;
    flex: none;
    align-items: center;
    gap: 2px;
}

.acv-composer__frame.is-inline .acv-composer__editor {
    flex: 1 1 0;
    min-width: 0;
    padding: 0;
    align-self: center;
}

.acv-composer__frame.is-inline .acv-composer__toolbar {
    flex: none;
    padding: 0;
}

.acv-composer__frame.is-inline .acv-composer__tools {
    flex: none;
}

.acv-composer.is-expanded .acv-composer__frame.is-inline {
    align-content: stretch;
}

.acv-composer.is-expanded .acv-composer__frame.is-inline .acv-composer__editor {
    align-self: stretch;
}

@container (max-width: 520px) {
    /* 折到正文下面以后不再和文字对齐，去掉垫高。 */
    .acv-composer__frame.is-inline .acv-composer__toolbar {
        flex: 1 0 100%;
        justify-content: flex-end;
        margin-bottom: 0;
    }

    .acv-composer__frame.is-inline .acv-composer__tools {
        flex: 1 1 auto;
    }
}

/* 窄屏时模式按钮只留图标，给模型名留出位置。 */
@container (max-width: 420px) {
    .acv-composer__mode-label {
        display: none;
    }
}
</style>
