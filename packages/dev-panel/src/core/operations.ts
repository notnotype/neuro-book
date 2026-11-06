import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {NbdevError, systemErrorCode, type Warning} from "./errors.js";
import {assertSlug, formatTaskId, formatWorkId, parseWorkId, taskNumberLabel, workNumberLabel} from "./ids.js";
import {waitingQuestionsOfTask} from "./artifacts.js";
import {parseFrontmatter, setFrontmatterFields} from "./frontmatter.js";
import {listTaskIds, listWorkIds, TASK_STATUSES, taskReadmePath, WORK_STATUSES, workReadmePath, type TaskStatus} from "./records.js";
import type {Caller, DeveloperCaller} from "./identity.js";
import {releaseTaskLeases, touchCallerLease, type LeaseEffects, type LeaseOptions} from "./lease-ops.js";
import {isClaimedTask, readRegistry, type RegistryBy} from "./registry.js";
import {existsInCommit, listCheckouts, WORKS_ROOT, type RepoContext} from "./repo.js";
import {findConflicts, nextTaskNumber, nextWorkNumber, partitionConflicts, scanNumbers, type ClaimedNumber, type NumberConflict, type NumberScan} from "./scan.js";
import {chooseExecutionCheckout, findBranchRecordChanges, type ExecutionCheckout} from "./sources.js";
import {matchRef} from "./status.js";
import {taskReadmeTemplate, workReadmeTemplate} from "./templates.js";
import {assertPlainText, assertTitle} from "./text-rules.js";
import {recordDate, runWriteTransaction, sha256, type CommitOutcome, type TransactionOptions, type WriteTx} from "./transaction.js";
import {assertNotStagedRename, readUncommitted} from "./uncommitted.js";

export type OperationResult<T> = {data: T; commit: CommitOutcome; warnings: Warning[]};
/** `conflicts` 只有涉及这次领号的撞号，`otherConflicts` 是其余撞号的组数。 */
export type CreateResult = {workId: string; taskId: string; paths: string[]; conflicts: NumberConflict[]; otherConflicts: number; registryOnly: string[]} & LeaseEffects;
/** `skipLease`：命令行的 `--no-lease`，不取得租约、不写 pane 标签；登记表的 `by` 照记调用者。 */
export type CreateOptions = TransactionOptions & Partial<LeaseOptions> & {skipLease?: boolean};
export type SetStatusResult = {workId: string; taskId: string | null; path: string; previous: unknown; next: string; changed: boolean};
export type ImportResult = {
    added: string[];
    nextWorkNumber: string;
    nextTaskNumbers: Record<string, string>;
    conflicts: NumberConflict[];
    registryOnly: string[];
};

function assertTaskStatus(status: string): TaskStatus {
    if (!(TASK_STATUSES as readonly string[]).includes(status)) {
        throw new NbdevError("invalid_status", `Task 状态只能是 ${TASK_STATUSES.join("、")}：${status}`, {details: {status, allowed: TASK_STATUSES}});
    }
    return status as TaskStatus;
}

function conflictWarning(conflicts: readonly NumberConflict[]): Warning | null {
    if (conflicts.length === 0) return null;
    return {
        code: "number_conflicts",
        message: `有 ${conflicts.length} 处撞号，其中 ${conflicts.filter((conflict) => conflict.live).length} 处 live；照常发号，改号按 Work 规则由人处理`,
        details: {labels: conflicts.map((conflict) => conflict.label)},
    };
}

/**
 * 查撞号并给 `number_conflicts` 警告。给了 `claimed`（领号命令）时只报涉及这些号的撞号，其余的只计组数：
 * 别处的旧撞号与这次领号无关，每次新建都列一遍只会淹没真正要看的。不给时（`registry import`）报全部。
 */
async function reportConflicts(tx: WriteTx, scan: NumberScan, claimed?: readonly ClaimedNumber[]): Promise<{conflicts: NumberConflict[]; otherConflicts: number; registryOnly: string[]}> {
    const found = await findConflicts(tx.context.mainRoot, scan);
    const {related, others} = claimed === undefined ? {related: found.conflicts, others: 0} : partitionConflicts(found.conflicts, claimed);
    const warning = conflictWarning(related);
    if (warning) tx.warn(warning);
    return {conflicts: related, otherConflicts: others, registryOnly: found.registryOnly};
}

