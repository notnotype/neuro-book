/**
 * 对外 OAuth 客户端的管理接口：`GET`、`POST admin/oauth-clients`，`PATCH admin/oauth-clients/:id`，
 * `POST admin/oauth-clients/:id/rotate-secret`（`site.oauth-provider` 输出 9、16，副作用一节的审计；w00037 t08 计划 3.9）。
 *
 * 每个写操作与它的审计在同一个写事务里、先复核操作者（`operator.ts`），与注册码的管理接口同一种写法。分工：
 * - 登记经库的 `adminCreateOAuthClient`：客户端 id、密钥的生成与存法、各列的缺省值都归库，模块不另写一份。库要在请求里认出
 *   登记者（它把登记者记进 `userId`），所以把这次请求的 Cookie 交给它；调用开在 `withLibTransaction` 里，库的插入、操作者的
 *   复核与审计一起提交或回滚。
 * - 列表、改动、换密钥用自家 SQL：库的改动接口只许登记者本人改（`ownsClient`），管理员之间要能互改；改动写的列对上库的存法
 *   （包说明 `AGENTS.md` 升级清单“客户端的存法”一行，`oauth-clients.test.ts` 的存法契约）。
 *
 * 回调地址先按 `oauth/clients.ts` 的规则判。登记时库还会再判一次：走到库拒收，说明两边的规则走样了（升级清单“回调地址的两套
 * 规则”一行），回 `redirect_uri_invalid` 并记一行 `identity.oauth_client_rule_drift`，不落成 500。改动没有库这一道。
 */

import type {SQLQueryBindings} from "bun:sqlite";

import type {Context, Hono} from "hono";

import {
    ClientIdParams,
    CreateOAuthClientRequest,
    IDENTITY_PATHS,
    OAuthClientListQuery,
    PatchOAuthClientRequest,
    type CreateOAuthClientResponse,
    type OAuthClientItem,
    type OAuthClientListResponse,
    type OAuthClientType,
    type RotateSecretResponse,
} from "@notnotype/nb-site-identity-contract";

import {appendAudit} from "../audit";
import type {IdentityAuth} from "../auth";
import type {IdentityConnection, IdentityTx} from "../db/connection";
import {libDate, libDateMs} from "../db/library-rows";
import {IdentityFailure, readBody, readEmptyBody, readParams, readQuery} from "../errors";
import type {IdentityLog} from "../index";
import type {LibAdapter} from "../login";
import {requireSession} from "../middleware";
import {checkRedirectUri, redirectUrisOf} from "../oauth/clients";
import {clientSecretHash, generateClientSecret} from "../oauth/client-secret";
import {revokeOAuthForClient} from "../oauth/revoke";
import type {Sessions} from "../session";
import {adminWrite, requireLiveAdmin} from "./operator";
import {readPage, sql, type PageSpec} from "./pagination";

export interface OAuthClientAdminOptions {
    readonly sessions: Sessions;
    readonly conn: IdentityConnection;
    readonly clock: {now(): number};
    readonly log: Pick<IdentityLog, "warn">;
    readonly auth: IdentityAuth;
    readonly adapter: LibAdapter;
    /**
     * 回调地址的规则，缺省 `checkRedirectUri`。只有包内测试换它：要让自家的规则放过一个库拒收的地址，才测得到库拒收时的映射
     * （现在的规则比库严，造不出这样的地址）。
     */
    readonly checkRedirectUri?: (uri: string, type: OAuthClientType) => boolean;
}

/**
 * 种类对应的认证方式与 `application_type`。都显式给：库不给 `application_type` 时按 `web` 判回调地址，公开客户端的
 * `http://127.0.0.1:…` 登记不进去；认证方式库还接受 `client_secret_post`，只许这两种由这里定（计划 3.9）。
 */
const AUTH_METHODS = {
    confidential: {token_endpoint_auth_method: "client_secret_basic", application_type: "web"},
    public: {token_endpoint_auth_method: "none", application_type: "native"},
} as const;

/** 库拒收回调地址时 `APIError` 的 `body.error`（`checkOAuthClient` 与 `validateClientRedirectUri`）。 */
const LIBRARY_REDIRECT_ERRORS: ReadonlySet<string> = new Set(["invalid_redirect_uri", "invalid_client_metadata"]);

interface ClientRow {
    readonly id: number;
    readonly clientId: string;
    readonly name: string | null;
    readonly redirectUris: string;
    readonly tokenEndpointAuthMethod: string | null;
    readonly skipConsent: number | null;
    readonly disabled: number | null;
    readonly createdAt: string;
}

const CLIENT_COLUMNS = `o."id" AS id, o."clientId" AS clientId, o."name" AS name, o."redirectUris" AS redirectUris,
    o."tokenEndpointAuthMethod" AS tokenEndpointAuthMethod, o."skipConsent" AS skipConsent, o."disabled" AS disabled, o."createdAt" AS createdAt`;

