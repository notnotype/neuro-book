/**
 * 面板接口回应里的数据形状（与 src/server/views.ts 对应）。只声明前端用到的字段。
 * 前端不导入服务端与核心库的模块：两边各自构建，类型在这里按合同（docs/panel.md）写一份。
 */

export type RecordedValue<T extends string = string> = {value: T | null; origin: "recorded" | "inferred" | "commit" | "unset" | "invalid"; raw?: unknown};
export type TaskStatus = "planned" | "active" | "done" | "shelved";
export type WorkStatus = "active" | "done" | "shelved";
export type ActiveLease = {sessionKey: string; agent: string; label: string | null; taskId: string; lastActivityAt: string; stale: boolean};

export type OverviewTask = {
    taskId: string; title: string | null; status: RecordedValue<TaskStatus>; updated: RecordedValue; currentState: string | null;
    source: "master" | "branch"; uncommitted: boolean; waiting: number; artifactCount: number; leaseCount: number;
};
export type OverviewWork = {
    workId: string; title: string | null; status: RecordedValue<WorkStatus>; goal: RecordedValue; updated: RecordedValue; source: "master" | "branch";
    branch: string | null; checkoutKey: string | null; executionRule: string | null; uncommitted: boolean;
    taskCounts: Record<TaskStatus | "unset" | "invalid", number>; waiting: number; activeLeases: ActiveLease[]; tasks: OverviewTask[];
};
export type InboxQuestion = {kind: "question"; workId: string; taskId: string; artifactId: string; artifactTitle: string | null; questionId: string; label: string; type: string; version: number; since: number; askedBy: string | null; askerActive: boolean | null};
export type ConflictLocation = {source: "main" | "worktree" | "ref"; checkout?: string; ref?: string; head?: string};
export type InboxConflict = {kind: "number_conflict"; label: string; live: boolean; ids: Array<{id: string; live: boolean; locations: ConflictLocation[]}>};
export type InboxItem = InboxQuestion | InboxConflict;
export type Overview = {
    works: OverviewWork[];
    inbox: InboxItem[];
    nextWorkNumber: string;
    sessions: {total: number; byStatus: Record<string, number>; unownedRuns: number; herdr: {available: boolean; mode: string}};
    /** 经 nbdev 起、还没结束的服务加无主的运行（左栏“在跑”的数，t14）。 */
    runs: number;
    /** Work 卡片“谁在动”与收件箱提问者的会话标题（t17），键是完整会话键，读不到标题的键不在里面。 */
    sessionTitles: Record<string, SessionTitle>;
};

export type AuditState = {enabled: true; initAt: string; path: string} | {enabled: false; reason: string; detail: string; path: string};
export type Meta = {
    instance: string; startedAt: string; ready: boolean; codeChanged: boolean; build: {failed: boolean; message: string | null};
    /** 作为服务运行时的单元名与重启命令；前台运行时都是 null。 */
    service: {unit: string | null; restartCommand: string | null};
    herdr: {available: boolean; mode: string; version: string | null; at: string | null; error: string | null; autoNotify: boolean};
    audit: AuditState;
    notify: {pending: number; attention: number};
    /** 网页终端（t12）能不能用：找不到 herdr、setpriv、setsid 或没连 herdr 时为 false，`reason` 写原因。 */
    terminal: {available: boolean; reason: string | null};
    parts: Record<string, {revision: number; at: string | null; error: string | null}>;
    artifactOrigin: string; artifactBase: string;
    /** 主工作区现在能不能写（不在 master、正在合并或变基时不能）；不能写时写入口隐藏。 */
    mainWritable: {ok: boolean; code: string | null; message: string | null};
};

export type ArtifactSummary = {artifactId: string; kind: string | null; title: string | null; version: number | null; state: "open" | "closed" | "unpublished"; publishedAt: string | null; waiting: number; adoption: "none" | "waiting" | "adopted" | null};
export type DocumentEntry = {path: string; title: string | null};
/** `/api/work` 的 Task：概览里的字段加上记录来源、租约与产物；不带概览才有的 `artifactCount`、`leaseCount`。 */
export type TaskView = Omit<OverviewTask, "artifactCount" | "leaseCount"> & {
    workId: string; readmePath: string; branch: string | null; checkout: string; checkoutKey: string | null; leases: ActiveLease[]; artifacts: ArtifactSummary[]; documents: DocumentEntry[];
};
export type WorkSession = {key: string; agent: string; label: string | null; alive: boolean | null; herdr: {paneId: string; status: string} | null; leases: Array<{taskId: string; lastActivityAt: string; stale: boolean}>; runs: number};
export type WorkView = Omit<OverviewWork, "tasks"> & {readmePath: string; readmeHash: string | null; artifacts: ArtifactSummary[]; documents: DocumentEntry[]; otherCopies: Array<{branch: string | null; checkout: string}>; tasks: TaskView[]; sessions: WorkSession[]; sessionTitles: Record<string, SessionTitle>};

