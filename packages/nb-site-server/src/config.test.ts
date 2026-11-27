/**
 * 配置校验（`site.operations` 的输入一节、输出 1 与问题词表），进程内调用 `parseSiteConfig`，用真模块与真的临时目录。
 */

import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {chmod, mkdir, realpath, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {configFailure, parseSiteConfig, type Env} from "./config";
import type {SiteModule} from "./module";
import {SITE_MODULES} from "./modules";

let root: string;
let dataDir: string;

beforeEach(async () => {
    root = await createTestTmpRoot("nb-site-config", "nb-site-server config.test.ts");
    dataDir = join(root, "data");
    await mkdir(dataDir);
});

afterEach(async () => {
    // 有个用例把数据目录改成只读，恢复了才删得掉里面的东西。
    await chmod(dataDir, 0o755);
    await rm(root, {recursive: true, force: true});
});

/** 特征明显的取值：在输出的整段文字里搜它们，确认没有泄漏。 */
const SECRET = "SECRET-VALUE-4b1d-0123456789abcdef0123456789";

function validEnv(): Record<string, string> {
    return {
        NB_SITE_URL: "https://site.example",
        NB_SITE_TELEMETRY_URL: "https://ingest.example",
        NB_SITE_DATA_DIR: dataDir,
        NB_SITE_SESSION_SECRET: SECRET,
        NB_SITE_IDENTITY_TERMS_VERSION: "2026-11-20",
    };
}

function problemsOf(env: Env, modules: readonly SiteModule[] = SITE_MODULES): {name: string; problem: string}[] {
    const result = parseSiteConfig(env, modules);
    if (result.ok) throw new Error("expected configuration problems");
    return [...result.problems];
}

describe("parseSiteConfig", () => {
    it("合格的配置得到缺省值与两个地址的 origin", () => {
        const result = parseSiteConfig(validEnv(), SITE_MODULES);
        if (!result.ok) throw new Error(JSON.stringify(result.problems));
        const {base} = result.config;
        expect(base.site).toEqual({siteUrl: "https://site.example", telemetryUrl: "https://ingest.example"});
        expect(base.telemetryHost).toBe("ingest.example");
        expect({host: base.host, port: base.port, backupKeep: base.backupKeep, shutdownTimeoutMs: base.shutdownTimeoutMs}).toEqual({
            host: "127.0.0.1",
            port: 8080,
            backupKeep: 7,
            shutdownTimeoutMs: 10_000,
        });
        expect(base.trustedProxies.check("127.0.0.1", "ipv4")).toBe(false);
        expect(result.config.modules.get("identity")).toEqual({sessionSecret: SECRET, termsVersion: "2026-11-20", registrationOpen: true, sessionDays: 30, hashConcurrency: 2, hashQueue: 64, social: {}});
        // 停止时限的上界本身可以用。
        expect(parseSiteConfig({...validEnv(), NB_SITE_SHUTDOWN_TIMEOUT_MS: "2147483647"}, SITE_MODULES).ok).toBe(true);
    });

    it("必填项没给或给了空串都报 missing", () => {
        expect(problemsOf({NB_SITE_URL: ""})).toEqual([
            {name: "NB_SITE_URL", problem: "missing"},
            {name: "NB_SITE_TELEMETRY_URL", problem: "missing"},
            {name: "NB_SITE_DATA_DIR", problem: "missing"},
            {name: "NB_SITE_SESSION_SECRET", problem: "missing"},
            {name: "NB_SITE_IDENTITY_TERMS_VERSION", problem: "missing"},
        ]);
    });

    it.each([
        ["NB_SITE_URL", "http://site.example", "not_https"],
        ["NB_SITE_URL", "not a url", "not_https"],
        ["NB_SITE_URL", "https://site.example/app", "has_path"],
        ["NB_SITE_URL", "https://site.example/?a=1", "has_path"],
        ["NB_SITE_URL", "https://site.example/#top", "has_path"],
        ["NB_SITE_TELEMETRY_URL", "https://SITE.example.:8443", "same_host"],
        ["NB_SITE_DATA_DIR", "relative/data", "not_absolute"],
        ["NB_SITE_SESSION_SECRET", "short-secret", "too_short"],
        ["NB_SITE_HOST", "localhost", "not_ip"],
        ["NB_SITE_PORT", "80a", "not_integer"],
        ["NB_SITE_PORT", "65536", "out_of_range"],
        ["NB_SITE_PORT", "-1", "out_of_range"],
        ["NB_SITE_TRUSTED_PROXIES", "10.0.0.0/8,10.0.0.0/33", "bad_subnet"],
        ["NB_SITE_TRUSTED_PROXIES", "proxy.internal", "bad_subnet"],
        ["NB_SITE_BACKUP_KEEP", "0", "out_of_range"],
        ["NB_SITE_BACKUP_KEEP", "1.5", "not_integer"],
        ["NB_SITE_SHUTDOWN_TIMEOUT_MS", "0", "out_of_range"],
        ["NB_SITE_SHUTDOWN_TIMEOUT_MS", "2147483648", "out_of_range"],
    ])("%s=%s 报 %s", (name, value, problem) => {
        expect(problemsOf({...validEnv(), [name]: value})).toEqual([{name, problem}]);
    });

    it("数据目录不存在、是文件、不可写时分别报 not_directory 与 not_writable", async () => {
        expect(problemsOf({...validEnv(), NB_SITE_DATA_DIR: join(root, "absent")})).toEqual([{name: "NB_SITE_DATA_DIR", problem: "not_directory"}]);
        const file = join(root, "file");
        await writeFile(file, "");
        expect(problemsOf({...validEnv(), NB_SITE_DATA_DIR: file})).toEqual([{name: "NB_SITE_DATA_DIR", problem: "not_directory"}]);
        await chmod(dataDir, 0o555);
        // root 用户不受权限位限制，这条在 root 下无从验证。
        if (process.getuid?.() !== 0) expect(problemsOf(validEnv())).toEqual([{name: "NB_SITE_DATA_DIR", problem: "not_writable"}]);
    });

    it("前端产物目录：不设（含空串）时不发网页；设了要是绝对路径、存在的目录、里面有 index.html，记下解开链接之后的路径", async () => {
        expect(parseSiteConfig(validEnv(), SITE_MODULES)).toMatchObject({ok: true, config: {base: {webDir: null}}});
        expect(parseSiteConfig({...validEnv(), NB_SITE_WEB_DIR: ""}, SITE_MODULES)).toMatchObject({ok: true, config: {base: {webDir: null}}});

        const web = join(root, "web");
        await mkdir(web);
        await writeFile(join(web, "index.html"), "<!doctype html>");
        const linked = join(root, "web-link");
        await symlink(web, linked);
        expect(parseSiteConfig({...validEnv(), NB_SITE_WEB_DIR: linked}, SITE_MODULES)).toMatchObject({ok: true, config: {base: {webDir: await realpath(web)}}});

        const webProblems = (value: string): unknown[] => problemsOf({...validEnv(), NB_SITE_WEB_DIR: value});
        expect(webProblems("relative/web")).toEqual([{name: "NB_SITE_WEB_DIR", problem: "not_absolute"}]);
        expect(webProblems(join(root, "absent"))).toEqual([{name: "NB_SITE_WEB_DIR", problem: "not_directory"}]);
        expect(webProblems(join(web, "index.html"))).toEqual([{name: "NB_SITE_WEB_DIR", problem: "not_directory"}]);
        const empty = join(root, "empty-web");
        await mkdir(empty);
        expect(webProblems(empty)).toEqual([{name: "NB_SITE_WEB_DIR", problem: "no_index"}]);
        // index.html 是个目录、或是指向不存在之处的链接，都不是能发的那个文件。
        await mkdir(join(empty, "index.html"));
        expect(webProblems(empty)).toEqual([{name: "NB_SITE_WEB_DIR", problem: "no_index"}]);
        const dangling = join(root, "dangling-web");
        await mkdir(dangling);
        await symlink(join(root, "nowhere.html"), join(dangling, "index.html"));
        expect(webProblems(dangling)).toEqual([{name: "NB_SITE_WEB_DIR", problem: "no_index"}]);
        // 经链接落到目录外的 index.html 不算有：回退只发目录里的文件，这样的目录启动了也发不出一个页面。
        const escaping = join(root, "escaping-web");
        await mkdir(escaping);
        await writeFile(join(root, "outside.html"), "<!doctype html>");
        await symlink(join(root, "outside.html"), join(escaping, "index.html"));
        expect(webProblems(escaping)).toEqual([{name: "NB_SITE_WEB_DIR", problem: "no_index"}]);
        // 链到目录里另一个文件的 index.html 照常算有。
        const aliased = join(root, "aliased-web");
        await mkdir(aliased);
        await writeFile(join(aliased, "app.html"), "<!doctype html>");
        await symlink(join(aliased, "app.html"), join(aliased, "index.html"));
        expect(parseSiteConfig({...validEnv(), NB_SITE_WEB_DIR: aliased}, SITE_MODULES)).toMatchObject({ok: true, config: {base: {webDir: await realpath(aliased)}}});
    });

    it("会话密钥按字符数算，32 个够、31 个不够", () => {
        expect(parseSiteConfig({...validEnv(), NB_SITE_SESSION_SECRET: "密".repeat(32)}, SITE_MODULES).ok).toBe(true);
        expect(problemsOf({...validEnv(), NB_SITE_SESSION_SECRET: "密".repeat(31)})).toEqual([{name: "NB_SITE_SESSION_SECRET", problem: "too_short"}]);
    });

    it("测试控制口令：32 到 256 个字母、数字、- 与 _；短了报 too_short，过长或含别的字符报 bad_format", () => {
        const tokenProblems = (token: string): unknown[] => {
            const result = parseSiteConfig({...validEnv(), NB_SITE_TEST_CONTROL: token}, SITE_MODULES);
            return result.ok ? [] : [...result.problems];
        };
        for (const token of ["a".repeat(32), "Az09-_".repeat(6).slice(0, 32), "x".repeat(256)]) expect({token, problems: tokenProblems(token)}).toEqual({token, problems: []});
        const accepted = parseSiteConfig({...validEnv(), NB_SITE_TEST_CONTROL: "Az09-_".repeat(6)}, SITE_MODULES);
        if (!accepted.ok) throw new Error(JSON.stringify(accepted.problems));
        expect(accepted.config.base.testControlToken).toBe("Az09-_".repeat(6));
        for (const token of ["a".repeat(31), "口".repeat(31)]) {
            expect({token, problems: tokenProblems(token)}).toEqual({token, problems: [{name: "NB_SITE_TEST_CONTROL", problem: "too_short"}]});
        }
        // 汉字放不进请求头，末尾的空格会被 HTTP 客户端去掉：配得进去却永远对不上。
        for (const token of ["x".repeat(257), "口".repeat(32), `${"a".repeat(32)} `, `${"a".repeat(16)}.${"a".repeat(16)}`, `${"a".repeat(32)}=`]) {
            expect({token, problems: tokenProblems(token)}).toEqual({token, problems: [{name: "NB_SITE_TEST_CONTROL", problem: "bad_format"}]});
        }
    });

    it("设了测试控制口令时监听地址只许本机回环，问题记在监听地址上", () => {
        const token = "a".repeat(32);
        const withToken = (host?: string): Env => ({...validEnv(), NB_SITE_TEST_CONTROL: token, ...(host === undefined ? {} : {NB_SITE_HOST: host})});
        for (const host of ["127.0.0.1", "127.8.9.10", "::1", "0:0:0:0:0:0:0:1"]) expect({host, ok: parseSiteConfig(withToken(host), SITE_MODULES).ok}).toEqual({host, ok: true});
        for (const host of ["0.0.0.0", "10.0.0.1", "::", "::ffff:127.0.0.1", "fe80::1"]) {
            expect({host, problems: problemsOf(withToken(host))}).toEqual({host, problems: [{name: "NB_SITE_HOST", problem: "not_loopback"}]});
        }
        // 没设口令（含空串）时不限制监听地址，也没有口令。
        const without = parseSiteConfig({...validEnv(), NB_SITE_HOST: "0.0.0.0", NB_SITE_TEST_CONTROL: ""}, SITE_MODULES);
        if (!without.ok) throw new Error(JSON.stringify(without.problems));
        expect(without.config.base.testControlToken).toBeNull();
    });

    it("可信代理接受单个地址与 IPv6 网段", () => {
        const result = parseSiteConfig({...validEnv(), NB_SITE_TRUSTED_PROXIES: "10.0.0.1, fd00::/8"}, SITE_MODULES);
        if (!result.ok) throw new Error(JSON.stringify(result.problems));
        expect(result.config.base.trustedProxies.check("10.0.0.1", "ipv4")).toBe(true);
        expect(result.config.base.trustedProxies.check("10.0.0.2", "ipv4")).toBe(false);
        expect(result.config.base.trustedProxies.check("fd12::1", "ipv6")).toBe(true);
    });

    it("没有模块声明写入口时不要求写入口地址，也不核对主机名", () => {
        const siteOnly = SITE_MODULES.filter((module) => !module.surfaces.includes("ingest"));
        expect(siteOnly.map((module) => module.name)).toEqual(["identity"]);
        const env = validEnv();
        delete env.NB_SITE_TELEMETRY_URL;
        const result = parseSiteConfig(env, siteOnly);
        if (!result.ok) throw new Error(JSON.stringify(result.problems));
        expect(result.config.base.site.telemetryUrl).toBeNull();
        expect(result.config.base.telemetryHost).toBeNull();
        // 不装账号模块时也不要求会话密钥。
        const withoutSecret = validEnv();
        delete withoutSecret.NB_SITE_SESSION_SECRET;
        expect(parseSiteConfig(withoutSecret, SITE_MODULES.filter((module) => module.name !== "identity")).ok).toBe(true);
    });

    it("失败那一行只有变量名与问题词，不含任何取值", () => {
        const env = {
            NB_SITE_URL: "http://SECRET-VALUE-url.example",
            NB_SITE_TELEMETRY_URL: "https://SECRET-VALUE-url.example/path",
            NB_SITE_DATA_DIR: "SECRET-VALUE-dir",
            NB_SITE_SESSION_SECRET: "SECRET-VALUE",
            NB_SITE_HOST: "SECRET-VALUE-host",
            NB_SITE_PORT: "SECRET-VALUE",
            NB_SITE_TRUSTED_PROXIES: "SECRET-VALUE",
            NB_SITE_BACKUP_KEEP: "SECRET-VALUE",
            NB_SITE_SHUTDOWN_TIMEOUT_MS: "SECRET-VALUE",
            NB_SITE_TEST_CONTROL: "SECRET-VALUE",
            NB_SITE_IDENTITY_TERMS_VERSION: "SECRET-VALUE",
            NB_SITE_WEB_DIR: "SECRET-VALUE-web",
        };
        const failure = configFailure(problemsOf(env));
        const text = JSON.stringify(failure);
        expect(failure.code).toBe("config_invalid");
        expect(text).not.toContain("SECRET-VALUE");
        expect((failure.fields?.problems as unknown[]).length).toBe(12);
    });
});
