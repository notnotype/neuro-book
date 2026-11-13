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
    /**
     * 开发诊断原文：不翻译、必须已脱敏（docs/specs/workbench/notifications.md）。有它时视口出“详情”入口，点开 `DetailDialog`。
     * 空串与全空白等于没有（`hasNotificationDetail`）；超过 `NOTIFICATION_DETAIL_MAX_CHARS` 的部分截掉并置 `detailTruncated`。
     * 队列不按它折算时长：带详情要常驻的，调用方自己给 `duration: 0`（工作台服务按规则算好再交进来）。
     */
    detail?: string;
    /** 原文已被截断：发出方自己截过时置上；队列截断时也会置上。更新时只随 `detail` 一起生效。 */
    detailTruncated?: boolean;
};

/** 已发出的通知能改的字段；`duration` 给了就按新时长重新计时；`detail` 给空串清除详情。 */
export type NotificationPatch = Partial<NotificationInput>;

export type NotificationItem = Required<Pick<NotificationInput, "tone" | "duration">> & NotificationInput & {
    id: string;
};

/** 详情原文的长度上限（UTF-16 码元）：诊断单条消息默认 4000 字（docs/specs/runtime/diagnostics.md），加堆栈留一倍余量。 */
export const NOTIFICATION_DETAIL_MAX_CHARS = 8000;

/**
 * “这条通知有没有详情”的唯一判据：去掉首尾空白后非空。工作台服务算常驻、队列存条目、视口出“详情”入口都用它，
 * 三处不各写一份，免得空白原文在一处算有、另一处算没有。
 */
export function hasNotificationDetail(detail: string | undefined): boolean {
    return detail !== undefined && detail.trim() !== "";
}

/** 按上限截断；不在代理对中间切开（切开会留下一个孤立的高位代理）。 */
function boundDetail(detail: string): {detail: string; truncated: boolean} {
    if (detail.length <= NOTIFICATION_DETAIL_MAX_CHARS) return {detail, truncated: false};
    let end = NOTIFICATION_DETAIL_MAX_CHARS;
    const last = detail.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end -= 1;
    return {detail: detail.slice(0, end), truncated: true};
}

/**
 * 条目里的详情字段：没有详情时两个字段都不出现；有时按上限截断，截断标志与发出方给的取或。另存一份通知的地方（工作台的通知
 * 中心）也用它，同一条通知在两处的原文与“已截断”一致。
 */
export function notificationDetailFields(detail: string | undefined, truncated: boolean | undefined): Pick<NotificationItem, "detail" | "detailTruncated"> {
    if (detail === undefined || !hasNotificationDetail(detail)) return {};
    const bounded = boundDetail(detail);
    return {detail: bounded.detail, detailTruncated: bounded.truncated || truncated === true};
}

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
            ...notificationDetailFields(normalized.detail, normalized.detailTruncated),
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
        const {detail, detailTruncated, ...rest} = patch;
        const next: NotificationItem = {...current, ...rest, tone: patch.tone ?? current.tone, duration: patch.duration ?? current.duration};
        // 给了 detail 就整体换掉（空串清除）；detailTruncated 只随 detail 一起生效，单给它不改条目（队列截过的标志不能被改回 false）。
        if (detail !== undefined) {
            delete next.detail;
            delete next.detailTruncated;
            Object.assign(next, notificationDetailFields(detail, detailTruncated));
        }
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
