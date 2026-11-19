import {randomBytes} from "node:crypto";
import {watch, type FSWatcher} from "node:fs";
import {resolve} from "node:path";
import type {HerdrClient, HerdrPane} from "../herdr/client.js";
import {readActivity, readPaneProcesses, type Activity, type HerdrSnapshot} from "../core/activity.js";
import {checkoutKeys} from "../core/checkouts.js";
import {systemErrorCode, type Warning} from "../core/errors.js";
import {gitOutput, runGit} from "../core/git.js";
import {LEASES_DIR} from "../core/leases.js";
import {listProcRuns, type RunView as ProcRunView} from "../core/procs.js";
import {AGENT_LOCAL_ROOT} from "../core/registry.js";
import {MASTER_REF, WORKS_ROOT, type CheckoutInfo, type RepoContext} from "../core/repo.js";
import {PANEL_SOURCE_PACKAGES} from "./build.js";
import {createBranchChangesCache} from "../core/sources.js";
import {readProjectRecords, readTransitionState, type ProjectRecords, type TransitionState} from "../core/status.js";
import {HerdrMonitor} from "./herdr-monitor.js";
import type {SessionTitle, SessionTitles} from "./session-titles.js";

/**
 * 面板的内存缓存：页面请求只读这里，从不现算整份 `status`。分三块各自刷新，变了就经 `/ws` 推“哪块变了”：
 * - **记录**（Work、Task、收件箱、撞号）：`fs.watch` 递归监视主工作区的 `.agents/works/`（去抖 300 毫秒，过滤 `evidences/`）；
 *   每 5 秒看一次 checkout 列表与各 HEAD，变了才重算（过渡期判定按 HEAD 缓存）；有浏览器连着时每 30 秒兜底整份重算，
 *   顺带重算各 worktree 未提交的记录改动（它们不改 HEAD，也不在监视范围里）。
 * - **活动**（租约、会话、运行）：租约是否有效是读取时现算的（会话退出、过期、Task 关闭都不碰租约文件），
 *   所以有浏览器连着时每 5 秒整份重算；记录或会话变化时也重算。监视租约目录只当加速。
 *   会话标题（t17）进活动的快照与指纹，GET 时不查盘；但读标题不在这一轮里等：活动算完就用已知的标题发布，
 *   读标题是另一个单飞的后台任务（每轮有预算），读完标题有变化时只改快照里的标题、增加 revision、推送，见 `readTitles`。
 * - **会话**：`HerdrMonitor`。
 * - **通知**：`Notifier` 现算的通知任务（t11），变了就经 `notifyChanged()` 推送。
 * 每块的重算单飞并合并；失败时保留上一份，在 `meta` 里标错。只有显示用到的字段变了才增加 revision。
 */

export type Part<T> = {value: T | null; revision: number; at: string | null; error: string | null};
export type PartName = "records" | "activity" | "sessions" | "notify" | "github";
export type RecordsValue = {records: ProjectRecords; transition: TransitionState; warnings: Warning[]};
/**
 * `procs`：经 nbdev 起的运行（还活着的，加 24 小时内结束的），“在跑”页的第一块（t14）。
 * `sessionTitles`：页面上会显示的会话的已知标题，键是完整会话键，读不到或还没读到标题的键不在里面（t17）。
 */
export type ActivityValue = {activity: Activity; procs: ProcRunView[]; sessionTitles: Record<string, SessionTitle>; warnings: Warning[]};

const DEBOUNCE_MS = 300;
/** 一轮读标题最多等这么久；没查完的键留到下一轮（活动每次重算后都会再起一轮），活动的发布从不等它。 */
const TITLE_BUDGET_MS = 2_000;
/** 停止时最多等读标题的文件操作结束这么久：慢盘上的读盘取消不了，超时就记一条诊断后返回（之后它们结束也不再改数据）。 */
const TITLE_STOP_MS = 3_000;
const CHECK_MS = 5_000;
const FALLBACK_MS = 30_000;

/** 面板代码所在的树（与 `.build-hash` 的输入一致）：master 上只改记录时它不变，所以“代码已更新”不会每次答复都冒出来。 */
export const CODE_PATHS = ["packages/dev-panel", ...PANEL_SOURCE_PACKAGES.map((name) => `packages/${name}`), "bun.lock"];

export async function readCodeKey(mainRoot: string): Promise<string> {
    const results = await Promise.all(CODE_PATHS.map((path) => runGit(mainRoot, ["rev-parse", `HEAD:${path}`], {readOnly: true})));
    return results.map((result) => (result.exitCode === 0 ? result.stdout.trim() : "-")).join(",");
}

