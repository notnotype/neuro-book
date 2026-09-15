/** 宿主身份接线。请求只提供客户端定位凭证与访问标识，主体、根与代次由服务端核验。 */
import {getHeader, type H3Event} from "h3";
import {
    STORAGE_ACCESS_CONTEXT_HEADER, STORAGE_CLIENT_CREDENTIAL_HEADER, isStorageAccessContextId,
    type StorageContextReleaseDto, type StorageUserContextDto,
} from "nbook/shared/storage/host";
import type {StorageActionRequest, StorageActionResponse} from "nbook/shared/storage/action";
import {StorageStateRegistry, type DefinedStorageState} from "nbook/shared/storage/definition";
import {
    StorageClientCredentialInvalidError, StorageContextInvalidError, StorageServiceClosedError,
} from "nbook/shared/storage/storage-errors";
import {
    deriveStorageClientId, deriveStorageSessionGeneration, localStorageSubject,
    StorageAccessContextRegistry, STORAGE_LOCAL_SESSION_GENERATION, userStorageSubject,
    type StorageAccessContextClaims, type StorageAccessContextLease,
} from "nbook/server/storage/access-context";
import {requireStorageActionState, runStorageAction} from "nbook/server/storage/storage-actions";
import {StorageHandlePool} from "nbook/server/storage/handle-pool";
import {StorageService, type StorageHandle, type StorageHandleInput} from "nbook/server/storage/storage-service";
import type {StoragePartitionStoreOptions} from "nbook/server/storage/partition-store";
import type {StorageLockAdapter} from "nbook/server/storage/partition-lock";
import {ensureStorageIdentityDomain, readStorageIdentityDomain} from "nbook/server/storage/identity-domain";
import {
    assertStorageRootIdentity, captureStorageRootIdentity, storageRootIdentityDigest,
    userStorageRootFromWorkspaceRoot,
} from "nbook/server/storage/storage-address";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";

/** 测试宿主的依赖覆盖；生产不接受请求提供的根、主体、定义或锁适配器。 */
export type StorageHostContextOverrides = {
    readonly storageRoot?: AbsoluteFsPath;
    readonly resolveSubject?: (event: H3Event, storageRoot: AbsoluteFsPath) => Promise<string> | string;
    /** 测试装载的受信定义；生产入口是 `registerStorageStateDefinitions`。 */
    readonly definitions?: readonly DefinedStorageState<unknown>[];
    /** 分区锁适配器；测试用它注入确定性的等锁故障与竞争窗口。 */
    readonly lockAdapter?: StorageLockAdapter;
    /** 文件层选项；测试用它注入确定性的替换失败与重试窗口。 */
    readonly fileOptions?: StoragePartitionStoreOptions;
    /** 打开句柄的接缝；测试用它注入打开竞态与句柄计数。 */
    readonly openHandle?: (input: StorageHandleInput, service: StorageService) => Promise<StorageHandle>;
    /** 访问空闲期限；测试用短期限验证自然到期后停写。 */
    readonly accessContextIdleMs?: number;
};

type StorageHostState = {
    readonly ready: Promise<void>;
    readonly accessContexts: StorageAccessContextRegistry;
    readonly registry: StorageStateRegistry;
    readonly service: StorageService;
    readonly pool: StorageHandlePool;
    readonly pending: Set<Promise<unknown>>;
    readonly overrides: StorageHostContextOverrides | null;
    readonly authChecks: Set<AuthCheck>;
    closing: Promise<void> | null;
};

type AuthCheck = {sessionGeneration: string | null; revoked: boolean; readonly beforeBinding: Set<string>};

