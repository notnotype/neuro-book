/**
 * 工作台的通知服务（docs/specs/workbench/notifications.md）：本窗口一份 nb-ui 通知队列，`notificationsKey` 的提供项包着它，
 * 页面根上的 `NotificationStack` 显示它。常驻规则只在这里定：error、带动作与带详情的通知不自动消失，调用方不用自己算时长；
 * nb-ui 的队列只认折算好的时长，“有没有详情”与视口共用 `hasNotificationDetail` 一个判据。
 * 动作抛错由这里接住并经 `report` 记诊断（`workbench.notifications`）；视口在动作之后移除通知。
 *
 * 文字原样进队列，由视口在渲染时经窗口的翻译端口翻（输出 9）；这里只在写诊断时用 `text` 把动作名翻成此刻的字符串。
 *
 * 通知中心（输出 13 到 16）：每条通知同时记进中心，与弹出的那一份同一个 id。三种从弹出处移除的方式在 nb-ui 队列里都是
 * `remove`，只有这里分得清：用户关掉与到时只动队列，中心留着；发出方 `dismiss` 两边一起移除；动作由 `guarded` 包着，执行后
 * 两边一起移除，所以在弹出处与在中心里点动作结果相同。“通知”视图是否可见由视图组件上报（它能读页面在不在前台、卸载时报
 * 不可见），本文件不碰 DOM。
 */

// 队列从不带 DOM 的子路径取：本文件与插件入口一起在无 DOM 的编译组里，composables 的总出口会把用到 window 的别的 composable 一起拉进来。
import {createNotificationQueue, DEFAULT_NOTIFICATION_DURATION, hasNotificationDetail, notificationDetailFields} from "@notnotype/nb-ui/notifications";
import type {NotificationQueue, NotificationTone as QueueTone} from "@notnotype/nb-ui/notifications";
import {computed, shallowRef} from "@vue/reactivity";
import type {ComputedRef, Ref} from "@vue/reactivity";

import type {TextResolver} from "nbook/shared/localized-text";

import type {NotificationHandle, NotificationInput, Notifications, NotificationTone} from "../shared/contracts";

/** “通知”视图的 id（输出 14）；铃铛执行 `nbook.view.open` 打开它。 */
export const NOTIFICATIONS_VIEW = "nbook.workbench.notifications";

/** 通知中心至多留几条（输出 13）。 */
export const CENTER_LIMIT = 100;

/** 中心里的一条：发出时的输入（动作已包好）加发出时刻与看过没有。 */
export interface CenterEntry {
    readonly id: string;
    readonly tone: NotificationTone;
    readonly title?: NotificationInput["title"];
    readonly message: NotificationInput["message"];
    readonly action?: NonNullable<NotificationInput["action"]>;
    readonly detail?: string;
    readonly detailTruncated?: boolean;
    /** 发出的时刻（毫秒）。 */
    readonly at: number;
    readonly unread: boolean;
}

export interface NotificationCenter {
    /** 新的在前。 */
    readonly entries: Readonly<Ref<readonly CenterEntry[]>>;
    readonly unread: ComputedRef<number>;
    /** 在中心里点动作：执行，并从中心与弹出的队列一起移除。 */
    run(id: string): void;
    /** 在中心里点移除：只从中心移除。 */
    remove(id: string): void;
    /** “全部清除”。 */
    clear(): void;
    /** 视图上报自己是否有效可见（含页面在前台）；可见时中心全部算看过，新通知不弹出（输出 15、16）。 */
    setVisible(visible: boolean): void;
}

export interface WindowNotifications extends Notifications {
    /** 交给视口显示的队列。 */
    readonly queue: NotificationQueue;
    readonly center: NotificationCenter;
    /** 入口停止时清空：计时器随之清掉。 */
    dispose(): void;
}

/** 服务合同的色调沿用 Spec 的 `error`；nb-ui 的通知队列用组件词表里的 `danger`。 */
function queueTone(tone: NotificationTone): QueueTone {
    return tone === "error" ? "danger" : tone;
}

/** 输出 3、5：明确给的 sticky（含 false）优先；没给时 error、带动作、带详情的常驻。 */
function durationOf(input: {readonly tone: QueueTone; readonly action?: NotificationInput["action"]; readonly hasDetail: boolean; readonly sticky?: boolean}): number {
    const sticky = input.sticky ?? (input.tone === "danger" || input.action !== undefined || input.hasDetail);
    return sticky ? 0 : DEFAULT_NOTIFICATION_DURATION[input.tone];
}

type NotificationAction = NonNullable<NotificationInput["action"]>;