type WritableWork = {workId: string; execution: ExecutionCheckout | null};
/** 解析可写的记录要用的：写事务里是锁内读的，预览（不取锁）时是现读的。 */
export type RecordScope = Pick<WriteTx, "context" | "checkouts" | "registry">;

/**
 * 解析要写的 Work：只认主工作区里、Work README 已提交到 `master` 的；
 * `whole` 为真（改 Work 本身）时，记录还在分支上维护的 Work 拒写。
 */
export async function resolveWritableWork(tx: RecordScope, workRef: string, whole: boolean): Promise<WritableWork> {
    const {mainRoot} = tx.context;
    const {changes} = await findBranchRecordChanges(mainRoot, tx.checkouts);
    const matched = matchRef(await listWorkIds(mainRoot), workRef, "work");
    if (matched.length > 1) throw new NbdevError("ambiguous_work", `Work 编号对应多个目录：${matched.join("、")}`, {details: {workRef, candidates: matched}});
    if (matched.length === 0) {
        const onBranch = matchRef([...changes.keys()], workRef, "work");
        if (onBranch.length > 0) {
            const execution = await chooseExecutionCheckout(mainRoot, onBranch[0]!, changes.get(onBranch[0]!)!, tx.registry);
            throw new NbdevError("branch_maintained_record", `${onBranch[0]} 的记录还在分支上维护，master 上没有这个 Work；先按 Work 规则迁移`, {
                details: {workId: onBranch[0], branch: execution.chosen.branch, checkout: execution.chosen.root},
            });
        }
        throw new NbdevError("work_not_found", `找不到 Work：${workRef}`, {details: {workRef}});
    }
    const workId = matched[0]!;
    if (!await existsInCommit(mainRoot, "HEAD", workReadmePath(workId))) {
        throw new NbdevError("work_not_committed", `${workId} 的 README 还没有提交到 master，不能经 nbdev 写（只提交 Task 会在干净 checkout 上留下没有 Work README 的 master）`, {
            details: {workId, path: workReadmePath(workId)},
        });
    }
    const copies = changes.get(workId);
    const execution = copies ? await chooseExecutionCheckout(mainRoot, workId, copies, tx.registry) : null;
    if (whole && execution) {
        throw new NbdevError("branch_maintained_record", `${workId} 的记录还在分支上维护，在原处改或先迁移`, {
            details: {workId, branch: execution.chosen.branch, checkout: execution.chosen.root},
        });
    }
    return {workId, execution};
}

/**
 * 解析要写的 Task：来源必须是 `master`，判定与过渡期的读法相同。来自分支的 Work 里，只在 `master` 上的 Task（例如迁来的 t80）
 * 或经 nbdev 领号的 Task 可以写；同一个 Task 在执行 worktree 里也有、又不是经 nbdev 领的，就还在分支上维护，拒写。
 * `requireCommittedReadme`：产物与答复的写入要求 Task README 已提交，否则 `master` 上会出现没有 Task README 的提交。
 */
export async function resolveWritableTask(tx: RecordScope, workRef: string, taskRef: string, options: {requireCommittedReadme?: boolean} = {}): Promise<{workId: string; taskId: string; execution: ExecutionCheckout | null}> {
    const {mainRoot} = tx.context;
    const {workId, execution} = await resolveWritableWork(tx, workRef, false);
    const matched = matchRef(await listTaskIds(mainRoot, workId), taskRef, "task");
    const onBranch = execution ? matchRef(await listTaskIds(execution.chosen.root, workId), taskRef, "task") : [];
    if (matched.length > 1) throw new NbdevError("ambiguous_task", `Task 编号对应多个目录：${matched.join("、")}`, {details: {workId, candidates: matched}});
    const candidate = matched[0] ?? onBranch[0];
    if (!candidate) throw new NbdevError("task_not_found", `找不到 Task：${workId}/${taskRef}`, {details: {workId, taskRef}});
    if (execution && onBranch.includes(candidate) && !isClaimedTask(tx.registry, workId, candidate)) {
        throw new NbdevError("branch_maintained_record", `${workId}/${candidate} 的记录还在分支上维护，在原处改或先迁移`, {
            details: {workId, taskId: candidate, branch: execution.chosen.branch, checkout: execution.chosen.root},
        });
    }
    if (!matched.includes(candidate)) throw new NbdevError("task_not_found", `master 上没有这个 Task：${workId}/${candidate}`, {details: {workId, taskId: candidate}});
    if (options.requireCommittedReadme && !await existsInCommit(mainRoot, "HEAD", taskReadmePath(workId, candidate))) {
        throw new NbdevError("task_not_committed", `${workId}/${candidate} 的 README 还没有提交到 master，先提交它`, {details: {workId, taskId: candidate, path: taskReadmePath(workId, candidate)}});
    }
    return {workId, taskId: candidate, execution};
}

