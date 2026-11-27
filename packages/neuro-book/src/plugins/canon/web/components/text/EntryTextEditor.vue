<script setup lang="ts">
/**
 * 条目页文字分页的编辑视图（同名 .md）：整篇的输入框，富文本或源文字（canon/author-ui.md 输出 39、48），上面一行状态与动作。受控：
 * 整篇与记下的模式都在宿主。
 */
import {computed, nextTick, onBeforeUnmount, shallowRef, watch} from "vue";
import type {Component} from "vue";

import {AlertDialog, Button, DropdownMenu, SegmentedControl, Switch} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData} from "@notnotype/nb-ui/components";

import {entryTextProblem, richProblem} from "../../entry-check";
import type {EntryTextProblem} from "../../entry-check";
import {useCanonText} from "../../text";
import {VALUES_DELAY} from "../../text-values";
import EntryRichInput from "./EntryRichInput.vue";
import {INSERT_TEMPLATES, offsetOf} from "./entry-text-editor";
import type {InsertItem, RichContext} from "./entry-text-editor";
import PlainSourceInput from "./PlainSourceInput.vue";

const props = withDefaults(defineProps<{
    text: string;
    problem: string;
    dirty: boolean;
    saved: "none" | "saved" | "unsaved" | "failed" | "too-large" | "diverged";
    phase: "idle" | "submitting" | "confirming";
    submitBlocked: string;
    message: string;
    frozen?: boolean;
    inserts?: readonly InsertItem[];
    input?: Component;
    language?: string;
    /** 富文本要的东西；没有时只有源文字，没有模式切换。 */
    rich?: RichContext | null;
    /** 作者记下的模式（输出 39）。这一版读不进富文本时这一次落在源文字，不改它。 */
    mode?: "rich" | "source";
    /** 富文本的条件画出全部分支。 */
    showBranches?: boolean;
}>(), {frozen: false, inserts: () => [], input: undefined, language: "markdown", rich: null, mode: "rich", showBranches: false});

const emit = defineEmits<{
    (event: "update", text: string): void;
    (event: "blur"): void;
    (event: "submit"): void;
    (event: "discard"): void;
    (event: "cancel"): void;
    (event: "take-over"): void;
    (event: "adopt"): void;
    (event: "retry"): void;
    (event: "update:mode", value: "rich" | "source"): void;
    (event: "update:showBranches", value: boolean): void;
}>();

const text = useCanonText();

/** 提交在途、等结局、读不出块：都不能改。 */
const locked = computed(() => props.phase !== "idle" || props.frozen);
const discarding = shallowRef(false);
/** 离开编辑要先问一句：有改动、读不出块（稿还在）、等着上一次提交的结局。没有这些时是“取消”，直接走。 */
const leavingAsks = computed(() => props.dirty || props.frozen || props.phase === "confirming");
const leave = (): void => {
    if (leavingAsks.value) discarding.value = true;
    else emit("cancel");
};

const bar = shallowRef<HTMLElement | null>(null);
// 整批的说明出现时把状态行带进视野：在长条目的下半截用键盘提交的人，否则看不到为什么没发出去。放在视口中间，不会被条目页
// 吸顶的页头盖住。
watch(() => props.message, (now) => {
    if (now !== "") void nextTick(() => bar.value?.scrollIntoView?.({block: "center"}));
});

const savedLabel = computed(() => {
    if (props.saved === "saved") return text("textEdit.saved");
    if (props.saved === "failed") return text("textEdit.notSaved");
    if (props.saved === "too-large") return text("textEdit.tooLargeToSave");
    return props.saved === "diverged" ? text("textEdit.diverged") : "";
});

/* ---------- 模式（输出 39、48） ---------- */

const baseline = computed(() => props.rich?.baseline ?? new Set<string>());
/**
 * 这一次落在源文字的原因：挂上时稿读不进富文本、提交被拒收（输出 44）。为空时照记下的模式。作者自己切一次就清掉。挂上时判一次：
 * 记下的是富文本、稿却读不进去，就落在源文字并写原因。
 */
const forced = shallowRef<"" | "unreadable" | "rejected">(props.rich !== null && props.mode === "rich" && richProblem(props.text, baseline.value) !== null ? "unreadable" : "");
/** 实际用的模式。 */
const mode = computed((): "rich" | "source" => (props.rich === null || forced.value !== "" ? "source" : props.mode));
/** 从源文字切回富文本被拦下的原因；作者再改字或切换成功就收起。 */
const switchProblem = shallowRef("");
const modeProblem = computed(() => (switchProblem.value !== "" ? switchProblem.value : forced.value === "unreadable" ? text("textEdit.modeUnreadable") : ""));
const modeOptions = computed(() => [{value: "rich", label: text("textEdit.modeRich")}, {value: "source", label: text("textEdit.modeSource")}]);

