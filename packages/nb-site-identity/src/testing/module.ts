/**
 * 包内测试用的账号模块：真的 SQLite 文件（跑真实的迁移）、真的 Better Auth，只注入时钟与日志。子应用按入口的写法挂在
 * `IDENTITY_API_PREFIX` 下，请求走同一条路径。这一片还没有对外的登录，会话经 `sessions.issue` 发。不含断言。
 */

import {Hono} from "hono";

import {IDENTITY_API_PREFIX} from "@notnotype/nb-site-identity-contract";

import type {IdentityConfig} from "../config";
import {IdentityConnection} from "../db/connection";
import {insertUserRow, libDate} from "../db/library-rows";
import {assembleIdentity, type IdentityAssembly, type IdentityJob} from "../module";
import {createTestDbRoot, type TestDbRoot} from "./db";
import {ManualClock, recordingLog, TEST_SECRET, TEST_SITE_URL} from "./library";

export const TEST_TERMS_VERSION = "2026-11-20";

/** 会话 Cookie 的名字（`site.accounts` 输出 5；`auth.ts` 的 `cookiePrefix: "__Host-nbsite"` 下库给的）。 */
export const SESSION_COOKIE = "__Host-nbsite.session_token";

export const TEST_CONFIG: IdentityConfig = {
    sessionSecret: TEST_SECRET,
    termsVersion: TEST_TERMS_VERSION,
    registrationOpen: true,
    sessionDays: 30,
    hashConcurrency: 2,
    hashQueue: 64,
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
    /** 建一个账号（模块的 SQL），回 id；`consent` 给了时另写一条同意记录。 */
    addUser(username: string, options?: {readonly role?: "user" | "admin"; readonly consent?: {readonly termsVersion: string; readonly overseasStorage: boolean}}): Promise<number>;
    /** 给账号发会话，回 `Cookie` 请求头的值与会话 id。 */
    issue(userId: number, userAgent?: string | null): Promise<{readonly cookie: string; readonly sessionId: number; readonly setCookies: string[]}>;
    /** 会话表里的原始行；没有时为 null。 */
    sessionRow(sessionId: number): Promise<Readonly<Record<string, unknown>> | null>;
}

export interface TestIdentityOptions {
    readonly config?: Partial<IdentityConfig>;
    /** 时钟的起点；缺省是现在。 */
    readonly start?: number;
}

/** 从一组 `Set-Cookie` 里取会话 Cookie 的 `名字=值`。 */
export function sessionCookieOf(setCookies: readonly string[]): string {
    const entry = setCookies.find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
    if (entry === undefined) throw new Error("no session cookie was set");
    return entry.split(";")[0]!;
}

/** 建一个测试用的模块；`cleanup` 由用例在 `afterEach` 里调 `root.cleanup()`。 */
export async function createTestIdentity(name: string, options: TestIdentityOptions = {}): Promise<TestIdentity> {
    const root = await createTestDbRoot(name);
    const log = recordingLog();
    const conn = new IdentityConnection(root.open(), {log});
    const clock = new ManualClock(options.start ?? Date.now());
    const jobs: IdentityJob[] = [];
    const assembly = await assembleIdentity(conn, {
        config: {...TEST_CONFIG, ...options.config},
        siteUrl: TEST_SITE_URL,
        log,
        clock,
        jobs: {register: (job) => jobs.push(job)},
        clientAddress: () => "203.0.113.1",
    });
    const app = new Hono();
    app.route(IDENTITY_API_PREFIX, assembly.site);
    return {
        root,
        conn,
        clock,
        log,
        jobs,
        assembly,
        fetch: async (path, init) => app.fetch(new Request(`${TEST_SITE_URL}${IDENTITY_API_PREFIX}${path}`, init)),
        addUser: (username, userOptions = {}) =>
            conn.write((tx) => {
                const id = insertUserRow(tx, {username, displayUsername: username, name: username, email: `${username}@example.com`, role: userOptions.role ?? "user", now: clock.now()});
                const consent = userOptions.consent;
                if (consent !== undefined) {
                    tx.query(`INSERT INTO identity_consent (user_id, terms_version, overseas_storage, created_at) VALUES (?, ?, ?, ?)`).run(id, consent.termsVersion, consent.overseasStorage ? 1 : 0, libDate(clock.now()));
                }
                return id;
            }),
        issue: async (userId, userAgent = null) => {
            const {sessionId, cookies} = await assembly.sessions.issue(userId, userAgent);
            return {cookie: sessionCookieOf(cookies), sessionId, setCookies: cookies};
        },
        sessionRow: (sessionId) => conn.read((tx) => tx.query<Record<string, unknown>, [number]>(`SELECT * FROM "session" WHERE "id" = ?`).get(sessionId)),
    };
}