/** 领号新建 Work 与首个 Task（Work 必须至少有一个 Task），提交这两个 README。 */
export async function createWork(context: RepoContext, input: CreateInput, options: CreateOptions = {}): Promise<OperationResult<CreateResult>> {
    assertSlug(input.slug);
    assertSlug(input.taskSlug);
    const title = assertTitle(input.title, "Work 标题");
    const taskTitle = assertTitle(input.taskTitle ?? input.title, "Task 标题");
    if (input.goal.trim() === "") throw new NbdevError("usage", "--goal 不能为空", {details: {field: "goal"}});
    assertPlainText(input.goal, "goal", true);
    if (input.issueNumber !== undefined && (!Number.isInteger(input.issueNumber) || input.issueNumber < 1)) {
        throw new NbdevError("usage", `--issue 必须是正整数：${input.issueNumber}`);
    }
    const taskStatus = assertTaskStatus(input.taskStatus ?? "planned");
    const {result, commit, warnings} = await runWriteTransaction(context, options, async (tx) => {
        const scan = await tx.scan();
        const number = nextWorkNumber(scan);
        const workId = formatWorkId(number, input.slug);
        const taskId = formatTaskId(1, input.taskSlug);
        // 撞号检查要在领号之前做：领了号还没落位时，新 id 只在登记表里，会被误报成 registryOnly。
        const found = await reportConflicts(tx, scan, [{kind: "work", number: workNumberLabel(number)}, {kind: "task", workId, number: taskNumberLabel(1)}]);
        tx.claimWork(workId, byOf(options.caller));
        tx.claimTask(workId, taskId, byOf(options.caller));
        const date = recordDate(tx.now);
        const workDir = `${WORKS_ROOT}/${workId}`;
        tx.createDirectory(workDir, {
            "README.md": workReadmeTemplate({workId, issueId: input.issueNumber === undefined ? null : `i${input.issueNumber}`, title, goal: input.goal, date}),
            [`tasks/${taskId}/README.md`]: taskReadmeTemplate({taskId, title: taskTitle, goal: null, status: taskStatus, date}),
        });
        return {
            message: `docs(${workNumberLabel(number)}): ${actorOf(options.caller)}新建 Work ${workId} 与 ${taskId}`,
            result: {workId, taskId, paths: [workReadmePath(workId), taskReadmePath(workId, taskId)], ...found},
        };
    });
    // 提交失败但文件已写、号已领时也取得租约：会话会接着在这个 Task 上做。`--no-lease` 两种情况都不取。
    const lease = options.skipLease ? null : await touchCallerLease(context, {workId: result.workId, taskId: result.taskId, action: "work new"}, leaseOptionsOf(options), warnings);
    return {data: {...result, lease, released: []}, commit, warnings};
}

/** 领该 Work 的下一个 Task 号，建 Task README 并提交；记录还在分支上维护的 Work 也一律写进 master。 */
export async function createTask(context: RepoContext, input: CreateTaskInput, options: CreateOptions = {}): Promise<OperationResult<CreateResult>> {
    assertSlug(input.slug);
    const title = assertTitle(input.title, "Task 标题");
    if (input.goal !== undefined) assertPlainText(input.goal, "goal", true);
    const status = assertTaskStatus(input.status ?? "planned");
    const {result, commit, warnings} = await runWriteTransaction(context, options, async (tx) => {
        const {workId} = await resolveWritableWork(tx, input.workRef, false);
        const scan = await tx.scan();
        const number = nextTaskNumber(scan, workId);
        const taskId = formatTaskId(number, input.slug);
        const found = await reportConflicts(tx, scan, [{kind: "task", workId, number: taskNumberLabel(number)}]);
        tx.claimTask(workId, taskId, byOf(options.caller));
        const date = recordDate(tx.now);
        tx.createDirectory(`${WORKS_ROOT}/${workId}/tasks/${taskId}`, {
            "README.md": taskReadmeTemplate({taskId, title, goal: input.goal ?? null, status, date}),
        });
        return {
            message: `docs(${workId.slice(0, 6)}): ${actorOf(options.caller)}新建 ${taskId}`,
            result: {workId, taskId, paths: [taskReadmePath(workId, taskId)], ...found},
        };
    });
    const lease = options.skipLease ? null : await touchCallerLease(context, {workId: result.workId, taskId: result.taskId, action: "task new"}, leaseOptionsOf(options), warnings);
    return {data: {...result, lease, released: []}, commit, warnings};
}

