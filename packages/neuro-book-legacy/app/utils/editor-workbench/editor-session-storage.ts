/**
 * 编辑工作台会话的**专用存储会话**：把分组拓扑（grid 快照）+ 逐组标签实例 + 活动组写进
 * `workbench.editor/session`（project/local）或 `workbench.editor/user-assets-session`（user/local），
 * 并在进入工作面时恢复。两条定义各自读写，**互不 fallback**：没有 Project 上下文时既不读也不写 Project 记录。
 *
 * 为什么不直接把整组对象交给 `createLayoutRecordSession`：那条通用会话的 compose 没有"前提失败"分类，
 * 冲突重读后 `changed:false` 会被当成 saved，而编辑会话需要三向核对（待存意图 / 本地原基线 / 远端现值）——
 * 只有前两者之一命中才允许推进，否则必须停在冲突上等人裁决。这里因此复用同一套底层设施
 * （`createWorkbenchStorageContext` 的工作面接线、`StorageOwnerHandle` 的条件读写与订阅、
 * `projectStorageState` 的读取分类、`isStorageAdapterError` 的失败分类），只把编辑领域的语义写实。
 *
 * 可见语义（与 `docs/specs/storage/persistence.md`「编辑记录的保存、冲突和失败」一致）：
 *
 * 1. **提交触发**：`editorSessionRevision` 超过本地基线就提交一次；同一 tick 内多次变化合并成一次条件保存
 *    （组集合与树在一条记录里，不会出现"组已落盘、树还没有"）。正文输入与尺寸测量都不推进该修订。
 * 2. **序列化提交**：同一时刻只有一条在途写入；回执确认只把基线推进到**已提交快照**，
 *    在途期间产生的更新意图不被旧回执清除。
 * 3. **首读门禁**：读到分类之前 `ready` 为 false，提交是空操作；不自动创建默认记录
 *    （`missing`/`deleted` 保持"无记录"，本地编辑照常，第一次明确会话动作才条件创建）。
 * 4. **恢复**：记录有值时以它为分组/标签位置真相并记基线（恢复本身不触发提交）；记录损坏或版本未知时保留原件、
 *    禁止普通覆盖；`workspaceBuffers` 里有未保存内容却不在记录中的文档追加到活动组，不因采用远端布局丢稿。
 * 5. **冲突出口**：条件保存失败保留当前本地布局与 `conflict` 提示，不自动重放整棵树；
 *    `retry()` 重读核对，`adoptSaved()` / `overwriteWithSaved()` 是两条显式裁决路径。
 * 6. **未知字段保留**：合成以当前读取原件为底本，存活对象的未知字段原样带过（见 `editor-session-record.ts`）。
 * 7. **切工作面**：`surface()` 变化即重新接线、重读、重订阅；未开项目（`idle`）不碰任何记录。
 * 8. **`flush()`**：等待在途提交落地并处置尚未尝试的意图，返回"是否全部确认"。
 */

import {computed, onScopeDispose, ref, toValue, watch, type ComputedRef, type MaybeRefOrGetter, type Ref} from "vue";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {isStorageAdapterError} from "nbook/app/utils/storage/value-transport";
import {
    createWorkbenchStorageContext,
    type WorkbenchStorageAdapters,
    type WorkbenchStorageOwnerHandle,
    type WorkbenchStorageOwnerResult,
} from "nbook/app/utils/workbench/storage-context";
import type {WorkbenchLayoutSurface} from "nbook/app/utils/workbench/layout-session";
import {restoreEditorSession} from "nbook/app/utils/editor-workbench/editor-session";
import {
    composeEditorSessionRecord,
    editorSessionRecordOf,
    recoverEditorSession,
    sameEditorSessionRecord,
    type EditorSessionRecoveryFacts,
} from "nbook/app/utils/editor-workbench/editor-session-record";
import {
    defineWorkbenchEditorSessionState,
    defineWorkbenchEditorUserAssetsSessionState,
    WORKBENCH_EDITOR_OWNER,
    type WorkbenchEditorSessionRecord,
} from "nbook/shared/storage/workbench-editor";
import type {StorageCredential, StorageReadResult} from "nbook/shared/storage/contract";
import type {DefinedStorageState} from "nbook/shared/storage/definition";
import {projectStorageState} from "nbook/shared/storage/projection";

