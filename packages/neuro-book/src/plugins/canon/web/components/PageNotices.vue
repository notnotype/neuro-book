<script setup lang="ts">
/**
 * 条目页、回执页、变更详情页共用的浮动提示（docs/specs/canon/author-ui.md 输出 18、42；同名 .md）：浮在页面下方，盖在内容上、
 * 不占文档流。受控：显示哪几条、什么时候收起由宿主（窗口里的 `notices.ts`）定，这里只画、只把点了什么发出去。
 */
import {onBeforeUnmount} from "vue";

import {Button, IconButton} from "@notnotype/nb-ui/components";

import type {AgentNotice, CanonNotice} from "../notices";
import {useCanonText} from "../text";

const props = withDefaults(defineProps<{
    /** 作者自己刚保存的那一次；没有时为 null。 */
    notice?: CanonNotice | null;
    /** Agent 改了设定；没有时为 null。 */
    agent?: AgentNotice | null;
    /** 这个页面自己的写入失败的原因；没有时为空串。 */
    error?: string;
    /** 暂停作者提示自己收起，返回放开的函数（`notices.hold`）；不给时不暂停。 */
    hold?: (() => () => void) | null;
}>(), {notice: null, agent: null, error: "", hold: null});

const emit = defineEmits<{
    /** “查看详情”：打开这次修订的回执页。 */
    (event: "receipt", revision: string): void;
    (event: "undo", notice: CanonNotice): void;
    /** Agent 提示的“看改动记录”。 */
    (event: "revisions"): void;
    (event: "close"): void;
    (event: "close-agent"): void;
    (event: "close-error"): void;
}>();

const text = useCanonText();

// 指针停在提示上、焦点在提示里，各算一个暂停来源；两样都放开才接着计时。
const releases = new Map<"pointer" | "focus", () => void>();
const holdBy = (source: "pointer" | "focus", on: boolean): void => {
    const held = releases.get(source);
    if (on && held === undefined && props.hold !== null) releases.set(source, props.hold());
    if (!on && held !== undefined) {
        releases.delete(source);
        held();
    }
};
const onFocusOut = (event: FocusEvent): void => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !(event.currentTarget as HTMLElement).contains(next)) holdBy("focus", false);
};
onBeforeUnmount(() => {
    for (const release of releases.values()) release();
    releases.clear();
});
</script>

<template>
    <!-- 末尾的留白常在：提示出没时页面什么都不动，最后几行也滚得到盖不住。 -->
    <div class="page-notices">
        <div class="page-notices__anchor">
            <div class="page-notices__stack" role="status" :aria-label="text('notice.label')">
                <TransitionGroup name="page-notice">
                    <div v-if="props.agent !== null" key="agent" class="page-notice" data-agent-notice>
                        <span class="i-lucide-bot size-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                        <span class="page-notice__text">{{ text("notice.agentChanged", {title: props.agent.title}) }}<template v-if="props.agent.earlier > 0">{{ text("notice.agentEarlier", {count: props.agent.earlier}) }}</template></span>
                        <span class="page-notice__actions">
                            <Button size="sm" variant="ghost" @click="emit('receipt', props.agent.revision)">{{ text("notice.receipt") }}</Button>
                            <!-- 撤销以后同一个按钮写“已撤销”、不再响应：还原对话框关闭时焦点回到它，换成别的元素或停用（disabled）焦点都会掉到页面外。 -->
                            <Button size="sm" variant="ghost" :aria-disabled="props.agent.undone === true ? 'true' : undefined" data-agent-undo @click="props.agent.undone === true || emit('undo', props.agent)">{{ text(props.agent.undone === true ? "notice.undone" : "notice.undo") }}</Button>
                            <Button size="sm" variant="ghost" @click="emit('revisions')">{{ text("notice.revisions") }}</Button>
                            <IconButton size="sm" icon-class="i-lucide-x" :aria-label="text('notice.close')" :title="text('notice.close')" @click="emit('close-agent')" />
                        </span>
                    </div>
                    <div
                        v-if="props.notice !== null"
                        key="author"
                        class="page-notice"
                        data-notice-bar
                        @pointerenter="holdBy('pointer', true)"
                        @pointerleave="holdBy('pointer', false)"
                        @focusin="holdBy('focus', true)"
                        @focusout="onFocusOut"
                    >
                        <span class="i-lucide-circle-check size-4 shrink-0 text-[var(--status-success)]" aria-hidden="true" />
                        <!-- 新的一条顶掉旧的：外框不动，只换字。 -->
                        <Transition name="nb-ui-switch" mode="out-in">
                            <span :key="props.notice.revision" class="page-notice__text">{{ props.notice.title }}</span>
                        </Transition>
                        <span class="page-notice__actions">
                            <Button size="sm" variant="ghost" @click="emit('receipt', props.notice.revision)">{{ text("notice.receipt") }}</Button>
                            <Button size="sm" variant="ghost" @click="emit('undo', props.notice)">{{ text("notice.undo") }}</Button>
                            <IconButton size="sm" icon-class="i-lucide-x" :aria-label="text('notice.close')" :title="text('notice.close')" @click="emit('close')" />
                        </span>
                    </div>
                    <div v-if="props.error !== ''" key="error" class="page-notice" role="alert" data-page-error>
                        <span class="i-lucide-circle-alert size-4 shrink-0 text-[var(--status-danger)]" aria-hidden="true" />
                        <span class="page-notice__text page-notice__text--wrap">{{ props.error }}</span>
                        <span class="page-notice__actions">
                            <IconButton size="sm" icon-class="i-lucide-x" :aria-label="text('notice.close')" :title="text('notice.close')" @click="emit('close-error')" />
                        </span>
                    </div>
                </TransitionGroup>
            </div>
        </div>
    </div>
</template>

<style scoped>
/* 留白与一条提示同高，页面最后几行能滚到提示上方。 */
.page-notices {
    height: calc(var(--control-h-md, 2.25rem) + 24px);
}
/* 零高、贴着页面滚动区的底边：提示从它往上叠，滚动时一直在视口下方。 */
.page-notices__anchor {
    position: sticky;
    bottom: 16px;
    height: 0;
    z-index: 2;
}
.page-notices__stack {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    pointer-events: none;
}
.page-notice {
    pointer-events: auto;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    max-width: min(100%, 640px);
    min-height: var(--control-h-md, 2.25rem);
    padding: 4px 4px 4px 12px;
    border-radius: var(--radius-control-lg);
    background: var(--overlay-surface);
    backdrop-filter: blur(var(--overlay-blur));
    box-shadow: var(--elevation-popover);
    color: var(--text-main);
    font-size: var(--text-sm);
}
.page-notice__text {
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-right: 6px;
}
.page-notice__text--wrap {
    white-space: normal;
}
.page-notice__actions {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
}
.page-notice-enter-active {
    transition: opacity var(--motion-enter) var(--ease-layout), transform var(--motion-enter) var(--ease-layout);
}
.page-notice-leave-active {
    transition: opacity var(--motion-fast) var(--ease-dialog-leave), transform var(--motion-fast) var(--ease-dialog-leave);
}
.page-notice-enter-from {
    opacity: 0;
    transform: translateY(12px);
}
.page-notice-leave-to {
    opacity: 0;
    transform: translateY(8px);
}
.page-notice-move {
    transition: transform var(--motion-move) var(--ease-layout);
}
</style>
