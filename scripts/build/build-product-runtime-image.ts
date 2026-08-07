import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {mkdir, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {lock as acquireFileLock} from "proper-lockfile";
import {currentProductPlatform} from "nbook/packages/neuro-book-manager/src/platform";
import type {ProductPlatform} from "nbook/packages/neuro-book-manager/src/types";
import {LocalProductPublisher} from "nbook/scripts/build/local-product-publisher";
import {
    PRODUCT_RUNTIME_MAX_BYTES,
    PRODUCT_RUNTIME_MAX_FILES,
    ProductRuntimeImageBuilder,
    productRuntimeBuildPolicy,
    type ProductRuntimeBuildContext,
    type ProductRuntimeOwnerBaseline,
} from "nbook/scripts/build/product-runtime-image-builder";

export {PRODUCT_RUNTIME_MAX_BYTES, PRODUCT_RUNTIME_MAX_FILES};
export const PRODUCT_SOURCE_DATE_EPOCH = "0";
export const PRODUCT_NODE_OPTIONS = "--max-old-space-size=4096";
const NUXT_CLI_ENTRY = "node_modules/nuxt/bin/nuxt.mjs";
const PRODUCT_BUILD_PASSTHROUGH_ENVIRONMENT = new Set([
    "APPDATA",
    "COMSPEC",
    "DYLD_LIBRARY_PATH",
    "HOME",
    "LD_LIBRARY_PATH",
    "LOCALAPPDATA",
    "PATH",
    "PATHEXT",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USERPROFILE",
    "WINDIR",
    "XDG_CACHE_HOME",
]);

export const PRODUCT_RUNTIME_OWNERS = productRuntimeBuildPolicy("windows-x64").owners;

/** 统一执行 Nuxt raw build、Product 后处理、Runtime Image 验证与本地发布。 */
export async function buildProductRuntimeImage(): Promise<void> {
    const projectRoot = process.cwd();
    await withProductBuildLease(projectRoot, async () => {
        const platform = currentProductPlatform();
        const policy = productRuntimeBuildPolicy(platform);
        const buildEnvironment = productBuildEnvironment(process.env);
        await prepareProductRuntimeSource(buildEnvironment);
        const explicitRevision = process.env.NEURO_BOOK_SOURCE_REVISION?.trim();
        const operationId = `${new Date().toISOString().replace(/[^0-9]/gu, "")}-${randomUUID()}`;
        const builder = new ProductRuntimeImageBuilder(projectRoot);
        const candidate = await builder.buildCandidate({
            operationId,
            platform,
            owners: policy.owners,
            expectedSource: explicitRevision ? {revision: explicitRevision, dirty: false} : undefined,
            budget: policy.budget,
            async build(context) {
                await buildProductRuntimePayload(context, buildEnvironment);
            },
        });
        const published = await new LocalProductPublisher(projectRoot, builder).publish({
            candidate,
            explicitOutputRoot: process.env.NEURO_BOOK_OUTPUT_DIR?.trim() || undefined,
        });
        console.log([
            `Product Runtime Image published: ${published.path}`,
            `imageId=${published.manifest.imageId}`,
            `files=${published.manifest.inventory.files}`,
            `bytes=${published.manifest.inventory.bytes}`,
        ].join(" ") );
    });
}

/** 在锁定 Source snapshot 前生成 Product 所需的受控静态投影。 */
export async function prepareProductRuntimeSource(buildEnvironment: NodeJS.ProcessEnv): Promise<void> {
    await run("bun", [NUXT_CLI_ENTRY, "prepare", "--dotenv", ".env.product"], buildEnvironment);
    await run("bun", ["run", "generate"], buildEnvironment);
    await run("bun", ["scripts/build/prepare-system-assets.ts"], buildEnvironment);
}

/**
 * 执行正式构建与 measurement 共用的 raw Nuxt build 和 Product 后处理。
 * 输出路径只来自 Builder 分配的候选上下文，调用方不能把测量写入 `.output`。
 */
export async function buildProductRuntimePayload(
    context: ProductRuntimeBuildContext,
    buildEnvironment: NodeJS.ProcessEnv,
): Promise<void> {
    await run("bun", ["run", "nuxt:build:raw"], {
        ...buildEnvironment,
        NEURO_BOOK_OUTPUT_DIR: context.imageRoot,
        NEURO_BOOK_PRODUCT_IMAGE_ROOT: context.imageRoot,
        NEURO_BOOK_PRODUCT_SOURCE_DIGEST: context.sourceDigest,
    });
    await run("bun", ["scripts/build/patch-nitro-runtime-deps.mjs"], {
        ...buildEnvironment,
        NEURO_BOOK_OUTPUT_DIR: context.imageRoot,
        NEURO_BOOK_PRODUCT_SCRATCH_ROOT: context.scratchRoot,
    });
}

/**
 * 串行化整个 Product pipeline，包括会共享 `.nuxt` 与生成源码的 prepare/raw build。
 * 候选仍有自己的 lease；此处专门阻止两个 operation 同时读取共享 Developer Build State。
 */
export async function withProductBuildLease<T>(projectRoot: string, operation: () => Promise<T>): Promise<T> {
    const lockTarget = resolve(projectRoot, ".deploy", "product-runtime-builder");
    await mkdir(resolve(lockTarget, ".."), {recursive: true});
    await writeFile(lockTarget, "", {encoding: "utf8", flag: "a"});
    let release: (() => Promise<void>) | undefined;
    try {
        release = await acquireFileLock(lockTarget, {
            realpath: false,
            stale: 5 * 60 * 1000,
            update: 30 * 1000,
            retries: 0,
        });
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ELOCKED") {
            throw new Error("已有 Product build 正在使用共享 `.nuxt`/Source 生成态；拒绝并发构建。", {cause: error});
        }
        throw error;
    }
    try {
        return await operation();
    } finally {
        await release();
    }
}

