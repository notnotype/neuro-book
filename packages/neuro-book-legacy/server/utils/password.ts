import {randomBytes, scrypt as scryptCallback, timingSafeEqual} from "node:crypto";
import {promisify} from "node:util";

const scrypt = promisify(scryptCallback);
const passwordHashPrefix = "scrypt";
const passwordKeyLength = 64;

/**
 * 生成 scrypt 密码哈希。
 */
export async function hashUserPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString("hex");
    const key = await scrypt(password, salt, passwordKeyLength) as Buffer;
    return `${passwordHashPrefix}:${salt}:${key.toString("hex")}`;
}

/**
 * 校验明文密码是否匹配存储哈希。
 */
export async function verifyUserPassword(password: string, storedHash: string): Promise<boolean> {
    const [prefix, salt, keyHex] = storedHash.split(":");
    if (prefix !== passwordHashPrefix || !salt || !keyHex) {
        return false;
    }

    const storedKey = Buffer.from(keyHex, "hex");
    const inputKey = await scrypt(password, salt, storedKey.length) as Buffer;
    if (storedKey.length !== inputKey.length) {
        return false;
    }

    return timingSafeEqual(storedKey, inputKey);
}
