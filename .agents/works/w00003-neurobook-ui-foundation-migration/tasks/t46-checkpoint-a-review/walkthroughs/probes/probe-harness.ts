/** 审查探针共享夹具：真实 owner adapter + 注入传输（只读审查不得改产品测试）。 */
import {
    createGrid,
    type Grid,
    type GridLeafInput,
    type GridNode,
    type GridRefResolver,
} from "@notnotype/nb-ui/components";
import type {StorageActionRequest, StorageActionResponse} from "nbook/shared/storage/action";
import type {StorageCredential, StorageReadResult} from "nbook/shared/storage/contract";
import type {StorageValueTransport} from "nbook/app/utils/storage/value-transport";
import {openStorageOwnerHandle} from "nbook/app/utils/storage/owner-handle";
import type {StorageProjectContextTarget} from "nbook/app/utils/storage/host-context-client";
import {
    createWorkbenchStorageContext,
    type WorkbenchStorageAdapters,
    type WorkbenchStorageContext,
    type WorkbenchStorageOwnerHandle,
} from "nbook/app/utils/workbench/storage-context";
import {
    createGridLayoutHost,
    defineGridLayoutState,
    type GridLayoutHost,
    type GridLayoutRecord,
} from "nbook/app/utils/workbench/storage-grid-host";

export const OWNER = "nbook.probe";
export const RESOURCE = "main";
const CLIENT_CREDENTIAL = "0123456789abcdef".repeat(4);

export function credential(revision: string | null): StorageCredential {
    return {revision, partitionGeneration: 1};
}

export function leaf(id: string, width: number, minimumSize: number, maximumSize: number): GridLeafInput<string> {
    return {
        kind: "leaf",
        id,
        ref: id,
        size: {width, height: 800},
        minimumSize: {width: minimumSize, height: 0},
        maximumSize: {width: maximumSize, height: 800},
    };
}

export function createDefaultGrid(): Grid<string> {
    return createGrid<string>({
        kind: "branch",
        id: "root",
        orientation: "horizontal",
        size: {width: 0, height: 800},
        children: [
            leaf("outline", 240, 100, 400),
            leaf("editor", 660, 200, 2000),
            leaf("console", 300, 100, 1200),
        ],
    }, {sashSize: 0});
}

export function resolver(pluginLoaded = false): GridRefResolver<string> {
    const known: Record<string, true> = {outline: true, editor: true, console: true, plugin: true};
    return (ref) => (known[ref] === true && (ref !== "plugin" || pluginLoaded) ? {ref} : null);
}

/** 记录载荷：两叶（outline/editor）；用于重放与失效探针。 */
export function twoLeafRecord(outlineWidth = 240, editorWidth = 660, note = "seed"): GridLayoutRecord {
    return {
        version: 2,
        note,
        root: {
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            size: {width: 0, height: 0},
            children: [
                {kind: "leaf", id: "outline", ref: "outline", size: {width: outlineWidth, height: 0}},
                {kind: "leaf", id: "editor", ref: "editor", size: {width: editorWidth, height: 0}},
            ],
        },
    } as unknown as GridLayoutRecord;
}

/** 记录载荷：三叶（outline/editor/console），与默认树同形。 */
export function threeLeafRecord(outlineWidth = 240, revisionNote = "seed"): GridLayoutRecord {
    return {
        version: 2,
        note: revisionNote,
        root: {
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            size: {width: 0, height: 0},
            children: [
                {kind: "leaf", id: "outline", ref: "outline", size: {width: outlineWidth, height: 0}},
                {kind: "leaf", id: "editor", ref: "editor", size: {width: 660, height: 0}},
                {kind: "leaf", id: "console", ref: "console", size: {width: 300, height: 0}},
            ],
        },
    } as unknown as GridLayoutRecord;
}

export type SaveAttempt = {readonly value: GridLayoutRecord; readonly expected: StorageCredential};

export type ProbeTransport = {
    readonly transport: StorageValueTransport;
    readonly attempts: SaveAttempt[];
    readCount(): number;
};

