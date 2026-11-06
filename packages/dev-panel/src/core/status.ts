import type {HerdrClient} from "../herdr/client.js";
import {adoptionOf, listArtifactIds, listDocuments, questionStates, readArtifact, versionPath, waitingStates, type Adoption, type ArtifactKind, type DocumentEntry} from "./artifacts.js";
import {verifiedProvenance} from "./provenance.js";
import {readActivity, type Activity, type SessionView} from "./activity.js";
import {NbdevError, type Warning} from "./errors.js";
import type {Caller} from "./identity.js";
import type {RunView} from "./runs.js";
import {gitOutput, runGit, splitNul} from "./git.js";
import {parseTaskId, parseWorkId, taskRefNumber, workNumberLabel, workRefNumber} from "./ids.js";
import {
    listTaskIds,
    listWorkIds,
    readCommitDates,
    readTaskRecord,
    readWorkRecord,
    taskDirPath,
    workReadmePath,
    type TaskRecord,
    type TaskStatus,
    type WorkRecord,
} from "./records.js";
import {readRegistry, type Registry} from "./registry.js";
import {listCheckouts, MASTER_REF, WORKS_ROOT, type CheckoutInfo, type RepoContext} from "./repo.js";
import {findConflicts, nextWorkNumber, scanNumbers, type ConflictId, type NumberConflict} from "./scan.js";
import {chooseExecutionCheckout, findBranchRecordChanges, taskSourceInBranchWork, type BranchChangesCache, type ExecutionCheckout} from "./sources.js";

/** 记录从哪里读：`master` 是主工作区（已提交的或标了 `uncommitted` 的）；`branch` 是过渡期的执行 worktree。 */
export type RecordSource = {source: "master" | "branch"; branch: string | null; checkout: string};

/** 某个 Task 上的一份有效租约（谁在动）；临时数据，会话结束就消失。 */
export type ActiveLease = {sessionKey: string; agent: string; label: string | null; taskId: string; lastActivityAt: string; stale: boolean};

/** 一个产物的摘要；没有发布记录的（例如 nbdev 之前的评审板）`state` 为 `unpublished`，可以浏览但不进收件箱。 */
export type ArtifactSummary = {
    artifactId: string;
    kind: ArtifactKind | null;
    title: string | null;
    version: number | null;
    state: "open" | "closed" | "unpublished";
    publishedAt: string | null;
    waiting: number;
    adoption: Adoption | null;
};

/** 收件箱：只放要开发者动手的事。`askedBy` 是运行时的会话键（provenance），读不到为 null。 */
export type InboxItem =
    | {kind: "question"; workId: string; taskId: string; artifactId: string; artifactTitle: string | null; questionId: string; label: string; type: string; version: number; since: number; askedBy: string | null}
    | {kind: "number_conflict"; label: string; live: boolean; ids: ConflictId[]};

export type TaskView = TaskRecord & RecordSource & {uncommitted: boolean; leases: ActiveLease[]; artifacts: ArtifactSummary[]; documents: DocumentEntry[]};
export type WorkView = WorkRecord & RecordSource & {
    artifacts: ArtifactSummary[];
    documents: DocumentEntry[];
    activeLeases: ActiveLease[];
    uncommitted: boolean;
    executionRule: ExecutionCheckout["rule"] | null;
    otherCopies: Array<{branch: string | null; checkout: string}>;
    taskCounts: Record<TaskStatus | "unset" | "invalid", number>;
    tasks: TaskView[];
};

export type ProjectStatus = {
    mainRoot: string;
    callerRoot: string;
    callerBranch: string | null;
    /** 调用者是谁（只读地解析，不取租约）；调用方没给时为 null。 */
    caller: Caller | null;
    works: WorkView[];
    inbox: InboxItem[];
    conflicts: NumberConflict[];
    registryOnly: string[];
    nextWorkNumber: string;
    sessions: SessionView[];
    unownedRuns: RunView[];
    ignoredProcesses: number;
    herdr: Activity["herdr"];
};

/** 记录那一部分（不含活动）：Work、Task、收件箱、撞号。各 Work 与 Task 的租约留空，由 `withActivity` 填上。 */
export type ProjectRecords = Omit<ProjectStatus, "caller" | "sessions" | "unownedRuns" | "ignoredProcesses" | "herdr">;

export type StatusOptions = {herdr?: HerdrClient | null; caller?: Caller | null; now?: Date; selfPid?: number};

export type StatusFilter = {workRef?: string; taskRef?: string};

