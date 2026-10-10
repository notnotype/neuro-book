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
    const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));
    return {
        async apiKeyFor(model: Model) {
            if (closed) return undefined;
            // 直接读存下的凭据：OMP 的 getApiKey 把环境变量排在存下的 API key 之前，经它拿会读到环境变量。
            const credential = storage.get(model.provider);
            if (credential === undefined) return undefined;
            if (credential.type === "api_key") return credential.key;
            // OAuth 令牌要经 OMP 换成访问令牌（含刷新）；它的优先级在环境变量之上。
            return storage.getApiKey(model.provider);
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
                // detail 只带错误消息，不带令牌或凭据内容。
                return {ok: false, code: "login-failed", detail: describe(error)};
            }
        },
        async logout(provider) {
            if (closed) return;
            await storage.logout(provider);
        },
        accounts(provider) {
            if (closed) return [];
            return storage
                .listOAuthAccounts(provider)
                .filter((account) => account.accountId !== undefined)
                .map((account) => ({accountId: account.accountId as string, ...(account.email === undefined ? {} : {label: account.email})}));
        },
        close() {
            if (closed) return;
            closed = true;
            storage.close();
        },
    };
}

export async function openCredentials(options: {sqlitePath: string}): Promise<ModelResult<Credentials>> {
    try {
        const storage = await AuthStorage.create(options.sqlitePath);
        // create 只打开库，不把已有凭据读进内存（实测重开后 get 为 undefined）；reload 才读。
        await storage.reload();
        return {ok: true, value: wrap(storage)};
    } catch (error) {
        return {ok: false, code: "credentials-unavailable", detail: `打不开凭据库 ${options.sqlitePath}：${error instanceof Error ? error.message : String(error)}`};
    }
}

export function createCredentials(store: AuthCredentialStore): Credentials {
    return wrap(new AuthStorage(store));
}
