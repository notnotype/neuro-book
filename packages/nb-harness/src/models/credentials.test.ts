import {afterAll, describe, expect, test} from "bun:test";
import {rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {getBundledModels, getBundledProviders} from "@oh-my-pi/pi-catalog";
import {getEnvApiKeyName} from "@oh-my-pi/pi-ai";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {openCredentials} from "./models";
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
        expect(credentials.accounts(providers[0]!.id)).toEqual([]);

        credentials.close();
        expect(await credentials.apiKeyFor(model)).toBeUndefined();
        expect(credentials.loginProviders()).toEqual([]);
        expect(credentials.status(model.provider)).toEqual({kind: null});
        expect(() => credentials.close()).not.toThrow();
    });

    test("输出 5：路径打不开（父路径是一个普通文件）为 credentials-unavailable", async () => {
        const root = await createTestTmpRoot("nb-harness-credentials", "credentials-bad");
        roots.push(root);
        await writeFile(join(root, "not-a-dir"), "x", "utf8");
        const result = await openCredentials({sqlitePath: join(root, "not-a-dir", "auth.sqlite")});
        expect(result.ok ? null : result.code).toBe("credentials-unavailable");
    });
});
