/**
 * Storage 本地服务核心。
 *
 * 句柄绑定宿主显式提供的受信访问上下文（scope、存储根、身份域、主体、客户端）与一个 owner；
 * 服务只从上下文和注册定义推导分区与文件地址，不从页面、隐式当前用户、请求 body 或工作目录推导。
 * 释放句柄会拒绝新操作、停止订阅并等待已接纳请求收口；服务关闭同样作用于全部句柄。
 */

import {mkdir, realpath} from "node:fs/promises";
import path from "node:path";
import type {
    StorageAddress,
    StorageCredential,
    StorageReadResult,
    StorageReclaimResult,
    StorageRepairCredential,
    StorageScope,
    StorageLocality,
} from "nbook/shared/storage/contract";
import {isSafeStorageIdentifier, type DefinedStorageState, type StorageStateRegistry} from "nbook/shared/storage/definition";
import {
    StorageAddressInvalidError,
    StorageContextInvalidError,
    StorageHandleClosedError,
    StorageIoError,
    StorageServiceClosedError,
} from "nbook/shared/storage/storage-errors";
import {
    assertStorageIdentityContext,
    assertStorageRecordAddress,
    assertStorageRootIdentity,
    captureStorageRootIdentity,
    storageRootIdentityDigest,
    type StorageRootIdentity,
    storagePartitionPaths,
    storageRecordFileName,
    type StoragePartitionPaths,
} from "nbook/server/storage/storage-address";
import {StoragePartitionLock, type StorageLockAdapter} from "nbook/server/storage/partition-lock";
import {captureStorageValue} from "nbook/server/storage/storage-value";
import {
    StoragePartitionStore,
    type StorageGenerationBox,
    type StorageMutationGuard,
    type StoragePartitionStoreOptions,
    type StorageRecordPolicy,
} from "nbook/server/storage/partition-store";
import {
    StorageSubscriptionHub,
    type StorageSubscription,
} from "nbook/server/storage/storage-subscription";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

/** 宿主核验并显式提供的受信访问上下文。 */
export type StorageAccessContext = {
    readonly scope: StorageScope;
    /** user 为 WorkspaceRoot/.nbook/storage，project 为 ProjectRoot/.nbook/storage。 */
    readonly storageRoot: AbsoluteFsPath;
    /** data 内持久身份域；project 记录也按写入时的身份域隔离。 */
    readonly identityDomain: string;
    /** 服务端核验的当前用户，或无鉴权模式的本地主体。 */
    readonly subject: string;
    /** 客户端标识；local 记录必需，shared 记录会被忽略。 */
    readonly clientId?: string;
};

export type StorageHandleInput = {
    readonly owner: string;
    readonly context: StorageAccessContext;
    /** 受信边界注入的授权检查；每个真实副作用前调用，见 `StorageMutationGuard`。 */
    readonly guard?: StorageMutationGuard;
    /** 已签发访问只能打开原根；提供身份时不创建缺失目录。 */
    readonly expectedRootIdentity?: string;
};

export type StorageServiceOptions = {
    readonly registry: StorageStateRegistry;
    /** 分区锁适配器；测试用它注入确定性竞争/失效故障。 */
    readonly lockAdapter?: StorageLockAdapter;
    readonly fileOptions?: StoragePartitionStoreOptions;
};

export type StorageReadOptions = {
    readonly resource?: string;
};

export type StorageConditionalInput = {
    readonly expected: StorageCredential;
    readonly resource?: string;
};

export type StorageSaveInput<T> = StorageConditionalInput & {
    readonly value: T;
};

export type StorageRepairInput<T> = {
    readonly expected: StorageRepairCredential;
    readonly value: T;
    readonly resource?: string;
};

export type StorageReclaimInput = {
    readonly targets: readonly StorageAddress[];
};

export type StorageSubscribeOptions<T> = {
    readonly resource?: string;
    readonly onUpdate?: (snapshot: StorageReadResult<T>) => void;
    readonly onError?: (error: unknown) => void;
};

