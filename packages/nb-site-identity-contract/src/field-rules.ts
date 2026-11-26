/**
 * 字段规则的常量与按规则判断的几个函数（docs/specs/site/accounts.md 输入与前置条件的“字段规则”表；注册码备注与分页见
 * docs/specs/site/admin.md）。前端拿它们做输入上限与提交前的检查，`./fields` 用同一组常量生成 schema：前端与服务端用的是同一条规则。
 *
 * 这个文件不导入 TypeBox：它经 `./constants` 进浏览器的入口块，导入了 schema 的模块会把 TypeBox 的运行时一起带进去
 * （`constants.test.ts` 检查）。长度为什么写进 `pattern` 而不用 `minLength`、`maxLength`，见 `./fields` 的文件头。
 */

/** `[\s\S]{min,max}`：在 `u` 标志下按码点数长度，含换行与单独的代理项。 */
function codePoints(min: number, max: number): string {
    return `[\\s\\S]{${min},${max}}`;
}

/** 整个字符串长 `min` 到 `max` 个码点的 `pattern`。 */
export function codePointPattern(min: number, max: number): string {
    return `^${codePoints(min, max)}$`;
}

/** 按码点数的长度，与字段规则同一种数法（前端的字数提示用它，不用 `String.length`）。 */
export function codePointLength(value: string): number {
    let count = 0;
    for (const _ of value) count += 1;
    return count;
}

/**
 * 用户名。输入只收 ASCII 的字母、数字、下划线、点，先按 `inputPattern` 判原始输入，过了再转小写；
 * 对外（响应里的 `username`）是小写的登录名，合 `pattern`。先转小写再判会放进开尔文符号 U+212A 这类
 * 小写后落进 ASCII 的字符，所以两步的先后不能换，服务端与前端都经 `parseUsernameInput`。
 */
export const USERNAME = {
    minLength: 3,
    maxLength: 30,
    inputPattern: "^[A-Za-z0-9_.]{3,30}$",
    pattern: "^[a-z0-9_.]{3,30}$",
} as const;

const USERNAME_INPUT = new RegExp(USERNAME.inputPattern, "u");

/** 合规则时回小写的登录名，否则回 `undefined`（调用方报 `validation_failed`，字段是 `username`）。 */
export function parseUsernameInput(input: string): string | undefined {
    return USERNAME_INPUT.test(input) ? input.toLowerCase() : undefined;
}

/** 显示名：1 到 50 个码点，不去首尾空白。 */
export const DISPLAY_NAME = {minLength: 1, maxLength: 50, pattern: codePointPattern(1, 50)} as const;

/**
 * 邮箱：WHATWG 的“合法邮箱地址”（与浏览器 `type=email` 同一条），至多 254 个字符，不收以 `.invalid` 结尾的
 * （不分大小写，这个后缀留给占位邮箱）。地址只含 ASCII，码点数等于字符数。按小写比较是服务端的事，这里不转。
 */
export const EMAIL = {
    maxLength: 254,
    reservedSuffix: ".invalid",
    pattern:
        "^(?=.{1,254}$)(?!.*\\.[Ii][Nn][Vv][Aa][Ll][Ii][Dd]$)[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$",
} as const;

/**
 * 密码：新设的（注册、改密码的新密码）8 到 128 个码点。登录与改密码时给的旧密码只查上限
 * （`site.accounts` 字段规则：旧站导入的密码可能更短）。
 */
export const PASSWORD = {
    minLength: 8,
    maxLength: 128,
    pattern: codePointPattern(8, 128),
    existingPattern: codePointPattern(0, 128),
} as const;

/**
 * 登录请求的“用户名或邮箱”：1 到 254 个码点（邮箱的上限，最长的合法登录名）。含 `@` 的按邮箱找、否则按用户名找
 * 是服务端的事（`site.accounts` 输出 4），这里不判是哪一种，也不套用户名或邮箱的字符规则。
 */
