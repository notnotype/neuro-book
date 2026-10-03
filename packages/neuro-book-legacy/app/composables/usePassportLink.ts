import {getCurrentScope, onScopeDispose, readonly, ref, type Ref} from "vue";
import type {
    PassportLinkPollDto,
    PassportLinkSessionDto,
    PassportStatusDto,
} from "nbook/shared/dto/passport.dto";

export type PassportLinkPhase = "idle" | "waiting" | "retryable_error" | "expired" | "denied" | "failed";
export type PassportLinkFailure = Extract<PassportLinkPollDto, {state: "failed"}>;

export type PassportLinkTransport = {
    /** 向本地服务申请新的设备码会话。 */
    start(): Promise<PassportLinkSessionDto>;
    /** 对当前设备码会话执行一次上游兑换检查。 */
    poll(linkSessionId: string): Promise<PassportLinkPollDto>;
    /** 404 后读取本地凭据，消除“远端成功、本次响应丢失”的歧义。 */
    status(): Promise<PassportStatusDto>;
};

export type PassportLinkOptions = {
    transport?: PassportLinkTransport;
    /** 凭据已确认落库或 404 对账发现已落库时触发。 */
    onLinked(status: PassportStatusDto): void;
    /** 仅发起新关联失败时触发；轮询失败由 retryable_error 状态承载。 */
    onStartError(error: unknown): void;
};

export type PassportLinkController = {
    session: Readonly<Ref<PassportLinkSessionDto | null>>;
    phase: Readonly<Ref<PassportLinkPhase>>;
    failure: Readonly<Ref<PassportLinkFailure | null>>;
    busy: Readonly<Ref<boolean>>;
    checking: Readonly<Ref<boolean>>;
    start(): Promise<void>;
    retry(): Promise<void>;
    cancel(): void;
    dispose(): void;
};

/**
 * 创建设备码关联状态机。只有 pending 会安排下一次轮询；未知错误必须由用户手动重试。
 */
export function createPassportLink(options: PassportLinkOptions): PassportLinkController {
    const transport = options.transport ?? browserTransport();
    const session = ref<PassportLinkSessionDto | null>(null);
    const phase = ref<PassportLinkPhase>("idle");
    const failure = ref<PassportLinkFailure | null>(null);
    const busy = ref(false);
    const checking = ref(false);
    let timer: ReturnType<typeof setTimeout> | null = null;

    /** 清理旧会话后申请设备码，并按服务端 interval 安排首次检查。 */
    async function start(): Promise<void> {
        clearTimer();
        session.value = null;
        failure.value = null;
        phase.value = "idle";
        busy.value = true;
        try {
            const created = await transport.start();
            session.value = created;
            phase.value = "waiting";
            schedule(created.interval);
        } catch (error) {
            options.onStartError(error);
        } finally {
            busy.value = false;
        }
    }

    /** 用户主动重新检查保留中的设备码；不会建立静默无限重试。 */
    async function retry(): Promise<void> {
        if (!session.value || checking.value) return;
        phase.value = "waiting";
        await pollOnce();
    }

    /** 放弃当前会话；服务端 device code 由官网自然过期。 */
    function cancel(): void {
        clearTimer();
        session.value = null;
        failure.value = null;
        phase.value = "idle";
    }

    /** 释放组件持有的 timer，但不额外改变可见状态。 */
    function dispose(): void {
        clearTimer();
    }

    function schedule(intervalSeconds: number): void {
        clearTimer();
        timer = setTimeout(() => void pollOnce(), intervalSeconds * 1000);
    }

    async function pollOnce(): Promise<void> {
        const current = session.value;
        if (!current || checking.value || phase.value !== "waiting") return;
        checking.value = true;
        try {
            const result = await transport.poll(current.linkSessionId);
            if (result.state === "pending") {
                schedule(result.interval);
                return;
            }
            clearTimer();
            if (result.state === "linked") {
                session.value = null;
                phase.value = "idle";
                options.onLinked(result.status);
                return;
            }
            if (result.state === "failed") {
                failure.value = result;
                phase.value = "failed";
                return;
            }
            phase.value = result.state;
        } catch (error) {
            clearTimer();
            if (httpStatus(error) === 404) {
                await reconcileMissingSession();
                return;
            }
            phase.value = "retryable_error";
        } finally {
            checking.value = false;
        }
    }

    async function reconcileMissingSession(): Promise<void> {
        try {
            const currentStatus = await transport.status();
            if (currentStatus.linked) {
                session.value = null;
                phase.value = "idle";
                options.onLinked(currentStatus);
                return;
            }
            phase.value = "expired";
        } catch {
            phase.value = "retryable_error";
        }
    }

    function clearTimer(): void {
        if (timer === null) return;
        clearTimeout(timer);
        timer = null;
    }

    return {
        session: readonly(session),
        phase: readonly(phase),
        failure: readonly(failure),
        busy: readonly(busy),
        checking: readonly(checking),
        start,
        retry,
        cancel,
        dispose,
    };
}

/** 在 Vue scope 销毁时释放轮询 timer。 */
export function usePassportLink(options: PassportLinkOptions): PassportLinkController {
    const controller = createPassportLink(options);
    if (getCurrentScope()) onScopeDispose(controller.dispose);
    return controller;
}

function browserTransport(): PassportLinkTransport {
    return {
        start: async () => await $fetch<PassportLinkSessionDto>("/api/passport/link/start", {method: "POST"}),
        poll: async (linkSessionId) => await $fetch<PassportLinkPollDto>("/api/passport/link/poll", {
            method: "POST",
            body: {linkSessionId},
        }),
        status: async () => await $fetch<PassportStatusDto>("/api/passport/status"),
    };
}

/** 外部 FetchError 形状不稳定，只读取两个已知数字字段。 */
function httpStatus(error: unknown): number | null {
    if (typeof error !== "object" || error === null) return null;
    const failure = error as {status?: unknown; statusCode?: unknown};
    if (typeof failure.statusCode === "number") return failure.statusCode;
    return typeof failure.status === "number" ? failure.status : null;
}