/** 读到的过渡期信息，写操作的来源判断也复用它。 */
export type TransitionState = {
    checkouts: CheckoutInfo[];
    registry: Registry;
    branchChanges: Map<string, CheckoutInfo[]>;
    warnings: Warning[];
};

/** `cache` 只给常驻的面板用（见 `BranchChangesCache`）。 */
export async function readTransitionState(mainRoot: string, cache: BranchChangesCache | null = null): Promise<TransitionState> {
    const checkouts = await listCheckouts(mainRoot);
    const {registry} = await readRegistry(mainRoot);
    const {changes, warnings} = await findBranchRecordChanges(mainRoot, checkouts, cache);
    return {checkouts, registry, branchChanges: changes, warnings};
}

/** 在一组 id 里按完整 id 或编号解析引用；找不到返回空数组，几个同号时返回全部。 */
export function matchRef(ids: readonly string[], ref: string, kind: "work" | "task"): string[] {
    if (ids.includes(ref)) return [ref];
    const number = kind === "work" ? workRefNumber(ref) : taskRefNumber(ref);
    if (number === null || ref.includes("-")) return [];
    return ids.filter((id) => (kind === "work" ? parseWorkId(id)?.number : parseTaskId(id)?.number) === number);
}

/**
 * 读一个目录下全部产物的摘要，把等开发者答的题放进收件箱。提问者只在主工作区里找（provenance 在主工作区的 .local 下），
 * 来自分支的产物 `askedBy` 为 null。
 */
async function summarizeArtifacts(root: string, mainRoot: string, workId: string, taskId: string | null, inbox: InboxItem[], warnings: Warning[]): Promise<ArtifactSummary[]> {
    const summaries: ArtifactSummary[] = [];
    for (const artifactId of await listArtifactIds(root, workId, taskId)) {
        const ref = {workId, taskId, artifactId};
        const snapshot = await readArtifact(root, ref);
        warnings.push(...snapshot.warnings);
        const latest = snapshot.latest;
        if (!latest) {
            summaries.push({artifactId, kind: null, title: null, version: null, state: "unpublished", publishedAt: null, waiting: 0, adoption: null});
            continue;
        }
        const open = waitingStates(questionStates(latest, snapshot.answers, snapshot.answeredVersions), snapshot.answers);
        if (taskId !== null) {
            for (const {question} of open) {
                const asker = root === mainRoot ? await verifiedProvenance(mainRoot, versionPath(ref, question.since), warnings) : null;
                inbox.push({kind: "question", workId, taskId, artifactId, artifactTitle: latest.title, questionId: question.id, label: question.label, type: question.type, version: latest.version, since: question.since, askedBy: asker?.session.key ?? null});
            }
        }
        summaries.push({artifactId, kind: latest.kind, title: latest.title, version: latest.version, state: latest.state, publishedAt: latest.publishedAt, waiting: open.length, adoption: adoptionOf(snapshot.answers, snapshot.acks)});
    }
    return summaries;
}

/**
 * “最近更新”：frontmatter 的 `updated`、产物目录与 Task 目录第一层文档最后一次提交的日期中最晚的那个
 * （发布、答复、确认与编辑 Task 里的其它文档都不改 README）。
 * 不合规的 `updated` 原样返回：盖成提交日期会把“这一行写错了”与原值一起丢掉。
 */
function laterUpdated(updated: TaskRecord["updated"], ...commitDates: Array<string | undefined>): TaskRecord["updated"] {
    const latest = commitDates.filter((date): date is string => date !== undefined).sort().at(-1);
    if (updated.origin === "invalid" || latest === undefined) return updated;
    if (updated.value !== null && updated.value >= latest) return updated;
    return {value: latest, origin: "commit"};
}

function emptyCounts(): WorkView["taskCounts"] {
    return {planned: 0, active: 0, done: 0, shelved: 0, unset: 0, invalid: 0};
}

/** 主工作区里未提交（含未跟踪）的记录路径；`-uall` 才能把未跟踪目录拆到具体文件。 */
async function uncommittedPaths(mainRoot: string): Promise<string[]> {
    const output = await gitOutput(mainRoot, ["status", "--porcelain", "-z", "-uall", "--no-renames", "--", `${WORKS_ROOT}/`], {readOnly: true});
    return splitNul(output).map((entry) => entry.slice(3));
}

/**
 * 汇总全部 Work 与 Task 的状态、来源与编号冲突，再填上活动（租约、会话、运行）。只读：不取锁，不写任何文件。
 * 记录与活动并行读；警告的顺序固定为过渡期、活动、记录。
 */