class Refresher<T> {
    part: Part<T> = {value: null, revision: 0, at: null, error: null};
    private fingerprint = "";
    private running: Promise<void> | null = null;
    /** 正在算时又被要求重算：合并成一次排在后面的重算。 */
    private queued: {promise: Promise<void>; resolve: () => void} | null = null;

    /** `settle`：算完之后、定下这一份之前同步调一次（与 `patch` 之间不会插进别的代码），活动用它填最新的已知标题。 */
    constructor(private readonly name: PartName, private readonly compute: () => Promise<T>, private readonly fingerprintOf: (value: T) => string, private readonly onChanged: (name: PartName) => void, private readonly log: (message: string) => void, private readonly settle: (value: T) => T = (value) => value) {}

    /**
     * 重算一次，返回的承诺在一次“调用之后才开始”的重算完成时兑现：正在算的那次可能读的是写入之前的文件，
     * 写接口要等到包含自己这次写入的结果再回应（前端紧接着跳到新 Work 不会 404）。
     */
    run(): Promise<void> {
        if (this.running) {
            if (!this.queued) {
                let resolve!: () => void;
                const promise = new Promise<void>((done) => {
                    resolve = done;
                });
                this.queued = {promise, resolve};
            }
            return this.queued.promise;
        }
        this.running = this.once().finally(() => {
            this.running = null;
            const queued = this.queued;
            if (queued) {
                this.queued = null;
                void this.run().finally(() => queued.resolve());
            }
        });
        return this.running;
    }

    private async once(): Promise<void> {
        try {
            const value = this.settle(await this.compute());
            const print = this.fingerprintOf(value);
            const changed = print !== this.fingerprint;
            const recovered = this.part.error !== null;
            this.part = {value, revision: changed ? this.part.revision + 1 : this.part.revision, at: new Date().toISOString(), error: null};
            this.fingerprint = print;
            // 从失败恢复也推一次：顶栏的“后台重算失败”提示靠重取 /api/meta 才会消失（t15）。
            if (changed || recovered) this.onChanged(this.name);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log(`重算 ${this.name} 失败，保留上一份：${message}`);
            if (!(error instanceof Error)) throw error;
            this.part = {...this.part, error: message};
            this.onChanged(this.name);
        }
    }

    /** 不重算，只改当前这一份（t17 的标题由后台任务补上）：指纹变了才增加 revision 并推送；还没有值时不动。 */
    patch(update: (value: T) => T): void {
        if (this.part.value === null) return;
        const value = update(this.part.value);
        const print = this.fingerprintOf(value);
        if (print === this.fingerprint) return;
        this.part = {...this.part, value, revision: this.part.revision + 1};
        this.fingerprint = print;
        this.onChanged(this.name);
    }
}

/** 活动里显示用到的字段：运行的子进程数随时在变，不进指纹。 */
function activityFingerprint(value: ActivityValue): string {
    const {activity} = value;
    return JSON.stringify({
        leases: activity.leases.filter((lease) => lease.state === "valid").map((lease) => [lease.leaseId, lease.taskId, lease.stale, lease.lastActivityAt]),
        sessions: activity.sessions.map((session) => [session.key, session.alive, session.herdr?.status ?? null, session.leases.length, session.runs.map((run) => [run.pid, run.command, run.checkout])]),
        unowned: activity.unownedRuns.map((run) => [run.pid, run.command, run.checkout]),
        procs: value.procs.map((run) => [run.runId, run.state, run.reason, run.url, run.readyAt]),
        // 标题从无到有、从有到无、改名都算变化：已打开的页面靠活动的推送才会重新取数。
        titles: Object.entries(value.sessionTitles).sort(([left], [right]) => left.localeCompare(right)).map(([key, title]) => [key, title.text, title.source]),
    });
}

export class PanelState {
    readonly instanceId = randomBytes(8).toString("hex");
    readonly startedAt = new Date().toISOString();
    readonly herdr: HerdrMonitor;
    readonly records: Refresher<RecordsValue>;
    readonly activity: Refresher<ActivityValue>;
    checkouts: CheckoutInfo[] = [];
    keys = new Map<string, string>();
    codeKey = "";
    codeChanged = false;
    build: {failed: boolean; message: string | null} = {failed: false, message: null};
    private readonly cache = createBranchChangesCache();
    private checkoutPrint = "";
    private clients = 0;
    private watchers: FSWatcher[] = [];
    private timers: Array<ReturnType<typeof setInterval>> = [];
    private debounce: ReturnType<typeof setTimeout> | null = null;
    private listeners = new Set<(part: PartName) => void>();