type PartitionHandle = {
    readonly partition: StoragePartitionPaths;
    readonly store: StoragePartitionStore;
    readonly box: StorageGenerationBox;
};

type ResolvedRecord = PartitionHandle & {
    readonly policy: StorageRecordPolicy;
    readonly identity: string;
};

export class StorageService {
    private readonly registry: StorageStateRegistry;
    private readonly lockAdapter: StorageLockAdapter | undefined;
    private readonly fileOptions: StoragePartitionStoreOptions;
    private readonly subscriptions = new StorageSubscriptionHub();
    private readonly handles = new Set<StorageHandle>();
    private readonly opening = new Set<Promise<StorageHandle>>();
    private closing: Promise<void> | null = null;
    private closed = false;

    constructor(options: StorageServiceOptions) {
        this.registry = options.registry;
        this.lockAdapter = options.lockAdapter;
        this.fileOptions = options.fileOptions ?? {};
    }

    /** 建立 owner 句柄；上下文不合法或服务已关闭时不给可写句柄。 */
    async openHandle(input: StorageHandleInput): Promise<StorageHandle> {
        if (this.closed) {
            throw new StorageServiceClosedError();
        }
        const pending = this.createHandle({...input, context: {...input.context}});
        this.opening.add(pending);
        try { return await pending; } finally { this.opening.delete(pending); }
    }

    private async createHandle({owner, context, guard, expectedRootIdentity}: StorageHandleInput): Promise<StorageHandle> {
        if (context.scope !== "user" && context.scope !== "project") {
            throw new StorageContextInvalidError("scope", `Storage scope 非法：${String(context.scope)}`);
        }
        if (!isSafeStorageIdentifier(owner)) {
            throw new StorageContextInvalidError("owner", `Storage owner 不是安全逻辑标识：${owner}`);
        }
        assertStorageIdentityContext({
            identityDomain: context.identityDomain,
            subject: context.subject,
            clientId: context.clientId,
            owner,
        });
        if (!path.isAbsolute(context.storageRoot)) {
            throw new StorageContextInvalidError("storage-root", `Storage 存储根必须是绝对路径：${context.storageRoot}`);
        }
        // 建出存储根本身就是真实副作用：授权已经失效时不能先创建目录，也不能把目录创建算作无害读取。
        guard?.();
        const requestedRoot = expectedRootIdentity === undefined
            ? await this.canonicalStorageRoot(context.storageRoot)
            : context.storageRoot;
        const rootIdentity = await captureStorageRootIdentity(requestedRoot);
        if (expectedRootIdentity !== undefined && storageRootIdentityDigest(rootIdentity) !== expectedRootIdentity) {
            throw new StorageContextInvalidError("claims-mismatch", "Storage 存储根已被替换，请重新初始化");
        }
        // 已有根仍需规范化，以便短路径/大小写别名使用相同的锁与订阅身份；这一步不创建目录。
        const root = absoluteFsPath(await realpath(requestedRoot));
        await assertStorageRootIdentity(root, rootIdentity);
        guard?.();
        if (this.closed) throw new StorageServiceClosedError();
        const handle = new StorageHandle({
            onFinished: (finished) => { this.handles.delete(finished); },
            registry: this.registry,
            subscriptions: this.subscriptions,
            owner,
            scope: context.scope,
            root,
            rootIdentity,
            identityDomain: context.identityDomain,
            subject: context.subject,
            clientId: context.clientId,
            lockAdapter: this.lockAdapter,
            fileOptions: this.fileOptions,
            guard,
        });
        await handle.initialize();
        if (this.closed) {
            // 关闭竞态中打开的句柄不属于任何调用方：先释放，别把它留在服务之外。
            await handle.release();
            throw new StorageServiceClosedError();
        }
        this.handles.add(handle);
        return handle;
    }

    /** 服务关闭：拒绝新句柄与新操作，停止全部订阅，等待已接纳请求收口。 */
    close(): Promise<void> {
        if (this.closing !== null) return this.closing;
        this.closed = true;
        this.closing = Promise.all([
            this.subscriptions.closeAll(),
            ...[...this.handles].map((handle) => handle.close()),
            Promise.allSettled([...this.opening]),
        ]).then(() => { this.handles.clear(); });
        return this.closing;
    }

