/**
 * 运行中的更新（docs/specs/runtime/desktop-update.md 输出 1 到 7、9、10，“状态与转换”）：检查、只升不降的判定、提示、下载，
 * 以及页面选择的判定。不依赖 Electrobun，更新器经 `UpdaterPort` 交进来；安装级的状态文件与启动时换上在 `update-install.ts`。
 *
 * 提示是状态不是事件：控制器至多持有一条当前提示（`{id, hint}`），每次阶段变化换一个新 id，交给窗口协调器去交付、转交
 * （`WindowCoordinator.setUpdateHint`）。当前提示是一次性的通知（`#notice`：已下载、已更新、更新没有完成）优先，没有时是
 * 带阶段的提示（`#prompt`：可以更新、只提示、正在下载、下载失败）。
 *
 * 寿命挂在壳的运行中区间：`start()` 在进入运行中时调；`stop()` 在进入停止中时同步调，之后不再检查、不再提示、不收选择；
 * `close()` 在壳放桌面锁之前调。例外是在途的下载：`stop()` 之后、`close()` 之前完成的照样写进状态文件（停服务端最长要 90 秒，
 * 这段时间里下完是常见的），`close()` 之后完成的丢掉；壳不为下载多等。`close()` 等在途的写入完成，放锁之后不再写（单写者，
 * 见 `update-install.ts` 的模块头）。
 *
 * 检查与下载串行（`#queue`）：用户选“下载”时先重新检查，远端仍是提示里的那一份才下（目标移动，输出 5）。
 */

import type {UpdateChoice, UpdateHint, UpdateHintKind} from "../shared/desktop-bridge";

import {at} from "./deadline";
import type {DeadlineClock} from "./deadline";
import {reconcile, usableDownload, withHash, withoutHash} from "./update-install";
import type {CheckResult, UpdaterPort, UpdateState, UpdateStatePort, UpdateTarget} from "./update-install";

/** 远端版本只认严格的稳定版本号：没有前导零、没有预发布段，构建元数据可有可无。`Bun.semver.order` 本身接受 `2`、`v2.0.0`、`02.0.0`，不能拿它当校验。 */
const STABLE_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export function isStableVersion(text: string): boolean {
    return STABLE_VERSION.test(text);
}

/** `version` 是否高于 `than`（构建元数据不参与比较）。 */
export function isNewer(version: string, than: string): boolean {
    return Bun.semver.order(version, than) === 1;
}

/** 检查的间隔（输出 1）。 */
export const CHECK_INTERVAL_MS = 24 * 60 * 60_000;
/** 有未对账的换上时，运行中多久按对账表重判一次。 */
export const RECHECK_ATTEMPT_MS = 30_000;

export type UpdateMode =
    /** 受管安装、没设 `NBOOK_STATE_ROOT`：下载、下次启动换上；状态文件已经对过账（`reconcileAtStartup`）。 */
    | {readonly kind: "auto"; readonly state: UpdateStatePort; readonly initial: UpdateState}
    /** 便携版或设了 `NBOOK_STATE_ROOT`（输出 10）：只和本地版本比，只提示。 */
    | {readonly kind: "notify-only"; readonly envRoot: boolean};

export interface CurrentHint {
    readonly id: number;
    readonly hint: UpdateHint;
}

export interface UpdateControllerOptions {
    readonly mode: UpdateMode;
    readonly updater: UpdaterPort;
    readonly clock: DeadlineClock;
    /**
     * 当前提示变了。`endPrevious` 为真时上一条被新阶段取代，协调器让持有它的窗口收起（中心里留着它的动作只会点到旧的）；
     * 为假时上一条已由用户结束（“以后”、一次性通知已显示），不用收。
     */
    readonly onHint: (current: CurrentHint | null, endPrevious: boolean) => void;
    /** 在系统浏览器打开最新 Release 的页面（只提示的“打开下载页”）。 */
    readonly openDownloadPage: () => void;
    /** 诊断出口：失败时第二个参数是 Error；记录事实的 `desktop.update.checked` 是 `key=value` 的文字（见 shell.ts 的 `ShellOptions.report`）。 */
    readonly report: (event: string, error: unknown) => void;
}

type ControllerPhase = "idle" | "running" | "stopped" | "closed";

interface Prompt {
    readonly id: number;
    readonly kind: Extract<UpdateHintKind, "available" | "notify-only" | "downloading" | "download-failed">;
    readonly target: UpdateTarget;
}