/**
 * 编辑会话存储的提示。四类各自回答一个问题：
 * - `unsaved`     已经形成的本地布局没有写进记录（结果未确认、句柄不可用、恢复期补齐的本地补充）；
 * - `conflict`    条件保存失败：远端已是另一个布局。三个出口由 `retryable` / `overwritable` 表达，不自动覆盖；
 * - `protected`   记录损坏 / 版本未知 / 布局无法恢复：原记录保留，**禁止普通覆盖**；
 * - `unavailable` 句柄或首读不可用：本次工作面的布局只在本窗口，可重读。
 */
export type EditorSessionStorageNotice =
    | {kind: "unsaved"; diagnosis: string; retryable: boolean}
    | {kind: "conflict"; diagnosis: string; retryable: boolean; overwritable: boolean}
    | {kind: "protected"; diagnosis: string; retryable: boolean}
    | {kind: "unavailable"; diagnosis: string; retryable: boolean};

export type EditorSessionStorageOptions = {
    /** 当前工作台工作面；页面传 `workbenchLayoutSurface`，组合函数在切换时重读/重订阅。 */
    readonly surface: MaybeRefOrGetter<WorkbenchLayoutSurface>;
    /** 测试注入的 Storage 适配器。 */
    readonly adapters?: WorkbenchStorageAdapters;
};

export type EditorSessionStorageConsumer = {
    /** 首读门禁：读到分类之前为 false，页面据此禁用编辑组拓扑调整（此时提交是空操作）。 */
    readonly ready: ComputedRef<boolean>;
    /** 当前要展示的提示；`null` 表示没有要交代的问题。 */
    readonly notice: Ref<EditorSessionStorageNotice | null>;
    /** 恢复期问题（过滤的失效标签、追加的未保存文档、订阅故障），供页面诊断呈现。 */
    readonly issues: Ref<readonly string[]>;
    /** 进入工作面：读取 + 恢复 + 记基线。同一工作面的重复调用合并成一次。 */
    initialize(): Promise<void>;
    /** 重读核对：远端已等于待存意图 ⇒ 确认；仍等于本地原基线 ⇒ 用新凭据重提一次；否则继续冲突。 */
    retry(): Promise<void>;
    /** 采用已保存布局（保留 dirty 缓冲）；未解决输入冲突时停手，保留本次裁决入口。 */
    adoptSaved(): Promise<void>;
    /** 以本窗口布局覆盖记录（页面负责先向用户确认）；保护态拒绝执行并保留提示。 */
    overwriteWithSaved(): Promise<void>;
    /** 放弃本窗口未确认意图（不清 dirty 正文）。 */
    abandon(): void;
    /** 处置尚未确认的提交：等待在途落地并重试一次尚未尝试的意图，返回是否全部确认。 */
    flush(): Promise<boolean>;
};

/** 一次工作面的记录接线；`idle` 没有任何记录。 */
type EditorRecordBinding = {
    readonly definition: DefinedStorageState<WorkbenchEditorSessionRecord>;
    readonly handle: WorkbenchStorageOwnerHandle;
};

/** 本窗口呈现据以建立的原件与它的条件凭据；`original` 为 `null` 表示读取时记录缺失/已删除。 */
type EditorRecordBaseline = {
    readonly original: WorkbenchEditorSessionRecord | null;
    readonly credential: StorageCredential;
};

type EditorRecordBlocker = {readonly kind: "protected" | "unavailable"; readonly diagnosis: string};

/**
 * 写入失败分类，与 `layout-session.ts:classifyLayoutFailure`、`owner-handle.ts:TERMINAL_STORAGE_CODES`
 * 同一口径（两者都未导出）。条件冲突只停在冲突上；句柄/访问失效是终止态，需要重新接线。
 */
const TERMINAL_STORAGE_CODES: Record<string, true> = {
    STORAGE_CONTEXT_INVALID: true,
    STORAGE_CLIENT_CREDENTIAL_INVALID: true,
    STORAGE_CREDENTIAL_STALE: true,
    STORAGE_HANDLE_CLOSED: true,
    STORAGE_SERVICE_CLOSED: true,
};

const REVISION_CONFLICT_CODE = "STORAGE_REVISION_CONFLICT";

/** 服务端按普通保存策略拒绝写入的记录（损坏、未知版本、待迁移）：与读取分类同一处置——保留原件。 */
const PROTECTED_STORAGE_CODES: Record<string, true> = {
    STORAGE_WRITE_BLOCKED: true,
};

