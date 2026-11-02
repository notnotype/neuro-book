/**
 * 挂载方案的执行（docs/specs/workspace/resources.md 的“挂载方案”与状态表的“挂载点”）：注册方只给声明，真实目录的打开、
 * 授权、按需建目录与寿命都在这里。
 *
 * 挂载点的寿命：第一次请求时打开（`opening`），请求从开始到结算一直借用它；没有借用且空闲满 `IDLE_CLOSE_MS` 时关闭
 * （`closing`），关闭途中到来的请求等它关完再重新打开。只在借用为 0 时关闭，所以在途的写入（`tracked`）不会碰上已关的
 * Backend。这次没有订阅（不声明 `watch`），ChangeHub 不开监视，关闭只是作废它。
 */

import {lstat, mkdir} from "node:fs/promises";
import {join} from "node:path";

import type {RuntimeClock, Scope} from "@notnotype/nb-runtime/lifecycle";

import type {Baseline, ChangeSource, FileText, Listing, OperationDone, SavedText} from "../shared/contracts";
import {pathProblem} from "../shared/resource";
import {renderVirtual} from "../shared/schemes";
import type {MountDeclaration, MountedSchemeSpec, SchemeCaller, SchemeCapability, SchemeOperation, ServerFilesResult, VirtualListing} from "../shared/schemes";
import {createChangeHub} from "./changes";
import type {ChangeHub} from "./changes";
import {createPlain, saveText, toResult} from "./execute";
import {createFilesService, hashOf} from "./files-service";
import type {FilesService} from "./files-service";
import {openRoot} from "./rooted";
import type {RootedRoot} from "./rooted";

export const IDLE_CLOSE_MS = 5 * 60 * 1000;
/** 软上限：超出时先关空闲的，都在用就照开并写诊断。 */
export const MOUNT_SOFT_LIMIT = 64;

const CAPABILITY: Record<SchemeOperation, SchemeCapability> = {read: "read", list: "list", write: "write", create: "write", realPath: "realPath"};
/** 会建目录的操作：读与列出不会让挂载点或 `ensure` 的子目录出现。 */
const MATERIALIZES: ReadonlySet<SchemeOperation> = new Set(["write", "create", "realPath"]);

export interface MountedOptions {
    readonly scheme: string;
    /** 每次请求时取注册方的声明：贡献撤回后取不到，请求按方案不存在结束。 */
    readonly spec: () => MountedSchemeSpec;
    readonly scope: Scope;
    readonly clock: RuntimeClock;
    /** 挂载点保存用的锁目录放在它下面（按挂载点名分）。 */
    readonly lockRoot: string;
    readonly record: (level: "info" | "warn", event: string, message: string, data?: unknown, error?: unknown) => void;
}

interface Opened {
    readonly root: RootedRoot;
    readonly service: FilesService;
    readonly changes: ChangeHub;
    readonly scope: Scope;
}

interface Mount {
    state: "opening" | "open" | "closing";
    /** 打开的结果；目录不存在时为 null，打不开时为失败（这两种都不留在表里，见 `#borrow`）。 */
    ready: Promise<Opened | Fail | null>;
    /** 这次打开会不会建目录。 */
    readonly materializing: boolean;
    borrows: number;
    lastUsed: number;
    closed: Promise<void> | null;
    cancelIdle: (() => void) | null;
}

type Fail = Extract<ServerFilesResult<never>, {ok: false}>;
const fail = (code: Fail["code"], detail: string): Fail => ({ok: false, code, detail});

export class MountedScheme {
    readonly #options: MountedOptions;
    readonly #mounts = new Map<string, Mount>();
    #stopping = false;
    #inFlight = 0;
    #drained: (() => void) | null = null;

    constructor(options: MountedOptions) {
        this.#options = options;
    }

    /** 当前打开着的挂载点数（含正在打开、正在关闭的）。 */
    get openCount(): number {
        return this.#mounts.size;
    }