interface SourceInput {
    focus(caret?: "start" | "end" | number): void;
    insert(text: string): boolean;
    cursorOffset(): number | null;
    openInsert?(what: "calc" | "if" | "ref"): boolean;
}
/**
 * 两种输入框各记各的：切换模式时新的先挂上、旧的后清掉它的 ref，记成一个的话最后会被旧的清成空。按需加载的组件在加载完之前交来的
 * 不是输入框（没有 `focus`）：当作还没有。
 */
let richInput: SourceInput | null = null;
let sourceInput: SourceInput | null = null;
const asInput = (instance: unknown): SourceInput | null => (instance !== null && typeof (instance as Partial<SourceInput>).focus === "function" ? instance as SourceInput : null);
/** 此刻在用的输入框；还没就绪时为 null。 */
const current = (): SourceInput | null => (mode.value === "rich" ? richInput : sourceInput);
/** 要给焦点、输入框却还没就绪：输入框是按需加载的组件、或刚切了模式换了一个。`true` 是不动光标。 */
let pendingFocus: "start" | "end" | number | true | null = null;
/** 输入框刚挂上：等这一轮更新做完（它里面的元素这时才都挂好）再给记下的焦点。 */
const flushFocus = (): void => {
    const target = current();
    if (target === null || pendingFocus === null) return;
    const caret = pendingFocus;
    pendingFocus = null;
    void nextTick(() => target.focus(caret === true ? undefined : caret));
};
const setRich = (instance: unknown): void => {
    richInput = asInput(instance);
    flushFocus();
};
const setSource = (instance: unknown): void => {
    sourceInput = asInput(instance);
    flushFocus();
};
const focus = (caret?: "start" | "end" | number): void => {
    const target = current();
    if (target === null) pendingFocus = caret ?? true;
    else target.focus(caret);
};

/** 切换模式：光标落在同一段的大致位置（两种输入框都按整篇源文的偏移交接）。切回富文本前先查，读不进去就不切、写原因。 */
const switchMode = (next: "rich" | "source"): void => {
    if (next === mode.value) return;
    if (next === "rich") {
        const problem = richProblem(props.text, baseline.value);
        if (problem !== null) {
            switchProblem.value = problem.kind === "problem" ? text("textEdit.switchProblem", {line: problem.problem.line}) : text("textEdit.switchConditions");
            return;
        }
    }
    const caret = current()?.cursorOffset() ?? null;
    switchProblem.value = "";
    forced.value = "";
    sourceProblem.value = null;
    pendingFocus = caret ?? true;
    if (next !== props.mode) emit("update:mode", next);
};

/** 提交被内核拒收（输出 44）时在富文本里：切到源文字，光标落在原因指的那一行（浏览器里同一份文法能找到它；找不到时在文首）。 */
watch(() => props.problem, (now) => {
    if (now === "" || mode.value !== "rich") return;
    const found = entryTextProblem(props.text, baseline.value);
    forced.value = "rejected";
    pendingFocus = found === null ? "start" : offsetOf(props.text, found.line, found.column);
});

/* ---------- 源文字的检查（输出 48） ---------- */

/** 源文字停顿以后查出的第一处问题；富文本里不查（小块改动都先过了检查）。 */
const sourceProblem = shallowRef<EntryTextProblem | null>(null);
let checkTimer: ReturnType<typeof setTimeout> | undefined;
watch([() => props.text, mode], () => {
    clearTimeout(checkTimer);
    switchProblem.value = "";
    if (mode.value !== "source" || props.rich === null) {
        sourceProblem.value = null;
        return;
    }
    checkTimer = setTimeout(() => {
        sourceProblem.value = entryTextProblem(props.text, baseline.value);
    }, VALUES_DELAY);
}, {immediate: true});
onBeforeUnmount(() => clearTimeout(checkTimer));

/** 只在文字里有条件时出“显示全部分支”。 */
const hasConditions = computed(() => mode.value === "rich" && /<If\b/u.test(props.text));

/* ---------- 插入（输出 48） ---------- */