/**
 * 改 Work 或 Task 的状态：只改 frontmatter 的 status 与 updated 两行。
 * 锁内先比 `expectedHash`（调用方看到的那一版），再查未提交改动：有改动时默认拒绝（路径限定的提交会把这些改动一起带进去），
 * `includeUncommitted` 才放行；目标是暂存区里一次改名的一端时一律拒绝。
 */
export async function setRecordStatus(context: RepoContext, input: {
    workRef: string;
    taskRef?: string;
    status: string;
    includeUncommitted?: boolean;
    expectedHash?: string;
}, options: TransactionOptions & {caller?: Caller | null} = {}): Promise<OperationResult<SetStatusResult>> {
    const allowed: readonly string[] = input.taskRef === undefined ? WORK_STATUSES : TASK_STATUSES;
    if (!allowed.includes(input.status)) {
        throw new NbdevError("invalid_status", `${input.taskRef === undefined ? "Work" : "Task"} 状态只能是 ${allowed.join("、")}：${input.status}`, {details: {status: input.status, allowed}});
    }
    const {result, commit, warnings} = await runWriteTransaction(context, options, async (tx) => {
        const {mainRoot} = tx.context;
        let workId: string;
        let taskId: string | null = null;
        if (input.taskRef !== undefined) {
            ({workId, taskId} = await resolveWritableTask(tx, input.workRef, input.taskRef));
        } else {
            ({workId} = await resolveWritableWork(tx, input.workRef, true));
        }
        const path = taskId === null ? workReadmePath(workId) : taskReadmePath(workId, taskId);
        let text: string;
        try {
            text = await readFile(resolve(mainRoot, path), "utf8");
        } catch (error) {
            if (systemErrorCode(error) === "ENOENT") throw new NbdevError("target_missing", `记录的 README 不存在：${path}`, {details: {path}});
            throw error;
        }
        const hash = sha256(text);
        if (input.expectedHash !== undefined && input.expectedHash !== hash) {
            throw new NbdevError("hash_mismatch", `文件在读取之后被改过：${path}`, {details: {path, expected: input.expectedHash, actual: hash, currentHash: hash}});
        }
        await assertNotStagedRename(mainRoot, path);
        const uncommitted = await readUncommitted(mainRoot, path);
        if (uncommitted && !input.includeUncommitted) {
            throw new NbdevError("uncommitted_changes", `${path} 在主工作区有未提交的改动；确认要一起提交时加 --include-uncommitted`, {
                details: {path, currentHash: hash, ...uncommitted},
            });
        }
        const parsed = parseFrontmatter(text);
        if (!parsed.ok) throw new NbdevError("invalid_record", `记录的 frontmatter 无法读取（${parsed.reason}）：${path}`, {details: {path}});
        const previous = parsed.data.status ?? null;
        if (previous === input.status) {
            return {message: null, result: {workId, taskId, path, previous, next: input.status, changed: false}};
        }
        tx.replaceFile(path, setFrontmatterFields(text, {status: input.status, updated: recordDate(tx.now)}), hash);
        return {
            message: `docs(${workId.slice(0, 6)}): ${taskId ?? workId} 状态改为 ${input.status}${options.caller?.kind === "developer" ? "（面板）" : ""}`,
            result: {workId, taskId, path, previous, next: input.status, changed: true},
        };
    });
    return {data: result, commit, warnings};
}

/**
 * 改 Task 状态并处理租约：提交成功（含无需提交）之后，新状态是 done 或 shelved 就释放这个 Task 的全部租约
 * （不论哪个会话、不论由谁调用），否则续期调用者的租约。命令行与面板都调它；面板以开发者身份写入时 `caller` 为 null，只释放。
 */
