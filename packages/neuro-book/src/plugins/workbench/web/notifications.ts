/**
 * 工作台的通知服务（docs/specs/workbench/notifications.md）：本窗口一份 nb-ui 通知队列，`notificationsKey` 的提供项包着它，
 * 页面根上的 `NotificationStack` 显示它。常驻规则在这里定：error 与带动作的通知不自动消失，调用方不用自己算时长。
 * 动作抛错由这里接住并经 `report` 记诊断（`workbench.notifications`）；视口在动作之后移除通知。
 *
 * 文字原样进队列，由视口在渲染时经窗口的翻译端口翻（输出 9）；这里只在写诊断时用 `text` 把动作名翻成此刻的字符串。
 */

// 队列从不带 DOM 的子路径取：本文件与插件入口一起在无 DOM 的编译组里，composables 的总出口会把用到 window 的别的 composable 一起拉进来。
import {createNotificationQueue, DEFAULT_NOTIFICATION_DURATION} from "@notnotype/nb-ui/notifications";
import type {NotificationQueue, NotificationTone as QueueTone} from "@notnotype/nb-ui/notifications";

import type {TextResolver} from "nbook/shared/localized-text";

import type {NotificationHandle, NotificationInput, Notifications, NotificationTone} from "../shared/contracts";

export interface WindowNotifications extends Notifications {
    /** 交给视口显示的队列。 */
    readonly queue: NotificationQueue;
    /** 入口停止时清空：计时器随之清掉。 */
    dispose(): void;
}

/** 服务合同的色调沿用 Spec 的 `error`；nb-ui 的通知队列用组件词表里的 `danger`。 */
function queueTone(tone: NotificationTone): QueueTone {
    return tone === "error" ? "danger" : tone;
}

function durationOf(input: {readonly tone: QueueTone; readonly action?: NotificationInput["action"]; readonly sticky?: boolean}): number {
    const sticky = input.sticky ?? (input.tone === "danger" || input.action !== undefined);
    return sticky ? 0 : DEFAULT_NOTIFICATION_DURATION[input.tone];
}

type NotificationAction = NonNullable<NotificationInput["action"]>;

export function createNotifications(report: (message: string) => void, text: Pick<TextResolver, "t">): WindowNotifications {
    const queue = createNotificationQueue();
    const guarded = (action: NotificationAction): NotificationAction => ({
        label: action.label,
        run: () => {
            try {
                action.run();
            } catch (error) {
                report(`通知动作“${text.t(action.label)}”失败：${error instanceof Error ? error.message : String(error)}`);
            }
        },
    });
    return {
        queue,
        notify: (input) => {
            // 调用方明确给的常驻与否单独记：队列里只有折算后的时长，反推不出“没给”与“给了 false”。
            let sticky = input.sticky;
            const tone = queueTone(input.tone ?? "info");
            const id = queue.notify({
                message: input.message,
                tone,
                duration: durationOf({tone, action: input.action, sticky}),
                ...(input.title === undefined ? {} : {title: input.title}),
                ...(input.action === undefined ? {} : {action: guarded(input.action)}),
                ...(input.progress === undefined ? {} : {progress: input.progress}),
            });
            const handle: NotificationHandle = {
                id,
                update: (patch) => {
                    const current = queue.notifications.value.find((item) => item.id === id);
                    if (current === undefined) return;
                    // 常驻与否随色调和动作一起重算：进度条的任务结束后改成 success 就会按时消失；明确给过的 sticky 保留到再次明确改它。
                    if (patch.sticky !== undefined) sticky = patch.sticky;
                    const merged = {tone: patch.tone === undefined ? current.tone : queueTone(patch.tone), action: patch.action ?? current.action, sticky};
                    const rescheduling = patch.sticky !== undefined || patch.tone !== undefined || patch.action !== undefined;
                    queue.update(id, {
                        ...(patch.title === undefined ? {} : {title: patch.title}),
                        ...(patch.message === undefined ? {} : {message: patch.message}),
                        ...(patch.tone === undefined ? {} : {tone: queueTone(patch.tone)}),
                        ...(patch.action === undefined ? {} : {action: guarded(patch.action)}),
                        ...(patch.progress === undefined ? {} : {progress: patch.progress}),
                        ...(rescheduling ? {duration: durationOf(merged)} : {}),
                    });
                },
                dismiss: () => queue.remove(id),
            };
            return handle;
        },
        dispose: () => queue.clearAll(),
    };
}