    constructor(readonly context: RepoContext, herdrClient: HerdrClient | null, readonly log: (message: string) => void, private readonly titles: SessionTitles) {
        const changed = (part: PartName) => {
            for (const listener of this.listeners) listener(part);
            if (part === "records" || part === "sessions") void this.activity.run();
        };
        this.herdr = new HerdrMonitor(herdrClient, () => {
            this.sessionsRevision += 1;
            changed("sessions");
        }, log);
        this.records = new Refresher("records", () => this.computeRecords(), (value) => JSON.stringify(value.records), changed, log);
        this.activity = new Refresher("activity", () => this.computeActivity(herdrClient), activityFingerprint, changed, log, (value) => ({...value, sessionTitles: this.knownTitlesFor(this.titleKeys)}));
    }

    sessionsRevision = 0;
    notifyRevision = 0;
    githubRevision = 0;
    /** `stop()` 之后为 true：之后的 `watchAll()` 与 herdr 的 `start()` 都不再挂监视与定时器。 */
    stopped = false;
    /** 最近一次活动重算收集的、要显示标题的完整会话键（`titledKeys`）；读标题的任务与快照都按这一份取，过期的任务结果不会改键集合。 */
    private titleKeys: string[] = [];
    /** 读到过的标题，键是完整会话键；只留 `titleKeys` 里的。 */
    private knownTitles = new Map<string, SessionTitle>();
    private titleTask: Promise<void> | null = null;
    private titleAgain = false;
    /** 上一轮预算用完时没查完的键数：变了才记日志，慢盘上不每 5 秒刷一条。 */
    private titlesLeft = 0;

