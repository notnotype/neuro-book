/**
 * 宿主凭证到 clientId 的导出，以及运行期访问上下文 registry。
 *
 * 服务端只从宿主提供的定位凭证导出 clientId，不接触调用方自报的 clientId、主体或磁盘路径；
 * 已验证用户与无鉴权本地主体共用同一个 subject 命名空间但永不重叠。
 *
 * registry 只存在于内存：后端重启即全部失效，浏览器保留的凭证仍指向原 local 分区。
 * 每次签发都是一次独立访问，同一客户端的两个标签页各自持有自己的标识，释放其中一个不撤销另一个。
 * 上下文绑定签发时的存储根、身份域、主体、session 代次与凭证，每次核验都重新比对当前值，
 * 因此换主体、重新登录、改凭证、data 被替换或回收运行期后，旧上下文不能继续解析为可写访问。
 */

import {createHash, randomBytes} from "node:crypto";
import type {StorageScope} from "nbook/shared/storage/contract";
import {
    isStorageAccessContextId,
    isStorageClientCredential,
    STORAGE_OPAQUE_TOKEN_BYTES,
    STORAGE_OPAQUE_TOKEN_LENGTH,
} from "nbook/shared/storage/host";
import {
    StorageClientCredentialInvalidError,
    StorageContextInvalidError,
    StorageServiceClosedError,
    StorageContextLimitError,
} from "nbook/shared/storage/storage-errors";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

/** 单个运行期最多同时签发的访问上下文数量。 */
export const STORAGE_ACCESS_CONTEXT_LIMIT = 256;
/** 单个主体、客户端最多占用的访问数，避免一次浏览器反复初始化占满整个宿主。 */
export const STORAGE_ACCESS_CONTEXT_CLIENT_LIMIT = 32;

/**
 * 超过该时长未核验的访问失效；仅回收内存标识，不影响持久化记录。
 */
export const STORAGE_ACCESS_CONTEXT_IDLE_MS = 30 * 60 * 1000;

/** 无鉴权模式没有 session：本地主体使用固定代次，不按 session 区分。 */
export const STORAGE_LOCAL_SESSION_GENERATION = "local";

/** 无鉴权模式的本地主体：跟随 data 身份域，与已验证用户主体不自动合并。 */
export function localStorageSubject(identityDomain: string): string {
    return `local:${identityDomain}`;
}

/** 已验证用户主体；前缀保证它与本地主体（身份域 UUID）不会相撞。 */
export function userStorageSubject(userId: string | number): string {
    return `user:${String(userId)}`;
}

/** 从宿主定位凭证导出 clientId；原始凭证不进入分区路径、记录、日志或错误响应。 */
export function deriveStorageClientId(credential: string): string {
    if (!isStorageClientCredential(credential)) {
        throw new StorageClientCredentialInvalidError(
            "malformed",
            `Storage 客户端定位凭证必须是 ${String(STORAGE_OPAQUE_TOKEN_LENGTH)} 位小写十六进制标识`,
        );
    }
    return createHash("sha256").update("nbook.storage-client").update("\u0000").update(credential).digest("hex");
}

/**
 * 从宿主 session 标识导出代次摘要；原始 session 标识不进入 registry、日志或错误响应。
 *
 * 登出再登录会换 session，因此同一用户编号的旧访问不会因主体字符串相同而复活。
 */
export function deriveStorageSessionGeneration(sessionId: string): string {
    return createHash("sha256").update("nbook.storage-session").update("\u0000").update(sessionId).digest("hex");
}

/** 访问上下文的签发声明；由宿主核验后提供，不由调用方在业务请求里填写。 */
export type StorageAccessContextClaims = {
    readonly scope: StorageScope;
    readonly storageRoot: AbsoluteFsPath;
    readonly identityDomain: string;
    /** 真实目录的设备、文件编号与创建时刻；路径相同不能证明还是原目录。 */
    readonly rootIdentity: string;
    readonly subject: string;
    /** 鉴权 session 的代次；无鉴权模式使用 `STORAGE_LOCAL_SESSION_GENERATION`。 */
    readonly sessionGeneration: string;
    /** local 分区必需；shared 记录会忽略它。 */
    readonly clientId?: string;
    /**
     * project scope 的精确定位绑定；只用于重新解析签发时的同一个 ready generation，不构成授权。
     *
     * 这里不含路径与物理身份：存储根与 rootIdentity 仍独立比较，因此闭后重开、同名重建
     * 或另一个 Project 的标识都不会命中同一绑定。
     */
    readonly project?: {
        readonly publicId: string;
        readonly projectRoot: string;
    };
    /**
     * project scope 绑定的 data 物理根（WorkspaceRoot/.nbook/storage）身份摘要。
     *
     * user scope 的 `rootIdentity` 就是 data 根，因此省略；project scope 的 `rootIdentity` 是 Project
     * 存储根，只有这一项能拒绝「同路径重建 data 根并复制同一份 identity.json」后的旧 Project 访问。
     */
    readonly dataRootIdentity?: string;
};

