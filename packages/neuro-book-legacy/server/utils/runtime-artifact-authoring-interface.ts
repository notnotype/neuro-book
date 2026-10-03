import {builtinModules} from "node:module";
import {createRequire} from "node:module";
import {isAbsolute, dirname, extname, relative, resolve, sep} from "node:path";
import {readFile, realpath, stat} from "node:fs/promises";
import type {Metafile} from "esbuild";
import type * as TypeScript from "typescript";

// TypeScript 是 Product package island；顶层 ESM import 会让 Nitro 解析完整 compiler 并耗尽构建内存。
const runtimeRequire = createRequire(import.meta.url);
const ts = runtimeRequire("typescript") as typeof TypeScript;

export type RuntimeArtifactAuthoringKind = "profile" | "variable";

export type RuntimeArtifactAuthoringInput = Readonly<{
    kind: RuntimeArtifactAuthoringKind;
    root: string;
    entry: string;
    allowedSdkSpecifiers: readonly string[];
}>;

/** Runtime Artifact Authoring Interface 验证成功后返回的完整作者源码图。 */
export type RuntimeArtifactAuthoringGraph = Readonly<{
    root: string;
    entry: string;
    files: readonly string[];
}>;

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"] as const;
const RUNTIME_BUILTINS = new Set([
    ...builtinModules,
    ...builtinModules.map((moduleName) => `node:${moduleName}`),
    "bun",
]);

/**
 * 验证作者拥有的完整源码图。
 *
 * Interface 只允许登记 SDK、Runtime builtin 和留在同一 authoring root 的相对模块；
 * 所有相对模块都会按 realpath 递归验证，不能通过 helper 或 symlink 绕开约束。
 */
export async function validateRuntimeArtifactAuthoring(
    input: RuntimeArtifactAuthoringInput,
): Promise<RuntimeArtifactAuthoringGraph> {
    const root = resolve(input.root);
    const canonicalRoot = await realpath(root);
    const entry = await canonicalAuthoringFile(canonicalRoot, resolve(input.entry), "entry");
    const allowedSdkSpecifiers = new Set(input.allowedSdkSpecifiers);
    const visited = new Set<string>();
    const pending = [entry];

    while (pending.length > 0) {
        const filePath = pending.pop()!;
        if (visited.has(filePath)) continue;
        visited.add(filePath);
        const source = await readFile(filePath, "utf8");
        const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind(filePath));
        const references = moduleReferences(sourceFile);
        const violations: string[] = [];

        for (const reference of references) {
            if (!reference.literal) {
                violations.push(`${reference.form} 必须使用字符串字面量`);
                continue;
            }
            const specifier = reference.specifier;
            if (allowedSdkSpecifiers.has(specifier) || runtimeBuiltin(specifier)) continue;
            if (isAbsolute(specifier) || /^[A-Za-z]:[\\/]/u.test(specifier)) {
                violations.push(specifier);
                continue;
            }
            if (!specifier.startsWith(".") && !specifier.startsWith(".\\")) {
                violations.push(specifier);
                continue;
            }
            const resolvedModule = await resolveRelativeAuthoringModule(filePath, specifier);
            const canonicalModule = await canonicalAuthoringFile(canonicalRoot, resolvedModule, specifier);
            pending.push(canonicalModule);
        }

        if (violations.length > 0) {
            throw authoringViolation(input.kind, root, filePath, violations);
        }
    }

    return Object.freeze({
        root: canonicalRoot,
        entry,
        files: Object.freeze([...visited].sort((left, right) => left.localeCompare(right))),
    });
}

type ModuleReference = Readonly<{
    form: "import" | "import type" | "export" | "import-equals" | "dynamic import" | "require" | "reference path" | "reference types";
    literal: boolean;
    specifier: string;
}>;

/** 从 TypeScript AST 收集所有会形成模块依赖的语法。 */
function moduleReferences(sourceFile: TypeScript.SourceFile): ModuleReference[] {
    const references: ModuleReference[] = [
        ...sourceFile.referencedFiles.map((reference) => ({
            form: "reference path" as const,
            literal: true,
            specifier: reference.fileName,
        })),
        ...sourceFile.typeReferenceDirectives.map((reference) => ({
            form: "reference types" as const,
            literal: true,
            specifier: reference.fileName,
        })),
    ];
    const addLiteral = (form: ModuleReference["form"], expression: TypeScript.Expression): void => {
        if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
            references.push({form, literal: true, specifier: expression.text});
        } else {
            references.push({form, literal: false, specifier: expression.getText(sourceFile)});
        }
    };
    const visit = (node: TypeScript.Node): void => {
        if (ts.isImportDeclaration(node)) {
            addLiteral("import", node.moduleSpecifier);
        } else if (ts.isImportTypeNode(node)) {
            if (ts.isLiteralTypeNode(node.argument)) {
                addLiteral("import type", node.argument.literal);
            } else {
                references.push({form: "import type", literal: false, specifier: node.argument.getText(sourceFile)});
            }
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
            addLiteral("export", node.moduleSpecifier);
        } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
            && node.moduleReference.expression) {
            addLiteral("import-equals", node.moduleReference.expression);
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            if (node.arguments.length !== 1) {
                references.push({form: "dynamic import", literal: false, specifier: node.getText(sourceFile)});
            } else {
                addLiteral("dynamic import", node.arguments[0]!);
            }
        } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
            if (node.arguments.length !== 1) {
                references.push({form: "require", literal: false, specifier: node.getText(sourceFile)});
            } else {
                addLiteral("require", node.arguments[0]!);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return references;
}