interface Notice {
    readonly id: number;
    readonly kind: Extract<UpdateHintKind, "downloaded" | "updated" | "update-failed">;
    readonly version: string;
    /** 来自状态文件的 `pendingNotice`：显示之后从文件里清掉。 */
    readonly persisted: boolean;
}

/** 每种提示收哪些选择（计划“页面选择的唯一判定”）；不在表里的种类不收选择。 */
const ACCEPTED: Partial<Record<UpdateHintKind, ReadonlyArray<UpdateChoice>>> = {
    available: ["download", "later"],
    "download-failed": ["retry", "later"],
    "notify-only": ["open-page", "later"],
};

export class UpdateController {
    readonly #options: UpdateControllerOptions;
    #phase: ControllerPhase = "idle";
    /** `auto` 模式下状态文件的内容：单写者，内存里这份就是真相，改了就写回。 */
    #state: UpdateState | null;
    #nextId = 0;
    #prompt: Prompt | null = null;
    #notice: Notice | null = null;
    /** 最近一条带阶段的提示：只收它的选择，不论它是当前的还是已被“以后”关掉的。 */
    #latest: Prompt | null = null;
    /** 上一次交给协调器的提示，用来只在真正变化时通知。 */
    #delivered: CurrentHint | null = null;
    /** 这次运行里用户选过“以后”的版本。 */
    readonly #later = new Set<string>();
    #queue: Promise<void> = Promise.resolve();
    /** 已排队或进行中的下载：重复的“下载”“重试”不再下一次。 */
    #downloadPending = false;
    #cancelTimer: (() => void) | null = null;
    #writes: Promise<void> = Promise.resolve();

    constructor(options: UpdateControllerOptions) {
        this.#options = options;
        this.#state = options.mode.kind === "auto" ? options.mode.initial : null;
    }

