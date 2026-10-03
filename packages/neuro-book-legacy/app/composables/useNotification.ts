export type NotificationTone = "success" | "warning" | "info" | "error";
export type NotificationPosition =
    | "top-left"
    | "top-center"
    | "top-right"
    | "bottom-left"
    | "bottom-center"
    | "bottom-right";

export type NotificationInput = {
    title?: string;
    message?: string;
    html?: string;
    tone?: NotificationTone;
    autoClose?: boolean;
    duration?: number;
    position?: NotificationPosition;
    offsetX?: number;
    offsetY?: number;
};

export type NotificationItem = Required<
    Pick<NotificationInput, "tone" | "autoClose" | "duration" | "position" | "offsetX" | "offsetY">
> & NotificationInput & {
    id: string;
    createdAt: number;
};

const DEFAULT_POSITION: NotificationPosition = "top-right";
const DEFAULT_OFFSET_X = 16;
const DEFAULT_OFFSET_Y = 16;
const DEFAULT_DURATION_BY_TONE: Record<NotificationTone, number> = {
    success: 3200,
    warning: 4200,
    info: 3600,
    error: 5600,
};

const notificationTimerMap = new Map<string, number | ReturnType<typeof globalThis.setTimeout>>();

function createNotificationId(): string {
    return `notification-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clearNotificationTimer(id: string): void {
    const timer = notificationTimerMap.get(id);
    if (!timer) {
        return;
    }

    globalThis.clearTimeout(timer as ReturnType<typeof globalThis.setTimeout>);
    notificationTimerMap.delete(id);
}

export function useNotification() {
    const notifications = useState<NotificationItem[]>("notifications", () => []);

    const remove = (id: string): void => {
        clearNotificationTimer(id);
        notifications.value = notifications.value.filter((item) => item.id !== id);
    };

    const notify = (input: NotificationInput | string): string => {
        const normalizedInput = typeof input === "string"
            ? {message: input}
            : input;
        const tone = normalizedInput.tone ?? "info";
        const id = createNotificationId();
        const item: NotificationItem = {
            id,
            title: normalizedInput.title,
            message: normalizedInput.message,
            html: normalizedInput.html,
            tone,
            autoClose: normalizedInput.autoClose ?? true,
            duration: normalizedInput.duration ?? DEFAULT_DURATION_BY_TONE[tone],
            position: normalizedInput.position ?? DEFAULT_POSITION,
            offsetX: normalizedInput.offsetX ?? DEFAULT_OFFSET_X,
            offsetY: normalizedInput.offsetY ?? DEFAULT_OFFSET_Y,
            createdAt: Date.now(),
        };

        notifications.value = [...notifications.value, item];

        if (import.meta.client && item.autoClose && item.duration > 0) {
            clearNotificationTimer(item.id);
            notificationTimerMap.set(item.id, window.setTimeout(() => {
                remove(item.id);
            }, item.duration));
        }

        return item.id;
    };

    const clear = (): void => {
        notifications.value.forEach((item) => clearNotificationTimer(item.id));
        notifications.value = [];
    };

    const success = (message: string, options: Omit<NotificationInput, "message" | "tone"> = {}): string => notify({
        ...options,
        message,
        tone: "success",
    });

    const warning = (message: string, options: Omit<NotificationInput, "message" | "tone"> = {}): string => notify({
        ...options,
        message,
        tone: "warning",
    });

    const info = (message: string, options: Omit<NotificationInput, "message" | "tone"> = {}): string => notify({
        ...options,
        message,
        tone: "info",
    });

    const error = (message: string, options: Omit<NotificationInput, "message" | "tone"> = {}): string => notify({
        ...options,
        message,
        tone: "error",
    });

    return {
        notifications,
        notify,
        remove,
        clear,
        success,
        warning,
        info,
        error,
    };
}