/** 一次访问的标识与声明；`contextId` 只是定位键，持有它不构成任何授权。 */
export type StorageAccessContextLease = StorageAccessContextClaims & {
    readonly contextId: string;
};

type RegistryEntry = {
    readonly claims: StorageAccessContextClaims;
    readonly contextId: string;
    /** 最近一次签发或核验的时刻（毫秒）；空闲回收按它判断。 */
    usedAt: number;
};

export class StorageAccessContextRegistry {
    private readonly maxContexts: number;
    private readonly idleMs: number;
    private readonly maxContextsPerClient: number;
    private readonly byContextId = new Map<string, RegistryEntry>();
    private closing: Promise<void> | null = null;

    constructor(options: {readonly maxContexts?: number; readonly idleMs?: number; readonly maxContextsPerClient?: number} = {}) {
        const maxContexts = options.maxContexts ?? STORAGE_ACCESS_CONTEXT_LIMIT;
        if (!Number.isSafeInteger(maxContexts) || maxContexts < 1) {
            throw new Error(`Storage 访问上下文容量必须是正安全整数：${String(maxContexts)}`);
        }
        this.maxContexts = maxContexts;
        this.maxContextsPerClient = options.maxContextsPerClient ?? STORAGE_ACCESS_CONTEXT_CLIENT_LIMIT;
        if (!Number.isSafeInteger(this.maxContextsPerClient) || this.maxContextsPerClient < 1) throw new Error("Storage 客户端容量必须是正安全整数");
        this.idleMs = options.idleMs ?? STORAGE_ACCESS_CONTEXT_IDLE_MS;
        if (!Number.isSafeInteger(this.idleMs) || this.idleMs < 1) throw new Error("Storage 空闲期限必须是正安全整数");
    }

    /**
     * 签发一次新的访问。
     *
     * 同一客户端的重复初始化各自得到独立标识：标签页只释放自己的访问，不会互相撤销；
     * 签发不创建任何记录，也不校验该分区是否已有数据。
     */
    issue(claims: StorageAccessContextClaims): StorageAccessContextLease {
        this.assertOpen();
        this.reclaimCapacity();
        let clientCount = 0;
        for (const entry of this.byContextId.values()) {
            if (entry.claims.subject === claims.subject && entry.claims.clientId === claims.clientId) clientCount += 1;
        }
        if (clientCount >= this.maxContextsPerClient) throw new StorageContextLimitError();
        const entry: RegistryEntry = {
            claims: Object.freeze({...claims}),
            contextId: randomBytes(STORAGE_OPAQUE_TOKEN_BYTES).toString("hex"),
            usedAt: Date.now(),
        };
        this.byContextId.set(entry.contextId, entry);
        return Object.freeze({...entry.claims, contextId: entry.contextId});
    }

    /**
     * 每次请求与长连接的核验边界。
     *
     * 重新比对当前主体、session 代次、凭证、身份域、存储根与 scope；任何一项不一致都不返回上下文，
     * 也不提示不一致的是哪一方，避免用错误响应探测他人主体或身份域。
     */
    resolve(input: StorageAccessContextLease): StorageAccessContextLease {
        this.assertOpen();
        const entry = this.lookup(input.contextId);
        assertSameClaims(entry.claims, input);
        entry.usedAt = Date.now();
        return Object.freeze({...entry.claims, contextId: entry.contextId});
    }

    /**
     * 释放调用者自己的一次访问。
     *
     * 已不存在时返回 false，使释放幂等；访问属于其他主体或凭证时拒绝，避免用别人的 contextId
     * 探测或撤销他人的访问。只按主体与客户端凭证归属：session 已经失效的访问本就不能继续核验，
     * 仍允许同一主体与客户端释放它。
     */
    release(input: {readonly contextId: string; readonly subject: string; readonly clientId?: string}): boolean {
        if (this.closing !== null) return false;
        if (!isStorageAccessContextId(input.contextId)) {
            throw new StorageContextInvalidError("context-id", "Storage 访问上下文标识不是本合同的标识");
        }
        const entry = this.byContextId.get(input.contextId);
        if (entry === undefined) return false;
        if (entry.claims.subject !== input.subject || entry.claims.clientId !== input.clientId) {
            throw new StorageContextInvalidError("owner-mismatch", "Storage 访问上下文不属于当前主体或客户端");
        }
        this.byContextId.delete(entry.contextId);
        return true;
    }

