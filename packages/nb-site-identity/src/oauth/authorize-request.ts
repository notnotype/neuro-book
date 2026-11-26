/**
 * 授权请求交库之前的第 2、3 步要用的判断（w00037 t08 计划 3.8；`site.oauth-provider` 输出 3、13）。调用方是 `mount.ts` 的
 * `authorizeEndpoint`，先后写在那里；这里只放规则本身。
 *
 * 第 2 步挡下的几样库也会判、给的码也相同（`request`、`request_uri`、`prompt` 的值；升级清单“授权请求的参数”一行），仍自己判：
 * 合同的码不随库的请求 schema 变。另有两样库不判或判得不合合同：`response_mode` 不是 `query` 时库照样把码放进查询串；
 * `response_type` 不是 `code` 时库把错误放在回调地址的片段里。
 */

/**
 * 查询串（POST 时是表单体）的字符数上限（输出 3）。续接令牌的上限（`continue.ts` 的 `MAX_CONTINUE_TOKEN_LENGTH`）按它算：
 * 交库的参数在这之内，令牌就在那之内。
 */
export const MAX_AUTHORIZE_QUERY_CHARS = 4096;

/**
 * 交库的参数：输出 3 列出的这几个，别的一律去掉。RFC 6749 让不认识的参数被忽略，去掉与库不认识它等价；`resource`、`claims`
 * 另有去掉的理由（`mount.ts` 的 `authorizeEndpoint`）。
 *
 * 只交认得的参数也是续接令牌长度的前提：库签名时把每个参数名记成一项 `ba_param`（升级清单“续接的签名参数”一行），查询串
 * 4096 个字符全是不同的短参数名时，签名参数会到一万七千个字符上下，令牌超过 8192、登录之后续接悄悄丢掉（第 6 片实测：九百多个
 * 一两个字母的参数名，令牌 21459 个字符）。参数名固定为这几个时，签名字段至多多出几百个字符。
 */
export const AUTHORIZE_PARAMS = [
    "response_type",
    "client_id",
    "redirect_uri",
    "scope",
    "state",
    "code_challenge",
    "code_challenge_method",
    "nonce",
    "prompt",
    "max_age",
    "response_mode",
] as const;

const KNOWN_PARAMS: ReadonlySet<string> = new Set(AUTHORIZE_PARAMS);

/** 支持的 `prompt` 值（输出 13；与发现文档的 `prompt_values_supported` 相同）。 */
const PROMPT_VALUES: ReadonlySet<string> = new Set(["none", "login", "consent"]);

/** 第 2 步跳回客户端时带的码。 */
export type AuthorizeRejection = "invalid_request" | "unsupported_response_type" | "request_not_supported" | "request_uri_not_supported";

/** `prompt` 合不合输出 13：恰好一个参数，值按空格分开后每项都是支持的值、至少一项，`none` 不与别的值并存。 */
function promptAcceptable(values: readonly string[]): boolean {
    if (values.length !== 1) return false;
    const tokens = new Set(values[0]!.split(" ").filter((token) => token !== ""));
    if (tokens.size === 0) return false;
    for (const token of tokens) if (!PROMPT_VALUES.has(token)) return false;
    return !(tokens.has("none") && tokens.size > 1);
}

/**
 * 第 2 步：客户端与回调地址已核对之后，合同要拒、而不能交库判的参数；合格时为 null。`rawLength` 是请求原样的查询串（POST 时是
 * 表单体）的字符数，`params` 是读成的参数（还没去掉不认得的）。
 *
 * 长度同时按原样与 `URLSearchParams` 重新编码后的写法判：库签名的是重新编码的写法，原样没编码的 `/`、`:` 重新编码后各变成三个
 * 字符，只判原样时续接令牌仍会超长。客户端按 `application/x-www-form-urlencoded` 编码的请求两种长度相同。
 *
 * 先后：长度；`response_type`（它定了错误该放在哪里）；`response_mode`；`request`、`request_uri`；`prompt`。都不合格时回第一个。
 */
export function rejectedAuthorizeParameter(rawLength: number, params: URLSearchParams): AuthorizeRejection | null {
    if (rawLength > MAX_AUTHORIZE_QUERY_CHARS || params.toString().length > MAX_AUTHORIZE_QUERY_CHARS) return "invalid_request";
    const responseTypes = params.getAll("response_type");
    if (responseTypes.length !== 1) return "invalid_request";
    if (responseTypes[0] !== "code") return "unsupported_response_type";
    const responseModes = params.getAll("response_mode");
    if (responseModes.length > 1 || (responseModes.length === 1 && responseModes[0] !== "query")) return "invalid_request";
    if (params.has("request")) return "request_not_supported";
    if (params.has("request_uri")) return "request_uri_not_supported";
    if (params.has("prompt") && !promptAcceptable(params.getAll("prompt"))) return "invalid_request";
    return null;
}

/** 只留交库的参数（`AUTHORIZE_PARAMS`），先后与重复照原样。 */
export function libraryAuthorizeParams(params: URLSearchParams): URLSearchParams {
    const kept = new URLSearchParams();
    for (const [name, value] of params) if (KNOWN_PARAMS.has(name)) kept.append(name, value);
    return kept;
}

/**
 * 第 2 步跳回客户端的地址：登记过的回调地址加 `error`、`state`（恰好一个时原样）与 `iss`，都在查询串里（输出 3、5；RFC 9207）。
 * 回调地址自己带查询串时接在后面，原有的部分不重新编码，与库跳回时的拼法一致。
 */
export function authorizeErrorRedirect(redirectUri: string, error: AuthorizeRejection, state: string | null, issuer: string): string {
    const url = new URL(redirectUri);
    const added = new URLSearchParams({error});
    if (state !== null) added.append("state", state);
    added.append("iss", issuer);
    url.search = url.search === "" ? `?${added}` : `${url.search}&${added}`;
    return url.href;
}

/**
 * 请求的 `max_age`（秒）；没有、出现不止一次或不是非负整数时为 null。写法的认法与库的请求 schema 相同（去掉首尾空白后按 `Number`
 * 转），库认得的这里都认得：认不得的由库按它的 schema 跳回 `invalid_request`。
 */
export function requestedMaxAgeSeconds(params: URLSearchParams): number | null {
    const values = params.getAll("max_age");
    if (values.length !== 1) return null;
    const text = values[0]!.trim();
    if (text === "") return null;
    const seconds = Number(text);
    return Number.isInteger(seconds) && seconds >= 0 ? seconds : null;
}
