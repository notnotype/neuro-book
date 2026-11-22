/**
 * 安装的随机密钥：会话日志里的凭据身份（HMAC）用它，换了密钥旧回复的签名就不再还原——所以只在文件不存在时生成，之后一直沿用。
 * 文件在状态根的 `agent/identity.key`，只给本人读写；内容是 32 字节的十六进制文本，不是用户的任何密钥。
 */

import {randomBytes} from "node:crypto";
import {chmod, mkdir, readFile, rename, unlink, writeFile} from "node:fs/promises";
import {dirname} from "node:path";

export async function loadInstallSecret(path: string): Promise<string> {
    let broken = false;
    try {
        const existing = (await readFile(path, "utf8")).trim();
        if (/^[a-f0-9]{64}$/u.test(existing)) {
            // 从备份、迁移拷来的文件可能权限更宽：收紧到只给本人（`mode` 只管新建，已有的文件要另改）。
            await chmod(path, 0o600);
            return existing;
        }
        // 内容不合格（被手改坏）：重新生成。旧回复的签名从此不再还原，比用一个不合格的密钥安全。
        broken = true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const created = randomBytes(32).toString("hex");
    await mkdir(dirname(path), {recursive: true, mode: 0o700});
    if (broken) {
        // 坏文件原地覆盖会沿用它的旧权限：写一个 0600 的新文件再整个换上。
        const temp = `${path}.${String(process.pid)}.tmp`;
        await writeFile(temp, `${created}\n`, {mode: 0o600});
        try {
            await rename(temp, path);
        } catch (error) {
            await unlink(temp).catch(() => undefined);
            throw error;
        }
        return created;
    }
    // `wx`：两个进程同时第一次启动时只有一个写成，另一个读回对方的。
    try {
        await writeFile(path, `${created}\n`, {mode: 0o600, flag: "wx"});
        return created;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        return (await readFile(path, "utf8")).trim();
    }
}
