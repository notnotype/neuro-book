import {readFile, readdir} from "node:fs/promises";
import {resolve} from "node:path";
import {
    readProfileArtifactManifest,
    resolveProfileArtifactPathContext,
    validateProfileArtifact,
    type ProfileArtifactValidation,
} from "../server/agent/profiles/profile-artifact-compiler";
import {
    readVariableDefinitionManifest,
    resolveVariableDefinitionArtifactPathContext,
    validateVariableDefinitionArtifact,
    type VariableDefinitionValidation,
} from "../server/agent/variables/definition-artifact";

export {compileProfileArtifacts, resolveProfileArtifactPathContext} from "../server/agent/profiles/profile-artifact-compiler";
export {compileVariableDefinitions, resolveVariableDefinitionArtifactPathContext} from "../server/agent/variables/definition-artifact";
export {SystemAssetsProjection} from "../server/workspace-files/system-assets-projection";

export {PROFILE_VARIABLE_IDE_TYPES_FILE} from "../server/agent/variables/generated-types";
export {generateProfileVariableIdeTypes} from "../server/agent/variables/ide-types";
export {APPLICATION_STATE_MIGRATION_STEP_IDS} from "../server/runtime/application-state-migration/catalog";

/** 验证最终 Product system artifacts 只依赖 Product runtime 自身。 */
export async function assertProductSystemArtifactContract(
    applicationRoot = process.cwd(),
    imageRoot?: string,
): Promise<void> {
    const root = resolve(applicationRoot);
    const productImageRoot = resolve(imageRoot ?? resolve(root, ".output"));
    const agentRoot = resolve(productImageRoot, "server", "assets", "workspace", ".nbook", "agent");
    const previousProductBuild = process.env.NEURO_BOOK_PRODUCT_BUILD;
    const previousImageRoot = process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT;
    process.env.NEURO_BOOK_PRODUCT_BUILD = "1";
    process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT = productImageRoot;
    try {
        const profileRoot = resolve(agentRoot, "profiles");
        const profileArtifactPathContext = await resolveProfileArtifactPathContext(
            profileRoot,
            "assets/workspace/.nbook/agent/profiles",
            root,
        );
        const profileManifest = await readProfileArtifactManifest(profileRoot, profileArtifactPathContext);
        if (profileManifest.profiles.length === 0) {
            throw new Error("Product system profile manifest 为空。请重新执行完整 Product build。");
        }
        if (profileManifest.profilesRoot !== "assets/workspace/.nbook/agent/profiles") {
            throw new Error(`Product system profile manifest root错误：${profileManifest.profilesRoot}`);
        }
        for (const profile of profileManifest.profiles) {
            assertProductDependencies(profile.fileName, profile.dependencies);
            const validation = await validateProfileArtifact(profileRoot, profile, profileArtifactPathContext, {requireTypeArtifact: true});
            if (!validation.fresh) {
                throw new Error(`Product system profile artifact 无效：${profile.fileName}（${validationDetail(validation)}）`);
            }
        }

        const variableRoot = resolve(agentRoot, "variables");
        const variableArtifactPathContext = await resolveVariableDefinitionArtifactPathContext(
            variableRoot,
            "assets/workspace/.nbook/agent/variables",
            root,
        );
        const variableManifest = await readVariableDefinitionManifest(variableRoot, variableArtifactPathContext);
        if (variableManifest.definitions.length === 0) {
            throw new Error("Product system variable definition manifest 为空。请重新执行完整 Product build。");
        }
        if (variableManifest.definitionsRoot !== "assets/workspace/.nbook/agent/variables") {
            throw new Error(`Product system variable definition manifest root错误：${variableManifest.definitionsRoot}`);
        }
        for (const definition of variableManifest.definitions) {
            assertProductDependencies(definition.fileName, definition.dependencies);
            const validation = await validateVariableDefinitionArtifact(variableRoot, definition, variableArtifactPathContext, {requireTypeArtifact: true});
            if (!validation.fresh) {
                throw new Error(`Product system variable definition artifact 无效：${definition.fileName}（${validationDetail(validation)}）`);
            }
        }
        await assertProductSystemArtifactModulePaths(agentRoot, [root, productImageRoot]);
    } finally {
        if (previousProductBuild === undefined) delete process.env.NEURO_BOOK_PRODUCT_BUILD;
        else process.env.NEURO_BOOK_PRODUCT_BUILD = previousProductBuild;
        if (previousImageRoot === undefined) delete process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT;
        else process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT = previousImageRoot;
    }
}

export async function assertProductSystemArtifactModulePaths(
    artifactRoot: string,
    forbiddenRoots: readonly string[] = [],
): Promise<void> {
    const files = await listMjsFiles(resolve(artifactRoot));
    const physicalPathPattern = /(?:[a-z]:[\\/]|file:\/\/\/)[^"'`\r\n]*?(?:[\\/]node_modules[\\/](?:\.bun|\.pnpm)|[\\/]\.bun[\\/]|[\\/]\.pnpm[\\/])/iu;
    for (const filePath of files) {
        const source = await readFile(filePath, "utf8");
        const root = forbiddenRoots.find((value) => containsSourceRootDescendant(source, value));
        if (root || physicalPathPattern.test(source) || source.includes("file:///_entry.js")) {
            throw new Error(`Product system artifact 泄漏构建机或包管理器物理路径：${filePath}`);
        }
    }
}

async function listMjsFiles(root: string): Promise<string[]> {
    const files: string[] = [];
    const walk = async (directory: string): Promise<void> => {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const filePath = resolve(directory, entry.name);
            if (entry.isDirectory()) await walk(filePath);
            else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(filePath);
        }
    };
    await walk(root);
    return files.sort();
}

function assertProductDependencies(label: string, dependencies: Array<{path: string}>): void {
    const offender = dependencies.find((dependency) => !dependency.path.startsWith(".output/server/"));
    if (offender) throw new Error(`Product system artifact 依赖越过 .output/server：${label} -> ${offender.path}`);
}

function validationDetail(validation: ProfileArtifactValidation | VariableDefinitionValidation): string {
    if (validation.dependency) return `${validation.reason}: ${validation.dependency.path}`;
    return validation.reason ?? "unknown";
}

function containsSourceRootDescendant(source: string, root: string): boolean {
    const normalizedSource = source.replaceAll("\\", "/").toLowerCase();
    const normalizedRoot = normalizeForbiddenRoot(root);
    const needle = `${normalizedRoot}/`;
    let offset = normalizedSource.indexOf(needle);
    while (offset >= 0) {
        const previous = offset === 0 ? "" : normalizedSource[offset - 1]!;
        if (!/[a-z0-9_]/u.test(previous)) {
            return true;
        }
        offset = normalizedSource.indexOf(needle, offset + 1);
    }
    return false;
}

function normalizeForbiddenRoot(root: string): string {
    const normalizedInput = root.replaceAll("\\", "/");
    const resolved = normalizedInput.startsWith("/")
        ? normalizedInput
        : resolve(root).replaceAll("\\", "/");
    return resolved.toLowerCase().replace(/\/+$/u, "");
}
