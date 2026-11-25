/**
 * 密码哈希的两种存法（ADR 0060 后果第二条；w00037 t07 计划 3.7 的“密码格式”）。按前缀分派：
 *
 * - 新格式：argon2id 的 PHC 串，`$argon2id$v=19$m=19456,t=2,p=1$<盐>$<值>`。校验时参数从串里读，所以以后调高参数不影响已存的哈希，
 *   只让 `needsRehash` 对旧参数为真。
 * - 旧站格式：`scrypt:<盐>:<64 字节的十六进制>`，Node `crypto.scrypt` 的缺省参数（N=16384、r=8、p=1），盐按字符串用（UTF-8 编码后
 *   交给 scrypt，不按十六进制解码）。这个写法取自 t01 的记录与 t02 的探针，没有对照旧站源码，也没有用旧站真实生成的哈希验过
 *   （计划第 11 节）：本包的用例是用 `crypto.scrypt` 按这个写法自己造的样本。t12 开工前用旧站代码造真实样本再核，对不上时只改这里。
 * - 都不是：校验恒为假，记一行 `identity.password_format_unknown`。
 *
 * 只用异步的哈希与校验：`Bun.password` 的异步版与 `crypto.scrypt` 在线程池里算，不停住事件循环；同步版（`hashSync`）会把事件循环
 * 停住几十到几百毫秒（计划探针 p5）。并发个数由调用方经 `hash-limiter.ts` 的限额控制，这里不管。
 */

import {scrypt, timingSafeEqual} from "node:crypto";

import type {IdentityLog} from "./index";

/** argon2id 的内存，KiB（19 MiB）。OWASP 给 argon2id 的最低档之一；一次约 71 毫秒，取舍见计划 3.7 的“算多久、占多少”。 */
export const ARGON2_MEMORY_KIB = 19_456;

/** argon2id 的轮数。 */
export const ARGON2_TIME_COST = 2;

/** 旧站 scrypt 的派生长度，字节。 */
const LEGACY_KEY_BYTES = 64;

const LEGACY_PREFIX = "scrypt:";

/**
 * 新格式的 PHC 串。盐与值是不带填充的标准 base64（Bun 的写法）。只认 argon2id：`$argon2i$`、bcrypt 这些 `Bun.password.verify`
 * 也认得的格式不是本站写过的，按未知格式处理，免得一段不知来历的哈希被当成有效的密码。
 */
const ARGON2ID_PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/u;

/** 旧站写的是小写（`Buffer.toString("hex")`）；大写也认，解出来是同样的字节，没有理由把这样存着的人锁在外面。 */
const LEGACY_HEX = new RegExp(`^[0-9a-fA-F]{${String(LEGACY_KEY_BYTES * 2)}}$`, "u");

type ParsedHash =
    | {readonly format: "argon2id"; readonly memoryKib: number; readonly timeCost: number}
    | {readonly format: "legacy_scrypt"; readonly salt: string; readonly key: Buffer}
    | {readonly format: "unknown"};

function parseHash(stored: string): ParsedHash {
    const phc = ARGON2ID_PHC.exec(stored);
    if (phc !== null) return {format: "argon2id", memoryKib: Number(phc[1]), timeCost: Number(phc[2])};
    if (stored.startsWith(LEGACY_PREFIX)) {
        // 十六进制里没有冒号，所以最后一个冒号之后是值、之前是盐；盐里有冒号也照样分得开。
        const rest = stored.slice(LEGACY_PREFIX.length);
        const separator = rest.lastIndexOf(":");
        const salt = rest.slice(0, separator);
        const hex = rest.slice(separator + 1);
        if (separator > 0 && LEGACY_HEX.test(hex)) return {format: "legacy_scrypt", salt, key: Buffer.from(hex, "hex")};
    }
    return {format: "unknown"};
}

/** 算新格式的哈希。`password` 不能为空串（`Bun.password` 拒绝空密码）：各入口的字段规则先挡住它。 */
export function hashPassword(password: string): Promise<string> {
    return Bun.password.hash(password, {algorithm: "argon2id", memoryCost: ARGON2_MEMORY_KIB, timeCost: ARGON2_TIME_COST});
}

function legacyDerive(password: string, salt: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        // 不给参数就是 Node 的缺省（N=16384、r=8、p=1），与旧站的写法一致（文件头）。
        // 没出错时 Node 给 `null`、Bun 给 `undefined`（实测），所以按真假判。
        scrypt(password, salt, LEGACY_KEY_BYTES, (error, key) => (error ? reject(error) : resolve(key)));
    });
}

export interface VerifyPasswordContext {
    /** 这份哈希属于哪个账号：只为未知格式那一行日志。登录对不存在的账号拿假哈希校验时，假哈希是新格式，不会用到它。 */
    readonly accountId: string | number;
    readonly log: Pick<IdentityLog, "warn">;
}

/**
 * 校验密码。未知格式恒为假并记一行日志（只带账号 id，不带哈希）。新格式的串符合 PHC 的写法、内容却坏了（例如 base64 的长度不对）
 * 时，`Bun.password.verify` 抛出的错误原样传出：那是库里数据坏了，由调用方按程序错误处理，不悄悄当成密码不对。
 */
export async function verifyPassword(password: string, stored: string, context: VerifyPasswordContext): Promise<boolean> {
    const parsed = parseHash(stored);
    switch (parsed.format) {
        case "argon2id":
            return Bun.password.verify(password, stored, "argon2id");
        case "legacy_scrypt": {
            const derived = await legacyDerive(password, parsed.salt);
            return timingSafeEqual(derived, parsed.key);
        }
        case "unknown":
            context.log.warn("identity.password_format_unknown", "a stored password hash has an unknown format", {accountId: context.accountId});
            return false;
    }
}

/**
 * 校验通过之后要不要换成新格式（`site.accounts` 输出 21）：旧站格式为真；argon2id 但内存或轮数低于当前参数时也为真（以后调高参数
 * 时用到）。未知格式为假：它校验恒为假，走不到换格式那一步。
 */
export function needsRehash(stored: string): boolean {
    const parsed = parseHash(stored);
    switch (parsed.format) {
        case "legacy_scrypt":
            return true;
        case "argon2id":
            return parsed.memoryKib < ARGON2_MEMORY_KIB || parsed.timeCost < ARGON2_TIME_COST;
        case "unknown":
            return false;
    }
}

/**
 * 哈希与校验两个函数。路由经它调用：产品用本文件的 `hashPassword`、`verifyPassword`（`REAL_PASSWORD_FUNCTIONS`）；包内测试包一层，
 * 数调用次数，或在“校验完、发会话之前”插入一个动作（计划第 6 节“只能注入校验函数的包装”）。
 */
export interface PasswordFunctions {
    hash(password: string): Promise<string>;
    verify(password: string, stored: string, context: VerifyPasswordContext): Promise<boolean>;
}

export const REAL_PASSWORD_FUNCTIONS: PasswordFunctions = {hash: hashPassword, verify: verifyPassword};
