import {cancel, isCancel, password as promptPassword, text} from "@clack/prompts";
import {ensurePrismaRuntime} from "nbook/server/deploy/prisma-runtime-preflight";
import {hashUserPassword} from "nbook/server/utils/password";
import {applyAppSqliteMigrations} from "nbook/server/database/app-sqlite-migrations";

export const MAX_ADMIN_PASSWORD_BYTES = 4096;

type CreateAdminCliOptions = {
    /** 未提供时从 AUTH_ADMIN_USERNAME 或交互提示读取。 */
    username?: string;
    passwordStdin: boolean;
};

type PrismaClientInstance = typeof import("nbook/server/utils/prisma").prisma;
let prisma: PrismaClientInstance | null = null;

/**
 * 确保 App SQLite schema 已迁移到当前版本。
 */
async function ensureDatabaseSchema(): Promise<void> {
    await applyAppSqliteMigrations();
}

/**
 * 读取管理员用户名。优先用参数或环境变量，缺失时交互输入。
 */
async function readUsername(options: CreateAdminCliOptions): Promise<string> {
    const username = options.username?.trim() || process.env.AUTH_ADMIN_USERNAME?.trim();
    if (username) {
        return username;
    }

    const input = await text({
        message: "管理员用户名",
        placeholder: "admin",
        validate: (value) => typeof value === "string" && value.trim() ? undefined : "用户名不能为空",
    });
    if (isCancel(input)) {
        cancel("已取消创建管理员");
        process.exit(1);
    }
    if (typeof input !== "string") throw new Error("管理员用户名输入无效");
    return input.trim();
}

/**
 * 读取管理员密码。自动化只能显式使用stdin；环境和argv都不是secret transport。
 */
async function readPassword(options: CreateAdminCliOptions): Promise<string> {
    if (options.passwordStdin) {
        return await decodePasswordInput(process.stdin);
    }
    const input = await promptPassword({
        message: "管理员密码",
        validate: (value) => typeof value === "string" && value.length >= 8 ? undefined : "管理员密码至少 8 个字符",
    });
    if (isCancel(input)) {
        cancel("已取消创建管理员");
        process.exit(1);
    }
    if (typeof input !== "string") throw new Error("管理员密码输入无效");
    return input;
}

/**
 * 创建或升级管理员账号。
 */
export async function runCreateAdminCommand(args = process.argv.slice(2)): Promise<void> {
    const options = parseCreateAdminArgs(args);
    await ensurePrismaRuntime({log: (message) => console.log(message)});
    const username = await readUsername(options);
    const password = await readPassword(options);
    if (password.length < 8) {
        throw new Error("管理员密码至少 8 个字符");
    }

    await ensureDatabaseSchema();
    ({prisma} = await import("nbook/server/utils/prisma"));
    const passwordHash = await hashUserPassword(password);
    const user = await prisma.user.upsert({
        where: {username},
        create: {
            username,
            displayName: username,
            passwordHash,
            role: "admin",
            status: "active",
        },
        update: {
            passwordHash,
            role: "admin",
            status: "active",
            sessionVersion: {increment: 1},
        },
    });

    console.log(`管理员已就绪：${user.username} (#${user.id})`);
}

/** CLI参数只允许一个username和显式stdin开关，第二个位置参数永远视为secret泄漏。 */
export function parseCreateAdminArgs(args: readonly string[]): CreateAdminCliOptions {
    let username: string | undefined;
    let passwordStdin = false;
    for (const arg of args) {
        if (arg === "--password-stdin") {
            if (passwordStdin) throw new Error("--password-stdin 不能重复。");
            passwordStdin = true;
            continue;
        }
        if (arg.startsWith("-")) throw new Error(`未知参数：${arg}`);
        if (username !== undefined) {
            throw new Error("不要把密码作为命令行参数传入。自动化请使用 --password-stdin，交互运行请按提示输入。");
        }
        username = arg;
    }
    return {username, passwordStdin};
}

/** 读取不超过4096 bytes的原始UTF-8 stdin；不trim，不删除换行。 */
export async function decodePasswordInput(input: AsyncIterable<Uint8Array | string>): Promise<string> {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of input) {
        const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
        total += bytes.byteLength;
        if (total > MAX_ADMIN_PASSWORD_BYTES) {
            throw new Error(`管理员密码不能超过 ${String(MAX_ADMIN_PASSWORD_BYTES)} bytes。`);
        }
        chunks.push(bytes);
    }
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.byteLength;
    }
    try {
        return new TextDecoder("utf-8", {fatal: true}).decode(joined);
    } catch {
        throw new Error("管理员密码stdin不是有效UTF-8。");
    }
}

/** Product bundle 与 Source Adapter 共用的进程级入口。 */
export async function runCreateAdminCli(args = process.argv.slice(2)): Promise<void> {
    try {
        await runCreateAdminCommand(args);
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    } finally {
        await prisma?.$disconnect();
        prisma = null;
    }
}

if (import.meta.main) {
    await runCreateAdminCli();
}
