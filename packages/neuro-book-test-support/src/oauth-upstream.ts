/**
 * 仿真的社交上游：Google（OpenID Connect：发现文档、签名的 id_token、userinfo、公钥）与 GitHub（OAuth 2：授权、换令牌、`/user`、
 * `/user/emails`），在本机 `127.0.0.1` 的一个随机端口上，两个上游按路径前缀分开（`/google`、`/github`）。
 *
 * 它是第三方的替身，不是被测系统的实现：形状照两家文档写的真实响应（w00037 t08 计划 3.14，探针 `spike7-env.ts` 实测能被
 * better-auth 1.7.27 的 `genericOAuth` 用），包括 GitHub 换令牌出错时回 200 加 `error` 字段、不 `Accept: json` 时回表单编码。
 * 用户在上游的操作被简化成“授权地址自动同意”：浏览器（测试）请求授权地址，上游按 `setUser` 设的人立即 302 回站点的回调地址，
 * 带 `code` 与 `state`；`cancelNext` 让下一次回 `error=access_denied`（用户点了取消，两家都这样回）。
 *
 * 用 `node:http` 而不是 `Bun.serve`：本包按 Node 的类型检查（tsconfig 只有 node 与 vitest 的类型），在 Bun 里同样能跑。
 */

import {createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject} from "node:crypto";
import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import type {AddressInfo} from "node:net";

export type FakeProvider = "google" | "github";

/** Google 的 userinfo 与 id_token 里本站会读的字段。`email` 省略时 id_token 与 userinfo 都不带邮箱。 */
export interface FakeGoogleUser {
    readonly sub: string;
    readonly email?: string;
    readonly email_verified: boolean;
    readonly name: string;
    readonly picture?: string;
}

/** GitHub 的 `/user` 与 `/user/emails`。`emails` 为空时这个账号没有主邮箱。 */
export interface FakeGitHubUser {
    readonly id: number;
    readonly login: string;
    readonly name: string | null;
    readonly email: string | null;
    readonly emails: readonly {readonly email: string; readonly primary: boolean; readonly verified: boolean; readonly visibility: string | null}[];
}

/** 被挡住的一次换令牌：`arrived` 在请求到了上游时 resolve，`release()` 之后上游才回答。 */
export interface HeldRequest {
    readonly arrived: Promise<void>;
    release(): void;
}

export interface FakeUpstream {
    /** 形如 `http://127.0.0.1:<端口>`，不带结尾的 `/`。 */
    readonly base: string;
    /** 之后在这个上游“登录着”的人：下一次授权按他发码。码发出时取下当时的人，之后再改不影响已发的码。 */
    setUser(provider: "google", user: FakeGoogleUser): void;
    setUser(provider: "github", user: FakeGitHubUser): void;
    /** 下一次换令牌失败（Google 400 `invalid_grant`；GitHub 200 加 `error: bad_verification_code`），只影响一次。 */
    failToken(provider: FakeProvider): void;
    /** 下一次授权回 `error=access_denied`，只影响一次。 */
    cancelNext(provider: FakeProvider): void;
    /**
     * 挡住之后的一次换令牌，给要在“上游已返回之前”插入别的操作的用例造时序。连调几次挡住接下来的几次，按到达的先后对上调用的先后。
     */
    holdToken(provider: FakeProvider): HeldRequest;
    /**
     * 之后 Google 的发现文档带不带 `jwks_uri`（缺省带）：造“发现文档缺验 id_token 所需的公钥地址”的上游。公钥地址本身照常回答，
     * 只是文档里不指向它。
     */
    omitJwksUri(omitted: boolean): void;
    close(): Promise<void>;
}

