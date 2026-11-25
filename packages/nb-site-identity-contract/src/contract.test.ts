/**
 * 合同包对着 docs/specs/site/accounts.md 与 admin.md 的核对。码表、筛选项、动作名与字段的上下限是照 Spec 的表手写的，
 * 不从包里算：Spec 改了，先改这里的期望值，再改合同。
 */

import {describe, expect, it} from "bun:test";
import type {Static, TSchema} from "typebox";
import {Value} from "typebox/value";

import {
    AdminInviteCodeItem,
    AdminInviteCodeListResponse,
    AdminUserDetail,
    AdminUserItem,
    AUDIT_ACTIONS,
    AUDIT_TARGET_TYPES,
    AuditItem,
    AuditListQuery,
    AuditListResponse,
    Bio,
    ChangePasswordRequest,
    codePointLength,
    ConsentRequest,
    CreateRegistrationCodeRequest,
    DisplayName,
    Email,
    EmptyResponse,
    ErrorBody,
    ExistingPassword,
    IDENTITY_API_PREFIX,
    IDENTITY_FAILURE_CODES,
    IDENTITY_FAILURE_STATUS,
    IDENTITY_PATHS,
    type IdentityFailureCode,
    IdentityItem,
    identityPath,
    IdParams,
    INVITE_CODE_ACTIVE_LIMIT,
    InviteCodeItem,
    InviteCodeListQuery,
    InviteCodeListResponse,
    isWebUrl,
    IsoTimestamp,
    LoginIdentifier,
    LoginRequest,
    LoginResponse,
    MeResponse,
    MetaResponse,
    NewPassword,
    PAGE,
    parseUsernameInput,
    PatchInviteCodeRequest,
    PatchMeRequest,
    PatchRegistrationCodeRequest,
    PublicProfile,
    REGISTRATION_CODE_FILTERS,
    RegistrationCodeItem,
    RegistrationCodeListQuery,
    RegistrationCodeListResponse,
    RegistrationCodeNote,
    RegisterRequest,
    RegisterResponse,
    ResetPasswordResponse,
    type Role,
    RoleRequest,
    RoleSchema,
    SessionItem,
    SessionListResponse,
    SOCIAL_ERROR_CODES,
    type SocialProvider,
    SocialProviderSchema,
    TermsVersion,
    USER_FILTERS,
    UserListQuery,
    UserListResponse,
    Username,
    UsernameInput,
    WebUrl,
    WhoamiResponse,
} from "./index";

/** `site.accounts` 失败表里有 HTTP 状态的行，逐行照抄。 */
const ACCOUNTS_FAILURES: Readonly<Record<string, number>> = {
    validation_failed: 400,
    unauthenticated: 401,
    invalid_credentials: 401,
    account_banned: 403,
    forbidden_origin: 403,
    consent_required: 403,
    registration_closed: 403,
    provider_disabled: 403,
    registration_code_invalid: 422,
    invite_code_invalid: 422,
    username_taken: 409,
    email_taken: 409,
    identity_taken: 409,
    identity_exists: 409,
    last_login_method: 409,
    invite_code_limit: 409,
    rate_limited: 429,
    overloaded: 503,
    unavailable: 503,
    not_found: 404,
    internal: 500,
};

/** `site.admin` 失败表，逐行照抄（“其余码同 site.accounts”）。 */
const ADMIN_FAILURES: Readonly<Record<string, number>> = {
    forbidden: 403,
    not_found: 404,
    self_forbidden: 409,
    validation_failed: 400,
};

/** `site.accounts` 失败表里只作跳转参数的三个码。 */
const REDIRECT_ONLY_CODES = ["social_not_registered", "social_email_missing", "social_state_invalid"];

const check = (schema: TSchema, value: unknown): boolean => Value.Check(schema, value);

/** 恰好 `count` 个码点；夹着组合重音（字素比码点少）与四字节字符（UTF-16 单元比码点多），三种数法都不相同。 */
function codePoints(count: number): string {
    const cycle = ["a", "́", "\u{1F600}", "中"];
    return Array.from({length: count}, (_, index) => cycle[index % cycle.length]).join("");
}

