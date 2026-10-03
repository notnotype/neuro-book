import {builtinModules, createRequire} from "node:module";
import {isAbsolute} from "node:path";
import {pathToFileURL} from "node:url";
import type {Plugin} from "esbuild";
import {
    resolveRuntimeArtifactNbookPath,
    type RuntimeArtifactCompilerContext,
} from "nbook/server/utils/runtime-artifact-compiler-context";

/**
 * 为 Profile/Variable artifact 提供一致的 SDK 与批准依赖解析。
 *
 * `nbook/**` 固定投影到当前编译上下文；Runtime builtin 保持 external；其余 bare
 * package 必须从 compilerPackageRoot 解析后进入 bundle，禁止从 artifact 所在目录向上查找。
 */
export function runtimeArtifactBundlePlugin(
    context: RuntimeArtifactCompilerContext,
    name: string,
): Plugin {
    const nodeModuleNames = new Set([
        ...builtinModules,
        ...builtinModules.map((moduleName) => `node:${moduleName}`),
    ]);
    const requireFromCompiler = createRequire(pathToFileURL(context.compilerPackageRoot));
    return {
        name,
        setup(buildApi) {
            buildApi.onResolve({filter: /^(nbook|neuro_book)\//}, (args) => ({
                path: resolveRuntimeArtifactNbookPath(
                    context,
                    args.path.replace(/^(nbook|neuro_book)\//, ""),
                ),
            }));
            buildApi.onResolve({filter: /^[^./].*/}, (args) => {
                if (nodeModuleNames.has(args.path) || args.path === "bun" || args.path.startsWith("bun:")) {
                    return {path: args.path, external: true};
                }
                try {
                    const resolved = requireFromCompiler.resolve(args.path);
                    return isAbsolute(resolved)
                        ? {path: resolved}
                        : {path: args.path, external: true};
                } catch {
                    return {
                        errors: [{
                            text: `Authoring Kit 未登记依赖：${args.path}`,
                        }],
                    };
                }
            });
        },
    };
}