export type ExecutionCandidate = {key: string; root: string; branch: string | null; rule: "readme" | "name" | "home" | "work" | "master"};
export type CommitEntry = {sha: string; date: string; author: string; subject: string};
export type TaskDetail = {
    readme: {path: string; text: string | null};
    evidences: Array<{name: string; path: string; kind: "file" | "dir"; size: number | null}>;
    specs: string[];
    execution: {chosen: ExecutionCandidate; candidates: ExecutionCandidate[]};
    commits: {checkout: string; range: "branch" | "task"; entries: CommitEntry[]};
};
export type TaskPageData = {task: TaskView & {readmeHash: string | null}; work: {workId: string; title: string | null; source: string; branch: string | null}; detail: TaskDetail; sessionTitles: Record<string, SessionTitle>};

export type ArtifactListItem = ArtifactSummary & {workId: string; taskId: string | null; taskTitle: string | null; workTitle: string | null; category: "design" | "report" | "review" | "questions" | "unpublished" | "other"};
export type DocumentListItem = DocumentEntry & {workId: string; taskId: string | null; checkoutKey: string | null};
export type EvidenceListItem = {workId: string; taskId: string; taskTitle: string | null; count: number};
export type ArtifactsData = {artifacts: ArtifactListItem[]; documents: DocumentListItem[]; evidences: EvidenceListItem[]};

export type QuestionOption = {value: string; label: string};
export type QuestionOutcome = null | {kind: "withdrawn"; in: number; reason: "explicit" | "closed"} | {kind: "superseded"; in: number; by: null | {workId: string; taskId: string; artifactId: string; questionId: string}};
export type VersionQuestion = {id: string; type: "single" | "multi" | "text" | "confirm"; label: string; options: QuestionOption[]; required: boolean; recommend: string[]; origin: "markup" | "ask"; page: string | null; about: string | null; since: number; outcome: QuestionOutcome};
export type AnswerUse = {answerId: string; value: unknown; artifactVersion: number; submittedAt: string; comment: string | null};
export type QuestionState = {question: VersionQuestion; state: "open" | "answered" | "withdrawn" | "superseded"; answer: AnswerUse | null; stale: (AnswerUse & {reason: string; code: "stale_value" | "invalid_value"}) | null};
export type AnswerRecord = {answerId: string; artifactVersion: number; submittedAt: string; submittedBy: {kind: "developer"; device: string} | {kind: "agent-transcribed"}; values: Record<string, unknown>; comments: Record<string, string>; note: string | null};
export type AckRecord = {ackId: string; answers: string[]; through: string; included: string[]; ackedAt: string};
export type ArtifactPageData = {
    ref: {workId: string; taskId: string | null; artifactId: string};
    checkoutKey: string | null; source: "master" | "branch"; branch: string | null; versions: number[]; latestVersion: number | null; version: number | null; kind: string | null; title: string | null;
    state: "open" | "closed" | "unpublished"; publishedAt: string | null; questions: QuestionState[]; answers: AnswerRecord[]; acks: AckRecord[];
    unpublishedChanges: boolean | null; pageUrl: string | null; pageIsCurrent: boolean;
};

export type CheckoutRef = {key: string; branch: string | null; isMain: boolean};
export type DocEntry = {path: string; group: string; section: string};
export type DocChange = {path: string; change: "added" | "modified" | "deleted" | "master_only"};
export type DocTreeData = {checkout: CheckoutRef; checkouts: Array<CheckoutRef & {root: string; head: string}>; docs: DocEntry[]; changes: DocChange[]};
export type DocFileData = {checkout: CheckoutRef; path: string; text: string; title: string | null; frontmatter: Record<string, unknown> | null; body: string; recent: CommitEntry[]; changedIn: string[]};

