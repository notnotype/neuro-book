/**
 * `env:<变量名>` 引用：密钥与请求头的值可以写成引用，发请求时从宿主给的环境里取（docs/specs/models/service.md）。
 * 环境由宿主交来，通常是进程启动时的快照：OMP 被导入时会把家目录等处的 `.env` 并进 `process.env`，那些不算
 * （ADR 0032 的口径），所以这里不读 `process.env`。
 */

export type StartupEnv = Readonly<Record<string, string | undefined>>;

export const ENV_PREFIX = "env:";

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/** 环境变量名的写法。 */
export function isEnvName(name: string): boolean {
    return ENV_NAME.test(name);
}

/** `env:NAME` 的变量名；不是引用时为 null。前缀之后不是合法的变量名时同样为 null（当作普通值）。 */
export function envRefName(value: string): string | null {
    if (!value.startsWith(ENV_PREFIX)) return null;
    const name = value.slice(ENV_PREFIX.length).trim();
    return isEnvName(name) ? name : null;
}

/** 变量的值；没有或只有空白时为 null。 */
export function envValue(env: StartupEnv, name: string): string | null {
    const value = env[name];
    return value === undefined || value.trim() === "" ? null : value;
}