    /** 规范化存储根：同一物理根的不同拼写必须落到同一把分区锁。 */
    private async canonicalStorageRoot(storageRoot: AbsoluteFsPath): Promise<AbsoluteFsPath> {
        try {
            await mkdir(storageRoot, {recursive: true});
            return absoluteFsPath(await realpath(storageRoot));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new StorageIoError("mkdir", storageRoot, message, {cause: error});
        }
    }

}

type StorageHandleOptions = {
    readonly onFinished: (handle: StorageHandle) => void;
    readonly registry: StorageStateRegistry;
    readonly subscriptions: StorageSubscriptionHub;
    readonly owner: string;
    readonly scope: StorageScope;
    readonly root: AbsoluteFsPath;
    readonly rootIdentity: StorageRootIdentity;
    readonly identityDomain: string;
    readonly subject: string;
    readonly clientId: string | undefined;
    readonly lockAdapter: StorageLockAdapter | undefined;
    readonly fileOptions: StoragePartitionStoreOptions;
    readonly guard: StorageMutationGuard | undefined;
};

export class StorageHandle {
    readonly owner: string;
    private readonly onFinished: (handle: StorageHandle) => void;
    private readonly registry: StorageStateRegistry;
    private readonly hub: StorageSubscriptionHub;
    private readonly scope: StorageScope;
    private readonly root: AbsoluteFsPath;
    private readonly rootIdentity: StorageRootIdentity;
    private readonly identityDomain: string;
    private readonly subject: string;
    private readonly clientId: string | undefined;
    private readonly lock: StoragePartitionLock;
    private readonly fileOptions: StoragePartitionStoreOptions;
    private readonly guard: StorageMutationGuard | undefined;
    private readonly partitions = new Map<string, PartitionHandle>();
    private readonly subscriptions = new Set<StorageSubscription<unknown>>();
    private readonly accepted = new Set<Promise<unknown>>();
    private readonly writes = new Map<string, Promise<void>>();
    private finishing: Promise<void> | null = null;
    private closedReason: "released" | "service-closed" | null = null;

    constructor(options: StorageHandleOptions) {
        this.onFinished = options.onFinished;
        this.registry = options.registry;
        this.hub = options.subscriptions;
        this.owner = options.owner;
        this.scope = options.scope;
        this.root = options.root;
        this.rootIdentity = options.rootIdentity;
        this.identityDomain = options.identityDomain;
        this.subject = options.subject;
        this.clientId = options.clientId;
        this.fileOptions = options.fileOptions;
        this.guard = options.guard;
        this.lock = new StoragePartitionLock(options.root, {adapter: options.lockAdapter, rootIdentity: options.rootIdentity});
    }

    /** 在签发句柄时捕获可访问分区代次，尚未读过任何记录的旧句柄也不能绕过回收。 */
    async initialize(): Promise<void> {
        return this.run(async () => {
            for (const locality of this.clientId === undefined ? ["shared" as const] : ["local" as const, "shared" as const]) {
                const resolved = this.resolvePartition(locality);
                await resolved.store.bindGeneration(resolved.box);
            }
        });
    }

    /** 读取分类；缺失不创建文件，损坏与更高版本带修复凭据返回。 */
    async read<T>(definition: DefinedStorageState<T>, options: StorageReadOptions = {}): Promise<StorageReadResult<T>> {
        return this.run(async () => {
            const resolved = this.resolveRecord(definition, options.resource);
            return await resolved.store.read(resolved.policy, resolved.box) as StorageReadResult<T>;
        });
    }

    /** 条件保存；提交成功后通知本进程的订阅者。 */
    async save<T>(definition: DefinedStorageState<T>, input: StorageSaveInput<T>): Promise<StorageCredential> {
        return this.run(async () => {
            const resolved = this.resolveRecord(definition, input.resource);
            const captured = {expected: {...input.expected}, value: captureStorageValue(input.value, resolved.policy)};
            const credential = await this.enqueueWrite(resolved, () => resolved.store.save(resolved.policy, resolved.box, captured));
            this.hub.notify(resolved.identity);
            return credential;
        });
    }

