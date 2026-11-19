<script setup lang="ts">
import {computed, onBeforeUnmount, ref} from "vue";

import {useUiText} from "../../text-port";
import Button from "./Button.vue";
import IconButton from "./IconButton.vue";

export type CopyButtonState = "idle" | "copied" | "failed";

const props = withDefaults(defineProps<{
    text: string;
    resetAfter?: number;
    label?: string;
    /** 只画图标（头部、工具条里放不下文字时）：文字改作悬停提示与可访问名称。 */
    iconOnly?: boolean;
}>(), {
    resetAfter: 1500,
    label: undefined,
    iconOnly: false,
});

const uiText = useUiText();
const state = ref<CopyButtonState>("idle");
const root = ref<HTMLElement | null>(null);
const button = ref<InstanceType<typeof Button> | InstanceType<typeof IconButton> | null>(null);

/** 每次点击加一：较早的一次复制在较晚的一次之后才 settle 时，不覆盖较晚那次的结果。 */
let attempt = 0;
let resetTimer: ReturnType<typeof setTimeout> | undefined;
let unmounted = false;

const buttonText = computed(() => {
    if (state.value === "copied") return uiText("copyButton.copied");
    if (state.value === "failed") return uiText("copyButton.failed");
    return props.label ?? uiText("copyButton.copy");
});
const iconClass = computed(() => (state.value === "copied" ? "i-lucide-check" : state.value === "failed" ? "i-lucide-triangle-alert" : "i-lucide-copy"));
const announcement = computed(() => (state.value === "idle" ? "" : buttonText.value));

/** 权限被拒时 writeText reject：失败如实回执给用户（“复制失败”），并交给退路再试一次，不另记诊断。 */
async function writeWithClipboardApi(clipboard: Clipboard, text: string): Promise<boolean> {
    try {
        await clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}

/**
 * 退路：组件里的不可见 textarea 加 execCommand("copy")。textarea 挂在本组件根节点下而不是 body：
 * 组件常在模态对话框里，对话框的焦点陷阱会把焦点从对话框外拽回，选区随之丢失，execCommand 返回 false。
 */
function writeWithExecCommand(text: string): boolean {
    const host = root.value;
    if (host === null || typeof document.execCommand !== "function") return false;
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.setAttribute("aria-hidden", "true");
    area.tabIndex = -1;
    // 不可见但仍可聚焦、可选中：display:none 或 visibility:hidden 的元素选不中。
    area.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none;";
    const trigger = button.value?.$el as HTMLElement | undefined;
    // 焦点只在按钮原本有焦点时交还，并保持它原来画不画焦点环：鼠标点的不该因为中间聚焦过 textarea 而亮出焦点环。
    const hadFocus = trigger !== undefined && document.activeElement === trigger;
    const ringVisible = hadFocus && trigger.matches(":focus-visible");
    host.appendChild(area);
    try {
        area.focus({preventScroll: true});
        area.select();
        return document.execCommand("copy");
    } catch {
        // 浏览器不支持或拒绝这条命令：同样回执“复制失败”。
        return false;
    } finally {
        area.remove();
        // focusVisible 选项尚未进 TypeScript 的 DOM 类型；不支持的浏览器忽略它。
        if (hadFocus) trigger.focus({preventScroll: true, focusVisible: ringVisible} as FocusOptions);
    }
}

async function copy(): Promise<void> {
    const mine = ++attempt;
    const text = props.text;
    // 非安全上下文里没有 navigator.clipboard：直接在点击的同一个任务里走退路。Safari 要求 execCommand 在用户手势之内，
    // 隔一个 await 就可能被拒。有剪贴板 API 但被拒时只能在 await 之后退，那时是否还在手势里由浏览器决定。
    const clipboard = navigator.clipboard as Clipboard | undefined;
    const ok = clipboard === undefined ? writeWithExecCommand(text) : (await writeWithClipboardApi(clipboard, text)) || writeWithExecCommand(text);
    if (unmounted || mine !== attempt) return;
    state.value = ok ? "copied" : "failed";
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
        state.value = "idle";
    }, props.resetAfter);
}

onBeforeUnmount(() => {
    unmounted = true;
    clearTimeout(resetTimer);
});
</script>

<template>
    <span ref="root" class="nb-copy-button" :data-copy-state="state">
        <IconButton
            v-if="props.iconOnly"
            ref="button"
            :icon-class="iconClass"
            :title="buttonText"
            :aria-label="buttonText"
            :class="state === 'copied' ? '!text-[var(--status-success)]' : state === 'failed' ? '!text-[var(--status-danger)]' : ''"
            @click="copy"
        />
        <Button
            v-else
            ref="button"
            variant="ghost"
            size="sm"
            :icon-class="iconClass"
            :class="state === 'copied' ? '!text-[var(--status-success)]' : state === 'failed' ? '!text-[var(--status-danger)]' : ''"
            @click="copy"
        >{{ buttonText }}</Button>
        <span class="sr-only" role="status">{{ announcement }}</span>
    </span>
</template>

<style scoped>
.nb-copy-button {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
}
</style>
