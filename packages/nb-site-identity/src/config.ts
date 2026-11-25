/**
 * 账号模块的配置（docs/specs/site/accounts.md 输入一节的“配置”，会话密钥见 site.operations 的配置表）。读法与入口的
 * `nb-site-server/src/config.ts`、统计模块的 `config.ts` 一致：没设与设成空串都算没给，可选项用缺省值；整数只认十进制的整数写法；
 * 问题收齐了一起报，只带变量名与问题词，不带取值（`site.operations` 输出 1，问题词见它的失败与恢复一节）。
 */

/** 账号模块自己的配置。 */
export interface IdentityConfig {
    /** `NB_SITE_SESSION_SECRET`。变量名是全站的（`site.operations` 的配置表），但只有账号模块用它，所以由本模块读。 */
    readonly sessionSecret: string;
    /** `NB_SITE_IDENTITY_TERMS_VERSION`：当前条款版本，形如 `2026-11-20`，服务条款与隐私政策共用。 */
    readonly termsVersion: string;
    /** `NB_SITE_IDENTITY_REGISTRATION_OPEN`：注册是否开放，缺省开放（注册本来就要注册码）。 */
    readonly registrationOpen: boolean;
    /**
     * `NB_SITE_IDENTITY_SESSION_DAYS`：会话时长，天。下限 2：会话“上次延长满一天才再延长”，时长 1 天时满一天的那一刻会话已经
     * 到期，永远延长不了。
     */
    readonly sessionDays: number;
    /** `NB_SITE_IDENTITY_HASH_CONCURRENCY`：同时算密码哈希的个数（`site.accounts` 输出 20）。 */
    readonly hashConcurrency: number;
    /** `NB_SITE_IDENTITY_HASH_QUEUE`：排队等着算哈希的请求数上限；0 表示不排队，算满了就回 `overloaded`。 */
    readonly hashQueue: number;
}

/** 配置问题只带变量名与固定的问题词，不带取值（`site.operations` 输出 1）。 */
export interface IdentityConfigProblem {
    readonly name: string;
    readonly problem: "missing" | "too_short" | "bad_format" | "not_integer" | "out_of_range";
}

export type IdentityConfigResult = {readonly ok: true; readonly config: IdentityConfig} | {readonly ok: false; readonly problems: readonly IdentityConfigProblem[]};

/** 会话密钥至少这么多个字符（按 Unicode 码点数）。 */
const SESSION_SECRET_MIN_LENGTH = 32;

interface IntegerVariable {
    readonly name: string;
    readonly min: number;
    readonly max: number;
    readonly fallback: number;
}

const SESSION_DAYS: IntegerVariable = {name: "NB_SITE_IDENTITY_SESSION_DAYS", min: 2, max: 365, fallback: 30};
const HASH_CONCURRENCY: IntegerVariable = {name: "NB_SITE_IDENTITY_HASH_CONCURRENCY", min: 1, max: 16, fallback: 2};
const HASH_QUEUE: IntegerVariable = {name: "NB_SITE_IDENTITY_HASH_QUEUE", min: 0, max: 10_000, fallback: 64};

const TERMS_VERSION = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** 形如 `YYYY-MM-DD` 且是公历里真实存在的一天（`2026-02-29` 不是）。 */
function isCalendarDate(value: string): boolean {
    const match = TERMS_VERSION.exec(value);
    if (match === null) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1) return false;
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
    return day <= daysInMonth;
}

export function parseIdentityConfig(env: Readonly<Record<string, string | undefined>>): IdentityConfigResult {
    const problems: IdentityConfigProblem[] = [];
    const given = (name: string): string | undefined => {
        const value = env[name];
        return value === undefined || value === "" ? undefined : value;
    };
    const readInteger = (variable: IntegerVariable): number => {
        const value = given(variable.name);
        if (value === undefined) return variable.fallback;
        // `-1` 是整数、只是越界；`1e3`、`7.0` 不是整数写法。
        if (!/^-?\d+$/u.test(value)) {
            problems.push({name: variable.name, problem: "not_integer"});
            return variable.fallback;
        }
        const number = Number(value);
        if (number < variable.min || number > variable.max) {
            problems.push({name: variable.name, problem: "out_of_range"});
            return variable.fallback;
        }
        return number;
    };

    const sessionSecret = given("NB_SITE_SESSION_SECRET");
    if (sessionSecret === undefined) problems.push({name: "NB_SITE_SESSION_SECRET", problem: "missing"});
    else if ([...sessionSecret].length < SESSION_SECRET_MIN_LENGTH) problems.push({name: "NB_SITE_SESSION_SECRET", problem: "too_short"});

    const termsVersion = given("NB_SITE_IDENTITY_TERMS_VERSION");
    if (termsVersion === undefined) problems.push({name: "NB_SITE_IDENTITY_TERMS_VERSION", problem: "missing"});
    else if (!isCalendarDate(termsVersion)) problems.push({name: "NB_SITE_IDENTITY_TERMS_VERSION", problem: "bad_format"});

    // 只认这两个小写的词：`TRUE`、`1`、`yes` 都报 bad_format，免得部署的人以为开了、其实没开（或反过来）。
    const registrationOpenValue = given("NB_SITE_IDENTITY_REGISTRATION_OPEN");
    let registrationOpen = true;
    if (registrationOpenValue === "false") registrationOpen = false;
    else if (registrationOpenValue !== undefined && registrationOpenValue !== "true") problems.push({name: "NB_SITE_IDENTITY_REGISTRATION_OPEN", problem: "bad_format"});

    const sessionDays = readInteger(SESSION_DAYS);
    const hashConcurrency = readInteger(HASH_CONCURRENCY);
    const hashQueue = readInteger(HASH_QUEUE);

    if (problems.length > 0) return {ok: false, problems};
    return {ok: true, config: {sessionSecret: sessionSecret!, termsVersion: termsVersion!, registrationOpen, sessionDays, hashConcurrency, hashQueue}};
}
