/**
 * 登录状态到去处的分派与路由守卫（t10 计划 3.1；`site.accounts` 输出 7、8、10，`site.admin` 输出 1）。两者是纯函数，
 * 直接给账号状态与要去的路由，看回的去处。
 */

import {describe, expect, it} from "bun:test";

import {dispatch, safeNext} from "../src/session/dispatch";
import type {KnownAccount} from "../src/session/dispatch";
import {afterConsentRequired, afterUnauthenticated, guard} from "../src/session/guard";
import type {Access, GuardTarget} from "../src/session/guard";

const ORIGIN = "https://neurobook.example";

const anonymous: KnownAccount = {kind: "anonymous"};
const user: KnownAccount = {kind: "signed-in", role: "user", consentRequired: false};
const admin: KnownAccount = {kind: "signed-in", role: "admin", consentRequired: false};
const userWithoutConsent: KnownAccount = {kind: "signed-in", role: "user", consentRequired: true};
const adminWithoutConsent: KnownAccount = {kind: "signed-in", role: "admin", consentRequired: true};

function target(fullPath: string, access: Access, extra: Partial<GuardTarget> = {}): GuardTarget {
    return {fullPath, access, next: undefined, signedInWithContinue: false, hasContinue: false, ...extra};
}

describe("next 只收站内路径", () => {
    it("站内的路径、查询串与片段原样留下", () => {
        expect(safeNext("/account", ORIGIN)).toBe("/account");
        expect(safeNext("/admin/users?page=2#top", ORIGIN)).toBe("/admin/users?page=2#top");
    });

    it("别的站点、协议相对写法、反斜杠写法、相对路径、带协议的地址与不是字符串的值都当作没带", () => {
        const rejected: unknown[] = [
            "//evil.example/path",
            "/\\evil.example/path",
            "https://evil.example/",
            "javascript:alert(1)",
            "account",
            "",
            undefined,
            null,
            ["/account"],
            42,
        ];
        for (const next of rejected) expect({next, safe: safeNext(next, ORIGIN)}).toEqual({next, safe: undefined});
    });

    it("浏览器会删掉的制表符与换行藏不住 `//`：解析后出站的也拒绝", () => {
        // `/\t/evil.example` 第二个字符是制表符，过了前缀检查；URL 解析会删掉它，变成 `//evil.example`。
        expect(safeNext("/\t/evil.example/", ORIGIN)).toBeUndefined();
        expect(safeNext("/\n/evil.example/", ORIGIN)).toBeUndefined();
    });
});

describe("分派", () => {
    it("匿名留在登录页，带着 next", () => {
        expect(dispatch(anonymous, undefined)).toBe("/login");
        expect(dispatch(anonymous, "/admin/users")).toBe("/login?next=%2Fadmin%2Fusers");
    });

    it("缺同意的人不论角色先去同意页，原来的 next 带过去", () => {
        expect(dispatch(userWithoutConsent, undefined)).toBe("/consent");
        expect(dispatch(adminWithoutConsent, "/admin")).toBe("/consent?next=%2Fadmin");
    });

    it("没带 next 时管理员去看板、普通用户去账号页", () => {
        expect(dispatch(admin, undefined)).toBe("/admin");
        expect(dispatch(user, undefined)).toBe("/account");
    });

    it("带合格的 next 时去 next", () => {
        expect(dispatch(user, "/oauth/consent?client_id=x")).toBe("/oauth/consent?client_id=x");
        expect(dispatch(admin, "/admin/audit")).toBe("/admin/audit");
    });
});

