/**
 * 浏览器客户端身份：在同一个浏览器存储上下文里保存一份不透明的定位凭证。
 *
 * 凭证只定位 data 中的 local 分区：它不承载状态值，也不代替用户鉴权，主体始终由服务端核验。
 * 首次初始化必须在开放可恢复访问前收敛，因此读取与写入放在同一个 IndexedDB `readwrite`
 * 事务里——同源重叠事务由浏览器串行化，两个标签页同时初始化时只有一个凭证胜出，另一个读到同一份。
 * localStorage 的多步 get/set 与单次 Set-Cookie 都不能提供这个原子性，不做降级兜底：
 * 存储不可用、被拒绝或事务中止时返回明确不可恢复状态，绝不改落共享分区或开始旧键导入。
 *
 * 标识使用 `crypto.getRandomValues`，不用 `crypto.randomUUID`/SubtleCrypto：后者要求安全上下文，
 * 现有 HTTP 部署必须同样可用。
 */

import {isStorageClientCredential, STORAGE_OPAQUE_TOKEN_BYTES} from "nbook/shared/storage/host";

const STORAGE_IDENTITY_DATABASE = "nbook.storage-client";
const STORAGE_IDENTITY_DATABASE_VERSION = 1;
const STORAGE_IDENTITY_STORE = "identity";
const STORAGE_IDENTITY_RECORD = "client-credential";

/** 不可恢复原因：宿主能力缺失、存储被阻塞、读写失败、事务中止或已有记录不是本合同凭证。 */
export type StorageClientIdentityFailureReason =
    | "unavailable"
    | "blocked"
    | "read-failed"
    | "write-failed"
    | "aborted"
    | "invalid-record";

export type StorageClientIdentityFailure = {
    readonly status: "unrecoverable";
    readonly reason: StorageClientIdentityFailureReason;
    readonly diagnosis: string;
};

export type StorageClientIdentityLoadResult =
    | {readonly status: "ready"; readonly credential: string}
    | StorageClientIdentityFailure;

export type StorageClientIdentityClearResult =
    | {readonly status: "cleared"}
    | StorageClientIdentityFailure;

/** 可选注入：测试与隔离宿主用确定性的 IndexedDB 与随机源替换浏览器全局值。 */
export type StorageClientIdentityTarget = {
    readonly indexedDB?: IDBFactory | null;
    readonly crypto?: Pick<Crypto, "getRandomValues"> | null;
};

type IdentityEnvironment = {
    readonly factory: IDBFactory;
    readonly random: Pick<Crypto, "getRandomValues">;
};

type IdentityTransactionResult<TResult> =
    | {readonly value: TResult}
    | {readonly failure: StorageClientIdentityFailure};

type OpenedDatabase = {readonly value: IDBDatabase} | {readonly failure: StorageClientIdentityFailure};

/** 读取或创建定位凭证；已有记录不是本合同凭证时返回不可恢复，不覆盖未知内容。 */
export async function loadOrCreateStorageClientIdentity(
    target: StorageClientIdentityTarget = {},
): Promise<StorageClientIdentityLoadResult> {
    const environment = resolveIdentityEnvironment(target);
    if ("status" in environment) return environment;
    const outcome = await withIdentityDatabase(environment.factory, (database) =>
        runIdentityTransaction<StorageClientIdentityLoadResult>(database, (store, decide, abort) => {
            const request = store.get(STORAGE_IDENTITY_RECORD);
            request.onsuccess = () => {
                const stored: unknown = request.result;
                if (stored !== undefined) {
                    decide(typeof stored === "string" && isStorageClientCredential(stored)
                        ? {status: "ready", credential: stored}
                        : unrecoverable("invalid-record", "浏览器客户端身份记录不是本合同的定位凭证"));
                    return;
                }
                let credential: string;
                try {
                    credential = createStorageClientCredential(environment.random);
                } catch (error) {
                    decide(unrecoverable("unavailable", describeError(error)));
                    return;
                }
                // 与上面的读取同属一个事务：并发标签页不可能各自写入不同凭证。
                try {
                    store.put(credential, STORAGE_IDENTITY_RECORD);
                } catch (error) {
                    abort(unrecoverable("write-failed", describeError(error)));
                    return;
                }
                decide({status: "ready", credential});
            };
        }));
    return "failure" in outcome ? outcome.failure : outcome.value;
}