export async function readProjectStatus(context: RepoContext, filter: StatusFilter = {}, options: StatusOptions = {}): Promise<{status: ProjectStatus; warnings: Warning[]}> {
    const transition = await readTransitionState(context.mainRoot);
    const [{activity, warnings: activityWarnings}, {records, warnings: recordWarnings}] = await Promise.all([
        readActivity(context.mainRoot, transition, {herdr: options.herdr ?? null, now: options.now ?? new Date(), selfPid: options.selfPid ?? process.pid}),
        readProjectRecords(context, transition, filter),
    ]);
    return {status: withActivity(records, activity, options.caller ?? null), warnings: [...transition.warnings, ...activityWarnings, ...recordWarnings]};
}

/** 把活动拼进记录：每个 Work 的有效租约（最近活动的在前）与各 Task 上的那几份，以及会话与运行。 */
export function withActivity(records: ProjectRecords, activity: Activity, caller: Caller | null): ProjectStatus {
    const activeOf = (workId: string): ActiveLease[] => activity.leases
        .filter((lease) => lease.state === "valid" && lease.workId === workId)
        .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt))
        .map((lease) => ({sessionKey: lease.session.key, agent: lease.session.agent, label: lease.session.label, taskId: lease.taskId, lastActivityAt: lease.lastActivityAt, stale: lease.stale}));
    const works = records.works.map((work): WorkView => {
        const workLeases = activeOf(work.workId);
        return {...work, activeLeases: workLeases, tasks: work.tasks.map((task) => ({...task, leases: workLeases.filter((lease) => lease.taskId === task.taskId)}))};
    });
    return {
        mainRoot: records.mainRoot,
        callerRoot: records.callerRoot,
        callerBranch: records.callerBranch,
        caller,
        works,
        inbox: records.inbox,
        conflicts: records.conflicts,
        registryOnly: records.registryOnly,
        nextWorkNumber: records.nextWorkNumber,
        sessions: activity.sessions,
        unownedRuns: activity.unownedRuns,
        ignoredProcesses: activity.ignoredProcesses,
        herdr: activity.herdr,
    };
}

/**
 * 记录那一部分：全部 Work 与 Task 的状态、来源、产物与文档索引、收件箱与编号冲突。`transition` 由调用方读好传进来
 * （面板带着缓存读），返回的警告不含 `transition.warnings`。
 */
