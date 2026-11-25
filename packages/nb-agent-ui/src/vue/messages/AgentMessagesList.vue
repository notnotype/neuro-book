<script setup lang="ts">
/**
 * “消息”视图的列表（同名 .md）：bot、会话两个标签。bot 一页是联系人，会话一页是宿主经插槽给的会话面板。纯受控，只有搜索词是自己的。
 */
import {computed, nextTick, ref, watch} from "vue";
import {Badge, Button, Input} from "@notnotype/nb-ui/components";

import {formatListTime} from "../../format";
import type {AgentLocale, MessagesContact, MessagesContactSection} from "../../types";
import {provideAgentText} from "../text";

const props = withDefaults(defineProps<{
    tab: "bot" | "sessions";
    sections: readonly MessagesContactSection[];
    selectedContact: string | null;
    now: number;
    locale?: AgentLocale;
    /** 切换这一行是宿主窗口的拖动区（宿主自绘窗口头时）：写 `data-window-drag`，空白处按住拖的是窗口，标签与按钮照旧。 */
    windowDrag?: boolean;
}>(), {locale: undefined, windowDrag: false});

const emit = defineEmits<{
    "update:tab": [tab: "bot" | "sessions"];
    "open-contact": [key: string];
    "retry-contacts": [sectionKey: string];
}>();

defineSlots<{sessions(): unknown; "switch-end"?(): unknown}>();

const {t, locale} = provideAgentText(() => props.locale);

/** 每个挂上的列表一组面板 id：标签的 `aria-controls` 与面板的 `aria-labelledby` 对上。 */
const ids = `acv-messages-${Math.random().toString(36).slice(2, 8)}`;

const query = ref("");
const unreadTotal = computed(() => props.sections.reduce((sum, section) => sum + section.contacts.reduce((inner, contact) => inner + (contact.unread ?? 0), 0), 0));

/** 按名字筛（大小写不分）；段的状态照旧画。 */
const shown = computed(() => {
    const needle = query.value.trim().toLocaleLowerCase();
    return props.sections.map((section) => ({...section, contacts: needle === "" ? section.contacts : section.contacts.filter((contact) => contact.name.toLocaleLowerCase().includes(needle))}));
});
const allReady = computed(() => props.sections.every((section) => section.state.kind === "ready"));
const tabs = computed(() => [
    {value: "bot" as const, label: t("messages.tabBot"), count: unreadTotal.value, id: `${ids}-tab-bot`, controls: `${ids}-page-bot`},
    {value: "sessions" as const, label: t("messages.tabSessions"), count: 0, id: `${ids}-tab-sessions`, controls: `${ids}-page-sessions`},
]);
const tablistRef = ref<HTMLElement | null>(null);
/** 刚换到的那一页：只有它淡入一次。挂在常驻样式上的话，外框每次显示列表（开抽屉、展开列表栏）当前页都会再淡入。 */
const entering = ref<"bot" | "sessions" | null>(null);
watch(() => props.tab, (tab) => {
    entering.value = tab;
});

/** 方向键、Home、End 换页并把焦点带过去（tablist 的约定：移到哪个就选中哪个）。 */
function onTabKeydown(event: KeyboardEvent): void {
    const index = tabs.value.findIndex((item) => item.value === props.tab);
    const last = tabs.value.length - 1;
    const next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1) : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault();
    const target = tabs.value[next]!;
    if (target.value !== props.tab) emit("update:tab", target.value);
    void nextTick(() => tablistRef.value?.querySelector<HTMLElement>(`#${target.id}`)?.focus());
}
const total = computed(() => props.sections.reduce((sum, section) => sum + section.contacts.length, 0));
const matched = computed(() => shown.value.reduce((sum, section) => sum + section.contacts.length, 0));

const initial = (contact: MessagesContact): string => Array.from(contact.name.trim())[0] ?? "?";
const brokenAvatars = ref<ReadonlySet<string>>(new Set());
const avatarOf = (contact: MessagesContact): string | null => (contact.avatar !== undefined && !brokenAvatars.value.has(contact.avatar) ? contact.avatar : null);
function markBroken(src: string): void {
    brokenAvatars.value = new Set([...brokenAvatars.value, src]);
}
</script>

