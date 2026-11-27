<script setup lang="ts">
/**
 * “消息”视图的列表（同名 .md）：bot、会话两页，底部是切页的导航（docs/specs/agent/conversation.md 输出 57 的“展开”）。bot 一页是联系人，
 * 会话一页是宿主经插槽给的会话面板。纯受控；bot 页的搜索词宿主不绑时自己记。
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
}>(), {locale: undefined});

const emit = defineEmits<{
    "update:tab": [tab: "bot" | "sessions"];
    "open-contact": [key: string];
    "retry-contacts": [sectionKey: string];
    "escape-search": [];
}>();

/** bot 页的搜索词：宿主绑了就由宿主记（视图段收起时列表拿掉，搜索词不能跟着丢），不绑时这里记。 */
const query = defineModel<string>("botQuery", {default: ""});

defineSlots<{sessions(): unknown}>();

const {t, locale} = provideAgentText(() => props.locale);

/** 每个挂上的列表一组面板 id：标签的 `aria-controls` 与面板的 `aria-labelledby` 对上。 */
const ids = `acv-messages-${Math.random().toString(36).slice(2, 8)}`;

const unreadTotal = computed(() => props.sections.reduce((sum, section) => sum + section.contacts.reduce((inner, contact) => inner + (contact.unread ?? 0), 0), 0));
const anyWaiting = computed(() => props.sections.some((section) => section.contacts.some((contact) => contact.activity === "waiting")));

/** 按名字筛（大小写不分）；段的状态照旧画。 */
const shown = computed(() => {
    const needle = query.value.trim().toLocaleLowerCase();
    return props.sections.map((section) => ({...section, contacts: needle === "" ? section.contacts : section.contacts.filter((contact) => contact.name.toLocaleLowerCase().includes(needle))}));
});
const allReady = computed(() => props.sections.every((section) => section.state.kind === "ready"));
const tabs = computed(() => [
    {value: "bot" as const, label: t("messages.tabBot"), icon: "i-lucide-bot", id: `${ids}-tab-bot`, controls: `${ids}-page-bot`},
    {value: "sessions" as const, label: t("messages.tabSessions"), icon: "i-lucide-history", id: `${ids}-tab-sessions`, controls: `${ids}-page-sessions`},
]);
/** 导航项的读屏名：Bot 一项带上未读合计或“等你处理”（角标本身对读屏藏着）。 */
function navLabel(item: {readonly value: "bot" | "sessions"; readonly label: string}): string | undefined {
    if (item.value !== "bot") return undefined;
    if (anyWaiting.value) return t("messages.contactWaiting", {name: item.label});
    return unreadTotal.value > 0 ? t("messages.contactUnread", {name: item.label, count: unreadTotal.value}) : undefined;
}
const tablistRef = ref<HTMLElement | null>(null);
/** 刚换到的那一页：只有它淡入一次。挂在常驻样式上的话，外框每次显示列表（展开侧轨）当前页都会再淡入。 */
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

const rootRef = ref<HTMLElement | null>(null);

/** 这一页的搜索框：bot 页是自己的，会话页是插槽里会话面板的第一个输入框。 */
function searchOf(page: "bot" | "sessions"): HTMLInputElement | null {
    return rootRef.value?.querySelector<HTMLInputElement>(`[data-messages-page="${page}"] input`) ?? null;
}

defineExpose({focusSearch: (page: "bot" | "sessions") => searchOf(page)?.focus()});

/**
 * 搜索框里的 `Esc`（两页一样）：框里有字先清空，已空时交给宿主（把焦点交回聊天输入框）。会话页的搜索词在宿主，清空是在框上发一次 `input`，
 * 走它自己的 `v-model`，和用户删字一样。
 */
function onSearchKeydown(event: KeyboardEvent): void {
    const input = event.target;
    if (event.key !== "Escape" || event.defaultPrevented || !(input instanceof HTMLInputElement) || (input !== searchOf("bot") && input !== searchOf("sessions"))) return;
    event.preventDefault();
    event.stopPropagation();
    if (input.value !== "") {
        input.value = "";
        input.dispatchEvent(new Event("input", {bubbles: true}));
        return;
    }
    emit("escape-search");
}

const initial = (contact: MessagesContact): string => Array.from(contact.name.trim())[0] ?? "?";
const brokenAvatars = ref<ReadonlySet<string>>(new Set());
const avatarOf = (contact: MessagesContact): string | null => (contact.avatar !== undefined && !brokenAvatars.value.has(contact.avatar) ? contact.avatar : null);
function markBroken(src: string): void {
    brokenAvatars.value = new Set([...brokenAvatars.value, src]);
}
</script>