/**
 * 为 Product 构建创建显式、跨 CI/本机一致的环境。
 *
 * 只透传进程启动和临时目录所需的 OS 变量；任意宿主 `NUXT_*`、`NITRO_*`、
 * `VITE_*` 或运行期 Secret 都不能静默改变同一 Source identity 的 payload。
 */
export function productBuildEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {};
    for (const [name, value] of Object.entries(source)) {
        if (value !== undefined && PRODUCT_BUILD_PASSTHROUGH_ENVIRONMENT.has(name.toUpperCase())) {
            environment[name] = value;
        }
    }
    return {
        ...environment,
        LANG: "C",
        LC_ALL: "C",
        NITRO_PRESET: "node-server",
        NODE_ENV: "production",
        NUXT_DEVTOOLS: "0",
        NUXT_TELEMETRY_DISABLED: "1",
        // 不透传宿主 NODE_OPTIONS；固定 heap，同时拒绝 --require/--loader 等构建注入。
        NODE_OPTIONS: PRODUCT_NODE_OPTIONS,
        SOURCE_DATE_EPOCH: PRODUCT_SOURCE_DATE_EPOCH,
        TZ: "UTC",
    };
}

/** 返回当前平台经过真实构建审查的 owner baseline；未知平台禁止借用其他平台数字。 */
export function productRuntimeOwnerBaselines(platform: ProductPlatform): readonly ProductRuntimeOwnerBaseline[] {
    return productRuntimeBuildPolicy(platform).budget.ownerBaselines;
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, {cwd: process.cwd(), env, stdio: "inherit", windowsHide: true});
        child.on("error", rejectPromise);
        child.on("exit", (code, signal) => {
            if (signal) {
                rejectPromise(new Error(`${command} 被信号中断：${signal}`));
            } else if (code !== 0) {
                rejectPromise(new Error(`${command} ${args.join(" ")} 退出码 ${code ?? 1}`));
            } else {
                resolvePromise();
            }
        });
    });
}

if (import.meta.main) {
    await buildProductRuntimeImage();
}