const VALUE_GROUP = "#value";
const STRUCTURES = ["calc", "if", "ref"] as const;
const structureLabel = (what: (typeof STRUCTURES)[number]): string => text(what === "calc" ? "textEdit.insertCalc" : what === "if" ? "textEdit.insertIf" : "textEdit.insertRef");
const insertItems = computed((): DropdownMenuItemData[] => {
    const values: DropdownMenuItemData[] = props.inserts.map((item) => ({id: item.snippet, label: item.label}));
    if (props.rich === null) return values;
    const structures = STRUCTURES
        .filter((what) => what !== "ref" || props.rich?.find !== null || mode.value === "source")
        .map((what): DropdownMenuItemData => ({id: `#${what}`, label: structureLabel(what), shortcut: what === "ref" ? "@" : "{"}));
    return [...(values.length === 0 ? [] : [{id: VALUE_GROUP, label: text("textEdit.insertValue"), children: values}]), ...structures];
});
/**
 * 菜单开着的时候焦点不在输入框里：输入框记着光标的位置，写入由它自己做（进它的撤销历史、光标落在写法后面），再把焦点还回去。
 * 输入框还没就绪时接在整篇末尾；输入框拒了（检查不过、光标在代码里）就不写。富文本的计算、条件、条目打开浮层或列表，焦点
 * 交给它们，不拉回输入框（拉回会让刚开的浮层当作焦点移到外面而关上）。
 */
const insert = (id: string): void => {
    const structure = STRUCTURES.find((what) => id === `#${what}`);
    if (structure !== undefined && mode.value === "rich") {
        if (current()?.openInsert?.(structure) === true) return;
        void nextTick(() => focus());
        return;
    }
    const snippet = structure === undefined ? id : INSERT_TEMPLATES[structure];
    const target = current();
    if (target === null) emit("update", `${props.text}${snippet}`);
    else target.insert(snippet);
    void nextTick(() => focus());
};

/* ---------- 富文本里没应用就丢掉的改动 ---------- */

/** 小块浮层里没应用的字被丢掉了（开始提交、外面换了整篇、撤销让小块不在了）：写一句，作者再改字就收起。 */
const discarded = shallowRef(false);
const onInput = (value: string): void => {
    discarded.value = false;
    emit("update", value);
};

const onKeydown = (event: KeyboardEvent): void => {
    // 没有改动时 Esc 等于“取消”；有改动时不接（免得一下按没了），放弃要点按钮、再确认。输入法正在组字时的 Esc 是取消候选。
    if (event.key === "Escape" && !event.isComposing && !event.defaultPrevented && !leavingAsks.value && props.phase === "idle") emit("cancel");
};

defineExpose({focus});
</script>

