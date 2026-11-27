/**
 * 当前账号（t10 计划 3.1“守卫”）：用真实的接口层核心与取身份的两个接口，`fetch` 由测试注入、按路径回答。
 */

import {describe, expect, it} from "bun:test";

import {IDENTITY_API_PREFIX, IDENTITY_PATHS} from "@notnotype/nb-site-identity-contract";
import type {MeResponse, WhoamiResponse} from "@notnotype/nb-site-identity-contract";

import {createApiCore} from "../src/http/core";
import {createIdentityApi} from "../src/http/identity";
import {createCurrentAccount} from "../src/session/account";

const WHOAMI = `${IDENTITY_API_PREFIX}${IDENTITY_PATHS.whoami}`;
const ME = `${IDENTITY_API_PREFIX}${IDENTITY_PATHS.me}`;

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

type Answer = () => Response | Promise<Response>;

function setup(answers: Record<string, Answer>) {
    const requested: string[] = [];
    const handled: string[] = [];
    const api = createApiCore({
        fetch: async (path) => {
            requested.push(path);
            const answer = answers[path];
            if (answer === undefined) throw new Error(`测试没有准备 ${path} 的回答`);
            return answer();
        },
        now: () => 0,
        handlers: {
            onUnauthenticated: () => handled.push("unauthenticated") > 0,
            onConsentRequired: () => handled.push("consent_required") > 0,
            onForbidden: () => handled.push("forbidden") > 0,
        },
    });
    return {account: createCurrentAccount(createIdentityApi(api)), requested, handled};
}

const signedInWhoami: Answer = () => Response.json({state: "authenticated", user: {id: 7, username: "alice", role: "user"}} satisfies WhoamiResponse);
const anonymousWhoami: Answer = () => Response.json({state: "anonymous"} satisfies WhoamiResponse);

describe("当前账号", () => {
    it("已登录时先取 whoami 再取 me；之后的 ensure 用缓存，不再发请求", async () => {
        const {account, requested} = setup({[WHOAMI]: signedInWhoami, [ME]: () => Response.json(ME_BODY)});
        expect(account.state.value).toEqual({kind: "unknown"});
        expect(await account.ensure()).toEqual({kind: "signed-in", me: ME_BODY});
        expect(await account.ensure()).toEqual({kind: "signed-in", me: ME_BODY});
        expect(requested).toEqual([WHOAMI, ME]);
    });

    it("匿名时只取 whoami", async () => {
        const {account, requested} = setup({[WHOAMI]: anonymousWhoami});
        expect(await account.ensure()).toEqual({kind: "anonymous"});
        expect(requested).toEqual([WHOAMI]);
    });

    it("正在取时的 ensure 等同一次，不重复发请求", async () => {
        const {account, requested} = setup({[WHOAMI]: anonymousWhoami});
        const [first, second] = await Promise.all([account.ensure(), account.ensure()]);
        expect([first, second]).toEqual([{kind: "anonymous"}, {kind: "anonymous"}]);
        expect(requested).toEqual([WHOAMI]);
    });

    it("whoami 之后会话恰好没了：me 回 unauthenticated 时是匿名，不触发统一处理的跳转", async () => {
        const {account, handled} = setup({[WHOAMI]: signedInWhoami, [ME]: () => Response.json({error: {code: "unauthenticated"}}, {status: 401})});
        expect(await account.ensure()).toEqual({kind: "anonymous"});
        expect(handled).toEqual([]);
    });

    it("账号服务不可用、连不上或回答看不懂时是 unavailable，不当作匿名；refresh 重取后恢复", async () => {
        let whoami: Answer = () => Response.json({error: {code: "unavailable"}}, {status: 503});
        const {account} = setup({[WHOAMI]: () => whoami(), [ME]: () => Response.json(ME_BODY)});
        expect(await account.ensure()).toEqual({kind: "unavailable", failure: {kind: "code", status: 503, code: "unavailable"}});
        // 已经有状态（unavailable）时 ensure 不重取，只有 refresh 会。
        whoami = () => Promise.reject(new TypeError("Failed to fetch"));
        expect(await account.ensure()).toEqual({kind: "unavailable", failure: {kind: "code", status: 503, code: "unavailable"}});
        expect(await account.refresh()).toEqual({kind: "unavailable", failure: {kind: "network"}});
        whoami = () => new Response("<html>", {status: 502});
        expect(await account.refresh()).toEqual({kind: "unavailable", failure: {kind: "malformed", status: 502}});
        whoami = signedInWhoami;
        expect(await account.refresh()).toEqual({kind: "signed-in", me: ME_BODY});
    });

    it("me 回别的失败时是 unavailable", async () => {
        const {account} = setup({[WHOAMI]: signedInWhoami, [ME]: () => Response.json({error: {code: "unavailable"}}, {status: 503})});
        expect(await account.ensure()).toEqual({kind: "unavailable", failure: {kind: "code", status: 503, code: "unavailable"}});
    });

    it("clear 之后是匿名；清空前发起的取数结果到达时丢掉", async () => {
        let release: (() => void) | undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const {account} = setup({
            [WHOAMI]: async () => {
                await gate;
                return signedInWhoami();
            },
            [ME]: () => Response.json(ME_BODY),
        });
        const pending = account.ensure();
        account.clear();
        expect(account.state.value).toEqual({kind: "anonymous"});
        release!();
        expect(await pending).toEqual({kind: "anonymous"});
        expect(account.state.value).toEqual({kind: "anonymous"});
    });

    it("update 换上服务端确认过的资料，不再发请求；之前发起的取数结果到达时丢掉", async () => {
        let release: (() => void) | undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let slow = false;
        const {account, requested} = setup({
            [WHOAMI]: async () => {
                if (slow) await gate;
                return signedInWhoami();
            },
            [ME]: () => Response.json(ME_BODY),
        });
        await account.ensure();
        slow = true;
        const pending = account.refresh();
        const saved: MeResponse = {...ME_BODY, displayName: "爱丽丝", email: "alice@example.com", emailPending: false};
        account.update(saved);
        expect(account.state.value).toEqual({kind: "signed-in", me: saved});
        release!();
        await pending;
        expect(account.state.value).toEqual({kind: "signed-in", me: saved});
        expect(requested).toEqual([WHOAMI, ME, WHOAMI, ME]);
    });

    it("不是已登录时 update 什么都不做", async () => {
        const {account} = setup({[WHOAMI]: anonymousWhoami});
        await account.ensure();
        account.update(ME_BODY);
        expect(account.state.value).toEqual({kind: "anonymous"});
    });
});