export async function setTaskStatus(context: RepoContext, input: {
    workRef: string;
    taskRef: string;
    status: string;
    includeUncommitted?: boolean;
    expectedHash?: string;
}, options: TransactionOptions & Partial<LeaseOptions> = {}): Promise<OperationResult<SetStatusResult & LeaseEffects>> {
    const outcome = await setRecordStatus(context, input, options);
    const failed = !outcome.commit.committed && outcome.commit.reason !== "nothing_to_commit";
    const leaseOptions = leaseOptionsOf(options);
    const target = {workId: outcome.data.workId, taskId: outcome.data.taskId!};
    let effects: LeaseEffects = {lease: null, released: []};
    if (!failed && (input.status === "done" || input.status === "shelved")) {
        effects = {lease: null, released: await releaseTaskLeases(context, target, input.status === "done" ? "task_done" : "task_shelved", leaseOptions, outcome.warnings)};
        // 只提醒、不自动撤回：自动撤回会抹掉“开发者还没答”这个事实，由会话决定撤回还是留着。
        const open = await waitingQuestionsOfTask(context.mainRoot, target.workId, target.taskId);
        if (open.length > 0) {
            outcome.warnings.push({code: "open_questions", message: `这个 Task 还有 ${open.length} 道题在等开发者答，仍在收件箱里；不再需要的用 nbdev ask withdraw 撤回或 nbdev artifact close 关闭`, details: {questions: open.map((entry) => `${entry.artifactId}#${entry.question.id}`)}});
        }
    } else if (!failed) {
        effects = {lease: await touchCallerLease(context, {...target, action: "task status"}, leaseOptions, outcome.warnings), released: []};
    }
    return {data: {...outcome.data, ...effects}, commit: outcome.commit, warnings: outcome.warnings};
}

function leaseOptionsOf(options: Partial<LeaseOptions> & {now?: () => Date}): LeaseOptions {
    return {caller: options.caller ?? null, herdr: options.herdr ?? null, now: options.now};
}

/** 登记表里开发者领的号记谁：`null` 已经表示“认不出的调用者”，开发者要分得出来。形状沿用会话的 `RegistryBy`。 */
export function developerBy(caller: DeveloperCaller): RegistryBy {
    return {key: `developer:${caller.device}`, agent: "developer", sessionId: null, label: caller.device, parentSessionId: null, nestedSessionId: null};
}

function byOf(caller: Caller | null | undefined): RegistryBy | null {
    if (caller?.kind === "session") return caller.ref;
    if (caller?.kind === "developer") return developerBy(caller);
    return null;
}

/** 提交信息里的动作主语：开发者在面板上写的标“面板”，其余是 nbdev。 */
export function actorOf(caller: Caller | null | undefined): string {
    return caller?.kind === "developer" ? "面板" : "nbdev ";
}

export type CreateInput = {slug: string; title: string; goal: string; taskSlug: string; taskTitle?: string; issueNumber?: number; taskStatus?: string};
export type CreateTaskInput = {workRef: string; slug: string; title: string; goal?: string; status?: string};
export type PreviewProblem = {field: string; code: string; message: string};
/** 新建的预览：预计领到的号、要写的文件与内容、提交信息；字段不合规时 `problems` 非空，其余尽量给出。 */
export type CreatePreview = {workId: string | null; taskId: string | null; paths: string[]; files: Record<string, string>; message: string | null; problems: PreviewProblem[]};

function collect(problems: PreviewProblem[], field: string, check: () => void): boolean {
    try {
        check();
        return true;
    } catch (error) {
        if (!(error instanceof NbdevError)) throw error;
        problems.push({field, code: error.code, message: error.message});
        return false;
    }
}

/** 不取锁时解析记录要用的范围：现读登记表与 checkout 列表（预览、面板读“能不能编辑”）。 */
export async function readRecordScope(context: RepoContext): Promise<RecordScope> {
    const [{registry}, checkouts] = await Promise.all([readRegistry(context.mainRoot), listCheckouts(context.mainRoot)]);
    return {context, checkouts, registry};
}

/** 预览只读：现读登记表与编号扫描，不取锁、不写登记表、不补登 `imported`。号以提交时为准。 */
async function previewScope(context: RepoContext): Promise<{scope: RecordScope; scan: NumberScan}> {
    const scope = await readRecordScope(context);
    return {scope, scan: await scanNumbers(context.mainRoot, scope.checkouts, scope.registry)};
}

