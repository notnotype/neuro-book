import {createPinia, defineStore, setActivePinia} from "pinia";
import {computed, effectScope, nextTick, ref, watch} from "vue";
import type {Ref} from "vue";
import {describe, expect, it, vi} from "vitest";
import type {Grid} from "@notnotype/nb-ui/layout";
import type {StorageActionRequest, StorageActionResponse} from "nbook/shared/storage/action";
import type {StorageCredential} from "nbook/shared/storage/contract";
import {StorageAdapterError, type StorageValueTransport} from "nbook/app/utils/storage/value-transport";
import {openStorageOwnerHandle} from "nbook/app/utils/storage/owner-handle";
import type {StorageProjectContextTarget} from "nbook/app/utils/storage/host-context-client";
import type {WorkbenchStorageAdapters} from "nbook/app/utils/workbench/storage-context";
import type {WorkbenchLayoutSurface} from "nbook/app/utils/workbench/layout-session";
import {createEditorGrid, editorGroupIds, splitEditorGroup} from "nbook/app/utils/editor-workbench/editor-groups";
import {
    serializeEditorSession,
    type EditorSessionState,
} from "nbook/app/utils/editor-workbench/editor-session";
import type {EditorSessionStorageConsumer} from "nbook/app/utils/editor-workbench/editor-session-storage";
import type {EditorDocumentTarget, EditorFlushResult} from "nbook/app/components/editor-workbench/editor-view.types";
import type {WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import {
    WORKBENCH_EDITOR_OWNER,
    WORKBENCH_EDITOR_SESSION_KEY,
    WORKBENCH_EDITOR_USER_ASSETS_SESSION_KEY,
    type WorkbenchEditorSessionRecord,
} from "nbook/shared/storage/workbench-editor";

/**
 * 编辑会话专用存储会话的行为：首读门禁、原子恢复、提交串行与合并、冲突三出口、订阅不改呈现、工作面隔离。
 *
 * 走真实记录通路（工作台 Storage 上下文、owner 句柄、条件读写与订阅都来自产品实现），
 * 只把传输与身份换成替身；断言的是**落盘记录内容、Store 呈现与提示**，不是替身的调用次数。
 */

/** 本文件消费的 Store 表面：Store 未导出命名的实例类型，这里只声明用到的成员，越界使用会编译失败。 */
type EditorSessionTestStore = {
    currentProjectRoot: string;
    workspaceTree: WorkspaceFileNode[];
    workspaceBuffers: Record<string, {
        node: WorkspaceFileNode;
        content: string;
        lastSyncedContent: string;
        lastSyncedMtimeMs: number | null;
        contentRevision: number;
    }>;
    editorSession: {groups: Array<{id: string; activePath: string; tabs: Array<{path: string; title: string; editorId: string | null; pinned: boolean; preview: boolean}>}>; activeGroupId: string};
    editorGroups: Array<{id: string; activePath: string; tabs: Array<{path: string; title: string; editorId: string | null; pinned: boolean; preview: boolean}>}>;
    replaceEditorSession(restored: Readonly<{state: EditorSessionState; grid: Grid<string>}>): void;
    setEditorExtent(extent: {width: number; height: number}): void;
    splitEditorTab(input: Readonly<{
        sourceGroupId: string;
        targetGroupId: string;
        newGroupId: string;
        path: string;
        direction: "left" | "right" | "top" | "bottom";
        mode: "copy" | "move";
    }>): boolean;
    selectEditorGroup(groupId: string): boolean;
    closeWorkspaceTab(groupId: string, filePath: string, discardChanges?: boolean): Promise<void>;
    editorDocumentTarget(path: string): EditorDocumentTarget;
    registerEditorFlush(target: EditorDocumentTarget, token: string, flush: () => EditorFlushResult): () => void;
};

const CLIENT_CREDENTIAL = "0123456789abcdef".repeat(4);
const READY_A = {projectRoot: "/workspace/a", publicId: "runtime-a:1", revision: 1} as const;
const SURFACE_PROJECT: WorkbenchLayoutSurface = {kind: "project", ready: READY_A};
const SURFACE_USER_ASSETS: WorkbenchLayoutSurface = {kind: "user-assets"};
const SURFACE_IDLE: WorkbenchLayoutSurface = {kind: "idle"};

type StoredKind = "value" | "legacy-value" | "deleted" | "corrupt";

type StoredRecord = {
    kind: StoredKind;
    value: unknown;
    revision: string;
    schemaVersion: number;
    diagnosis: string;
};

/** 读取闸：首读门禁测试用它把读取停在"未分类"状态。 */
type ReadGate = {readonly reads: Promise<void>; readonly release: () => void};

function readGate(): ReadGate {
    const {promise, resolve} = Promise.withResolvers<void>();
    return {reads: promise, release: resolve};
}

type Harness = {
    readonly records: Map<string, StoredRecord>;
    /** 已确认写入的记录地址（值在 `records` 里）。 */
    readonly saves: string[];
    /** 每次写入尝试（含被冲突挡回的），用于断言"没有多余重放"。 */
    readonly attempts: string[];
    readonly reads: string[];
    readonly hooks: {
        /**
         * 写入前钩子：返回错误对象时抛出它（模拟前提失败），返回 Promise 时先等它（模拟在途写入），
         * 返回 `null`/`undefined` 表示照常写入。
         */
        beforeSave: ((address: string, value: WorkbenchEditorSessionRecord) => unknown) | null;
    };
    readonly adapters: WorkbenchStorageAdapters;
    key(scope: "project" | "user", key?: string): string;
    record(scope: "project" | "user", key?: string): StoredRecord | undefined;
    value(scope: "project" | "user", key?: string): WorkbenchEditorSessionRecord;
    write(scope: "project" | "user", value: unknown, options?: {kind?: StoredKind; schemaVersion?: number; key?: string}): void;
    holdReads(): () => void;
};

const conflictError = (message = "记录已被其它窗口改写"): StorageAdapterError =>
    new StorageAdapterError({code: "STORAGE_REVISION_CONFLICT", status: 409, message, committed: false});

function storageHarness(): Harness {
    const records = new Map<string, StoredRecord>();
    const saves: string[] = [];
    const attempts: string[] = [];
    const reads: string[] = [];
    const hooks: Harness["hooks"] = {beforeSave: null};
    const gate: {current: ReadGate} = {current: {reads: Promise.resolve(), release: () => undefined}};
    let sequence = 0;
    const credential = (revision: string | null): StorageCredential => ({revision, partitionGeneration: 1});
    const address = (scope: "project" | "user", key: string): string =>
        `${scope}:${scope === "project" ? READY_A.projectRoot : "user"}/${WORKBENCH_EDITOR_OWNER}/${key}/`;

    /** 每个 scope 一份传输：记录地址里带 Project 根，切 Project 必换记录。 */
    const transportFor = (scope: "project" | "user"): StorageValueTransport => ({
        async send(action: StorageActionRequest): Promise<StorageActionResponse> {
            if (action.kind === "bind") {
                return {kind: "bind", binding: {local: 1, shared: 1}};
            }
            if (action.owner !== WORKBENCH_EDITOR_OWNER
                || (action.key !== WORKBENCH_EDITOR_SESSION_KEY && action.key !== WORKBENCH_EDITOR_USER_ASSETS_SESSION_KEY)) {
                throw new Error(`测试未登记的记录：${action.owner}/${action.key}`);
            }
            if (scope === "project" && action.key !== WORKBENCH_EDITOR_SESSION_KEY) {
                throw new Error(`Project 访问不能读 user-assets 记录：${action.key}`);
            }
            if (scope === "user" && action.key !== WORKBENCH_EDITOR_USER_ASSETS_SESSION_KEY) {
                throw new Error(`用户工作面访问不能读 Project 记录：${action.key}`);
            }
            const path = address(scope, action.key);
            if (action.kind === "read") {
                reads.push(path);
                await gate.current.reads;
                const record = records.get(path);
                if (record === undefined) {
                    return {kind: "read", result: {kind: "missing", credential: credential(null)}};
                }
                switch (record.kind) {
                    case "value":
                        return {kind: "read", result: {kind: "value", value: record.value, schemaVersion: record.schemaVersion, credential: credential(record.revision)}};
                    case "legacy-value":
                        return {kind: "read", result: {kind: "legacy-value", value: record.value, schemaVersion: record.schemaVersion, credential: credential(record.revision)}};
                    case "deleted":
                        return {kind: "read", result: {kind: "deleted", credential: credential(record.revision)}};
                    case "corrupt":
                        return {
                            kind: "read",
                            result: {
                                kind: "corrupt",
                                diagnosis: record.diagnosis,
                                repair: {partitionGeneration: 1, contentFingerprint: `sha256:${record.revision}`},
                            },
                        };
                }
            }
            if (action.kind === "save") {
                attempts.push(path);
                const value = action.value as WorkbenchEditorSessionRecord;
                const blocked = (await hooks.beforeSave?.(path, value)) ?? null;
                if (blocked !== null) {
                    throw blocked;
                }
                const record = records.get(path);
                if ((record?.revision ?? null) !== action.expected.revision) {
                    throw conflictError();
                }
                records.set(path, {
                    kind: "value",
                    value,
                    revision: `revision-${++sequence}`,
                    schemaVersion: action.schemaVersion,
                    diagnosis: "",
                });
                saves.push(path);
                return {kind: "save", credential: credential(`revision-${sequence}`)};
            }
            throw new Error(`测试未实现动作：${action.kind}`);
        },
    });

    const adapters: WorkbenchStorageAdapters = {
        openUserContext: async () => ({
            status: "ready",
            session: {scope: "user", contextId: "user".padEnd(64, "u"), clientCredential: CLIENT_CREDENTIAL},
        }),
        openProjectContext: async (target: StorageProjectContextTarget) => ({
            status: "ready",
            session: {
                scope: "project",
                contextId: "project".padEnd(64, "p"),
                clientCredential: CLIENT_CREDENTIAL,
                projectRoot: target.projectRoot,
                publicId: target.publicId,
            },
        }),
        openOwnerHandle: async (options) => await openStorageOwnerHandle({
            ...options,
            transport: transportFor(options.session.scope),
            // 订阅靠真实轮询发现外部写入；测试时长之外没有轮询，不会产生跨用例的偶发刷新。
            subscribe: {intervalMs: 15, maxBackoffMs: 40},
        }),
        closeContext: async () => undefined,
    };

    return {
        records,
        saves,
        attempts,
        reads,
        hooks,
        adapters,
        key: (scope, key = WORKBENCH_EDITOR_SESSION_KEY) => address(scope, key),
        record(scope, key) {
            return records.get(address(scope, key ?? WORKBENCH_EDITOR_SESSION_KEY));
        },
        value(scope, key) {
            const record = records.get(address(scope, key ?? WORKBENCH_EDITOR_SESSION_KEY));
            if (record === undefined) {
                throw new Error(`测试期望已写入记录：${scope}/${key ?? WORKBENCH_EDITOR_SESSION_KEY}`);
            }
            return record.value as WorkbenchEditorSessionRecord;
        },
        write(scope, value, options = {}) {
            records.set(address(scope, options.key ?? WORKBENCH_EDITOR_SESSION_KEY), {
                kind: options.kind ?? "value",
                value,
                revision: `seed-${++sequence}`,
                schemaVersion: options.schemaVersion ?? 1,
                diagnosis: "编辑记录损坏（测试注入）",
            });
        },
        holdReads(): () => void {
            gate.current = readGate();
            return gate.current.release;
        },
    };
}

function node(path: string): WorkspaceFileNode {
    return {
        mode: "file",
        entryType: null,
        icon: null,
        status: null,
        words: 0,
        refs: [],
        path,
        absolutePath: path,
        isDirectory: false,
        hasIndex: false,
        contentNode: false,
        summary: "",
        title: path,
        frontmatter: {},
        frontmatterError: null,
        state: null,
        size: 0,
        mtimeMs: 1,
        editable: true,
    };
}

/** 一棵横排树：第一片叶是 main，其余依次向右，叶序与组集合一一对应。 */
function multiGroupGrid(ids: readonly string[]): Grid<string> {
    const grid = createEditorGrid(ids[0]!);
    for (const id of ids.slice(1)) {
        const split = splitEditorGroup(grid, ids[0]!, id, "right");
        if (!split.ok) {
            throw new Error(`测试布局分屏失败：${id} ${split.reason}`);
        }
    }
    return grid;
}

function openEditorSessionState(grid: Grid<string>, groups: Record<string, readonly string[]>): EditorSessionState {
    const ids = editorGroupIds(grid);
    return {
        groups: ids.map((id) => ({
            id,
            activePath: groups[id]?.[0] ?? "",
            tabs: (groups[id] ?? []).map((path) => ({path, title: path, editorId: null, pinned: false, preview: false})),
        })),
        activeGroupId: ids[0]!,
    };
}

type Setup = {
    readonly store: EditorSessionTestStore;
    readonly harness: Harness;
    readonly surface: Ref<WorkbenchLayoutSurface>;
    readonly session: EditorSessionStorageConsumer;
    stop(): void;
};

async function setup(surface: WorkbenchLayoutSurface = SURFACE_PROJECT): Promise<Setup> {
    Object.assign(globalThis, {defineStore, ref, computed, watch, piniaPluginPersistedstate: {sessionStorage: () => ({})}});
    Object.assign(globalThis, {
        $fetch: async (url: string, request: {query?: {path?: string}} = {}) => {
            const path = request.query?.path ?? "";
            if (url.endsWith("/stat")) {
                return node(path);
            }
            if (url.endsWith("/read")) {
                return {content: `disk:${path}`, mtimeMs: 1};
            }
            throw new Error(`测试未实现的请求：${url}`);
        },
    });
    setActivePinia(createPinia());
    // Store 与组合函数都使用 Nuxt 自动导入的全局（defineStore/ref/…），必须先把它们装上再加载模块求值，
    // 因此这里只能动态导入；静态导入会在全局安装之前求值并直接抛错。
    const {useNovelIdeStore} = await import("nbook/app/stores/novel-ide");
    const {useEditorSessionStorage} = await import("nbook/app/utils/editor-workbench/editor-session-storage");
    const store: EditorSessionTestStore = useNovelIdeStore();
    store.currentProjectRoot = READY_A.projectRoot;
    const harness = storageHarness();
    const surfaceRef = ref<WorkbenchLayoutSurface>(surface);
    const scope = effectScope();
    const session = scope.run(() => useEditorSessionStorage({surface: surfaceRef, adapters: harness.adapters}))!;
    return {store, harness, surface: surfaceRef, session, stop: () => scope.stop()};
}

/** 本窗口当前的（sessionStorage 迁来的）单组呈现，用作"记录有值时会以记录为准"的对照。 */
function seedLocalSession(store: EditorSessionTestStore, groups: Record<string, readonly string[]>): void {
    const grid = multiGroupGrid(Object.keys(groups));
    store.replaceEditorSession({state: openEditorSessionState(grid, groups), grid});
}

function seedBuffers(store: EditorSessionTestStore, buffers: Record<string, {content: string; synced: string}>): void {
    store.workspaceBuffers = Object.fromEntries(Object.entries(buffers).map(([path, buffer]) => [path, {
        node: node(path),
        content: buffer.content,
        lastSyncedContent: buffer.synced,
        lastSyncedMtimeMs: 1,
        contentRevision: 1,
    }]));
}

/** 只推进微任务与 watch 队列（不引入真实时间）：断言"没有写入"时用它。 */
async function settle(): Promise<void> {
    for (let step = 0; step < 6; step += 1) {
        await nextTick();
        await Promise.resolve();
    }
}

/** 记录的布局投影，用于断言"哪一组开着哪些标签"。 */
function layoutOf(record: WorkbenchEditorSessionRecord | undefined): {groups: Array<[string, string[]]>; activeGroupId: string} {
    if (record === undefined) {
        throw new Error("测试期望记录存在");
    }
    return {
        groups: record.groups.map((group) => [group.id, group.tabs.map((tab) => tab.path)]),
        activeGroupId: record.activeGroupId,
    };
}

function storeLayout(store: EditorSessionTestStore): {groups: Array<[string, string[]]>; activeGroupId: string} {
    return {
        groups: store.editorGroups.map((group) => [group.id, group.tabs.map((tab) => tab.path)] as [string, string[]]),
        activeGroupId: store.editorSession.activeGroupId,
    };
}

describe("useEditorSessionStorage：恢复顺序", () => {
    it("记录缺失时保持本窗口单组呈现，不写默认记录；后续明确动作才条件创建", async () => {
        const {store, harness, session, stop} = await setup();
        seedLocalSession(store, {main: ["local.md"]});
        seedBuffers(store, {"local.md": {content: "A", synced: "A"}});
        store.workspaceTree = [node("local.md")];

        await session.initialize();
        expect(session.ready.value).toBe(true);
        expect(storeLayout(store)).toEqual({groups: [["main", ["local.md"]]], activeGroupId: "main"});
        expect(harness.saves).toEqual([]);
        expect(harness.records.size).toBe(0);
        expect(session.notice.value).toBeNull();

        store.splitEditorTab({sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "local.md", direction: "right", mode: "copy"});
        await vi.waitFor(() => { expect(harness.saves.length).toBe(1); });
        expect(harness.record("project")?.revision).toBeTypeOf("string");
        expect(layoutOf(harness.value("project"))).toEqual({groups: [["main", ["local.md"]], ["g2", ["local.md"]]], activeGroupId: "g2"});
        stop();
    });

    it("记录已删除时同缺失处理：保持本窗口呈现、不复活记录", async () => {
        const {store, harness, session, stop} = await setup();
        seedLocalSession(store, {main: ["local.md"]});
        harness.write("project", {version: 1, grid: {version: 2, root: {}}, groups: [], activeGroupId: ""}, {kind: "deleted"});

        await session.initialize();
        expect(session.ready.value).toBe(true);
        expect(storeLayout(store)).toEqual({groups: [["main", ["local.md"]]], activeGroupId: "main"});
        expect(harness.saves).toEqual([]);
        expect(harness.record("project")?.kind).toBe("deleted");
        expect(session.notice.value).toBeNull();
        stop();
    });

    it("记录有值时以它为分组/标签位置真相，按组活动标签按需读取，恢复本身不提交", async () => {
        const {store, harness, session, stop} = await setup();
        seedLocalSession(store, {main: ["local.md"]});
        seedBuffers(store, {"local.md": {content: "A", synced: "A"}});
        store.workspaceTree = [node("a.md"), node("b.md"), node("c.md")];
        const grid = multiGroupGrid(["main", "g2"]);
        harness.write("project", serializeEditorSession(openEditorSessionState(grid, {main: ["a.md", "c.md"], g2: ["b.md"]}), grid));

        await session.initialize();
        expect(storeLayout(store)).toEqual({groups: [["main", ["a.md", "c.md"]], ["g2", ["b.md"]]], activeGroupId: "main"});
        // 每组活动文档按需读取（非活动标签不预读）：记录里的活动标签都从磁盘读到了正文，
        // 同组里的非活动标签 c.md 不预读，本窗口原有的缓冲也不被恢复动作丢弃。
        expect(store.workspaceBuffers["a.md"]?.content).toBe("disk:a.md");
        expect(store.workspaceBuffers["b.md"]?.content).toBe("disk:b.md");
        expect(store.workspaceBuffers["c.md"]).toBeUndefined();
        expect(store.workspaceBuffers["local.md"]?.content).toBe("A");
        expect(harness.saves).toEqual([]);
        expect(session.notice.value).toBeNull();

        store.selectEditorGroup("g2");
        await vi.waitFor(() => { expect(harness.saves.length).toBe(1); });
        expect(layoutOf(harness.value("project"))?.activeGroupId).toBe("g2");
        stop();
    });

    it("同一工作面重复 initialize 合并成一次：不会用记录重放覆盖本窗口已提交的布局", async () => {
        const {store, harness, session, stop} = await setup();
        seedBuffers(store, {"a.md": {content: "A", synced: "A"}});
        store.workspaceTree = [node("a.md")];
        const grid = multiGroupGrid(["main"]);
        harness.write("project", serializeEditorSession(openEditorSessionState(grid, {main: ["a.md"]}), grid));

        await session.initialize();
        store.splitEditorTab({sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "a.md", direction: "right", mode: "copy"});
        await vi.waitFor(() => { expect(harness.saves.length).toBe(1); });

        await session.initialize();
        expect(storeLayout(store)).toEqual({groups: [["main", ["a.md"]], ["g2", ["a.md"]]], activeGroupId: "g2"});
        await settle();
        expect(harness.saves.length).toBe(1);
        stop();
    });

    it("文件树还没加载时不做存在性过滤：记录里的标签先保留，不因为没有树就删掉", async () => {
        const {store, harness, session, stop} = await setup();
        store.workspaceTree = [];
        const grid = multiGroupGrid(["main"]);
        harness.write("project", serializeEditorSession(openEditorSessionState(grid, {main: ["a.md"]}), grid));

        await session.initialize();
        // 树为空时"不在文件树里"这个判据不成立（也可能只是还没加载）：保留记录里的标签。
        expect(storeLayout(store)).toEqual({groups: [["main", ["a.md"]]], activeGroupId: "main"});
        expect(harness.saves).toEqual([]);
        stop();
    });

    it("恢复按记录里的 preview 标记读取活动文档：恢复本身不产生写入", async () => {
        const {store, harness, session, stop} = await setup();
        store.workspaceTree = [node("a.md"), node("b.md")];
        const grid = multiGroupGrid(["main"]);
        const seeded = serializeEditorSession(openEditorSessionState(grid, {main: ["a.md", "b.md"]}), grid);
        harness.write("project", {
            ...seeded,
            groups: seeded.groups.map((group) => ({
                ...group,
                activePath: "b.md",
                tabs: group.tabs.map((tab) => tab.path === "b.md" ? {...tab, preview: true} : tab),
            })),
        });

        await session.initialize();
        const main = store.editorGroups[0]!;
        expect(main.tabs.map((tab) => [tab.path, tab.preview])).toEqual([["a.md", false], ["b.md", true]]);
        // preview 标记与记录一致 ⇒ 恢复期的读取不会把它规范化掉，也就没有"恢复触发的写入"。
        expect(harness.attempts).toEqual([]);
        expect(session.notice.value).toBeNull();
        stop();
    });

    it("文件树是懒加载的：树里看不到的路径不当作不存在，记录里的标签照常恢复", async () => {
        const {store, harness, session, stop} = await setup();
        seedBuffers(store, {"a.md": {content: "A", synced: "A"}});
        // 只在根层加载了树，未展开目录里的文档（src/story/chapter-02.md）自然不在里面。
        store.workspaceTree = [node("a.md"), node("src")];
        const grid = multiGroupGrid(["main"]);
        harness.write("project", serializeEditorSession(openEditorSessionState(grid, {main: ["a.md", "src/story/chapter-02.md"]}), grid));

        await session.initialize();
        expect(storeLayout(store)).toEqual({groups: [["main", ["a.md", "src/story/chapter-02.md"]]], activeGroupId: "main"});
        expect(session.issues.value.join(" | ")).not.toContain("chapter-02.md");
        expect(harness.saves).toEqual([]);
        stop();
    });

    it("记录未引用却有未保存内容的文档追加到活动组并提示，不因采用远端布局丢稿", async () => {
        const {store, harness, session, stop} = await setup();
        seedBuffers(store, {
            "a.md": {content: "A", synced: "A"},
            "draft.md": {content: "草稿", synced: ""},
            "clean.md": {content: "C", synced: "C"},
        });
        store.workspaceTree = [node("a.md"), node("draft.md"), node("clean.md")];
        const grid = multiGroupGrid(["main"]);
        harness.write("project", serializeEditorSession(openEditorSessionState(grid, {main: ["a.md"]}), grid));

        await session.initialize();
        // 只有 dirty 且未被记录的文档被追加；记录里的活动选择不被恢复动作改掉。
        expect(storeLayout(store)).toEqual({groups: [["main", ["a.md", "draft.md"]]], activeGroupId: "main"});
        expect(session.notice.value).toMatchObject({kind: "unsaved", retryable: true});
        expect(session.notice.value?.diagnosis).toContain("draft.md");
        expect(harness.saves).toEqual([]);

        // 恢复不自动写回；下一次明确的会话动作把这份本地补充一起写进记录。
        store.splitEditorTab({sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "a.md", direction: "right", mode: "copy"});
        await vi.waitFor(() => { expect(harness.saves.length).toBe(1); });
        expect(layoutOf(harness.value("project")).groups).toEqual([["main", ["a.md", "draft.md"]], ["g2", ["a.md"]]]);
        expect(session.notice.value).toBeNull();
        stop();
    });

    it("损坏 / 旧版本 / 布局无法恢复的记录一律保护：保留原件、禁止普通覆盖", async () => {
        for (const seeded of [
            {kind: "corrupt" as const, value: null, schemaVersion: 1},
            {kind: "value" as const, value: {version: 1, grid: {version: 2, root: {}}, groups: [], activeGroupId: ""}, schemaVersion: 1},
            {kind: "legacy-value" as const, value: {version: 0, grid: {}, groups: [], activeGroupId: ""}, schemaVersion: 0},
        ]) {
            const {store, harness, session, stop} = await setup();
            seedLocalSession(store, {main: ["local.md"]});
            harness.write("project", seeded.value, {kind: seeded.kind, schemaVersion: seeded.schemaVersion});
            const before = harness.record("project");

            await session.initialize();
            expect(session.ready.value).toBe(true);
            expect(session.notice.value).toMatchObject({kind: "protected", retryable: false});
            // 原件保留，本窗口呈现仍可用。
            expect(storeLayout(store)).toEqual({groups: [["main", ["local.md"]]], activeGroupId: "main"});

            seedBuffers(store, {"local.md": {content: "A", synced: "A"}});
            store.workspaceTree = [node("local.md")];
            store.splitEditorTab({sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "local.md", direction: "right", mode: "copy"});
            await settle();
            expect(harness.attempts).toEqual([]);

            await session.overwriteWithSaved();
            expect(harness.attempts).toEqual([]);
            expect(session.notice.value).toMatchObject({kind: "protected"});
            expect(harness.record("project")).toEqual(before);
            expect(await session.flush()).toBe(false);
            session.abandon();
            expect(await session.flush()).toBe(true);
            stop();
        }
    });
    it("读取后被改成不可普通保存时，写入失败按保护处置并拒绝覆盖", async () => {
        const {store, harness, session, stop} = await setup();
        seedBuffers(store, {"a.md": {content: "A", synced: "A"}});
        store.workspaceTree = [node("a.md")];
        const grid = multiGroupGrid(["main"]);
        harness.write("project", serializeEditorSession(openEditorSessionState(grid, {main: ["a.md"]}), grid));
        await session.initialize();

        harness.hooks.beforeSave = () => new StorageAdapterError({
            code: "STORAGE_WRITE_BLOCKED",
            status: 409,
            message: "Storage 记录不可按普通保存写入",
            committed: false,
        });
        store.splitEditorTab({sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "a.md", direction: "right", mode: "copy"});
        await vi.waitFor(() => { expect(session.notice.value?.kind).toBe("protected"); });

        await session.overwriteWithSaved();
        expect(harness.saves).toEqual([]);
        expect(session.notice.value).toMatchObject({kind: "protected", retryable: false});
        expect(await session.flush()).toBe(false);
        stop();
    });
});

describe("useEditorSessionStorage：提交触发与串行", () => {
    it("首读门禁：读取分类前不落盘，也不自动创建默认记录", async () => {
        const {store, harness, session, stop} = await setup();
        seedLocalSession(store, {main: ["local.md"]});
        seedBuffers(store, {"local.md": {content: "A", synced: "A"}});
        store.workspaceTree = [node("local.md")];
        const release = harness.holdReads();
        const opening = session.initialize();
        await settle();
        expect(session.ready.value).toBe(false);

        store.splitEditorTab({sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "local.md", direction: "right", mode: "copy"});
        await settle();
        expect(harness.attempts).toEqual([]);

        release();
        await opening;
        expect(session.ready.value).toBe(true);
        expect(harness.attempts).toEqual([]);
        expect(harness.records.size).toBe(0);
        stop();
    });

    it("同一 tick 内多次会话变化合并成一次条件保存", async () => {
        const {store, harness, session, stop} = await setup();
        seedBuffers(store, {"a.md": {content: "A", synced: "A"}});
        store.workspaceTree = [node("a.md")];
        const grid = multiGroupGrid(["main"]);
        harness.write("project", serializeEditorSession(openEditorSessionState(grid, {main: ["a.md"]}), grid));
        await session.initialize();

        // 尺寸测量不构成会话提交：extent 变化只改布局呈现，不落盘。
        store.setEditorExtent({width: 1200, height: 800});
        await settle();
        expect(harness.attempts).toEqual([]);

        store.splitEditorTab({sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "a.md", direction: "right", mode: "copy"});
        store.splitEditorTab({sourceGroupId: "g2", targetGroupId: "g2", newGroupId: "g3", path: "a.md", direction: "right", mode: "copy"});
        store.selectEditorGroup("g3");
        await vi.waitFor(() => { expect(harness.saves.length).toBe(1); });
        await settle();
        expect(harness.attempts.length).toBe(1);
        expect(layoutOf(harness.value("project"))).toEqual({groups: [["main", ["a.md"]], ["g2", ["a.md"]], ["g3", ["a.md"]]], activeGroupId: "g3"});
        stop();
    });

    it("写入串行：在途回执不清除随后产生的意图", async () => {
        const {store, harness, session, stop} = await setup();
        seedBuffers(store, {"a.md": {content: "A", synced: "A"}});
        store.workspaceTree = [node("a.md")];
        const grid = multiGroupGrid(["main"]);
        harness.write("project", serializeEditorSession(openEditorSessionState(grid, {main: ["a.md"]}), grid));
        await session.initialize();

        const {promise, resolve} = Promise.withResolvers<void>();
        harness.hooks.beforeSave = () => promise;
        store.splitEditorTab({sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "a.md", direction: "right", mode: "copy"});
        await vi.waitFor(() => { expect(harness.attempts.length).toBe(1); });
        // 第一条写入还没回执时又发生一次会话变化：旧回执不能把这次意图当成已确认。
        store.splitEditorTab({sourceGroupId: "g2", targetGroupId: "g2", newGroupId: "g3", path: "a.md", direction: "right", mode: "copy"});
        harness.hooks.beforeSave = null;
        resolve();

        await vi.waitFor(() => { expect(harness.saves.length).toBe(2); });
        expect(layoutOf(harness.value("project"))).toEqual({groups: [["main", ["a.md"]], ["g2", ["a.md"]], ["g3", ["a.md"]]], activeGroupId: "g3"});
        expect(await session.flush()).toBe(true);
        expect(session.notice.value).toBeNull();
        stop();
    });
});

describe("useEditorSessionStorage：冲突出口", () => {
    it("重试核对：远端已等于待存意图 ⇒ 确认，不重复写", async () => {
        const {store, harness, session, stop} = await setup();
        seedBuffers(store, {"a.md": {content: "A", synced: "A"}});
        store.workspaceTree = [node("a.md")];
        const grid = multiGroupGrid(["main"]);
        harness.write("project", serializeEditorSession(openEditorSessionState(grid, {main: ["a.md"]}), grid));
        await session.initialize();

        // 先让写入报条件冲突（记录不动，冲突提示留在那里），再让另一个窗口写下的正好是同一份布局。
        let attempted: WorkbenchEditorSessionRecord | null = null;
        harness.hooks.beforeSave = (_address, value) => {
            attempted = value;
            return conflictError();
        };
        store.splitEditorTab({sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "a.md", direction: "right", mode: "copy"});
        await vi.waitFor(() => { expect(session.notice.value?.kind).toBe("conflict"); });
        expect(attempted).not.toBeNull();

        harness.hooks.beforeSave = null;
        harness.records.set(harness.key("project"), {
            kind: "value",
            value: attempted,
            revision: "external-1",
            schemaVersion: 1,
            diagnosis: "",
        });
        await session.retry();
        expect(session.notice.value).toBeNull();
        expect(harness.saves).toEqual([]);
        expect(await session.flush()).toBe(true);
        stop();
    });

    it("重试核对：远端仍等于本地原基线 ⇒ 用新凭据重提一次", async () => {
        const {store, harness, session, stop} = await setup();
        seedBuffers(store, {"a.md": {content: "A", synced: "A"}});
        store.workspaceTree = [node("a.md")];
        const grid = multiGroupGrid(["main"]);
        harness.write("project", serializeEditorSession(openEditorSessionState(grid, {main: ["a.md"]}), grid));
        await session.initialize();

        // 前提失败（例如分区代次刚被刷新）：记录本身没变，只有凭据旧了。
        harness.hooks.beforeSave = () => conflictError("条件凭据已失效");
        store.splitEditorTab({sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "a.md", direction: "right", mode: "copy"});
        await vi.waitFor(() => { expect(session.notice.value?.kind).toBe("conflict"); });
        expect(harness.saves).toEqual([]);

        harness.hooks.beforeSave = null;
        await session.retry();
        expect(harness.saves.length).toBe(1);
        expect(layoutOf(harness.value("project"))).toEqual({groups: [["main", ["a.md"]], ["g2", ["a.md"]]], activeGroupId: "g2"});
        expect(session.notice.value).toBeNull();
        stop();
    });

    it("重试核对：远端已是另一个布局 ⇒ 继续冲突，不静默覆盖", async () => {
        const {store, harness, session, stop} = await setup();
        seedBuffers(store, {"a.md": {content: "A", synced: "A"}, "b.md": {content: "B", synced: "B"}});
        store.workspaceTree = [node("a.md"), node("b.md")];
        const grid = multiGroupGrid(["main"]);
        harness.write("project", serializeEditorSession(openEditorSessionState(grid, {main: ["a.md"]}), grid));
        await session.initialize();

        const other = multiGroupGrid(["main", "g9"]);
        harness.hooks.beforeSave = (address) => {
            harness.records.set(address, {
                kind: "value",
                value: serializeEditorSession(openEditorSessionState(other, {main: ["b.md"], g9: ["b.md"]}), other),
                revision: "external-1",
                schemaVersion: 1,
                diagnosis: "",
            });
            return conflictError();
        };
        store.splitEditorTab({sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "a.md", direction: "right", mode: "copy"});
        await vi.waitFor(() => { expect(session.notice.value?.kind).toBe("conflict"); });

        harness.hooks.beforeSave = null;
        await session.retry();
        expect(session.notice.value).toMatchObject({kind: "conflict", retryable: true, overwritable: true});
        expect(harness.saves).toEqual([]);
        // 本窗口呈现保持不动，远端记录也没被改写。
        expect(storeLayout(store).groups).toEqual([["main", ["a.md"]], ["g2", ["a.md"]]]);
        expect(layoutOf(harness.value("project")).groups).toEqual([["main", ["b.md"]], ["g9", ["b.md"]]]);
        expect(await session.flush()).toBe(false);
        stop();
    });

    it("以本窗口布局覆盖：按刚读取的凭据提交一次，并保留原件未知字段；再次冲突继续保留", async () => {
        const {store, harness, session, stop} = await setup();
        seedBuffers(store, {"a.md": {content: "A", synced: "A"}, "b.md": {content: "B", synced: "B"}});
        store.workspaceTree = [node("a.md"), node("b.md")];
        const grid = multiGroupGrid(["main"]);
        const seeded = serializeEditorSession(openEditorSessionState(grid, {main: ["a.md"]}), grid);
        harness.write("project", {...seeded, futureTop: "keep", groups: seeded.groups.map((group) => ({...group, futureGroup: "keep"}))});

        const other = multiGroupGrid(["main"]);
        harness.hooks.beforeSave = (address) => {
            harness.records.set(address, {
                kind: "value",
                value: {...serializeEditorSession(openEditorSessionState(other, {main: ["b.md"]}), other), futureTop: "keep"},
                revision: "external-1",
                schemaVersion: 1,
                diagnosis: "",
            });
            return conflictError();
        };
        await session.initialize();
        store.splitEditorTab({sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "a.md", direction: "right", mode: "copy"});
        await vi.waitFor(() => { expect(session.notice.value?.kind).toBe("conflict"); });

        // 页面确认后的显式覆盖：只在刚读取的凭据上提交一次。
        harness.hooks.beforeSave = () => conflictError("又有人抢先写入");
        await session.overwriteWithSaved();
        expect(session.notice.value).toMatchObject({kind: "conflict"});
        expect(harness.saves).toEqual([]);
        harness.hooks.beforeSave = null;
        await session.overwriteWithSaved();
        expect(harness.saves.length).toBe(1);
        const saved = harness.value("project");
        expect(layoutOf(saved)).toEqual({groups: [["main", ["a.md"]], ["g2", ["a.md"]]], activeGroupId: "g2"});
        expect(saved.futureTop).toBe("keep");
        expect(session.notice.value).toBeNull();
        stop();
    });

    it("有未解决输入时采用已保存布局与覆盖都停手：保留本次裁决入口", async () => {
        const {store, harness, session, stop} = await setup();
        seedBuffers(store, {"a.md": {content: "A", synced: "A"}});
        store.workspaceTree = [node("a.md")];
        const grid = multiGroupGrid(["main"]);
        harness.write("project", serializeEditorSession(openEditorSessionState(grid, {main: ["a.md"]}), grid));
        await session.initialize();

        // 登记一个报告 conflict 的编辑实例：拓扑重挂之前必须先结算它。
        const unregister = store.registerEditorFlush(store.editorDocumentTarget("a.md"), "test", () => "conflict");
        harness.hooks.beforeSave = () => conflictError();
        store.splitEditorTab({sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "a.md", direction: "right", mode: "copy"});
        await vi.waitFor(() => { expect(session.notice.value?.kind).toBe("conflict"); });

        harness.hooks.beforeSave = null;
        await session.adoptSaved();
        await session.overwriteWithSaved();
        expect(storeLayout(store)).toEqual({groups: [["main", ["a.md"]], ["g2", ["a.md"]]], activeGroupId: "g2"});
        expect(harness.saves).toEqual([]);
        expect(session.notice.value).toMatchObject({kind: "conflict"});

        unregister();
        await session.adoptSaved();
        expect(storeLayout(store)).toEqual({groups: [["main", ["a.md"]]], activeGroupId: "main"});
        stop();
    });

    it("采用已保存布局：替换呈现并保留 dirty 缓冲，未被采用的 dirty 文档追加到活动组", async () => {
        const {store, harness, session, stop} = await setup();
        seedBuffers(store, {"a.md": {content: "A", synced: "A"}, "draft.md": {content: "草稿", synced: ""}});
        store.workspaceTree = [node("a.md"), node("draft.md")];
        const grid = multiGroupGrid(["main"]);
        harness.write("project", serializeEditorSession(openEditorSessionState(grid, {main: ["a.md"]}), grid));
        await session.initialize();

        const other = multiGroupGrid(["main", "g9"]);
        harness.hooks.beforeSave = (address) => {
            harness.records.set(address, {
                kind: "value",
                value: serializeEditorSession(openEditorSessionState(other, {main: ["a.md"], g9: ["a.md"]}), other),
                revision: "external-1",
                schemaVersion: 1,
                diagnosis: "",
            });
            return conflictError();
        };
        store.splitEditorTab({sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "a.md", direction: "right", mode: "copy"});
        await vi.waitFor(() => { expect(session.notice.value?.kind).toBe("conflict"); });

        harness.hooks.beforeSave = null;
        await session.adoptSaved();
        // 采用远端布局；远端没引用的 dirty 文档仍被追加回活动组，并明确标为未确认的本地补充。
        expect(storeLayout(store)).toEqual({groups: [["main", ["a.md", "draft.md"]], ["g9", ["a.md"]]], activeGroupId: "main"});
        expect(session.notice.value).toMatchObject({kind: "unsaved"});
        expect(session.notice.value?.diagnosis).toContain("draft.md");
        // dirty 正文保留在唯一正文权威里，没有被布局放弃动作清掉。
        expect(store.workspaceBuffers["draft.md"]?.content).toBe("草稿");
        expect(store.workspaceBuffers["draft.md"]?.lastSyncedContent).toBe("");
        expect(harness.saves).toEqual([]);
        expect(await session.flush()).toBe(true);
        stop();
    });
});

describe("useEditorSessionStorage：订阅与工作面", () => {
    it("订阅只更新最近观察到的记录：不替换本窗口呈现，也不悄悄授权覆盖", async () => {
        const {store, harness, session, stop} = await setup();
        seedBuffers(store, {"a.md": {content: "A", synced: "A"}, "b.md": {content: "B", synced: "B"}});
        store.workspaceTree = [node("a.md"), node("b.md")];
        const grid = multiGroupGrid(["main"]);
        harness.write("project", serializeEditorSession(openEditorSessionState(grid, {main: ["a.md"]}), grid));
        await session.initialize();

        const other = multiGroupGrid(["main", "g9"]);
        harness.write("project", serializeEditorSession(openEditorSessionState(other, {main: ["b.md"], g9: ["b.md"]}), other));
        await vi.waitFor(() => { expect(harness.reads.length).toBeGreaterThan(1); });
        await settle();

        // 外来确认只进"最近观察到的值"：本窗口呈现与外来的 B 布局无关。
        expect(storeLayout(store)).toEqual({groups: [["main", ["a.md"]]], activeGroupId: "main"});
        expect(harness.saves).toEqual([]);

        // 下一次本地动作仍然以**本窗口据以建立的凭据**提交 ⇒ 冲突而不是静默覆盖别人的布局。
        store.splitEditorTab({sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "a.md", direction: "right", mode: "copy"});
        await vi.waitFor(() => { expect(session.notice.value?.kind).toBe("conflict"); });
        expect(harness.saves).toEqual([]);
        expect(layoutOf(harness.value("project")).groups).toEqual([["main", ["b.md"]], ["g9", ["b.md"]]]);
        stop();
    });

    it("工作面切换各自读写：user-assets 走自己的记录，不读 Project 记录也不拿它兜底", async () => {
        const {store, harness, surface, session, stop} = await setup();
        seedBuffers(store, {"a.md": {content: "A", synced: "A"}, "u.md": {content: "U", synced: "U"}});
        store.workspaceTree = [node("a.md"), node("u.md")];
        const grid = multiGroupGrid(["main"]);
        harness.write("project", serializeEditorSession(openEditorSessionState(grid, {main: ["a.md"]}), grid));
        harness.write("user", serializeEditorSession(openEditorSessionState(grid, {main: ["u.md"]}), grid), {key: WORKBENCH_EDITOR_USER_ASSETS_SESSION_KEY});
        await session.initialize();
        expect(storeLayout(store)).toEqual({groups: [["main", ["a.md"]]], activeGroupId: "main"});

        surface.value = SURFACE_USER_ASSETS;
        await vi.waitFor(() => { expect(storeLayout(store).groups).toEqual([["main", ["u.md"]]]); });
        expect(harness.reads).toContain(harness.key("user", WORKBENCH_EDITOR_USER_ASSETS_SESSION_KEY));

        store.splitEditorTab({sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "u.md", direction: "right", mode: "copy"});
        await vi.waitFor(() => { expect(harness.saves.length).toBe(1); });
        expect(harness.saves).toEqual([harness.key("user", WORKBENCH_EDITOR_USER_ASSETS_SESSION_KEY)]);

        // 切回 Project：回到 Project 记录，用户资产记录不被当作回退来源。
        surface.value = SURFACE_PROJECT;
        await vi.waitFor(() => { expect(storeLayout(store).groups).toEqual([["main", ["a.md"]]]); });
        expect(harness.record("user", WORKBENCH_EDITOR_USER_ASSETS_SESSION_KEY)?.revision).toBeTypeOf("string");
        stop();
    });

    it("未开项目（idle）：不读写任何记录，也不读 Project 记录", async () => {
        const {store, harness, session, stop} = await setup(SURFACE_IDLE);
        seedLocalSession(store, {main: ["local.md"]});
        seedBuffers(store, {"local.md": {content: "A", synced: "A"}});
        store.workspaceTree = [node("local.md")];

        await session.initialize();
        expect(session.ready.value).toBe(true);
        expect(harness.reads).toEqual([]);
        store.splitEditorTab({sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "local.md", direction: "right", mode: "copy"});
        await settle();
        expect(harness.attempts).toEqual([]);
        expect(await session.flush()).toBe(true);
        stop();
    });

    it("Project 工作面缺少可定位 ready 时按不可用处理：不读记录、不 fallback 到用户记录", async () => {
        const {store, harness, session, stop} = await setup({kind: "project", ready: {projectRoot: "", publicId: ""}});
        seedLocalSession(store, {main: ["local.md"]});

        await session.initialize();
        expect(session.notice.value).toMatchObject({kind: "unavailable", retryable: true});
        expect(harness.reads).toEqual([]);
        expect(harness.attempts).toEqual([]);
        stop();
    });
});

describe("useEditorSessionStorage：未知字段保留", () => {
    it("存活对象带过未知字段，被关闭或被删除的对象随对象消失", async () => {
        const {store, harness, session, stop} = await setup();
        seedBuffers(store, {"a.md": {content: "A", synced: "A"}, "b.md": {content: "B", synced: "B"}});
        store.workspaceTree = [node("a.md"), node("b.md")];
        const grid = multiGroupGrid(["main"]);
        const seeded = serializeEditorSession(openEditorSessionState(grid, {main: ["a.md", "b.md"]}), grid);
        harness.write("project", {
            ...seeded,
            futureTop: "keep",
            grid: {...seeded.grid, futureGrid: "keep"},
            groups: seeded.groups.map((group) => ({
                ...group,
                futureGroup: "keep",
                tabs: group.tabs.map((tab) => tab.path === "a.md" ? {...tab, futureTab: "keep"} : {...tab, futureGone: "drop"}),
            })),
        });
        await session.initialize();

        // 关掉带未知字段的 b.md，并对 a.md 做一次分屏（新增组/新标签不继承别人的字段）。
        store.closeWorkspaceTab("main", "b.md", true);
        store.splitEditorTab({sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "a.md", direction: "right", mode: "copy"});
        await vi.waitFor(() => { expect(harness.saves.length).toBe(1); });

        const saved = harness.value("project") as WorkbenchEditorSessionRecord & {futureTop?: unknown; grid: {futureGrid?: unknown}};
        expect(saved.futureTop).toBe("keep");
        expect(saved.grid.futureGrid).toBe("keep");
        const main = saved.groups.find((group) => group.id === "main")!;
        expect((main as {futureGroup?: unknown}).futureGroup).toBe("keep");
        expect(main.tabs.map((tab) => [tab.path, (tab as {futureTab?: unknown; futureGone?: unknown}).futureTab, (tab as {futureGone?: unknown}).futureGone]))
            .toEqual([["a.md", "keep", undefined]]);
        const created = saved.groups.find((group) => group.id === "g2")!;
        expect((created as {futureGroup?: unknown}).futureGroup).toBeUndefined();
        expect(Object.keys(created.tabs[0]!).sort()).toEqual(["editorId", "path", "pinned", "preview"]);
        stop();
    });
});

describe("useEditorSessionStorage：放弃与 flush", () => {
    it("abandon 清掉未确认意图与提示，不清 dirty 正文", async () => {
        const {store, harness, session, stop} = await setup();
        seedBuffers(store, {"a.md": {content: "A", synced: "A"}});
        store.workspaceTree = [node("a.md")];
        const grid = multiGroupGrid(["main"]);
        harness.write("project", serializeEditorSession(openEditorSessionState(grid, {main: ["a.md"]}), grid));
        await session.initialize();

        harness.hooks.beforeSave = () => conflictError();
        store.splitEditorTab({sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "a.md", direction: "right", mode: "copy"});
        await vi.waitFor(() => { expect(session.notice.value?.kind).toBe("conflict"); });
        expect(await session.flush()).toBe(false);

        harness.hooks.beforeSave = null;
        session.abandon();
        expect(session.notice.value).toBeNull();
        expect(await session.flush()).toBe(true);
        // 放弃的是布局意图：本地呈现与正文缓冲都还在。
        expect(storeLayout(store).groups).toEqual([["main", ["a.md"]], ["g2", ["a.md"]]]);
        expect(store.workspaceBuffers["a.md"]?.content).toBe("A");
        stop();
    });

    it("flush 等待在途写入落地并报告确认结果", async () => {
        const {store, harness, session, stop} = await setup();
        seedBuffers(store, {"a.md": {content: "A", synced: "A"}});
        store.workspaceTree = [node("a.md")];
        const grid = multiGroupGrid(["main"]);
        harness.write("project", serializeEditorSession(openEditorSessionState(grid, {main: ["a.md"]}), grid));
        await session.initialize();
        expect(await session.flush()).toBe(true);

        const {promise, resolve} = Promise.withResolvers<void>();
        harness.hooks.beforeSave = () => promise;
        store.splitEditorTab({sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "a.md", direction: "right", mode: "copy"});
        const flushing = session.flush();
        await vi.waitFor(() => { expect(harness.attempts.length).toBe(1); });
        harness.hooks.beforeSave = null;
        resolve();
        expect(await flushing).toBe(true);
        expect(harness.saves.length).toBe(1);
        stop();
    });

    it("写入结果未确认时报未保存而不是谎报成功，重读核对后才确认", async () => {
        const {store, harness, session, stop} = await setup();
        seedBuffers(store, {"a.md": {content: "A", synced: "A"}});
        store.workspaceTree = [node("a.md")];
        const grid = multiGroupGrid(["main"]);
        harness.write("project", serializeEditorSession(openEditorSessionState(grid, {main: ["a.md"]}), grid));
        await session.initialize();

        harness.hooks.beforeSave = () => new StorageAdapterError({
            code: "STORAGE_IO_FAILURE",
            status: null,
            message: "连接中断",
            committed: null,
        });
        store.splitEditorTab({sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "a.md", direction: "right", mode: "copy"});
        await vi.waitFor(() => { expect(session.notice.value?.kind).toBe("unsaved"); });
        expect(session.notice.value?.diagnosis).toContain("未确认");
        expect(await session.flush()).toBe(false);

        // 重读核对发现远端仍等于本地原基线：用刚读取的凭据重提一次（不谎报、也不无限重放）。
        harness.hooks.beforeSave = null;
        await session.retry();
        expect(session.notice.value).toBeNull();
        expect(harness.saves.length).toBe(1);
        expect(layoutOf(harness.value("project")).groups).toEqual([["main", ["a.md"]], ["g2", ["a.md"]]]);
        expect(await session.flush()).toBe(true);
        stop();
    });
});
