/**
 * 值动作 HTTP 宿主的隔离 fixture。
 *
 * 真实 Node HTTP 监听 + 真实 H3 路由 + 受控临时根：请求读取、身份核验、错误投影与状态读写都经过产品入口，
 * 因此测试得到的是可提交的 HTTP 合同证据，而不是内部函数调用。fixture 只服务测试与验收，
 * 不进入产品启动路径；调用方必须在每个用例后 `close()`，不读写机器默认 data。
 */

import {mkdtemp, readFile, rm} from "node:fs/promises";
import {createServer} from "node:http";
import path from "node:path";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {createApp, createError, defineEventHandler, getHeader, toNodeListener} from "h3";
import type {DefinedStorageState} from "nbook/shared/storage/definition";
import type {StoragePartitionBinding} from "nbook/shared/storage/contract";
import {STORAGE_ACCESS_CONTEXT_HEADER, STORAGE_CLIENT_CREDENTIAL_HEADER} from "nbook/shared/storage/host";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    deriveStorageClientId,
} from "nbook/server/storage/access-context";
import {disposeStorageHost, setStorageHostContextForTest} from "nbook/server/storage/host";
import type {StorageHandle, StorageHandleInput, StorageService} from "nbook/server/storage/storage-service";
import type {StoragePartitionStoreOptions} from "nbook/server/storage/partition-store";
import type {StorageLockAdapter} from "nbook/server/storage/partition-lock";
import {
    storageIdentityFilePath,
    storagePartitionPaths,
    storageRecordFileName,
    type StoragePartitionPaths,
} from "nbook/server/storage/storage-address";

export const STORAGE_CONTEXT_PATH = "/api/storage/user/context";
export const STORAGE_ACTION_PATH = "/api/storage/user/action";

/** 测试宿主用请求头选择主体；生产主体始终由鉴权模块核验，不接受请求自报。 */
export const STORAGE_TEST_SUBJECT_HEADER = "x-nbook-test-subject";

export const STORAGE_TEST_SUBJECT = "user:7";
export const STORAGE_TEST_CLIENT_A = "a".repeat(64);
export const STORAGE_TEST_CLIENT_B = "b".repeat(64);

export type StorageActionHostOptions = {
    /** 受信注册定义；同一实例重复装载是幂等操作，可跨重启复用。 */
    readonly definitions?: readonly DefinedStorageState<unknown>[];
    /** 复用同一个隔离根，验证真实后端重启后的恢复。 */
    readonly root?: AbsoluteFsPath;
    readonly lockAdapter?: StorageLockAdapter;
    readonly fileOptions?: StoragePartitionStoreOptions;
    readonly openHandle?: (input: StorageHandleInput, service: StorageService) => Promise<StorageHandle>;
    readonly accessContextIdleMs?: number;
};

export type StorageActionHostRequest = {
    readonly method?: string;
    readonly body?: unknown;
    readonly credential?: string;
    readonly contextId?: string;
    readonly subject?: string;
    readonly headers?: Record<string, string>;
};

export type StorageActionHostAddress = {
    readonly owner: string;
    readonly key?: string;
    readonly resource?: string;
    readonly clientCredential?: string;
    readonly subject?: string;
};

export type StorageActionHostFixture = {
    readonly root: AbsoluteFsPath;
    readonly clientCredential: string;
    /** 真实 HTTP 请求；路径就是产品入口。 */
    request(target: string, init?: StorageActionHostRequest): Promise<Response>;
    /** 同根换一套宿主配置：验证重启恢复、重新加载定义与生命周期接缝。 */
    configure(next?: StorageActionHostOptions): Promise<void>;
    issue(clientCredential?: string, subject?: string): Promise<string>;
    /** 取得该访问与 owner 的分区代次绑定；值动作必须原样携带它。 */
    bind(contextId: string, owner: string, options?: {readonly credential?: string; readonly subject?: string}): Promise<StoragePartitionBinding>;
    act(contextId: string, action: unknown, options?: {readonly credential?: string; readonly subject?: string}): Promise<Response>;
    identityDomain(): Promise<string>;
    /** 生产寻址逻辑推出的分区路径；直接读盘断言隔离与文件状态用。 */
    partition(input: StorageActionHostAddress): Promise<StoragePartitionPaths>;
    /** 记录文件路径；需要 key。 */
    recordPath(input: StorageActionHostAddress & {readonly key: string}): Promise<AbsoluteFsPath>;
    close(): Promise<void>;
};

/**
 * 建立隔离的动作宿主。
 *
 * 路由模块在 `defineEventHandler` 全局就位后才加载（与产品自动导入一致），
 * 因此这里刻意使用动态导入而不是模块顶层静态导入。
 */
