/**
 * 库给的跳转地址的归类与改写（`oauth/library-location.ts`；计划 3.8 第 4 步）。五类地址都取自库的 `handler` 真实给的（不经挂载层），
 * 错误页的码表按计划 3.8 第 4 步的表写成字面量。经挂载层的整条路（库的错误页不外露）在 `mount.test.ts`。
 */

import {afterEach, beforeEach, describe, expect, it} from "bun:test";

import {CONTINUE_PARAM, OAUTH_ERROR_PARAM, OAUTH_PAGES, OAUTH_REQUEST_PARAM} from "@notnotype/nb-site-identity-contract";

import {LIB_BASE_PATH} from "../auth";
import {TEST_SITE_URL} from "../testing/library";
import {createTestIdentity, type TestIdentity} from "../testing/module";
import {addOAuthUser, CONSENTED, libraryRequest, registerClient, TEST_REDIRECT_URI, type TestClient} from "../testing/oauth";
import {rewriteLibraryLocation, type LibraryLocationOptions} from "./library-location";

let identity: TestIdentity;
let client: TestClient;
let options: LibraryLocationOptions;

beforeEach(async () => {
    identity = await createTestIdentity("oauth-library-location");
    client = await registerClient(identity);
    options = {conn: identity.conn, log: identity.log, siteOrigin: TEST_SITE_URL};
});

afterEach(async () => {
    await identity.assembly.close();
    await identity.root.cleanup();
});

function authorizeQuery(target: TestClient, extra: Readonly<Record<string, string>> = {}): URLSearchParams {
    return new URLSearchParams({
        response_type: "code",
        client_id: target.clientId,
        redirect_uri: TEST_REDIRECT_URI,
        scope: "openid",
        state: "st",
        code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        code_challenge_method: "S256",
        ...extra,
    });
}

/** 直接交库的授权请求给的 `Location`。 */
async function libraryLocation(query: URLSearchParams, cookie?: string): Promise<string> {
    const response = await libraryRequest(identity, `/oauth2/authorize?${query}`, cookie === undefined ? {} : {headers: {cookie}});
    const location = response.headers.get("location");
    if (location === null) throw new Error(`the library answered ${response.status} without a redirect`);
    return location;
}

/** 站内页面的地址：路径与唯一的查询参数。令牌解回来就是库地址上的那段签名参数。 */
function pageOf(location: string): {readonly path: string; readonly param: string; readonly decoded: string} {
    const url = new URL(location, TEST_SITE_URL);
    const [entry, ...rest] = [...url.searchParams];
    if (entry === undefined || rest.length > 0) throw new Error(`expected exactly one query parameter on ${location}`);
    return {path: url.pathname, param: entry[0], decoded: Buffer.from(entry[1], "base64url").toString("utf8")};
}

const libraryQueryOf = (location: string): string => location.slice(location.indexOf("?") + 1);

