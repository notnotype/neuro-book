<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {Button, IconButton} from "@notnotype/nb-ui/components";
import type {Text} from "@notnotype/nb-ui/text";
import {firstLine} from "../../format";
import {useAgentText} from "../host";

type Queued = {id: string; text: string; delivery: "steer" | "followup"; author?: {label: Text; icon: string}; editable?: boolean; held?: {reason: Text}};

const props = defineProps<{
    queued: ReadonlyArray<Queued>;
    /** “继续”为什么不可用；null 或不写时可用。 */
    continueDisabled?: Text | null;
}>();

const emit = defineEmits<{
    /** 取出到输入框，改了再发。 */
    edit: [id: string];
    remove: [id: string];
    /** 放行留着的话（与输入框的继续是同一个动作）。 */
    continue: [];
}>();

const {t, text} = useAgentText();

/** 就绪的行最多显示几条；留着的不受限，不会被运行取走，收起了就处理不到（ui/agent-conversation-view.md 的排队区）。 */
const VISIBLE = 3;
const expanded = ref(false);
const held = computed(() => props.queued.filter((item) => item.held !== undefined));
const ready = computed(() => props.queued.filter((item) => item.held === undefined));
const hidden = computed(() => (expanded.value ? 0 : Math.max(0, ready.value.length - VISIBLE)));
// 取走几条之后不再超出：收起，不留一行点了没变化的“收起”。
watch(() => ready.value.length <= VISIBLE, (fits) => {
    if (fits) expanded.value = false;
});
/** 按缓冲区的顺序画；超出的就绪的行收起。 */
const shown = computed(() => {
    let readyShown = 0;
    return props.queued.filter((item) => item.held !== undefined || expanded.value || (readyShown += 1) <= VISIBLE);
});
const heading = computed(() => {
    const first = held.value[0];
    if (first === undefined) return null;
    const reason = text(first.held!.reason);
    const mixed = held.value.some((item) => text(item.held!.reason) !== reason);
    return {count: t("composer.queued.held", {count: held.value.length}), reason: mixed ? t("composer.queued.heldMore", {reason}) : reason};
});
const continueTitle = computed(() => (props.continueDisabled === undefined || props.continueDisabled === null ? undefined : text(props.continueDisabled)));
/** 不可用时用 `aria-disabled`：按钮留在 Tab 顺序里、焦点不丢，悬停写原因（nb-ui 规范，暂时不可用的触发器）。 */
function onContinue(): void {
    if (continueTitle.value === undefined) emit("continue");
}
const tagOf = (item: Queued) => (item.author !== undefined ? text(item.author.label) : item.delivery === "steer" ? t("composer.queued.steer") : t("composer.queued.followup"));
const iconOf = (item: Queued) => (item.author !== undefined ? item.author.icon : item.delivery === "steer" ? "i-lucide-corner-down-left" : "i-lucide-list-end");
</script>

<template>
    <!-- 没有排队时根元素仍在（`is-empty` 不占位）：读屏的播报区要先在页面上，内容出现时才会被播报。 -->
    <div class="acv-queued-area" :class="{'is-empty': props.queued.length === 0}">
        <div v-if="heading !== null" class="acv-queued__head" data-queued-head>
            <span class="i-lucide-circle-pause acv-queued__head-icon" aria-hidden="true" />
            <span class="acv-queued__head-count">{{ heading.count }}</span>
            <span class="acv-queued__head-reason" :title="heading.reason">{{ heading.reason }}</span>
            <Button size="sm" variant="secondary" icon-class="i-lucide-play" class="acv-queued__continue" :class="{'is-unavailable': continueTitle !== undefined}" :aria-disabled="continueTitle !== undefined" :title="continueTitle" data-queued-continue @click="onContinue">{{ t("composer.queued.continue") }}</Button>
        </div>
        <!-- 头行出现、条数变化时播报：头行在列表外，读屏用户在行里只听得到“已暂停：……”。 -->
        <span class="acv-queued__status" role="status">{{ heading === null ? "" : `${heading.count} ${heading.reason}` }}</span>
        <ul v-if="props.queued.length > 0" class="acv-queued" :class="{'is-expanded': expanded}" :aria-label="t('composer.queued.label')">
            <li v-for="item in shown" :key="item.id" class="acv-queued__item" :title="item.text" :data-queued="item.delivery" :data-held="item.held !== undefined" :data-author="item.author !== undefined" :aria-label="item.held === undefined ? undefined : t('composer.queued.heldItem', {text: firstLine(item.text)})">
                <span class="acv-queued__tag">
                    <span :class="iconOf(item)" class="acv-queued__icon" aria-hidden="true" />
                    <span class="acv-queued__tag-label">{{ tagOf(item) }}</span>
                </span>
                <span class="acv-queued__text">{{ firstLine(item.text) }}</span>
                <IconButton v-if="item.editable !== false" icon-class="i-lucide-pencil" size="xs" :title="t('composer.queued.edit')" :aria-label="t('composer.queued.edit')" data-queued-edit @click="emit('edit', item.id)" />
                <IconButton icon-class="i-lucide-x" size="xs" :title="t('composer.queued.remove')" :aria-label="t('composer.queued.remove')" data-queued-remove @click="emit('remove', item.id)" />
            </li>
            <li v-if="hidden > 0 || expanded" class="acv-queued__more">
                <button type="button" class="acv-queued__more-button nb-ui-focus-ring" :aria-expanded="expanded" data-queued-more @click="expanded = !expanded">{{ expanded ? t("composer.queued.collapse") : t("composer.queued.more", {count: hidden}) }}</button>
            </li>
        </ul>
    </div>
</template>

<style scoped>
.acv-queued-area {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
}

.acv-queued-area.is-empty {
    display: contents;
}

.acv-queued__head {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 6px;
    padding: 0 2px 0 8px;
    font-size: var(--text-xs);
}

.acv-queued__head-icon {
    flex: none;
    width: 14px;
    height: 14px;
    color: var(--status-warning);
}

.acv-queued__head-count {
    flex: none;
    color: var(--text-main);
    font-weight: 600;
}

/* 原因先截断，“继续”完整保留。 */
.acv-queued__head-reason {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-queued__continue {
    flex: none;
}

.acv-queued__continue.is-unavailable {
    opacity: 0.5;
    cursor: default;
}

.acv-queued__status {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}

.acv-queued {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    margin: 0;
    padding: 0;
    list-style: none;
}

.acv-queued.is-expanded {
    max-height: 240px;
    overflow-y: auto;
}

.acv-queued__item {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border: var(--border-w) solid var(--divider);
    border-radius: var(--radius-control);
    background: var(--bg-subtle);
    font-size: var(--text-xs);
    line-height: 1.4;
}

.acv-queued__item[data-held="true"] {
    border-style: dashed;
    background: transparent;
}

.acv-queued__tag {
    display: inline-flex;
    flex: none;
    max-width: 12em;
    align-items: center;
    gap: 3px;
    color: var(--accent-text);
    font-weight: 600;
}

.acv-queued__item[data-author="true"] .acv-queued__tag {
    color: var(--text-secondary);
}

.acv-queued__item[data-held="true"] .acv-queued__tag {
    color: var(--text-muted);
}

.acv-queued__tag-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-queued__icon {
    flex: none;
    width: 12px;
    height: 12px;
}

.acv-queued__text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-queued__more {
    padding: 0 8px;
}

.acv-queued__more-button {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--text-2xs);
    cursor: pointer;
}

.acv-queued__more-button:hover {
    color: var(--text-secondary);
}
</style>