/** 脚本化传输：读取按序返回，提交可注入失败；句柄/订阅/失效语义仍由真实 adapter 提供。 */
export function scriptedTransport(options: {
    readonly onRead?: (index: number, resource: string | undefined) => StorageReadResult<unknown>;
    readonly onSave?: (value: GridLayoutRecord, index: number) => Promise<StorageCredential>;
} = {}): ProbeTransport {
    const attempts: SaveAttempt[] = [];
    let reads = 0;
    const transport: StorageValueTransport = {
        async send(action: StorageActionRequest): Promise<StorageActionResponse> {
            if (action.kind === "bind") {
                return {kind: "bind", binding: {local: 1, shared: 1}};
            }
            if (action.kind === "read") {
                reads += 1;
                const result = options.onRead?.(reads, action.resource) ?? {kind: "missing", credential: credential(null)};
                return {kind: "read", result: result as StorageReadResult<unknown>};
            }
            if (action.kind === "save") {
                const value = action.value as GridLayoutRecord;
                attempts.push({value, expected: action.expected});
                const next = options.onSave === undefined
                    ? credential(`rev-${attempts.length}`)
                    : await options.onSave(value, attempts.length);
                return {kind: "save", credential: next};
            }
            throw new Error(`探针传输未实现动作：${action.kind}`);
        },
    };
    return {transport, attempts, readCount: () => reads};
}

export function workbenchAdapters(transport: StorageValueTransport): WorkbenchStorageAdapters {
    return {
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
        openOwnerHandle: async (options) => openStorageOwnerHandle({
            ...options,
            transport,
            subscribe: {intervalMs: 60_000, maxBackoffMs: 120_000},
        }),
        closeContext: async () => undefined,
    };
}

export type ProbeHost = {
    readonly host: GridLayoutHost<string>;
    readonly workbench: WorkbenchStorageContext;
    readonly handle: WorkbenchStorageOwnerHandle;
};

export function probeDefinition() {
    return defineGridLayoutState({
        owner: OWNER,
        key: "layout",
        scope: "user",
        records: "identified",
        defaultLayout: createDefaultGrid().serialize(),
    });
}

export async function openProbeHost(options: {
    readonly transport: StorageValueTransport;
    readonly pluginLoaded?: boolean;
    readonly resource?: string;
    readonly resolveRef?: GridRefResolver<string>;
    readonly grid?: Grid<string>;
    readonly definition?: ReturnType<typeof probeDefinition>;
}): Promise<ProbeHost> {
    const workbench = createWorkbenchStorageContext({adapters: workbenchAdapters(options.transport)});
    const borrowed = await workbench.userOwner(OWNER);
    if (borrowed.status !== "ready") {
        throw new Error(borrowed.diagnosis);
    }
    const host = createGridLayoutHost({
        grid: options.grid ?? createDefaultGrid(),
        handle: borrowed.handle,
        definition: options.definition ?? probeDefinition(),
        resource: options.resource ?? RESOURCE,
        resolveRef: options.resolveRef ?? resolver(options.pluginLoaded ?? false),
    });
    return {host, workbench, handle: borrowed.handle};
}

export function findNode(node: GridNode<string> | null, id: string): GridNode<string> | null {
    if (node === null) {
        return null;
    }
    if (node.id === id) {
        return node;
    }
    if (node.kind === "leaf") {
        return null;
    }
    for (const child of node.children) {
        const hit = findNode(child, id);
        if (hit !== null) {
            return hit;
        }
    }
    return null;
}

export function widthOf(host: GridLayoutHost<string>, id: string): number {
    const node = findNode(host.grid.root(), id);
    if (node === null) {
        throw new Error(`呈现树里没有节点：${id}`);
    }
    return node.size.width;
}

export function idsOf(node: GridNode<string> | null): string[] {
    if (node === null) {
        return [];
    }
    return node.kind === "leaf" ? [node.id] : [node.id, ...node.children.flatMap(idsOf)];
}

export function childIds(record: GridLayoutRecord): string[] {
    return (record.root as unknown as {children: Array<{id: string}>}).children.map((child) => child.id);
}

export function childWidth(record: GridLayoutRecord, index: number): number {
    const children = (record.root as unknown as {children: Array<{size: {width: number}}>}).children;
    return children[index]!.size.width;
}
