/**
 * 登出（`session/sign-out.ts`）：真实的接口层核心、账号接口、当前账号与 happy-dom 的 `sessionStorage`，`fetch` 由测试注入、
 * 按路径回答。断言当前账号、注册草稿与回给页面的结果。
 */

import {IDENTITY_API_PREFIX, IDENTITY_PATHS} from "@notnotype/nb-site-identity-contract/constants";
import type {ErrorBody, MeResponse, WhoamiResponse} from "@notnotype/nb-site-identity-contract/constants";
import {afterEach, describe, expect, it} from "vitest";

import {createApiCore} from "../http/core";
import {createIdentityApi} from "../http/identity";
import {createSiteStorage} from "../host/storage";
import {createCurrentAccount} from "./account";
import {signOut} from "./sign-out";

const WHOAMI = `${IDENTITY_API_PREFIX}${IDENTITY_PATHS.whoami}`;
const ME = `${IDENTITY_API_PREFIX}${IDENTITY_PATHS.me}`;
const LOGOUT = `${IDENTITY_API_PREFIX}${IDENTITY_PATHS.logout}`;

const ME_BODY: MeResponse = {
    id: 7,
    username: "alice",
    displayName: "Alice",
    avatarUrl: null,
    website: null,
    bio: null,
    role: "user",
    createdAt: "2026-11-01T00:00:00.000Z",
    email: null,
    emailPending: true,
    hasPassword: true,
    consentRequired: false,
};

afterEach(() => {
    window.sessionStorage.clear();
});

async function signedIn(logout: () => Response) {
    const requested: string[] = [];
    const handled: string[] = [];
    const core = createApiCore({
        fetch: async (path, init) => {
            requested.push(`${String(init.method)} ${path}`);
            if (path === WHOAMI) return Response.json({state: "authenticated", user: {id: 7, username: "alice", role: "user"}} satisfies WhoamiResponse);
            if (path === ME) return Response.json(ME_BODY);
            if (path === LOGOUT) return logout();
            throw new Error(`测试没有准备 ${path} 的回答`);
        },
        now: () => 0,
        handlers: {
            onUnauthenticated: () => handled.push("unauthenticated") > 0,
            onConsentRequired: () => handled.push("consent_required") > 0,
            onForbidden: () => handled.push("forbidden") > 0,
        },
    });
    const identity = createIdentityApi(core);
    const account = createCurrentAccount(identity);
    await account.ensure();
    const storage = createSiteStorage({storage: () => window.sessionStorage, preferences: () => window.localStorage, now: () => 0});
    storage.saveSocialRegisterDraft({provider: "github", username: "alice", displayName: "", inviteCode: "", registrationCode: "REG-1", consent: {termsVersion: "2026-11-01", overseas: true}});
    return {identity, account, storage, requested, handled};
}

const failure = (body: ErrorBody, status: number): Response => Response.json(body, {status});

describe("登出", () => {
    it("服务端结束了会话：当前账号变成匿名，注册草稿清掉", async () => {
        const {identity, account, storage, requested} = await signedIn(() => Response.json({}));
        expect(await signOut(identity, account, storage)).toEqual({ok: true, value: {}});
        expect(account.state.value).toEqual({kind: "anonymous"});
        expect(storage.takeSocialRegisterDraft()).toBeUndefined();
        expect(requested.at(-1)).toBe(`POST ${LOGOUT}`);
    });

    it("会话本来就没了（unauthenticated）也算登出成功，不走统一处理的跳转", async () => {
        const {identity, account, storage, handled} = await signedIn(() => failure({error: {code: "unauthenticated"}}, 401));
        expect(await signOut(identity, account, storage)).toEqual({ok: true, value: {}});
        expect(account.state.value).toEqual({kind: "anonymous"});
        expect(storage.takeSocialRegisterDraft()).toBeUndefined();
        expect(handled).toEqual([]);
    });

    it("别的失败：什么都不清，把失败交给页面", async () => {
        const {identity, account, storage} = await signedIn(() => failure({error: {code: "unavailable"}}, 503));
        expect(await signOut(identity, account, storage)).toEqual({ok: false, failure: {kind: "code", status: 503, code: "unavailable"}});
        expect(account.state.value).toEqual({kind: "signed-in", me: ME_BODY});
        expect(storage.takeSocialRegisterDraft()?.registrationCode).toBe("REG-1");
    });
});