const NOW = "2026-11-25T08:30:00.000Z";

const profile = {
    id: 7,
    username: "alice",
    displayName: "Alice",
    avatarUrl: null,
    website: "https://alice.example",
    bio: null,
    role: "user",
    createdAt: NOW,
};

const adminUser = {
    id: 7,
    username: "alice",
    displayName: "Alice",
    email: null,
    emailPending: true,
    role: "admin",
    banned: false,
    createdAt: NOW,
    lastLoginAt: null,
};

const inviteCode = {id: 3, code: "7K2Q9XWZ4M8RTB1C", createdAt: NOW, usedCount: 2, maxUses: null, expiresAt: null, usable: true};

const registrationCode = {
    id: 4,
    code: "Q3F8ZP2M6W9KX7TA",
    maxUses: 5,
    usedCount: 1,
    expiresAt: null,
    note: "第一批",
    disabled: false,
    usable: true,
    createdAt: NOW,
    createdBy: {id: 1, username: "root"},
};

const registerRequest = {
    username: "Alice_01",
    email: "alice@example.com",
    password: "correct horse",
    registrationCode: " Q3F8ZP2M6W9KX7TA ",
    termsVersion: "2026-11-20",
    overseasStorage: true,
};

describe("失败码（site.accounts 与 site.admin 的失败表）", () => {
    it("码表正好是两张失败表里有 HTTP 状态的码，状态逐个对得上", () => {
        const expected = {...ACCOUNTS_FAILURES, ...ADMIN_FAILURES};
        // 两张表里都有的码，状态必须相同，否则合起来会悄悄盖掉一个。
        for (const [code, status] of Object.entries(ADMIN_FAILURES)) if (code in ACCOUNTS_FAILURES) expect(ACCOUNTS_FAILURES[code]).toBe(status);
        const actual: Record<string, number> = Object.fromEntries(IDENTITY_FAILURE_CODES.map((code) => [code, IDENTITY_FAILURE_STATUS[code]]));
        expect(actual).toEqual(expected);
        expect(new Set(IDENTITY_FAILURE_CODES).size).toBe(IDENTITY_FAILURE_CODES.length);
    });

    it("状态表覆盖每个码，没有多出来的码", () => {
        expect(Object.keys(IDENTITY_FAILURE_STATUS).sort()).toEqual([...IDENTITY_FAILURE_CODES].sort());
    });

    it("只作跳转参数的码不在 HTTP 码表里；删掉的 last_admin 不在", () => {
        for (const code of [...REDIRECT_ONLY_CODES, "last_admin"]) expect(IDENTITY_FAILURE_CODES as readonly string[]).not.toContain(code);
    });

    it("社交流程的落点码是七个：三个跳转参数码加 email_taken、identity_taken、identity_exists、account_banned（输出 23）", () => {
        const social: string[] = [...SOCIAL_ERROR_CODES].sort();
        expect(social).toEqual([...REDIRECT_ONLY_CODES, "email_taken", "identity_taken", "identity_exists", "account_banned"].sort());
        for (const code of SOCIAL_ERROR_CODES) if (!REDIRECT_ONLY_CODES.includes(code)) expect(IDENTITY_FAILURE_CODES as readonly string[]).toContain(code);
    });
});

describe("错误体（输出 22）", () => {
    it("validation_failed 带 fields（可以为空数组），别的码只有 code", () => {
        expect(check(ErrorBody, {error: {code: "validation_failed", fields: ["username", "email"]}})).toBe(true);
        expect(check(ErrorBody, {error: {code: "validation_failed", fields: []}})).toBe(true);
        expect(check(ErrorBody, {error: {code: "validation_failed"}})).toBe(false);
        for (const code of IDENTITY_FAILURE_CODES) {
            if (code === "validation_failed") continue;
            expect(check(ErrorBody, {error: {code}})).toBe(true);
            expect(check(ErrorBody, {error: {code, fields: []}})).toBe(false);
        }
    });

    it("不带给人看的文字、堆栈，不认识的码与跳转参数码不合", () => {
        expect(check(ErrorBody, {error: {code: "internal", message: "boom"}})).toBe(false);
        expect(check(ErrorBody, {error: {code: "internal"}, stack: "at x (/srv/app.ts:1)"})).toBe(false);
        expect(check(ErrorBody, {error: {code: "teapot"}})).toBe(false);
        expect(check(ErrorBody, {error: {code: "social_state_invalid"}})).toBe(false);
        expect(check(ErrorBody, {code: "not_found"})).toBe(false);
    });
});