/** 站点接上仿真上游要的七个变量（`site.accounts` 输入一节的配置）。 */
export function upstreamEnv(upstream: Pick<FakeUpstream, "base">): Record<string, string> {
    return {
        NB_SITE_IDENTITY_GOOGLE_CLIENT_ID: FAKE_CLIENTS.google.id,
        NB_SITE_IDENTITY_GOOGLE_CLIENT_SECRET: FAKE_CLIENTS.google.secret,
        NB_SITE_IDENTITY_GITHUB_CLIENT_ID: FAKE_CLIENTS.github.id,
        NB_SITE_IDENTITY_GITHUB_CLIENT_SECRET: FAKE_CLIENTS.github.secret,
        NB_SITE_IDENTITY_GOOGLE_ISSUER: `${upstream.base}/google`,
        NB_SITE_IDENTITY_GITHUB_URL: `${upstream.base}/github`,
        NB_SITE_IDENTITY_GITHUB_API_URL: `${upstream.base}/github/api`,
    };
}

/** 仿真上游认的客户端。换令牌时核对 id 与密钥（表单或 Basic 都收），与真实上游一样不对就拒。 */
export const FAKE_CLIENTS: Readonly<Record<FakeProvider, {readonly id: string; readonly secret: string}>> = {
    google: {id: "fake-google-client", secret: "fake-google-secret-0123456789"},
    github: {id: "fake-github-client", secret: "fake-github-secret-0123456789"},
};

interface IssuedCode {
    readonly provider: FakeProvider;
    readonly user: FakeGoogleUser | FakeGitHubUser;
    readonly clientId: string;
    readonly redirectUri: string;
    readonly nonce: string | undefined;
    readonly challenge: string | undefined;
}

const KID = "fake-google-1";

