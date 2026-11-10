<script setup lang="ts">
import {computed, onBeforeUnmount, ref} from "vue";

import {useUiText} from "../../text-port";
import Button from "./Button.vue";
import type {FocusRingStyle} from "./focus-ring";

export type CopyButtonState = "idle" | "copied" | "failed";

const props = withDefaults(defineProps<{
    text: string;
    resetAfter?: number;
    label?: string;
    focusRing?: FocusRingStyle;
}>(), {
    resetAfter: 1500,
    label: undefined,
    focusRing: "outer",
});

const uiText = useUiText();
const state = ref<CopyButtonState>("idle");
const root = ref<HTMLElement | null>(null);
const button = ref<InstanceType<typeof Button> | null>(null);

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

async function writeWithClipboardApi(text: string): Promise<boolean> {
    // 非安全上下文里 navigator.clipboard 不存在；权限被拒时 writeText reject。两种都交给退路。
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (clipboard === undefined) return false;
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
    host.appendChild(area);
    try {
        area.focus({preventScroll: true});
        area.select();
        return document.execCommand("copy");
    } catch {
        return false;
    } finally {
        area.remove();
        (button.value?.$el as HTMLElement | undefined)?.focus({preventScroll: true});
    }
}

async function copy(): Promise<void> {
    const mine = ++attempt;
    const text = props.text;
    const ok = (await writeWithClipboardApi(text)) || writeWithExecCommand(text);
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
        <Button
            ref="button"
            variant="ghost"
            size="sm"
            :focus-ring="props.focusRing"
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