    onChange(listener: (part: PartName) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    revisions(): Record<PartName, number> {
        return {records: this.records.part.revision, activity: this.activity.part.revision, sessions: this.sessionsRevision, notify: this.notifyRevision, github: this.githubRevision};
    }

    notifyChanged(): void {
        this.notifyRevision += 1;
        for (const listener of this.listeners) listener("notify");
    }

    /** GitHub 的只读数据取回来了（t14）：经 `/ws` 推“github 变了”。 */
    githubChanged(): void {
        this.githubRevision += 1;
        for (const listener of this.listeners) listener("github");
    }

    /** 有浏览器连着：GitHub 只在这时定时刷新（t14 设计审查 S8）。 */
    hasClients(): boolean {
        return this.clients > 0;
    }

    keyOf(root: string): string | null {
        return this.keys.get(root) ?? null;
    }

    checkoutByKey(key: string): CheckoutInfo | null {
        return this.checkouts.find((checkout) => this.keys.get(checkout.root) === key && !checkout.prunable) ?? null;
    }

    /** 快照里这几个会话键的标题（视图只放自己出现的键）；没有标题的键不在结果里。 */
    titlesFor(keys: Iterable<string | null | undefined>): Record<string, SessionTitle> {
        const all = this.activity.part.value?.sessionTitles ?? {};
        const picked: Record<string, SessionTitle> = {};
        for (const key of keys) {
            if (key && Object.hasOwn(all, key)) picked[key] = all[key]!;
        }
        return picked;
    }

    private async computeRecords(): Promise<RecordsValue> {
        const transition = await readTransitionState(this.context.mainRoot, this.cache);
        this.checkouts = transition.checkouts;
        this.keys = checkoutKeys(transition.checkouts);
        const {records, warnings} = await readProjectRecords(this.context, transition);
        return {records, transition, warnings: [...transition.warnings, ...warnings]};
    }

    private async computeActivity(client: HerdrClient | null): Promise<ActivityValue> {
        const transition = this.records.part.value?.transition ?? await readTransitionState(this.context.mainRoot, this.cache);
        const warnings: Warning[] = [];
        const herdr = this.herdr.current();
        const snapshot: HerdrSnapshot = herdr.available && client
            ? {available: true, socketPath: herdr.socketPath, version: herdr.version, panes: herdr.panes, processes: await readPaneProcesses(client, herdr.panes, warnings)}
            : {available: false, socketPath: herdr.socketPath, version: null, panes: [], processes: null};
        const {activity, warnings: activityWarnings} = await readActivity(this.context.mainRoot, transition, {herdr: null, now: new Date(), selfPid: process.pid, snapshot});
        const {runs, warnings: procWarnings} = await listProcRuns(this.context.mainRoot);
        const dayAgo = Date.now() - 24 * 3_600_000;
        const procs = runs.filter((run) => run.state !== "ended" || Date.parse(run.endedAt ?? run.startedAt) >= dayAgo).sort((left, right) => right.startedAt.localeCompare(left.startedAt));
        this.titleKeys = [...this.titledKeys(activity, procs, herdr.panes)];
        this.scheduleTitles();
        // 标题由 `settle` 按最新的已知值填（见构造函数），这里不等读标题。
        return {activity, procs, sessionTitles: {}, warnings: [...warnings, ...activityWarnings, ...procWarnings]};
    }

    private knownTitlesFor(keys: readonly string[]): Record<string, SessionTitle> {
        const picked: Record<string, SessionTitle> = {};
        for (const key of keys) {
            const title = this.knownTitles.get(key);
            if (title) picked[key] = title;
        }
        return picked;
    }

    /** 单飞：在读时又被要求，就在这一轮读完后按那时最新的键再读一轮。停止之后不再开始（预热途中停止时，预热还会算一次活动）。 */
    private scheduleTitles(): void {
        if (this.stopped) return;
        if (this.titleTask) {
            this.titleAgain = true;
            return;
        }
        this.titleTask = this.readTitles().catch((error: unknown) => {
            if (!(error instanceof Error)) throw error;
            this.log(`读会话标题失败，沿用已知的：${error.message}`);
        }).finally(() => {
            this.titleTask = null;
            if (this.titleAgain && !this.stopped) {
                this.titleAgain = false;
                this.scheduleTitles();
            }
        });
    }

    /**
     * 一轮读标题：按开始时的键读，读完的键更新已知标题（读不到的删掉），没查完的沿用已知值；
     * 再按此刻最新的键集合改快照里的标题（只改标题，不重算活动）。指纹只看最终的标题，没变就不推送。
     */
    private async readTitles(): Promise<void> {
        const keys = this.titleKeys;
        const {titles, pending} = await this.titles.titlesOf(keys, {budgetMs: TITLE_BUDGET_MS});
        // 读的途中停止了：不再改已知标题与快照，停止返回之后数据不变。
        if (this.stopped) return;
        const left = new Set(pending);
        for (const key of keys) {
            if (left.has(key)) continue;
            const title = titles[key];
            if (title) this.knownTitles.set(key, title);
            else this.knownTitles.delete(key);
        }
        const latest = new Set(this.titleKeys);
        for (const key of [...this.knownTitles.keys()]) if (!latest.has(key)) this.knownTitles.delete(key);
        if (left.size !== this.titlesLeft) {
            this.titlesLeft = left.size;
            this.log(left.size > 0 ? `读会话标题超过 ${TITLE_BUDGET_MS} 毫秒，还有 ${left.size} 个会话没查完，先沿用已知的，下一轮接着查` : "会话标题都查完了");
        }
        this.activity.patch((value) => ({...value, sessionTitles: this.knownTitlesFor(this.titleKeys)}));
    }

    /**
     * 页面上会显示的会话：有效租约的、活动里的会话（含运行的属主）、经 nbdev 起的服务的属主、herdr 各格上的会话，
     * 以及收件箱的提问者（提问者可能早已不在活动里，记录里还留着它的键）。
     */
    private titledKeys(activity: Activity, procs: ProcRunView[], panes: readonly HerdrPane[]): Set<string> {
        const keys = new Set<string>();
        for (const lease of activity.leases) if (lease.state === "valid") keys.add(lease.session.key);
        for (const session of activity.sessions) keys.add(session.key);
        for (const run of procs) if (run.startedBy) keys.add(run.startedBy.key);
        for (const pane of panes) if (pane.session) keys.add(`${pane.session.agent}:${pane.session.value}`);
        for (const item of this.records.part.value?.records.inbox ?? []) if (item.kind === "question" && item.askedBy) keys.add(item.askedBy);
        return keys;
    }

    /** 预热：记录与活动各算一遍（herdr 不等，随后补上）。 */
    async warm(): Promise<void> {
        this.codeKey = await readCodeKey(this.context.mainRoot);
        this.herdr.start();
        await this.records.run();
        await this.activity.run();
        this.checkoutPrint = await this.checkoutFingerprint();
    }

    /** 开始监视与定时检查。 */
    watchAll(): void {
        if (this.stopped) return;
        const {mainRoot} = this.context;
        this.watchRecords(resolve(mainRoot, WORKS_ROOT));
        this.watchLeases();
        this.timers.push(setInterval(() => void this.periodicCheck(), CHECK_MS));
        this.timers.push(setInterval(() => {
            if (this.clients === 0) return;
            this.cache.uncommitted.clear();
            void this.records.run();
        }, FALLBACK_MS));
    }

    clientConnected(): void {
        this.clients += 1;
        this.herdr.setActive(true);
    }

    clientDisconnected(): void {
        this.clients = Math.max(0, this.clients - 1);
        if (this.clients === 0) this.herdr.setActive(false);
    }

    /**
     * 停止：同步部分（置 `stopped`、关监视与定时器、停 herdr）在调用时就做完；返回的 Promise 等读标题的后台任务与已经开始的查找结束，
     * 最多 `TITLE_STOP_MS`，超时记一条诊断。之后读标题不再开始、不再改数据。
     */
    async stop(): Promise<void> {
        this.stopped = true;
        for (const watcher of this.watchers) watcher.close();
        for (const timer of this.timers) clearInterval(timer);
        if (this.debounce) clearTimeout(this.debounce);
        this.herdr.stop();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timedOut = new Promise<true>((resolveTimeout) => {
            timer = setTimeout(() => resolveTimeout(true), TITLE_STOP_MS);
        });
        try {
            const finished = Promise.all([this.titleTask, this.titles.close()]).then(() => false as const);
            if (await Promise.race([finished, timedOut])) this.log(`停止时读会话标题的文件操作等了 ${TITLE_STOP_MS} 毫秒还没结束，不再等；它们结束之后不会再改面板的数据`);
        } finally {
            clearTimeout(timer);
        }
    }

    private scheduleRecords(): void {
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => {
            this.debounce = null;
            void this.records.run();
        }, DEBOUNCE_MS);
    }

