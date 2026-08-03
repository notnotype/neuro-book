import {join} from "node:path";

import {describe, expect, it} from "vitest";
import {createProductRuntimeEnvironment} from "nbook/shared/product-runtime-environment";

describe("Product runtime environment", () => {
    it("State 环境覆盖普通配置，但不能覆盖受管 root 与工具路径", () => {
        const applicationRoot = join("C:", "NeuroBook");
        const stateRoot = join("C:", "NeuroBookData", "data");
        const cacheRoot = join("C:", "NeuroBookData", "cache");
        const environment = createProductRuntimeEnvironment({
            applicationRoot,
            stateRoot,
            cacheRoot,
            development: false,
            inheritedEnvironment: {API_ORIGIN: "inherited", HOST: "inherited-host", NODE_PATH: "outside-node-path"},
            stateEnvironment: {
                API_ORIGIN: "state",
                NEURO_BOOK_STATE_ROOT: "outside-state",
                NEURO_BOOK_CACHE_ROOT: "outside-cache",
                NEURO_BOOK_LOG_DIR: "outside-logs",
                LLMLINT_HOME: "outside-llmlint",
                LLMLINT_CACHE_DIR: "outside-llmlint-cache",
                BUN_INSTALL_CACHE_DIR: "outside-bun",
                NODE_PATH: "state-node-path",
            },
            host: "127.0.0.1",
            runtimeExecutable: "bun-managed",
        });

        expect(environment).toMatchObject({
            API_ORIGIN: "state",
            NODE_ENV: "production",
            HOST: "127.0.0.1",
            NITRO_HOST: "127.0.0.1",
            NEURO_BOOK_APPLICATION_ROOT: applicationRoot,
            NEURO_BOOK_PRODUCT_IMAGE_ROOT: join(applicationRoot, ".output"),
            NEURO_BOOK_STATE_ROOT: stateRoot,
            NEURO_BOOK_CACHE_ROOT: cacheRoot,
            NEURO_BOOK_LOG_DIR: join(stateRoot, "logs"),
            LLMLINT_HOME: join(stateRoot, "tool-state", "llmlint"),
            LLMLINT_CACHE_DIR: join(cacheRoot, "llmlint"),
            BUN_INSTALL_CACHE_DIR: join(cacheRoot, "bun", "install"),
            BUN: "bun-managed",
        });
        expect(environment.NODE_PATH).toBeUndefined();
    });

    it("未指定 host 时保留 State 环境的容器监听配置", () => {
        const environment = createProductRuntimeEnvironment({
            applicationRoot: "/app",
            productImageRoot: "/app/.output",
            stateRoot: "/app/data",
            cacheRoot: "/app/cache",
            development: false,
            inheritedEnvironment: {HOST: "inherited-host"},
            stateEnvironment: {HOST: "0.0.0.0", NITRO_HOST: "0.0.0.0"},
        });

        expect(environment.HOST).toBe("0.0.0.0");
        expect(environment.NITRO_HOST).toBe("0.0.0.0");
    });

    it("Source Dev 不继承 Product image identity", () => {
        const environment = createProductRuntimeEnvironment({
            applicationRoot: "C:/NeuroBook",
            productImageRoot: "C:/NeuroBook/.output",
            stateRoot: "C:/NeuroBookData/data",
            cacheRoot: "C:/NeuroBookData/cache",
            development: true,
            inheritedEnvironment: {NEURO_BOOK_PRODUCT_IMAGE_ROOT: "C:/stale-product"},
            stateEnvironment: {NEURO_BOOK_PRODUCT_IMAGE_ROOT: "C:/state-product"},
        });

        expect(environment.NEURO_BOOK_PRODUCT_IMAGE_ROOT).toBeUndefined();
    });
});