function createState(
    overrides: StorageHostContextOverrides | null = null,
    previous: PreviousStorageHostState | undefined = undefined,
): StorageHostState {
    let ready = Promise.resolve();
    if (previous !== undefined) {
        // 旧宿主也会初始化身份元数据。关闭标记阻止旧入口继续接纳，新宿主等它排空后再开始。
        previous.closing ??= Promise.allSettled([previous.registry.close(), ...previous.pending]).then(() => undefined);
        ready = previous.closing;
    }
    const registry = new StorageStateRegistry();
    for (const definition of overrides?.definitions ?? []) {
        registry.register(definition);
    }
    const service = new StorageService({registry, lockAdapter: overrides?.lockAdapter, fileOptions: overrides?.fileOptions});
    const openHandle = overrides?.openHandle;
    return {
        ready,
        accessContexts: new StorageAccessContextRegistry(
            overrides?.accessContextIdleMs === undefined ? {} : {idleMs: overrides.accessContextIdleMs},
        ),
        registry,
        service,
        pool: new StorageHandlePool({
            openHandle: openHandle === undefined
                ? (input) => service.openHandle(input)
                : (input) => openHandle(input, service),
        }),
        pending: new Set(),
        overrides,
        authChecks: new Set(),
        closing: null,
    };
}

/**
 * HMR 换代前的 V2 槽：只有访问上下文 registry，没有 service 与句柄池。
 *
 * 形状不同不能原地复用；关闭旧入口并排空身份初始化后，新 owner 才接纳操作。
 */
type PreviousStorageHostState = {
    readonly registry: {close: () => Promise<void>};
    readonly pending: Set<Promise<unknown>>;
    closing: Promise<void> | null;
};

/**
 * HMR 的新旧模块共用 owner；已接纳操作捕获所属代次，不能进入下一次测试或运行期。
 *
 * 换代策略：槽名随宿主状态形状升级，新模块发现旧槽时关闭旧 owner，让旧模块持有的访问
 * 全部失效并排空在途身份初始化（旧模块仍保留自己的槽引用，不能删除）；浏览器用原定位凭证
 * 重新初始化即可回到同一 local 分区，不需要迁移运行期状态。
 */
const globalForStorageHost = globalThis as typeof globalThis & {
    __nbookStorageHostV2?: PreviousStorageHostState;
    __nbookStorageHostV3?: StorageHostState;
};
globalForStorageHost.__nbookStorageHostV3 ??= createState(null, globalForStorageHost.__nbookStorageHostV2);
function state(): StorageHostState {
    return globalForStorageHost.__nbookStorageHostV3!;
}

/** 签发一次独立的 user 访问；只有显式初始化可以创建身份域元数据。 */
export function issueStorageUserContext(event: H3Event): Promise<StorageUserContextDto> {
    return operate(async (owner, assertActive, bindSession) => {
        const claims = await resolveClaims(event, owner, true, assertActive, bindSession);
        assertActive();
        return {contextId: owner.accessContexts.issue(claims).contextId};
    });
}

/** 每次请求重新核验；长连接和已打开句柄的撤销接线由后续 adapter 持有。 */
export function resolveStorageAccessContext(event: H3Event): Promise<StorageAccessContextLease> {
    return operate((owner, assertActive, bindSession) => resolveContextLease(event, owner, assertActive, bindSession));
}

/**
 * 在已核验的 user 访问下执行一次值动作。
 *
 * 顺序固定：重新核验访问声明 → 解析注册定义 → 取得该访问与 owner 的共享句柄 → 执行；
 * 句柄绑定本次访问的真实根身份，核验与打开之间根被替换就拒绝，取得句柄后与每个真实文件副作用前
 * 都重新检查授权，因此慢打开期间被释放的访问连读取都不再继续。
 */
export function performStorageUserAction(event: H3Event, action: StorageActionRequest): Promise<StorageActionResponse> {
    return operate(async (owner, assertActive, bindSession) => {
        const lease = await resolveContextLease(event, owner, assertActive, bindSession);
        const definition = requireStorageActionState(owner.registry, action);
        assertActive();
        const held = await owner.pool.acquire({
            contextId: lease.contextId,
            owner: definition.owner,
            expectedRootIdentity: lease.rootIdentity,
            context: {
                scope: lease.scope,
                storageRoot: lease.storageRoot,
                identityDomain: lease.identityDomain,
                subject: lease.subject,
                clientId: lease.clientId,
            },
            guard: () => owner.accessContexts.assertLive(lease.contextId),
        });
        try {
            owner.accessContexts.assertLive(lease.contextId);
            await assertLeaseRootIdentity(lease);
            return await runStorageAction({handle: held.handle, state: definition, action});
        } finally {
            // 释放以排空为准：等待句柄停用，但排空失败不能覆盖本次动作的真实结果。
            await held.release().catch(() => undefined);
        }
    });
}

