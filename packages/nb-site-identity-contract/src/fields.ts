/**
 * 字段规则（docs/specs/site/accounts.md 输入与前置条件的“字段规则”表；注册码备注与分页见 docs/specs/site/admin.md）。
 * 常量与按规则判断的函数在 `./field-rules`（不导入 TypeBox，前端经 `./constants` 取），这里由同一组常量生成 schema：
 * 前端与服务端用的是同一条规则。
 *
 * 长度按 Unicode 码点计，而 TypeBox 的 `minLength`、`maxLength` 数的是字素（1.3.6 的 `guard/string.mjs`
 * `GraphemeCount`）：`"abcdefé"` 是 8 个码点、7 个字素，`minLength: 8` 判它不合格。所以本包的 schema
 * 不用这两个关键字，长度写进 `pattern`：TypeBox 以 `u` 标志编译 `pattern`（`schema/engine/pattern.mjs`），
 * 这时 `[\s\S]` 每次匹配一个码点。升级 TypeBox 时由 `contract.test.ts` 里含组合字符与四字节字符的用例兜底。
 */

import {Type} from "typebox";

import {BIO, DISPLAY_NAME, EMAIL, LOGIN_IDENTIFIER, PASSWORD, REGISTRATION_CODE_NOTE, USERNAME, WEB_URL} from "./field-rules";

export * from "./field-rules";

export const Username = Type.String({pattern: USERNAME.pattern});
export const UsernameInput = Type.String({pattern: USERNAME.inputPattern});
export const DisplayName = Type.String({pattern: DISPLAY_NAME.pattern});
export const Email = Type.String({pattern: EMAIL.pattern});
export const NewPassword = Type.String({pattern: PASSWORD.pattern});
export const ExistingPassword = Type.String({pattern: PASSWORD.existingPattern});
export const LoginIdentifier = Type.String({pattern: LOGIN_IDENTIFIER.pattern});
export const WebUrl = Type.String({pattern: WEB_URL.pattern});
export const Bio = Type.String({pattern: BIO.pattern});
export const RegistrationCodeNote = Type.String({pattern: REGISTRATION_CODE_NOTE.pattern});

/** 账号、会话、码、审计记录的数字 id（`site.accounts` 副作用与数据：一经分配不变、不重用）。 */
export const Id = Type.Integer({minimum: 1});

/**
 * 续接令牌（`site.oauth-provider` 输出 4、12，`site.accounts` 输出 4、11）：登录、注册、补交同意与社交发起的请求可带的 `continue`。
 * 对调用方不透明，原样带回。schema 只要求是字符串，不限长度、不限写法：令牌被篡改、过期或太长都是“不合格”，
 * Spec 要的是照常登录、响应不带继续地址，不是 `validation_failed`；长度由服务端解令牌时判，整个请求体另有 16 KiB 的上限。
 */
export const ContinueToken = Type.String();

/**
 * 继续地址（登录、注册、补交同意的响应里的 `continueUrl`）：站内地址，以单个 `/` 开头。拒收 `//host`、`/\host` 与带协议的写法：
 * 浏览器把这两种开头当作别的主机（协议相对地址），页面照着去就离开了站点。
 */
export const ContinueUrl = Type.String({pattern: "^/(?![/\\\\])"});