    /**
     * 读取一次访问的签发声明，供宿主按它的精确绑定重新核验。
     *
     * 与 `resolve` 不同：不更新最近核验时刻，不可用或空闲到期返回 null，
     * 因此释放这类幂等路径不会因为上下文已经消失而报错；返回值同样不构成授权。
     */
    peek(contextId: string): StorageAccessContextClaims | null {
        if (this.closing !== null) return null;
        if (!isStorageAccessContextId(contextId)) {
            throw new StorageContextInvalidError("context-id", "Storage 访问上下文标识不是本合同的标识");
        }
        const entry = this.byContextId.get(contextId);
        if (entry === undefined) return null;
        if (Date.now() - entry.usedAt >= this.idleMs) {
            this.byContextId.delete(contextId);
            return null;
        }
        return Object.freeze({...entry.claims});
    }

    /**
     * Project generation 终止时主动撤销该存储根上的全部访问并释放容量。
     *
     * 只按 storageRoot 匹配：同 data 内其它 Project 与全部 user 访问都不受影响；
     * 已打开句柄的 guard 会在下一个真实副作用前失败。持久化记录不因此删除。
     */
    revokeProject(storageRoot: string): void {
        if (this.closing !== null) return;
        for (const [contextId, entry] of this.byContextId) {
            if (entry.claims.scope === "project" && entry.claims.storageRoot === storageRoot) {
                this.byContextId.delete(contextId);
            }
        }
    }

    /**
     * 真实文件副作用前的存活检查。
     *
     * 与 `resolve` 不同：这里不更新最近核验时刻，也不返回声明。已释放、已被主动撤销与自然到期的访问
     * 都在此失效，使已经打开的句柄在授权失效后停止产生新的副作用，而不是把签发时的事实当作无限期授权。
     */
    assertLive(contextId: string): void {
        this.assertOpen();
        this.lookup(contextId);
    }

    /** 幂等关闭：释放全部访问并拒绝后续签发与核验。 */
    close(): Promise<void> {
        if (this.closing === null) {
            this.byContextId.clear();
            this.closing = Promise.resolve();
        }
        return this.closing;
    }

    private assertOpen(): void {
        if (this.closing !== null) throw new StorageServiceClosedError();
    }

    /** 登录替换或退出时主动撤销，防止随后切回同一主体恢复旧访问。 */
    revokeSession(sessionGeneration: string): void {
        for (const [id, entry] of this.byContextId) {
            if (entry.claims.sessionGeneration === sessionGeneration) this.byContextId.delete(id);
        }
    }

    private lookup(contextId: string): RegistryEntry {
        if (!isStorageAccessContextId(contextId)) {
            throw new StorageContextInvalidError("context-id", "Storage 访问上下文标识不是本合同的标识");
        }
        const entry = this.byContextId.get(contextId);
        if (entry === undefined || Date.now() - entry.usedAt >= this.idleMs) {
            this.byContextId.delete(contextId);
            throw new StorageContextInvalidError("unknown-context", "Storage 访问上下文不存在或已失效，请重新初始化");
        }
        return entry;
    }

    /**
     * 容量只回收超过期限的访问；活跃访问占满时拒绝新签发，不改变已签发访问。
     */
    private reclaimCapacity(): void {
        const idleBefore = Date.now() - this.idleMs;
        for (const [contextId, entry] of this.byContextId) {
            if (entry.usedAt <= idleBefore) this.byContextId.delete(contextId);
        }
        if (this.byContextId.size < this.maxContexts) return;
        throw new StorageContextLimitError();
    }
}

function assertSameClaims(signed: StorageAccessContextClaims, current: StorageAccessContextClaims): void {
    if (signed.scope !== current.scope
        || signed.storageRoot !== current.storageRoot
        || signed.identityDomain !== current.identityDomain
        || signed.rootIdentity !== current.rootIdentity
        || signed.subject !== current.subject
        || signed.sessionGeneration !== current.sessionGeneration
        || signed.clientId !== current.clientId
        || signed.project?.publicId !== current.project?.publicId
        || signed.project?.projectRoot !== current.project?.projectRoot
        || signed.dataRootIdentity !== current.dataRootIdentity) {
        throw new StorageContextInvalidError(
            "claims-mismatch",
            "Storage 访问上下文与当前请求的存储根、身份域、主体、session 或客户端凭证不一致，请重新初始化",
        );
    }
}
