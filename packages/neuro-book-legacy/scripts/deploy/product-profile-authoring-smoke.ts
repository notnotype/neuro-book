#!/usr/bin/env bun
import {randomUUID} from "node:crypto";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {
    compileProfileArtifacts,
    createProfileArtifactPathContext,
    validateProfileArtifact,
} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {createAuthoringCacheLease} from "nbook/server/runtime/authoring-cache";
import {importRuntimeArtifact} from "nbook/server/utils/runtime-artifact-import";
import {resolveRuntimeArtifactCompilerContext} from "nbook/server/utils/runtime-artifact-compiler-context";

type AuthoringDependencyManifest = {
    schema: "nbook.product-authoring-dependencies/v2";
    dependencies: Array<{
        name: string;
        version: string;
        kind: "runtime" | "types";
    }>;
    instances: Array<{
        name: string;
        version: string;
        kind: "runtime" | "types";
        location: string;
        topLevel: boolean;
    }>;
};

type CompiledProfileModule = {
    default?: {
        manifest?: {key?: string};
        initialSchema?: {
            type?: string;
            properties?: {message?: {type?: string}};
        };
    };
};

const runtimePaths = runtimePathsFromEnv();
const compilerContext = await resolveRuntimeArtifactCompilerContext(runtimePaths.applicationRoot);
if (!compilerContext.productRuntime) {
    throw new Error("Profile authoring smoke 必须在自包含 Product Runtime Image 中运行。");
}

const dependencies = parseAuthoringDependencies(JSON.parse(
    await readFile(join(dirname(compilerContext.compilerPackageRoot), "authoring-dependencies.json"), "utf8"),
) as unknown);
const typebox = dependencies.dependencies.find((dependency) => dependency.name === "typebox");
if (!typebox || typebox.kind !== "runtime") {
    throw new Error("Product Authoring Kit 没有登记 typebox runtime implementation。");
}
const dependencyNames = dependencies.dependencies.map((dependency) => dependency.name).sort();
if (JSON.stringify(dependencyNames) !== JSON.stringify(["@types/node", "typebox", "undici-types"])) {
    throw new Error(`Product Authoring Kit dependency closure 超出批准集合：${dependencyNames.join(", ")}`);
}

const lease = await createAuthoringCacheLease(runtimePaths.cacheRoot, "profile-authoring-check");
const runRoot = lease.root;
const profileRoot = join(runRoot, "profiles");
const fileName = "product.authoring-smoke.profile.ts";

try {
    await mkdir(profileRoot, {recursive: true});
    await writeFile(join(profileRoot, fileName), `
import {Type, defineAgentProfile, toolset} from "nbook/profile-sdk";

const InitialSchema = Type.Object({message: Type.String()});

export default defineAgentProfile({
    manifest: {key: "product.authoring-smoke", name: "Product Authoring Smoke"},
    initialSchema: InitialSchema,
    tools: toolset(),
    context() { return []; },
});
`, "utf8");
    const artifactPathContext = createProfileArtifactPathContext(
        profileRoot,
        "cache/release-checks/profile-authoring",
        compilerContext,
    );
    const result = await compileProfileArtifacts({
        profileRoot,
        fileName,
        artifactPathContext,
        stagingRoot: join(runRoot, "staging"),
        skipFresh: true,
        orphanBudgetPolicy: "product",
    });
    await lease.verifyForConsumption();
    const item = result.compiled[0];
    if (result.compiled.length !== 1 || !item) {
        const manifestEntry = result.manifest.entries[0];
        const issue = manifestEntry?.status === "compile_failed"
            ? manifestEntry.issues[0]?.message ?? "没有生成 artifact"
            : "没有生成 artifact";
        throw new Error(`Profile authoring smoke 编译失败：${issue}`);
    }
    const validation = await validateProfileArtifact(profileRoot, item, artifactPathContext);
    if (!validation.fresh) {
        throw new Error(`Profile authoring smoke artifact 无效：${validation.reason}`);
    }

    const artifactPath = join(profileRoot, ".compiled", ...item.artifactFileName.split("/"));
    const compiled = await importRuntimeArtifact<CompiledProfileModule>(artifactPath, {
        query: {smoke: randomUUID()},
    });
    if (compiled.default?.manifest?.key !== "product.authoring-smoke"
        || compiled.default.initialSchema?.type !== "object"
        || compiled.default.initialSchema.properties?.message?.type !== "string") {
        throw new Error("Profile authoring smoke 没有得到预期的 TypeBox schema。");
    }

    console.log(JSON.stringify({
        ok: true,
        typeboxVersion: typebox.version,
        artifactBytes: item.artifactBytes,
        typeBytes: item.typeBytes,
    }, null, 2));
} finally {
    await lease.close();
}

/** 严格收窄 Product Authoring Kit 的构建期依赖清单。 */
function parseAuthoringDependencies(value: unknown): AuthoringDependencyManifest {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Product Authoring Kit dependency manifest 必须是对象。");
    }
    const manifest = value as Partial<AuthoringDependencyManifest>;
    if (manifest.schema !== "nbook.product-authoring-dependencies/v2"
        || !Array.isArray(manifest.dependencies) || !Array.isArray(manifest.instances)) {
        throw new Error("Product Authoring Kit dependency manifest schema 不受支持。");
    }
    for (const dependency of manifest.dependencies) {
        if (!dependency || typeof dependency.name !== "string" || typeof dependency.version !== "string"
            || (dependency.kind !== "runtime" && dependency.kind !== "types")) {
            throw new Error("Product Authoring Kit dependency manifest 含无效条目。");
        }
    }
    for (const instance of manifest.instances) {
        if (!instance || typeof instance.name !== "string" || typeof instance.version !== "string"
            || (instance.kind !== "runtime" && instance.kind !== "types")
            || typeof instance.location !== "string" || instance.location.includes("..")
            || typeof instance.topLevel !== "boolean") {
            throw new Error("Product Authoring Kit dependency manifest 含无效物理实例。");
        }
    }
    return manifest as AuthoringDependencyManifest;
}