    list(path: string, caller: SchemeCaller): Promise<ServerFilesResult<Listing | VirtualListing>> {
        return this.#run<Listing | VirtualListing>("list", path, caller, async (spec) => {
            const root = await spec.root(caller);
            return {ok: true, value: {kind: "virtual", description: root.description, entries: root.entries.map((entry) => ({...entry, address: `${this.#options.scheme}://${entry.name}`}))}};
        }, async (target) => {
            const {opened, mount, path: inner} = target;
            if (opened === null) return emptyIfMountRoot(inner, target.declaration);
            const listed = await opened.service.list(inner);
            if (!listed.ok) {
                // `ensure` 的子目录还没建：列出它为空，与挂载点本身还没建同样对待。
                if (listed.code === "not-found" && (target.declaration.ensure ?? []).includes(inner)) return {ok: true, value: {folder: "plain", contentRoot: null, entries: []}};
                return toResult(listed);
            }
            const visible = [];
            for (const entry of listed.value.entries) {
                const child = inner === "" ? entry.name : `${inner}/${entry.name}`;
                if (target.spec.authorize(caller, mount, "read", child) !== true) continue;
                if (entry.kind === "link") {
                    // 链接按它实际指向的位置再判一次：经链接别名露出受保护的文件与直接露出一样。
                    const resolved = await opened.root.resolve(child);
                    if ("ok" in resolved || target.spec.authorize(caller, mount, "read", resolved.realPath) !== true) continue;
                }
                visible.push(entry);
            }
            return {ok: true, value: {...listed.value, entries: visible}};
        });
    }

    read(path: string, caller: SchemeCaller): Promise<ServerFilesResult<FileText>> {
        return this.#run("read", path, caller, async (spec) => {
            const root = await spec.root(caller);
            const text = renderVirtual({kind: "virtual", description: root.description, entries: root.entries.map((entry) => ({...entry, address: `${this.#options.scheme}://${entry.name}`}))});
            return {ok: true, value: {text, baseline: {hash: hashOf(new TextEncoder().encode(text))}}};
        }, async ({opened, path: inner}) => (opened === null ? fail("not-found", `${this.#address(path)} 不存在`) : toResult(await opened.service.read(inner))));
    }

    write(path: string, text: string, baseline: Baseline, caller: SchemeCaller, source: ChangeSource): Promise<ServerFilesResult<SavedText>> {
        return this.#run("write", path, caller, async () => fail("permission-denied", `${this.#address("")} 是只读的目录`), async ({opened, path: inner}) => {
            if (opened === null) return fail("not-found", `${this.#address(path)} 不存在`);
            return toResult(await saveText(opened, inner, text, baseline, source));
        });
    }

    create(path: string, kind: "file" | "directory", caller: SchemeCaller, source: ChangeSource): Promise<ServerFilesResult<OperationDone>> {
        return this.#run("create", path, caller, async () => fail("permission-denied", `${this.#address("")} 是只读的目录`), async ({opened, path: inner}) => {
            if (opened === null) return fail("not-found", `${this.#address(path)} 的上级不存在`);
            if (inner === "") return fail("conflict", `${this.#address(path)} 已存在`);
            return toResult(await createPlain(opened, inner, kind, source));
        });
    }

    realPath(path: string, caller: SchemeCaller): Promise<ServerFilesResult<{readonly path: string}>> {
        return this.#run("realPath", path, caller, async () => fail("unsupported-capability", `${this.#address("")} 是虚拟目录，没有真实路径`), async ({opened, path: inner}) => {
            if (opened === null) return fail("not-found", `${this.#address(path)} 不存在`);
            return toResult(await opened.service.realPath(inner));
        });
    }

    /** 方案撤回或入口停止：拒新请求，等在途请求结算，再关闭全部挂载点；之后不再重开。 */
    async stop(): Promise<void> {
        this.#stopping = true;
        if (this.#inFlight > 0) await new Promise<void>((resolve) => (this.#drained = resolve));
        await Promise.all([...this.#mounts.entries()].map(([name, mount]) => this.#close(name, mount)));
    }

    /**
     * 一次请求的公共步骤：能力 → 虚拟根 → 挂载点声明 → 按地址里的路径授权 → 借用挂载点（需要时建目录）→ 按真实路径授权 →
     * 执行。借用从打开到结算一直持有。
     */
    async #run<T>(
        operation: SchemeOperation,
        path: string,
        caller: SchemeCaller,
        atRoot: (spec: MountedSchemeSpec) => Promise<ServerFilesResult<T>>,
        body: (target: {readonly spec: MountedSchemeSpec; readonly mount: string; readonly path: string; readonly declaration: MountDeclaration; readonly opened: Opened | null}) => Promise<ServerFilesResult<T>>,
    ): Promise<ServerFilesResult<T>> {
        if (this.#stopping) return fail("unknown-scheme", `没有方案 ${this.#options.scheme}://`);
        this.#inFlight += 1;
        try {
            let spec: MountedSchemeSpec;
            try {
                spec = this.#options.spec();
            } catch {
                // 贡献已撤回（取实现抛 PluginStateError）：这一刻方案已经不在。
                return fail("unknown-scheme", `没有方案 ${this.#options.scheme}://`);
            }
            if (!spec.capabilities.includes(CAPABILITY[operation])) return fail("unsupported-capability", `${this.#options.scheme}:// 不支持${operation}`);
            if (path === "") return await atRoot(spec);
            const slash = path.indexOf("/");
            const mount = slash < 0 ? path : path.slice(0, slash);
            const inner = slash < 0 ? "" : path.slice(slash + 1);
            const declaration = await spec.mount(mount);
            if (declaration === null) return fail("not-found", `${this.#address(path)} 不存在`);
            const lexical = spec.authorize(caller, mount, operation, inner);
            if (lexical !== true) return fail(lexical, `${this.#address(path)}：${lexical}`);

            const materialize = MATERIALIZES.has(operation);
            const lease = await this.#borrow(mount, spec, declaration, materialize);
            try {
                if ("ok" in lease) return lease;
                const opened = lease.opened;
                if (opened !== null && materialize) {
                    const ensured = await ensureDirectory(opened.root, inner, declaration);
                    if (ensured !== null) return ensured;
                }
                if (opened !== null) {
                    const real = await realPathFor(opened.root, operation, inner);
                    if (real !== null) {
                        const granted = spec.authorize(caller, mount, operation, real);
                        if (granted !== true) return fail(granted, `${this.#address(path)}：${granted}`);
                    }
                }
                return await body({spec, mount, path: inner, declaration, opened});
            } finally {
                if (!("ok" in lease)) lease.release();
            }
        } finally {
            this.#inFlight -= 1;
            if (this.#inFlight === 0) this.#drained?.();
        }
    }

    async #borrow(name: string, spec: MountedSchemeSpec, declaration: MountDeclaration, materialize: boolean): Promise<{readonly opened: Opened | null; release(): void} | Fail> {
        for (;;) {
            const existing = this.#mounts.get(name);
            if (existing?.state === "closing") {
                await existing.closed;
                continue;
            }
            const mount = existing ?? this.#open(name, spec, declaration, materialize);
            mount.borrows += 1;
            mount.cancelIdle?.();
            mount.cancelIdle = null;
            const opened = await mount.ready;
            if (opened !== null && !("ok" in opened)) return {opened, release: () => this.#release(name, mount)};
            // 没打开（目录不存在或不可用）的挂载点不留在表里：别处（例如内核建会话目录）随后建了它，下一次请求就该看到。
            mount.borrows -= 1;
            if (this.#mounts.get(name) === mount && mount.borrows === 0) this.#mounts.delete(name);
            if (opened !== null) return opened;
            // 与一个不建目录的请求共用了这次打开：要建目录的请求自己再开一次。
            if (materialize && declaration.create && !mount.materializing) continue;
            return {opened: null, release: () => undefined};
        }
    }

    #open(name: string, spec: MountedSchemeSpec, declaration: MountDeclaration, materialize: boolean): Mount {
        const mount: Mount = {state: "opening", ready: Promise.resolve(null), materializing: materialize, borrows: 0, lastUsed: this.#options.clock.now(), closed: null, cancelIdle: null};
        mount.ready = this.#openDirectory(name, spec.container, declaration, materialize).then((opened) => {
            if (opened !== null && !("ok" in opened)) mount.state = "open";
            return opened;
        }, (error: unknown) => {
            this.#options.record("warn", "files.mount.open-failed", `${this.#address(name)} 打开失败`, {scheme: this.#options.scheme, mount: name}, error);
            return fail("io-failed", `${this.#address(name)} 打开失败`);
        });
        this.#mounts.set(name, mount);
        this.#enforceLimit();
        return mount;
    }

    async #openDirectory(name: string, container: string, declaration: MountDeclaration, materialize: boolean): Promise<Opened | Fail | null> {
        const path = join(container, name);
        const notDirectory = fail("not-a-directory", `${this.#address(name)} 不是普通目录`);
        const present = await realDirectory(path);
        if (present === "other") return notDirectory;
        if (present === "missing") {
            if (!materialize || !declaration.create) return null;
            // 只在受管容器下建一层：容器本身必须是真实目录，挂载点名是合法单段（注册表已核对），不会经链接建到别处。
            if ((await realDirectory(container)) !== "directory") return fail("root-gone", `${this.#options.scheme}:// 的容器目录不可用`);
            try {
                await mkdir(path, {mode: 0o700});
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            }
            if ((await realDirectory(path)) !== "directory") return notDirectory;
        }
        const report = (event: string, error: unknown): void => this.#options.record("warn", `files.${event}`, "文件保存的收尾出错", {scheme: this.#options.scheme}, error);
        const root = await openRoot(path, {controlDirectory: false, lockDirectory: join(this.#options.lockRoot, name), report});
        if ("ok" in root) return null;
        const record = this.#options.record;
        return {
            root,
            service: createFilesService({root, folderKinds: false, diagnose: (event, detail, cause) => record("warn", event, detail, {cause})}),
            changes: createChangeHub({root, controlDirectory: false, clock: this.#options.clock, record}),
            scope: this.#options.scope,
        };
    }

    #release(name: string, mount: Mount): void {
        mount.borrows -= 1;
        mount.lastUsed = this.#options.clock.now();
        if (mount.borrows > 0 || mount.state !== "open") return;
        mount.cancelIdle = this.#options.clock.schedule(() => {
            mount.cancelIdle = null;
            if (mount.borrows === 0 && mount.state === "open" && this.#mounts.get(name) === mount) void this.#close(name, mount);
        }, IDLE_CLOSE_MS);
    }

    #enforceLimit(): void {
        if (this.#mounts.size <= MOUNT_SOFT_LIMIT) return;
        const idle = [...this.#mounts.entries()].filter(([, mount]) => mount.state === "open" && mount.borrows === 0).sort(([, a], [, b]) => a.lastUsed - b.lastUsed);
        for (const [name, mount] of idle) {
            if (this.#mounts.size <= MOUNT_SOFT_LIMIT) return;
            void this.#close(name, mount);
        }
        if (this.#mounts.size > MOUNT_SOFT_LIMIT) this.#options.record("info", "files.mount.over-limit", `${this.#options.scheme}:// 同时打开的挂载点超过 ${String(MOUNT_SOFT_LIMIT)} 个，都在使用`, {scheme: this.#options.scheme, open: this.#mounts.size});
    }

    #close(name: string, mount: Mount): Promise<void> {
        if (mount.closed !== null) return mount.closed;
        mount.state = "closing";
        mount.cancelIdle?.();
        mount.cancelIdle = null;
        mount.closed = (async () => {
            const opened = await mount.ready;
            if (opened !== null && !("ok" in opened)) opened.changes.close();
            if (this.#mounts.get(name) === mount) this.#mounts.delete(name);
        })();
        return mount.closed;
    }

    #address(path: string): string {
        return `${this.#options.scheme}://${path}`;
    }
}

/** 目录项的类型，不跟随最后一段的链接。 */
async function realDirectory(path: string): Promise<"directory" | "missing" | "other"> {
    try {
        const info = await lstat(path);
        return info.isDirectory() ? "directory" : "other";
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
        throw error;
    }
}

/** 目标落在 `ensure` 的子目录下时，在打开的根里排他建这一层；已是文件或链接时不覆盖。 */
async function ensureDirectory(root: RootedRoot, inner: string, declaration: MountDeclaration): Promise<Fail | null> {
    const first = inner === "" ? "" : (inner.split("/")[0] as string);
    if (first === "" || !(declaration.ensure ?? []).includes(first)) return null;
    const absolute = join(root.real, first);
    const present = await realDirectory(absolute);
    if (present === "directory") return null;
    if (present === "other") return fail("not-a-directory", `${first} 不是目录`);
    try {
        await mkdir(absolute, {mode: 0o700});
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") return fail("io-failed", `无法建立 ${first}`);
    }
    return (await realDirectory(absolute)) === "directory" ? null : fail("not-a-directory", `${first} 不是目录`);
}

/**
 * 按真实路径授权要用的位置：已存在的目标解析链接；新建与写一个还不存在的文件看父目录的真实路径加名字。解析失败（不存在、
 * 越出根）时返回 null，交给操作本身报出确切的失败。
 */
async function realPathFor(root: RootedRoot, operation: SchemeOperation, inner: string): Promise<string | null> {
    if (inner === "") return "";
    if (operation === "create") {
        const slot = await root.resolveSlot(inner);
        return "ok" in slot ? null : slot.path;
    }
    const resolved = await root.resolve(inner);
    return "ok" in resolved ? null : resolved.realPath;
}

function emptyIfMountRoot(inner: string, declaration: MountDeclaration): ServerFilesResult<Listing> {
    // 挂载点的目录还没建：列出它（或它的 `ensure` 子目录）为空；更深的位置不存在。
    if (inner === "" || (declaration.ensure ?? []).includes(inner)) return {ok: true, value: {folder: "plain", contentRoot: null, entries: []}};
    return fail("not-found", `${inner} 不存在`);
}

export function validMountName(name: string): boolean {
    return name !== "" && !name.includes("/") && pathProblem(name) === null;
}
