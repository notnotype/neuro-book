import {readdir, readFile} from "node:fs/promises";
import {resolve} from "node:path";
import type {Activity} from "../core/activity.js";
import {artifactDirPath, currentContentHash, QUESTIONS_ARTIFACT, questionStates, readArtifact, type ArtifactRef} from "../core/artifacts.js";
import {branchChangedDocs, listDocPaths, readDocDiff, readDocFile, readDocTree} from "../core/docs.js";
import {readEditableFile} from "../core/edit-ops.js";
import {readGovernanceLineLimits} from "../core/governance-limits.js";
import {guardedFile} from "../core/paths.js";
import {sha256} from "../core/transaction.js";
import {isNbdevError, systemErrorCode, type Warning} from "../core/errors.js";
import {historySource} from "./delivery.js";
import {taskReadmePath, workReadmePath} from "../core/records.js";
import type {CheckoutInfo} from "../core/repo.js";
import {withActivity, type ProjectStatus, type TaskView, type WorkView} from "../core/status.js";
import {matchRecords, topRecordMatches, type RankableRecord} from "../core/search.js";
import {readTaskDetail} from "../core/task-detail.js";
import type {PanelState} from "./state.js";

/**
 * 各接口的数据：只读缓存（记录、活动、herdr），少数按需读文件（Task 详情、产物、文档）。
 * id 参数（workId、taskId、artifactId、checkout key、version）只接受缓存里存在的值，不拿来拼路径；不存在返回 null，由路由回 404。
 */

const EMPTY_ACTIVITY: Activity = {leases: [], sessions: [], unownedRuns: [], ignoredProcesses: 0, herdr: {available: false, socketPath: null, version: null}};

export class NotReady extends Error {}

export function currentStatus(state: PanelState): {status: ProjectStatus; warnings: Warning[]} {
    const records = state.records.part.value;
    if (!records) throw new NotReady("记录还没有算出来");
    const activity = state.activity.part.value;
    return {status: withActivity(records.records, activity?.activity ?? EMPTY_ACTIVITY, null), warnings: [...records.warnings, ...(activity?.warnings ?? [])]};
}

/** 一个 Task 的待答必答题数（它各个产物的 waiting 之和）；首页与 Work 页的 Task 表同一个口径。 */
function taskWaiting(task: TaskView): number {
    return task.artifacts.reduce((sum, artifact) => sum + artifact.waiting, 0);
}

function waitingOf(work: WorkView): number {
    return [...work.artifacts, ...work.tasks.flatMap((task) => task.artifacts)].reduce((sum, artifact) => sum + artifact.waiting, 0);
}

/** 首页与左栏：Work 与 Task 的摘要、收件箱（提问者的租约是否还有效）、会话的计数。会话与运行的明细在 `/api/sessions`。 */
export function overviewView(state: PanelState): {data: unknown; warnings: Warning[]} {
    const {status, warnings} = currentStatus(state);
    const activity = state.activity.part.value?.activity ?? EMPTY_ACTIVITY;
    const validKeys = new Set(activity.leases.filter((lease) => lease.state === "valid").map((lease) => lease.session.key));
    const herdr = state.herdr.current();
    const statusCounts: Record<string, number> = {};
    for (const session of activity.sessions) {
        const name = session.herdr?.status ?? "unmanaged";
        statusCounts[name] = (statusCounts[name] ?? 0) + 1;
    }
    return {
        data: {
            works: status.works.map((work) => ({
                workId: work.workId,
                title: work.title,
                status: work.status,
                goal: work.goal,
                updated: work.updated,
                source: work.source,
                branch: work.branch,
                checkoutKey: state.keyOf(work.checkout),
                executionRule: work.executionRule,
                uncommitted: work.uncommitted,
                taskCounts: work.taskCounts,
                waiting: waitingOf(work),
                activeLeases: work.activeLeases,
                tasks: work.tasks.map((task) => ({
                    taskId: task.taskId,
                    title: task.title,
                    status: task.status,
                    updated: task.updated,
                    currentState: task.currentState,
                    source: task.source,
                    uncommitted: task.uncommitted,
                    waiting: taskWaiting(task),
                    artifactCount: task.artifacts.length,
                    leaseCount: task.leases.length,
                })),
            })),
            inbox: status.inbox.map((item) => (item.kind === "question" ? {...item, askerActive: item.askedBy === null ? null : validKeys.has(item.askedBy)} : item)),
            // Work 卡片“谁在动”与收件箱提问者的会话标题（t17）：从活动的快照里取，提问者不在活动里也有。
            sessionTitles: state.titlesFor([...status.works.flatMap((work) => work.activeLeases.map((lease) => lease.sessionKey)), ...status.inbox.map((item) => (item.kind === "question" ? item.askedBy : null))]),
            nextWorkNumber: status.nextWorkNumber,
            sessions: {total: activity.sessions.length, byStatus: statusCounts, unownedRuns: activity.unownedRuns.length, herdr: {available: herdr.available, mode: herdr.mode}},
            // 左栏“在跑”的数：经 nbdev 起、还没结束的服务加无主的运行（t14）。
            runs: (state.activity.part.value?.procs ?? []).filter((run) => run.state !== "ended").length + activity.unownedRuns.length,
        },
        warnings,
    };
}

