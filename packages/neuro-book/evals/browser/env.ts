/**
 * 评测读模型密钥的 `.env`：缺省是主工作区根的那份（worktree 里没有 `.env`，按 Git 的公共目录找回主工作区）。
 * 文件可能是 CRLF，取值去掉回车与两端成对的引号。取到的值只交给模型网关，不打印、不写进运行记录。
 */

import {readFile} from "node:fs/promises";
import {dirname, join} from "node:path";

/** 评测的 `.env` 出错：`env-file-missing` 找不到文件，`env-key-missing` 文件里缺键。message 只写键名与路径，不写取值。 */
export class EvalEnvError extends Error {
    readonly code: "env-file-missing" | "env-key-missing";

    constructor(code: EvalEnvError["code"], message: string) {
        super(message);
        this.name = "EvalEnvError";
        this.code = code;
    }
}

/** 主工作区根的 `.env` 的路径：`git rev-parse --git-common-dir` 在主工作区与 worktree 里都指向主工作区的 `.git`。 */
export async function defaultEnvFile(cwd: string): Promise<string> {
    const git = Bun.spawn(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], {cwd, stdout: "pipe", stderr: "pipe"});
    const [out, err, code] = await Promise.all([new Response(git.stdout).text(), new Response(git.stderr).text(), git.exited]);
    if (code !== 0) throw new Error(`git rev-parse --git-common-dir failed in ${cwd}: ${err.trim()}`);
    return join(dirname(out.trim()), ".env");
}

/** 解析 `.env` 的文字：`键=值` 一行一个，空行与 `#` 开头的行跳过；同一个键出现几次取最后一次。 */
export function parseEnv(text: string): ReadonlyMap<string, string> {
    const values = new Map<string, string>();
    for (const raw of text.split("\n")) {
        const line = raw.replace(/\r$/u, "").trim();
        if (line === "" || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim().replace(/^export\s+/u, "");
        let value = line.slice(eq + 1).trim();
        if (value.length >= 2 && (value[0] === "\"" || value[0] === "'") && value.at(-1) === value[0]) value = value.slice(1, -1);
        values.set(key, value);
    }
    return values;
}

/** 读 `.env`；文件不在时抛 `env-file-missing`。 */
export async function readEnvFile(path: string): Promise<ReadonlyMap<string, string>> {
    let text: string;
    try {
        text = await readFile(path, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new EvalEnvError("env-file-missing", `env file not found: ${path}`);
        throw error;
    }
    return parseEnv(text);
}

/** 取一组键，缺任何一个都抛 `env-key-missing`，message 列出缺的键名。 */
export function requireEnv<K extends string>(values: ReadonlyMap<string, string>, keys: readonly K[], source: string): Record<K, string> {
    const missing = keys.filter((key) => (values.get(key) ?? "") === "");
    if (missing.length > 0) throw new EvalEnvError("env-key-missing", `missing keys in ${source}: ${missing.join(", ")}`);
    return Object.fromEntries(keys.map((key) => [key, values.get(key) as string])) as Record<K, string>;
}
