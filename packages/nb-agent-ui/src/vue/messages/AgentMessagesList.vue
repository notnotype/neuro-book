<script setup lang="ts">
/**
 * “消息”视图的列表（同名 .md）：bot、会话两个标签。bot 一页是联系人，会话一页是宿主经插槽给的会话面板。纯受控，只有搜索词是自己的。
 */
import {computed, ref} from "vue";
import {Badge, Button, Input, Tabs} from "@notnotype/nb-ui/components";

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
}>();

defineSlots<{sessions(): unknown}>();

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
    {value: "bot", label: t("messages.tabBot"), ...(unreadTotal.value > 0 ? {count: unreadTotal.value} : {}), id: `${ids}-tab-bot`, controls: `${ids}-page-bot`, attrs: {"data-messages-tab": "bot"}},
    {value: "sessions", label: t("messages.tabSessions"), id: `${ids}-tab-sessions`, controls: `${ids}-page-sessions`, attrs: {"data-messages-tab": "sessions"}},
]);
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
        <Tabs
            class="acv-messages-list__tabs"
            size="sm"
            :model-value="props.tab"
            :items="tabs"
            :aria-label="t('messages.list')"
            @update:model-value="(value: string) => emit('update:tab', value === 'bot' ? 'bot' : 'sessions')"
        />
        <div v-show="props.tab === 'bot'" :id="`${ids}-page-bot`" class="acv-messages-list__page" role="tabpanel" :aria-labelledby="`${ids}-tab-bot`" data-messages-page="bot">
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
        <div v-show="props.tab === 'sessions'" :id="`${ids}-page-sessions`" class="acv-messages-list__page" role="tabpanel" :aria-labelledby="`${ids}-tab-sessions`" data-messages-page="sessions">
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

.acv-messages-list__tabs {
    flex-shrink: 0;
    padding: 4px 8px 0;
}

.acv-messages-list__page {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
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
