import {fileURLToPath} from "node:url";

import {transform} from "esbuild";
import {defineConfig} from "vitest/config";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
    root: repositoryRoot,
    oxc: false,
    plugins: [{
        name: "product-shutdown-typescript",
        enforce: "pre",
        async transform(code, id) {
            const normalizedId = id.replaceAll("\\", "/");
            if (normalizedId.includes("/node_modules/") || !/\.(?:[cm]?ts|tsx)$/u.test(normalizedId) || normalizedId.endsWith(".d.ts")) return;
            const result = await transform(code, {
                loader: normalizedId.endsWith(".tsx") ? "tsx" : "ts",
                format: "esm",
                platform: "node",
                target: "es2022",
                sourcefile: id,
                sourcemap: "inline",
                tsconfigRaw: {compilerOptions: {module: "ESNext", moduleResolution: "Bundler", target: "ES2022"}},
            });
            return {code: result.code, map: result.map};
        },
    }],
    resolve: {alias: {nbook: repositoryRoot}},
    test: {environment: "node", include: ["shared/product-runtime-shutdown.test.ts"], globals: true},
});