/** 公开客户端的认证方式是 `none`（计划 3.9）；登记只经本文件，别的认证方式只会是机密的 `client_secret_basic`。 */
function typeOf(row: Pick<ClientRow, "tokenEndpointAuthMethod">): OAuthClientType {
    return row.tokenEndpointAuthMethod === "none" ? "public" : "confidential";
}

function itemOf(row: ClientRow): OAuthClientItem {
    if (row.name === null) throw new Error("an OAuth client registered by the module has no name");
    return {
        id: row.id,
        clientId: row.clientId,
        name: row.name,
        redirectUris: redirectUrisOf(row.redirectUris),
        type: typeOf(row),
        skipConsent: row.skipConsent === 1,
        disabled: row.disabled === 1,
        // 读成毫秒再写回：不是库的写法时在这里抛错，不把一个不合 `IsoTimestamp` 的值发出去（与注册码的列表一样）。
        createdAt: libDate(libDateMs(row.createdAt)),
    };
}

function readRow(tx: IdentityTx, clientId: string): ClientRow | null {
    return tx.query<ClientRow, [string]>(`SELECT ${CLIENT_COLUMNS} FROM "oauthClient" o WHERE o."clientId" = ?`).get(clientId);
}

/** 库的时间列按系统时间取整到秒写（`adminUpdateOAuthClient` 写 `updatedAt` 的方式）；自家 SQL 用模块的时钟，同样取整到秒。 */
function libSecond(nowMs: number): string {
    return libDate(Math.floor(nowMs / 1000) * 1000);
}

/** 库拒收的是回调地址时回那个码：`body.error` 是两种之一，或请求体的 schema 不合（交给库的属性里只有回调地址是外来的）。 */
function libraryRedirectRejection(error: unknown): string | null {
    if (typeof error !== "object" || error === null || !("body" in error)) return null;
    const body = (error as {body: unknown}).body;
    if (typeof body !== "object" || body === null) return null;
    const {error: code, code: validation} = body as {error?: unknown; code?: unknown};
    if (typeof code === "string" && LIBRARY_REDIRECT_ERRORS.has(code)) return code;
    if (validation === "VALIDATION_ERROR") return validation;
    return null;
}

/** PATCH 的属性在审计参数里的写法：改了的属性名，按请求 schema 里的先后、逗号分隔（审计参数的值只能是标量）。 */
const PATCH_PROPERTIES = ["name", "redirectUris", "skipConsent", "disabled"] as const;

