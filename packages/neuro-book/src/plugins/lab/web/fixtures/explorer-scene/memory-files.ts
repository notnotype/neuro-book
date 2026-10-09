/**
 * 资源管理器 Lab 场景的内存文件适配器（docs/specs/workbench/files-explorer.md 验收 13、docs/specs/ui/component-lab.md 的
 * 受控接缝）：实现资源管理器实际调用的全部 `FilesService` 方法——列出、监视、`identify`、单项操作、三种批量与取消——
 * 操作真正改变场景里的数据，并按 Files 合同的形状推送变化；编辑器区的场景另用正文的读取与按基线保存（基线是正文的
 * SHA-256，保存换掉目录项身份并回报前后令牌，与真实实现一致）。与真实实现的形状对照见 `plugins/lab/memory-files.test.ts`。
 *
 * 内容文件夹的清单按层记（每个内容层一份有序条目），与真实实现“一份 `content.xml` 里的嵌套条目”在列出结果上等价；
 * 清单错误用 `brokenManifests` 声明。批量的走法由 `next` 决定一次（正常、第二项失败、结果未知、慢速可取消），用来在
 * Lab 里看结果区与门禁。
 */

import {shallowRef, watch} from "@vue/reactivity";
import type {ShallowRef} from "@vue/reactivity";

import type {
    BatchHandle,
    BatchResult,
    BatchTransfer,
    ChangesMessage,
    DirectoryEntry,
    FileChange,
    FilesResult,
    FilesService,
    FolderKind,
    Identified,
    ItemResult,
    Listing,
    OperationDone,
    Scheme,
} from "nbook/plugins/files/shared/contracts";

/** 场景的初始数据：路径到正文（目录以 `/` 结尾），内容层的有序条目，以及声明为损坏的清单。 */
export interface MemorySeed {
    readonly project: ReadonlyArray<string | readonly [string, string]>;
    readonly user: ReadonlyArray<string | readonly [string, string]>;
    readonly manifests?: Readonly<Record<string, ReadonlyArray<ManifestItem>>>;
    readonly brokenManifests?: Readonly<Record<string, string>>;
}

export interface ManifestItem {
    readonly name: string;
    readonly title?: string;
    readonly icon?: string;
}

/** 下一次批量的走法；用过一次回到 `normal`。 */
export type BatchMode = "normal" | "fail-second" | "unknown" | "slow";

export interface MemoryFiles {
    readonly files: FilesService;
    /** 此刻挂着的订阅数：一个控制器每个方案一条，视图重挂不应增加。 */
    readonly watchers: Readonly<ShallowRef<number>>;
    /** 下一次批量的走法；批量开始时读一次并回到 `normal`。 */
    readonly next: ShallowRef<BatchMode>;
    /** 场景外部的变化（另一个程序新建了文件）：推一条 `external` 来源的变化。 */
    externalCreate(address: string, text: string): void;
    /** 另一个程序改写了已有文件（没有时新建）：推一条 `external` 来源的 `changed`。 */
    externalWrite(address: string, text: string): void;
    /** 另一个程序删除了文件或目录：推一条 `external` 来源的 `deleted`。 */
    externalDelete(address: string): void;
    /** 扣住此后的正文读取，直到再设为 false：在 Lab 里看读取慢时的空白与进度条。 */
    readonly readsHeld: ShallowRef<boolean>;
    dispose(): void;
}

type Node = {readonly kind: "file"; readonly ino: number; text: string} | {readonly kind: "directory"; readonly ino: number};

interface Root {
    readonly nodes: Map<string, Node>;
    readonly manifests: Map<string, ManifestItem[]>;
    readonly broken: Map<string, string>;
}

const SOURCE = {kind: "user", plugin: "nbook.explorer"} as const;
/** 正文的保存来自编辑器。 */
const EDITOR_SOURCE = {kind: "user", plugin: "nbook.editor"} as const;

