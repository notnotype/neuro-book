/**
 * 密码的两种存法（`password.ts` 文件头；`site.accounts` 输出 4、21）。用真的 `Bun.password` 与真的 `crypto.scrypt`。
 *
 * 旧站格式的样本是这里用 `crypto.scrypt` 按 `scrypt:<盐>:<十六进制>` 的写法自己造的，没有对照旧站源码（计划第 11 节）：这些用例
 * 证明的是“按这个写法造的哈希能校验、能被认出要换格式”，不证明旧站真的这样写。t12 用旧站代码造真实样本再核。
 */

import {describe, expect, it} from "bun:test";
import {scrypt} from "node:crypto";

import {recordingLog} from "./testing/library";
import {hashPassword, needsRehash, verifyPassword} from "./password";

const PASSWORD = "correct horse battery staple";

/** 按旧站的写法造一份哈希：Node 缺省参数，盐按字符串用，64 字节。 */
function legacyHash(password: string, salt: string): Promise<string> {
    return new Promise((resolve, reject) => {
        scrypt(password, salt, 64, (error, key) => (error ? reject(error) : resolve(`scrypt:${salt}:${key.toString("hex")}`)));
    });
}

function context() {
    const log = recordingLog();
    return {log, verify: {accountId: 42, log}};
}

describe("新格式", () => {
    it("是 argon2id 19 MiB、2 轮的 PHC 串；对的密码校验为真，错的为假", async () => {
        const {verify} = context();
        const stored = await hashPassword(PASSWORD);
        expect(stored.startsWith("$argon2id$v=19$m=19456,t=2,p=1$")).toBe(true);
        expect(await verifyPassword(PASSWORD, stored, verify)).toBe(true);
        expect(await verifyPassword(`${PASSWORD}!`, stored, verify)).toBe(false);
    });

    it("同一个密码两次的哈希不同（每次随机盐），都能校验", async () => {
        const {verify} = context();
        const first = await hashPassword(PASSWORD);
        const second = await hashPassword(PASSWORD);
        expect(first).not.toBe(second);
        expect(await verifyPassword(PASSWORD, first, verify)).toBe(true);
        expect(await verifyPassword(PASSWORD, second, verify)).toBe(true);
    });

    it("参数从串里读：较低参数存的 argon2id 照样校验", async () => {
        const {verify} = context();
        const older = await Bun.password.hash(PASSWORD, {algorithm: "argon2id", memoryCost: 4096, timeCost: 1});
        expect(await verifyPassword(PASSWORD, older, verify)).toBe(true);
        expect(await verifyPassword("wrong", older, verify)).toBe(false);
    });
});

describe("旧站格式（输出 21）", () => {
    it("对的密码校验为真，错的为假", async () => {
        const {verify} = context();
        const stored = await legacyHash(PASSWORD, "Q3x9sLtZ");
        expect(await verifyPassword(PASSWORD, stored, verify)).toBe(true);
        expect(await verifyPassword(`${PASSWORD}!`, stored, verify)).toBe(false);
    });

    it("盐按字符串用：看起来像十六进制的盐也不解码；盐里有冒号与非 ASCII 字符也认", async () => {
        const {verify} = context();
        // `a1b2c3d4` 解成十六进制是 4 个字节，按字符串是 8 个字节，两种派生出的值不同。
        for (const salt of ["a1b2c3d4", "盐:with:colons"]) {
            const stored = await legacyHash(PASSWORD, salt);
            expect(await verifyPassword(PASSWORD, stored, verify)).toBe(true);
        }
    });

    it("值写成大写的十六进制也认", async () => {
        const {verify} = context();
        const stored = await legacyHash(PASSWORD, "salt");
        const upper = `scrypt:salt:${stored.slice("scrypt:salt:".length).toUpperCase()}`;
        expect(await verifyPassword(PASSWORD, upper, verify)).toBe(true);
    });
});

describe("未知格式", () => {
    it("校验恒为假，每次记一行 identity.password_format_unknown，只带账号 id", async () => {
        const {log, verify} = context();
        const bcrypt = await Bun.password.hash(PASSWORD, {algorithm: "bcrypt", cost: 4});
        const argon2i = await Bun.password.hash(PASSWORD, {algorithm: "argon2i", memoryCost: 4096, timeCost: 1});
        const legacy = await legacyHash(PASSWORD, "salt");
        const unknown = [
            "",
            PASSWORD,
            bcrypt,
            argon2i,
            // 库缺省的 `十六进制盐:十六进制值`（计划探针 p1）。
            `${"ab".repeat(16)}:${"cd".repeat(64)}`,
            // 旧站前缀，但值不是 64 字节的十六进制，或没有盐。
            legacy.slice(0, -2),
            `${legacy.slice(0, -1)}g`,
            `scrypt::${"0".repeat(128)}`,
        ];
        for (const stored of unknown) expect(await verifyPassword(PASSWORD, stored, verify)).toBe(false);
        expect(log.lines).toEqual(unknown.map(() => ({level: "warn", event: "identity.password_format_unknown", fields: {accountId: 42}})));
    });
});

describe("needsRehash", () => {
    it("旧站格式为真；当前参数的 argon2id 为假；内存或轮数低于当前参数的 argon2id 为真；未知格式为假", async () => {
        expect(needsRehash(await legacyHash(PASSWORD, "salt"))).toBe(true);
        expect(needsRehash(await hashPassword(PASSWORD))).toBe(false);
        expect(needsRehash(await Bun.password.hash(PASSWORD, {algorithm: "argon2id", memoryCost: 4096, timeCost: 2}))).toBe(true);
        expect(needsRehash(await Bun.password.hash(PASSWORD, {algorithm: "argon2id", memoryCost: 19456, timeCost: 1}))).toBe(true);
        expect(needsRehash(await Bun.password.hash(PASSWORD, {algorithm: "bcrypt", cost: 4}))).toBe(false);
    });

    it("换出来的新格式能用同一个密码校验，且不再需要换", async () => {
        const {verify} = context();
        const legacy = await legacyHash(PASSWORD, "salt");
        expect(await verifyPassword(PASSWORD, legacy, verify)).toBe(true);
        const renewed = await hashPassword(PASSWORD);
        expect(await verifyPassword(PASSWORD, renewed, verify)).toBe(true);
        expect(needsRehash(renewed)).toBe(false);
    });
});