export function registerOAuthClientAdminRoutes(app: Hono, options: OAuthClientAdminOptions): void {
    const {sessions, conn, clock, log, auth, adapter} = options;
    const check = options.checkRedirectUri ?? checkRedirectUri;
    const listPath = IDENTITY_PATHS.adminOAuthClients;
    const itemPath = `${listPath}/:id` as const;
    const rotatePath = `${listPath}/:id/rotate-secret` as const;

    app.get(listPath, async (c: Context) => {
        await requireSession(c, sessions, `GET ${listPath}`, "admin");
        const query = readQuery(c, OAuthClientListQuery);
        const response = await conn.read((tx): OAuthClientListResponse => {
            const spec: PageSpec<"all"> = {
                anchorPrefix: "oc",
                table: `"oauthClient"`,
                from: `"oauthClient" o`,
                idColumn: `o."id"`,
                createdColumn: `o."createdAt"`,
                select: sql(CLIENT_COLUMNS),
                filters: {all: sql("1")},
                filter: "all",
            };
            // 没有筛选项的列表不回 `counts`（合同包的 `PageResponse`）。
            const {counts: _counts, ...page} = readPage<ClientRow, "all">(tx, spec, query);
            return {...page, items: page.items.map(itemOf)};
        });
        return c.json(response);
    });

    app.post(listPath, async (c: Context) => {
        const session = await requireSession(c, sessions, `POST ${listPath}`, "admin");
        const body = await readBody(c, CreateOAuthClientRequest);
        if (!body.redirectUris.every((uri) => check(uri, body.type))) throw new IdentityFailure("redirect_uri_invalid");
        const cookie = c.req.header("Cookie") ?? "";
        try {
            const response = await conn.withLibTransaction(adapter, async (): Promise<CreateOAuthClientResponse> => {
                const nowMs = clock.now();
                // 与 `adminWrite` 同一个复核；登记的插入由库做、要开在库的事务里，所以不经 `adminWrite`，在这个事务里先复核。
                await conn.write((tx) => requireLiveAdmin(tx, session, nowMs));
                const created = await auth.api.adminCreateOAuthClient({
                    headers: new Headers({cookie}),
                    // 固定的几项：只许授权码流程、PKCE、三种范围（输入一节）。认证方式由种类定（`AUTH_METHODS`）。
                    body: {
                        client_name: body.name,
                        redirect_uris: body.redirectUris,
                        skip_consent: body.skipConsent,
                        ...AUTH_METHODS[body.type],
                        scope: "openid profile email",
                        grant_types: ["authorization_code"],
                        response_types: ["code"],
                        require_pkce: true,
                    },
                });
                return conn.write((tx) => {
                    const row = readRow(tx, created.client_id);
                    if (row === null) throw new Error("the library registered an OAuth client that cannot be read back");
                    // 参数只记种类与是否免确认，不记密钥与回调地址（`site.admin` 输出 8）。
                    appendAudit(tx, {actorId: session.userId, action: "oauth_client.create", targetType: "oauth_client", targetId: row.id, params: {type: body.type, skipConsent: body.skipConsent}, now: nowMs});
                    return {client: itemOf(row), clientSecret: body.type === "confidential" ? secretOf(created.client_secret) : null};
                });
            });
            return c.json(response);
        } catch (error) {
            const libraryCode = libraryRedirectRejection(error);
            if (libraryCode === null) throw error;
            log.warn("identity.oauth_client_rule_drift", "the library rejected redirect URIs that the module's rules accepted", {libraryCode, type: body.type});
            throw new IdentityFailure("redirect_uri_invalid");
        }
    });

    app.patch(itemPath, async (c: Context) => {
        const session = await requireSession(c, sessions, `PATCH ${itemPath}`, "admin");
        const {id: clientId} = readParams(c, ClientIdParams);
        const body = await readBody(c, PatchOAuthClientRequest);
        const item = await adminWrite(conn, clock, session, (tx, nowMs) => {
            const row = readRow(tx, clientId);
            if (row === null) throw new IdentityFailure("not_found");
            // 种类按登记时的定，登记后不能改（输出 16）。
            if (body.redirectUris !== undefined && !body.redirectUris.every((uri) => check(uri, typeOf(row)))) throw new IdentityFailure("redirect_uri_invalid");
            const assignments: (readonly [column: string, value: SQLQueryBindings])[] = [];
            if (body.name !== undefined) assignments.push([`"name"`, body.name]);
            // 与库一样存成 JSON 数组文本（存法契约）。
            if (body.redirectUris !== undefined) assignments.push([`"redirectUris"`, JSON.stringify(body.redirectUris)]);
            if (body.skipConsent !== undefined) assignments.push([`"skipConsent"`, body.skipConsent ? 1 : 0]);
            if (body.disabled !== undefined) assignments.push([`"disabled"`, body.disabled ? 1 : 0]);
            const setList = assignments.map(([column]) => `${column} = ?`).join(", ");
            tx.query(`UPDATE "oauthClient" SET ${setList}, "updatedAt" = ? WHERE "id" = ?`).run(...assignments.map(([, value]) => value), libSecond(nowMs), row.id);
            // 停用时撤掉它名下的令牌与没用掉的码：库停用后只是不再发，已发的照用；撤在同一个事务里，之后再启用也不复活（输出 8 末项）。
            if (body.disabled === true && row.disabled !== 1) revokeOAuthForClient(tx, clientId, nowMs);
            // 只记改了哪些属性，不记新值：回调地址与名字不进审计（输出 8）。没有变化的改动照样写。
            const properties = PATCH_PROPERTIES.filter((key) => body[key] !== undefined).join(",");
            appendAudit(tx, {actorId: session.userId, action: "oauth_client.update", targetType: "oauth_client", targetId: row.id, params: {properties}, now: nowMs});
            return itemOf(readRow(tx, clientId)!);
        });
        return c.json(item);
    });

    app.post(rotatePath, async (c: Context) => {
        const session = await requireSession(c, sessions, `POST ${rotatePath}`, "admin");
        const {id: clientId} = readParams(c, ClientIdParams);
        await readEmptyBody(c);
        const secret = generateClientSecret();
        const response = await adminWrite(conn, clock, session, (tx, nowMs): RotateSecretResponse => {
            const row = readRow(tx, clientId);
            if (row === null) throw new IdentityFailure("not_found");
            if (typeOf(row) === "public") throw new IdentityFailure("client_public");
            // 与库登记时同一种存法（`client-secret.ts`）；换码时库对带来的密钥算同一个哈希比较，旧密钥立即对不上。
            tx.query(`UPDATE "oauthClient" SET "clientSecret" = ?, "updatedAt" = ? WHERE "id" = ?`).run(clientSecretHash(secret), libSecond(nowMs), row.id);
            appendAudit(tx, {actorId: session.userId, action: "oauth_client.rotate_secret", targetType: "oauth_client", targetId: row.id, params: {}, now: nowMs});
            return {clientSecret: secret};
        });
        return c.json(response);
    });
}

/** 机密客户端登记后库回的明文密钥；没有时是库换了行为，程序错误（回 500，事务回滚，客户端不登记）。 */
function secretOf(secret: string | undefined): string {
    if (secret === undefined || secret === "") throw new Error("the library registered a confidential client without a secret");
    return secret;
}