<template>
    <div ref="rootRef" class="acv-messages-list" data-messages-list @keydown="onSearchKeydown">
        <div v-show="props.tab === 'bot'" :id="`${ids}-page-bot`" class="acv-messages-list__page" :class="{'is-entering': entering === 'bot'}" role="tabpanel" :aria-labelledby="`${ids}-tab-bot`" data-messages-page="bot" @animationend.self="entering = null">
            <div class="acv-messages-list__search">
                <Input v-model="query" size="sm" icon-class="i-lucide-search" :placeholder="t('messages.searchHint')" :aria-label="t('messages.search')" data-messages-search />
            </div>
            <div class="acv-messages-list__rows">
                <template v-for="section in shown" :key="section.key">
                    <p v-if="section.state.kind === 'loading'" class="acv-messages-list__empty" data-messages-loading>{{ t("messages.loading") }}</p>
                    <div v-else-if="section.state.kind === 'failed'" class="acv-messages-list__failed" role="alert" :data-messages-failed="section.key">
                        <span>{{ section.state.message }}</span>
                        <Button variant="primary" size="sm" :data-messages-retry="section.key" @click="emit('retry-contacts', section.key)">{{ t("messages.retry") }}</Button>
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
        <!-- 图标同收着时底段的两项：展开的过渡里那两项移到这里（workbench-layout 输出 50 的“展开时的版式”）。 -->
        <div ref="tablistRef" class="acv-messages-list__nav" role="tablist" :aria-label="t('messages.list')" data-messages-nav @keydown="onTabKeydown">
            <button
                v-for="item in tabs"
                :id="item.id"
                :key="item.value"
                type="button"
                role="tab"
                class="acv-messages-list__tab nb-ui-focus-ring"
                :aria-selected="item.value === props.tab"
                :aria-controls="item.controls"
                :tabindex="item.value === props.tab ? 0 : -1"
                :aria-label="navLabel(item)"
                :data-messages-tab="item.value"
                @click="emit('update:tab', item.value)"
            >
                <span class="acv-messages-list__tab-icon" aria-hidden="true">
                    <span :class="item.icon" class="acv-messages-list__glyph" />
                    <template v-if="item.value === 'bot'">
                        <span
                            v-if="unreadTotal > 0"
                            class="acv-messages-list__summary"
                            data-messages-summary
                            :data-messages-summary-waiting="anyWaiting ? '' : undefined"
                        >{{ unreadTotal > 99 ? "99+" : unreadTotal }}</span>
                        <span v-else-if="anyWaiting" class="acv-messages-list__summary-dot" data-messages-summary data-messages-summary-waiting />
                    </template>
                </span>
                <span class="acv-messages-list__tab-label">{{ item.label }}</span>
            </button>
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

/* 底部导航：两项等分，图标在上、字在下，当前页强调色（只给当前项）。 */
.acv-messages-list__nav {
    display: flex;
    flex-shrink: 0;
    align-items: stretch;
    height: 52px;
    border-top: var(--border-w) solid var(--border-color);
    user-select: none;
}

.acv-messages-list__tab {
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-width: 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--text-2xs);
    cursor: pointer;
    transition: color var(--motion-fast);
}

.acv-messages-list__tab:hover {
    color: var(--text-secondary);
}

.acv-messages-list__tab[aria-selected="true"] {
    color: var(--accent-text);
    font-weight: 600;
}

.acv-messages-list__tab-icon {
    position: relative;
    display: inline-flex;
}

.acv-messages-list__glyph {
    width: 18px;
    height: 18px;
}

.acv-messages-list__tab-label {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 未读合计：中性色的小胶囊（强调色只给当前项）；有等你处理时 warning 色、方角，不只靠颜色区分。 */
.acv-messages-list__summary {
    position: absolute;
    top: -5px;
    left: calc(100% - 4px);
    min-width: 15px;
    height: 15px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--text-secondary);
    color: var(--text-inverse);
    font-size: var(--text-2xs);
    font-weight: 600;
    line-height: 15px;
    text-align: center;
}

.acv-messages-list__summary[data-messages-summary-waiting] {
    border-radius: 4px;
    background: var(--status-warning);
}

.acv-messages-list__summary-dot {
    position: absolute;
    top: -2px;
    right: -3px;
    width: 9px;
    height: 9px;
    border: 2px solid var(--panel-surface);
    border-radius: 50%;
    background: var(--status-warning);
}

.acv-messages-list__page {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
}

/* 换页时新的一页淡入（只有透明度，减少动效时照常）。 */
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
    /* 右端让出视图段画在列表区右上角的按钮（`--acv-list-inset-end`，缺省 0）。 */
    padding: 8px calc(8px + var(--acv-list-inset-end, 0px)) 4px 8px;
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
