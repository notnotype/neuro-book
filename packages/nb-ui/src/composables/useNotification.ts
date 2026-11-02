import {shallowRef} from "vue";
import type {ShallowRef} from "vue";

import type {Text} from "../text";

/** 通知的语调，`Tone` 的子集（components/shared-types.ts）。`error()` 是“发一条出错通知”的动作名，发出的语调是 `danger`。 */
export type NotificationTone = "info" | "success" | "warning" | "danger";

/**
 * 通知里的文字是文字值（docs/specs/ui/i18n.md）：队列原样存着，视口渲染时经翻译端口翻成当前语言，切换语言后已显示的
 * 通知跟着换文字。不要先折成字符串再交进来。
 */
export type NotificationAction = {
    label: Text;
    run: () => void;
};

export type NotificationInput = {
    message: Text;
    title?: Text;
    tone?: NotificationTone;
    action?: NotificationAction;
    /** 自动关闭的毫秒数；0 为常驻（只能手动关闭或由发出方移除）。缺省按色调取：info、success 3200，warning 4200，danger 5200。 */
    duration?: number;
    /** 进度（0 到 100）；null 为不确定进度。不给就没有进度条。 */
    progress?: number | null;
};

/** 已发出的通知能改的字段；`duration` 给了就按新时长重新计时。 */
export type NotificationPatch = Partial<NotificationInput>;

export type NotificationItem = Required<Pick<NotificationInput, "tone" | "duration">> & NotificationInput & {
    id: string;
};

/**
 * 一份通知队列：发出、更新、移除与自动关闭计时。视口（`NotificationStack`）从它读列表、经它关闭；悬停时暂停计时。
 * 列表只经这里的方法改，对外是只读的 ref。
 */
export interface NotificationQueue {
    readonly notifications: Readonly<ShallowRef<ReadonlyArray<NotificationItem>>>;
    notify(input: NotificationInput | string): string;
    /** 改已发出的通知（进度、文字、动作）；不存在的 id 忽略。 */
    update(id: string, patch: NotificationPatch): void;
    remove(id: string): void;
    /** 清空全部通知与计时器（测试隔离、登出清屏等场景）。 */
    clearAll(): void;
    /** 暂停自动关闭（悬停时调用）。暂停期间 `update` 改了时长也只记下新的到期时间，不会到点移除。 */
    pause(id: string): void;
    /** 恢复自动关闭：按剩余时长重新计时（至少留 800ms 反应时间）；常驻的不计时。 */
    resume(id: string): void;
    success(message: Text, options?: Omit<NotificationInput, "message" | "tone">): string;
    warning(message: Text, options?: Omit<NotificationInput, "message" | "tone">): string;
    error(message: Text, options?: Omit<NotificationInput, "message" | "tone">): string;
    info(message: Text, options?: Omit<NotificationInput, "message" | "tone">): string;
}

/** 各色调的缺省自动关闭时长（毫秒）。 */
export const DEFAULT_NOTIFICATION_DURATION: Readonly<Record<NotificationTone, number>> = {info: 3200, success: 3200, warning: 4200, danger: 5200};

function createId(): string {
    return `notice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createNotificationQueue(): NotificationQueue {
    const notifications = shallowRef<ReadonlyArray<NotificationItem>>([]);
    const timers = new Map<string, ReturnType<typeof globalThis.setTimeout>>();
    // 自动关闭到期时间戳；resume 时据此换算剩余时长
    const deadlines = new Map<string, number>();
    // 悬停中的通知。单独记，不靠“有没有计时器”判断：常驻的悬停时本来就没有计时器，悬停中被改成限时也不能开始计时。
    const paused = new Set<string>();

    function clearTimer(id: string): void {
        const timer = timers.get(id);
        if (timer === undefined) return;
        globalThis.clearTimeout(timer);
        timers.delete(id);
    }

    function remove(id: string): void {
        clearTimer(id);
        deadlines.delete(id);
        paused.delete(id);
        notifications.value = notifications.value.filter((item) => item.id !== id);
    }

    /** 从现在起按 duration 计时；悬停中只记到期时间，等 resume。 */
    function schedule(id: string, duration: number): void {
        clearTimer(id);
        deadlines.set(id, Date.now() + duration);
        if (paused.has(id)) return;
        timers.set(id, globalThis.setTimeout(() => remove(id), duration));
    }

    function pause(id: string): void {
        if (!notifications.value.some((item) => item.id === id)) return;
        paused.add(id);
        clearTimer(id);
    }

    function resume(id: string): void {
        if (!paused.delete(id)) return;
        const deadline = deadlines.get(id);
        if (deadline !== undefined) schedule(id, Math.max(deadline - Date.now(), 800));
    }

    function notify(input: NotificationInput | string): string {
        const normalized = typeof input === "string" ? {message: input} : input;
        const tone = normalized.tone ?? "info";
        const item: NotificationItem = {
            id: createId(),
            message: normalized.message,
            title: normalized.title,
            tone,
            action: normalized.action,
            duration: normalized.duration ?? DEFAULT_NOTIFICATION_DURATION[tone],
            ...(normalized.progress === undefined ? {} : {progress: normalized.progress}),
        };
        notifications.value = [...notifications.value, item];
        if (item.duration > 0) {
            schedule(item.id, item.duration);
        }
        return item.id;
    }

    function update(id: string, patch: NotificationPatch): void {
        const index = notifications.value.findIndex((item) => item.id === id);
        if (index === -1) return;
        const current = notifications.value[index] as NotificationItem;
        const next: NotificationItem = {...current, ...patch, tone: patch.tone ?? current.tone, duration: patch.duration ?? current.duration};
        notifications.value = notifications.value.map((item) => (item.id === id ? next : item));
        if (patch.duration === undefined) return;
        // 时长变了就从现在重新计时：常驻改成限时是“任务结束了”，限时改成常驻是“出错要人看”。
        if (next.duration > 0) schedule(id, next.duration);
        else {
            clearTimer(id);
            deadlines.delete(id);
        }
    }

    function clearAll(): void {
        for (const timer of timers.values()) {
            globalThis.clearTimeout(timer);
        }
        timers.clear();
        deadlines.clear();
        paused.clear();
        notifications.value = [];
    }

    return {
        notifications,
        notify,
        update,
        remove,
        clearAll,
        pause,
        resume,
        success: (message, options) => notify({...options, message, tone: "success"}),
        warning: (message, options) => notify({...options, message, tone: "warning"}),
        error: (message, options) => notify({...options, message, tone: "danger"}),
        info: (message, options) => notify({...options, message, tone: "info"}),
    };
}

const defaultQueue = createNotificationQueue();

/**
 * 模块级的缺省通知队列：宿主应用只挂一个 `NotificationStack` 就能显示各处发出的通知。
 * 要隔离的队列（一个窗口一份、测试、Lab 场景）用 `createNotificationQueue()` 自建，再传给视口的 `queue`。
 */
export function useNotification(): NotificationQueue {
    return defaultQueue;
}