<template>
    <div class="text-editor" data-text-editor :data-text-editor-phase="props.phase" @keydown="onKeydown">
        <div ref="bar" class="text-editor__bar" :data-state="props.message !== '' || props.saved === 'failed' || props.saved === 'too-large' ? 'problem' : props.dirty ? 'dirty' : 'clean'">
            <!-- 右区：暂存的状态与放弃、提交。切换模式时左区的控件会变，右区留在原处（输出 39）；窄处它是第一行。 -->
            <div class="text-editor__zone text-editor__zone--status" data-text-bar-row="1">
                <!-- 基准宽度 10rem：右边的按钮多到剩不下这么宽时，这一行自己占一行、按钮换到下一行，不把字挤成一词一行。 -->
                <p class="flex min-w-0 flex-[1_1_10rem] flex-wrap items-center gap-x-2" role="status">
                    <Transition name="text-editor-dot"><span v-if="props.dirty" class="text-editor__dot" aria-hidden="true" /></Transition>
                    <Transition name="text-editor-fade"><span v-if="props.dirty" class="text-[var(--text-main)]" data-text-dirty>{{ text("textEdit.dirty") }}</span></Transition>
                    <Transition name="text-editor-fade" mode="out-in">
                        <span v-if="props.phase === 'confirming'" key="confirming" class="text-[var(--text-muted)]" data-text-confirming>{{ text("textEdit.confirming") }}</span>
                        <span v-else-if="savedLabel !== ''" :key="props.saved" class="text-[var(--text-muted)]" :data-text-saved="props.saved">{{ savedLabel }}</span>
                    </Transition>
                    <!-- “提交”点不了的原因：按钮上的悬停文字键盘与读屏都读不到，写在这一行。整批的说明里正写着同一句时不重复。 -->
                    <Transition name="text-editor-fade"><span v-if="props.dirty && props.submitBlocked !== '' && props.message !== props.submitBlocked" class="text-[var(--text-muted)]" data-text-submit-blocked>{{ props.submitBlocked }}</span></Transition>
                    <Transition name="text-editor-fade"><span v-if="discarded" class="text-[var(--text-muted)]" data-text-discarded>{{ text("chipEdit.discarded") }}</span></Transition>
                </p>
                <Transition name="text-editor-fade">
                    <span v-if="props.saved === 'diverged'" class="flex items-center gap-2">
                        <Button size="sm" variant="ghost" data-text-take-over @click="emit('take-over')">{{ text("textEdit.takeOver") }}</Button>
                        <Button size="sm" variant="ghost" data-text-adopt @click="emit('adopt')">{{ text("textEdit.adopt") }}</Button>
                    </span>
                </Transition>
                <Transition name="text-editor-fade"><Button v-if="props.phase === 'confirming'" size="sm" variant="ghost" data-text-retry @click="emit('retry')">{{ text("textEdit.retry") }}</Button></Transition>
                <!-- 一个按钮两种说法：没有东西可丢时是“取消”，否则是“放弃”（先问一句）。 -->
                <Button
                    size="sm"
                    variant="ghost"
                    :disabled="props.phase === 'submitting'"
                    :data-text-discard="leavingAsks ? '' : undefined"
                    :data-text-cancel="leavingAsks ? undefined : ''"
                    @click="leave()"
                >{{ text(leavingAsks ? "textEdit.discard" : "textEdit.cancel") }}</Button>
                <Button
                    size="sm"
                    variant="primary"
                    :disabled="!props.dirty || props.phase !== 'idle' || props.frozen || props.submitBlocked !== '' || props.saved === 'diverged'"
                    :loading="props.phase === 'submitting'"
                    :title="props.submitBlocked !== '' ? props.submitBlocked : undefined"
                    data-text-submit
                    @click="emit('submit')"
                >{{ text("textEdit.submit") }}</Button>
            </div>
            <!-- 左区：插入、模式、显示全部分支。宽处排在右区左边（同一行）；窄处是第二行。 -->
            <div class="text-editor__zone text-editor__zone--tools" data-text-bar-row="2">
                <DropdownMenu v-if="!props.frozen && insertItems.length > 0" align="start" :items="insertItems" :disabled="locked" @select="insert">
                    <Button size="sm" variant="ghost" :disabled="locked" data-text-insert><span class="i-lucide-plus size-3.5" aria-hidden="true" />{{ text("textEdit.insert") }}</Button>
                </DropdownMenu>
                <span v-if="props.rich !== null" class="contents" :data-text-mode="mode">
                    <SegmentedControl size="sm" :model-value="mode" :options="modeOptions" :aria-label="text('textEdit.modeLabel')" @update:model-value="(value) => switchMode(value as 'rich' | 'source')" />
                </span>
                <Transition name="text-editor-fade">
                    <label v-if="hasConditions" class="text-editor__toggle" data-text-branches>
                        <Switch size="sm" :model-value="props.showBranches" @update:model-value="(value: boolean) => emit('update:showBranches', value)" />
                        <span>{{ text("textEdit.showBranches") }}</span>
                    </label>
                </Transition>
                <Transition name="text-editor-fade">
                    <span v-if="modeProblem !== ''" class="text-editor__mode-problem" role="alert" data-mode-problem>{{ modeProblem }}</span>
                </Transition>
            </div>
            <Transition name="text-editor-note">
                <div v-if="props.message !== ''" class="text-editor__note basis-full">
                    <p class="text-[var(--status-danger)]" role="alert" data-text-message>{{ props.message }}</p>
                </div>
            </Transition>
        </div>

        <div class="text-editor__frame" :data-invalid="props.problem !== '' || sourceProblem !== null ? '' : undefined" :data-text-source="mode === 'source' ? '' : undefined">
            <EntryRichInput
                v-if="mode === 'rich' && props.rich !== null"
                :ref="setRich"
                :model-value="props.text"
                :label="text('textEdit.richLabel')"
                :readonly="locked"
                :baseline="props.rich.baseline"
                :self="props.rich.self"
                :fields="props.rich.fields"
                :marks="props.rich.marks"
                :values="props.rich.values"
                :computing="props.rich.computing"
                :find="props.rich.find"
                :show-branches="props.showBranches"
                @update:model-value="onInput"
                @blur="emit('blur')"
                @discarded="discarded = true"
            />
            <component
                :is="props.input ?? PlainSourceInput"
                v-else
                :ref="setSource"
                :model-value="props.text"
                :label="text('textEdit.sourceLabel')"
                :language="props.language"
                :readonly="locked"
                @update:model-value="onInput"
                @blur="emit('blur')"
            />
            <Transition name="text-editor-note">
                <div v-if="props.problem !== ''" class="text-editor__note">
                    <p class="pt-1 text-[length:var(--text-xs)] text-[var(--status-danger)]" role="alert" data-text-problem>{{ props.problem }}</p>
                </div>
            </Transition>
            <Transition name="text-editor-note">
                <div v-if="props.problem === '' && sourceProblem !== null" class="text-editor__note">
                    <p class="pt-1 text-[length:var(--text-xs)] text-[var(--status-danger)]" role="alert" data-source-problem :data-line="sourceProblem.line" :data-column="sourceProblem.column">
                        {{ text("textEdit.sourceProblem", {line: sourceProblem.line, column: sourceProblem.column, message: sourceProblem.message}) }}
                    </p>
                </div>
            </Transition>
        </div>

        <AlertDialog
            v-model:open="discarding"
            :title="text('textEdit.discardTitle')"
            :description="text('textEdit.discardDescription')"
            :confirm-label="text('textEdit.discardConfirm')"
            :cancel-label="text('textEdit.discardCancel')"
            @confirm="emit('discard')"
        />
    </div>