describe("请求拒收多余的键", () => {
    const requests: ReadonlyArray<readonly [string, TSchema, Record<string, unknown>]> = [
        ["RegisterRequest", RegisterRequest, registerRequest],
        ["LoginRequest", LoginRequest, {identifier: "alice", password: "pw"}],
        ["PatchMeRequest", PatchMeRequest, {bio: null}],
        ["ChangePasswordRequest", ChangePasswordRequest, {currentPassword: "old", newPassword: "new password"}],
        ["ConsentRequest", ConsentRequest, {termsVersion: "2026-11-20", overseasStorage: true}],
        ["PatchInviteCodeRequest", PatchInviteCodeRequest, {disabled: true}],
        ["RoleRequest", RoleRequest, {role: "admin"}],
        ["CreateRegistrationCodeRequest", CreateRegistrationCodeRequest, {maxUses: null}],
        ["PatchRegistrationCodeRequest", PatchRegistrationCodeRequest, {note: "改个备注"}],
        ["UserListQuery", UserListQuery, {q: "al", filter: "banned"}],
        ["RegistrationCodeListQuery", RegistrationCodeListQuery, {filter: "usable", page: "2"}],
        ["InviteCodeListQuery", InviteCodeListQuery, {pageSize: "50"}],
        ["AuditListQuery", AuditListQuery, {actorId: "cli", action: "admin.cli_upsert"}],
        ["IdParams", IdParams, {id: "12"}],
    ];
    for (const [name, schema, sample] of requests) {
        it(`${name}：样例合格，多一个键就不合格`, () => {
            expect(check(schema, sample)).toBe(true);
            expect(check(schema, {...sample, extra: 1})).toBe(false);
        });
    }

    it("用户名不能经 PATCH me 改：它在那里是多余的键", () => {
        expect(check(PatchMeRequest, {displayName: "A", username: "bob"})).toBe(false);
    });
});

describe("时间的写法", () => {
    it("收 toISOString() 的输出", () => {
        for (const time of [0, Date.UTC(2026, 10, 25, 8, 30, 0, 7), Date.UTC(1999, 11, 31, 23, 59, 59, 999)]) expect(check(IsoTimestamp, new Date(time).toISOString())).toBe(true);
    });

    it("拒收不带毫秒、带时区偏移或别的写法", () => {
        for (const text of ["2026-11-25T08:30:00Z", "2026-11-25T08:30:00.000+00:00", "2026-11-25T16:30:00.000+08:00", "2026-11-25 08:30:00.000Z", "2026-11-25T08:30:00.000z", "2026-11-25"]) {
            expect(check(IsoTimestamp, text)).toBe(false);
        }
    });

    it("条款版本是日期", () => {
        expect(check(TermsVersion, "2026-11-20")).toBe(true);
        for (const text of ["2026-11-20T00:00:00.000Z", "20261120", "v1"]) expect(check(TermsVersion, text)).toBe(false);
    });
});

