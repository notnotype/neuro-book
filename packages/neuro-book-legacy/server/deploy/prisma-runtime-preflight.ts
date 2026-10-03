import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

export type PrismaRuntimeMode = "product" | "source";

export type PrismaRuntimePlan = {
    mode: PrismaRuntimeMode;
    clientPath: string;
    generateScriptPath: string | null;
};

type CommandRunner = (
    command: string,
    args: string[],
    options: {
        cwd: string;
        env: typeof process.env;
        label: string;
        stdio: "inherit";
    },
) => Promise<void>;

export type PrismaRuntimePreflightOptions = {
    cwd?: string;
    scriptPath?: string;
    exists?: (path: string) => boolean;
    runCommand?: CommandRunner;
    log?: (message: string) => void;
    env?: typeof process.env;
};

/**
 * 解析当前 CLI 应该使用源码 Prisma Client 还是 Product 内打包的 Client。
 */
export function resolvePrismaRuntimePlan(options: PrismaRuntimePreflightOptions = {}): PrismaRuntimePlan {
    const cwd = resolve(options.cwd ?? process.cwd());
    const scriptPath = normalizePath(options.scriptPath ?? fileURLToPath(import.meta.url));
    const productMode = scriptPath.includes("/.output/server/commands/");

    if (productMode) {
        return {
            mode: "product",
            clientPath: scriptPath,
            generateScriptPath: null,
        };
    }

    return {
        mode: "source",
        clientPath: resolve(cwd, "server", "generated", "prisma", "client.ts"),
        generateScriptPath: resolve(cwd, "scripts", "db", "prisma-generate.mjs"),
    };
}

/**
 * 确保 CLI 在导入 App Prisma 前拥有可用的 Prisma Client。
 */
export async function ensurePrismaRuntime(options: PrismaRuntimePreflightOptions = {}): Promise<void> {
    const cwd = resolve(options.cwd ?? process.cwd());
    const exists = options.exists ?? existsSync;
    const plan = resolvePrismaRuntimePlan({...options, cwd});

    if (exists(plan.clientPath)) {
        return;
    }

    if (plan.mode === "product") {
        throw new Error([
            `Product Runtime 缺少打包后的 Prisma Client：${plan.clientPath}`,
            "请拉取与部署脚本匹配的 GHCR 镜像，或重新运行 bun run nuxt:build / bun run product:stage。",
            "Product/GHCR 运行机不会执行 Prisma generate。",
        ].join("\n"));
    }

    if (!plan.generateScriptPath || !exists(plan.generateScriptPath)) {
        throw new Error(`源码部署缺少 Prisma generate 脚本：${plan.generateScriptPath ?? "<unknown>"}`);
    }

    assertSourceDependencies(cwd, exists);

    const nuxtTsConfigPath = resolve(cwd, ".nuxt", "tsconfig.json");
    if (!exists(nuxtTsConfigPath)) {
        options.log?.("未找到 Nuxt TS 配置，正在执行 nuxt:prepare。");
        await runPreflightCommand("Nuxt prepare", process.execPath, ["run", "nuxt:prepare"], {
            cwd,
            env: options.env ?? process.env,
            stdio: "inherit",
        }, options.runCommand ?? runCommand);
    }

    options.log?.("未找到 App Prisma Client，正在自动生成。");
    await runPreflightCommand("Prisma generate", process.execPath, [plan.generateScriptPath], {
        cwd,
        env: options.env ?? process.env,
        stdio: "inherit",
    }, options.runCommand ?? runCommand);

    if (!exists(plan.clientPath)) {
        throw new Error(`Prisma generate 已执行，但仍缺少 App Prisma Client：${plan.clientPath}`);
    }
}

/**
 * 源码模式自愈需要本地源码依赖，Nuxt CLI 是最低依赖探针。
 */
function assertSourceDependencies(cwd: string, exists: (path: string) => boolean): void {
    if (nuxtCliCandidatePaths(cwd).some((path) => exists(path))) {
        return;
    }

    throw new Error([
        "源码部署缺少本地 Nuxt CLI，无法执行管理员脚本自愈流程。",
        "请先在源码部署目录运行 bun install --frozen-lockfile，再运行 bun run auth:create-admin。",
            "如果这是 GHCR 部署，不要在宿主机源码 checkout 中运行 bun run auth:create-admin；请通过 NeuroBook Manager 的 admin create 命令执行。",
    ].join("\n"));
}

function nuxtCliCandidatePaths(cwd: string): string[] {
    return [
        resolve(cwd, "node_modules", ".bin", "nuxt"),
        resolve(cwd, "node_modules", ".bin", "nuxt.exe"),
        resolve(cwd, "node_modules", ".bin", "nuxt.cmd"),
        resolve(cwd, "node_modules", ".bin", "nuxt.ps1"),
        resolve(cwd, "node_modules", ".bin", "nuxt.bunx"),
    ];
}

/**
 * 执行 preflight 子命令，并保留失败阶段。
 */
async function runPreflightCommand(
    label: string,
    command: string,
    args: string[],
    options: {cwd: string; env: typeof process.env; stdio: "inherit"},
    runner: CommandRunner,
): Promise<void> {
    try {
        await runner(command, args, {...options, label});
    } catch (error) {
        if (error instanceof Error && error.message.startsWith(`${label} `)) {
            throw error;
        }
        throw new Error(`${label} 失败：${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * 执行外部命令并继承当前终端输出。
 */
async function runCommand(command: string, args: string[], options: {cwd: string; env: typeof process.env; label: string; stdio: "inherit"}): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env,
            stdio: options.stdio,
            shell: false,
            windowsHide: true,
        });
        child.on("error", rejectPromise);
        child.on("exit", (code, signal) => {
            if (signal) {
                rejectPromise(new Error(`${options.label} 被信号中断：${signal}`));
                return;
            }
            if (code !== 0) {
                rejectPromise(new Error(`${options.label} 失败，退出码：${code ?? 1}`));
                return;
            }
            resolvePromise();
        });
    });
}

function normalizePath(path: string): string {
    return path.replaceAll("\\", "/");
}
