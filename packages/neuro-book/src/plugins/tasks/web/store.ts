/**
 * 一个窗口里的后台任务清单（docs/specs/workbench/background-tasks.md 输出 9 到 14）：订阅推送、按窗口记“看过”，任务结束时
 * 经通知服务发一条通知，任务离开清单时撤回它。不碰 DOM：视图组件上报自己可见与否。
 *
 * 比较的基线：结束通知只由“窗口连着时看到的变化”触发（输出 14）。基线为空时收到的第一份清单（推送或 `list` 谁先到都算）
 * 只建立基线、把里面结束的记为看过；重连（`onResync`）先清空基线，重取到的清单同样只建基线。之后每份清单与上一份比：
 * 上一份在跑、或上一份里没有，而这一份成功或失败的，发一条。
 */

import {computed, shallowRef} from "@vue/reactivity";
import type {ComputedRef, ShallowRef} from "@vue/reactivity";

import type {RemoteClient} from "@notnotype/nb-runtime/remote";
import type {Text} from "@notnotype/nb-ui/text";

import type {NotificationHandle, Notifications} from "nbook/plugins/workbench/shared/contracts";

import type {TaskDetail, TaskItem, tasksContract, TaskState} from "../shared/contracts";
import {tasksText} from "../shared/text";

export interface TasksStore {
    readonly items: ShallowRef<readonly TaskItem[]>;
    /** 在跑的，开始得晚的在前。 */
    readonly running: ComputedRef<readonly TaskItem[]>;
    /** 结束的，结束得晚的在前。 */
    readonly finished: ComputedRef<readonly TaskItem[]>;
    /** 本窗口有没看过的失败（输出 12、13）。 */
    readonly unseenFailure: ComputedRef<boolean>;
    /** 视图上报：“后台任务”视图有效可见、页面在前台时为真；为真时此刻结束的都算看过（输出 13）。 */
    setViewVisible(visible: boolean): void;
    cancel(id: string): Promise<void>;
    retry(id: string): Promise<void>;
    remove(id: string): Promise<void>;
    clearFinished(): Promise<void>;
    /** 取详情原文；取不到（任务已移出）时交回 null。 */
    detail(id: string): Promise<TaskDetail | null>;
    /** 先订阅再取；`signal` abort 时退订。 */
    start(signal: AbortSignal): Promise<void>;
}

const later = (time: string | null): number => (time === null ? 0 : Date.parse(time));

/**
 * 状态栏条目的一句说明：条目的 `tooltip()`（悬停内容加载失败时的退回、读屏的描述）与没有在跑的任务时的悬停内容都用它。
 * 有在跑的写件数，都结束了写有没有没看过的失败（输出 12）。
 */
export function statusSummary(store: Pick<TasksStore, "running" | "unseenFailure">): Text {
    const count = store.running.value.length;
    if (count > 0) return tasksText("status.count", {count});
    return tasksText(store.unseenFailure.value ? "status.failed" : "status.idle");
}