export async function startFakeUpstream(): Promise<FakeUpstream> {
    const {publicKey, privateKey} = generateKeyPairSync("rsa", {modulusLength: 2048});
    const jwk = {...(publicKey.export({format: "jwk"}) as Record<string, string>), kid: KID, alg: "RS256", use: "sig"};
    const users: {google?: FakeGoogleUser; github?: FakeGitHubUser} = {};
    const codes = new Map<string, IssuedCode>();
    const tokens = new Map<string, {readonly provider: FakeProvider; readonly user: FakeGoogleUser | FakeGitHubUser}>();
    const failNext = new Set<FakeProvider>();
    const cancel = new Set<FakeProvider>();
    const holds: Record<FakeProvider, {readonly arrive: () => void; readonly released: Promise<void>}[]> = {google: [], github: []};
    const releases: (() => void)[] = [];
    let jwksUriOmitted = false;
    let base = "";

    const server = createServer((request, response) => {
        handle(request, response).catch((error: unknown) => {
            // 仿真上游自己的错误回 500，测试会以站点的 `social_failed` 看到它；不吞：打到标准错误，便于查用例为什么失败。
            console.error("fake upstream failed to answer", request.method, request.url, error);
            if (!response.headersSent) response.writeHead(500);
            response.end();
        });
    });

    async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const url = new URL(request.url ?? "/", base);
        const path = url.pathname;
        const body = await readBody(request);

        if (path === "/google/.well-known/openid-configuration") {
            return json(response, 200, {
                issuer: `${base}/google`,
                authorization_endpoint: `${base}/google/o/oauth2/v2/auth`,
                token_endpoint: `${base}/google/token`,
                userinfo_endpoint: `${base}/google/v1/userinfo`,
                ...(jwksUriOmitted ? {} : {jwks_uri: `${base}/google/oauth2/v3/certs`}),
                response_types_supported: ["code", "token", "id_token", "code token", "code id_token", "token id_token", "code token id_token", "none"],
                subject_types_supported: ["public"],
                id_token_signing_alg_values_supported: ["RS256"],
                scopes_supported: ["openid", "email", "profile"],
                token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
                claims_supported: ["aud", "email", "email_verified", "exp", "family_name", "given_name", "iat", "iss", "name", "picture", "sub"],
                code_challenge_methods_supported: ["plain", "S256"],
            });
        }
        if (path === "/google/oauth2/v3/certs") return json(response, 200, {keys: [jwk]});
        if (path === "/google/o/oauth2/v2/auth") return authorize(response, "google", url);
        if (path === "/github/login/oauth/authorize") return authorize(response, "github", url);
        if (path === "/google/token") return token(request, response, "google", body);
        if (path === "/github/login/oauth/access_token") return token(request, response, "github", body);

        const bearer = (request.headers.authorization ?? "").replace(/^(Bearer|token) /iu, "");
        const holder = tokens.get(bearer);
        if (path === "/google/v1/userinfo") {
            if (holder?.provider !== "google") return json(response, 401, {error: "invalid_request", error_description: "Invalid Credentials"});
            const user = holder.user as FakeGoogleUser;
            return json(response, 200, {sub: user.sub, name: user.name, picture: user.picture, ...(user.email === undefined ? {} : {email: user.email, email_verified: user.email_verified})});
        }
        if (path === "/github/api/user") {
            if (holder?.provider !== "github") return json(response, 401, {message: "Bad credentials", documentation_url: "https://docs.github.com/rest", status: "401"});
            const user = holder.user as FakeGitHubUser;
            return json(response, 200, {
                login: user.login,
                id: user.id,
                avatar_url: `https://avatars.githubusercontent.com/u/${String(user.id)}?v=4`,
                html_url: `https://github.com/${user.login}`,
                type: "User",
                site_admin: false,
                name: user.name,
                email: user.email,
                created_at: "2015-01-01T00:00:00Z",
            });
        }
        if (path === "/github/api/user/emails") {
            if (holder?.provider !== "github") return json(response, 401, {message: "Bad credentials"});
            return json(response, 200, (holder.user as FakeGitHubUser).emails);
        }
        response.writeHead(404, {"content-type": "text/plain"});
        response.end("not found");
    }

    function authorize(response: ServerResponse, provider: FakeProvider, url: URL): void {
        const redirectUri = url.searchParams.get("redirect_uri");
        const clientId = url.searchParams.get("client_id");
        if (redirectUri === null || clientId !== FAKE_CLIENTS[provider].id) return json(response, 400, {error: "invalid_request"});
        const back = new URL(redirectUri);
        back.searchParams.set("state", url.searchParams.get("state") ?? "");
        if (cancel.delete(provider)) {
            back.searchParams.set("error", "access_denied");
            return redirect(response, back);
        }
        const user = users[provider];
        if (user === undefined) throw new Error(`fake upstream: no ${provider} user was set before authorizing`);
        const code = `${provider}-code-${randomBytes(12).toString("hex")}`;
        codes.set(code, {provider, user, clientId, redirectUri, nonce: url.searchParams.get("nonce") ?? undefined, challenge: url.searchParams.get("code_challenge") ?? undefined});
        back.searchParams.set("code", code);
        if (provider === "google") {
            back.searchParams.set("scope", "email profile openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile");
            back.searchParams.set("authuser", "0");
            back.searchParams.set("prompt", "consent");
        }
        redirect(response, back);
    }

    async function token(request: IncomingMessage, response: ServerResponse, provider: FakeProvider, body: string): Promise<void> {
        const hold = holds[provider].shift();
        if (hold !== undefined) {
            hold.arrive();
            await hold.released;
        }
        const form = new URLSearchParams(body);
        const failure = (): void => {
            if (provider === "google") return json(response, 400, {error: "invalid_grant", error_description: "Bad Request"});
            return json(response, 200, {
                error: "bad_verification_code",
                error_description: "The code passed is incorrect or expired.",
                error_uri: "https://docs.github.com/apps/managing-oauth-apps/troubleshooting-oauth-app-access-token-request-errors/#bad-verification-code",
            });
        };
        if (failNext.delete(provider)) return failure();
        const client = clientOf(request, form);
        if (client.id !== FAKE_CLIENTS[provider].id || client.secret !== FAKE_CLIENTS[provider].secret) return json(response, 401, {error: "invalid_client"});
        const code = form.get("code") ?? "";
        const issued = codes.get(code);
        codes.delete(code);
        if (issued?.provider !== provider || issued.redirectUri !== form.get("redirect_uri") || !pkceMatches(issued.challenge, form.get("code_verifier"))) return failure();

        const access = `${provider}-at-${randomBytes(16).toString("hex")}`;
        tokens.set(access, {provider, user: issued.user});
        if (provider === "google") {
            const user = issued.user as FakeGoogleUser;
            const now = Math.floor(Date.now() / 1000);
            const idToken = signJwt(privateKey, {
                iss: `${base}/google`,
                azp: issued.clientId,
                aud: issued.clientId,
                sub: user.sub,
                ...(user.email === undefined ? {} : {email: user.email, email_verified: user.email_verified}),
                name: user.name,
                ...(user.picture === undefined ? {} : {picture: user.picture}),
                iat: now,
                exp: now + 3599,
                ...(issued.nonce === undefined ? {} : {nonce: issued.nonce}),
            });
            return json(response, 200, {
                access_token: access,
                expires_in: 3599,
                scope: "https://www.googleapis.com/auth/userinfo.email openid https://www.googleapis.com/auth/userinfo.profile",
                token_type: "Bearer",
                id_token: idToken,
            });
        }
        const payload = {access_token: access, token_type: "bearer", scope: "read:user,user:email"};
        if ((request.headers.accept ?? "").includes("json")) return json(response, 200, payload);
        response.writeHead(200, {"content-type": "application/x-www-form-urlencoded; charset=utf-8"});
        response.end(new URLSearchParams(payload).toString());
    }

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
    });
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

    return {
        base,
        setUser(provider: FakeProvider, user: FakeGoogleUser | FakeGitHubUser) {
            if (provider === "google") users.google = user as FakeGoogleUser;
            else users.github = user as FakeGitHubUser;
        },
        failToken(provider) {
            failNext.add(provider);
        },
        cancelNext(provider) {
            cancel.add(provider);
        },
        holdToken(provider) {
            let arrive!: () => void;
            let release!: () => void;
            const arrived = new Promise<void>((resolve) => (arrive = resolve));
            const released = new Promise<void>((resolve) => (release = resolve));
            holds[provider].push({arrive, released});
            releases.push(release);
            return {arrived, release};
        },
        omitJwksUri(omitted) {
            jwksUriOmitted = omitted;
        },
        close() {
            // 先放掉挡着的请求（到了的与还没到的），免得 close 等一个永远不回答的连接、用例等一个永远不 resolve 的 `arrived`。
            for (const queue of Object.values(holds)) for (const hold of queue.splice(0)) hold.arrive();
            for (const release of releases.splice(0)) release();
            return new Promise<void>((resolve, reject) => {
                server.close((error) => (error === undefined ? resolve() : reject(error)));
                server.closeAllConnections();
            });
        },
    } as FakeUpstream;
}