/**
 * 受信模块登记状态定义，是运行期的唯一策略来源。
 *
 * 请求路径不能注册定义、换掉已登记实例或改变 locality；冲突定义按注册表合同拒绝，需要新定义时重建宿主。
 */
export function registerStorageStateDefinitions(definitions: readonly DefinedStorageState<unknown>[]): void {
    const owner = state();
    if (owner.closing !== null) {
        throw new StorageServiceClosedError();
    }
    for (const definition of definitions) {
        owner.registry.register(definition);
    }
}

/** 解析一次访问的当前声明；调用方负责提供所在操作边界与在途核验。 */
async function resolveContextLease(
    event: H3Event, owner: StorageHostState, assertActive: () => void, bindSession: (generation: string) => void,
): Promise<StorageAccessContextLease> {
    const contextId = requireStorageAccessContextId(event);
    const claims = await resolveClaims(event, owner, false, assertActive, bindSession);
    assertActive();
    return owner.accessContexts.resolve({...claims, contextId});
}

/** 打开句柄后重新核对真实目录身份：核验与打开之间被替换的根不能继续执行本次动作。 */
async function assertLeaseRootIdentity(lease: StorageAccessContextLease): Promise<void> {
    const current = await captureStorageRootIdentity(lease.storageRoot);
    if (storageRootIdentityDigest(current) !== lease.rootIdentity) {
        throw new StorageContextInvalidError("claims-mismatch", "Storage 存储根在核验与打开之间已被替换，请重新初始化");
    }
}

/** 幂等释放自己的一次访问；不清除浏览器定位凭证或状态记录。 */
export function releaseStorageUserContext(event: H3Event): Promise<StorageContextReleaseDto> {
    return operate(async (owner, assertActive, bindSession) => {
        const contextId = requireStorageAccessContextId(event);
        const claims = await resolveClaims(event, owner, false, assertActive, bindSession);
        assertActive();
        return {released: owner.accessContexts.release({contextId, subject: claims.subject, clientId: claims.clientId})};
    });
}

/**
 * 登录替换和退出只撤销对应 session。尚未解开 cookie 的核验暂存有界撤销集合，绑定后比对并释放，
 * 防止 cookie 解析晚于撤销时漏掉旧请求；不持有运行期永久 session 黑名单。
 */
export function revokeStorageAuthSession(sessionId: string): void {
    const owner = state();
    const generation = deriveStorageSessionGeneration(sessionId);
    owner.accessContexts.revokeSession(generation);
    for (const check of owner.authChecks) {
        if (check.sessionGeneration === generation) check.revoked = true;
        else if (check.sessionGeneration === null) {
            if (check.beforeBinding.size >= 256) check.revoked = true;
            else check.beforeBinding.add(generation);
        }
    }
}

/**
 * 同一个关闭 promise 拒绝新接纳并排空在途初始化与值操作；身份目录创建也在此生命周期内。
 *
 * 关闭是正常停机：已接纳的有效操作可以排空；授权失效导致的停写由 guard 在副作用前拒绝对应操作。
 */
export function disposeStorageHost(): Promise<void> {
    return closeState(state());
}

function closeState(owner: StorageHostState): Promise<void> {
    if (owner.closing === null) {
        // 先停止接纳身份与值操作，随后句柄池与服务共同排空已接纳操作。
        const contextsClosed = owner.accessContexts.close();
        const poolClosed = owner.pool.close();
        const serviceClosed = owner.service.close();
        owner.closing = Promise.allSettled([owner.ready, contextsClosed, poolClosed, serviceClosed, ...owner.pending]).then(() => undefined);
    }
    return owner.closing;
}

