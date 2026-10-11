/**
 * 凭据（docs/specs/harness/models.md 输出 5–9）：包一层 OMP 的 `AuthStorage`。
 *
 * “内核不读环境变量”：OMP 的 `getApiKey` 把该服务的环境变量排在存下的 API key 之前、OAuth 之后，没有开关；
 * 所以 API key 直接从存下的凭据里读，只有 OAuth 才经 `getApiKey` 换访问令牌。`status` 用 `hasNonEnvCredential` 判断有没有凭据。
 */

import {AuthStorage, getOAuthProviders} from "@oh-my-pi/pi-ai";
import type {AuthCredentialStore, OAuthController} from "@oh-my-pi/pi-ai";
import type {Model} from "@oh-my-pi/pi-catalog";
import type {Credentials, ModelResult} from "./types";

function wrap(storage: AuthStorage): Credentials {
    let closed = false;
    return {
        async apiKeyFor(model: Model) {
            if (closed) return undefined;
            // 直接读存下的凭据：OMP 的 getApiKey 把环境变量排在存下的 API key 之前，经它拿会读到环境变量。
            const credential = storage.get(model.provider);
            if (credential === undefined) return undefined;
            if (credential.type === "api_key") return credential.key;
            // OAuth 走只看存储的入口（含刷新）：getApiKey 在 OAuth 不可用时也会回落到环境变量。
            const access = await storage.getOAuthAccess(model.provider);
            return access?.accessToken;
        },
        async setApiKey(provider, key) {
            if (closed) return;
            await storage.set(provider, {type: "api_key", key});
        },
        async removeApiKey(provider) {
            if (closed) return;
            await storage.remove(provider);
        },
        status(provider) {
            if (closed) return {kind: null};
            if (storage.hasOAuth(provider)) return {kind: "oauth"};
            return {kind: storage.hasNonEnvCredential(provider) ? "api_key" : null};
        },
        loginProviders() {
            if (closed) return [];
            return getOAuthProviders().map((provider) => ({id: provider.id, name: provider.name}));
        },
        async login(provider, controller: OAuthController) {
            if (closed) return {ok: false, code: "login-failed", detail: "凭据存储已关闭"};
            if (controller.signal?.aborted) return {ok: false, code: "login-cancelled", detail: "登录开始前已取消"};
            try {
                const identity = await storage.login(provider, {
                    ...controller,
                    onAuth: controller.onAuth ?? (() => undefined),
                    onPrompt: controller.onPrompt ?? (async () => ""),
                });
                return {ok: true, value: identity?.accountId === undefined ? {} : {accountId: identity.accountId}};
            } catch (error) {
                if (controller.signal?.aborted) return {ok: false, code: "login-cancelled", detail: "登录被取消"};
                // 错误消息可能带着使用方回调里的输入或上游响应原文（含令牌），detail 只给错误类别与状态码，不给消息正文。
                const status = typeof (error as {status?: unknown}).status === "number" ? `，状态 ${String((error as {status: number}).status)}` : "";
                return {ok: false, code: "login-failed", detail: `登录 ${provider} 失败（${error instanceof Error ? error.name : typeof error}${status}）`};
            }
        },
        async logout(provider) {
            if (closed) return;
            await storage.logout(provider);
        },
        accounts(provider) {
            if (closed) return [];
            // accountId 在 OMP 里是可选的（Google、Copilot 的登录就没有），不能拿它过滤；credentialId 才是稳定句柄。
            return storage.listOAuthAccounts(provider).map((account) => {
                const label = account.email ?? account.projectId ?? account.orgName;
                return {credentialId: account.credentialId, active: account.active, ...(account.accountId === undefined ? {} : {accountId: account.accountId}), ...(label === undefined ? {} : {label})};
            });
        },
        close() {
            if (closed) return;
            closed = true;
            storage.close();
        },
    };
}

const SQLITE_HEADER = "SQLite format 3\u0000";

/**
 * OMP 打开库时对损坏的文件做自动恢复：把原文件改名备份、新建空库、照常返回成功，调用方看不出凭据丢了。
 * 所以先看文件头：已存在但不是 SQLite 的文件直接拒绝、不碰它，由人工处理。文件头正确但内部损坏的情况仍由 OMP 恢复（Spec 输出 5）。
 */
async function notSqlite(path: string): Promise<boolean> {
    const file = Bun.file(path);
    if (!(await file.exists()) || file.size === 0) return false;
    const header = await file.slice(0, SQLITE_HEADER.length).text();
    return header !== SQLITE_HEADER;
}

async function ready(storage: AuthStorage, label: string): Promise<ModelResult<Credentials>> {
    try {
        // 构造或 create 只打开库，不把已有凭据读进内存（实测重开后 get 为 undefined）；reload 才读。
        await storage.reload();
        return {ok: true, value: wrap(storage)};
    } catch (error) {
        storage.close();
        return {ok: false, code: "credentials-unavailable", detail: `读取凭据库失败（${label}）：${error instanceof Error ? error.message : String(error)}`};
    }
}

/** `sqlitePath` 为 `:memory:` 时是进程内的内存库（OMP 的 SQLite 存储本来就支持），关闭即丢；`apiKeys` 在读入已有凭据之后按服务写入。 */
export async function openCredentials(options: {sqlitePath: string; apiKeys?: Readonly<Record<string, string>>}): Promise<ModelResult<Credentials>> {
    try {
        if (options.sqlitePath !== ":memory:" && (await notSqlite(options.sqlitePath))) return {ok: false, code: "credentials-unavailable", detail: `${options.sqlitePath} 不是 SQLite 文件，未改动；请人工处理后重试`};
        const opened = await ready(await AuthStorage.create(options.sqlitePath), options.sqlitePath);
        if (!opened.ok) return opened;
        // 库已经打开：初始 key 写不进去时要自己关掉，失败结果里没有句柄可供调用方关闭
        try {
            for (const [provider, key] of Object.entries(options.apiKeys ?? {})) await opened.value.setApiKey(provider, key);
        } catch (error) {
            opened.value.close();
            return {ok: false, code: "credentials-unavailable", detail: `写入初始凭据失败（${options.sqlitePath}）：${error instanceof Error ? error.message : String(error)}`};
        }
        return opened;
    } catch (error) {
        return {ok: false, code: "credentials-unavailable", detail: `打不开凭据库 ${options.sqlitePath}：${error instanceof Error ? error.message : String(error)}`};
    }
}

export async function createCredentials(store: AuthCredentialStore): Promise<ModelResult<Credentials>> {
    return ready(new AuthStorage(store), "自定义存储");
}