    /** 壳进入运行中：显示待显示的通知；有未对账的换上时先等它出终态，否则检查一次并每 24 小时再查。 */
    start(): void {
        if (this.#phase !== "idle") return;
        this.#phase = "running";
        const pending = this.#state?.pendingNotice ?? null;
        if (pending !== null) this.#notice = {id: this.#newId(), kind: pending.kind, version: pending.version, persisted: true};
        this.#emit(false);
        if (this.#state?.attempt != null) this.#scheduleRecheck();
        else this.#checkAndSchedule();
    }

    /** 壳进入停止中（同步调用）。 */
    stop(): void {
        if (this.#phase === "idle" || this.#phase === "running") this.#phase = "stopped";
        this.#cancelTimer?.();
        this.#cancelTimer = null;
    }

    /** 壳放桌面锁之前：之后完成的下载丢掉；等在途的写入完成。 */
    async close(): Promise<void> {
        this.stop();
        this.#phase = "closed";
        await this.#writes;
    }

    /** 页面交回的选择。只收最近那条带阶段的提示的、这一种提示允许的选择；别的写诊断后忽略。 */
    choose(id: number, choice: UpdateChoice): void {
        const latest = this.#latest;
        if (this.#phase !== "running") return;
        if (latest === null || latest.id !== id || !(ACCEPTED[latest.kind] ?? []).includes(choice)) {
            this.#options.report("desktop.update.choice-ignored", new Error(`choice ${choice} for hint ${String(id)} is not accepted (latest ${latest === null ? "none" : `${String(latest.id)} ${latest.kind}`})`));
            return;
        }
        switch (choice) {
            case "later":
                this.#dismiss(latest);
                return;
            case "open-page":
                this.#options.openDownloadPage();
                this.#dismiss(latest);
                return;
            case "download":
            case "retry":
                if (this.#downloadPending) return;
                this.#downloadPending = true;
                this.#enqueue(() => this.#download(latest.target));
                return;
        }
    }

    /** 页面显示了这条提示：一次性的通知从此清掉，不再转交；来自状态文件的从文件里清掉。 */
    shown(id: number): void {
        const notice = this.#notice;
        if (notice === null || notice.id !== id || this.#phase === "closed") return;
        this.#notice = null;
        if (notice.persisted && this.#state !== null) this.#persist({...this.#state, pendingNotice: null});
        if (this.#phase === "running") this.#emit(false);
    }

    get current(): CurrentHint | null {
        return this.#delivered;
    }

    /** “以后”与“打开下载页”：这次运行不再提示这个版本；中心里留下的动作照样能点（场景 7），所以 `#latest` 不变。 */
    #dismiss(prompt: Prompt): void {
        this.#later.add(prompt.target.version);
        if (this.#prompt?.id === prompt.id) this.#prompt = null;
        this.#emit(false);
    }

    #checkAndSchedule(): void {
        this.#enqueue(() => this.#check());
        this.#cancelTimer = at(this.#options.clock, this.#options.clock.now() + CHECK_INTERVAL_MS, () => this.#checkAndSchedule());
    }

    /** 有未对账的换上：换上程序可能还在动安装目录与准备位置，不检查、不下载；出了终态就在这次运行里通知并恢复检查。 */
    #scheduleRecheck(): void {
        this.#cancelTimer = at(this.#options.clock, this.#options.clock.now() + RECHECK_ATTEMPT_MS, () => {
            this.#cancelTimer = null;
            this.#enqueue(async () => {
                const state = this.#state;
                if (state === null || this.#phase !== "running") return;
                const next = await reconcile(state, this.#options.updater, this.#options.clock.now());
                if (this.#currentPhase() !== "running") return;
                if (next !== state) this.#persist(next);
                if (next.attempt !== null) {
                    this.#scheduleRecheck();
                    return;
                }
                if (next.pendingNotice !== null) {
                    this.#notice = {id: this.#newId(), kind: next.pendingNotice.kind, version: next.pendingNotice.version, persisted: true};
                    this.#emit(true);
                }
                this.#checkAndSchedule();
            });
        });
    }

    async #check(): Promise<void> {
        if (this.#phase !== "running") return;
        const remote = await this.#options.updater.check();
        if (this.#currentPhase() !== "running") return;
        if (remote.ok && isStableVersion(remote.version)) {
            // 记下每次检查的结论（与本地版本比），发布流水线的更新冒烟靠它判断“检查过、没有提示”不是因为没检查。
            const order = Bun.semver.order(remote.version, this.#options.updater.local.version);
            this.#options.report("desktop.update.checked", `remote=${remote.version} local=${this.#options.updater.local.version} result=${order === 1 ? "newer" : order === 0 ? "same" : "older"}`);
        }
        this.#evaluate(remote);
        this.#emit(true);
    }

    /**
     * 只升不降（输出 2、6、10）：远端须是稳定版本号，且高于基线。基线是本地版本；`auto` 模式下还有可换上的已下载的那份，
     * 取两者较高的。这次运行里选过“以后”的版本不再提示；已经在提示同一份时保持原样（不换 id）。只改 `#prompt`，由调用方 `#emit`。
     */
    #evaluate(remote: CheckResult): void {
        if (!remote.ok) {
            this.#options.report("desktop.update.check-failed", new Error(remote.error));
            return;
        }
        if (!isStableVersion(remote.version)) {
            this.#options.report("desktop.update.check-failed", new Error(`remote version is not a stable version: ${JSON.stringify(remote.version)}`));
            return;
        }
        const local = this.#options.updater.local;
        const downloaded = this.#state === null ? null : usableDownload(this.#state, local, isNewer);
        const baseline = downloaded !== null && isNewer(downloaded.version, local.version) ? downloaded.version : local.version;
        if (!isNewer(remote.version, baseline) || this.#later.has(remote.version)) return;
        const prompt = this.#prompt;
        if (prompt !== null && prompt.target.version === remote.version && prompt.target.hash === remote.hash) return;
        this.#setPrompt(this.#options.mode.kind === "auto" ? "available" : "notify-only", {version: remote.version, hash: remote.hash});
    }

    /** 下载要绑定目标（输出 4 到 7）：先重新检查，远端仍是这一份才下；变了按新结果提示，降级了不下。 */
    async #download(target: UpdateTarget): Promise<void> {
        try {
            if (this.#phase !== "running" || this.#state === null) return;
            const remote = await this.#options.updater.check();
            if (this.#currentPhase() !== "running") return;
            if (!remote.ok || remote.version !== target.version || remote.hash !== target.hash) {
                if (remote.ok) {
                    // 目标移动：丢掉旧的提示，按新结果判定（更高的版本重新提示，降级了什么都不提示）。
                    this.#prompt = null;
                    this.#evaluate(remote);
                } else {
                    this.#options.report("desktop.update.check-failed", new Error(remote.error));
                    this.#setPrompt("download-failed", target);
                }
                this.#emit(true);
                return;
            }
            // 开始下载前把已下载的那份记为被取代：更新器在准备开始之前就失败时旧文件还在，但不再换上（输出 7）。这一笔要写成功才
            // 下载：写不成而下载失败时，下一次启动会换上用户已经放弃的那份。
            const previous = this.#state.downloaded;
            if (previous !== null && previous.hash !== target.hash && !(await this.#persistNow({...this.#state, superseded: withHash(this.#state.superseded, previous.hash)}))) {
                if (this.#currentPhase() !== "running") return;
                this.#setPrompt("download-failed", target);
                this.#emit(true);
                return;
            }
            if (this.#currentPhase() !== "running") return;
            this.#setPrompt("downloading", target);
            this.#emit(true);
            const result = await this.#options.updater.download(target);
            if (this.#currentPhase() === "closed") return;
            if (result.ok) {
                // 用户明确选了下载、也下成了，就是重新授权换上它：从失败、被取代名单里移除（开始时不移除，否则下载失败会让旧的复活）。
                const state = this.#state;
                this.#persist({...state, downloaded: target, failed: withoutHash(state.failed, target.hash), superseded: withoutHash(state.superseded, target.hash)});
                if (this.#currentPhase() !== "running") return;
                this.#prompt = null;
                this.#notice = {id: this.#newId(), kind: "downloaded", version: target.version, persisted: false};
                this.#emit(true);
                return;
            }
            this.#options.report("desktop.update.download-failed", new Error(result.error));
            if (this.#currentPhase() !== "running") return;
            // 失败后重新检查一次（输出 5）：远端已是更高的版本时提示它，否则给“重试”。
            const again = await this.#options.updater.check();
            if (this.#currentPhase() !== "running") return;
            if (again.ok && isStableVersion(again.version) && isNewer(again.version, target.version) && !this.#later.has(again.version)) this.#setPrompt("available", {version: again.version, hash: again.hash});
            else this.#setPrompt("download-failed", target);
            this.#emit(true);
        } finally {
            this.#downloadPending = false;
        }
    }

    #setPrompt(kind: Prompt["kind"], target: UpdateTarget): void {
        const prompt: Prompt = {id: this.#newId(), kind, target};
        this.#prompt = prompt;
        this.#latest = prompt;
    }

    /** await 之后经它读阶段：TypeScript 按 await 之前的检查收窄了字段的类型，不知道它在等待期间会变。 */
    #currentPhase(): ControllerPhase {
        return this.#phase;
    }

    #newId(): number {
        this.#nextId += 1;
        return this.#nextId;
    }

    /** 把当前提示（通知优先）交给协调器；与上一次交出的相同时什么都不做。停止之后不再交。 */
    #emit(endPrevious: boolean): void {
        if (this.#phase !== "running") return;
        const notice = this.#notice;
        const prompt = this.#prompt;
        const current: CurrentHint | null =
            notice !== null
                ? {id: notice.id, hint: {kind: notice.kind, version: notice.version}}
                : prompt !== null
                  ? {id: prompt.id, hint: {kind: prompt.kind, version: prompt.target.version, ...(prompt.kind === "notify-only" && this.#options.mode.kind === "notify-only" && this.#options.mode.envRoot ? {envRoot: true} : {})}}
                  : null;
        if (current?.id === this.#delivered?.id) return;
        this.#delivered = current;
        this.#options.onHint(current, endPrevious);
    }

    /** 改内存里的状态并按顺序写回；写不了只写日志（下一次启动以文件为准，最坏是多提示一次或少换一次）。 */
    #persist(next: UpdateState): void {
        const port = this.#options.mode.kind === "auto" ? this.#options.mode.state : null;
        if (port === null) return;
        this.#state = next;
        this.#writes = this.#writes.then(() => port.write(next)).catch((error: unknown) => this.#options.report("desktop.update.state-write-failed", error));
    }

    /** 同 `#persist`，并等这一笔（连同排在前面的）写完；交回是否写成功。写不成时内存里退回原来的状态，与文件一致。 */
    async #persistNow(next: UpdateState): Promise<boolean> {
        const port = this.#options.mode.kind === "auto" ? this.#options.mode.state : null;
        const before = this.#state;
        if (port === null) return false;
        this.#state = next;
        const written = this.#writes.then(() => port.write(next)).then(
            () => true,
            (error: unknown) => {
                this.#options.report("desktop.update.state-write-failed", error);
                if (this.#state === next) this.#state = before;
                return false;
            },
        );
        this.#writes = written.then(() => undefined);
        return written;
    }

    #enqueue(task: () => Promise<void>): void {
        this.#queue = this.#queue.then(task).catch((error: unknown) => this.#options.report("desktop.update.task-failed", error));
    }
}
