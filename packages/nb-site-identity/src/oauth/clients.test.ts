/**
 * 回调地址的规则（`oauth/clients.ts`；`site.oauth-provider` 输入一节）。逐格判一张表，再拿表里判为合格的地址按同一个种类交给
 * 库 1.7.27 的 `adminCreateOAuthClient` 登记：都要登记得进。这一条守着“规则只比库严、不比库宽”（包说明 `AGENTS.md` 升级清单
 * “回调地址的两套规则”一行）：库升级后收紧了规则，这里失败，管理员登记时就会撞上 `identity.oauth_client_rule_drift`。
 *
 * 经 HTTP 的同一张表（登记与改动）在合同测试 `oauth-admin.test.ts`。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";

import type {OAuthClientType} from "@notnotype/nb-site-identity-contract";

import {CONSENTED} from "../testing/oauth";
import {createTestIdentity, type TestIdentity} from "../testing/module";
import {checkRedirectUri} from "./clients";

type Row = readonly [uri: string, type: OAuthClientType, accepted: boolean];

const TABLE: readonly Row[] = [
    // 两种都许的 `https`：主机不是回环。
    ["https://client.example/cb", "confidential", true],
    ["https://client.example:8443/cb?x=1", "confidential", true],
    ["HTTPS://client.example/cb", "confidential", true],
    ["https://app.localhost/cb", "confidential", true],
    ["https://client.example/cb", "public", true],
    // `https` 的回环：两种都不许。`127.1` 归一化后是 `127.0.0.1`。
    ["https://127.0.0.1/cb", "confidential", false],
    ["https://127.5.6.7/cb", "confidential", false],
    ["https://127.1/cb", "confidential", false],
    ["https://localhost/cb", "confidential", false],
    ["https://LOCALHOST./cb", "confidential", false],
    ["https://[::1]/cb", "confidential", false],
    ["https://[::ffff:127.0.0.1]/cb", "confidential", false],
    ["https://localhost/cb", "public", false],
    ["https://127.0.0.1:8443/cb", "public", false],
    ["https://[::1]/cb", "public", false],
    // `http`：机密客户端都不许；公开客户端只许原始写法的主机恰为三者之一，端口任意。
    ["http://client.example/cb", "confidential", false],
    ["http://127.0.0.1:8080/cb", "confidential", false],
    ["http://localhost/cb", "confidential", false],
    ["http://127.0.0.1:8123/cb", "public", true],
    ["http://127.0.0.1/cb", "public", true],
    ["http://[::1]:9/cb", "public", true],
    ["http://localhost:3000/cb", "public", true],
    ["http://LOCALHOST:8/cb", "public", true],
    ["http://127.0.0.2/cb", "public", false],
    ["http://127.1:8/cb", "public", false],
    ["http://localhost.:8/cb", "public", false],
    ["http://[0:0:0:0:0:0:0:1]/cb", "public", false],
    ["http://client.example/cb", "public", false],
    // 片段、用户信息（含空的）、空白与控制字符：两种都不许。
    ["https://client.example/cb#x", "confidential", false],
    ["https://client.example/cb#", "public", false],
    ["http://127.0.0.1:8/cb#x", "public", false],
    ["https://user@client.example/cb", "confidential", false],
    ["https://user:pass@client.example/cb", "confidential", false],
    ["https://@client.example/cb", "public", false],
    ["http://user@127.0.0.1/cb", "public", false],
    ["http://127.0.0.1\\@evil.example/cb", "public", false],
    ["https://client.example/c b", "confidential", false],
    ["https://client.example/c\tb", "confidential", false],
    [" https://client.example/cb", "public", false],
    ["https://client.example/c\u007fb", "confidential", false],
    ["https://client.example/c　b", "public", false],
    // 自定义协议与不是绝对地址的。
    ["com.example.app:/cb", "public", false],
    ["myapp://callback", "public", false],
    ["com.example.app:/cb", "confidential", false],
    ["/cb", "public", false],
    ["not a url", "confidential", false],
];

describe("回调地址按种类的规则", () => {
    it.each(TABLE)("%p 作为 %p 客户端的回调地址：合格 %p", (uri, type, accepted) => {
        expect(checkRedirectUri(uri, type)).toBe(accepted);
    });
});

describe("规则只比库严", () => {
    let identity: TestIdentity;
    let cookie: string;

    beforeAll(async () => {
        identity = await createTestIdentity("identity-redirect-rules-vs-library");
        ({cookie} = await identity.issue(await identity.addUser("root", {role: "admin", ...CONSENTED})));
    });

    afterAll(async () => {
        await identity.assembly.close();
        await identity.root.cleanup();
    });

    const acceptedRows = TABLE.filter(([, , accepted]) => accepted);

    it.each(acceptedRows)("判为合格的 %p 按 %p 交给库登记得进", async (uri, type) => {
        const created = await identity.assembly.auth.api.adminCreateOAuthClient({
            headers: new Headers({cookie}),
            body: {
                client_name: "规则对照",
                redirect_uris: [uri],
                application_type: type === "confidential" ? "web" : "native",
                token_endpoint_auth_method: type === "confidential" ? "client_secret_basic" : "none",
                scope: "openid profile email",
                grant_types: ["authorization_code"],
                response_types: ["code"],
            },
        });
        expect(created.redirect_uris).toEqual([uri]);
    });
});