describe("五类地址", () => {
    it("库的登录页、站点同意页、确认页换成站内页面，令牌就是库签过名的那段参数", async () => {
        const query = authorizeQuery(client);
        const toLogin = await libraryLocation(query);
        // 没有同意记录的账号：不满足同意门槛，库在登录判断之后带人去站点同意页（`auth.ts` 的 `postLogin`）。
        const {cookie: unconsented} = await identity.issue(await addOAuthUser(identity, "bob"));
        const toSiteConsent = await libraryLocation(query, unconsented);
        const consentClient = await registerClient(identity, "admin2", {skipConsent: false});
        const {cookie} = await identity.issue(await addOAuthUser(identity, "alice", CONSENTED));
        const toConsent = await libraryLocation(authorizeQuery(consentClient), cookie);

        const cases = [
            [toLogin, OAUTH_PAGES.login, CONTINUE_PARAM],
            [toSiteConsent, OAUTH_PAGES.siteConsent, CONTINUE_PARAM],
            [toConsent, OAUTH_PAGES.consent, OAUTH_REQUEST_PARAM],
        ] as const;
        for (const [location, path, param] of cases) {
            // 先确认库给的就是这一类（升级清单“库的跳转地址”一行）。
            expect({path: new URL(location, TEST_SITE_URL).pathname, signed: new URL(location, TEST_SITE_URL).searchParams.has("sig")}).toEqual({path, signed: true});
            expect(pageOf(await rewriteLibraryLocation(options, location, query))).toEqual({path, param, decoded: libraryQueryOf(location)});
        }
    });

    it("库的错误页换成本站的错误页，跳回客户端的地址原样", async () => {
        const unknown = authorizeQuery({clientId: "no-such-client", clientSecret: "x"});
        const toError = await libraryLocation(unknown);
        expect(new URL(toError).pathname).toBe(`${LIB_BASE_PATH}/error`);
        expect(await rewriteLibraryLocation(options, toError, unknown)).toBe(`${OAUTH_PAGES.consent}?${OAUTH_ERROR_PARAM}=client_not_found`);

        const {cookie} = await identity.issue(await addOAuthUser(identity, "alice", CONSENTED));
        const query = authorizeQuery(client);
        const toClient = await libraryLocation(query, cookie);
        expect(toClient.startsWith(`${TEST_REDIRECT_URI}?`)).toBe(true);
        expect(await rewriteLibraryLocation(options, toClient, query)).toBe(toClient);
    });

    it("没有签名的站内页面与别的站点上同路径的地址不算库的跳转，原样", async () => {
        const query = authorizeQuery(client);
        for (const location of ["/login?next=x", `${TEST_SITE_URL}/oauth/consent?request=x`, `https://other.example${LIB_BASE_PATH}/error?error=invalid_client`]) {
            expect(await rewriteLibraryLocation(options, location, query)).toBe(location);
        }
    });
});

describe("错误页的码", () => {
    const errorPage = (code?: string): string => `${TEST_SITE_URL}${LIB_BASE_PATH}/error${code === undefined ? "" : `?error=${code}&error_description=x`}`;
    const ownErrorPage = (code: string): string => `${OAUTH_PAGES.consent}?${OAUTH_ERROR_PARAM}=${code}`;

    it("客户端与回调地址合格时按库的码查表；表外的码与没有码都是 client_not_found，并记库的码", async () => {
        const query = authorizeQuery(client);
        const table = [
            ["invalid_client", "client_not_found"],
            ["client_disabled", "client_not_found"],
            ["unauthorized_client", "client_not_found"],
            ["invalid_redirect", "redirect_uri_invalid"],
            ["invalid_request", "redirect_uri_invalid"],
        ] as const;
        for (const [libraryCode, code] of table) expect({libraryCode, location: await rewriteLibraryLocation(options, errorPage(libraryCode), query)}).toEqual({libraryCode, location: ownErrorPage(code)});
        expect(identity.log.lines.filter((line) => line.event === "identity.oauth_library_error_page")).toEqual([]);

        expect(await rewriteLibraryLocation(options, errorPage("unsupported_prompt_select_account"), query)).toBe(ownErrorPage("client_not_found"));
        expect(await rewriteLibraryLocation(options, errorPage(), query)).toBe(ownErrorPage("client_not_found"));
        expect(identity.log.lines.filter((line) => line.event === "identity.oauth_library_error_page")).toEqual([
            {level: "warn", event: "identity.oauth_library_error_page", fields: {libraryCode: "unsupported_prompt_select_account"}},
            {level: "warn", event: "identity.oauth_library_error_page", fields: {libraryCode: null}},
        ]);
    });

    it("请求里的客户端或回调地址不合格时用第 1 步的码，不看库的码", async () => {
        const wrongRedirect = authorizeQuery(client, {redirect_uri: "https://client.example/other"});
        expect(await rewriteLibraryLocation(options, errorPage("invalid_client"), wrongRedirect)).toBe(ownErrorPage("redirect_uri_invalid"));
        await identity.conn.write((tx) => tx.query(`UPDATE "oauthClient" SET "disabled" = 1 WHERE "clientId" = ?`).run(client.clientId));
        expect(await rewriteLibraryLocation(options, errorPage("invalid_redirect"), authorizeQuery(client))).toBe(ownErrorPage("client_not_found"));
        expect(identity.log.lines.filter((line) => line.event === "identity.oauth_library_error_page")).toEqual([]);
    });
});