function findWork(status: ProjectStatus, workId: string): WorkView | null {
    return status.works.find((work) => work.workId === workId) ?? null;
}

function findTask(status: ProjectStatus, workId: string, taskId: string): {work: WorkView; task: TaskView} | null {
    const work = findWork(status, workId);
    const task = work?.tasks.find((candidate) => candidate.taskId === taskId);
    return work && task ? {work, task} : null;
}

/** README 的 sha256：状态切换带它做 `expectedHash`，绑定开发者看到的那一版。读不出时为 null。 */
async function readmeHashOf(root: string, path: string): Promise<string | null> {
    const real = await guardedFile(root, path);
    return real === null ? null : sha256(await readFile(real));
}

export async function workView(state: PanelState, workId: string): Promise<{data: unknown; warnings: Warning[]} | null> {
    const {status, warnings} = currentStatus(state);
    const work = findWork(status, workId);
    if (!work) return null;
    const activity = state.activity.part.value?.activity ?? EMPTY_ACTIVITY;
    const sessions = activity.sessions.filter((session) => session.leases.some((lease) => lease.workId === workId));
    return {
        data: {
            ...work,
            checkoutKey: state.keyOf(work.checkout),
            readmeHash: await readmeHashOf(work.checkout, workReadmePath(work.workId)),
            waiting: waitingOf(work),
            tasks: work.tasks.map((task) => ({...task, checkoutKey: state.keyOf(task.checkout), waiting: taskWaiting(task)})),
            sessions: sessions.map((session) => ({key: session.key, agent: session.agent, label: session.label, alive: session.alive, herdr: session.herdr, leases: session.leases.filter((lease) => lease.workId === workId), runs: session.runs.length})),
            sessionTitles: state.titlesFor([...work.activeLeases.map((lease) => lease.sessionKey), ...sessions.map((session) => session.key)]),
        },
        warnings,
    };
}

export async function taskView(state: PanelState, workId: string, taskId: string): Promise<{data: unknown; warnings: Warning[]} | null> {
    const {status, warnings} = currentStatus(state);
    const found = findTask(status, workId, taskId);
    const records = state.records.part.value;
    if (!found || !records) return null;
    const detailWarnings: Warning[] = [];
    const detail = await readTaskDetail(state.context.mainRoot, records.transition, {workId, taskId, recordRoot: found.task.checkout}, detailWarnings);
    return {
        data: {
            task: {...found.task, checkoutKey: state.keyOf(found.task.checkout), readmeHash: await readmeHashOf(found.task.checkout, taskReadmePath(workId, taskId))},
            work: {workId: found.work.workId, title: found.work.title, source: found.work.source, branch: found.work.branch},
            detail,
            sessionTitles: state.titlesFor(found.task.leases.map((lease) => lease.sessionKey)),
        },
        warnings: [...warnings, ...detailWarnings],
    };
}

const CATEGORY: Record<string, string> = {design: "design", report: "report", review: "review", questions: "questions"};

async function evidenceCount(root: string, workId: string, taskId: string): Promise<number> {
    try {
        return (await readdir(resolve(root, `.agents/works/${workId}/tasks/${taskId}/evidences`))).length;
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT" || systemErrorCode(error) === "ENOTDIR") return 0;
        throw error;
    }
}

