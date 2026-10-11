import {afterAll, describe, expect, test} from "bun:test";
import {readdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {getBundledModels, getBundledProviders} from "@oh-my-pi/pi-catalog";
import {AuthStorage, getEnvApiKeyName, SqliteAuthCredentialStore} from "@oh-my-pi/pi-ai";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {createCredentials, openCredentials} from "./models";
import type {Credentials} from "./models";

const roots: string[] = [];
const opened: Credentials[] = [];
afterAll(async () => {
    for (const credentials of opened) credentials.close();
    for (const root of roots) await rm(root, {recursive: true, force: true});
});

async function fresh(): Promise<{path: string; credentials: Credentials}> {
    const root = await createTestTmpRoot("nb-harness-credentials", "credentials");
    roots.push(root);
    const path = join(root, "auth.sqlite");
    const result = await openCredentials({sqlitePath: path});
    if (!result.ok) throw new Error(result.detail);
    opened.push(result.value);
    return {path, credentials: result.value};
}

/** 用 deepseek：OMP 给它定义了环境变量名（输出 6 的用例才有意义），且是普通的 API key 服务。 */
const provider = getBundledProviders().find((id) => id === "deepseek")!;
const model = getBundledModels(provider)[0]!;

describe("凭据（输出 5–9）", () => {
    test("场景 3：写入后可取、重开后仍在、删除后为 undefined；status 反映种类", async () => {
        const {path, credentials} = await fresh();
        expect(await credentials.apiKeyFor(model)).toBeUndefined();
        expect(credentials.status(model.provider)).toEqual({kind: null});
        await credentials.setApiKey(model.provider, "sk-test-123");
        expect(await credentials.apiKeyFor(model)).toBe("sk-test-123");
        expect(credentials.status(model.provider)).toEqual({kind: "api_key"});
        credentials.close();

        const reopened = await openCredentials({sqlitePath: path});
        if (!reopened.ok) throw new Error(reopened.detail);
        opened.push(reopened.value);
        expect(await reopened.value.apiKeyFor(model)).toBe("sk-test-123");
        await reopened.value.removeApiKey(model.provider);
        expect(await reopened.value.apiKeyFor(model)).toBeUndefined();
        expect(reopened.value.status(model.provider)).toEqual({kind: null});
    });

    test("输出 6：进程环境变量里有这个服务的 key 而存储里没有时，apiKeyFor 仍为 undefined", async () => {
        const {credentials} = await fresh();
        const envName = getEnvApiKeyName(model.provider);
        if (envName === undefined) throw new Error(`OMP 没有给 ${model.provider} 定义环境变量名`);
        const previous = process.env[envName];
        process.env[envName] = "sk-from-env";
        try {
            expect(await credentials.apiKeyFor(model)).toBeUndefined();
            await credentials.setApiKey(model.provider, "sk-stored");
            expect(await credentials.apiKeyFor(model)).toBe("sk-stored");
        } finally {
            if (previous === undefined) delete process.env[envName];
            else process.env[envName] = previous;
        }
    });

    test("输出 8、9：登录服务列表来自 OMP；已取消的 signal 为 login-cancelled；不存在的服务为 login-failed；close 后方法返回空值", async () => {
        const {credentials} = await fresh();
        const providers = credentials.loginProviders();
        expect(providers.length).toBeGreaterThan(3);
        expect(providers.every((provider) => typeof provider.id === "string" && typeof provider.name === "string")).toBe(true);

        const aborted = new AbortController();
        aborted.abort();
        const cancelled = await credentials.login(providers[0]!.id, {signal: aborted.signal});
        expect(cancelled.ok ? null : cancelled.code).toBe("login-cancelled");
        const failed = await credentials.login("no-such-oauth-provider", {});
        expect(failed.ok ? null : failed.code).toBe("login-failed");
        // 使用方回调里抛出的错误带着私密值：detail 不能把它透出去。
        const secret = "private-marker-9f3a";
        const leaked = await credentials.login(providers[0]!.id, {
            onPrompt: async () => {
                throw new Error(`回调失败 ${secret}`);
            },
            onAuth: () => {
                throw new Error(`回调失败 ${secret}`);
            },
        });
        expect(leaked.ok ? null : leaked.code).toBe("login-failed");
        expect(leaked.ok ? "" : leaked.detail).not.toContain(secret);
        expect(credentials.accounts(providers[0]!.id)).toEqual([]);

        credentials.close();
        expect(await credentials.apiKeyFor(model)).toBeUndefined();
        expect(credentials.loginProviders()).toEqual([]);
        expect(credentials.status(model.provider)).toEqual({kind: null});
        expect(() => credentials.close()).not.toThrow();
    });

    test("输出 5：路径打不开（父路径是一个普通文件）或文件不是 SQLite 时为 credentials-unavailable，文件不被改动", async () => {
        const root = await createTestTmpRoot("nb-harness-credentials", "credentials-bad");
        roots.push(root);
        await writeFile(join(root, "not-a-dir"), "x", "utf8");
        const result = await openCredentials({sqlitePath: join(root, "not-a-dir", "auth.sqlite")});
        expect(result.ok ? null : result.code).toBe("credentials-unavailable");

        const garbage = join(root, "garbage.sqlite");
        const bytes = Buffer.from("这不是 SQLite 文件，而是一段文字。\n".repeat(20), "utf8");
        await writeFile(garbage, bytes);
        const corrupt = await openCredentials({sqlitePath: garbage});
        expect(corrupt.ok ? null : corrupt.code).toBe("credentials-unavailable");
        expect(Buffer.compare(await readFile(garbage), bytes)).toBe(0);
        expect((await readdir(root)).filter((name) => name.includes("corrupt"))).toEqual([]);
    });

    test("输出 5：自定义存储入口同样先读入已有凭据，与 SQLite 入口行为相同", async () => {
        const root = await createTestTmpRoot("nb-harness-credentials", "credentials-custom");
        roots.push(root);
        const path = join(root, "auth.sqlite");
        const prefill = await openCredentials({sqlitePath: path});
        if (!prefill.ok) throw new Error(prefill.detail);
        await prefill.value.setApiKey(model.provider, "sk-prefilled");
        prefill.value.close();

        const store = await SqliteAuthCredentialStore.open(path);
        const custom = await createCredentials(store);
        if (!custom.ok) throw new Error(custom.detail);
        opened.push(custom.value);
        expect(await custom.value.apiKeyFor(model)).toBe("sk-prefilled");
        expect(custom.value.status(model.provider)).toEqual({kind: "api_key"});
    });

    test("输出 6、8：OAuth 凭据的访问令牌只从存储取，别的连接删掉后即使环境变量有 key 也是 undefined；accounts 不要求 accountId", async () => {
        const root = await createTestTmpRoot("nb-harness-credentials", "credentials-oauth");
        roots.push(root);
        const path = join(root, "auth.sqlite");
        const writer = await AuthStorage.create(path);
        await writer.set(model.provider, {type: "oauth", refresh: "r", access: "access-token-1", expires: Date.now() + 3_600_000, email: "me@example.com"});
        writer.close();

        const a = await openCredentials({sqlitePath: path});
        if (!a.ok) throw new Error(a.detail);
        opened.push(a.value);
        expect(a.value.status(model.provider)).toEqual({kind: "oauth"});
        // active 表示被某个会话选中；这里没有会话，所以是 false。
        expect(a.value.accounts(model.provider)).toEqual([{credentialId: expect.any(Number) as unknown as number, active: false, label: "me@example.com"}]);
        expect(await a.value.apiKeyFor(model)).toBe("access-token-1");

        const envName = getEnvApiKeyName(model.provider)!;
        const previous = process.env[envName];
        process.env[envName] = "sk-from-env";
        try {
            const b = await AuthStorage.create(path);
            await b.reload();
            await b.remove(model.provider);
            b.close();
            expect(await a.value.apiKeyFor(model)).toBeUndefined();
        } finally {
            if (previous === undefined) delete process.env[envName];
            else process.env[envName] = previous;
        }
    });
});

describe("内存库（输出 5）", () => {
    test("场景 3：:memory: 带 apiKeys 打开后 key 立即可取；第二次打开 :memory: 看不到第一份的 key", async () => {
        const first = await openCredentials({sqlitePath: ":memory:", apiKeys: {[provider]: "mem-key"}});
        if (!first.ok) throw new Error(first.detail);
        opened.push(first.value);
        expect(await first.value.apiKeyFor(model)).toBe("mem-key");
        expect(first.value.status(provider)).toEqual({kind: "api_key"});
        const second = await openCredentials({sqlitePath: ":memory:"});
        if (!second.ok) throw new Error(second.detail);
        opened.push(second.value);
        expect(await second.value.apiKeyFor(model)).toBeUndefined();
        // 文件路径也接受 apiKeys：写进文件、重开后仍在
        const root = await createTestTmpRoot("nb-harness-credentials", "credentials-keys");
        roots.push(root);
        const path = join(root, "auth.sqlite");
        const withKeys = await openCredentials({sqlitePath: path, apiKeys: {[provider]: "file-key"}});
        if (!withKeys.ok) throw new Error(withKeys.detail);
        withKeys.value.close();
        const reopened = await openCredentials({sqlitePath: path});
        if (!reopened.ok) throw new Error(reopened.detail);
        opened.push(reopened.value);
        expect(await reopened.value.apiKeyFor(model)).toBe("file-key");
    });
});