</template>

<style scoped>
.text-editor {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
    /* 状态行排一行还是两行，看这个组件自己有多宽（它可能在拆开的编辑组里），不看视口。 */
    container-type: inline-size;
}
/* 不吸顶：条目页的页头已经吸在滚动区顶上，两个吸顶的条会叠在一起。 */
.text-editor__bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.25rem;
    font-size: var(--text-sm);
}
.text-editor__zone {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
}
/* 窄处两行：第一行状态与放弃、提交，第二行插入与模式。 */
.text-editor__zone--status {
    flex: 1 1 100%;
}
.text-editor__zone--tools {
    flex: 1 1 100%;
}
/* 够宽时一行：左区在左、右区在右。右区的按钮靠右，左区的控件多了少了都不推动它们。 */
@container (min-width: 560px) {
    .text-editor__zone--tools {
        order: -1;
        flex: 0 1 auto;
    }
    .text-editor__zone--status {
        flex: 1 1 0;
        justify-content: flex-end;
    }
}
.text-editor__toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    color: var(--text-secondary);
    cursor: pointer;
}
.text-editor__mode-problem {
    color: var(--status-warning);
    font-size: var(--text-xs);
}
/* 说明这一类的行：出现时从 0 长到自己的高度，下面的内容跟着让开。 */
.text-editor__note {
    display: grid;
    grid-template-rows: 1fr;
}
.text-editor__note > * {
    min-height: 0;
    overflow: hidden;
}
.text-editor__dot {
    width: 0.5rem;
    height: 0.5rem;
    flex-shrink: 0;
    border-radius: 9999px;
    background: var(--status-warning);
}
.text-editor__bar[data-state="problem"] .text-editor__dot {
    background: var(--status-danger);
}
.text-editor__frame {
    padding: 0.5rem;
    border: 1px solid var(--divider);
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--text-main) 3%, transparent);
    transition: border-color var(--motion-fast) var(--ease-layout);
}
.text-editor__frame:focus-within {
    border-color: var(--accent-main);
}
.text-editor__frame[data-invalid] {
    border-color: var(--status-danger);
}
.text-editor-dot-enter-active,
.text-editor-dot-leave-active {
    transition: opacity var(--motion-fast) var(--ease-layout), transform var(--motion-fast) var(--ease-layout);
}
.text-editor-dot-enter-from,
.text-editor-dot-leave-to {
    opacity: 0;
    transform: scale(0.6);
}
.text-editor-fade-enter-active,
.text-editor-fade-leave-active {
    transition: opacity var(--motion-fast) var(--ease-layout);
}
.text-editor-fade-enter-from,
.text-editor-fade-leave-to {
    opacity: 0;
}
.text-editor-note-enter-active,
.text-editor-note-leave-active {
    transition: grid-template-rows var(--motion-move) var(--ease-layout), opacity var(--motion-fast) var(--ease-layout);
}
.text-editor-note-enter-from,
.text-editor-note-leave-to {
    grid-template-rows: 0fr;
    opacity: 0;
}

/* 减弱动效：圆点不缩放，只淡入淡出（nb-ui 设计语言“六、无障碍”）。 */
@media (prefers-reduced-motion: reduce) {
    .text-editor-dot-enter-from,
    .text-editor-dot-leave-to {
        transform: none;
    }
}
</style>
