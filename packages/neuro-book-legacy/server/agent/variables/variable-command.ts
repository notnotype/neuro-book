import fs from "node:fs";
import fsp from "node:fs/promises";
import {createRequire} from "node:module";
import path from "node:path";
import process from "node:process";
import type * as TypeScript from "typescript";
import {compileVariableDefinitions, loadCompiledVariableDefinitions, readVariableDefinitionManifest, validateVariableDefinitionArtifact} from "nbook/server/agent/variables/definition-artifact";
import {resolveVariableDefinitionArtifactPathContext} from "nbook/server/agent/variables/definition-artifact";
import type {VariableNamespace} from "nbook/server/agent/variables/types";
import {resolveRuntimeArtifactCompilerContext} from "nbook/server/utils/runtime-artifact-compiler-context";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {resolveApplicationRoot} from "nbook/server/workspace-files/system-workspace-assets";
import {validateRuntimeArtifactAuthoring} from "nbook/server/utils/runtime-artifact-authoring-interface";

const runtimeRequire = createRequire(import.meta.url);
const ts = runtimeRequire("typescript") as typeof TypeScript;

type DefinitionCommand = "status" | "check" | "compile";

type CliOptions = {
    command: DefinitionCommand;
    scope?: "global" | "project";
    projectRoot?: string;
};

type DefinitionTarget = {
    root: string;
    label: string;
    namespace: Extract<VariableNamespace, "global" | "project">;
    artifactPathContext: Awaited<ReturnType<typeof resolveVariableDefinitionArtifactPathContext>>;
};

const APPLICATION_ROOT = resolveApplicationRoot();
process.chdir(APPLICATION_ROOT);

await main();

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    if (!options) {
        process.exitCode = 1;
        return;
    }
    try {
        switch (options.command) {
            case "status":
                await runStatus(options);
                return;
            case "check":
                await runCheck(options);
                return;
            case "compile":
                await runCompile(options);
                return;
        }
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}

function parseArgs(args: string[]): CliOptions | null {
    if (args.shift() !== "definition") {
        printUsage();
        return null;
    }
    const command = args.shift() as DefinitionCommand | undefined;
    if (!command || !["status", "check", "compile"].includes(command)) {
        printUsage();
        return null;
    }
    const options: CliOptions = {
        command,
    };
    while (args.length > 0) {
        const arg = args.shift();
        if (!arg) {
            continue;
        }
        if (arg === "--help" || arg === "-h") {
            printUsage();
            return null;
        }
        if (arg === "--global") {
            if (options.scope) throw new Error("只能选择一个 variable definition scope。");
            options.scope = "global";
            continue;
        }
        if (arg === "--project") {
            if (options.scope) throw new Error("只能选择一个 variable definition scope。");
            options.scope = "project";
            const value = args.shift();
            if (!value) {
                throw new Error("--project 需要单段 Project Root。");
            }
            options.projectRoot = projectWorkspaceRef(value).projectRoot;
            continue;
        }
        throw new Error(`未知参数：${arg}`);
    }
    if (!options.scope) throw new Error("variable definition 必须显式选择 --global 或 --project <projectRoot>。");
    return options;
}

async function runStatus(options: CliOptions): Promise<void> {
    const target = await definitionTarget(options);
    const files = await findDefinitionFiles(target.root);
    if (files.length === 0) {
        console.log("variable definition status: no source");
        console.log(`definition root: ${target.label}`);
        return;
    }
    const manifest = await readVariableDefinitionManifest(target.root, target.artifactPathContext);
    let failed = false;
    for (const fileName of files) {
        const item = manifest.definitions.find((entry) => entry.fileName === fileName);
        if (!item) {
            console.log(`${fileName}: not_compiled`);
            failed = true;
            continue;
        }
        const validation = await validateVariableDefinitionArtifact(target.root, item, target.artifactPathContext);
        console.log(`${fileName}: ${validation.fresh ? "loaded" : "compile_stale"}`);
        console.log(`  artifact: ${item.artifactFileName}`);
        if (item.typeFileName) {
            console.log(`  types: ${item.typeFileName}`);
        } else {
            console.log("  types: missing");
        }
        for (const diagnostic of item.typeDiagnostics ?? []) {
            console.log(`  [${diagnostic.severity}] ${diagnostic.message}`);
        }
        if (!validation.fresh) {
            console.log(`  reason: ${validation.reason}`);
            failed = true;
        }
    }
    if (failed) process.exitCode = 1;
}

