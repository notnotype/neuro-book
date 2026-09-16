/** 宿主身份接线。请求只提供客户端定位凭证、访问标识与 project 代次定位，主体、根与代次由服务端核验。 */
import {mkdir} from "node:fs/promises";
import {getHeader, type H3Event} from "h3";
import {
    STORAGE_ACCESS_CONTEXT_HEADER, STORAGE_CLIENT_CREDENTIAL_HEADER, isStorageAccessContextId,
    type StorageContextReleaseDto, type StorageProjectContextDto, type StorageProjectContextRequest,
    type StorageUserContextDto,
} from "nbook/shared/storage/host";
import type {StorageActionRequest, StorageActionResponse} from "nbook/shared/storage/action";
import {StorageStateRegistry, type DefinedStorageState} from "nbook/shared/storage/definition";
import {
    isStorageDomainError,
    StorageClientCredentialInvalidError, StorageContextInvalidError,
    StorageIoError, StorageServiceClosedError,
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
    assertStorageRootIdentity, assertStorageTargetContained, captureStorageRootIdentity,
    projectStorageRootFromProjectRoot, storageRootIdentityDigest,
    userStorageRootFromWorkspaceRoot,
    type StorageRootIdentity,
} from "nbook/server/storage/storage-address";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
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
    previousReady: Promise<void> | null | undefined = undefined,
): StorageHostState {
    // 旧宿主也会初始化身份元数据与句柄池；新宿主等它排空后再开始，旧宿主关闭失败也在这里保留。
    const ready = previousReady ?? Promise.resolve();
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
 * HMR 换代前的 V2 槽：访问上下文 registry 在 `registry` 字段，没有 service 与句柄池。
 *
 * V2 不认 project 绑定（registry 没有 project 方法，claims 没有精确定位字段），不能原地复用。
 */
type PreviousStorageHostV2State = {
    readonly registry: {close: () => Promise<void>};
    readonly pending: Set<Promise<unknown>>;
    closing: Promise<void> | null;
};

/**
 * HMR 换代前的 V3 槽：`registry` 是状态定义注册表（没有 `close()`），访问上下文在 `accessContexts`。
 *
 * V3 的 claims 没有精确定位字段，同样不能原地复用；关闭时只关访问上下文、service 与句柄池。
 */
type PreviousStorageHostV3State = {
    readonly accessContexts: {close: () => Promise<void>};
    readonly service?: {close: () => Promise<void>};
    readonly pool?: {close: () => Promise<void>};
    readonly pending: Set<Promise<unknown>>;
    closing: Promise<void> | null;
};

/**
 * 关闭换代前的槽。
 *
 * 关闭失败必须保留：新 owner 不能在旧访问上下文/句柄池未收口时被当成可服务。
 * 在途身份初始化失败只是那些请求自己的结果，不构成所有权交接失败。
 */
function closePreviousSlot(slot: PreviousStorageHostV2State | PreviousStorageHostV3State): Promise<void> {
    const closes: readonly (Promise<void> | undefined)[] = "accessContexts" in slot
        ? [slot.accessContexts.close(), slot.service?.close(), slot.pool?.close()]
        : [slot.registry.close()];
    return Promise.all(closes.filter((close) => close !== undefined))
        .then(() => Promise.allSettled([...slot.pending]))
        .then(() => undefined);
}

/**
 * HMR 的新旧模块共用 owner；已接纳操作捕获所属代次，不能进入下一次测试或运行期。
 *
 * 换代策略：槽名随宿主状态形状升级，新模块发现旧槽时关闭旧 registry、旧 service 与旧句柄池，
 * 让旧模块持有的访问全部失效并排空在途身份初始化（旧模块仍保留自己的槽引用，不能删除）；
 * 浏览器用原定位凭证重新初始化即可回到同一 local 分区，Project 访问重新走一次精确 ready 解析。
 */
const globalForStorageHost = globalThis as typeof globalThis & {
    __nbookStorageHostV2?: PreviousStorageHostV2State;
    __nbookStorageHostV3?: PreviousStorageHostV3State;
    __nbookStorageHostV4?: StorageHostState;
};
// V2 与 V3 的字段名不同，不能按同一个形状读旧槽；旧模块仍持有自己的槽引用，不能删除。
const previousStorageHostSlot = globalForStorageHost.__nbookStorageHostV3 ?? globalForStorageHost.__nbookStorageHostV2;
if (previousStorageHostSlot !== undefined) {
    previousStorageHostSlot.closing ??= closePreviousSlot(previousStorageHostSlot);
    // 新 owner 只在有请求或关闭时才观察这个 promise，先挂一个观察者避免无人处理的拒绝。
    void previousStorageHostSlot.closing.catch(() => undefined);
}
globalForStorageHost.__nbookStorageHostV4 ??= createState(null, previousStorageHostSlot?.closing);
function state(): StorageHostState {
    return globalForStorageHost.__nbookStorageHostV4!;
}

/** 签发一次独立的 user 访问；只有显式初始化可以创建身份域元数据。 */
export function issueStorageUserContext(event: H3Event): Promise<StorageUserContextDto> {
    return operate(async (owner, assertActive, bindSession) => {
        const claims = await resolveUserClaims(event, owner, true, assertActive, bindSession);
        assertActive();
        return {contextId: owner.accessContexts.issue(claims).contextId};
    });
}

/** 每次请求重新核验；长连接和已打开句柄的撤销接线由后续 adapter 持有。 */
export function resolveStorageAccessContext(event: H3Event): Promise<StorageAccessContextLease> {
    return operate((owner, assertActive, bindSession) => resolveContextLease(event, owner, assertActive, bindSession));
}

/** 在已核验的 user 访问下执行一次动作。 */
export function performStorageUserAction(event: H3Event, action: StorageActionRequest): Promise<StorageActionResponse> {
    return operate(async (owner, assertActive, bindSession) => {
        const lease = await resolveContextLease(event, owner, assertActive, bindSession);
        const definition = action.kind === "bind"
            ? owner.registry.resolveOwner(action.owner)
            : requireStorageActionState(owner.registry, action);
        assertActive();
        return await performLeasedAction(owner, lease, definition, action);
    });
}

/**
 * 在已核验访问下执行一次动作。
 *
 * 顺序固定：取得该访问与 owner 的句柄 → 执行；句柄绑定本次访问的真实根身份与请求携带的分区代次，
 * 核验与打开之间根被替换、或绑定与分区当前代次不符都拒绝，取得句柄后与每个真实文件副作用前都重新检查授权，
 * 因此慢打开期间被释放的访问连读取都不再继续。
 *
 * `assertTarget` 与 `revalidateTarget` 是 Project 访问的写入目标核验：等待 Storage 锁期间 Project 锁失效、
 * Project 物理根或 data 物理根被替换时，仅凭访问上下文存活不能停写，必须在真实副作用前重新核验。
 * 同步撤销检查排在异步复核之后，使 await 期间发生的撤销同样停写。
 *
 * 句柄按代次绑定复用：两个请求只有在声明同一组代次时才共享句柄，绑定不匹配不会借到别人的句柄。
 */
async function performLeasedAction(
    owner: StorageHostState,
    lease: StorageAccessContextLease,
    definition: DefinedStorageState<unknown>,
    action: StorageActionRequest,
    assertTarget: (() => void) | undefined = undefined,
    revalidateTarget: (() => Promise<void>) | undefined = undefined,
): Promise<StorageActionResponse> {
    const acquire = {
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
        guard: async () => {
            // 物理复核先执行：它包含 await，之后才做同步撤销检查，await 期间的撤销因此同样停写。
            if (revalidateTarget !== undefined) {
                await assertProjectWriteTarget(revalidateTarget);
            }
            if (lease.dataRootIdentity !== undefined) {
                await assertDataRootIdentity(owner, lease.dataRootIdentity);
            }
            owner.accessContexts.assertLive(lease.contextId);
            if (assertTarget !== undefined) {
                await assertProjectWriteTarget(assertTarget);
            }
        },
    };
    // `bind` 不复用池内句柄：它必须读到分区当前代次，而不是别的请求当时捕获的那一个。
    const held = action.kind === "bind"
        ? await owner.pool.acquireDetached(acquire)
        : await owner.pool.acquire({...acquire, binding: action.binding});
    try {
        owner.accessContexts.assertLive(lease.contextId);
        await assertLeaseRootIdentity(lease);
        if (action.kind === "bind") {
            return {kind: "bind", binding: held.handle.capturePartitionBinding()};
        }
        return await runStorageAction({handle: held.handle, state: definition, action});
    } finally {
        // 释放以排空为准：等待句柄停用，但排空失败不能覆盖本次动作的真实结果。
        await held.release().catch(() => undefined);
    }
}

/**
 * Project 目标失效对 Storage 调用方就是访问上下文失效；Project 内部错误不进 Storage 错误投影。
 */
async function assertProjectWriteTarget(check: () => void | Promise<void>): Promise<void> {
    try {
        await check();
    } catch {
        throw new StorageContextInvalidError("claims-mismatch", "Storage project 写入目标已失效，请重新初始化");
    }
}

/**
 * 已签发 project 访问的 data 物理根复核。
 *
 * `identity.json` 可以被复制到同路径的新目录，因此只有物理身份能拒绝「等锁期间重建 data 根」后的旧
 * Project 访问；每个真实副作用前重新捕获一次，而不是沿用入场时的结论。
 */
async function assertDataRootIdentity(owner: StorageHostState, expected: string): Promise<void> {
    const dataRoot = dataStorageRoot(owner);
    let current: StorageRootIdentity;
    try {
        current = await captureStorageRootIdentity(dataRoot);
    } catch (error) {
        if (isStorageDomainError(error)) {
            throw new StorageContextInvalidError("claims-mismatch", "Storage data 物理根已不可用，请重新初始化");
        }
        throw error;
    }
    if (storageRootIdentityDigest(current) !== expected) {
        throw new StorageContextInvalidError("claims-mismatch", "Storage data 物理根在核验与写入之间已被替换，请重新初始化");
    }
}

/**
 * 签发一次独立的 project 访问。
 *
 * 顺序固定：按 publicId 解析精确 ready → 在已接纳操作内复核 Occupancy 与真实 Project 目录 → 激活 lazy storage Module
 * → data 身份域 → 首次建立 Project Storage 根 → 再复核一次 ready 后签发。
 * 关闭、删除或目录替换之后的迟到初始化因此不会递归 mkdir 重建 Project，后续句柄也固定本次捕获的存储根身份。
 */
export function issueStorageProjectContext(
    event: H3Event,
    request: StorageProjectContextRequest,
): Promise<StorageProjectContextDto> {
    return operate(async (owner, assertActive, bindSession) => {
        const facade = await import("nbook/server/workspace-files/project-session");
        assertActive();
        const ready = facade.requireReadyProjectByPublicId(
            projectWorkspaceRef(request.projectRoot),
            request.publicId,
        );
        assertActive();
        // 登记为已接纳操作：普通关闭会先等这次初始化 settle，再关 lazy Module 与 Occupancy。
        const contextId = await facade.runReadyProjectOperation(ready, async () => {
            await facade.revalidateReadyProject(ready);
            assertActive();
            const {PROJECT_STORAGE_MODULE_TOKEN} = await import("nbook/server/storage/project-storage-module");
            assertActive();
            await facade.activateReadyProjectModule(ready, PROJECT_STORAGE_MODULE_TOKEN);
            assertActive();
            const identity = await resolveDataIdentity(event, owner, true, assertActive, bindSession);
            const storageRoot = projectStorageRootFromProjectRoot(ready.workspace.root);
            const rootIdentity = await createProjectStorageRoot(ready.workspace.root, storageRoot, async () => {
                await facade.revalidateReadyProject(ready);
                assertActive();
            });
            await facade.revalidateReadyProject(ready);
            assertActive();
            return owner.accessContexts.issue(projectAccessClaims({
                publicId: ready.publicId,
                projectRoot: ready.workspace.ref.projectRoot,
                storageRoot,
                rootIdentity,
                identity,
            })).contextId;
        });
        return {contextId};
    });
}

/**
 * 在精确 ready 的 project 访问下执行一次动作。
 *
 * 访问上下文只提供代次定位：每次请求都重新核验 data 身份、主体与客户端，并重新解析同一 publicId 的 ready，
 * 所以闭后重开、同路径新建与另一个 Project 的标识都不会写入重开的 Project。
 * 动作登记在 Project 数据面内，普通关闭因此先等已接纳动作收口，再关 lazy Module。
 */
export function performStorageProjectAction(event: H3Event, action: StorageActionRequest): Promise<StorageActionResponse> {
    return operate(async (owner, assertActive, bindSession) => {
        const contextId = requireStorageAccessContextId(event);
        const stored = owner.accessContexts.peek(contextId);
        if (stored === null) {
            throw new StorageContextInvalidError("unknown-context", "Storage 访问上下文不存在或已失效，请重新初始化");
        }
        if (stored.scope !== "project" || stored.project === undefined) {
            throw new StorageContextInvalidError("scope-mismatch", "Storage project 动作只接受 project 访问上下文");
        }
        const definition = action.kind === "bind"
            ? owner.registry.resolveOwner(action.owner)
            : requireStorageActionState(owner.registry, action);
        const facade = await import("nbook/server/workspace-files/project-session");
        assertActive();
        const identity = await resolveDataIdentity(event, owner, false, assertActive, bindSession);
        const ready = facade.requireReadyProjectByPublicId(
            projectWorkspaceRef(stored.project.projectRoot),
            stored.project.publicId,
        );
        assertActive();
        await facade.revalidateReadyProject(ready);
        assertActive();
        const storageRoot = projectStorageRootFromProjectRoot(ready.workspace.root);
        const lease = owner.accessContexts.resolve({
            ...projectAccessClaims({
                publicId: ready.publicId,
                projectRoot: ready.workspace.ref.projectRoot,
                storageRoot,
                rootIdentity: await captureProjectStorageRootIdentity(ready.workspace.root),
                identity,
            }),
            contextId,
        });
        assertActive();
        return await facade.runReadyProjectOperation(
            ready,
            (_signal, assertTarget, revalidateTarget) => performLeasedAction(
                owner, lease, definition, action, assertTarget, revalidateTarget,
            ),
        );
    });
}

/**
 * 释放自己的一次 project 访问；幂等，只影响本访问。
 *
 * 不重新解析 ready：Project 已经关闭时释放仍必须成功；归属只按当前 data 主体与客户端核对，
 * 因此释放别人的上下文仍被拒绝，而已消失的上下文只是重复释放。
 */
export function releaseStorageProjectContext(event: H3Event): Promise<StorageContextReleaseDto> {
    return operate(async (owner, assertActive, bindSession) => {
        const contextId = requireStorageAccessContextId(event);
        const stored = owner.accessContexts.peek(contextId);
        if (stored === null) {
            return {released: false};
        }
        if (stored.scope !== "project") {
            throw new StorageContextInvalidError("scope-mismatch", "Storage project 释放不接受 user 访问上下文");
        }
        const identity = await resolveDataIdentity(event, owner, false, assertActive, bindSession);
        assertActive();
        return {released: owner.accessContexts.release({
            contextId,
            subject: identity.subject,
            clientId: identity.clientId,
        })};
    });
}

/**
 * 组装一次 project 访问声明。
 *
 * 签发与每次核验必须产生完全相同的形状：`StorageAccessContextRegistry.resolve` 按字段比对，
 * 任何一侧少写或多写一个绑定都会以 claims-mismatch 拒绝本该有效的访问。
 */
function projectAccessClaims(input: {
    readonly publicId: string;
    readonly projectRoot: string;
    readonly storageRoot: AbsoluteFsPath;
    readonly rootIdentity: string;
    readonly identity: StorageDataIdentity;
}): StorageAccessContextClaims {
    return {
        scope: "project",
        storageRoot: input.storageRoot,
        identityDomain: input.identity.identityDomain,
        rootIdentity: input.rootIdentity,
        // 身份域字符串能被复制，只有 data 物理根身份能拒绝同路径重建后的旧 Project 访问。
        dataRootIdentity: storageRootIdentityDigest(input.identity.dataRoot),
        subject: input.identity.subject,
        sessionGeneration: input.identity.sessionGeneration,
        clientId: input.identity.clientId,
        project: Object.freeze({publicId: input.publicId, projectRoot: input.projectRoot}),
    };
}

/** Project generation 终止时主动失效该 scope 的访问上下文；宿主已被 HMR 换代时是安全 no-op。 */
export function revokeStorageProjectScope(storageRoot: AbsoluteFsPath): void {
    state().accessContexts.revokeProject(storageRoot);
}

/**
 * 首次建立 Project Storage 根。
 *
 * 建根本身是副作用：`revalidate` 在真实 `mkdir` 之前重新核验原 Project（精确 ready、Occupancy 与物理目录），
 * 因此鉴权、身份域与惰性 Module 的 await 期间被关闭、删除或替换的 Project 不会在旧路径上递归重建目录。
 * 创建后捕获物理身份摘要，后续句柄都用该摘要打开，缺失目录因此不会被重新创建。
 */
async function createProjectStorageRoot(
    projectRoot: AbsoluteFsPath,
    storageRoot: AbsoluteFsPath,
    revalidate: () => Promise<void>,
): Promise<string> {
    await revalidate();
    try {
        await assertStorageTargetContained(projectRoot, storageRoot);
    } catch (error) {
        if (isStorageDomainError(error)) throw error;
        throw new StorageIoError("stat", storageRoot, error instanceof Error ? error.message : String(error), {cause: error});
    }
    await revalidate();
    try {
        await mkdir(storageRoot, {recursive: true});
    } catch (error) {
        throw new StorageIoError("mkdir", storageRoot, error instanceof Error ? error.message : String(error), {cause: error});
    }
    await assertStorageTargetContained(projectRoot, storageRoot);
    return storageRootIdentityDigest(await captureStorageRootIdentity(storageRoot));
}

/** 复核 Project Storage 根仍是签发时捕获的目录；缺失或已替换都按上下文失效报告，不重建目录。 */
async function captureProjectStorageRootIdentity(projectRoot: AbsoluteFsPath): Promise<string> {
    const storageRoot = projectStorageRootFromProjectRoot(projectRoot);
    try {
        return storageRootIdentityDigest(await captureStorageRootIdentity(storageRoot));
    } catch (error) {
        if (error instanceof StorageIoError) {
            throw new StorageContextInvalidError("claims-mismatch", "Storage Project 存储根不存在或已被替换，请重新初始化");
        }
        throw error;
    }
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
    const claims = await resolveUserClaims(event, owner, false, assertActive, bindSession);
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
        const stored = owner.accessContexts.peek(contextId);
        if (stored !== null && stored.scope !== "user") {
            throw new StorageContextInvalidError("scope-mismatch", "Storage user 释放不接受 project 访问上下文");
        }
        const claims = await resolveUserClaims(event, owner, false, assertActive, bindSession);
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
    globalForStorageHost.__nbookStorageHostV4 = createState(next === null ? null : {...next});
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

/** 宿主核验后的数据层身份；user 与 project scope 共用同一主体、session 代次、客户端与身份域来源。 */
type StorageDataIdentity = {
    readonly identityDomain: string;
    /** data 根（WorkspaceRoot/.nbook/storage）的物理身份；project claims 按它拒绝被重建的 data。 */
    readonly dataRoot: StorageRootIdentity;
    readonly subject: string;
    readonly sessionGeneration: string;
    readonly clientId: string;
};

/** 本次宿主使用的 data 存储根；测试注入的根优先于运行期 Workspace Root。 */
function dataStorageRoot(owner: StorageHostState): AbsoluteFsPath {
    return owner.overrides?.storageRoot ?? userStorageRootFromWorkspaceRoot(resolveRuntimeWorkspaceRoot());
}

/**
 * 核验一次请求的数据层身份：客户端定位凭证、auth-on/off 主体与 session 代次，以及 data 身份域。
 *
 * 只有显式初始化可以创建身份域元数据；普通核验读取缺失时明确失败，不偷偷重建被删除的 data 元数据。
 */
async function resolveDataIdentity(
    event: H3Event, owner: StorageHostState, initialize: boolean, assertActive: () => void,
    bindSession: (generation: string) => void,
): Promise<StorageDataIdentity> {
    const clientId = requireClientId(event);
    // 身份域只从这里签发，Project 根不新建第二份 `identity.json`。
    const storageRoot = dataStorageRoot(owner);
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
    const identityDomain = await readStorageIdentityDomain(storageRoot);
    if (identityDomain === null) {
        throw new StorageContextInvalidError("claims-mismatch", "Storage 身份域已被移除，请重新初始化");
    }
    assertActive();
    return {
        identityDomain,
        dataRoot: await captureStorageRootIdentity(storageRoot),
        subject: subject ?? localStorageSubject(identityDomain),
        sessionGeneration,
        clientId,
    };
}

/** 组装 user 访问声明；数据身份域与存储根物理身份都在签发与核验之间复核一次。 */
async function resolveUserClaims(
    event: H3Event, owner: StorageHostState, initialize: boolean, assertActive: () => void,
    bindSession: (generation: string) => void,
): Promise<StorageAccessContextClaims> {
    const identity = await resolveDataIdentity(event, owner, initialize, assertActive, bindSession);
    const storageRoot = dataStorageRoot(owner);
    // 身份域读取与捕获之间根可能被替换：签发前再确认它仍是同一个目录。
    await assertStorageRootIdentity(storageRoot, identity.dataRoot);
    assertActive();
    return {
        scope: "user",
        storageRoot,
        identityDomain: identity.identityDomain,
        rootIdentity: storageRootIdentityDigest(identity.dataRoot),
        subject: identity.subject,
        sessionGeneration: identity.sessionGeneration,
        clientId: identity.clientId,
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
