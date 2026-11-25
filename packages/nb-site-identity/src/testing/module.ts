/**
 * 包内测试用的账号模块：真的 SQLite 文件（跑真实的迁移）、真的 Better Auth，只注入时钟与日志，以及 `IdentityOverrides` 里用例
 * 给的几样。三个子应用按入口的写法挂在各自的前缀下（`nb-site-server` 的 `modules.ts`），请求走同一条路径。会话可以经登录建，也可以经
 * `issue` 直接发。不含断言。
 *
 * 两处与产品不同的缺省，免得每条用例都真的等：失败下限与“先等 2 秒”的睡眠立即 resolve（时长照常计算，核对它们的用例自己注入
 * 记录调用的睡眠）。来源地址取请求头 `x-test-client-address`，没带时是 `203.0.113.1`：限流按来源计，用例要能换来源。
 */

import {Hono} from "hono";

import {IDENTITY_API_PREFIX, IDENTITY_AUTH_PREFIX} from "@notnotype/nb-site-identity-contract";

import type {IdentityConfig} from "../config";
import {IdentityConnection, type IdentityTimers} from "../db/connection";
import {insertCredentialRow, insertUserRow, libDate} from "../db/library-rows";
import {assembleIdentity, type IdentityAssembly, type IdentityJob, type IdentityOverrides} from "../module";
import {WELL_KNOWN_PREFIX} from "../oauth/discovery";
import {hashPassword} from "../password";
import {createTestDbRoot, type TestDbRoot} from "./db";
import {ManualClock, recordingLog, TEST_SECRET, TEST_SITE_URL, TEST_TERMS_VERSION} from "./library";

export {TEST_TERMS_VERSION};

/** 会话 Cookie 的名字（`site.accounts` 输出 5；`auth.ts` 的 `cookiePrefix: "__Host-nbsite"` 下库给的）。 */
export const SESSION_COOKIE = "__Host-nbsite.session_token";

export const TEST_CONFIG: IdentityConfig = {
    sessionSecret: TEST_SECRET,
    termsVersion: TEST_TERMS_VERSION,
    registrationOpen: true,
    sessionDays: 30,
    hashConcurrency: 2,
    hashQueue: 64,
    social: {},
};

export interface TestIdentity {
    readonly root: TestDbRoot;
    readonly conn: IdentityConnection;
    readonly clock: ManualClock;
    readonly log: ReturnType<typeof recordingLog>;
    readonly jobs: IdentityJob[];
    readonly assembly: IdentityAssembly;
    /** 经入口同样的挂法发一个请求；`path` 相对 `IDENTITY_API_PREFIX`。 */
    fetch(path: string, init?: RequestInit): Promise<Response>;
    /** 同一个入口，`path` 从站点根起（标准端点、发现文档用）。 */
    request(path: string, init?: RequestInit): Promise<Response>;
    /**
     * 建一个账号（模块的 SQL），回 id；`consent` 给了时另写一条同意记录；`password` 给了时用新格式存它的哈希，`passwordHash` 给了时
     * 原样存（旧站格式的样本）。两个都没给的账号没有密码。
     */
    addUser(username: string, options?: TestUserOptions): Promise<number>;
    /** 给账号发会话，回 `Cookie` 请求头的值与会话 id。`userAgent` 是原始的浏览器标识，与请求里的 `User-Agent` 一样经建会话的钩子换成概要。 */
    issue(userId: number, userAgent?: string | null): Promise<{readonly cookie: string; readonly sessionId: number; readonly setCookies: string[]}>;
    /** 会话表里的原始行；没有时为 null。 */
    sessionRow(sessionId: number): Promise<Readonly<Record<string, unknown>> | null>;
}

export interface TestUserOptions {
    readonly role?: "user" | "admin";
    readonly consent?: {readonly termsVersion: string; readonly overseasStorage: boolean};
    readonly password?: string;
    readonly passwordHash?: string;
}

/** 测试里换来源地址的请求头。 */
export const TEST_CLIENT_ADDRESS_HEADER = "x-test-client-address";