export async function createStorageActionHost(options: StorageActionHostOptions = {}): Promise<StorageActionHostFixture> {
    const globalForRoutes = globalThis as typeof globalThis & {defineEventHandler?: typeof defineEventHandler};
    globalForRoutes.defineEventHandler ??= defineEventHandler;
    const scratch = await mkdtemp(testHostPath("nbook-storage-action-"));
    const root = options.root ?? absoluteFsPath(path.join(scratch, "storage"));
    const state: {current: StorageActionHostOptions} = {current: options};
    const configure = async (next: StorageActionHostOptions = state.current): Promise<void> => {
        state.current = next;
        await setStorageHostContextForTest({
            storageRoot: root,
            resolveSubject: (event) => getHeader(event, STORAGE_TEST_SUBJECT_HEADER) ?? STORAGE_TEST_SUBJECT,
            definitions: next.definitions,
            lockAdapter: next.lockAdapter,
            fileOptions: next.fileOptions,
            openHandle: next.openHandle,
            accessContextIdleMs: next.accessContextIdleMs,
        });
    };
    await configure();
    const [contextRoute, actionRoute] = await Promise.all([
        Promise.all([
            import("nbook/server/api/storage/user/context.post"),
            import("nbook/server/api/storage/user/context.delete"),
        ]),
        import("nbook/server/api/storage/user/action.post"),
    ]);
    const app = createApp();
    app.use(STORAGE_CONTEXT_PATH, defineEventHandler(async (event) => {
        if (event.method === "POST") return await contextRoute[0].default(event);
        if (event.method === "DELETE") return await contextRoute[1].default(event);
        throw createError({statusCode: 405, message: "仅支持 POST 与 DELETE"});
    }));
    app.use(STORAGE_ACTION_PATH, defineEventHandler(async (event) => {
        if (event.method !== "POST") throw createError({statusCode: 405, message: "仅支持 POST"});
        return await actionRoute.default(event);
    }));
    const server = createServer(toNodeListener(app));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
        throw new Error("Storage 动作 fixture 未监听 TCP 端口");
    }

    const request = async (target: string, init: StorageActionHostRequest = {}): Promise<Response> => {
        const headers: Record<string, string> = {
            ...(init.credential === undefined ? {} : {[STORAGE_CLIENT_CREDENTIAL_HEADER]: init.credential}),
            ...(init.contextId === undefined ? {} : {[STORAGE_ACCESS_CONTEXT_HEADER]: init.contextId}),
            ...(init.subject === undefined ? {} : {[STORAGE_TEST_SUBJECT_HEADER]: init.subject}),
            ...(init.body === undefined ? {} : {"content-type": "application/json"}),
            ...init.headers,
        };
        return await fetch(`http://127.0.0.1:${String(address.port)}${target}`, {
            method: init.method ?? "POST",
            headers,
            ...(init.body === undefined ? {} : {body: typeof init.body === "string" ? init.body : JSON.stringify(init.body)}),
        });
    };
    const readIdentityDomain = async (): Promise<string> => {
        const parsed = JSON.parse(await readFile(storageIdentityFilePath(root), "utf8")) as {identityDomain?: unknown};
        if (typeof parsed.identityDomain !== "string") {
            throw new Error("隔离根缺少身份域元数据");
        }
        return parsed.identityDomain;
    };
    const clientCredential = STORAGE_TEST_CLIENT_A;
    const partition = async (input: StorageActionHostAddress): Promise<StoragePartitionPaths> => storagePartitionPaths({
        storageRoot: root,
        identityDomain: await readIdentityDomain(),
        subject: input.subject ?? STORAGE_TEST_SUBJECT,
        locality: "local",
        clientId: deriveStorageClientId(input.clientCredential ?? clientCredential),
        owner: input.owner,
    });
    const recordPath = async (input: StorageActionHostAddress & {readonly key: string}): Promise<AbsoluteFsPath> =>
        absoluteFsPath(path.join((await partition(input)).recordsDirectory, storageRecordFileName(input.key, input.resource)));
    return {
        root,
        clientCredential,
        request,
        configure,
        async issue(credential = clientCredential, subject) {
            const response = await request(STORAGE_CONTEXT_PATH, {credential, subject});
            const body = await response.json() as {contextId?: unknown};
            if (response.status !== 200 || typeof body.contextId !== "string") {
                throw new Error(`初始化未返回上下文：${String(response.status)} ${JSON.stringify(body)}`);
            }
            return body.contextId;
        },
        async bind(contextId, owner, options = {}) {
            const response = await request(STORAGE_ACTION_PATH, {
                body: {kind: "bind", owner},
                contextId,
                credential: options.credential ?? clientCredential,
                subject: options.subject,
            });
            const body = await response.json() as {binding?: StoragePartitionBinding};
            if (response.status !== 200 || body.binding === undefined) {
                throw new Error(`绑定未返回分区代次：${String(response.status)} ${JSON.stringify(body)}`);
            }
            return body.binding;
        },
        act(contextId, action, options = {}) {
            return request(STORAGE_ACTION_PATH, {
                body: action,
                contextId,
                credential: options.credential ?? clientCredential,
                subject: options.subject,
            });
        },
        identityDomain: readIdentityDomain,
        partition,
        recordPath,
        async close() {
            await disposeStorageHost();
            const closed = Promise.withResolvers<void>();
            server.close(() => { closed.resolve(); });
            await closed.promise;
            await rm(scratch, {recursive: true, force: true});
        },
    };
}
