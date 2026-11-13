/**
 * 同一书库只允许一个有效的服务（docs/specs/story/cli-skill.md 状态与转换、副作用与数据）。
 *
 * 单实例靠操作系统的文件锁：`serve` 对 `<书库>/.serve.lock` 拿 `flock(LOCK_EX | LOCK_NB)`，拿到就一直持有到进程
 * 退出。进程怎么结束锁都会被内核放掉，所以没有“判旧再回收”的竞争；两个同时启动的 `serve` 恰有一个拿到锁。
 * 登记 `.serve.json` 只由持锁者写（临时文件改名，发布是原子的），停止时先删登记再停监听、放锁。
 * 锁本身见 `@notnotype/nb-flock`。
 */

import {randomUUID} from "node:crypto";
import {readFile, rename, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {tryLock} from "@notnotype/nb-flock";

import {systemErrorCode} from "../core/errors";
import {LOCK_FILE, REGISTRATION_FILE} from "../cli/registration";
import type {Registration} from "../cli/registration";

export interface ServeLock {
    /** 写登记（临时文件改名）。 */
    publish(registration: Registration): Promise<void>;
    /** 删登记（停止时先于停止监听）。 */
    withdraw(): Promise<void>;
    /** 放锁（停止监听之后）；之后这个对象不能再用。 */
    release(): void;
}

/** 拿服务锁；已被别的服务持有时返回 null。 */
export function acquireServeLock(library: string): ServeLock | null {
    const lock = tryLock(join(library, LOCK_FILE));
    if (!lock) return null;
    const registrationPath = join(library, REGISTRATION_FILE);
    return {
        async publish(registration) {
            const temp = `${registrationPath}.${randomUUID()}.tmp`;
            await writeFile(temp, `${JSON.stringify(registration)}\n`);
            await rename(temp, registrationPath);
        },
        async withdraw() {
            await rm(registrationPath, {force: true});
        },
        release() {
            lock.release();
        },
    };
}

/** 读当前登记里的地址（给“已有服务”的提示用）；读不到为 null。 */
export async function registeredUrl(library: string): Promise<string | null> {
    try {
        const value = JSON.parse(await readFile(join(library, REGISTRATION_FILE), "utf8")) as {url?: unknown};
        return typeof value.url === "string" ? value.url : null;
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT" || error instanceof SyntaxError) return null;
        throw error;
    }
}