describe("字段规则（字段规则表）", () => {
    it("长度按码点数，与 Spec 的上下限一致", () => {
        const rules: ReadonlyArray<readonly [string, TSchema, number, number]> = [
            ["显示名", DisplayName, 1, 50],
            ["新密码", NewPassword, 8, 128],
            ["旧密码", ExistingPassword, 0, 128],
            ["签名", Bio, 0, 200],
            ["注册码备注", RegistrationCodeNote, 0, 200],
            ["登录名", LoginIdentifier, 1, 254],
        ];
        for (const [name, schema, min, max] of rules) {
            for (const [length, ok] of [[min - 1, false], [min, true], [max, true], [max + 1, false]] as const) {
                if (length < 0) continue;
                expect({name, length, ok: check(schema, codePoints(length))}).toEqual({name, length, ok});
            }
        }
    });

    it("组合字符按码点数：8 个码点、7 个字素的密码合格（TypeBox 的 minLength 会判它不合格）", () => {
        expect(codePointLength("abcdefé")).toBe(8);
        expect(check(NewPassword, "abcdefé")).toBe(true);
        expect(check(NewPassword, "abcdef́")).toBe(false);
        expect(codePointLength("\u{1F600}中")).toBe(2);
    });

    it("登录与旧密码只查上限：短于 8 个码点的照收", () => {
        expect(check(LoginRequest, {identifier: "alice", password: ""})).toBe(true);
        expect(check(LoginRequest, {identifier: "alice", password: "short"})).toBe(true);
        expect(check(LoginRequest, {identifier: "alice", password: codePoints(129)})).toBe(false);
        expect(check(ChangePasswordRequest, {currentPassword: "old", newPassword: "long enough"})).toBe(true);
        expect(check(ChangePasswordRequest, {currentPassword: "old", newPassword: "7 chars"})).toBe(false);
        expect(check(RegisterRequest, {...registerRequest, password: "7 chars"})).toBe(false);
    });

    it("用户名：输入只收 ASCII 的字母、数字、下划线、点，3 到 30 个，过了再转小写", () => {
        expect(parseUsernameInput("Alice_01.x")).toBe("alice_01.x");
        expect(parseUsernameInput("abc")).toBe("abc");
        expect(parseUsernameInput("a".repeat(30))).toBe("a".repeat(30));
        for (const input of ["ab", "a".repeat(31), "al ice", "alice-1", "用户名", "Kelvin", "aliıce"]) expect(parseUsernameInput(input)).toBeUndefined();
        for (const [input, ok] of [["Alice_01", true], ["ab", false], ["a".repeat(31), false], ["Kelvin", false]] as const) expect(check(UsernameInput, input)).toBe(ok);
        expect(check(RegisterRequest, {...registerRequest, username: "Kelvin"})).toBe(false);
    });

    it("对外的用户名是小写的登录名", () => {
        expect(check(Username, "alice_01.x")).toBe(true);
        expect(check(Username, "Alice")).toBe(false);
        expect(check(PublicProfile, {...profile, username: "Alice"})).toBe(false);
    });

    it("邮箱：合法的地址、至多 254 个字符、不收 .invalid 结尾的", () => {
        const local = "a".repeat(64);
        const at254 = `${local}@${["b".repeat(63), "c".repeat(63), "d".repeat(61)].join(".")}`;
        expect(at254.length).toBe(254);
        for (const email of ["alice@example.com", "A.B+c@sub.example.org", "x@localhost", at254]) expect(check(Email, email)).toBe(true);
        for (const email of [`${at254}e`, "u1@placeholder.invalid", "x@y.INVALID", "no-at", "a@-x.com", "a b@x.com", "名字@example.com", "a@example.com\n"]) expect(check(Email, email)).toBe(false);
        expect(check(RegisterRequest, {...registerRequest, email: "u1@placeholder.invalid"})).toBe(false);
    });

    it("头像与网站：http 或 https、至多 500 个码点、能解析", () => {
        const long = `https://e.example/${"x".repeat(500 - "https://e.example/".length)}`;
        for (const url of ["https://e.example/a.png", "http://e.example", "HTTPS://E.EXAMPLE", long]) {
            expect(check(WebUrl, url)).toBe(true);
            expect(isWebUrl(url)).toBe(true);
        }
        for (const url of [`${long}x`, "ftp://e.example", "javascript:alert(1)", " https://e.example", "https://", "e.example"]) expect(isWebUrl(url)).toBe(false);
        expect(check(WebUrl, `${long}x`)).toBe(false);
    });

    it("头像与网站：不收空白、C0 与 C1 控制字符、DEL 与双向控制符，schema 与 isWebUrl 同一条规则；别的非 ASCII 字符照收", () => {
        const rejectedChars: readonly (readonly [name: string, char: string])[] = [
            ["空格", " "],
            ["制表", "\t"],
            ["换行", "\n"],
            ["回车", "\r"],
            ["不换行空格", "\u00A0"],
            ["行分隔符", "\u2028"],
            ["NUL", "\u0000"],
            ["C0 的最后一个", "\u001F"],
            ["DEL", "\u007F"],
            ["C1 的第一个", "\u0080"],
            ["C1 的 NEL", "\u0085"],
            ["C1 的最后一个", "\u009F"],
            ["阿拉伯字母标记", "\u061C"],
            ["从左至右标记", "\u200E"],
            ["从右至左标记", "\u200F"],
            ["从左至右嵌入", "\u202A"],
            ["从右至左覆盖", "\u202E"],
            ["从左至右隔离", "\u2066"],
            ["隔离结束", "\u2069"],
        ];
        for (const [name, char] of rejectedChars) {
            for (const url of [`https://e.example/${char}a.png`, `https://${char}e.example/`, `https://e.example/a.png${char}`]) {
                expect({name, url, schema: check(WebUrl, url), full: isWebUrl(url)}).toEqual({name, url, schema: false, full: false});
            }
        }
        // 紧挨着被拒范围的字符、别的文字与四字节字符不在其中。
        for (const url of ["https://e.example/~", "https://e.example/\u00A1", "https://e.example/\u200D", "https://e.example/\u2070", "https://例子.example/写作", "https://e.example/🌸"]) {
            expect({url, schema: check(WebUrl, url), full: isWebUrl(url)}).toEqual({url, schema: true, full: true});
        }
    });

    it("邀请码同时有效的上限是 10 个（输出 18）", () => {
        expect(INVITE_CODE_ACTIVE_LIMIT).toBe(10);
    });

    it("改资料与改注册码至少一项；停用只收 true", () => {
        expect(check(PatchMeRequest, {})).toBe(false);
        expect(check(PatchRegistrationCodeRequest, {})).toBe(false);
        expect(check(PatchRegistrationCodeRequest, {disabled: false})).toBe(false);
        expect(check(PatchInviteCodeRequest, {disabled: false})).toBe(false);
        expect(check(PatchRegistrationCodeRequest, {note: null, disabled: true})).toBe(true);
    });

    it("同意是布尔：给 false 合 schema，由服务端回 consent_required", () => {
        expect(check(ConsentRequest, {termsVersion: "2026-11-20", overseasStorage: false})).toBe(true);
        expect(check(RegisterRequest, {...registerRequest, overseasStorage: false})).toBe(true);
        expect(check(ConsentRequest, {termsVersion: "2026-11-20", overseasStorage: "yes"})).toBe(false);
    });
});

