#!/usr/bin/env bun
import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {
    compileVariableDefinitions,
    loadCompiledVariableDefinitions,
    resolveVariableDefinitionArtifactPathContext,
    validateVariableDefinitionArtifact,
} from "nbook/server/agent/variables/definition-artifact";
import {createAuthoringCacheLease} from "nbook/server/runtime/authoring-cache";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {resolveRuntimeArtifactCompilerContext} from "nbook/server/utils/runtime-artifact-compiler-context";

const runtimePaths = runtimePathsFromEnv();
const compiler = await resolveRuntimeArtifactCompilerContext(runtimePaths.applicationRoot);
if (!compiler.productRuntime) {
    throw new Error("Variable authoring smoke 必须在自包含 Product Runtime Image 中运行。");
}

const lease = await createAuthoringCacheLease(runtimePaths.cacheRoot, "variable-authoring-check");
const definitionRoot = join(lease.root, "definitions");
const artifactPathContext = await resolveVariableDefinitionArtifactPathContext(
    definitionRoot,
    "cache/authoring/variable-authoring-check",
    runtimePaths.applicationRoot,
);
try {
    await mkdir(definitionRoot, {recursive: true});
    await writeFile(join(definitionRoot, "definitions.ts"), `
import {Type, defineWorkspaceRootVariable} from "nbook/variable-sdk";

export default [defineWorkspaceRootVariable({
    key: "release-check",
    schema: Type.Object({message: Type.String()}),
    default: {message: "ok"},
})];
`, "utf8");
    const manifest = await compileVariableDefinitions({
        definitionRoot,
        artifactPathContext,
    });
    await lease.verifyForConsumption();
    const item = manifest.definitions[0];
    if (manifest.definitions.length !== 1 || !item) {
        throw new Error("Variable authoring smoke 没有生成唯一 artifact。");
    }
    if (item.registeredPaths.length !== 1 || item.registeredPaths[0] !== "global.release-check") {
        throw new Error(`Variable authoring smoke manifest 注册路径异常：${item.registeredPaths.join(", ") || "none"}`);
    }
    const validation = await validateVariableDefinitionArtifact(definitionRoot, item, artifactPathContext);
    if (!validation.fresh) {
        throw new Error(`Variable authoring smoke artifact 无效：${validation.reason}`);
    }
    const loaded = await loadCompiledVariableDefinitions({definitionRoot, artifactPathContext, namespace: "global"});
    const definition = loaded.definitions[0];
    if (loaded.issues.length > 0 || loaded.definitions.length !== 1
        || definition?.namespace !== "global" || definition.key !== "release-check") {
        const issues = loaded.issues.map((issue) => issue.message).join("; ") || "none";
        const paths = loaded.definitions.map((entry) => `${entry.namespace}.${entry.key}`).join(", ") || "none";
        throw new Error(`Variable authoring smoke 加载失败：issues=${issues}; definitions=${paths}`);
    }
    console.log(JSON.stringify({ok: true, path: `${definition.namespace}.${definition.key}`}, null, 2));
} finally {
    await lease.close();
}