/** 产物页的列表：设计稿、讲解与报告、审查报告（有发布记录的与还没发布的），文档类产物，各 Task 的证据数。 */
export async function artifactsView(state: PanelState): Promise<{data: unknown; warnings: Warning[]}> {
    const {status, warnings} = currentStatus(state);
    const artifacts: unknown[] = [];
    const documents: unknown[] = [];
    const evidences: unknown[] = [];
    for (const work of status.works) {
        for (const artifact of work.artifacts) artifacts.push({workId: work.workId, taskId: null, taskTitle: null, workTitle: work.title, category: artifact.kind ? CATEGORY[artifact.kind] ?? "other" : "unpublished", ...artifact});
        for (const document of work.documents) documents.push({workId: work.workId, taskId: null, checkoutKey: state.keyOf(work.checkout), ...document});
        for (const task of work.tasks) {
            for (const artifact of task.artifacts) artifacts.push({workId: work.workId, taskId: task.taskId, taskTitle: task.title, workTitle: work.title, category: artifact.kind ? CATEGORY[artifact.kind] ?? "other" : "unpublished", ...artifact});
            for (const document of task.documents) documents.push({workId: work.workId, taskId: task.taskId, checkoutKey: state.keyOf(task.checkout), ...document});
            const count = await evidenceCount(task.checkout, work.workId, task.taskId);
            if (count > 0) evidences.push({workId: work.workId, taskId: task.taskId, taskTitle: task.title, count});
        }
    }
    return {data: {artifacts, documents, evidences}, warnings};
}

/**
 * 一个产物：题与状态、答复与确认、版本列表。产物页不按版本切换页面（页面文件不按版本保存），只切换题表；
 * iframe 指向产物来源上磁盘里的当前页面，磁盘上文件集的内容与最新一版的 contentHash 不同时标 `unpublishedChanges`
 * （没被引用的未跟踪文件不在文件集里，检查页面时留下的截图不算改动）。
 */
export async function artifactView(state: PanelState, input: {workId: string; taskId: string | null; artifactId: string; version: string | null}, artifactBase: (checkoutKey: string, path: string) => string): Promise<{data: unknown; warnings: Warning[]} | null> {
    const {status, warnings} = currentStatus(state);
    const work = findWork(status, input.workId);
    if (!work) return null;
    const owner = input.taskId === null ? work : work.tasks.find((task) => task.taskId === input.taskId) ?? null;
    if (!owner || !owner.artifacts.some((artifact) => artifact.artifactId === input.artifactId)) return null;
    const ref: ArtifactRef = {workId: work.workId, taskId: input.taskId, artifactId: input.artifactId};
    const root = owner.checkout;
    const snapshot = await readArtifact(root, ref);
    const latest = snapshot.latest;
    let version = latest?.version ?? null;
    if (input.version !== null) {
        const requested = Number(input.version);
        if (!Number.isInteger(requested) || !snapshot.versions.includes(requested)) return null;
        version = requested;
    }
    const shown = version === null ? null : version === latest?.version ? latest : (await readArtifact(root, ref, {version})).selected;
    const checkoutKey = state.keyOf(root);
    const dir = artifactDirPath(ref);
    const viewWarnings: Warning[] = [];
    let unpublishedChanges: boolean | null = false;
    if (latest?.contentHash) {
        try {
            unpublishedChanges = (await currentContentHash(root, ref, latest)) !== latest.contentHash;
        } catch (error) {
            // 产物目录里有符号链接等：算不出哈希不影响看题与答复，只是不知道有没有未发布的改动。
            if (!isNbdevError(error)) throw error;
            unpublishedChanges = null;
            viewWarnings.push({code: error.code, message: `算不出产物目录的哈希，不知道有没有未发布的改动：${error.message}`, details: error.details});
        }
    }
    const entry = latest?.entry ?? (input.artifactId === QUESTIONS_ARTIFACT ? null : "index.html");
    return {
        data: {
            ref,
            checkoutKey,
            // 答复表单只给记录在 master 上的 Task：来自分支的由核心拒写（branch_maintained_record），界面先置只读。
            source: owner.source,
            branch: owner.branch,
            versions: snapshot.versions,
            latestVersion: latest?.version ?? null,
            version,
            kind: latest?.kind ?? null,
            title: latest?.title ?? null,
            state: latest?.state ?? "unpublished",
            publishedAt: latest?.publishedAt ?? null,
            questions: shown ? questionStates(shown, snapshot.answers, snapshot.answeredVersions) : [],
            answers: snapshot.answers,
            acks: snapshot.acks,
            unpublishedChanges,
            pageUrl: entry && checkoutKey ? artifactBase(checkoutKey, `${dir}/${entry}`) : null,
            pageIsCurrent: true,
        },
        warnings: [...warnings, ...snapshot.warnings, ...viewWarnings],
    };
}