describe("管理列表（site.admin）", () => {
    it("筛选项与 Spec 的取值一致，查询只收这些取值", () => {
        expect([...USER_FILTERS]).toEqual(["all", "admin", "banned", "email_pending"]);
        expect([...REGISTRATION_CODE_FILTERS]).toEqual(["all", "usable", "exhausted_or_expired", "disabled"]);
        for (const filter of USER_FILTERS) expect(check(UserListQuery, {filter})).toBe(true);
        for (const filter of REGISTRATION_CODE_FILTERS) expect(check(RegistrationCodeListQuery, {filter})).toBe(true);
        expect(check(UserListQuery, {filter: "usable"})).toBe(false);
        expect(check(RegistrationCodeListQuery, {filter: "banned"})).toBe(false);
        expect(check(InviteCodeListQuery, {filter: "all"})).toBe(false);
    });

    it("审计动作名是输出 8 列的八个，加 t08 的三个 OAuth 客户端动作", () => {
        expect([...AUDIT_ACTIONS]).toEqual([
            "user.ban",
            "user.unban",
            "user.role",
            "user.revoke_sessions",
            "user.reset_password",
            "registration_code.create",
            "registration_code.disable",
            "admin.cli_upsert",
            "oauth_client.create",
            "oauth_client.update",
            "oauth_client.rotate_secret",
        ]);
        expect([...AUDIT_TARGET_TYPES]).toEqual(["user", "registration_code", "oauth_client"]);
    });

    it("审计的筛选：操作者是数字或 cli，对象是种类加 id，动作是枚举之一", () => {
        expect(check(AuditListQuery, {actorId: "12", targetType: "user", targetId: "7", action: "user.ban"})).toBe(true);
        expect(check(AuditListQuery, {actorId: "cli"})).toBe(true);
        for (const query of [{actorId: "0"}, {actorId: "CLI"}, {targetType: "session"}, {targetId: "x"}, {action: "user.delete"}]) expect(check(AuditListQuery, query)).toBe(false);
    });

    it("分页参数：page 从 1 起，pageSize 1 到 100，都是十进制写法", () => {
        for (const page of ["1", "2", "999999999999999"]) expect(check(InviteCodeListQuery, {page})).toBe(true);
        for (const page of ["0", "01", "-1", "1.5", "1e3", "", "1000000000000000"]) expect(check(InviteCodeListQuery, {page})).toBe(false);
        for (const pageSize of [String(PAGE.minPageSize), "20", String(PAGE.maxPageSize)]) expect(check(InviteCodeListQuery, {pageSize})).toBe(true);
        for (const pageSize of [String(PAGE.minPageSize - 1), String(PAGE.maxPageSize + 1), "020"]) expect(check(InviteCodeListQuery, {pageSize})).toBe(false);
        expect(PAGE).toEqual({minPage: 1, defaultPage: 1, minPageSize: 1, maxPageSize: 100, defaultPageSize: 20});
    });

    it("anchor：前缀加十进制数，数字部分可以是 0", () => {
        for (const anchor of ["u0", "u45", "rc12", "a999999999999999"]) expect(check(UserListQuery, {anchor})).toBe(true);
        for (const anchor of ["", "u", "u01", "U5", "abc1", "u-1", "5", "a1000000000000000"]) expect(check(UserListQuery, {anchor})).toBe(false);
    });

    it("带筛选项的列表另带 counts，键正好是筛选项的取值", () => {
        const page = {items: [adminUser], total: 1, page: 1, pageSize: 20, anchor: "u7"};
        const counts = {all: 1, admin: 1, banned: 0, email_pending: 1};
        expect(check(UserListResponse, {...page, counts})).toBe(true);
        expect(check(UserListResponse, page)).toBe(false);
        expect(check(UserListResponse, {...page, counts: {...counts, active: 1}})).toBe(false);
        const {banned: _, ...missing} = counts;
        expect(check(UserListResponse, {...page, counts: missing})).toBe(false);
        expect(check(RegistrationCodeListResponse, {...page, items: [registrationCode], anchor: "rc4", counts: {all: 1, usable: 1, exhausted_or_expired: 0, disabled: 0}})).toBe(true);
    });

    it("没有筛选项的列表不带 counts；空列表的 anchor 数字部分是 0", () => {
        expect(check(AuditListResponse, {items: [], total: 0, page: 1, pageSize: 20, anchor: "a0"})).toBe(true);
        expect(check(AuditListResponse, {items: [], total: 0, page: 1, pageSize: 20, anchor: "a0", counts: {}})).toBe(false);
    });
});