/** 测试换代先排空旧 owner；迟到操作不会写入新的隔离根。 */
export async function setStorageHostContextForTest(next: StorageHostContextOverrides | null): Promise<void> {
    await closeState(state());
    globalForStorageHost.__nbookStorageHostV3 = createState(next === null ? null : {...next});
}

function operate<T>(action: (owner: StorageHostState, assertActive: () => void, bindSession: (generation: string) => void) => Promise<T>): Promise<T> {
    const owner = state();
    if (owner.closing !== null) return Promise.reject(new StorageServiceClosedError());
    const check: AuthCheck = {sessionGeneration: null, revoked: false, beforeBinding: new Set()};
    owner.authChecks.add(check);
    const assertActive = (): void => {
        if (owner.closing !== null) throw new StorageServiceClosedError();
        if (check.revoked) throw new StorageContextInvalidError("auth-changed", "Storage 核验期间鉴权状态已变化，请重试");
    };
    const bindSession = (generation: string): void => {
        check.sessionGeneration = generation;
        check.revoked ||= check.beforeBinding.has(generation);
        check.beforeBinding.clear();
        assertActive();
    };
    const result = owner.ready.then(() => {assertActive(); return action(owner, assertActive, bindSession);});
    owner.pending.add(result);
    const finish = (): void => {owner.pending.delete(result); owner.authChecks.delete(check);};
    void result.then(finish, finish);
    return result;
}

async function resolveClaims(
    event: H3Event, owner: StorageHostState, initialize: boolean, assertActive: () => void,
    bindSession: (generation: string) => void,
): Promise<StorageAccessContextClaims> {
    const clientId = requireClientId(event);
    const storageRoot = owner.overrides?.storageRoot ?? userStorageRootFromWorkspaceRoot(resolveRuntimeWorkspaceRoot());
    let subject: string | null = null;
    let sessionGeneration = STORAGE_LOCAL_SESSION_GENERATION;
    if (owner.overrides?.resolveSubject !== undefined) {
        bindSession(STORAGE_LOCAL_SESSION_GENERATION);
        subject = await owner.overrides.resolveSubject(event, storageRoot);
    } else {
        // 导入宿主模块本身不初始化 Prisma/默认 data；只有经过路径隔离的真实鉴权请求进入 auth。
        const auth = await import("nbook/server/utils/auth");
        assertActive();
        if (auth.isAuthEnabled()) {
            sessionGeneration = deriveStorageSessionGeneration(await auth.requireCurrentAuthSessionId(event));
            bindSession(sessionGeneration);
            const user = await auth.requireCurrentUser(event);
            subject = userStorageSubject(user.id);
        } else {
            bindSession(STORAGE_LOCAL_SESSION_GENERATION);
        }
    }
    assertActive();
    if (initialize) await ensureStorageIdentityDomain(storageRoot);
    assertActive();
    const root = await captureStorageRootIdentity(storageRoot);
    const identityDomain = await readStorageIdentityDomain(storageRoot);
    if (identityDomain === null) throw new StorageContextInvalidError("claims-mismatch", "Storage 身份域已被移除，请重新初始化");
    await assertStorageRootIdentity(storageRoot, root);
    assertActive();
    return {
        scope: "user", storageRoot, identityDomain,
        rootIdentity: `${root.device}:${root.inode}:${root.born}`,
        subject: subject ?? localStorageSubject(identityDomain), sessionGeneration, clientId,
    };
}

function requireClientId(event: H3Event): string {
    const header = getHeader(event, STORAGE_CLIENT_CREDENTIAL_HEADER)?.trim();
    if (!header) throw new StorageClientCredentialInvalidError("missing", "Storage 请求缺少客户端定位凭证");
    return deriveStorageClientId(header);
}

function requireStorageAccessContextId(event: H3Event): string {
    const header = getHeader(event, STORAGE_ACCESS_CONTEXT_HEADER)?.trim() ?? "";
    if (!isStorageAccessContextId(header)) throw new StorageContextInvalidError("context-id", "Storage 请求缺少合法访问上下文标识");
    return header;
}