export type RunView = {pid: number; startedAt: string; command: string; cwd: string; checkout: string; ownerVia: string | null; paneId: string | null; unit: string | null; sessionHint: string | null; sessionAlive: boolean | null; descendants: Array<{pid: number; command: string}>};
export type SessionLease = {workId: string; taskId: string; acquiredAt: string; lastActivityAt: string; lastAction: string; stale: boolean};
/** 会话标题（t15 阶段 4 第 3 批）：从本机 Agent 的会话文件里读，读不出为 null。t17 起首页、Work 页、Task 页、运行页也各带一份 `sessionTitles`。 */
export type SessionTitle = {text: string; source: "claude-custom" | "claude-agent-name" | "claude-ai-title" | "codex" | "omp"};
export type SessionView = {key: string; agent: string; sessionId: string | null; label: string | null; alive: boolean | null; managed: boolean; herdr: {paneId: string; status: string} | null; leases: SessionLease[]; runs: RunView[]; title: SessionTitle | null};
/** `scrollback`：能往回翻多少行（前台是全屏程序或备用屏时是 0，读不到为 null）；`history`：能读更早的输出时走哪个接口，读不到为 null（服务端 `historySource`）。 */
export type PaneView = {paneId: string; terminalId: string; agent: string | null; status: string; session: {agent: string; value: string} | null; cwd: string | null; foregroundCwd: string | null; workspaceLabel: string | null; inRepository: boolean; scrollback: number | null; history: "session" | "pane" | null; title: SessionTitle | null};
export type SessionsData = {
    herdr: {available: boolean; mode: string; version: string | null; at: string | null; error: string | null; missedEvents: number; reconnects: number};
    panes: PaneView[]; sessions: SessionView[]; unownedRuns: RunView[]; ignoredProcesses: number;
    checkouts: Array<CheckoutRef & {root: string; head: string; executionOf: string[]}>;
};

export type SearchRecordMatch = {type: "record"; kind: "work" | "task" | "artifact" | "session"; workId?: string; taskId?: string | null; artifactId?: string; title?: string | null; key?: string; label?: string | null};
export type SearchHit = {type: "hit"; checkout: string; kind: "name" | "content"; path: string; line: number | null; text: string | null};
export type SearchCheckoutDone = {type: "checkout_done"; checkout: string; count: number; truncated: boolean; elapsedMs: number; error: string | null};

/** 写接口的回应里都有：核心的结果加提交结果。 */
export type CommitOutcome =
    | {committed: true; sha: string; paths: string[]; viaOtherCommit: boolean}
    | {committed: false; reason: "nothing_to_commit"; paths: string[]}
    | {committed: false; reason: "git_lock_timeout" | "git_failed"; writtenPaths: string[]; detail: string};
export type WriteData = {changed: boolean; commit: CommitOutcome};

export type PreviewProblem = {field: string; code: string; message: string};
export type CreatePreviewData = {workId: string | null; taskId: string | null; paths: string[]; files: Record<string, string>; message: string | null; problems: PreviewProblem[]};

export type UncommittedChanges = {status: string[]; staged: string | null; unstaged: string | null; untracked: boolean};
export type EditableFileData = {
    path: string; kind: "work_readme" | "task_readme" | "record_document" | "repo_doc" | null; text: string; hash: string; editable: boolean;
    reason: {code: string; message: string} | null; uncommitted: UncommittedChanges | null; stagedRename: boolean;
    changedIn: Array<{key: string; branch: string | null}>; lineLimit: number | null;
};

/** 通知（t11）：`/api/notify` 的任务与最近 24 小时的尝试，见 docs/panel.md 的“通知”。 */
export type NotifyJobState =
    | "audit_unavailable" | "legacy" | "waiting_herdr" | "no_target" | "replaced" | "not_in_repository" | "manual_only"
    | "waiting_idle" | "waiting_blocked" | "unknown_status" | "waiting_input" | "waiting_takeover" | "ready";