describe("响应的样例", () => {
    const valid: ReadonlyArray<readonly [string, TSchema, unknown]> = [
        ["RegisterResponse", RegisterResponse, {user: profile}],
        ["LoginResponse", LoginResponse, {user: {...profile, role: "admin"}}],
        ["WhoamiResponse 匿名", WhoamiResponse, {state: "anonymous"}],
        ["WhoamiResponse 已登录", WhoamiResponse, {state: "authenticated", user: {id: 7, username: "alice", role: "user"}}],
        ["MeResponse", MeResponse, {...profile, email: null, emailPending: true, hasPassword: false, consentRequired: true}],
        ["EmptyResponse", EmptyResponse, {}],
        ["SessionListResponse", SessionListResponse, {items: [{id: 1, createdAt: NOW, lastUsedAt: NOW, browser: "Chrome", os: null, current: true}]}],
        ["IdentityItem", IdentityItem, {id: 2, provider: "github", accountName: "alice-gh", linkedAt: NOW}],
        ["InviteCodeListResponse", InviteCodeListResponse, {items: [inviteCode, {...inviteCode, id: 4, maxUses: 3, expiresAt: NOW, usable: false}]}],
        ["MetaResponse", MetaResponse, {termsVersion: "2026-11-20", registrationOpen: true, providers: {google: false, github: false}}],
        ["AdminUserItem", AdminUserItem, adminUser],
        ["AdminUserDetail", AdminUserDetail, {...adminUser, avatarUrl: null, website: null, bio: "", hasPassword: true, providers: ["google"], sessionCount: 2, registrationCode: {id: 4, code: "Q3F8ZP2M6W9KX7TA"}, inviter: null}],
        ["ResetPasswordResponse", ResetPasswordResponse, {password: "Kx7pQ2mZr9TbW4nYs8Hd"}],
        ["RegistrationCodeItem", RegistrationCodeItem, {...registrationCode, maxUses: null, createdBy: null}],
        ["AdminInviteCodeListResponse", AdminInviteCodeListResponse, {items: [{...inviteCode, owner: {id: 7, username: "alice"}}, {...inviteCode, id: 5, owner: null}], total: 2, page: 1, pageSize: 20, anchor: "ic5"}],
        ["AuditItem 改角色", AuditItem, {id: 9, createdAt: NOW, actor: {id: 1, username: "root"}, action: "user.role", target: {type: "user", id: 7}, params: {from: "user", to: "admin"}}],
        ["AuditItem 命令行", AuditItem, {id: 10, createdAt: NOW, actor: null, action: "admin.cli_upsert", target: {type: "user", id: 1}, params: {}}],
    ];
    for (const [name, schema, sample] of valid) {
        it(`${name} 的合格样例`, () => {
            expect(check(schema, sample)).toBe(true);
        });
    }

    const invalid: ReadonlyArray<readonly [string, TSchema, unknown]> = [
        ["公开资料多带了邮箱", PublicProfile, {...profile, email: "alice@example.com"}],
        ["公开资料缺键（可空的也要给 null）", PublicProfile, {...profile, avatarUrl: undefined}],
        ["角色不是 user 或 admin", PublicProfile, {...profile, role: "owner"}],
        ["问身份的已登录多带了显示名", WhoamiResponse, {state: "authenticated", user: {id: 7, username: "alice", role: "user", displayName: "A"}}],
        ["问身份的未知状态", WhoamiResponse, {state: "expired"}],
        ["自己的资料缺是否还缺同意", MeResponse, {...profile, email: null, emailPending: true, hasPassword: false}],
        ["会话给了原始的浏览器标识", SessionItem, {id: 1, createdAt: NOW, lastUsedAt: NOW, browser: "Chrome", os: "Linux", current: false, userAgent: "Mozilla/5.0"}],
        ["上游不是 google 或 github", IdentityItem, {id: 2, provider: "gitlab", accountName: "x", linkedAt: NOW}],
        ["邀请码的可用次数是 0", InviteCodeItem, {...inviteCode, maxUses: 0}],
        ["管理列表的账号多带了密码哈希", AdminUserItem, {...adminUser, passwordHash: "$argon2id$..."}],
        ["详情的会话数是负的", AdminUserDetail, {...adminUser, avatarUrl: null, website: null, bio: null, hasPassword: true, providers: [], sessionCount: -1, registrationCode: null, inviter: null}],
        ["注册码的时间不带毫秒", RegistrationCodeItem, {...registrationCode, createdAt: "2026-11-25T08:30:00Z"}],
        ["审计的动作不在枚举里", AuditItem, {id: 9, createdAt: NOW, actor: null, action: "user.delete", target: {type: "user", id: 7}, params: {}}],
        ["审计的参数是嵌套对象", AuditItem, {id: 9, createdAt: NOW, actor: null, action: "user.ban", target: {type: "user", id: 7}, params: {x: {y: 1}}}],
        ["页大小超过 100", AdminInviteCodeListResponse, {items: [], total: 0, page: 1, pageSize: 101, anchor: "ic0"}],
    ];
    for (const [name, schema, sample] of invalid) {
        it(`不合格：${name}`, () => {
            expect(check(schema, sample)).toBe(false);
        });
    }

    it("发放注册码：可用次数是正整数或 null（不限），过期时间可省", () => {
        expect(check(CreateRegistrationCodeRequest, {maxUses: 3, expiresAt: NOW, note: "给内测"})).toBe(true);
        for (const maxUses of [0, 1.5, "3"]) expect(check(CreateRegistrationCodeRequest, {maxUses})).toBe(false);
        expect(check(CreateRegistrationCodeRequest, {})).toBe(false);
    });
});

