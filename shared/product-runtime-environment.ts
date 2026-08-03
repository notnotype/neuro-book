import {join} from "node:path";

/** Product 进程环境 Adapter 的显式输入。 */
export type ProductRuntimeEnvironmentInput = {
    applicationRoot: string;
    /** Product Runtime Image 的显式身份根；不传时由 Application Root 的固定 .output 派生。 */
    productImageRoot?: string;
    stateRoot: string;
    cacheRoot: string;
    development: boolean;
    inheritedEnvironment: NodeJS.ProcessEnv;
    stateEnvironment: NodeJS.ProcessEnv;
    /** Desktop 传入 loopback，Container 传入对外监听地址；缺省时保留 State 环境值。 */
    host?: string;
    /** 由受管 Runtime 启动时写入 BUN，普通测试 Adapter 可以省略。 */
    runtimeExecutable?: string;
};

/**
 * 合并 Product 环境，并在最后固定所有具有生命周期所有权的路径。
 *
 * State Root `.env` 可以覆盖普通应用配置，但不能把 Application、State、Cache、
 * 日志、llmlint 或 Bun cache 重定向到 Manager 未声明的位置。
 */
export function createProductRuntimeEnvironment(input: ProductRuntimeEnvironmentInput): NodeJS.ProcessEnv {
    const host = input.host?.trim();
    const environment: NodeJS.ProcessEnv = {
        ...input.inheritedEnvironment,
        ...input.stateEnvironment,
        NODE_ENV: input.development ? "development" : "production",
        ...(host ? {HOST: host, NITRO_HOST: host} : {}),
        NEURO_BOOK_APPLICATION_ROOT: input.applicationRoot,
        NEURO_BOOK_STATE_ROOT: input.stateRoot,
        NEURO_BOOK_CACHE_ROOT: input.cacheRoot,
        NEURO_BOOK_LOG_DIR: join(input.stateRoot, "logs"),
        LLMLINT_HOME: join(input.stateRoot, "tool-state", "llmlint"),
        LLMLINT_CACHE_DIR: join(input.cacheRoot, "llmlint"),
        BUN_INSTALL_CACHE_DIR: join(input.cacheRoot, "bun", "install"),
        ...(input.runtimeExecutable ? {BUN: input.runtimeExecutable} : {}),
    };
    if (input.development) {
        delete environment.NEURO_BOOK_PRODUCT_IMAGE_ROOT;
    } else {
        environment.NEURO_BOOK_PRODUCT_IMAGE_ROOT = input.productImageRoot ?? join(input.applicationRoot, ".output");
    }
    delete environment.NODE_PATH;
    return environment;
}