export const LOGIN_IDENTIFIER = {minLength: 1, maxLength: 254, pattern: codePointPattern(1, 254)} as const;

/**
 * 头像与网站里不收的字符（`site.accounts` 字段规则）：空白（含制表、换行与 Unicode 的各种空格）、C0 与 C1 控制字符、DEL，
 * 以及双向控制符（U+061C、U+200E、U+200F、U+202A 到 U+202E、U+2066 到 U+2069）。地址照原样存、原样给出，而 `URL.parse`
 * 会删掉其中一些、编码另一些：留着它们，页面上显示的文字与点开去的地方就可能不一样（例如 `https://\tgoogle.com@evil.example`
 * 解析出的主机是 `evil.example`，右至左覆盖符能把 `exe.gpj` 显示成 `jpg.exe`），换行与 NUL 还会进库与 JSON（实现审查第 6 到 8 片
 * 第 5 条）。正则字符类的写法，在 `u` 标志下按码点判。
 */
const WEB_URL_FORBIDDEN = "\\s\\u0000-\\u001F\\u007F-\\u009F\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069";

/**
 * 头像与网站：以 `http://` 或 `https://` 开头（协议名不分大小写）的地址，至多 500 个码点，不含 `WEB_URL_FORBIDDEN` 里的字符。
 * `pattern` 管长度、这些字符与开头；地址能不能解析、有没有主机用 `isWebUrl` 判，schema 表达不了。
 * 开头要写出 `//`：`https:example.org`、`https:/example.org` 无基准时解析成 `https://example.org/`，页面上的链接与图片却按站点地址
 * 解析成站内路径 `https://<站点>/example.org`，校验时的地址与页面实际去的不是一个（omp 实现审查第 6 到 8 片第 4 条）。
 * `http:\\evil.example` 的反斜杠在 WHATWG 的解析里当斜杠用，但不是字面的 `//`，同样不收。
 */
export const WEB_URL = {
    maxLength: 500,
    protocols: ["http:", "https:"],
    pattern: `^(?=[^${WEB_URL_FORBIDDEN}]{1,500}$)[Hh][Tt][Tt][Pp][Ss]?://`,
} as const;

const WEB_URL_PREFIX = new RegExp(WEB_URL.pattern, "u");

/**
 * 头像、网站的完整规则：合 `WEB_URL.pattern`，且平台的 `URL.parse` 解析得出 `http:` 或 `https:` 与非空的主机。
 * 服务端在 schema 通过之后对这两个字段调它，不合格同样回 `validation_failed`；前端提交前用它判。
 */
export function isWebUrl(value: string): boolean {
    if (!WEB_URL_PREFIX.test(value)) return false;
    const url = URL.parse(value);
    return url !== null && (WEB_URL.protocols as readonly string[]).includes(url.protocol) && url.host !== "";
}

/** 签名：至多 200 个码点，可以为空串。 */
export const BIO = {maxLength: 200, pattern: codePointPattern(0, 200)} as const;

/** 注册码的备注：至多 200 个码点（`site.admin` 输入与前置条件）。 */
export const REGISTRATION_CODE_NOTE = {maxLength: 200, pattern: codePointPattern(0, 200)} as const;

/** 同时有效的邀请码至多这么多个，再生成回 `invite_code_limit`（`site.accounts` 输出 18）。 */
export const INVITE_CODE_ACTIVE_LIMIT = 10;

/** 分页参数的取值（`site.admin` 的分页参数表）。 */
export const PAGE = {minPage: 1, defaultPage: 1, minPageSize: 1, maxPageSize: 100, defaultPageSize: 20} as const;

/**
 * 十进制正整数，至多 15 位：小于 `Number.MAX_SAFE_INTEGER`，`Number()` 读出来是准确的。
 * 路径里的 id、查询串里的 `page`、`actorId`、`targetId` 都用它。
 */
export const DECIMAL_ID_PATTERN = "^[1-9][0-9]{0,14}$";