describe("路径（两份 Spec 输入与前置条件的接口表）", () => {
    it("都在前缀之下，与接口表一致", () => {
        expect(IDENTITY_API_PREFIX).toBe("/api/identity/v1");
        expect(IDENTITY_PATHS).toEqual({
            register: "/register",
            login: "/login",
            logout: "/logout",
            whoami: "/whoami",
            meta: "/meta",
            me: "/me",
            mePassword: "/me/password",
            meConsent: "/me/consent",
            meSessions: "/me/sessions",
            meInviteCodes: "/me/invite-codes",
            adminUsers: "/admin/users",
            adminRegistrationCodes: "/admin/registration-codes",
            adminInviteCodes: "/admin/invite-codes",
            adminAudit: "/admin/audit",
        });
        expect(identityPath.meSession(3)).toBe("/me/sessions/3");
        expect(identityPath.meInviteCode(4)).toBe("/me/invite-codes/4");
        expect(identityPath.adminUser(7)).toBe("/admin/users/7");
        expect((["ban", "unban", "role", "revoke-sessions", "reset-password"] as const).map((action) => identityPath.adminUserAction(7, action))).toEqual([
            "/admin/users/7/ban",
            "/admin/users/7/unban",
            "/admin/users/7/role",
            "/admin/users/7/revoke-sessions",
            "/admin/users/7/reset-password",
        ]);
        expect(identityPath.adminRegistrationCode(4)).toBe("/admin/registration-codes/4");
    });

    it("路径里的 id 是十进制正整数", () => {
        for (const id of ["0", "01", "-1", "abc", "1.0"]) expect(check(IdParams, {id})).toBe(false);
    });
});