    /** 条件删除；删除标记使旧写不能复活已删除的值。 */
    async remove(definition: DefinedStorageState<unknown>, input: StorageConditionalInput): Promise<StorageCredential> {
        return this.run(async () => {
            const resolved = this.resolveRecord(definition, input.resource);
            const captured = {expected: {...input.expected}};
            const credential = await this.enqueueWrite(resolved, () => resolved.store.remove(resolved.policy, resolved.box, captured));
            this.hub.notify(resolved.identity);
            return credential;
        });
    }

    /** 将旧 schema 升级到已登记的当前格式，条件提交前保存诊断原件。 */
    async migrate<T>(definition: DefinedStorageState<T>, input: StorageConditionalInput & {readonly value?: T}): Promise<StorageCredential> {
        return this.run(async () => {
            const resolved = this.resolveRecord(definition, input.resource);
            const registered = this.registry.resolve(definition);
            const captured = {
                expected: {...input.expected},
                value: input.value === undefined ? undefined : captureStorageValue(input.value, resolved.policy),
                migrate: registered.migrate,
            };
            const credential = await this.enqueueWrite(resolved, () => resolved.store.migrate(resolved.policy, resolved.box, captured));
            this.hub.notify(resolved.identity);
            return credential;
        });
    }

    /** 显式修复/重置：凭据绑定原始内容，原件保留在隔离区。 */
    async repair<T>(definition: DefinedStorageState<T>, input: StorageRepairInput<T>): Promise<StorageCredential> {
        return this.run(async () => {
            const resolved = this.resolveRecord(definition, input.resource);
            const captured = {expected: {...input.expected}, value: captureStorageValue(input.value, resolved.policy)};
            const credential = await this.enqueueWrite(resolved, () => resolved.store.repair(resolved.policy, resolved.box, captured));
            this.hub.notify(resolved.identity);
            return credential;
        });
    }

    /** 显式墓碑回收：先持久化新分区代次，再释放选定墓碑。 */
    async reclaim(definition: DefinedStorageState<unknown>, input: StorageReclaimInput): Promise<StorageReclaimResult> {
        return this.run(async () => {
            const registered = this.resolveDefinition(definition);
            if (input.targets.length === 0 || input.targets.length > registered.limits.maxRecords) {
                throw new StorageAddressInvalidError("targets", `Storage 回收需列出 1..${String(registered.limits.maxRecords)} 个明确目标：${registered.key}`);
            }
            const resolved = input.targets.map((target) => this.resolveRecord(registered, target.resource));
            const first = resolved[0]!;
            const result = await this.enqueueWrite(first, () => first.store.reclaim(resolved.map((entry) => entry.policy), first.box));
            this.hub.notifyPartition(first.partition.directory);
            return result;
        });
    }

    /** 返回初始快照，持续观察本服务及进程外提交；句柄拥有订阅生命周期。 */
    async subscribe<T>(
        definition: DefinedStorageState<T>,
        options: StorageSubscribeOptions<T> = {},
    ): Promise<StorageSubscription<T>> {
        return this.run(async () => {
            const resolved = this.resolveRecord(definition, options.resource);
            const subscription = await this.hub.open<T>(
                {identity: resolved.identity, owner: this.owner, read: () => resolved.store.read(resolved.policy, resolved.box)},
                {
                    // 值已由注册定义的 validate 校验为 T，这里只做一次类型对齐。
                    onUpdate: options.onUpdate as ((snapshot: StorageReadResult<unknown>) => void) | undefined,
                    onError: options.onError,
                },
            );
            if (this.closedReason !== null) {
                await subscription.close();
                throw new StorageHandleClosedError(this.owner, this.closedReason);
            }
            const owned: StorageSubscription<T> = {
                snapshot: subscription.snapshot,
                refresh: () => this.run(() => subscription.refresh()),
                close: async () => {
                    await subscription.close();
                    this.subscriptions.delete(owned as StorageSubscription<unknown>);
                },
            };
            this.subscriptions.add(owned as StorageSubscription<unknown>);
            return owned;
        });
    }