<template>
    <div class="acv-messages-list" data-messages-list>
        <div class="acv-messages-list__switch" :data-window-drag="props.windowDrag ? '' : undefined" data-messages-switch>
            <div ref="tablistRef" class="acv-messages-list__tabs" role="tablist" :aria-label="t('messages.list')" @keydown="onTabKeydown">
                <button
                    v-for="item in tabs"
                    :id="item.id"
                    :key="item.value"
                    type="button"
                    role="tab"
                    class="acv-messages-list__tab nb-ui-focus-ring"
                    :class="{'is-current': item.value === props.tab}"
                    :aria-selected="item.value === props.tab"
                    :aria-controls="item.controls"
                    :tabindex="item.value === props.tab ? 0 : -1"
                    :data-messages-tab="item.value"
                    @click="emit('update:tab', item.value)"
                >
                    {{ item.label }}
                    <Badge v-if="item.count > 0" size="sm" tone="accent">{{ item.count }}</Badge>
                </button>
            </div>
            <slot name="switch-end" />
        </div>
        <div v-show="props.tab === 'bot'" :id="`${ids}-page-bot`" class="acv-messages-list__page" :class="{'is-entering': entering === 'bot'}" role="tabpanel" :aria-labelledby="`${ids}-tab-bot`" data-messages-page="bot" @animationend.self="entering = null">
            <div class="acv-messages-list__search">
                <Input v-model="query" size="sm" :placeholder="t('messages.search')" :aria-label="t('messages.search')" data-messages-search />
            </div>
            <div class="acv-messages-list__rows">
                <template v-for="section in shown" :key="section.key">
                    <p v-if="section.state.kind === 'loading'" class="acv-messages-list__empty" data-messages-loading>{{ t("messages.loading") }}</p>
                    <div v-else-if="section.state.kind === 'failed'" class="acv-messages-list__failed" role="alert" :data-messages-failed="section.key">
                        <span>{{ section.state.message }}</span>
                        <Button size="sm" :data-messages-retry="section.key" @click="emit('retry-contacts', section.key)">{{ t("messages.retry") }}</Button>
                    </div>
                    <button
                        v-for="contact in section.contacts"
                        :key="contact.key"
                        type="button"
                        class="acv-messages-list__row"
                        :class="{'is-current': contact.key === props.selectedContact}"
                        :aria-current="contact.key === props.selectedContact ? 'true' : undefined"
                        :data-messages-contact="contact.key"
                        @click="emit('open-contact', contact.key)"
                    >
                        <img v-if="avatarOf(contact) !== null" :src="avatarOf(contact)!" alt="" class="acv-messages-list__avatar" @error="markBroken(contact.avatar!)">
                        <span v-else class="acv-messages-list__avatar acv-messages-list__avatar--initial" aria-hidden="true">{{ initial(contact) }}</span>
                        <span class="acv-messages-list__body">
                            <span class="acv-messages-list__line">
                                <span class="acv-messages-list__name">{{ contact.name }}</span>
                                <span v-if="contact.last !== null" class="acv-messages-list__time">{{ formatListTime(contact.last.at, props.now, locale) }}</span>
                            </span>
                            <span class="acv-messages-list__line">
                                <span v-if="contact.activity === 'running'" class="acv-messages-list__second" data-activity="running">{{ t("messages.running") }}</span>
                                <span v-else-if="contact.activity === 'waiting'" class="acv-messages-list__second" data-activity="waiting">{{ t("messages.waiting") }}</span>
                                <span v-else-if="contact.last !== null" class="acv-messages-list__second">{{ contact.last.text }}</span>
                                <span v-else class="acv-messages-list__second acv-messages-list__second--none">{{ t("messages.noMessage") }}</span>
                                <Badge v-if="(contact.unread ?? 0) > 0" size="sm" tone="accent" class="acv-messages-list__unread" data-messages-unread>{{ contact.unread }}</Badge>
                            </span>
                        </span>
                    </button>
                </template>
                <p v-if="allReady && total === 0" class="acv-messages-list__empty" data-messages-empty>{{ t("messages.empty") }}</p>
                <p v-else-if="total > 0 && matched === 0" class="acv-messages-list__empty" data-messages-no-match>{{ t("messages.noMatch") }}</p>
            </div>
        </div>
        <div v-show="props.tab === 'sessions'" :id="`${ids}-page-sessions`" class="acv-messages-list__page" :class="{'is-entering': entering === 'sessions'}" role="tabpanel" :aria-labelledby="`${ids}-tab-sessions`" data-messages-page="sessions" @animationend.self="entering = null">
            <slot name="sessions" />
        </div>
    </div>
</template>

<style scoped>
.acv-messages-list {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    font-size: var(--text-sm);
}

/* 切换这一行：两个标题式的标签，没有底线；右端留给外框的收起按钮。 */
.acv-messages-list__switch {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 4px;
    /* 宿主自绘窗口头时与对话头同高（`--acv-head-height`），缺省 40。 */
    height: var(--acv-head-height, 40px);
    padding: 0 8px 0 14px;
    user-select: none;
}

.acv-messages-list__switch[data-window-drag] {
    touch-action: none;
}

.acv-messages-list__tabs {
    display: flex;
    flex: 1;
    gap: 16px;
    min-width: 0;
    /* 放不下时裁掉，不压到右端的按钮；留出焦点环的位置。 */
    overflow: clip;
    overflow-clip-margin: 4px;
}

.acv-messages-list__tab {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 6px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 500;
    line-height: 28px;
    cursor: pointer;
    transition: color var(--motion-fast);
}

.acv-messages-list__tab:hover {
    color: var(--text-secondary);
}

.acv-messages-list__tab.is-current {
    color: var(--text-main);
    font-weight: 600;
}

.acv-messages-list__page {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
}

/* 换页时新的一页淡入；减少动效时时长令牌是 0。 */
.acv-messages-list__page.is-entering {
    animation: acv-messages-list-page-in var(--motion-base);
}

@keyframes acv-messages-list-page-in {
    from {
        opacity: 0;
    }
}

.acv-messages-list__search {
    flex-shrink: 0;
    padding: 8px 8px 4px;
}

.acv-messages-list__rows {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 4px;
}

.acv-messages-list__row {
    display: flex;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
}

.acv-messages-list__row:hover {
    background: var(--bg-hover);
}

.acv-messages-list__row.is-current {
    background: var(--accent-bg);
}

.acv-messages-list__avatar {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
}

.acv-messages-list__avatar--initial {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-subtle);
    color: var(--text-secondary);
}

.acv-messages-list__body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}

.acv-messages-list__line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
}

.acv-messages-list__name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-messages-list__time {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: var(--text-2xs);
}

.acv-messages-list__second {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-messages-list__second--none {
    color: var(--text-muted);
}

.acv-messages-list__second[data-activity="running"] {
    color: var(--accent-text);
}

.acv-messages-list__second[data-activity="waiting"] {
    color: var(--status-warning);
}

.acv-messages-list__unread {
    flex-shrink: 0;
}

.acv-messages-list__empty {
    margin: 0;
    padding: 16px 8px;
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-align: center;
}

.acv-messages-list__failed {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 16px 8px;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    text-align: center;
}
</style>