async function runCheck(options: CliOptions): Promise<void> {
    const target = await definitionTarget(options);
    const files = await findDefinitionFiles(target.root);
    for (const fileName of files) {
        if (!await runTypecheck(path.join(target.root, fileName))) {
            process.exitCode = 1;
            return;
        }
    }
    const loaded = await loadCompiledVariableDefinitions({
        definitionRoot: target.root,
        artifactPathContext: target.artifactPathContext,
        namespace: target.namespace,
    });
    for (const issue of loaded.issues) {
        console.log(`[${issue.code}] ${issue.message}`);
    }
    if (loaded.issues.some((issue) => issue.code === "not_compiled" || issue.code === "compile_stale" || issue.code === "compiled_load_failed")) {
        process.exitCode = 1;
        return;
    }
    console.log(`variable definition check passed: ${loaded.definitions.length} loaded`);
}

async function runCompile(options: CliOptions): Promise<void> {
    const target = await definitionTarget(options);
    const files = await findDefinitionFiles(target.root);
    for (const fileName of files) {
        if (!await runTypecheck(path.join(target.root, fileName))) {
            process.exitCode = 1;
            return;
        }
    }
    const manifest = await compileVariableDefinitions({
        definitionRoot: target.root,
        artifactPathContext: target.artifactPathContext,
    });
    console.log(`variable definition compile wrote ${manifest.definitions.length} artifact(s)`);
    for (const item of manifest.definitions) {
        console.log(`- ${item.fileName}: ${item.registeredPaths.join(", ") || "no registered variables"} -> .compiled/${item.artifactFileName}`);
        if (item.typeFileName) {
            console.log(`  types: .compiled/${item.typeFileName}`);
        }
        for (const diagnostic of item.typeDiagnostics ?? []) {
            console.log(`  [${diagnostic.severity}] ${diagnostic.message}`);
        }
    }
}

async function definitionTarget(options: CliOptions): Promise<DefinitionTarget> {
    const runtimePaths = runtimePathsFromEnv(APPLICATION_ROOT);
    const root = options.scope === "project"
        ? path.join(runtimePaths.workspaceRoot, options.projectRoot!, ".nbook", "agent", "variables")
        : path.join(runtimePaths.userNbookRoot, "agent", "variables");
    const label = options.scope === "project"
        ? `workspace/${options.projectRoot}/.nbook/agent/variables`
        : "workspace/.nbook/agent/variables";
    return {
        root,
        label,
        namespace: options.scope === "project" ? "project" : "global",
        artifactPathContext: await resolveVariableDefinitionArtifactPathContext(root, label, runtimePaths.applicationRoot),
    };
}


async function findDefinitionFiles(root: string): Promise<string[]> {
    const entries = await fsp.readdir(root, {withFileTypes: true}).catch(() => []);
    return entries
        .filter((entry) => entry.isFile() && /^definitions\.(tsx|ts|mjs|js)$/.test(entry.name))
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));
}

async function runTypecheck(filePath: string): Promise<boolean> {
    if (!/\.(tsx|ts)$/.test(filePath) || !fs.existsSync(filePath)) {
        return true;
    }
    await validateRuntimeArtifactAuthoring({
        kind: "variable",
        root: path.dirname(filePath),
        entry: filePath,
        allowedSdkSpecifiers: ["nbook/variable-sdk"],
    });
    const configPath = (await resolveRuntimeArtifactCompilerContext(APPLICATION_ROOT)).tsconfigPath;
    if (!configPath) {
        console.error("未找到 tsconfig.json");
        return false;
    }
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error) {
        printDiagnostics([configFile.error]);
        return false;
    }
    const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath), undefined, configPath);
    const program = ts.createProgram({
        rootNames: [filePath, ...config.fileNames.filter((item) => item.endsWith(".d.ts"))],
        options: {
            ...config.options,
            noEmit: true,
            skipLibCheck: true,
        },
    });
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) {
        console.error(`TypeScript Program 未载入 variable definition：${filePath}`);
        return false;
    }
    const diagnostics = ts.getPreEmitDiagnostics(program, sourceFile);
    if (diagnostics.length > 0) {
        printDiagnostics(diagnostics);
        return false;
    }
    return true;
}

function printDiagnostics(diagnostics: readonly TypeScript.Diagnostic[]): void {
    const host: TypeScript.FormatDiagnosticsHost = {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => process.cwd(),
        getNewLine: () => ts.sys.newLine,
    };
    console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, host));
}

function printUsage(): void {
    console.error("用法：variable definition <status|check|compile> (--global | --project <projectRoot>)");
    console.error("示例：variable definition compile --global");
    console.error("示例：variable definition status --project demo");
}