    private watchRecords(path: string): void {
        try {
            const watcher = watch(path, {recursive: true}, (_event, filename) => {
                // 证据目录从不进索引，会话一次写一批截图不该触发一串重算。
                const name = typeof filename === "string" ? filename : "";
                if (name.split("/").includes("evidences")) return;
                this.scheduleRecords();
            });
            watcher.on("error", (error) => this.log(`监视 ${path} 出错，改靠 5 秒的检查与 30 秒的兜底：${error.message}`));
            this.watchers.push(watcher);
        } catch (error) {
            if (!(error instanceof Error)) throw error;
            this.log(`没能监视 ${path}，改靠 5 秒的检查与 30 秒的兜底：${error.message}`);
        }
    }

    /** 租约目录可能还不存在（面板只读，不建它）：先监视 `.local/agent/`，都不在就只靠 5 秒的重算。 */
    private watchLeases(): void {
        const {mainRoot} = this.context;
        for (const [path, recursive] of [[resolve(mainRoot, LEASES_DIR), false], [resolve(mainRoot, AGENT_LOCAL_ROOT), true]] as const) {
            try {
                const watcher = watch(path, {recursive}, (_event, filename) => {
                    if (recursive && !(typeof filename === "string" && filename.startsWith("run/leases"))) return;
                    void this.activity.run();
                });
                watcher.on("error", (error) => this.log(`监视 ${path} 出错：${error.message}`));
                this.watchers.push(watcher);
                return;
            } catch (error) {
                if (systemErrorCode(error) !== "ENOENT") throw error;
            }
        }
        this.log("租约目录与 .local/agent/ 都还不存在，活动只靠 5 秒的重算");
    }

    private async checkoutFingerprint(): Promise<string> {
        const [list, master] = await Promise.all([
            gitOutput(this.context.mainRoot, ["worktree", "list", "--porcelain", "-z"], {readOnly: true}),
            runGit(this.context.mainRoot, ["rev-parse", "--verify", "--quiet", MASTER_REF], {readOnly: true}),
        ]);
        return `${master.stdout.trim()}\n${list}`;
    }

    private async periodicCheck(): Promise<void> {
        try {
            const print = await this.checkoutFingerprint();
            if (print !== this.checkoutPrint) {
                this.checkoutPrint = print;
                void this.records.run();
            }
            const code = await readCodeKey(this.context.mainRoot);
            if (code !== this.codeKey && !this.codeChanged) {
                this.codeChanged = true;
                for (const listener of this.listeners) listener("records");
            }
            if (this.clients > 0) void this.activity.run();
        } catch (error) {
            if (!(error instanceof Error)) throw error;
            this.log(`定时检查失败：${error.message}`);
        }
    }
}