/** 正文按 UTF-8 编码后的 SHA-256（十六进制），与 Files 的磁盘基线同一算法。 */
async function hashOf(text: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
const SLOW_STEP_MS = 700;

const parentOf = (path: string): string | null => (path === "" ? null : path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const join = (directory: string, name: string): string => (directory === "" ? name : `${directory}/${name}`);
const within = (path: string, ancestor: string): boolean => ancestor === "" || path === ancestor || path.startsWith(`${ancestor}/`);
const folderOf = (name: string): FolderKind => (name.endsWith(".content") ? "content" : name.endsWith(".binder") ? "binder" : "plain");
/** 与真实实现一致：目录在前，同类按名字。 */
const compare = (left: {readonly name: string; readonly kind: string}, right: {readonly name: string; readonly kind: string}): number =>
    Number(right.kind === "directory") - Number(left.kind === "directory") || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0);

function parse(address: string): {readonly scheme: Scheme; readonly path: string} | null {
    const match = /^(project|user):\/\/(.*)$/u.exec(address);
    return match === null ? null : {scheme: match[1] as Scheme, path: match[2] as string};
}

type Failure = Extract<FilesResult<never>, {readonly ok: false}>;

function fail(code: Failure["code"], detail: string): Failure {
    return {ok: false, code, detail};
}

const DONE: FilesResult<OperationDone> = {ok: true, value: {}};

export function createMemoryFiles(seed: MemorySeed): MemoryFiles {
    let ino = 0;
    const build = (entries: MemorySeed["project"]): Root => {
        const root: Root = {nodes: new Map([["", {kind: "directory", ino: ++ino}]]), manifests: new Map(), broken: new Map()};
        for (const entry of entries) {
            const [raw, text] = typeof entry === "string" ? [entry, ""] : entry;
            const directory = raw.endsWith("/");
            const path = directory ? raw.slice(0, -1) : raw;
            const segments = path.split("/");
            for (let index = 1; index < segments.length; index += 1) {
                const ancestor = segments.slice(0, index).join("/");
                if (!root.nodes.has(ancestor)) root.nodes.set(ancestor, {kind: "directory", ino: ++ino});
            }
            root.nodes.set(path, directory ? {kind: "directory", ino: ++ino} : {kind: "file", ino: ++ino, text});
        }
        return root;
    };
    const roots: Record<Scheme, Root> = {project: build(seed.project), user: build(seed.user)};
    for (const [address, items] of Object.entries(seed.manifests ?? {})) {
        const at = parse(address);
        if (at !== null) roots[at.scheme].manifests.set(at.path, items.map((item) => ({...item})));
    }
    for (const [address, detail] of Object.entries(seed.brokenManifests ?? {})) {
        const at = parse(address);
        if (at !== null) roots[at.scheme].broken.set(at.path, detail);
    }

    const listeners: Record<Scheme, Set<(message: ChangesMessage) => void>> = {project: new Set(), user: new Set()};
    const watchers = shallowRef(0);
    const count = (): void => {
        watchers.value = listeners.project.size + listeners.user.size;
    };
    let disposed = false;
    const next = shallowRef<BatchMode>("normal");
    let operation = 0;
    const cancelled = new Set<number>();

    const emit = (scheme: Scheme, events: ReadonlyArray<FileChange>): void => {
        if (events.length === 0) return;
        // 与真实链路一样，变化在操作的结果之后到达。
        queueMicrotask(() => {
            for (const listener of [...listeners[scheme]]) listener({kind: "batch", events: [...events]});
        });
    };

    // ---- 内容树 ----

    const contentRootOf = (root: Root, path: string): string | null => {
        const segments = path === "" ? [] : path.split("/");
        for (let at = segments.length; at > 0; at -= 1) {
            const candidate = segments.slice(0, at).join("/");
            if (folderOf(nameOf(candidate)) === "content") return candidate;
        }
        return null;
    };
    /** 一层目录的清单条目；不在内容树里、或清单不可用时为 null。没有登记过的内容层按空层处理。 */
    const layer = (root: Root, directory: string): ManifestItem[] | null => {
        const contentRoot = contentRootOf(root, directory);
        if (contentRoot === null || !root.manifests.has(contentRoot) || root.broken.has(contentRoot)) return null;
        let items = root.manifests.get(directory);
        if (items === undefined) {
            items = [];
            root.manifests.set(directory, items);
        }
        return items;
    };
    const manifestPath = (root: Root, path: string): string | null => {
        const contentRoot = contentRootOf(root, path);
        return contentRoot === null ? null : join(contentRoot, "content.xml");
    };
    const children = (root: Root, directory: string): string[] => [...root.nodes.keys()].filter((path) => path !== "" && parentOf(path) === directory);

    /** 从父层的清单里移除一项；返回改了清单的路径（要推变化）。 */
    const unlist = (root: Root, path: string): string | null => {
        const items = layer(root, parentOf(path) as string);
        if (items === null) return null;
        const at = items.findIndex((item) => item.name === nameOf(path));
        if (at < 0) return null;
        items.splice(at, 1);
        return manifestPath(root, path);
    };
    /** 加进清单（`before` 之前或末尾）；返回改了清单的路径。 */
    const list = (root: Root, path: string, before: string | null = null, display: ManifestItem = {name: nameOf(path)}): string | null => {
        const items = layer(root, parentOf(path) as string);
        if (items === null || items.some((item) => item.name === nameOf(path))) return null;
        const at = before === null ? -1 : items.findIndex((item) => item.name === before);
        items.splice(at < 0 ? items.length : at, 0, {...display, name: nameOf(path)});
        return manifestPath(root, path);
    };
    /** 子树整体换路径（改名与移动）：节点与内容层的清单都跟着走。 */
    const relocate = (root: Root, from: string, to: string): void => {
        for (const [path, node] of [...root.nodes]) {
            if (!within(path, from)) continue;
            root.nodes.delete(path);
            root.nodes.set(to + path.slice(from.length), node);
        }
        for (const [path, items] of [...root.manifests]) {
            if (!within(path, from)) continue;
            root.manifests.delete(path);
            root.manifests.set(to + path.slice(from.length), items);
        }
    };

    // ---- 公共核对 ----

    const resolve = (address: string): {readonly scheme: Scheme; readonly root: Root; readonly path: string} | Failure => {
        const at = parse(address);
        if (at === null) return fail("invalid-address", `不是资源地址：${address}`);
        return {...at, root: roots[at.scheme]};
    };
    const later = async <T>(value: T): Promise<T> => {
        await Promise.resolve();
        return value;
    };
    const tokenOf = (scheme: Scheme, node: Node): string => `${scheme}:${String(node.ino)}`;

    const listing = (root: Root, path: string): FilesResult<Listing> => {
        const node = root.nodes.get(path);
        if (node === undefined) return fail("not-found", `${path} 不存在`);
        if (node.kind !== "directory") return fail("not-a-directory", `${path} 不是目录`);
        const folder: FolderKind = path === "" ? "plain" : folderOf(nameOf(path));
        const contentRoot = folder === "binder" ? null : contentRootOf(root, path);
        const disk: DirectoryEntry[] = children(root, path).map((child) => {
            const entry = root.nodes.get(child) as Node;
            return entry.kind === "directory" ? {name: nameOf(child), kind: "directory", folder: folderOf(nameOf(child))} : {name: nameOf(child), kind: "file"};
        });
        if (contentRoot === null) return {ok: true, value: {folder, contentRoot: null, entries: disk.sort(compare)}};
        const atRoot = contentRoot === path;
        const marked = disk.map((entry): DirectoryEntry => {
            if (entry.kind === "directory") return {...entry, body: root.nodes.get(join(join(path, entry.name), "index.md"))?.kind === "file"};
            if (atRoot && entry.name === "content.xml") return {...entry, role: "manifest"};
            if (!atRoot && entry.name === "index.md") return {...entry, role: "body"};
            return entry;
        });
        const broken = root.broken.get(contentRoot);
        if (broken !== undefined) return {ok: true, value: {folder, contentRoot, manifest: {status: "invalid", detail: broken}, entries: marked.sort(compare)}};
        if (!root.manifests.has(contentRoot)) return {ok: true, value: {folder, contentRoot, manifest: {status: "absent", detail: `${contentRoot}/content.xml 不存在`}, entries: marked.sort(compare)}};
        const items = layer(root, path) ?? [];
        const byName = new Map(marked.map((entry) => [entry.name, entry]));
        const ordered = items.map((item): DirectoryEntry => {
            const display = {...(item.title === undefined ? {} : {title: item.title}), ...(item.icon === undefined ? {} : {icon: item.icon})};
            const entry = byName.get(item.name);
            byName.delete(item.name);
            return entry === undefined ? {name: item.name, kind: "missing", ...display, listed: true} : {...entry, ...display, listed: true};
        });
        const unlisted = [...byName.values()].sort(compare).map((entry): DirectoryEntry => ({...entry, listed: false}));
        return {ok: true, value: {folder, contentRoot, manifest: {status: "ok"}, entries: [...ordered, ...unlisted]}};
    };

    // ---- 单项 ----

    const create = (address: string, kind: "file" | "directory", before: string | null): FilesResult<OperationDone> => {
        const at = resolve(address);
        if ("ok" in at) return at;
        const parent = parentOf(at.path);
        if (parent === null || at.root.nodes.get(parent)?.kind !== "directory") return fail("not-found", `${address} 的父目录不存在`);
        if (at.root.nodes.has(at.path)) return fail("conflict", `${address} 已存在`);
        at.root.nodes.set(at.path, kind === "directory" ? {kind: "directory", ino: ++ino} : {kind: "file", ino: ++ino, text: ""});
        const manifest = list(at.root, at.path, before);
        emit(at.scheme, [{type: "created", path: at.path, source: SOURCE}, ...(manifest === null ? [] : [{type: "changed" as const, path: manifest, source: SOURCE}])]);
        return DONE;
    };

    const rename = (address: string, name: string, expected: string | undefined, convertTo: "content" | "plain" | null): FilesResult<OperationDone> => {
        const at = resolve(address);
        if ("ok" in at) return at;
        const node = at.root.nodes.get(at.path);
        if (node === undefined || at.path === "") return fail("not-found", `${address} 不存在`);
        if (expected !== undefined && tokenOf(at.scheme, node) !== expected) return fail("source-changed", `${address} 已被替换或移走`);
        const target = join(parentOf(at.path) as string, name);
        if (target !== at.path && at.root.nodes.has(target)) return fail("conflict", `${name} 已存在`);
        const items = layer(at.root, parentOf(at.path) as string);
        const item = items?.find((candidate) => candidate.name === nameOf(at.path));
        relocate(at.root, at.path, target);
        const events: FileChange[] = [{type: "renamed", path: target, from: at.path, source: SOURCE}];
        if (item !== undefined) {
            (items as ManifestItem[]).splice((items as ManifestItem[]).indexOf(item), 1, {...item, name});
            events.push({type: "changed", path: manifestPath(at.root, target) as string, source: SOURCE});
        }
        if (convertTo === "content" && !at.root.manifests.has(target)) {
            // 转为内容文件夹：按现有的子项（与列出同序）建一份清单。
            const existing = children(at.root, target).map((child) => ({name: nameOf(child), kind: (at.root.nodes.get(child) as Node).kind}));
            at.root.manifests.set(target, existing.sort(compare).map((entry) => ({name: entry.name})));
            at.root.nodes.set(join(target, "content.xml"), {kind: "file", ino: ++ino, text: ""});
            events.push({type: "created", path: join(target, "content.xml"), source: SOURCE});
        }
        if (convertTo === "plain") for (const key of [...at.root.manifests.keys()]) if (within(key, target)) at.root.manifests.delete(key);
        emit(at.scheme, events);
        return DONE;
    };

    /** 改一层目录的清单：`edit` 返回失败时不改、不推变化。 */
    const editLayer = (directory: string, edit: (items: ManifestItem[]) => Failure | null): FilesResult<OperationDone> => {
        const at = resolve(directory);
        if ("ok" in at) return at;
        const items = layer(at.root, at.path);
        if (items === null) return fail("unsupported", `${directory} 不是可用的内容文件夹层`);
        const failed = edit(items);
        if (failed !== null) return failed;
        emit(at.scheme, [{type: "changed", path: manifestPath(at.root, at.path) as string, source: SOURCE}]);
        return DONE;
    };
    /** 改一项在父层清单里的条目。 */
    const editItem = (address: string, edit: (items: ManifestItem[], name: string) => Failure | null): FilesResult<OperationDone> => {
        const slash = address.lastIndexOf("/");
        return editLayer(address.slice(0, slash).replace(/:\/$/u, "://"), (items) => edit(items, address.slice(slash + 1)));
    };

    // ---- 批量 ----

    const transfer = (scheme: Scheme, root: Root, item: BatchTransfer, copy: boolean): {readonly result: ItemResult; readonly events: FileChange[]} => {
        const source = parse(item.source);
        const target = parse(item.target);
        if (source === null || target === null || source.scheme !== scheme || target.scheme !== scheme) return {result: {status: "failed", code: "invalid-address", detail: "源与目标要在同一个方案里"}, events: []};
        const node = root.nodes.get(source.path);
        if (node === undefined) return {result: {status: "failed", code: "not-found", detail: `${item.source} 不存在`}, events: []};
        if (item.expected !== undefined && tokenOf(scheme, node) !== item.expected) return {result: {status: "failed", code: "source-changed", detail: `${item.source} 已被替换或移走`}, events: []};
        if (within(target.path, source.path)) return {result: {status: "failed", code: "into-itself", detail: "不能放进自己或自己的后代"}, events: []};
        if (root.nodes.has(target.path)) return {result: {status: "failed", code: "conflict", detail: `${item.target} 已存在`}, events: []};
        if (root.nodes.get(parentOf(target.path) as string)?.kind !== "directory") return {result: {status: "failed", code: "not-found", detail: "目标目录不存在"}, events: []};
        const events: FileChange[] = [];
        const display = layer(root, parentOf(source.path) as string)?.find((candidate) => candidate.name === nameOf(source.path));
        if (copy) {
            for (const [path, entry] of [...root.nodes]) {
                if (!within(path, source.path)) continue;
                root.nodes.set(target.path + path.slice(source.path.length), entry.kind === "file" ? {kind: "file", ino: ++ino, text: entry.text} : {kind: "directory", ino: ++ino});
            }
            for (const [path, items] of [...root.manifests]) if (within(path, source.path) && path !== source.path) root.manifests.set(target.path + path.slice(source.path.length), items.map((entry) => ({...entry})));
            events.push({type: "created", path: target.path, source: SOURCE});
        } else {
            const removed = unlist(root, source.path);
            relocate(root, source.path, target.path);
            events.push({type: "renamed", path: target.path, from: source.path, source: SOURCE});
            if (removed !== null) events.push({type: "changed", path: removed, source: SOURCE});
        }
        const added = list(root, target.path, null, display === undefined ? {name: nameOf(target.path)} : {...display, name: nameOf(target.path)});
        if (added !== null) events.push({type: "changed", path: added, source: SOURCE});
        return {result: {status: "done"}, events};
    };

    const remove = (scheme: Scheme, root: Root, address: string, expected: string | undefined): {readonly result: ItemResult; readonly events: FileChange[]} => {
        const at = parse(address);
        if (at === null || at.scheme !== scheme || at.path === "") return {result: {status: "failed", code: "invalid-address", detail: address}, events: []};
        const node = root.nodes.get(at.path);
        if (node === undefined) return {result: {status: "failed", code: "not-found", detail: `${address} 不存在`}, events: []};
        if (expected !== undefined && tokenOf(scheme, node) !== expected) return {result: {status: "failed", code: "source-changed", detail: `${address} 已被替换或移走`}, events: []};
        const manifest = unlist(root, at.path);
        for (const path of [...root.nodes.keys()]) if (within(path, at.path)) root.nodes.delete(path);
        for (const path of [...root.manifests.keys()]) if (within(path, at.path)) root.manifests.delete(path);
        return {result: {status: "done"}, events: [{type: "deleted", path: at.path, source: SOURCE}, ...(manifest === null ? [] : [{type: "changed" as const, path: manifest, source: SOURCE}])]};
    };

    const batch = <T>(addresses: ReadonlyArray<string>, items: ReadonlyArray<T>, step: (scheme: Scheme, root: Root, item: T) => {readonly result: ItemResult; readonly events: FileChange[]}): BatchHandle => {
        const id = ++operation;
        const mode = next.value;
        next.value = "normal";
        const run = async (): Promise<FilesResult<BatchResult>> => {
            await Promise.resolve();
            const first = addresses[0] === undefined ? null : parse(addresses[0]);
            if (first === null) return {ok: true, value: {items: [], manifests: []}};
            const root = roots[first.scheme];
            const results: ItemResult[] = [];
            for (const [index, item] of items.entries()) {
                if (mode === "slow" && index > 0) await new Promise((resume) => setTimeout(resume, SLOW_STEP_MS));
                if (disposed) return fail("target-gone", "Lab 场景已经卸载");
                if (cancelled.has(id)) {
                    results.push({status: "cancelled"});
                    continue;
                }
                if (mode === "fail-second" && index === 1) {
                    results.push({status: "failed", code: "permission-denied", detail: "Lab：模拟第二项没有权限"});
                    continue;
                }
                const outcome = step(first.scheme, root, item);
                results.push(outcome.result);
                emit(first.scheme, outcome.events);
            }
            cancelled.delete(id);
            // 结果未知：项都做了，回复在路上丢了。
            if (mode === "unknown") return {ok: false, code: "unknown-outcome", detail: "Lab：模拟回复丢失，结果未知", cause: "disconnected"};
            return {ok: true, value: {items: results, manifests: []}};
        };
        const result = run();
        return {
            result,
            cancel: async () => {
                cancelled.add(id);
                return {ok: true, value: {found: true}};
            },
        };
    };

    const readsHeld = shallowRef(false);
    const heldReads: Array<() => void> = [];
    const stopHeld = watch(readsHeld, (held) => {
        if (!held) for (const release of heldReads.splice(0)) release();
    });
    const waitForReads = async (): Promise<void> => {
        while (readsHeld.value) await new Promise<void>((resolve) => heldReads.push(resolve));
    };

    const readText = async (address: string): Promise<FilesResult<{readonly text: string; readonly baseline: {readonly hash: string}}>> => {
        await waitForReads();
        const at = resolve(address);
        if ("ok" in at) return at;
        const node = at.root.nodes.get(at.path);
        if (node === undefined) return fail("not-found", `${address} 不存在`);
        if (node.kind !== "file") return fail("not-a-file", `${address} 不是文件`);
        return {ok: true, value: {text: node.text, baseline: {hash: await hashOf(node.text)}}};
    };

    const writeText = async (address: string, text: string, baseline: {readonly hash: string}): Promise<FilesResult<{readonly baseline: {readonly hash: string}; readonly identity?: {readonly before: string; readonly after: string}}>> => {
        await Promise.resolve();
        const at = resolve(address);
        if ("ok" in at) return at;
        const node = at.root.nodes.get(at.path);
        if (node === undefined) return fail("not-found", `${address} 不存在`);
        if (node.kind !== "file") return fail("not-a-file", `${address} 不是文件`);
        const current = await hashOf(node.text);
        if (current !== baseline.hash) return {ok: false, code: "conflict", detail: `${address} 在读取后被修改过`, current: {hash: current}};
        // 与真实实现一样，保存经“写临时文件再改名”替换目录项：身份换新。
        const replaced: Node = {kind: "file", ino: ++ino, text};
        at.root.nodes.set(at.path, replaced);
        emit(at.scheme, [{type: "changed", path: at.path, source: EDITOR_SOURCE}]);
        return {ok: true, value: {baseline: {hash: await hashOf(text)}, identity: {before: tokenOf(at.scheme, node), after: tokenOf(at.scheme, replaced)}}};
    };

    const files: FilesService = {
        list: (address) => {
            const at = resolve(address);
            return later("ok" in at ? at : listing(at.root, at.path));
        },
        read: (address) => readText(address),
        write: (address, text, baseline) => writeText(address, text, baseline),
        identify: (addresses) => {
            const items: Identified["items"] = addresses.map((address) => {
                const at = resolve(address);
                if ("ok" in at) return {code: "invalid-address", detail: address};
                const node = at.root.nodes.get(at.path);
                return node === undefined ? {code: "not-found", detail: `${address} 不存在`} : {kind: node.kind, token: tokenOf(at.scheme, node)};
            });
            return later({ok: true, value: {items}});
        },
        create: (address, kind, options) => later(create(address, kind, options?.before ?? null)),
        createContent: (address) => later(create(`${address}/index.md`, "file", null)),
        rename: (address, name, options) => later(rename(address, name, options?.expected, null)),
        convert: (address, to, options) => {
            const name = nameOf(parse(address)?.path ?? "");
            return later(rename(address, to === "content" ? `${name}.content` : name.replace(/\.content$/u, ""), options?.expected, to));
        },
        reorder: (directory, names) => later(editLayer(directory, (items) => {
            const current = items.map((item) => item.name);
            if (current.length !== names.length || !current.every((name) => names.includes(name))) return fail("invalid-order", "顺序要恰好是这一层清单里的全部条目");
            items.sort((left, right) => names.indexOf(left.name) - names.indexOf(right.name));
            return null;
        })),
        display: (address, display) => later(editItem(address, (items, name) => {
            const at = items.findIndex((item) => item.name === name);
            if (at < 0) return fail("not-found", `${name} 不在清单里`);
            const item = items[at] as ManifestItem;
            const title = display.title === undefined ? item.title : display.title ?? undefined;
            const icon = display.icon === undefined ? item.icon : display.icon ?? undefined;
            items[at] = {name, ...(title === undefined ? {} : {title}), ...(icon === undefined ? {} : {icon})};
            return null;
        })),
        include: (address, options) => later(editItem(address, (items, name) => {
            if (items.some((item) => item.name === name)) return fail("conflict", `${name} 已在清单里`);
            const at = options?.before === undefined ? -1 : items.findIndex((item) => item.name === options.before);
            items.splice(at < 0 ? items.length : at, 0, {name});
            return null;
        })),
        drop: (address) => later(editItem(address, (items, name) => {
            const at = items.findIndex((item) => item.name === name);
            if (at < 0) return fail("not-found", `${name} 不在清单里`);
            items.splice(at, 1);
            return null;
        })),
        move: (items) => batch(items.map((item) => item.source), items, (scheme, root, item) => transfer(scheme, root, item, false)),
        copy: (items) => batch(items.map((item) => item.source), items, (scheme, root, item) => transfer(scheme, root, item, true)),
        delete: (items) => batch(items.map((item) => item.address), items, (scheme, root, item) => remove(scheme, root, item.address, item.expected)),
        watch: (scheme, listener) => {
            listeners[scheme].add(listener);
            count();
            queueMicrotask(() => {
                if (listeners[scheme].has(listener)) listener({kind: "ready"});
            });
            return () => {
                listeners[scheme].delete(listener);
                count();
            };
        },
    };

    return {
        files,
        watchers,
        next,
        externalCreate: (address, text) => {
            const at = parse(address);
            if (at === null || roots[at.scheme].nodes.has(at.path)) return;
            roots[at.scheme].nodes.set(at.path, {kind: "file", ino: ++ino, text});
            emit(at.scheme, [{type: "changed", path: at.path, source: {kind: "external"}}]);
        },
        externalWrite: (address, text) => {
            const at = parse(address);
            if (at === null) return;
            const node = roots[at.scheme].nodes.get(at.path);
            if (node !== undefined && node.kind !== "file") return;
            if (node === undefined) roots[at.scheme].nodes.set(at.path, {kind: "file", ino: ++ino, text});
            else node.text = text;
            emit(at.scheme, [{type: "changed", path: at.path, source: {kind: "external"}}]);
        },
        externalDelete: (address) => {
            const at = parse(address);
            if (at === null || !roots[at.scheme].nodes.has(at.path) || at.path === "") return;
            for (const path of [...roots[at.scheme].nodes.keys()]) if (within(path, at.path)) roots[at.scheme].nodes.delete(path);
            emit(at.scheme, [{type: "deleted", path: at.path, source: {kind: "external"}}]);
        },
        readsHeld,
        dispose: () => {
            disposed = true;
            stopHeld();
            readsHeld.value = false;
            listeners.project.clear();
            listeners.user.clear();
            count();
        },
    };
}