/** 两个类型完全相同时为 true（不把 `never`、`any` 当成相同）。 */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/**
 * 用 `literalUnion` 写的枚举，`Static` 推出的正是那组字面量（编译期；`bun run typecheck` 检查，不在运行时执行）。交给 `literalUnion`
 * 的不是元组时这里推出 `never`，下面的 `true` 赋不上去，类型检查失败（w00037 t07 第 3 片实现时发现的 `ErrorBody` 一支是 `never`）。
 */
export function staticTypeChecks(): void {
    type FailureBody = Static<typeof ErrorBody>;
    const checks: true[] = [
        true satisfies Equal<FailureBody["error"]["code"], IdentityFailureCode>,
        true satisfies Equal<Extract<FailureBody["error"], {code: "validation_failed"}>, {code: "validation_failed"; fields: string[]}>,
        true satisfies Equal<Exclude<FailureBody["error"], {code: "validation_failed"}>, {code: Exclude<IdentityFailureCode, "validation_failed">}>,
        true satisfies Equal<Static<typeof RoleSchema>, Role>,
        true satisfies Equal<Static<typeof SocialProviderSchema>, SocialProvider>,
        true satisfies Equal<NonNullable<UserListQuery["filter"]>, (typeof USER_FILTERS)[number]>,
        true satisfies Equal<NonNullable<RegistrationCodeListQuery["filter"]>, (typeof REGISTRATION_CODE_FILTERS)[number]>,
        true satisfies Equal<NonNullable<AuditListQuery["targetType"]>, (typeof AUDIT_TARGET_TYPES)[number]>,
        true satisfies Equal<NonNullable<AuditListQuery["action"]>, (typeof AUDIT_ACTIONS)[number]>,
        true satisfies Equal<AuditItem["action"], (typeof AUDIT_ACTIONS)[number]>,
        true satisfies Equal<AuditItem["target"]["type"], (typeof AUDIT_TARGET_TYPES)[number]>,
    ];
    void checks;
}
