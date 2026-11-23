/**
 * 一个窗口里视图要的分组行（docs/specs/workbench/background-tasks.md 输出 22–26）：只在视图可见时订阅 `rowsChanged`，按窗口记
 * 范围（当前项目或全部项目）与各组的收起；转发停止与打开，把结果写成提示。自己的任务的存在性、通知与“看过”在 store.ts。
 *
 * 世代：范围变了、视图隐藏又显示，都换一代订阅；旧一代迟到的读与推送不再采用（订阅建好时已换代的立即放掉），免得旧范围的行盖住
 * 新范围的。同一代里推送与读的先后由远程链路保证（先订阅再读，读到的不会比推送旧）。
 */

import {computed, shallowRef} from "@vue/reactivity";
import type {ComputedRef, ShallowRef} from "@vue/reactivity";

import type {RemoteClient} from "@notnotype/nb-runtime/remote";
import type {Text} from "@notnotype/nb-ui/text";

import type {CommandService} from "nbook/plugins/commands/shared/contracts";
import type {Notifications} from "nbook/plugins/workbench/shared/contracts";

import type {RowGroup, RowOpen, RowsPayload, tasksContract} from "../shared/contracts";
import {tasksText} from "../shared/text";

export interface RowsStore {
    /** 最近一份分组行；还没取到时为 null。 */
    readonly payload: ShallowRef<RowsPayload | null>;
    /** 范围：为真时取全部项目（命令 `nbook.tasks.toggle-all-projects` 切换）。 */
    readonly all: ShallowRef<boolean>;
    /** 收起的组（`groupKey`）。 */
    readonly collapsed: ShallowRef<ReadonlySet<string>>;
    /** 停止还没有结果的行的键。 */
    readonly stopping: ShallowRef<ReadonlySet<string>>;
    /** 窗口有没有绑定项目：没有时范围开关没有意义。 */
    readonly hasProject: ComputedRef<boolean>;
    /** 视图有效可见与否：可见时才订阅。 */
    setVisible(visible: boolean): void;
    setAll(all: boolean): void;
    toggleGroup(key: string): void;
    /** 停提供方的一行；结果写成提示（输出 24）。 */
    stop(key: string, title: Text): Promise<void>;
    /** 打开一行或一个会话块；命令须是 `plugin` 贡献的，失败写成提示（输出 25）。 */
    open(target: RowOpen, plugin: string, title: Text): Promise<void>;
    /** 入口停止时放掉订阅。 */
    start(signal: AbortSignal): void;
}

/** 一组的键：按窗口记收起与展开。 */
export function groupKey(group: RowGroup): string {
    if (group.kind === "session") return `session:${group.session}`;
    return group.kind === "project" ? `project:${group.project}` : "app";
}

export interface RowsStoreOptions {
    readonly remote: RemoteClient<typeof tasksContract>;
    /** 窗口绑定的项目 id；书架页之类没有项目的窗口为 null。 */
    readonly project: string | null;
    readonly commands: Pick<CommandService, "get" | "execute">;
    readonly notifications: Notifications;
    readonly report: (message: string) => void;
}

export function createRowsStore(options: RowsStoreOptions): RowsStore {
    const {remote, commands, notifications, report} = options;
    const payload = shallowRef<RowsPayload | null>(null);
    const all = shallowRef(false);
    const collapsed = shallowRef<ReadonlySet<string>>(new Set());
    const stopping = shallowRef<ReadonlySet<string>>(new Set());
    let visible = false;
    let stopped = false;
    let generation = 0;
    let release: (() => void) | null = null;

    const filter = () => ({project: options.project, all: all.value || options.project === null});

    const resubscribe = (): void => {
        generation += 1;
        release?.();
        release = null;
        if (!visible || stopped) return;
        const mine = generation;
        const take = (next: RowsPayload): void => {
            if (mine === generation) payload.value = next;
        };
        const read = async (): Promise<void> => {
            const result = await remote.rows(filter());
            if (result.ok) take(result.value);
            else report(`tasks: rows failed: ${result.code}`);
        };
        void (async () => {
            const subscription = await remote.events.rowsChanged.subscribe(filter(), take, {onResync: () => void read()});
            if (!subscription.ok) {
                report(`tasks: rows subscribe failed: ${subscription.code}`);
                return;
            }
            if (mine !== generation) {
                subscription.value.release();
                return;
            }
            release = () => subscription.value.release();
            await read();
        })();
    };

    const notifyStop = (title: Text, message: Text, tone: "warning" | "info"): void => {
        notifications.notify({tone, title, message});
    };

    return {
        payload,
        all,
        collapsed,
        stopping,
        hasProject: computed(() => options.project !== null),
        setVisible(next) {
            if (next === visible) return;
            visible = next;
            resubscribe();
        },
        setAll(next) {
            if (next === all.value) return;
            all.value = next;
            resubscribe();
        },
        toggleGroup(key) {
            const next = new Set(collapsed.value);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            collapsed.value = next;
        },
        async stop(key, title) {
            if (stopping.value.has(key)) return;
            stopping.value = new Set([...stopping.value, key]);
            try {
                const result = await remote.stop({key});
                if (result.ok) {
                    // 被拒的原因是提供方给的文字值，原样当提示的正文（它可能是别的插件目录里的文字引用）。
                    if (result.value.outcome === "rejected") notifyStop(title, result.value.reason ?? tasksText("stop.rejected"), "warning");
                    else if (result.value.outcome === "unknown") notifyStop(title, tasksText("stop.unknown"), "warning");
                } else if (result.code === "row-gone") notifyStop(title, tasksText("stop.gone"), "info");
                else {
                    report(`tasks: stop ${key} failed: ${result.code}`);
                    notifyStop(title, tasksText("stop.unknown"), "warning");
                }
            } finally {
                const next = new Set(stopping.value);
                next.delete(key);
                stopping.value = next;
            }
        },
        async open(target, plugin, title) {
            // 打开的命令只认提供方自己贡献的：看命令表里的贡献方，不看 id 的前缀（id 前缀不证明归属）。
            const meta = commands.get(target.command);
            if (!meta.ok || meta.value.source !== plugin) {
                report(`tasks: open refused: ${target.command} is not contributed by ${plugin}`);
                notifications.notify({tone: "warning", title, message: tasksText("open.unavailable")});
                return;
            }
            const result = await commands.execute(target.command, target.args ?? {}, {source: "user"});
            if (!result.ok) notifications.notify({tone: "warning", title, message: result.reason});
        },
        start(signal) {
            signal.addEventListener("abort", () => {
                stopped = true;
                generation += 1;
                release?.();
                release = null;
            }, {once: true});
        },
    };
}
