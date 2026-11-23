/**
 * 从发布声明读出公开面：每个公开名字的种类、稳定性标注、引到的其它公开名字与去注释的声明文字，供 `api-report.ts` 写报告。
 * 做法见 w00026 t48 的计划（第 4 稿）“API 报告”一节。
 *
 * 读的是 `build:package` 打出的 `.d.ts`，不是源码：入口声明只有导入与导出列表，声明都在共享块里、共享块的导出名是压缩名，
 * 所以名字一律经检查器解：`getExportsOfModule` 列出入口导出的名字，`getAliasedSymbol` 跟到真声明。组件（`.vue` 的缺省导出）
 * 这里只核标注，公开面由 `api-components.ts` 读源码给出。
 */

import ts from "typescript";

export const STABILITY_TAGS = ["stable", "experimental"] as const;
export type Stability = (typeof STABILITY_TAGS)[number];

export type SurfaceKind = "function" | "const" | "interface" | "type" | "class" | "enum" | "namespace" | "component";

/** 一个公开名字。`declarations` 是每一处声明去注释后的文字，按在文件里的先后。 */
export type SurfaceEntry = {
    readonly name: string;
    readonly kind: SurfaceKind;
    readonly stability: Stability | null;
    readonly deprecated: boolean;
    /** 声明里引到的其它公开名字（不含自己），按码元排序。 */
    readonly references: readonly string[];
    /** 声明里引到的、没有被任何入口导出的声明的名字，按码元排序。 */
    readonly unexportedReferences: readonly string[];
    readonly declarations: readonly string[];
};

/** 由公开名字引到、自己没有被任何入口导出的声明；它自己的引用照样记下，SDK 的快照沿它们取闭包。 */
export type UnexportedEntry = {
    readonly name: string;
    readonly kind: SurfaceKind;
    readonly references: readonly string[];
    readonly unexportedReferences: readonly string[];
    readonly declarations: readonly string[];
};

export type SurfaceProblem = {
    readonly severity: "error" | "warning";
    readonly name: string;
    readonly message: string;
};

export type EntrySurface = {
    readonly entry: string;
    readonly names: readonly SurfaceEntry[];
    readonly unexported: readonly UnexportedEntry[];
};

export type Surface = {
    readonly entries: readonly EntrySurface[];
    readonly problems: readonly SurfaceProblem[];
};