type StorageFailureReading = {
    readonly conflict: boolean;
    readonly terminal: boolean;
    readonly protected: boolean;
    /** 提交事实：`true` 已提交、`false` 明确拒绝、`null` 未确认（超时/断线）。 */
    readonly committed: boolean | null;
    readonly diagnosis: string;
};

function classifyStorageFailure(error: unknown): StorageFailureReading {
    const message = error instanceof Error ? error.message : String(error);
    const unavailable = typeof error === "object" && error !== null
        ? (error as {readonly storageContextUnavailable?: {readonly status?: unknown}}).storageContextUnavailable
        : undefined;
    if (unavailable?.status === "unavailable") {
        return {
            conflict: false,
            terminal: true,
            protected: false,
            committed: false,
            diagnosis: `Storage 句柄已失效，不再接受编辑会话提交：${message}`,
        };
    }
    if (isStorageAdapterError(error)) {
        return {
            conflict: error.code === REVISION_CONFLICT_CODE,
            terminal: error.code !== null && TERMINAL_STORAGE_CODES[error.code] === true,
            protected: error.code !== null && PROTECTED_STORAGE_CODES[error.code] === true,
            committed: error.committed,
            diagnosis: message,
        };
    }
    return {conflict: false, terminal: false, protected: false, committed: null, diagnosis: message};
}

function failureMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** 工作面标识：Project 按精确 ready 代次区分（同路径重开也是新记录会话）。 */
function surfaceIdentity(surface: WorkbenchLayoutSurface): string {
    switch (surface.kind) {
        case "project":
            return `project:${surface.ready.projectRoot}@${surface.ready.publicId}@${String(surface.ready.revision ?? "")}`;
        case "user-assets":
            return "user-assets";
        case "idle":
            return "idle";
    }
}