function checkoutList(state: PanelState): Array<{key: string; root: string; branch: string | null; head: string; isMain: boolean}> {
    return state.checkouts.filter((checkout) => !checkout.prunable).map((checkout) => ({key: state.keyOf(checkout.root)!, root: checkout.root, branch: checkout.branch, head: checkout.head, isMain: checkout.isMain}));
}

/** 分支改过的文档按 checkout 的 HEAD 缓存。 */
const branchDocsCache = new Map<string, Promise<Map<string, string>>>();

function branchDocs(checkout: CheckoutInfo): Promise<Map<string, string>> {
    const key = `${checkout.root}\0${checkout.head}`;
    let cached = branchDocsCache.get(key);
    if (!cached) {
        cached = branchChangedDocs(checkout.root);
        cached.catch(() => branchDocsCache.delete(key));
        branchDocsCache.set(key, cached);
    }
    return cached;
}

export async function docsTreeView(state: PanelState, checkoutKey: string): Promise<{data: unknown; warnings: Warning[]} | null> {
    const checkout = state.checkoutByKey(checkoutKey);
    if (!checkout) return null;
    const mainDocs = await listDocPaths(state.context.mainRoot);
    const tree = await readDocTree(checkout.root, checkout.isMain, mainDocs, checkout.isMain ? undefined : await branchDocs(checkout));
    return {data: {checkout: {key: checkoutKey, branch: checkout.branch, isMain: checkout.isMain}, checkouts: checkoutList(state), ...tree}, warnings: []};
}

/** 记录里能在文档视图里看的 Markdown：这个 checkout 上的 Work 与 Task README、文档类产物。 */
function recordDocuments(state: PanelState, root: string): Set<string> {
    const paths = new Set<string>();
    const records = state.records.part.value?.records;
    for (const work of records?.works ?? []) {
        if (work.checkout === root) {
            paths.add(workReadmePath(work.workId));
            for (const document of work.documents) paths.add(document.path);
        }
        for (const task of work.tasks) {
            if (task.checkout !== root) continue;
            paths.add(taskReadmePath(work.workId, task.taskId));
            for (const document of task.documents) paths.add(document.path);
        }
    }
    return paths;
}

/** 一份文档：只接受这个 checkout 的文档树或记录里列出的路径（白名单），其余返回 null（404）。 */
export async function docFileView(state: PanelState, checkoutKey: string, path: string): Promise<{data: unknown; warnings: Warning[]} | null> {
    const checkout = state.checkoutByKey(checkoutKey);
    if (!checkout) return null;
    const allowed = (await listDocPaths(checkout.root)).includes(path) || recordDocuments(state, checkout.root).has(path);
    if (!allowed) return null;
    const file = await readDocFile(checkout.root, path);
    if (!file) return null;
    const changedIn: string[] = [];
    for (const other of state.checkouts.filter((candidate) => !candidate.isMain && !candidate.prunable)) {
        if ((await branchDocs(other)).has(path)) changedIn.push(state.keyOf(other.root)!);
    }
    return {data: {checkout: {key: checkoutKey, branch: checkout.branch, isMain: checkout.isMain}, ...file, changedIn}, warnings: []};
}

/**
 * 一份文档与 master 的差异（t15 阶段 4 第 4 批）：白名单是这个 checkout 的文档树、它与 master 的差异、记录里的文档三者之并
 * （删去的与“master 才有”的文件不在文档树里，照 `/api/docs/file` 的白名单会 404）。差异的类型取自同一份文档树，两边口径一致。
 */