/** 清除本浏览器存储上下文的定位凭证；data 中由它定位的旧分区保持原样，不自动清理。 */
export async function clearStorageClientIdentity(
    target: StorageClientIdentityTarget = {},
): Promise<StorageClientIdentityClearResult> {
    const factory = resolveIndexedDbFactory(target);
    if ("status" in factory) return factory;
    const outcome = await withIdentityDatabase(factory, (database) =>
        runIdentityTransaction<StorageClientIdentityClearResult>(database, (store, decide) => {
            store.delete(STORAGE_IDENTITY_RECORD);
            decide({status: "cleared"});
        }));
    return "failure" in outcome ? outcome.failure : outcome.value;
}

function resolveIdentityEnvironment(target: StorageClientIdentityTarget): IdentityEnvironment | StorageClientIdentityFailure {
    const factory = resolveIndexedDbFactory(target);
    if ("status" in factory) return factory;
    const random = target.crypto === undefined ? readGlobalCrypto() : target.crypto;
    if (random === null) {
        return unrecoverable("unavailable", "当前宿主没有可用的 crypto.getRandomValues，无法生成客户端定位凭证");
    }
    return {factory, random};
}

function resolveIndexedDbFactory(target: StorageClientIdentityTarget): IDBFactory | StorageClientIdentityFailure {
    let candidate: unknown;
    try {
        candidate = target.indexedDB === undefined ? (globalThis as {indexedDB?: unknown}).indexedDB : target.indexedDB;
    } catch {
        return unrecoverable("unavailable", "当前宿主拒绝访问 IndexedDB");
    }
    if (typeof candidate !== "object" || candidate === null || typeof (candidate as {open?: unknown}).open !== "function") {
        return unrecoverable("unavailable", "当前宿主没有可用的 IndexedDB，无法持久保存客户端身份");
    }
    return candidate as IDBFactory;
}

function readGlobalCrypto(): Pick<Crypto, "getRandomValues"> | null {
    const candidate: unknown = (globalThis as {crypto?: unknown}).crypto;
    if (typeof candidate !== "object" || candidate === null
        || typeof (candidate as {getRandomValues?: unknown}).getRandomValues !== "function") {
        return null;
    }
    return candidate as Pick<Crypto, "getRandomValues">;
}

/**
 * 打开连接执行一次操作，结束后一定关闭。
 *
 * 不缓存连接：身份操作低频，缓存省不下多少，却要在连接被其它标签页的升级/删除关闭后判断失效；
 * 复用已关闭的连接会永久 read-failed，且遗留的打开连接会挡住对方升级。
 */
async function withIdentityDatabase<TResult>(
    factory: IDBFactory,
    operation: (database: IDBDatabase) => Promise<IdentityTransactionResult<TResult>>,
): Promise<IdentityTransactionResult<TResult>> {
    const opened = await openStorageIdentityDatabase(factory);
    if ("failure" in opened) return opened;
    try {
        return await operation(opened.value);
    } finally {
        opened.value.close();
    }
}