/** 码元比较：报告的先后不随运行环境的语言设置变。 */
export function byCodeUnit(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

const MANGLED = /\$\d|__VLS/u;
const STABILITY_IN_COMMENT = /@(?:stable|experimental)\b/u;

/**
 * 读公开面。`entries` 是入口名到声明文件路径；`components` 是组件名到它五段里的类型文字（见 `api-components.ts` 的
 * `componentTypeTexts`）：组件的发布声明只是 `typeof __VLS_export$N`，不打印、不参与声明的引用遍历，它引到哪些名字按类型文字认。
 * `program` 的根文件就是本包的声明文件；只把声明在其中的符号当作本包的（其余是 `vue` 之类的依赖）。
 */
export function readSurface(program: ts.Program, entries: ReadonlyMap<string, string>, components: ReadonlyMap<string, readonly string[]>): Surface {
    const checker = program.getTypeChecker();
    const ownFiles = new Set(program.getRootFileNames().map((file) => program.getSourceFile(file)).filter((file) => file !== undefined));
    const problems: SurfaceProblem[] = [];
    const printer = ts.createPrinter({removeComments: true});

    // 先收全部入口的公开名字：引用遍历要知道哪个符号是公开的，不论它从哪个入口导出。
    const exported = new Map<string, {readonly entry: string; readonly name: string; readonly symbol: ts.Symbol}[]>();
    const publicNameOf = new Map<ts.Symbol, string>();
    for (const [entry, fileName] of entries) {
        const file = program.getSourceFile(fileName);
        if (file === undefined) throw new Error(`declaration entry ${fileName} is not in the program`);
        const moduleSymbol = checker.getSymbolAtLocation(file);
        if (moduleSymbol === undefined) throw new Error(`declaration entry ${fileName} is not a module`);
        const list = checker.getExportsOfModule(moduleSymbol).map((symbol) => ({entry, name: symbol.name, symbol: resolve(checker, symbol)}));
        exported.set(entry, list);
        for (const item of list) {
            // 声明不在根文件里时引用与可达性会静默变空（例如共享块挪进了子目录），宁可报错。
            if (!isTopLevelOwn(item.symbol, ownFiles)) throw new Error(`${entry}: ${item.name} is not declared at the top level of the package's declaration files`);
            if (!publicNameOf.has(item.symbol)) publicNameOf.set(item.symbol, item.name);
        }
    }
    // 没导出的顶层声明按名字：组件的类型文字里认它们（组件以外按符号认，不经名字）。
    const unexportedByName = new Map<string, ts.Symbol>();
    for (const file of ownFiles) {
        for (const statement of file.statements) {
            for (const name of declaredNames(statement)) {
                const symbol = checker.getSymbolAtLocation(name);
                if (symbol !== undefined && !publicNameOf.has(symbol) && !MANGLED.test(name.text)) unexportedByName.set(name.text, symbol);
            }
        }
    }
    const publicNames = [...new Set(publicNameOf.values())];

    const print = (node: ts.Node): string => printer.printNode(ts.EmitHint.Unspecified, statementOf(node), node.getSourceFile()).trim();

    /** 声明里引到的本包符号：公开的给名字，没导出的给符号（之后遍历到不动点）。 */
    const referencesOf = (declarations: readonly ts.Declaration[], self: ts.Symbol): {publicNames: Set<string>; unexported: Set<ts.Symbol>} => {
        const publicNames = new Set<string>();
        const unexported = new Set<ts.Symbol>();
        const visit = (node: ts.Node): void => {
            if (ts.isIdentifier(node)) {
                const found = checker.getSymbolAtLocation(node);
                if (found !== undefined) {
                    const target = resolve(checker, found);
                    if (target !== self && isTopLevelOwn(target, ownFiles)) {
                        const name = publicNameOf.get(target);
                        if (name !== undefined) publicNames.add(name);
                        else unexported.add(target);
                    }
                }
            }
            ts.forEachChild(node, visit);
        };
        for (const declaration of declarations) visit(statementOf(declaration));
        return {publicNames, unexported};
    };

    const result: EntrySurface[] = [];
    for (const [entry, list] of exported) {
        const names: SurfaceEntry[] = [];
        const pending: ts.Symbol[] = [];
        for (const {name, symbol} of list) {
            const declarations = symbol.declarations ?? [];
            if (declarations.length === 0) throw new Error(`${entry}: ${name} has no declaration`);
            const typeTexts = components.get(name);
            const stability = readStability(name, declarations, problems);
            const deprecated = declarations.some((declaration) => ts.getJSDocTags(declaration).some((tag) => tag.tagName.text === "deprecated"));
            if (typeTexts !== undefined) {
                const mentioned = (other: string) => other !== name && typeTexts.some((text) => mentions(text, other));
                const hidden = [...unexportedByName.keys()].filter(mentioned).sort(byCodeUnit);
                pending.push(...hidden.map((other) => unexportedByName.get(other)!));
                names.push({name, kind: "component", stability, deprecated, references: publicNames.filter(mentioned).sort(byCodeUnit), unexportedReferences: hidden, declarations: []});
                continue;
            }
            const printed = declarations.map(print);
            for (const text of printed) if (MANGLED.test(text)) problems.push({severity: "error", name, message: "printed declaration contains a mangled name ($N or __VLS); rename the clashing declaration"});
            const refs = referencesOf(declarations, symbol);
            pending.push(...refs.unexported);
            names.push({name, kind: kindOf(declarations[0]!), stability, deprecated, references: [...refs.publicNames].filter((other) => other !== name).sort(byCodeUnit), unexportedReferences: namesOf(refs.unexported), declarations: printed});
        }
        // 没导出的声明本身也会引到别的没导出的声明：遍历到不动点。
        const seen = new Set<ts.Symbol>();
        const unexported: UnexportedEntry[] = [];
        while (pending.length > 0) {
            const symbol = pending.pop()!;
            if (seen.has(symbol)) continue;
            seen.add(symbol);
            const declarations = symbol.declarations ?? [];
            const refs = referencesOf(declarations, symbol);
            pending.push(...refs.unexported);
            unexported.push({name: symbol.name, kind: kindOf(declarations[0]!), references: [...refs.publicNames].sort(byCodeUnit), unexportedReferences: namesOf(refs.unexported), declarations: declarations.map(print)});
        }
        for (const item of unexported) problems.push({severity: "warning", name: item.name, message: `${entry}: reachable from a public signature but not exported; export it or accept it as part of the public signature`});
        result.push({entry, names: names.sort((a, b) => byCodeUnit(a.name, b.name)), unexported: unexported.sort((a, b) => byCodeUnit(a.name, b.name))});
    }

    problems.push(...closureProblems(result));
    return {entries: result, problems: dedupe(problems)};
}

/** `@stable` 名字引到的公开名字也必须是 `@stable`（计划“闭包核对”）。 */
export function closureProblems(entries: readonly EntrySurface[]): SurfaceProblem[] {
    const stability = new Map<string, Stability | null>();
    for (const entry of entries) for (const item of entry.names) stability.set(item.name, item.stability);
    const problems: SurfaceProblem[] = [];
    for (const entry of entries) {
        for (const item of entry.names) {
            if (item.stability !== "stable") continue;
            const unstable = item.references.filter((name) => stability.get(name) !== "stable");
            if (unstable.length > 0) problems.push({severity: "error", name: item.name, message: `@stable but its signature references names that are not @stable: ${unstable.join(", ")}`});
            if (item.unexportedReferences.length > 0) problems.push({severity: "error", name: item.name, message: `@stable but its signature references unexported declarations: ${item.unexportedReferences.join(", ")}`});
        }
    }
    return problems;
}

/** 每一处声明恰好一个稳定性标签；只认紧贴声明的最后一块 JSDoc（TypeScript 只读这一块）。 */
function readStability(name: string, declarations: readonly ts.Declaration[], problems: SurfaceProblem[]): Stability | null {
    let found: Stability | null = null;
    for (const declaration of declarations) {
        const statement = statementOf(declaration);
        if (ts.isVariableStatement(statement) && statement.declarationList.declarations.length > 1) {
            problems.push({severity: "error", name, message: "declared together with other names in one statement; only the first declarator gets the JSDoc tag"});
        }
        if (earlierBlocksMention(statement)) problems.push({severity: "warning", name, message: "a stability tag sits in an earlier comment block that TypeScript does not read"});
        const tags = ts.getJSDocTags(declaration).filter((tag) => (STABILITY_TAGS as readonly string[]).includes(tag.tagName.text));
        if (tags.length !== 1) {
            problems.push({severity: "error", name, message: tags.length === 0 ? "missing @stable or @experimental on a declaration" : "more than one stability tag on a declaration"});
            continue;
        }
        const tag = tags[0]!.tagName.text as Stability;
        if (found !== null && found !== tag) problems.push({severity: "error", name, message: "declarations disagree on stability"});
        found ??= tag;
    }
    return found;
}

/** 声明前面除最后一块以外的注释里有没有稳定性标签。 */
function earlierBlocksMention(statement: ts.Node): boolean {
    const text = statement.getSourceFile().getFullText();
    const ranges = ts.getLeadingCommentRanges(text, statement.getFullStart()) ?? [];
    return ranges.slice(0, -1).some((range) => STABILITY_IN_COMMENT.test(text.slice(range.pos, range.end)));
}

function resolve(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
    return (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
}

/** 声明在本包声明文件的顶层（不是成员、参数、类型参数）。 */
function isTopLevelOwn(symbol: ts.Symbol, ownFiles: ReadonlySet<ts.SourceFile>): boolean {
    return (symbol.declarations ?? []).some((declaration) => ownFiles.has(declaration.getSourceFile()) && ts.isSourceFile(statementOf(declaration).parent));
}

/** 变量的 JSDoc 与打印都在语句上；其余声明本身就是语句。 */
function statementOf(node: ts.Node): ts.Node {
    if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent) && ts.isVariableStatement(node.parent.parent)) return node.parent.parent;
    return node;
}