/**
 * 复核 esbuild 最终输入没有在作者 root 内引入预检图之外的文件。
 *
 * SDK 与登记依赖位于 authoring root 外，由 Builder 投影合同负责；作者自己的 helper
 * 必须与 AST 预检得到的 canonical realpath 集合完全一致。
 */
export async function assertRuntimeArtifactAuthoringMetafile(
    graph: RuntimeArtifactAuthoringGraph,
    metafile: Metafile,
    workingDirectory: string,
): Promise<void> {
    const approved = new Set(graph.files);
    for (const inputPath of Object.keys(metafile.inputs)) {
        if (inputPath.startsWith("<")) continue;
        const physicalPath = resolve(workingDirectory, inputPath);
        const canonicalPath = await realpath(physicalPath).catch(() => null);
        if (!canonicalPath) {
            throw new Error(`Runtime Artifact Authoring metafile 输入不存在：${inputPath}`);
        }
        const authorRelative = relative(graph.root, canonicalPath);
        if (!outsideRoot(authorRelative) && !approved.has(canonicalPath)) {
            throw new Error(`Runtime Artifact Authoring metafile 引入了未登记作者模块：${authorRelative.split(sep).join("/")}`);
        }
    }
}

/** 解析相对模块，行为覆盖 esbuild/TypeScript authoring 源码的常用扩展名。 */
async function resolveRelativeAuthoringModule(importer: string, specifier: string): Promise<string> {
    const requested = resolve(dirname(importer), specifier);
    const candidates = moduleCandidates(requested);
    for (const candidate of candidates) {
        const info = await stat(candidate).catch(() => null);
        if (info?.isFile()) return candidate;
    }
    throw new Error(`Runtime Artifact Authoring Interface 无法解析相对模块：${specifier}（importer: ${importer}）`);
}

/** 建立扩展名与目录 index 候选，不读取 package exports 或任意 npm package。 */
function moduleCandidates(requested: string): string[] {
    const extension = extname(requested).toLowerCase();
    const candidates = [requested];
    if (!extension) {
        candidates.push(...SOURCE_EXTENSIONS.map((suffix) => `${requested}${suffix}`));
        candidates.push(...SOURCE_EXTENSIONS.map((suffix) => resolve(requested, `index${suffix}`)));
    } else if (extension === ".js") {
        candidates.push(`${requested.slice(0, -3)}.ts`, `${requested.slice(0, -3)}.tsx`);
    } else if (extension === ".mjs") {
        candidates.push(`${requested.slice(0, -4)}.mts`);
    } else if (extension === ".cjs") {
        candidates.push(`${requested.slice(0, -4)}.cts`);
    }
    return [...new Set(candidates)];
}

/** 将物理文件收窄到 canonical authoring root 内。 */
async function canonicalAuthoringFile(
    canonicalRoot: string,
    filePath: string,
    label: string,
): Promise<string> {
    const canonicalFile = await realpath(filePath).catch(() => {
        throw new Error(`Runtime Artifact Authoring Interface 文件不存在：${label}`);
    });
    const physicalRelative = relative(canonicalRoot, canonicalFile);
    if (outsideRoot(physicalRelative)) {
        throw new Error(`Runtime Artifact Authoring Interface realpath 越界：${label}`);
    }
    const info = await stat(canonicalFile);
    if (!info.isFile()) {
        throw new Error(`Runtime Artifact Authoring Interface 目标不是文件：${label}`);
    }
    return canonicalFile;
}

/** 判断 relative() 结果是否逃出指定 root。 */
function outsideRoot(relativePath: string): boolean {
    return relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
}

/** Runtime builtin 不进入作者拥有的相对源码图。 */
function runtimeBuiltin(specifier: string): boolean {
    return RUNTIME_BUILTINS.has(specifier) || specifier.startsWith("bun:");
}

/** 根据文件名选择 TypeScript parser 的 JSX/Module 模式。 */
function scriptKind(filePath: string): TypeScript.ScriptKind {
    if (/\.(tsx|jsx)$/iu.test(filePath)) return ts.ScriptKind.TSX;
    if (/\.(js|mjs|cjs)$/iu.test(filePath)) return ts.ScriptKind.JS;
    return ts.ScriptKind.TS;
}

/** 生成稳定、可定位到 helper 的 SDK-only 违规消息。 */
function authoringViolation(
    kind: RuntimeArtifactAuthoringKind,
    root: string,
    filePath: string,
    violations: readonly string[],
): Error {
    const label = kind === "profile" ? "Profile" : "Variable";
    const relativeFile = relative(root, filePath).split(sep).join("/");
    return new Error([
        `${label} SDK 违规：${relativeFile} 依赖了 Runtime Artifact Authoring Interface 之外的模块。`,
        ...[...new Set(violations)].sort().map((specifier) => `- ${specifier}`),
    ].join("\n"));
}