function openStorageIdentityDatabase(factory: IDBFactory): Promise<OpenedDatabase> {
    const {promise, resolve} = Promise.withResolvers<OpenedDatabase>();
    let request: IDBOpenDBRequest;
    try {
        request = factory.open(STORAGE_IDENTITY_DATABASE, STORAGE_IDENTITY_DATABASE_VERSION);
    } catch (error) {
        resolve({failure: unrecoverable("unavailable", describeError(error))});
        return promise;
    }
    let settled = false;
    const settle = (result: OpenedDatabase) => {
        if (settled) return;
        settled = true;
        resolve(result);
    };
    request.onupgradeneeded = () => {
        const created = request.result;
        if (!created.objectStoreNames.contains(STORAGE_IDENTITY_STORE)) {
            created.createObjectStore(STORAGE_IDENTITY_STORE);
        }
    };
    request.onsuccess = () => {
        const opened = request.result;
        // onblocked 已返回不可恢复，这个迟到的连接不属于任何调用，直接关闭而不是留给下一次调用。
        if (settled) {
            opened.close();
            return;
        }
        // 其它标签页要求升级时主动断开，避免把对方挡在 onblocked 上。
        opened.onversionchange = () => opened.close();
        settle({value: opened});
    };
    request.onerror = () => settle({failure: unrecoverable("read-failed", describeError(request.error))});
    request.onblocked = () => settle({
        failure: unrecoverable("blocked", "浏览器客户端身份数据库被其它标签页阻塞"),
    });
    return promise;
}

/**
 * 在同一个 readwrite 事务内执行一次读取与可能的写入。
 *
 * `decide` 只记录本次结果，真正的返回值在事务提交后才产生：读取被回滚、事务中止或被拒绝持久保存时
 * 都不能报告成功。
 */
function runIdentityTransaction<TResult>(
    database: IDBDatabase,
    build: (store: IDBObjectStore, decide: (value: TResult) => void, abort: (failure: StorageClientIdentityFailure) => void) => void,
): Promise<IdentityTransactionResult<TResult>> {
    const {promise, resolve} = Promise.withResolvers<IdentityTransactionResult<TResult>>();
    let decided: {readonly value: TResult} | null = null;
    let finished = false;
    const finish = (result: IdentityTransactionResult<TResult>) => {
        if (finished) return;
        finished = true;
        resolve(result);
    };
    let transaction: IDBTransaction;
    let failure: StorageClientIdentityFailure | null = null;
    try {
        transaction = database.transaction(STORAGE_IDENTITY_STORE, "readwrite");
    } catch (error) {
        finish({failure: unrecoverable("read-failed", describeError(error))});
        return promise;
    }
    transaction.oncomplete = () => finish(decided ?? {
        failure: unrecoverable("write-failed", "浏览器客户端身份事务完成但没有提交结果"),
    });
    // error 先冒泡，abort 才是事务结束；连接不能在仍可能提交时宣称已清理。
    transaction.onerror = () => {failure ??= unrecoverable("write-failed", describeError(transaction.error));};
    transaction.onabort = () => finish({failure: failure ?? unrecoverable("aborted", describeError(transaction.error))});
    const abort = (reason: StorageClientIdentityFailure): void => {
        failure = reason;
        try {
            transaction.abort();
        } catch {
            // 已结束的事务不能再 abort；当前操作仍按原始失败返回。
            finish({failure});
        }
    };
    try {
        build(transaction.objectStore(STORAGE_IDENTITY_STORE), (value) => {
            decided = {value};
        }, abort);
    } catch (error) {
        abort(unrecoverable("write-failed", describeError(error)));
    }
    return promise;
}

function createStorageClientCredential(random: Pick<Crypto, "getRandomValues">): string {
    const bytes = new Uint8Array(STORAGE_OPAQUE_TOKEN_BYTES);
    random.getRandomValues(bytes);
    return toHex(bytes);
}

function toHex(bytes: Uint8Array): string {
    let hex = "";
    for (const byte of bytes) {
        hex += byte.toString(16).padStart(2, "0");
    }
    return hex;
}

function unrecoverable(reason: StorageClientIdentityFailureReason, diagnosis: string): StorageClientIdentityFailure {
    return {status: "unrecoverable", reason, diagnosis};
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
