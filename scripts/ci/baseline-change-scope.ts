export type BaselineScopeSelection = {
    typecheck: boolean;
    tests: boolean;
};

const RUNTIME_PREFIXES: readonly string[] = [
    "packages/neuro-book/",
    "plugins/",
];

// Documentation-only subtrees inside the app package never affect typecheck or tests.
const NEURO_BOOK_DOC_PREFIXES: readonly string[] = [
    "packages/neuro-book/.agents/",
    "packages/neuro-book/docs/",
    "packages/neuro-book/assets/reference/",
];

const RUNTIME_FILES: ReadonlySet<string> = new Set([
    "package.json",
    "bun.lock",
    "bunfig.toml",
]);

function isRuntimeInput(changedFile: string): boolean {
    if (changedFile.startsWith("patches/")) {
        return true;
    }
    if (RUNTIME_FILES.has(changedFile)) {
        return true;
    }
    for (const docPrefix of NEURO_BOOK_DOC_PREFIXES) {
        if (changedFile.startsWith(docPrefix)) {
            return false;
        }
    }
    for (const runtimePrefix of RUNTIME_PREFIXES) {
        if (changedFile.startsWith(runtimePrefix)) {
            return true;
        }
    }
    return false;
}

export function selectBaselineScopes(
    changedFiles: readonly string[],
    eventName: string,
): BaselineScopeSelection {
    if (eventName !== "pull_request") {
        return {typecheck: true, tests: true};
    }
    const runtimeChanged = changedFiles.some((file) => isRuntimeInput(file));
    return {typecheck: runtimeChanged, tests: runtimeChanged};
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
    const selection = selectBaselineScopes(changedFiles, eventName);
    process.stdout.write(`typecheck=${selection.typecheck}\n`);
    process.stdout.write(`tests=${selection.tests}\n`);
}