export function createNotifications(report: (message: string) => void, text: Pick<TextResolver, "t">, now: () => number = Date.now): WindowNotifications {
    const queue = createNotificationQueue();
    const entries = shallowRef<readonly CenterEntry[]>([]);
    /** 中心的 id 到弹出的队列里那一条的 id；视图开着时发出的不进队列，没有这一项。 */
    const queued = new Map<string, string>();
    let visible = false;
    let counter = 0;

    const patchEntry = (id: string, patch: Partial<CenterEntry>): void => {
        entries.value = entries.value.map((entry) => (entry.id === id ? {...entry, ...patch} : entry));
    };
    /** 从中心与弹出的队列一起移除。 */
    const drop = (id: string): void => {
        entries.value = entries.value.filter((entry) => entry.id !== id);
        const queueId = queued.get(id);
        queued.delete(id);
        if (queueId !== undefined) queue.remove(queueId);
    };
    const guarded = (id: string, action: NotificationAction): NotificationAction => ({
        label: action.label,
        run: () => {
            try {
                action.run();
            } catch (error) {
                report(`通知动作“${text.t(action.label)}”失败：${error instanceof Error ? error.message : String(error)}`);
            } finally {
                drop(id);
            }
        },
    });
    const withoutDetail = (entry: CenterEntry): CenterEntry => {
        const {detail: _detail, detailTruncated: _truncated, ...rest} = entry;
        return rest;
    };

    const center: NotificationCenter = {
        entries,
        unread: computed(() => entries.value.filter((entry) => entry.unread).length),
        run: (id) => entries.value.find((entry) => entry.id === id)?.action?.run(),
        remove: (id) => {
            entries.value = entries.value.filter((entry) => entry.id !== id);
        },
        clear: () => {
            entries.value = [];
        },
        setVisible: (next) => {
            visible = next;
            if (next && entries.value.some((entry) => entry.unread)) entries.value = entries.value.map((entry) => (entry.unread ? {...entry, unread: false} : entry));
        },
    };

    return {
        queue,
        center,
        notify: (input) => {
            counter += 1;
            const id = `notification-${String(counter)}`;
            const action = input.action === undefined ? undefined : guarded(id, input.action);
            const entry: CenterEntry = {
                id,
                tone: input.tone ?? "info",
                message: input.message,
                at: now(),
                unread: !visible,
                ...(input.title === undefined ? {} : {title: input.title}),
                ...(action === undefined ? {} : {action}),
                // 中心另存一份：截断与“已截断”同队列一个规则（视图开着时不进队列，只有这一份）。
                ...notificationDetailFields(input.detail, input.detailTruncated),
            };
            entries.value = [entry, ...entries.value].slice(0, CENTER_LIMIT);
            // 用户关掉、到时消失的只在队列里移除，这里看不到：每次发出时扫掉已不在队列里的对应关系，表不随会话变长。
            const live = new Set(queue.notifications.value.map((item) => item.id));
            for (const [centerId, queueId] of queued) if (!live.has(queueId)) queued.delete(centerId);
            // 调用方明确给的常驻与否单独记：队列里只有折算后的时长，反推不出“没给”与“给了 false”。
            let sticky = input.sticky;
            if (!visible) {
                const tone = queueTone(input.tone ?? "info");
                queued.set(id, queue.notify({
                    message: input.message,
                    tone,
                    duration: durationOf({tone, action: input.action, hasDetail: hasNotificationDetail(input.detail), sticky}),
                    ...(input.title === undefined ? {} : {title: input.title}),
                    ...(input.detail === undefined ? {} : {detail: input.detail, ...(input.detailTruncated === undefined ? {} : {detailTruncated: input.detailTruncated})}),
                    ...(action === undefined ? {} : {action}),
                    ...(input.progress === undefined ? {} : {progress: input.progress}),
                }));
            }
            const handle: NotificationHandle = {
                id,
                update: (patch) => {
                    const known = entries.value.find((item) => item.id === id);
                    if (known !== undefined) {
                        const next: Partial<CenterEntry> = {
                            ...(patch.title === undefined ? {} : {title: patch.title}),
                            ...(patch.message === undefined ? {} : {message: patch.message}),
                            ...(patch.tone === undefined ? {} : {tone: patch.tone}),
                            ...(patch.action === undefined ? {} : {action: guarded(id, patch.action)}),
                        };
                        if (patch.detail !== undefined && !hasNotificationDetail(patch.detail)) entries.value = entries.value.map((item) => (item.id === id ? withoutDetail({...item, ...next}) : item));
                        else patchEntry(id, {...next, ...(patch.detail === undefined ? {} : notificationDetailFields(patch.detail, patch.detailTruncated))});
                    }
                    const queueId = queued.get(id);
                    const current = queueId === undefined ? undefined : queue.notifications.value.find((item) => item.id === queueId);
                    if (queueId === undefined || current === undefined) return;
                    // 常驻与否随色调、动作与详情的有无一起重算：进度条的任务结束后改成 success 就会按时消失；明确给过的 sticky 保留到再次明确改它。
                    // 详情只在“有无”变化时重算（换一段原文不重新计时），读的是队列条目里的当前值，不另存一份。
                    if (patch.sticky !== undefined) sticky = patch.sticky;
                    const hadDetail = hasNotificationDetail(current.detail);
                    const hasDetail = patch.detail === undefined ? hadDetail : hasNotificationDetail(patch.detail);
                    const merged = {tone: patch.tone === undefined ? current.tone : queueTone(patch.tone), action: patch.action ?? current.action, hasDetail, sticky};
                    const rescheduling = patch.sticky !== undefined || patch.tone !== undefined || patch.action !== undefined || hasDetail !== hadDetail;
                    queue.update(queueId, {
                        ...(patch.title === undefined ? {} : {title: patch.title}),
                        ...(patch.message === undefined ? {} : {message: patch.message}),
                        ...(patch.tone === undefined ? {} : {tone: queueTone(patch.tone)}),
                        ...(patch.action === undefined ? {} : {action: guarded(id, patch.action)}),
                        ...(patch.progress === undefined ? {} : {progress: patch.progress}),
                        ...(patch.detail === undefined ? {} : {detail: patch.detail, ...(patch.detailTruncated === undefined ? {} : {detailTruncated: patch.detailTruncated})}),
                        ...(rescheduling ? {duration: durationOf(merged)} : {}),
                    });
                },
                dismiss: () => drop(id),
            };
            return handle;
        },
        dispose: () => {
            queue.clearAll();
            queued.clear();
            entries.value = [];
        },
    };
}