    /** 释放句柄：拒绝新操作、停止订阅、等待已接纳请求收口；已保存数据不受影响。 */
    async release(): Promise<void> {
        await this.finish("released");
    }

    /** 服务关闭时的收口；与 release 语义相同，但保留服务关闭作为拒绝原因。 */
    async close(): Promise<void> {
        await this.finish("service-closed");
    }

    private finish(reason: "released" | "service-closed"): Promise<void> {
        if (this.finishing !== null) return this.finishing;
        this.closedReason = reason;
        this.finishing = Promise.allSettled([
            ...[...this.subscriptions].map((subscription) => subscription.close()),
            ...this.accepted,
        ]).then(() => {
            this.subscriptions.clear();
            this.partitions.clear();
            this.onFinished(this);
        });
        return this.finishing;
    }

    /** 接纳一次操作；释放后不再接纳新操作，并等待已接纳请求收口。 */
    private async run<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
        if (this.closedReason !== null) {
            throw new StorageHandleClosedError(this.owner, this.closedReason);
        }
        const promise = operation();
        this.accepted.add(promise);
        try {
            return await promise;
        } finally {
            this.accepted.delete(promise);
        }
    }

    /** 分区本就共享一把磁盘锁；入锁前也保持接纳顺序，让回收等待较早写入，失败不堵住后续意图。 */
    private enqueueWrite<TResult>(record: ResolvedRecord, operation: () => Promise<TResult>): Promise<TResult> {
        const identity = record.partition.directory;
        const pending = (this.writes.get(identity) ?? Promise.resolve()).then(operation);
        const tail = pending.then(() => undefined, () => undefined);
        this.writes.set(identity, tail);
        void tail.then(() => {
            if (this.writes.get(identity) === tail) this.writes.delete(identity);
        });
        return pending;
    }

    /** 解析注册策略、分区与句柄代次；读写只使用注册后的归属与校验规则。 */
    private resolveRecord(definition: DefinedStorageState<unknown>, resource?: string): ResolvedRecord {
        const registered = this.resolveDefinition(definition);
        const resolvedResource = assertStorageRecordAddress(registered, resource === undefined ? undefined : {resource});
        const policy: StorageRecordPolicy = {
            key: registered.key,
            resource: resolvedResource,
            schemaVersion: registered.schemaVersion,
            validate: registered.validate,
            limits: registered.limits,
        };
        const handle = this.resolvePartition(registered.locality);
        return {
            ...handle,
            policy,
            identity: `${handle.partition.directory}\u0000${storageRecordFileName(policy.key, policy.resource)}`,
        };
    }

    private resolvePartition(locality: StorageLocality): PartitionHandle {
        const partition = storagePartitionPaths({
            storageRoot: this.root,
            identityDomain: this.identityDomain,
            subject: this.subject,
            locality,
            clientId: this.clientId,
            owner: this.owner,
        });
        const cached = this.partitions.get(partition.relative);
        const handle = cached ?? {
            partition,
            store: new StoragePartitionStore(partition, this.lock, {...this.fileOptions, guard: this.guard}, this.rootIdentity),
            box: {value: null},
        };
        if (cached === undefined) {
            this.partitions.set(partition.relative, handle);
        }
        return handle;
    }

    private resolveDefinition<T>(definition: DefinedStorageState<T>): DefinedStorageState<unknown> {
        if (definition.owner !== this.owner) {
            throw new StorageContextInvalidError(
                "owner",
                `Storage 句柄绑定 owner ${this.owner}，不能访问 ${definition.owner}`,
            );
        }
        if (definition.scope !== this.scope) {
            throw new StorageContextInvalidError(
                "scope",
                `Storage 句柄绑定 scope ${this.scope}，不能访问 ${definition.scope}`,
            );
        }
        return this.registry.resolve(definition) as DefinedStorageState<unknown>;
    }
}