export function useEditorSessionStorage(options: EditorSessionStorageOptions): EditorSessionStorageConsumer {
    const store = useNovelIdeStore();
    const context = createWorkbenchStorageContext(options.adapters === undefined ? {} : {adapters: options.adapters});
    const phase = ref<"idle" | "loading" | "ready">("idle");
    const notice = ref<EditorSessionStorageNotice | null>(null);
    const issues = ref<readonly string[]>([]);

    let binding: EditorRecordBinding | null = null;
    let baseline: EditorRecordBaseline | null = null;
    let blocker: EditorRecordBlocker | null = null;
    let subscription: {close(): Promise<void>} | null = null;
    let conflictDiagnosis: string | null = null;
    let saveDiagnosis: string | null = null;
    let recoveryDiagnosis: string | null = null;
    /** 最近一次观察到的确认记录（订阅/重读都推进它）：只用于核对与诊断，**不**作为写盘凭据。 */
    let observed: {value: WorkbenchEditorSessionRecord; credential: StorageCredential} | null = null;
    /** 已确认的本地会话修订：超过它就是尚未确认的意图。 */
    let committedRevision = 0;
    let surfaceGeneration = 0;
    let enteredKey: string | null = null;
    let enteringKey: string | null = null;
    let entering: Promise<void> = Promise.resolve();
    let inFlight: Promise<void> | null = null;
    /** 恢复期标志：接线/采用远端布局期间的激活与规范化推进修订，但不是新的用户意图。 */
    let restoring = false;
    let released = false;

    const publish = (): void => {
        if (blocker !== null) {
            notice.value = {kind: blocker.kind, diagnosis: blocker.diagnosis, retryable: blocker.kind === "unavailable"};
            return;
        }
        if (conflictDiagnosis !== null) {
            notice.value = {kind: "conflict", diagnosis: conflictDiagnosis, retryable: true, overwritable: true};
            return;
        }
        if (saveDiagnosis !== null) {
            notice.value = {kind: "unsaved", diagnosis: saveDiagnosis, retryable: binding !== null};
            return;
        }
        notice.value = recoveryDiagnosis === null
            ? null
            : {kind: "unsaved", diagnosis: recoveryDiagnosis, retryable: true};
    };

    /** 当前会话的候选记录：修订与快照在同一同步块里取，两者描述同一次会话状态。 */
    const sessionRecord = () => {
        const snapshot = store.readEditorSessionSnapshot();
        return editorSessionRecordOf(snapshot.state, snapshot.grid);
    };

    const hasIntent = (): boolean => store.editorSessionRevision > committedRevision;

    const currentIntent = (): WorkbenchEditorSessionRecord | null =>
        hasIntent() && baseline !== null ? composeEditorSessionRecord(baseline.original, sessionRecord()) : null;

    /** 写盘前提：首读已分类、没有保护/不可用阻断、有句柄与凭据、且不在恢复期。 */
    const writable = (): boolean =>
        !released && !restoring && phase.value === "ready" && blocker === null && binding !== null && baseline !== null;

    /** 宿主事实：正文缓冲（唯一正文权威）与已加载的文件树。 */
    const recoveryFacts = (): EditorSessionRecoveryFacts => {
        const buffers: Record<string, {title: string; dirty: boolean}> = {};
        for (const [path, buffer] of Object.entries(store.workspaceBuffers)) {
            buffers[path] = {title: buffer.node.title, dirty: buffer.content !== buffer.lastSyncedContent};
        }
        return {buffers};
    };

    const closeSubscription = (): void => {
        const closing = subscription;
        subscription = null;
        if (closing === null) {
            return;
        }
        void closing.close().catch((error: unknown) => {
            issues.value = [...issues.value, `关闭编辑记录订阅失败：${failureMessage(error)}`];
        });
    };

    /** 保护态：原记录保留，普通覆盖（含"以本窗口布局覆盖"）一律拒绝。 */
    const blockProtected = (snapshot: StorageReadResult<WorkbenchEditorSessionRecord>): void => {
        const definition = binding?.definition;
        const projected = definition === undefined ? null : projectStorageState(definition, snapshot);
        blocker = {
            kind: "protected",
            diagnosis: `${projected?.diagnosis ?? "编辑记录不可普通保存"}；原记录保留，禁止普通覆盖`,
        };
        baseline = null;
        observed = null;
        conflictDiagnosis = null;
        saveDiagnosis = null;
        phase.value = "ready";
        publish();
    };

    /**
     * 采用记录里的布局：恢复树与组集合，按缓冲与文件树过滤失效标签、补回未保存文档，
     * 随后按需读取每组活动文档（非活动标签不预读），最后把当前状态记为基线（恢复本身不触发提交）。
     */
    const presentRecordLayout = async (
        value: WorkbenchEditorSessionRecord,
        credential: StorageCredential,
        generation: number,
    ): Promise<void> => {
        const restored = restoreEditorSession(value);
        if (!restored.ok) {
            blocker = {kind: "protected", diagnosis: `编辑记录的布局无法恢复（${restored.reason}）：原记录保留，禁止普通覆盖`};
            baseline = null;
            observed = null;
            issues.value = restored.issues;
            phase.value = "ready";
            publish();
            return;
        }
        const recovery = recoverEditorSession(restored, recoveryFacts());
        store.replaceEditorSession({state: recovery.state, grid: recovery.grid});
        committedRevision = store.editorSessionRevision;
        baseline = {original: value, credential};
        observed = {value, credential};
        blocker = null;
        conflictDiagnosis = null;
        saveDiagnosis = null;
        recoveryDiagnosis = recovery.appended.length === 0
            ? null
            : `记录未引用 ${String(recovery.appended.length)} 个有未保存内容的文档，已追加到活动组：${recovery.appended.join("、")}`;
        issues.value = recovery.issues;
        phase.value = "ready";
        publish();

        const presented = sessionRecord();
        restoring = true;
        try {
            for (const group of store.editorGroups) {
                if (generation !== surfaceGeneration || released) {
                    return;
                }
                const path = group.activePath;
                if (!path || store.workspaceBuffers[path]) {
                    continue;
                }
                // 按记录里的标签实例模式打开：preview 标签若按 permanent 读入，激活会把记录里的 preview 标记抹掉，
                // 恢复就会平白产生一次写入。
                const preview = group.tabs.find((tab) => tab.path === path)?.preview === true;
                try {
                    await store.selectWorkspacePathInGroup(group.id, path, preview ? "preview" : "permanent");
                } catch (error) {
                    issues.value = [...issues.value, `组 ${group.id} 的活动文档读取失败：${failureMessage(error)}`];
                }
            }
        } finally {
            restoring = false;
            if (sameEditorSessionRecord(sessionRecord(), presented)) {
                // 读取活动文档会激活标签并推进修订；呈现仍等于刚发布的那份 ⇒ 这就是同一次恢复，不构成新意图。
                committedRevision = store.editorSessionRevision;
            } else {
                // 恢复窗口内出现了真实变化（用户改了拓扑）：补一次提交，别让它等到下一次变化才落盘。
                void runSubmit();
            }
            publish();
        }
    };

    /** 读取分类：有值 ⇒ 采用记录布局；缺失/删除 ⇒ 保持本窗口呈现且不写默认值；其余 ⇒ 保护原件。 */
    const applyReadResult = (
        snapshot: StorageReadResult<WorkbenchEditorSessionRecord>,
        generation: number,
    ): Promise<void> | void => {
        switch (snapshot.kind) {
            case "value":
                return presentRecordLayout(snapshot.value, snapshot.credential, generation);
            case "missing":
            case "deleted":
                committedRevision = store.editorSessionRevision;
                baseline = {original: null, credential: snapshot.credential};
                observed = null;
                blocker = null;
                conflictDiagnosis = null;
                saveDiagnosis = null;
                recoveryDiagnosis = null;
                phase.value = "ready";
                publish();
                return;
            case "legacy-value":
            case "unsupported-version":
            case "corrupt":
                blockProtected(snapshot);
                return;
        }
    };

    const openSubscription = async (current: EditorRecordBinding, generation: number): Promise<void> => {
        try {
            const opened = await current.handle.subscribe(current.definition, {
                onUpdate: (snapshot) => {
                    if (generation !== surfaceGeneration || released) {
                        return;
                    }
                    // 外来的确认记录只推进"最近观察到的值"：不替换本窗口呈现，也不把新凭据交给基于旧布局的整记录覆盖。
                    if (snapshot.kind === "value") {
                        observed = {value: snapshot.value, credential: snapshot.credential};
                        confirmObservedIntent();
                    }
                },
                onError: (error) => {
                    if (generation !== surfaceGeneration || released) {
                        return;
                    }
                    issues.value = [...issues.value, `编辑记录的订阅故障：${failureMessage(error)}`];
                },
            });
            if (generation !== surfaceGeneration || released) {
                await opened.close();
                return;
            }
            subscription = opened;
        } catch (error) {
            issues.value = [...issues.value, `建立编辑记录订阅失败：${failureMessage(error)}`];
        }
    };

    /**
     * 未确认写入的自愈：订阅看到远端已经等于本窗口待存意图时确认为已保存。
     * 只确认、绝不用订阅凭据写盘，因此不会把"别人改过的记录"当成可以覆盖的授权。
     */
    const confirmObservedIntent = (): void => {
        const current = observed;
        const intent = currentIntent();
        if (current === null || intent === null || !sameEditorSessionRecord(current.value, intent)) {
            return;
        }
        baseline = {original: current.value, credential: current.credential};
        committedRevision = store.editorSessionRevision;
        conflictDiagnosis = null;
        saveDiagnosis = null;
        recoveryDiagnosis = null;
        publish();
    };

    /** 接线当前工作面：进入 Storage 上下文 → 读记录 → 分类恢复 → 订阅。 */
    const enterSurface = async (surface: WorkbenchLayoutSurface, generation: number): Promise<void> => {
        const accepting = (): boolean => generation === surfaceGeneration && !released;
        closeSubscription();
        binding = null;
        baseline = null;
        observed = null;
        blocker = null;
        conflictDiagnosis = null;
        saveDiagnosis = null;
        recoveryDiagnosis = null;
        issues.value = [];

        if (surface.kind === "idle") {
            // 未开项目：没有记录工作面，本窗口呈现即基线；不读 Project 记录，也不用 user-assets 记录兜底。
            committedRevision = store.editorSessionRevision;
            phase.value = "ready";
            publish();
            return;
        }

        phase.value = "loading";
        publish();
        const ready = surface.kind === "project" ? surface.ready : null;
        if (surface.kind === "project" && (!ready?.projectRoot || !ready?.publicId)) {
            blocker = {kind: "unavailable", diagnosis: "Project 工作面缺少可定位的 ready（projectRoot/publicId），未读取编辑记录"};
            phase.value = "ready";
            publish();
            return;
        }

        const definition = surface.kind === "user-assets"
            ? defineWorkbenchEditorUserAssetsSessionState()
            : defineWorkbenchEditorSessionState();
        let owned: WorkbenchStorageOwnerResult;
        try {
            if (surface.kind === "user-assets") {
                await context.enterUserSurface("user-assets");
                owned = await context.userOwner(WORKBENCH_EDITOR_OWNER);
            } else {
                await context.enterProject(ready!);
                owned = await context.projectOwner(WORKBENCH_EDITOR_OWNER);
            }
        } catch (error) {
            if (!accepting()) {
                return;
            }
            blocker = {kind: "unavailable", diagnosis: `编辑记录的工作面接线失败：${failureMessage(error)}`};
            phase.value = "ready";
            publish();
            return;
        }
        if (!accepting()) {
            return;
        }
        if (owned.status !== "ready") {
            blocker = {kind: "unavailable", diagnosis: owned.diagnosis};
            phase.value = "ready";
            publish();
            return;
        }

        const current: EditorRecordBinding = {definition, handle: owned.handle};
        binding = current;
        let snapshot: StorageReadResult<WorkbenchEditorSessionRecord>;
        try {
            snapshot = await current.handle.read(definition);
        } catch (error) {
            if (!accepting()) {
                return;
            }
            blocker = {kind: "unavailable", diagnosis: `读取编辑记录失败，本次工作面的布局只在本窗口：${failureMessage(error)}`};
            phase.value = "ready";
            publish();
            return;
        }
        if (!accepting()) {
            return;
        }
        await applyReadResult(snapshot, generation);
        if (!accepting()) {
            return;
        }
        await openSubscription(current, generation);
    };

    /**
     * 进入工作面。同一工作面的重复调用合并成一次（页面 `onMounted` 与 surface 变化都会走到这里），
     * 只有工作面标识变化或上一次接线没能读到分类时才重新接线。
     */
    const initialize = async (): Promise<void> => {
        if (released) {
            return;
        }
        const surface = toValue(options.surface);
        const key = surfaceIdentity(surface);
        if (key === enteredKey && (enteringKey === key || phase.value === "ready")) {
            await entering;
            return;
        }
        enteredKey = key;
        enteringKey = key;
        const generation = ++surfaceGeneration;
        const run = enterSurface(surface, generation);
        entering = run;
        try {
            await run;
        } finally {
            if (entering === run) {
                enteringKey = null;
            }
        }
    };

    /** 提交循环：修订超过基线就条件保存一次；回执只把基线推进到**已提交快照**。 */
    const submitLoop = async (): Promise<void> => {
        while (writable()) {
            const revision = store.editorSessionRevision;
            if (revision <= committedRevision) {
                return;
            }
            const current = binding!;
            const expected = baseline!;
            const next = composeEditorSessionRecord(expected.original, sessionRecord());
            if (expected.original !== null && sameEditorSessionRecord(next, expected.original)) {
                // 记录已经等于当前会话（例如恢复期把标签规范化了一遍，或用户撤回了改动）：没有要写的东西。
                committedRevision = revision;
                conflictDiagnosis = null;
                saveDiagnosis = null;
                recoveryDiagnosis = null;
                publish();
                continue;
            }
            try {
                const credential = await current.handle.save(current.definition, {expected: expected.credential, value: next});
                baseline = {original: next, credential};
                observed = {value: next, credential};
                committedRevision = revision;
                conflictDiagnosis = null;
                saveDiagnosis = null;
                recoveryDiagnosis = null;
                publish();
            } catch (error) {
                const failure = classifyStorageFailure(error);
                if (failure.conflict) {
                    // 条件保存失败：保留当前本地布局与未确认标记，**不自动重放整棵树**。
                    conflictDiagnosis = `${failure.diagnosis}；本窗口布局没有保存，也不会自动覆盖其它窗口的布局`;
                    publish();
                    return;
                }
                if (failure.protected) {
                    // 服务端按普通保存策略拒绝（损坏 / 未知版本 / 待迁移）：与读取分类同一处置，保留原件。
                    blocker = {kind: "protected", diagnosis: `${failure.diagnosis}；原记录保留，禁止普通覆盖`};
                    baseline = null;
                    publish();
                    return;
                }
                if (failure.terminal) {
                    blocker = {kind: "unavailable", diagnosis: failure.diagnosis};
                    // 句柄成了终止态：下一次重试要走重新接线，而不是继续用这个句柄。
                    enteredKey = null;
                    publish();
                    return;
                }
                if (failure.committed === null) {
                    saveDiagnosis = `${failure.diagnosis}；保存结果未确认，重读核对前不谎报成功或失败`;
                    publish();
                    return;
                }
                saveDiagnosis = failure.diagnosis;
                publish();
                return;
            }
        }
    };

    const runSubmit = (): Promise<void> => {
        inFlight ??= (async () => {
            try {
                await submitLoop();
            } finally {
                inFlight = null;
            }
        })();
        return inFlight;
    };

    /**
     * 重读核对（冲突 / 结果未确认）：
     * - 远端已等于待存意图 ⇒ 确认（旧回执丢失也不需要再写一次）；
     * - 远端仍等于本地原基线 ⇒ 只是凭据/分区代次变了，用刚读取的凭据重提一次；
     * - 其余 ⇒ 继续冲突，等人显式裁决。
     */
    const reconcile = async (): Promise<void> => {
        const current = binding;
        if (current === null) {
            return;
        }
        let snapshot: StorageReadResult<WorkbenchEditorSessionRecord>;
        try {
            snapshot = await current.handle.read(current.definition);
        } catch (error) {
            blocker = {kind: "unavailable", diagnosis: `重读编辑记录失败：${failureMessage(error)}`};
            publish();
            return;
        }
        if (snapshot.kind === "value") {
            const intent = currentIntent();
            if (intent !== null && sameEditorSessionRecord(snapshot.value, intent)) {
                baseline = {original: snapshot.value, credential: snapshot.credential};
                observed = {value: snapshot.value, credential: snapshot.credential};
                committedRevision = store.editorSessionRevision;
                conflictDiagnosis = null;
                saveDiagnosis = null;
                recoveryDiagnosis = null;
                publish();
                return;
            }
            if (intent === null) {
                // 没有待存意图：冲突/未确认的诊断不再成立；呈现保持本窗口的，不静默采用远端布局。
                observed = {value: snapshot.value, credential: snapshot.credential};
                conflictDiagnosis = null;
                saveDiagnosis = null;
                publish();
                return;
            }
            if (baseline !== null && baseline.original !== null && sameEditorSessionRecord(snapshot.value, baseline.original)) {
                baseline = {original: snapshot.value, credential: snapshot.credential};
                observed = {value: snapshot.value, credential: snapshot.credential};
                conflictDiagnosis = null;
                saveDiagnosis = null;
                publish();
                await runSubmit();
                return;
            }
            conflictDiagnosis = `远端记录仍是另一个布局（revision ${String(snapshot.credential.revision ?? "空")}）；本窗口布局没有保存，也不会自动覆盖`;
            publish();
            return;
        }
        if (snapshot.kind === "missing" || snapshot.kind === "deleted") {
            if (currentIntent() !== null) {
                conflictDiagnosis = "远端编辑记录已被删除；本窗口布局没有保存，也不会自动重建";
                publish();
                return;
            }
            baseline = {original: null, credential: snapshot.credential};
            observed = null;
            conflictDiagnosis = null;
            saveDiagnosis = null;
            publish();
            return;
        }
        blockProtected(snapshot);
    };

    /** 保护态下的重读：只有确实变回可读值才继续（修复由 owner/迁移负责），否则保持保护提示。 */
    const rereadProtected = async (): Promise<void> => {
        const current = binding;
        if (current === null) {
            return;
        }
        let snapshot: StorageReadResult<WorkbenchEditorSessionRecord>;
        try {
            snapshot = await current.handle.read(current.definition);
        } catch (error) {
            blocker = {kind: "unavailable", diagnosis: `重读编辑记录失败：${failureMessage(error)}`};
            publish();
            return;
        }
        await applyReadResult(snapshot, surfaceGeneration);
    };

    const consumer: EditorSessionStorageConsumer = {
        ready: computed(() => phase.value === "ready"),
        notice,
        issues,

        initialize,

        async retry(): Promise<void> {
            await entering;
            if (released || toValue(options.surface).kind === "idle") {
                return;
            }
            if (binding === null || blocker?.kind === "unavailable") {
                // 句柄不可用/已成终止态：重新接线（含重读）；仍然只读当前工作面的那条记录。
                enteredKey = null;
                await initialize();
                return;
            }
            if (blocker?.kind === "protected") {
                await rereadProtected();
                return;
            }
            await reconcile();
        },

        async adoptSaved(): Promise<void> {
            await entering;
            if (released || toValue(options.surface).kind === "idle") {
                return;
            }
            if (blocker?.kind === "protected") {
                // 记录被保护：没有可采用的"已保存布局"，保护提示保留。
                publish();
                return;
            }
            if (store.flushEditorPending() !== "settled") {
                // 未解决输入：停手并保留本次裁决入口，不用布局替换掩盖输入冲突。
                return;
            }
            const current = binding;
            if (current === null) {
                return;
            }
            let snapshot: StorageReadResult<WorkbenchEditorSessionRecord>;
            try {
                snapshot = await current.handle.read(current.definition);
            } catch (error) {
                blocker = {kind: "unavailable", diagnosis: `采用已保存布局失败：${failureMessage(error)}`};
                publish();
                return;
            }
            if (snapshot.kind === "value") {
                await presentRecordLayout(snapshot.value, snapshot.credential, surfaceGeneration);
                return;
            }
            if (snapshot.kind === "missing" || snapshot.kind === "deleted") {
                saveDiagnosis = "远端没有已保存的编辑布局，无法采用；本窗口布局仍然只在本窗口";
                publish();
                return;
            }
            blockProtected(snapshot);
        },

        async overwriteWithSaved(): Promise<void> {
            await entering;
            if (released || toValue(options.surface).kind === "idle") {
                return;
            }
            // 保护态（损坏 / 未知版本 / 布局无法恢复）：拒绝覆盖并保留提示，不接受"强行写回"绕过保护。
            if (blocker !== null || binding === null) {
                publish();
                return;
            }
            if (store.flushEditorPending() !== "settled") {
                // 未解决输入：停手并保留本次裁决入口。
                return;
            }
            const current = binding;
            let snapshot: StorageReadResult<WorkbenchEditorSessionRecord>;
            try {
                snapshot = await current.handle.read(current.definition);
            } catch (error) {
                blocker = {kind: "unavailable", diagnosis: `覆盖编辑记录前重读失败：${failureMessage(error)}`};
                publish();
                return;
            }
            if (snapshot.kind !== "value" && snapshot.kind !== "missing" && snapshot.kind !== "deleted") {
                blockProtected(snapshot);
                return;
            }
            // 覆盖也只在"刚读取的凭据"上提交一次：保留原件里存活对象的未知字段，仍然不做自动重放。
            const next = composeEditorSessionRecord(snapshot.kind === "value" ? snapshot.value : null, sessionRecord());
            try {
                const credential = await current.handle.save(current.definition, {expected: snapshot.credential, value: next});
                baseline = {original: next, credential};
                observed = {value: next, credential};
                committedRevision = store.editorSessionRevision;
                conflictDiagnosis = null;
                saveDiagnosis = null;
                recoveryDiagnosis = null;
                publish();
            } catch (error) {
                const failure = classifyStorageFailure(error);
                if (failure.conflict) {
                    conflictDiagnosis = `${failure.diagnosis}；覆盖提交再次冲突，本窗口布局未保存`;
                    publish();
                    return;
                }
                if (failure.protected) {
                    blocker = {kind: "protected", diagnosis: `${failure.diagnosis}；原记录保留，禁止普通覆盖`};
                    baseline = null;
                    publish();
                    return;
                }
                if (failure.terminal) {
                    blocker = {kind: "unavailable", diagnosis: failure.diagnosis};
                    enteredKey = null;
                    publish();
                    return;
                }
                saveDiagnosis = failure.diagnosis;
                publish();
            }
        },

        abandon(): void {
            // 放弃未确认意图：把当前修订当作已确认，后续变化才是新的意图；dirty 正文由 Store 自己的保存流程负责。
            committedRevision = store.editorSessionRevision;
            conflictDiagnosis = null;
            saveDiagnosis = null;
            recoveryDiagnosis = null;
            publish();
        },

        async flush(): Promise<boolean> {
            await entering;
            if (inFlight !== null) {
                await inFlight;
            }
            if (hasIntent() && writable()) {
                await runSubmit();
            }
            // 没有记录工作面（未开项目）时本地拓扑改动按设计不落盘，不把"没有记录可写"报成未确认。
            return !hasIntent() || toValue(options.surface).kind === "idle";
        },
    };

    watch(() => surfaceIdentity(toValue(options.surface)), () => {
        void initialize();
    }, {immediate: true});

    // 会话提交：修订超过基线就写一次。watch 的批处理天然把同一 tick 内的多次变化合并成一次条件保存。
    watch(() => store.editorSessionRevision, () => {
        if (!hasIntent() || !writable()) {
            return;
        }
        void runSubmit();
    });

    onScopeDispose(() => {
        released = true;
        surfaceGeneration += 1;
        closeSubscription();
        void context.release();
    });

    return consumer;
}
