import {existsSync, readFileSync, readdirSync} from "node:fs";
import {join, resolve} from "node:path";

export type WorkspacePackageCheck = {
    name: string;
    directory: string;
    commands: string;
};

// 与 workspace-packages.yml 的 owner 合同保持一致；commands 为包内逐行执行的验证命令。
export const WORKSPACE_PACKAGE_CHECKS: readonly WorkspacePackageCheck[] = [
    {
        name: "nb-history",
        directory: "packages/nb-history",
        commands: "bun run typecheck\nbun run test",
    },
    {
        name: "nb-workflow",
        directory: "packages/nb-workflow",
        commands: "bun run test",
    },
    {
        name: "nb-memory",
        directory: "packages/nb-memory",
        commands: "bun run typecheck\nbun run test",
    },
    {
        name: "nb-ui",
        directory: "packages/nb-ui",
        commands: "bun run test\nbun run typecheck\nbun run build:css\nbun run build",
    },
    {
        name: "neuro-agent-harness",
        directory: "packages/neuro-agent-harness",
        commands: "bun run verify\nbun run pack:smoke",
    },
    {
        name: "llmlint",
        directory: "packages/llmlint",
        commands: "bun run verify",
    },
];

export type WorkspacePackageSelection = {
    include: WorkspacePackageCheck[];
    runWebIsland: boolean;
};

type PackageManifest = {
    name?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
};

const SHARED_INPUT_FILES: Record<string, true> = {
    "package.json": true,
    "bun.lock": true,
    "bunfig.toml": true,
    ".github/workflows/workspace-packages.yml": true,
};

const SHARED_INPUT_PREFIXES: readonly string[] = [
    "packages/neuro-book-contracts/",
    "packages/neuro-book-test-support/",
];

const PACKAGES_ROOT = resolve(import.meta.dirname, "../../packages");

type DependencyGraph = {
    dirByName: ReadonlyMap<string, string>;
    consumersOf: ReadonlyMap<string, ReadonlySet<string>>;
};

let cachedGraph: DependencyGraph | null = null;

function isSharedInput(changedFile: string): boolean {
    if (SHARED_INPUT_FILES[changedFile] === true) {
        return true;
    }
    return SHARED_INPUT_PREFIXES.some((prefix) => changedFile.startsWith(prefix));
}

function loadDependencyGraph(): DependencyGraph {
    if (cachedGraph !== null) {
        return cachedGraph;
    }
    const dirents = readdirSync(PACKAGES_ROOT, {withFileTypes: true});
    const manifestByDir = new Map<string, PackageManifest>();
    const dirByName = new Map<string, string>();
    for (const dirent of dirents) {
        if (!dirent.isDirectory()) {
            continue;
        }
        const manifestPath = join(PACKAGES_ROOT, dirent.name, "package.json");
        if (!existsSync(manifestPath)) {
            continue;
        }
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
        manifestByDir.set(dirent.name, manifest);
        if (typeof manifest.name === "string") {
            dirByName.set(manifest.name, dirent.name);
        }
    }
    const consumersOf = new Map<string, Set<string>>();
    for (const [directory, manifest] of manifestByDir) {
        for (const dependency of Object.keys({
            ...manifest.dependencies,
            ...manifest.devDependencies,
        })) {
            const dependencyDir = dirByName.get(dependency);
            if (dependencyDir === undefined) {
                continue;
            }
            let consumers = consumersOf.get(dependencyDir);
            if (consumers === undefined) {
                consumers = new Set<string>();
                consumersOf.set(dependencyDir, consumers);
            }
            consumers.add(directory);
        }
    }
    cachedGraph = {dirByName, consumersOf};
    return cachedGraph;
}

function expandConsumerClosure(
    direct: ReadonlySet<string>,
    consumersOf: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
    const selected = new Set(direct);
    let grew = true;
    while (grew) {
        grew = false;
        for (const packageName of [...selected]) {
            for (const consumer of consumersOf.get(packageName) ?? []) {
                if (!selected.has(consumer)) {
                    selected.add(consumer);
                    grew = true;
                }
            }
        }
    }
    return selected;
}

export function selectWorkspaceMatrix(
    changedFiles: readonly string[],
    eventName: string,
): WorkspacePackageSelection {
    const fullSelection: WorkspacePackageSelection = {
        include: [...WORKSPACE_PACKAGE_CHECKS],
        runWebIsland: true,
    };
    if (eventName !== "pull_request") {
        return fullSelection;
    }
    if (changedFiles.some((file) => isSharedInput(file))) {
        return fullSelection;
    }

    const rowNames = new Set(WORKSPACE_PACKAGE_CHECKS.map((check) => check.name));
    const direct = new Set<string>();
    for (const changedFile of changedFiles) {
        const matched = /^packages\/([^/]+)\//u.exec(changedFile);
        if (matched !== null && rowNames.has(matched[1]!)) {
            direct.add(matched[1]);
        }
    }
    if (direct.size === 0) {
        // 防御回退：workflow 级 paths 已保证存在可匹配输入，空选择视为全量。
        return fullSelection;
    }
    const {consumersOf} = loadDependencyGraph();
    const closed = expandConsumerClosure(direct, consumersOf);
    const include = WORKSPACE_PACKAGE_CHECKS.filter((check) => closed.has(check.name));
    const runWebIsland = closed.has("llmlint") || changedFiles.some((file) => file.startsWith("packages/llmlint/"));
    return {include, runWebIsland};
}

if (import.meta.main) {
    const eventName = process.env.EVENT_NAME ?? "";
    if (eventName === "") {
        throw new Error("Usage: set EVENT_NAME and pipe changed files into stdin");
    }
    const stdinText = await Bun.readableStreamToText(Bun.stdin.stream());
    const changedFiles = stdinText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "");
    const selection = selectWorkspaceMatrix(changedFiles, eventName);
    process.stdout.write(`matrix<<WORKSPACE_MATRIX\n${JSON.stringify({include: selection.include})}\nWORKSPACE_MATRIX\n`);
    process.stdout.write(`run_web_island=${selection.runWebIsland}\n`);
}
