/** 宿主身份接线。请求只提供客户端定位凭证与访问标识，主体、根与代次由服务端核验。 */
import {getHeader, type H3Event} from "h3";
import {
    STORAGE_ACCESS_CONTEXT_HEADER, STORAGE_CLIENT_CREDENTIAL_HEADER, isStorageAccessContextId,
    type StorageContextReleaseDto, type StorageUserContextDto,
} from "nbook/shared/storage/host";
import {
    StorageClientCredentialInvalidError, StorageContextInvalidError, StorageServiceClosedError,
} from "nbook/shared/storage/storage-errors";
import {
    deriveStorageClientId, deriveStorageSessionGeneration, localStorageSubject,
    StorageAccessContextRegistry, STORAGE_LOCAL_SESSION_GENERATION, userStorageSubject,
    type StorageAccessContextClaims, type StorageAccessContextLease,
} from "nbook/server/storage/access-context";
import {ensureStorageIdentityDomain, readStorageIdentityDomain} from "nbook/server/storage/identity-domain";
import {
    assertStorageRootIdentity, captureStorageRootIdentity, userStorageRootFromWorkspaceRoot,
} from "nbook/server/storage/storage-address";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";

/** 测试宿主的依赖覆盖；生产不接受请求提供的根或主体解析器。 */
export type StorageHostContextOverrides = {
    readonly storageRoot?: AbsoluteFsPath;
    readonly resolveSubject?: (event: H3Event, storageRoot: AbsoluteFsPath) => Promise<string> | string;
};

type StorageHostState = {
    readonly registry: StorageAccessContextRegistry;
    readonly pending: Set<Promise<unknown>>;
    readonly overrides: StorageHostContextOverrides | null;
    readonly authChecks: Set<AuthCheck>;
    closing: Promise<void> | null;
};

type AuthCheck = {sessionGeneration: string | null; revoked: boolean; readonly beforeBinding: Set<string>};

function createState(overrides: StorageHostContextOverrides | null = null): StorageHostState {
    return {registry: new StorageAccessContextRegistry(), pending: new Set(), overrides, authChecks: new Set(), closing: null};
}

/** HMR 的新旧模块共用 owner；已接纳操作捕获所属代次，不能进入下一次测试或运行期。 */
const globalForStorageHost = globalThis as typeof globalThis & {__nbookStorageHostV2?: StorageHostState};
globalForStorageHost.__nbookStorageHostV2 ??= createState();
function state(): StorageHostState {
    return globalForStorageHost.__nbookStorageHostV2!;
}

/** 签发一次独立的 user 访问；只有显式初始化可以创建身份域元数据。 */
export function issueStorageUserContext(event: H3Event): Promise<StorageUserContextDto> {
    return operate(async (owner, assertActive, bindSession) => {
        const claims = await resolveClaims(event, owner, true, assertActive, bindSession);
        assertActive();
        return {contextId: owner.registry.issue(claims).contextId};
    });
}

/** 每次请求重新核验；长连接和已打开句柄的撤销接线由后续 adapter 持有。 */
export function resolveStorageAccessContext(event: H3Event): Promise<StorageAccessContextLease> {
    return operate(async (owner, assertActive, bindSession) => {
        const contextId = requireStorageAccessContextId(event);
        const claims = await resolveClaims(event, owner, false, assertActive, bindSession);
        assertActive();
        return owner.registry.resolve({...claims, contextId});
    });
}

/** 幂等释放自己的一次访问；不清除浏览器定位凭证或状态记录。 */
export function releaseStorageUserContext(event: H3Event): Promise<StorageContextReleaseDto> {
    return operate(async (owner, assertActive, bindSession) => {
        const contextId = requireStorageAccessContextId(event);
        const claims = await resolveClaims(event, owner, false, assertActive, bindSession);
        assertActive();
        return {released: owner.registry.release({contextId, subject: claims.subject, clientId: claims.clientId})};
    });
}

/**
 * 登录替换和退出只撤销对应 session。尚未解开 cookie 的核验暂存有界撤销集合，绑定后比对并释放，
 * 防止 cookie 解析晚于撤销时漏掉旧请求；不持有运行期永久 session 黑名单。
 */
export function revokeStorageAuthSession(sessionId: string): void {
    const owner = state();
    const generation = deriveStorageSessionGeneration(sessionId);
    owner.registry.revokeSession(generation);
    for (const check of owner.authChecks) {
        if (check.sessionGeneration === generation) check.revoked = true;
        else if (check.sessionGeneration === null) {
            if (check.beforeBinding.size >= 256) check.revoked = true;
            else check.beforeBinding.add(generation);
        }
    }
}

/** 同一个关闭 promise 拒绝新接纳并排空在途初始化；身份目录创建也在此生命周期内。 */
export function disposeStorageHost(): Promise<void> {
    return closeState(state());
}

function closeState(owner: StorageHostState): Promise<void> {
    if (owner.closing === null) {
        const registryClosed = owner.registry.close();
        owner.closing = Promise.allSettled([registryClosed, ...owner.pending]).then(() => undefined);
    }
    return owner.closing;
}

/** 测试换代先排空旧 owner；迟到操作不会写入新的隔离根。 */
export async function setStorageHostContextForTest(next: StorageHostContextOverrides | null): Promise<void> {
    await closeState(state());
    globalForStorageHost.__nbookStorageHostV2 = createState(next === null ? null : {...next});
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
    const result = Promise.resolve().then(() => {assertActive(); return action(owner, assertActive, bindSession);});
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