export async function readProjectRecords(context: RepoContext, transition: TransitionState, filter: StatusFilter = {}): Promise<{records: ProjectRecords; warnings: Warning[]}> {
    const {mainRoot} = context;
    const warnings: Warning[] = [];
    const head = await runGit(mainRoot, ["symbolic-ref", "--quiet", "HEAD"], {readOnly: true});
    if (head.exitCode !== 0 || head.stdout.trim() !== MASTER_REF) {
        warnings.push({code: "main_not_on_master", message: "主工作区检出的不是 master，照常读工作区", details: {head: head.exitCode === 0 ? head.stdout.trim() : null}});
    }

    const mainWorkIds = await listWorkIds(mainRoot);
    let workIds = [...new Set([...mainWorkIds, ...transition.branchChanges.keys()])].sort();
    if (filter.workRef !== undefined) {
        const matched = matchRef(workIds, filter.workRef, "work");
        if (matched.length === 0) throw new NbdevError("work_not_found", `找不到 Work：${filter.workRef}`, {details: {workRef: filter.workRef}});
        if (matched.length > 1) throw new NbdevError("ambiguous_work", `Work 编号对应多个目录：${matched.join("、")}`, {details: {workRef: filter.workRef, candidates: matched}});
        workIds = matched;
    } else if (filter.taskRef !== undefined) {
        throw new NbdevError("usage", "--task 需要同时指定 --work");
    }

    const dirty = await uncommittedPaths(mainRoot);
    const inbox: InboxItem[] = [];
    const mainDates = await readCommitDates(mainRoot, "HEAD", WORKS_ROOT);
    const mainCheckout = transition.checkouts.find((checkout) => checkout.isMain)!;

    const works = await Promise.all(workIds.map(async (workId): Promise<WorkView> => {
        const copies = transition.branchChanges.get(workId);
        const execution = copies ? await chooseExecutionCheckout(mainRoot, workId, copies, transition.registry) : null;
        const executionRoot = execution?.chosen.root ?? mainRoot;
        const executionDates = execution ? await readCommitDates(executionRoot, "HEAD", `${WORKS_ROOT}/${workId}`) : mainDates;
        const record = await readWorkRecord(executionRoot, workId, executionDates, warnings);
        const executionTasks = execution ? await listTaskIds(executionRoot, workId) : [];
        const masterTasks = await listTaskIds(mainRoot, workId);
        let taskIds = [...new Set([...executionTasks, ...masterTasks])].sort();
        if (filter.taskRef !== undefined) {
            const matched = matchRef(taskIds, filter.taskRef, "task");
            if (matched.length === 0) throw new NbdevError("task_not_found", `找不到 Task：${workId}/${filter.taskRef}`, {details: {workId, taskRef: filter.taskRef}});
            if (matched.length > 1) throw new NbdevError("ambiguous_task", `Task 编号对应多个目录：${matched.join("、")}`, {details: {workId, candidates: matched}});
            taskIds = matched;
        }
        const tasks = await Promise.all(taskIds.map(async (taskId): Promise<TaskView> => {
            const source = execution ? taskSourceInBranchWork(transition.registry, workId, taskId, executionTasks.includes(taskId)) : "master";
            const root = source === "branch" ? executionRoot : mainRoot;
            const dates = source === "branch" ? executionDates : mainDates;
            const task = await readTaskRecord(root, workId, taskId, dates, warnings);
            const prefix = `${taskDirPath(workId, taskId)}/`;
            return {
                ...task,
                updated: laterUpdated(task.updated, dates.get(`${taskDirPath(workId, taskId)}/artifacts`), dates.get(`${taskDirPath(workId, taskId)}/documents`)),
                artifacts: await summarizeArtifacts(root, mainRoot, workId, taskId, inbox, warnings),
                documents: await listDocuments(root, taskDirPath(workId, taskId)),
                source,
                branch: source === "branch" ? execution!.chosen.branch : mainCheckout.branch,
                checkout: root,
                uncommitted: source === "master" && dirty.some((path) => path.startsWith(prefix)),
                leases: [],
            };
        }));
        const counts = emptyCounts();
        for (const task of tasks) counts[task.status.origin === "recorded" ? task.status.value : task.status.origin === "invalid" ? "invalid" : "unset"] += 1;
        return {
            ...record,
            source: execution ? "branch" : "master",
            branch: execution ? execution.chosen.branch : mainCheckout.branch,
            checkout: executionRoot,
            uncommitted: !execution && dirty.includes(workReadmePath(workId)),
            artifacts: await summarizeArtifacts(executionRoot, mainRoot, workId, null, inbox, warnings),
            documents: await listDocuments(executionRoot, `${WORKS_ROOT}/${workId}`),
            executionRule: execution?.rule ?? null,
            otherCopies: execution?.others.map((other) => ({branch: other.branch, checkout: other.root})) ?? [],
            activeLeases: [],
            taskCounts: counts,
            tasks,
        };
    }));

    const scan = await scanNumbers(mainRoot, transition.checkouts, transition.registry);
    const {conflicts, registryOnly} = await findConflicts(mainRoot, scan);
    // 只在旧副本里的撞号（改号之前开出的分支还带着旧名字）没有什么可动手的：不警告、不进收件箱，`conflicts` 里仍有完整列表。
    const liveConflicts = conflicts.filter((conflict) => conflict.live);
    if (liveConflicts.length > 0) {
        warnings.push({code: "number_conflicts", message: `有 ${liveConflicts.length} 处撞号正在发生`, details: {labels: liveConflicts.map((conflict) => conflict.label)}});
    }
    // 各 Task 并发读取，收件箱的题按 Work、Task、产物、题号排好；编号冲突接在后面。
    const questionKey = (item: InboxItem) => (item.kind === "question" ? `${item.workId}/${item.taskId}/${item.artifactId}/${item.questionId}` : "");
    inbox.sort((left, right) => questionKey(left).localeCompare(questionKey(right)));
    const workPrefixes = filter.workRef === undefined ? null : works.map((work) => work.workId.slice(0, 6));
    for (const conflict of liveConflicts) {
        if (workPrefixes && !workPrefixes.some((prefix) => conflict.label.startsWith(prefix))) continue;
        inbox.push({kind: "number_conflict", label: conflict.label, live: conflict.live, ids: conflict.ids});
    }
    return {
        records: {
            mainRoot,
            callerRoot: context.callerRoot,
            callerBranch: context.callerBranch,
            works,
            inbox,
            conflicts,
            registryOnly,
            nextWorkNumber: workNumberLabel(nextWorkNumber(scan)),
        },
        warnings,
    };
}