/** `createWork` 的预览：校验与模板同一份。 */
export async function previewCreateWork(context: RepoContext, input: CreateInput, options: {caller?: Caller | null; now?: () => Date} = {}): Promise<CreatePreview> {
    const problems: PreviewProblem[] = [];
    const slugOk = collect(problems, "slug", () => assertSlug(input.slug));
    const taskSlugOk = collect(problems, "taskSlug", () => assertSlug(input.taskSlug));
    collect(problems, "title", () => assertTitle(input.title, "Work 标题"));
    if (input.taskTitle !== undefined) collect(problems, "taskTitle", () => assertTitle(input.taskTitle!, "Task 标题"));
    collect(problems, "goal", () => {
        if (input.goal.trim() === "") throw new NbdevError("usage", "目标不能为空");
        assertPlainText(input.goal, "goal", true);
    });
    if (input.issueNumber !== undefined) collect(problems, "issue", () => {
        if (!Number.isInteger(input.issueNumber) || input.issueNumber! < 1) throw new NbdevError("usage", `Issue 必须是正整数：${input.issueNumber}`);
    });
    collect(problems, "taskStatus", () => assertTaskStatus(input.taskStatus ?? "planned"));
    const {scan} = await previewScope(context);
    const number = nextWorkNumber(scan);
    const workId = slugOk ? formatWorkId(number, input.slug) : null;
    const taskId = taskSlugOk ? formatTaskId(1, input.taskSlug) : null;
    if (problems.length > 0 || workId === null || taskId === null) return {workId, taskId, paths: [], files: {}, message: null, problems};
    const date = recordDate((options.now ?? (() => new Date()))());
    const files = {
        [workReadmePath(workId)]: workReadmeTemplate({workId, issueId: input.issueNumber === undefined ? null : `i${input.issueNumber}`, title: input.title.trim(), goal: input.goal, date}),
        [taskReadmePath(workId, taskId)]: taskReadmeTemplate({taskId, title: (input.taskTitle ?? input.title).trim(), goal: null, status: assertTaskStatus(input.taskStatus ?? "planned"), date}),
    };
    return {workId, taskId, paths: Object.keys(files), files, message: `docs(${workNumberLabel(number)}): ${actorOf(options.caller)}新建 Work ${workId} 与 ${taskId}`, problems};
}

/** `createTask` 的预览。 */
export async function previewCreateTask(context: RepoContext, input: CreateTaskInput, options: {caller?: Caller | null; now?: () => Date} = {}): Promise<CreatePreview> {
    const problems: PreviewProblem[] = [];
    const slugOk = collect(problems, "slug", () => assertSlug(input.slug));
    collect(problems, "title", () => assertTitle(input.title, "Task 标题"));
    if (input.goal !== undefined) collect(problems, "goal", () => assertPlainText(input.goal!, "goal", true));
    collect(problems, "status", () => assertTaskStatus(input.status ?? "planned"));
    const {scope, scan} = await previewScope(context);
    let workId: string | null = null;
    try {
        ({workId} = await resolveWritableWork(scope, input.workRef, false));
    } catch (error) {
        if (!(error instanceof NbdevError)) throw error;
        problems.push({field: "workId", code: error.code, message: error.message});
    }
    const taskId = workId !== null && slugOk ? formatTaskId(nextTaskNumber(scan, workId), input.slug) : null;
    if (problems.length > 0 || workId === null || taskId === null) return {workId, taskId, paths: [], files: {}, message: null, problems};
    const date = recordDate((options.now ?? (() => new Date()))());
    const path = taskReadmePath(workId, taskId);
    return {
        workId,
        taskId,
        paths: [path],
        files: {[path]: taskReadmeTemplate({taskId, title: input.title.trim(), goal: input.goal ?? null, status: assertTaskStatus(input.status ?? "planned"), date})},
        message: `docs(${workId.slice(0, 6)}): ${actorOf(options.caller)}新建 ${taskId}`,
        problems,
    };
}

/** 按扫描结果补登 `imported` 条目，只写登记表；可以重复运行，结果不变。 */
export async function importRegistry(context: RepoContext, options: TransactionOptions = {}): Promise<OperationResult<ImportResult>> {
    const {result, commit, warnings} = await runWriteTransaction(context, {...options, repoWrites: false}, async (tx) => {
        const scan = await tx.scan();
        const {conflicts, registryOnly} = await reportConflicts(tx, scan);
        const nextTaskNumbers: Record<string, string> = {};
        for (const workId of [...new Set([...scan.works.keys(), ...scan.tasks.keys()])].sort()) {
            if (parseWorkId(workId)) nextTaskNumbers[workId] = taskNumberLabel(nextTaskNumber(scan, workId));
        }
        return {
            message: null,
            result: {added: [...tx.imported], nextWorkNumber: workNumberLabel(nextWorkNumber(scan)), nextTaskNumbers, conflicts, registryOnly},
        };
    });
    return {data: result, commit, warnings};
}
