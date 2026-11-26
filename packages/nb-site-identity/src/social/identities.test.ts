/**
 * 上游身份的解绑（`identities.ts`；`site.accounts` 输出 16、失败表的 `last_login_method`）。
 *
 * 这里测合同测试测不到的：密码那一行（库 `account` 表里 `providerId` 为 `credential`）的 id 不算上游身份，合同里看不到它的 id；
 * 没有密码的账号并发解绑两个身份，要让两个请求的每一步排在一起跑（`lockstep`），合同里只能并发发出、不定先后。列表的形状、
 * 解绑后的登录与再关联在合同测试 `accounts-identities.test.ts`。
 */

import {afterEach, beforeEach, describe, expect, it} from "bun:test";

import {startFakeUpstream, type FakeGitHubUser, type FakeGoogleUser, type FakeUpstream} from "@notnotype/neuro-book-test-support/oauth-upstream";

import {ManualTimers, TEST_SITE_URL} from "../testing/library";
import {createTestIdentity, TEST_TERMS_VERSION, type TestIdentity} from "../testing/module";
import {fakeSocialConfig, followSocial, holdQueue, landing, lockstep, startSocial} from "../testing/social";

let upstream: FakeUpstream;
let identity: TestIdentity | undefined;

beforeEach(async () => {
    upstream = await startFakeUpstream();
});

afterEach(async () => {
    await identity?.root.cleanup();
    identity = undefined;
    await upstream.close();
});

const CONSENTED = {consent: {termsVersion: TEST_TERMS_VERSION, overseasStorage: true}} as const;

function googleUser(sub: string): FakeGoogleUser {
    return {sub, email: `${sub}@gmail.test`, email_verified: true, name: `Name ${sub}`};
}

function githubUser(id: number, login: string): FakeGitHubUser {
    return {id, login, name: null, email: null, emails: [{email: `${login}@github.test`, primary: true, verified: true, visibility: null}]};
}

async function socialIdentity(name: string, timers?: ManualTimers): Promise<TestIdentity> {
    identity = await createTestIdentity(name, {config: {social: fakeSocialConfig(upstream)}, ...(timers === undefined ? {} : {timers})});
    return identity;
}

/** 以没有密码的账号关联上游现在登录着的人（不带当前密码）；落点有 `social_error` 时抛错。 */
async function linkWithoutPassword(target: TestIdentity, cookie: string, provider: "google" | "github"): Promise<void> {
    const landed = landing(await followSocial(target, await startSocial(target, provider, {intent: "link"}, cookie), cookie));
    if (landed.socialError !== null) throw new Error(`linking ${provider} landed with ${landed.socialError}`);
}

function unlink(target: TestIdentity, cookie: string, id: number): Promise<Response> {
    return target.fetch(`/me/identities/${String(id)}`, {method: "DELETE", headers: {origin: TEST_SITE_URL, cookie}});
}

async function accountRows(target: TestIdentity): Promise<{readonly id: number; readonly providerId: string}[]> {
    return target.conn.read((tx) => tx.query<{id: number; providerId: string}, []>(`SELECT "id", "providerId" FROM "account" ORDER BY "id"`).all());
}

describe("解绑上游身份", () => {
    it("密码那一行的 id 回 not_found，密码照样在", async () => {
        const target = await socialIdentity("social-identities-credential-id");
        const userId = await target.addUser("alice", {...CONSENTED, password: "correct horse battery"});
        const {cookie} = await target.issue(userId);
        const [credential] = await accountRows(target);

        const response = await unlink(target, cookie, credential!.id);
        expect({status: response.status, body: await response.json()}).toEqual({status: 404, body: {error: {code: "not_found"}}});
        expect(await accountRows(target)).toEqual([{id: credential!.id, providerId: "credential"}]);
    });

    it("没开放的上游的身份不算登录方式：没有密码、关联了 Google 与 GitHub，只开放 GitHub 时解绑 GitHub 得 last_login_method、两个身份都在；两个都开放时能解绑（输出 16）", async () => {
        const both = await socialIdentity("social-identities-closed-provider");
        const userId = await both.addUser("olive", CONSENTED);
        const linking = await both.issue(userId);
        upstream.setUser("google", googleUser("g-olive"));
        await linkWithoutPassword(both, linking.cookie, "google");
        upstream.setUser("github", githubUser(9102, "olive-gh"));
        await linkWithoutPassword(both, linking.cookie, "github");
        const githubRow = (await accountRows(both)).find((row) => row.providerId === "github")!;
        const root = both.root;

        /** 用同一个库按 `social` 重起模块，发一个新会话，回解绑 GitHub 的结果与之后列表里的上游。 */
        const unlinkGitHubWith = async (name: string, social: Parameters<typeof createTestIdentity>[1]): Promise<{readonly status: number; readonly body: unknown; readonly listed: string[]}> => {
            await identity!.assembly.close();
            identity = await createTestIdentity(name, {...social, root});
            const {cookie} = await identity.issue(userId);
            const response = await unlink(identity, cookie, githubRow.id);
            const list = (await (await identity.fetch("/me/identities", {headers: {cookie}})).json()) as {readonly items: readonly {readonly provider: string}[]};
            return {status: response.status, body: await response.json(), listed: list.items.map((item) => item.provider)};
        };

        expect(await unlinkGitHubWith("social-identities-closed-provider-github-only", {config: {social: {github: fakeSocialConfig(upstream).github!}}})).toEqual({
            status: 409,
            body: {error: {code: "last_login_method"}},
            // 列表照旧列出没开放的上游的身份。
            listed: ["google", "github"],
        });
        expect(await unlinkGitHubWith("social-identities-closed-provider-both", {config: {social: fakeSocialConfig(upstream)}})).toEqual({status: 200, body: {}, listed: ["google"]});
    });

    it("没有密码的账号并发解绑两个身份：每一步排在一起跑，也只有一个成功，另一个得 last_login_method，剩下一个身份", async () => {
        const timers = new ManualTimers();
        const target = await socialIdentity("social-identities-concurrent-unlink", timers);
        const userId = await target.addUser("olive", CONSENTED);
        const {cookie} = await target.issue(userId);
        upstream.setUser("google", googleUser("g-olive"));
        await linkWithoutPassword(target, cookie, "google");
        upstream.setUser("github", githubUser(9101, "olive-gh"));
        await linkWithoutPassword(target, cookie, "github");
        const ids = (await accountRows(target)).map((row) => row.id);
        expect(ids).toHaveLength(2);

        const first = await holdQueue(target);
        await first.started;
        const responses = await lockstep(target, timers, first, ids.map((id) => unlink(target, cookie, id)));
        const outcomes = await Promise.all(responses.map(async (response) => ({status: response.status, body: (await response.json()) as unknown})));
        expect(outcomes.toSorted((left, right) => left.status - right.status)).toEqual([
            {status: 200, body: {}},
            {status: 409, body: {error: {code: "last_login_method"}}},
        ]);
        expect(await accountRows(target)).toHaveLength(1);
    });
});