export function createTasksStore(remote: RemoteClient<typeof tasksContract>, notifications: Notifications, report: (message: string) => void): TasksStore {
    const items = shallowRef<readonly TaskItem[]>([]);
    const seen = shallowRef<ReadonlySet<string>>(new Set());
    const announced = new Map<string, NotificationHandle>();
    let baseline: ReadonlyMap<string, TaskState> | null = null;
    let viewVisible = false;

    const markSeen = (next: readonly TaskItem[]): void => {
        const finished = next.filter((item) => item.state !== "running" && !seen.value.has(item.id));
        if (finished.length > 0) seen.value = new Set([...seen.value, ...finished.map((item) => item.id)]);
    };

    const failed = (what: string) => (result: {readonly ok: boolean; readonly code?: string}): void => {
        if (!result.ok) report(`tasks: ${what} failed: ${result.code ?? "unknown"}`);
    };

    const retry = async (id: string): Promise<void> => failed(`retry ${id}`)(await remote.retry({id}));

    /** 输出 14：成功按时消失；失败常驻，带“重试”（可重试时）与“详情”（发出时就带着原文）。 */
    const announce = async (item: TaskItem): Promise<void> => {
        if (item.state === "succeeded") {
            announced.set(item.id, notifications.notify({tone: "success", title: item.title, message: item.message ?? tasksText("outcome.succeeded")}));
            return;
        }
        let detail: TaskDetail | null = null;
        if (item.hasDetail) {
            detail = await store.detail(item.id);
            // 取原文的这一会儿任务可能已离开清单：那就不发了，免得留下点不动的“重试”。没有原文时不等待，这时 `accept`
            // 还没把清单换成新的，不能拿它判断（两次推送之间开始又失败的任务在旧清单里没有）。
            if (!items.value.some((entry) => entry.id === item.id)) return;
        }
        announced.set(item.id, notifications.notify({
            tone: "error",
            title: item.title,
            message: item.message ?? "",
            ...(item.retryable ? {action: {label: tasksText("list.retry"), run: () => void retry(item.id)}} : {}),
            ...(detail === null ? {} : {detail: detail.text, detailTruncated: detail.truncated}),
        }));
    };

    const accept = (next: readonly TaskItem[]): void => {
        if (baseline === null) {
            markSeen(next);
        } else {
            for (const item of next) {
                const before = baseline.get(item.id);
                if ((before === undefined || before === "running") && (item.state === "succeeded" || item.state === "failed")) void announce(item);
            }
        }
        // 撤回已离开清单的任务的通知（输出 14）；看过的记录也只留清单里还有的。
        const present = new Set(next.map((item) => item.id));
        for (const [id, handle] of announced) {
            if (present.has(id)) continue;
            handle.dismiss();
            announced.delete(id);
        }
        if ([...seen.value].some((id) => !present.has(id))) seen.value = new Set([...seen.value].filter((id) => present.has(id)));
        baseline = new Map(next.map((item) => [item.id, item.state]));
        items.value = next;
        if (viewVisible) markSeen(next);
    };

    const refresh = async (): Promise<void> => {
        const result = await remote.own({});
        if (result.ok) accept(result.value.tasks);
        else report(`tasks: list failed: ${result.code}`);
    };

    const store: TasksStore = {
        items,
        running: computed(() => items.value.filter((item) => item.state === "running").sort((a, b) => later(b.startedAt) - later(a.startedAt))),
        finished: computed(() => items.value.filter((item) => item.state !== "running").sort((a, b) => later(b.endedAt) - later(a.endedAt))),
        unseenFailure: computed(() => items.value.some((item) => item.state === "failed" && !seen.value.has(item.id))),
        setViewVisible(visible) {
            viewVisible = visible;
            if (visible) markSeen(items.value);
        },
        cancel: async (id) => failed(`cancel ${id}`)(await remote.cancel({id})),
        retry,
        remove: async (id) => failed(`remove ${id}`)(await remote.remove({id})),
        clearFinished: async () => failed("clearFinished")(await remote.clearFinished({})),
        async detail(id) {
            const result = await remote.detail({id});
            if (result.ok) return result.value;
            report(`tasks: detail ${id} failed: ${result.code}`);
            return null;
        },
        async start(signal) {
            const subscription = await remote.events.ownChanged.subscribe({}, (payload) => accept(payload.tasks), {onResync: () => {
                baseline = null;
                void refresh();
            }});
            if (!subscription.ok) {
                report(`tasks: subscribe failed: ${subscription.code}`);
                return;
            }
            // 订阅还没建好时入口就停了：abort 已经派发过，后面挂的监听不会再触发。
            if (signal.aborted) {
                subscription.value.release();
                return;
            }
            signal.addEventListener("abort", () => subscription.value.release(), {once: true});
            await refresh();
        },
    };
    return store;
}