export async function docDiffView(state: PanelState, checkoutKey: string, path: string): Promise<{data: unknown; warnings: Warning[]} | null> {
    const checkout = state.checkoutByKey(checkoutKey);
    if (!checkout) return null;
    const mainDocs = await listDocPaths(state.context.mainRoot);
    const tree = await readDocTree(checkout.root, checkout.isMain, mainDocs, checkout.isMain ? undefined : await branchDocs(checkout));
    const change = tree.changes.find((entry) => entry.path === path)?.change ?? null;
    const allowed = change !== null || tree.docs.some((doc) => doc.path === path) || recordDocuments(state, checkout.root).has(path);
    if (!allowed) return null;
    const diff = await readDocDiff(checkout.root, state.context.mainRoot, path, change);
    return {data: {checkout: {key: checkoutKey, branch: checkout.branch, isMain: checkout.isMain}, ...diff}, warnings: []};
}

/**
 * 编辑页：主工作区里一个文件的原文、哈希、能不能编辑与原因、未提交改动；另附改过它的分支（打开时就提醒）
 * 与根级治理入口的非空行上限。白名单之外的路径返回 null（404），见 `readEditableFile`。
 */
export async function fileView(state: PanelState, path: string): Promise<{data: unknown; warnings: Warning[]} | null> {
    const file = await readEditableFile(state.context, path);
    if (!file) return null;
    const changedIn: Array<{key: string; branch: string | null}> = [];
    for (const other of state.checkouts.filter((candidate) => !candidate.isMain && !candidate.prunable)) {
        if ((await branchDocs(other)).has(path)) changedIn.push({key: state.keyOf(other.root)!, branch: other.branch});
    }
    const limits = await readGovernanceLineLimits(state.context.mainRoot);
    return {data: {...file, changedIn, lineLimit: limits?.[path] ?? null}, warnings: []};
}

/**
 * 会话页：herdr 的 pane（会话 id、Agent、状态、是否开在本仓库里、能往回翻多少行）、会话持有的租约与它的运行、无主的运行、checkout 列表。
 * pane 与会话各带 `title`（t15 阶段 4 第 3 批）：从本机 Agent 的会话文件里读，读不出为 null。t17 起取自活动快照里的标题，不在请求时查盘。
 */
export function sessionsView(state: PanelState): {data: unknown; warnings: Warning[]} {
    const herdr = state.herdr.current();
    const activity = state.activity.part.value;
    const roots = state.checkouts.filter((checkout) => !checkout.prunable).map((checkout) => checkout.root);
    const inRepo = (dir: string | null) => dir !== null && roots.some((root) => dir === root || dir.startsWith(`${root}/`));
    const titles = activity?.sessionTitles ?? {};
    const records = state.records.part.value;
    const executionOf = new Map<string, string[]>();
    for (const work of records?.records.works ?? []) {
        if (work.source !== "branch") continue;
        const key = state.keyOf(work.checkout);
        if (key) executionOf.set(key, [...(executionOf.get(key) ?? []), work.workId]);
    }
    return {
        data: {
            herdr: {available: herdr.available, mode: herdr.mode, version: herdr.version, at: herdr.at, error: herdr.error, missedEvents: herdr.missedEvents, reconnects: herdr.reconnects, retries: herdr.retries},
            panes: herdr.panes.map((pane) => ({...pane, inRepository: inRepo(pane.cwd) || inRepo(pane.foregroundCwd), history: historySource(pane), title: pane.session ? titles[`${pane.session.agent}:${pane.session.value}`] ?? null : null})),
            sessions: (activity?.activity.sessions ?? []).map((session) => ({...session, title: titles[session.key] ?? null})),
            unownedRuns: activity?.activity.unownedRuns ?? [],
            ignoredProcesses: activity?.activity.ignoredProcesses ?? 0,
            checkouts: checkoutList(state).map((checkout) => ({...checkout, executionOf: executionOf.get(checkout.key) ?? []})),
        },
        warnings: activity?.warnings ?? [],
    };
}

/** 搜索结果最前面的：缓存里 Work、Task、产物标题与会话的匹配（几乎不花成本）。 */
export function recordMatches(state: PanelState, q: string): Array<Record<string, unknown>> {
    const lower = q.toLowerCase();
    const has = (text: string | null | undefined) => typeof text === "string" && text.toLowerCase().includes(lower);
    const matches: RankableRecord[] = [...matchRecords({works: state.records.part.value?.records.works ?? []}, q)];
    for (const session of state.activity.part.value?.activity.sessions ?? []) {
        if (has(session.key) || has(session.label)) matches.push({kind: "session", key: session.key, label: session.label});
    }
    return topRecordMatches(matches, q);
}