export type NotifyCandidate = {sessionKey: string; paneId: string; agent: string | null; status: string; asker: boolean};
export type NotifyJob = {
    workId: string; taskId: string; sessionKey: string; askerPaneId: string | null;
    answers: Array<{answerId: string; artifactId: string}>; legacy: Array<{answerId: string; artifactId: string}>; artifacts: string[]; questions: number;
    state: NotifyJobState; paneId: string | null; terminalId: string | null; agent: string | null; replacedBy: NotifyCandidate | null; alternatives: NotifyCandidate[];
    waitReason: string | null; screen: string | null; message: string; manualMessage: string; developerMessage: string;
};
export type NotifyResult = "pending" | "delivered" | "delivered_into_blocked" | "delivered_maybe_wrong_session" | "uncertain" | "skipped" | "agent_blocked" | "not_deliverable" | "session_changed" | "failed";
export type NotifyAttempt = {
    attemptId: string; at: string; workId: string; taskId: string; sessionKey: string; askerKey: string; paneId: string | null;
    answers: string[]; result: NotifyResult; code: string | null; message: string | null; manual: boolean; intentOnly: boolean;
};
export type NotifyData = {jobs: NotifyJob[]; recent: NotifyAttempt[]; audit: {enabled: boolean; reason?: string; detail?: string} | null; auto: {versions: string[]; version: string | null; enabled: boolean}};
/** 一次投递的结果（手动发送、输入框）。 */
export type DeliveryData = {result: NotifyResult; code: string | null; message: string};
export type ScreenData = {paneId: string; sessionKey: string; agent: string | null; status: string; focused: boolean; screen: string};
/** omp 的更早输出（t12，手机的文字视图）：`agent.read` 的 `recent_unwrapped` 最近 `lines` 行。 */
export type HistoryData = {paneId: string; sessionKey: string; lines: number; text: string};

/** 经 nbdev 起的一份服务（t14，`run/procs/` 的登记加现算的状态；格式见 docs/file-formats.md）。 */
export type ProcRunView = {
    runId: string; checkout: string; checkoutKey: string; package: string; script: string; logPath: string; startedAt: string;
    startedBy: {key: string; agent: string; label: string | null} | null; workId: string | null; taskId: string | null;
    url: string | null; readyAt: string | null; lastProbeStatus: number | null; endedAt: string | null; exitCode: number | null; signal: string | null;
    state: "starting" | "running" | "orphaned" | "ended"; reason: string | null; supervisorAlive: boolean;
};
export type RunsData = {procs: ProcRunView[]; sessions: Array<{key: string; agent: string; label: string | null; alive: boolean | null; runs: RunView[]}>; unownedRuns: RunView[]; sessionTitles: Record<string, SessionTitle>};
/** `tracked` 已跟踪的改动、`untracked` 未跟踪的条数；`timedOut` 时计数都是 null（t15 阶段 4 第 4 批）。`tasks` 是它是哪些 Task 的（`home` 加目录名认出的）。 */
export type CheckoutRow = {
    key: string; root: string; branch: string | null; head: string; isMain: boolean; executionOf: string[]; homeOf: Array<{workId: string; taskId: string}>; tasks: Array<{workId: string; taskId: string}>;
    runs: Array<{runId: string; package: string; script: string; state: string; url: string | null}>;
    tracked: number | null; untracked: number | null; ahead: number | null; behind: number | null; error: string | null; timedOut: boolean; at: string;
};
export type CheckoutFilesData = {key: string; staged: Array<{path: string; code: string}>; unstaged: Array<{path: string; code: string}>; untracked: string[]; truncated: boolean; timedOut: boolean; error: string | null};
export type DocDiffData = {checkout: {key: string; branch: string | null; isMain: boolean}; path: string; change: "added" | "modified" | "deleted" | "master_only" | null; mergeBase: string | null; text: string};
export type CheckoutsData = {checkouts: CheckoutRow[]};
export type CheckSummary = {success: number; failure: number; pending: number; failed: Array<{name: string; workflow: string | null; url: string | null}>};
export type PrView = {number: number; title: string; branch: string; draft: boolean; reviewDecision: string | null; updatedAt: string; url: string | null; checks: CheckSummary; task: {workId: string; taskId: string} | null};
export type IssueView = {number: number; title: string; labels: string[]; updatedAt: string; url: string | null};
export type GithubData = {state: "idle" | "ok" | "stale" | "unavailable" | "not_logged_in" | "error"; at: string | null; error: string | null; refreshing: boolean; prs: PrView[]; issues: IssueView[]; truncated: {prs: boolean; issues: boolean}};