function readBody(request: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        request.on("error", reject);
    });
}

function json(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, {"content-type": "application/json; charset=utf-8"});
    response.end(JSON.stringify(body));
}

function redirect(response: ServerResponse, location: URL): void {
    response.writeHead(302, {location: location.href});
    response.end();
}

/** 客户端认证：`client_secret_basic`（Basic 头里是百分号编码的 id 与密钥）或 `client_secret_post`。 */
function clientOf(request: IncomingMessage, form: URLSearchParams): {readonly id: string | null; readonly secret: string | null} {
    const basic = /^Basic (.+)$/iu.exec(request.headers.authorization ?? "");
    if (basic !== null) {
        const decoded = Buffer.from(basic[1]!, "base64").toString("utf8");
        const colon = decoded.indexOf(":");
        if (colon !== -1) return {id: decodeURIComponent(decoded.slice(0, colon)), secret: decodeURIComponent(decoded.slice(colon + 1))};
    }
    return {id: form.get("client_id"), secret: form.get("client_secret")};
}

/** 发码时带了 S256 的 `code_challenge` 就要求换码带对的 `code_verifier`（两家都这样判）。 */
function pkceMatches(challenge: string | undefined, verifier: string | null): boolean {
    if (challenge === undefined) return true;
    if (verifier === null) return false;
    return createHash("sha256").update(verifier).digest("base64url") === challenge;
}

function signJwt(privateKey: KeyObject, claims: Record<string, unknown>): string {
    const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");
    const head = encode({alg: "RS256", kid: KID, typ: "JWT"});
    const body = encode(claims);
    const signature = createSign("RSA-SHA256").update(`${head}.${body}`).sign(privateKey).toString("base64url");
    return `${head}.${body}.${signature}`;
}
