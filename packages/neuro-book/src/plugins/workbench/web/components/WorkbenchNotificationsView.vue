<script setup lang="ts">
/** “通知”视图（同名 .md）：本窗口的通知中心；可见性由这里上报给中心。 */
import {hasNotificationDetail} from "@notnotype/nb-ui/notifications";
import {Button, DetailDialog, IconButton} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {computed, ref, useId} from "vue";

import {fullTime, shortTime} from "nbook/shared/short-time";
import {useForegroundVisibility} from "nbook/ui/foreground-visibility";

import {workbenchText} from "../../shared/text";
import type {NotificationTone} from "../../shared/contracts";
import type {ViewContext} from "../contracts";
import type {CenterEntry, NotificationCenter} from "../notifications";

defineOptions({name: "WorkbenchNotificationsView"});

const props = defineProps<{
    context: ViewContext;
    center: NotificationCenter;
}>();

const port = useText();

const TONE_ICON: Readonly<Record<NotificationTone, string>> = {
    info: "i-lucide-info",
    success: "i-lucide-circle-check",
    warning: "i-lucide-triangle-alert",
    error: "i-lucide-circle-x",
};

// 输出 15、16：视图有效可见、并且页面在前台才算可见；卸载时报不可见，去书架页以后通知照常弹出。
useForegroundVisibility(props.context.visible, (visible) => props.center.setVisible(visible));

/** 每行文字的 id 前缀：行里的按钮用 `aria-describedby` 指向它，同名的“详情”“移除”读屏分得出是哪一条。 */
const idPrefix = useId();
const textId = (entry: CenterEntry): string => `${idPrefix}-${entry.id}`;

const entries = computed(() => props.center.entries.value);

/** 时间列只在列表重画时更新，不另开计时器。 */
function timeOf(entry: CenterEntry): string {
    return shortTime(entry.at, Date.now(), port.locale.value, port.t(workbenchText("time.yesterday")));
}

function titleOf(entry: CenterEntry): string {
    return entry.title === undefined ? "" : port.t(entry.title);
}

function whole(entry: CenterEntry): string {
    const title = titleOf(entry);
    const message = port.t(entry.message);
    return title === "" ? message : port.t(workbenchText("items.titled", {title, text: message}));
}

const detail = ref<{readonly title: string; readonly text: string; readonly truncated: boolean} | null>(null);
const detailOpen = ref(false);

function openDetail(entry: CenterEntry): void {
    if (entry.detail === undefined) return;
    const title = titleOf(entry);
    detail.value = {
        title: title === "" ? port.t(workbenchText("notificationCenter.detailOnly")) : port.t(workbenchText("notificationCenter.detailTitle", {title})),
        text: entry.detail,
        truncated: entry.detailTruncated === true,
    };
    detailOpen.value = true;
}
</script>

<template>
    <div class="notifications-view" data-notifications-view>
        <p v-if="entries.length === 0" class="notifications-view__empty">{{ port.t(workbenchText("notificationCenter.empty")) }}</p>
        <ul v-else class="notifications-view__list" :aria-label="port.t(workbenchText('views.notifications.title'))">
            <li
                v-for="entry in entries"
                :key="entry.id"
                class="notifications-view__row"
                :data-tone="entry.tone"
                :data-unread="entry.unread || undefined"
                :data-notification-entry="entry.id"
            >
                <span class="notifications-view__dot" :title="entry.unread ? port.t(workbenchText('notificationCenter.unread')) : undefined">
                    <span v-if="entry.unread" class="sr-only">{{ port.t(workbenchText("notificationCenter.unread")) }}</span>
                </span>
                <span class="notifications-view__icon" :class="TONE_ICON[entry.tone]" aria-hidden="true"></span>
                <span :id="textId(entry)" class="notifications-view__text" :title="whole(entry)">
                    <span v-if="titleOf(entry) !== ''" class="notifications-view__title">{{ titleOf(entry) }}</span>
                    <span class="notifications-view__message">{{ port.t(entry.message) }}</span>
                </span>
                <span class="notifications-view__time" :title="port.t(workbenchText('notificationCenter.sentAt', {time: fullTime(entry.at, port.locale.value)}))">{{ timeOf(entry) }}</span>
                <span class="notifications-view__actions">
                    <Button v-if="entry.action !== undefined" size="sm" variant="ghost" focus-ring="inset" :aria-describedby="textId(entry)" data-notification-action @click="center.run(entry.id)">{{ port.t(entry.action.label) }}</Button>
                    <Button v-if="hasNotificationDetail(entry.detail)" size="sm" variant="ghost" focus-ring="inset" :aria-describedby="textId(entry)" data-notification-detail @click="openDetail(entry)">{{ port.t(workbenchText("notificationCenter.detail")) }}</Button>
                </span>
                <IconButton size="xs" focus-ring="inset" icon-class="i-lucide-x" :aria-label="port.t(workbenchText('notificationCenter.remove'))" :title="port.t(workbenchText('notificationCenter.remove'))" :aria-describedby="textId(entry)" data-notification-remove @click="center.remove(entry.id)" />
            </li>
        </ul>
        <DetailDialog v-if="detail !== null" v-model:open="detailOpen" :title="detail.title" :detail="detail.text" :truncated="detail.truncated" @closed="detail = null" />
    </div>
</template>

<style scoped>
.notifications-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: auto;
    padding: var(--space-1) var(--space-2);
}

/* 空的时候说明居中（docs/specs/workbench/notifications.md 输出 14）。 */
.notifications-view__empty {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    justify-content: center;
    margin: 0;
    padding: var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-sm);
    text-align: center;
}

/* 整个列表共用几列：长短不一的标题不推动后面的列。 */
.notifications-view__list {
    display: grid;
    grid-template-columns: 6px 16px minmax(0, 1fr) minmax(3.5em, max-content) max-content 24px;
    column-gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
}

.notifications-view__row {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    align-items: center;
    min-height: 28px;
    padding-inline: var(--space-2);
    border-radius: var(--radius-control);
    font-size: var(--text-sm);
    line-height: var(--leading-ui);
}

.notifications-view__row:hover {
    background: color-mix(in srgb, var(--text-main) 5%, transparent);
}

.notifications-view__dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
}

[data-unread] .notifications-view__dot {
    background: var(--accent-main);
}

.notifications-view__icon {
    width: 16px;
    height: 16px;
    color: var(--text-secondary);
}

[data-tone="success"] .notifications-view__icon { color: var(--status-success, var(--text-secondary)); }
[data-tone="warning"] .notifications-view__icon { color: var(--status-warning); }
[data-tone="error"] .notifications-view__icon { color: var(--status-danger); }

.notifications-view__text {
    display: flex;
    gap: var(--space-2);
    overflow: hidden;
    min-width: 0;
    white-space: nowrap;
}

.notifications-view__title {
    flex: 0 0 auto;
    color: var(--text-main);
}

[data-unread] .notifications-view__title {
    font-weight: var(--weight-strong);
}

.notifications-view__message {
    overflow: hidden;
    min-width: 0;
    color: var(--text-secondary);
    text-overflow: ellipsis;
}

.notifications-view__time {
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    text-align: end;
    white-space: nowrap;
}

.notifications-view__actions {
    display: flex;
    gap: var(--space-1);
}
</style>