describe("路由守卫", () => {
    it("公开页谁都能进", () => {
        for (const account of [anonymous, user, admin, userWithoutConsent]) expect(guard(target("/privacy", "public"), account, ORIGIN)).toBe(true);
    });

    it("访客页：匿名放行；已登录的按分派跳走，合格的 next 照用，不合格的当作没带", () => {
        expect(guard(target("/login", "guest"), anonymous, ORIGIN)).toBe(true);
        expect(guard(target("/login", "guest"), admin, ORIGIN)).toBe("/admin");
        expect(guard(target("/", "guest"), user, ORIGIN)).toBe("/account");
        expect(guard(target("/login?next=%2Fadmin%2Fcodes", "guest", {next: "/admin/codes"}), admin, ORIGIN)).toBe("/admin/codes");
        expect(guard(target("/login?next=%2F%2Fevil.example", "guest", {next: "//evil.example"}), user, ORIGIN)).toBe("/account");
        expect(guard(target("/register", "guest"), userWithoutConsent, ORIGIN)).toBe("/consent");
    });

    it("登录页带续接令牌时已登录的人也看到登录表单；不带令牌或别的访客页照常分派", () => {
        const login = target("/login?continue=abc", "guest", {signedInWithContinue: true, hasContinue: true});
        expect(guard(login, user, ORIGIN)).toBe(true);
        expect(guard({...login, hasContinue: false}, user, ORIGIN)).toBe("/account");
        expect(guard(target("/register?continue=abc", "guest", {hasContinue: true}), user, ORIGIN)).toBe("/account");
    });

    it("同意页：访客先登录；缺同意的放行；不缺的按分派跳走", () => {
        expect(guard(target("/consent", "consent"), anonymous, ORIGIN)).toBe("/login?next=%2Fconsent");
        expect(guard(target("/consent", "consent"), userWithoutConsent, ORIGIN)).toBe(true);
        expect(guard(target("/consent", "consent"), user, ORIGIN)).toBe("/account");
        expect(guard(target("/consent?next=%2Fadmin", "consent", {next: "/admin"}), admin, ORIGIN)).toBe("/admin");
    });

    it("要登录的页：匿名带着当前地址去登录，缺同意的带着当前地址去同意页", () => {
        expect(guard(target("/account", "user"), anonymous, ORIGIN)).toBe("/login?next=%2Faccount");
        expect(guard(target("/admin/users?page=2", "admin"), anonymous, ORIGIN)).toBe("/login?next=%2Fadmin%2Fusers%3Fpage%3D2");
        expect(guard(target("/account", "user"), userWithoutConsent, ORIGIN)).toBe("/consent?next=%2Faccount");
        expect(guard(target("/admin", "admin"), adminWithoutConsent, ORIGIN)).toBe("/consent?next=%2Fadmin");
    });

    it("普通用户进管理面板的任何一页都去账号页；管理员放行，也能进账号页", () => {
        for (const path of ["/admin", "/admin/users", "/admin/codes", "/admin/clients", "/admin/audit"]) {
            expect({path, to: guard(target(path, "admin"), user, ORIGIN)}).toEqual({path, to: "/account"});
            expect({path, to: guard(target(path, "admin"), admin, ORIGIN)}).toEqual({path, to: true});
        }
        expect(guard(target("/account", "user"), admin, ORIGIN)).toBe(true);
        expect(guard(target("/account", "user"), user, ORIGIN)).toBe(true);
    });
});

describe("统一处理之后的去处", () => {
    it("会话没了：要登录的页带着当前地址去登录，访客页与公开页留在原地", () => {
        expect(afterUnauthenticated(target("/admin/users", "admin"))).toBe("/login?next=%2Fadmin%2Fusers");
        expect(afterUnauthenticated(target("/consent", "consent"))).toBe("/login?next=%2Fconsent");
        expect(afterUnauthenticated(target("/login", "guest"))).toBeUndefined();
        expect(afterUnauthenticated(target("/terms", "public"))).toBeUndefined();
    });

    it("撞上同意门槛：带着当前地址去同意页，已在同意页时留在原地", () => {
        expect(afterConsentRequired(target("/account", "user"))).toBe("/consent?next=%2Faccount");
        expect(afterConsentRequired(target("/consent", "consent"))).toBeUndefined();
    });
});