function kindOf(declaration: ts.Declaration): SurfaceKind {
    if (ts.isFunctionDeclaration(declaration)) return "function";
    if (ts.isVariableDeclaration(declaration)) return "const";
    if (ts.isInterfaceDeclaration(declaration)) return "interface";
    if (ts.isTypeAliasDeclaration(declaration)) return "type";
    if (ts.isClassDeclaration(declaration)) return "class";
    if (ts.isEnumDeclaration(declaration)) return "enum";
    if (ts.isModuleDeclaration(declaration)) return "namespace";
    throw new Error(`unsupported declaration kind ${ts.SyntaxKind[declaration.kind]}`);
}

function dedupe(problems: readonly SurfaceProblem[]): SurfaceProblem[] {
    const seen = new Set<string>();
    return problems.filter((problem) => {
        const key = `${problem.severity}\u0000${problem.name}\u0000${problem.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** 类型文字里出现这个名字（前后不是标识符字符）。 */
function mentions(text: string, name: string): boolean {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, "u").test(text);
}

function namesOf(symbols: ReadonlySet<ts.Symbol>): string[] {
    return [...new Set([...symbols].map((symbol) => symbol.name))].sort(byCodeUnit);
}

/** 顶层语句声明的名字（变量语句可能有几个）。 */
function declaredNames(statement: ts.Statement): ts.Identifier[] {
    if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.map((declaration) => declaration.name).filter(ts.isIdentifier);
    const name = (statement as {name?: ts.Node}).name;
    return name !== undefined && ts.isIdentifier(name) ? [name] : [];
}
