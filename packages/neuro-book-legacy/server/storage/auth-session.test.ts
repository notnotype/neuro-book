import {mkdtemp, rm} from "node:fs/promises";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {createApp, createError, defineEventHandler, getHeader, toWebHandler, useSession, type H3Event} from "h3";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {AuthUserDto} from "nbook/shared/dto/auth.dto";
import {STORAGE_ACCESS_CONTEXT_HEADER, STORAGE_CLIENT_CREDENTIAL_HEADER} from "nbook/shared/storage/host";

vi.mock("nbook/server/config/boot-config", () => ({loadBootAuthEnabledSync: () => true}));
const userRead = vi.hoisted(() => ({gate: null as Promise<void> | null, entered: null as (() => void) | null}));
vi.mock("nbook/server/utils/prisma", () => ({prisma: {user: {
    findUnique: async ({where}: {where: {id: number}}) => {
        userRead.entered?.();
        await userRead.gate;
        return {id: where.id, status: "active", sessionVersion: 1, lastSeenAt: new Date()};
    },
}}}));

import {clearAuthSession, setAuthSession} from "nbook/server/utils/auth";
import {disposeStorageHost, issueStorageUserContext, resolveStorageAccessContext, setStorageHostContextForTest} from "nbook/server/storage/host";
import {withStorageHttpError} from "nbook/server/storage/http-error";

let root: string;
beforeEach(async () => {
    userRead.gate = null;
    userRead.entered = null;
    root = await mkdtemp(testHostPath("storage-auth-"));
    await setStorageHostContextForTest({storageRoot: absoluteFsPath(root)});
    const session = (event: H3Event) => useSession<{user?: AuthUserDto}>(event, {
        password: "isolated-test-session-password-32-bytes", cookie: {secure: false, sameSite: "lax"},
    });
    // 使用 Nuxt auth-utils 实际采用的 h3 session owner；仅替换 Nuxt 自动导入和数据库查询。
    vi.stubGlobal("createError", createError);
    vi.stubGlobal("getUserSession", async (event: H3Event) => {
        const current = await session(event);
        return {...current.data, id: current.id};
    });
    vi.stubGlobal("setUserSession", async (event: H3Event, data: {user: AuthUserDto}) => {
        const current = await session(event);
        await current.update({...current.data, ...data});
    });
    vi.stubGlobal("clearUserSession", async (event: H3Event) => (await session(event)).clear());
});
afterEach(async () => {
    await disposeStorageHost();
    vi.unstubAllGlobals();
    await rm(root, {recursive: true, force: true});
});

describe("Storage 与真实 cookie session 生命周期", () => {
    it("成功重新登录及退出会撤销旧访问，切回原用户不能恢复", async () => {
        const app = createApp();
        app.use("/login", defineEventHandler(async (event) => {
            const id = getHeader(event, "x-test-user") ?? "7";
            await setAuthSession(event, {id, username: "fixture", displayName: "Fixture", role: "user", sessionVersion: 1});
            return {ok: true};
        }));
        app.use("/logout", defineEventHandler(async (event) => {await clearAuthSession(event); return {ok: true};}));
        app.use("/context", defineEventHandler((event) => withStorageHttpError(() => issueStorageUserContext(event))));
        app.use("/resolve", defineEventHandler((event) => withStorageHttpError(async () => ({subject: (await resolveStorageAccessContext(event)).subject}))));
        const send = toWebHandler(app);
        let cookie = "";
        const request = async (route: string, contextId?: string, userId?: string) => {
            const response = await send(new Request(`http://storage.test${route}`, {method: "POST", headers: {
                cookie, [STORAGE_CLIENT_CREDENTIAL_HEADER]: "a".repeat(64),
                ...(contextId ? {[STORAGE_ACCESS_CONTEXT_HEADER]: contextId} : {}),
                ...(userId ? {"x-test-user": userId} : {}),
            }}));
            const next = response.headers.get("set-cookie");
            if (next) cookie = next.split(";")[0]!;
            return response;
        };
        expect((await request("/login")).status).toBe(200);
        const first = await (await request("/context")).json() as {contextId: string};
        expect((await request("/resolve", first.contextId)).status).toBe(200);
        const gate = Promise.withResolvers<void>();
        const entered = Promise.withResolvers<void>();
        userRead.gate = gate.promise;
        userRead.entered = entered.resolve;
        const inFlight = request("/resolve", first.contextId);
        await entered.promise;
        try {
            // 真正的匿名 cookie 路径：h3 会生成 ID，但不应干扰另一用户的在途核验。
            expect((await send(new Request("http://storage.test/logout", {method: "POST"}))).status).toBe(200);
        } finally {
            gate.resolve();
            userRead.gate = null;
            userRead.entered = null;
        }
        expect((await inFlight).status).toBe(200);
        expect((await request("/login")).status).toBe(200);
        expect((await request("/resolve", first.contextId)).status).toBe(403);
        const second = await (await request("/context")).json() as {contextId: string};
        expect((await request("/resolve", second.contextId)).status).toBe(200);
        await request("/login", undefined, "8");
        await request("/login", undefined, "7");
        expect((await request("/resolve", second.contextId)).status).toBe(403);
        const third = await (await request("/context")).json() as {contextId: string};
        await request("/logout");
        expect((await request("/resolve", third.contextId)).status).toBe(401);
        await request("/login");
        expect((await request("/resolve", third.contextId)).status).toBe(403);
    });
});