export interface TestIdentityOptions {
    readonly config?: Partial<IdentityConfig>;
    /** 时钟的起点；缺省是现在。 */
    readonly start?: number;
    /** 队列等锁上限用的计时器；缺省是真的计时器。给 `ManualTimers` 时 `pending` 就是排队等锁的个数。 */
    readonly timers?: IdentityTimers;
    /** 盖在本文件的缺省之上（见文件头）。 */
    readonly overrides?: IdentityOverrides;
    /**
     * 接着用前一个实例的数据目录（模拟重启）：不新建目录、不再迁移。前一个实例要先 `assembly.close()`；目录由最先建它的用例清理。
     */
    readonly root?: TestDbRoot;
}

/** 从一组 `Set-Cookie` 里取会话 Cookie 的 `名字=值`。 */
export function sessionCookieOf(setCookies: readonly string[]): string {
    const entry = setCookies.find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
    if (entry === undefined) throw new Error("no session cookie was set");
    return entry.split(";")[0]!;
}

/** 建一个测试用的模块；`cleanup` 由用例在 `afterEach` 里调 `root.cleanup()`。 */
export async function createTestIdentity(name: string, options: TestIdentityOptions = {}): Promise<TestIdentity> {
    const root = options.root ?? (await createTestDbRoot(name));
    const log = recordingLog();
    const conn = new IdentityConnection(root.open(), {log, ...(options.timers === undefined ? {} : {timers: options.timers})});
    const clock = new ManualClock(options.start ?? Date.now());
    const jobs: IdentityJob[] = [];
    const assembly = await assembleIdentity(
        conn,
        {
            config: {...TEST_CONFIG, ...options.config},
            siteUrl: TEST_SITE_URL,
            log,
            clock,
            jobs: {register: (job) => jobs.push(job)},
            clientAddress: (c) => c.req.header(TEST_CLIENT_ADDRESS_HEADER) ?? "203.0.113.1",
        },
        {failureFloor: {sleep: () => Promise.resolve()}, loginDelay: () => Promise.resolve(), ...options.overrides},
    );
    const app = new Hono();
    app.route(IDENTITY_API_PREFIX, assembly.site);
    app.route(IDENTITY_AUTH_PREFIX, assembly.oauth);
    app.route(WELL_KNOWN_PREFIX, assembly.wellKnown);
    return {
        root,
        conn,
        clock,
        log,
        jobs,
        assembly,
        fetch: async (path, init) => app.fetch(new Request(`${TEST_SITE_URL}${IDENTITY_API_PREFIX}${path}`, init)),
        request: async (path, init) => app.fetch(new Request(`${TEST_SITE_URL}${path}`, init)),
        addUser: async (username, userOptions = {}) => {
            const passwordHash = userOptions.passwordHash ?? (userOptions.password === undefined ? undefined : await hashPassword(userOptions.password));
            return conn.write((tx) => {
                const id = insertUserRow(tx, {username, displayUsername: username, name: username, email: `${username}@example.com`, role: userOptions.role ?? "user", now: clock.now()});
                const consent = userOptions.consent;
                if (consent !== undefined) {
                    tx.query(`INSERT INTO identity_consent (user_id, terms_version, overseas_storage, created_at) VALUES (?, ?, ?, ?)`).run(id, consent.termsVersion, consent.overseasStorage ? 1 : 0, libDate(clock.now()));
                }
                if (passwordHash !== undefined) insertCredentialRow(tx, {userId: id, passwordHash, now: clock.now()});
                return id;
            });
        },
        issue: async (userId, userAgent = null) => {
            const {sessionId, cookies} = await assembly.sessions.issue(userId, userAgent);
            return {cookie: sessionCookieOf(cookies), sessionId, setCookies: cookies};
        },
        sessionRow: (sessionId) => conn.read((tx) => tx.query<Record<string, unknown>, [number]>(`SELECT * FROM "session" WHERE "id" = ?`).get(sessionId)),
    };
}
