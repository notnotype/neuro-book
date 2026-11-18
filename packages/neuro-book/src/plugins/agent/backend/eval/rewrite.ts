/**
 * 把一个单元的代码改写成能在内核全局上执行、顶层声明跨调用保留的样子（docs/specs/agent/eval.md 输出 1、3）。
 *
 * 内核用间接 eval 执行，每次求值都有自己的词法环境：原样执行时 `let`、`const`、`class` 只活在这一次；带 `"use strict"`
 * 时连 `var` 与函数也只活在这一次。所以只有一条路：整段包进一个异步箭头函数，顶层声明改成对 `globalThis` 的赋值，
 * 之后的单元按裸名读到的是全局对象上的属性，前一个单元定义的函数读到的也是后来改过的值。不把声明降成 `var`：严格模式下
 * 会悄悄丢变量（omp 就踩在这里，见 t21 的调研）。
 *
 * 只做就地的小改动（删关键字、给标识符加前缀、插入括号），不重排代码：包装与入口要装的东西都放在第 1 行，之后的行号与
 * 模型写的代码一致，堆栈指得准。
 *
 * 失效条件：Bun 改成别的执行方式（例如真的支持跨次保留的 REPL 求值）时，这一层可以去掉。
 */

import {Parser, type Node, type Program, type Pattern, type Statement, type VariableDeclaration} from "acorn";

import {IMPORT_HELPER} from "./constants";

/** 改写失败的原因：都是代码本身的问题，交给模型改了再试。 */
export type RewriteFailure =
    | {readonly kind: "syntax"; readonly message: string}
    | {readonly kind: "export"; readonly message: string}
    | {readonly kind: "reserved-name"; readonly message: string};

export type RewriteResult = {readonly ok: true; readonly source: string} | {readonly ok: false; readonly failure: RewriteFailure};


const PARSE_OPTIONS = {ecmaVersion: "latest", allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, locations: true} as const;

interface Edit {
    readonly start: number;
    readonly end: number;
    readonly text: string;
}

type AnyNode = Node & Record<string, unknown>;

/**
 * `reserved` 是代码不能当变量声明的名字（`tool`、`display`、`console`、这个会话的全局对象名等）：声明了就盖掉内核给的东西，
 * 之后的单元全都调不到，所以在执行前拒绝。
 */
export function rewriteCell(code: string, reserved: ReadonlySet<string>): RewriteResult {
    const parsed = parseCell(code);
    if (!parsed.ok) return parsed;
    const program = parsed.program;
    const edits: Edit[] = [];
    const declared: string[] = [];
    const functions: string[] = [];
    // `var` 声明的名字：原语义里在单元开头就已存在（值为 undefined），入口照样补上，声明之前读它不抛错。
    const hoisted: string[] = [];

    for (const statement of program.body) {
        switch (statement.type) {
            case "ImportDeclaration":
                edits.push({start: statement.start, end: statement.end, text: importText(statement as unknown as AnyNode, code, declared)});
                break;
            case "ExportNamedDeclaration":
            case "ExportDefaultDeclaration":
            case "ExportAllDeclaration":
                return {ok: false, failure: {kind: "export", message: `第 ${lineOf(statement)} 行：单元不是模块，不能 export；直接声明变量，之后的调用照样读得到。`}};
            case "VariableDeclaration":
                rewriteDeclaration(statement, "statement", edits, declared, hoisted);
                break;
            case "FunctionDeclaration":
                // 函数声明留在原处（名字与提升都不变），在入口把它挂到全局：函数在函数体开头就已提升好。
                functions.push(statement.id.name);
                break;
            case "ClassDeclaration": {
                const name = (statement.id as {name: string}).name;
                declared.push(name);
                edits.push({start: statement.start, end: statement.start, text: `;globalThis.${name} = `});
                edits.push({start: statement.end, end: statement.end, text: ";"});
                break;
            }
            default:
                // 块、循环、`try` 里的 `var` 在原语义里也是全局的（omp 的更新日志 #15859 修过它们丢失）。
                collectNestedVars(statement, edits, declared, hoisted);
        }
    }

    collectImportCalls(program, edits);

    const names = [...declared, ...functions];
    const clash = names.find((name) => reserved.has(name));
    if (clash !== undefined) return {ok: false, failure: {kind: "reserved-name", message: `不能声明 ${clash}：它是内核提供的名字，声明了之后调不到原来的那个。换一个变量名。`}};

    const last = lastValueStatement(program);
    if (last !== null) {
        edits.push({start: last.start, end: last.start, text: "return ("});
        const expression = (last as unknown as {expression: Node}).expression;
        edits.push({start: expression.end, end: expression.end, text: ")"});
    }

    // 入口：指令（`"use strict"`）必须仍是函数体的第一批语句，挂函数的语句放在最后一条指令之后、同一行上。
    const directives = leadingDirectives(program, last);
    const stubs = [...[...new Set(hoisted)].map((name) => `("${name}" in globalThis) || (globalThis.${name} = undefined);`), ...functions.map((name) => `globalThis.${name} = ${name};`)].join(" ");
    const entry = directives.length === 0 ? 0 : directives.at(-1)!.end;
    if (stubs !== "") edits.push({start: entry, end: entry, text: ` ${stubs} `});

    return {ok: true, source: `(async () => {${apply(code, edits)}\n})()`};
}

function parseCell(code: string): {ok: true; program: Program} | {ok: false; failure: RewriteFailure} {
    try {
        return {ok: true, program: Parser.parse(code, {...PARSE_OPTIONS, sourceType: "script"})};
    } catch (scriptError) {
        // 按脚本解析不过时再按模块试一次：过了说明只是用了 `import`、`export`，由上面按语句处理；也不过就报脚本的那个错。
        try {
            return {ok: true, program: Parser.parse(code, {...PARSE_OPTIONS, sourceType: "module"})};
        } catch {
            return {ok: false, failure: {kind: "syntax", message: syntaxMessage(code, scriptError)}};
        }
    }
}

/** acorn 的错误带位置：写成“消息（第几行第几列）”加出错的那两行与插入符，模型据此改，不用猜。 */
function syntaxMessage(code: string, error: unknown): string {
    const loc = (error as {loc?: {line: number; column: number}}).loc;
    const raw = error instanceof Error ? error.message : String(error);
    const message = raw.replace(/\s*\(\d+:\d+\)$/u, "");
    if (loc === undefined) return `SyntaxError: ${message}`;
    const lines = code.split("\n");
    const frame: string[] = [];
    for (let line = Math.max(1, loc.line - 1); line <= loc.line; line += 1) frame.push(`${String(line).padStart(4)} | ${(lines[line - 1] ?? "").slice(0, 160)}`);
    frame.push(`     | ${" ".repeat(Math.min(loc.column, 160))}^`);
    const hint = LOOKS_LIKE_TYPESCRIPT.test(code) ? "\n这里只接受 JavaScript，看起来写了 TypeScript 的类型标注，去掉再试。" : "";
    return `SyntaxError: ${message}（第 ${loc.line} 行，第 ${loc.column + 1} 列）\n${frame.join("\n")}${hint}`;
}

/** 只用来给提示，不用来决定怎样执行：误判的代价只是多一句话。 */
const LOOKS_LIKE_TYPESCRIPT = /(?:\b(?:const|let|var)\s+\w+\s*:\s*[\w[\]<>|]+\s*=|\binterface\s+\w+\s*\{|\btype\s+\w+\s*=|\)\s*:\s*\w+\s*(?:=>|\{))/u;

/** `import a, {b as c} from "m"` 之类改写成一段对全局的赋值；整段在一个块里，临时名不会漏出来。 */
function importText(node: AnyNode, code: string, declared: string[]): string {
    const source = code.slice((node.source as Node).start, (node.source as Node).end);
    const attributes = node.attributes as AnyNode[] | undefined;
    const options = attributes !== undefined && attributes.length > 0 ? `, {with: {${attributes.map((attribute) => `${code.slice((attribute.key as Node).start, (attribute.key as Node).end)}: ${code.slice((attribute.value as Node).start, (attribute.value as Node).end)}`).join(", ")}}}` : "";
    const load = `await ${IMPORT_HELPER}(${source}${options})`;
    const specifiers = node.specifiers as AnyNode[];
    if (specifiers.length === 0) return `${load};`;
    const assignments = specifiers.map((specifier) => {
        const local = (specifier.local as {name: string}).name;
        declared.push(local);
        if (specifier.type === "ImportNamespaceSpecifier") return `globalThis.${local} = __nbook_m;`;
        if (specifier.type === "ImportDefaultSpecifier") return `globalThis.${local} = __nbook_m.default;`;
        const imported = specifier.imported as AnyNode;
        const key = imported.type === "Identifier" ? `.${String(imported.name)}` : `[${code.slice(imported.start, imported.end)}]`;
        return `globalThis.${local} = __nbook_m${key};`;
    });
    return `{ const __nbook_m = ${load}; ${assignments.join(" ")} }`;
}

/**
 * `const a = 1, {b, c: [d]} = x;` → `;globalThis.a = 1, ({b: globalThis.b, c: [globalThis.d]} = x);`。
 * `where` 为 `for-head` 时是 `for (var i = 0; …)`、`for (var x of xs)` 的头：不加分号与括号（那里本来就是赋值目标）。
 * `using` 声明不改：它要在单元结束时释放，跨调用保留反而不对。
 */
function rewriteDeclaration(node: VariableDeclaration, where: "statement" | "for-head", edits: Edit[], declared: string[], hoisted: string[]): void {
    if (node.kind === "using" || node.kind === "await using") return;
    const keywordEnd = node.start + node.kind.length;
    edits.push({start: node.start, end: keywordEnd, text: where === "statement" ? ";" : ""});
    for (const declarator of node.declarations) {
        const names: string[] = [];
        if (declarator.init === null || declarator.init === undefined) {
            if (where === "for-head") {
                targetEdits(declarator.id, edits, names);
            } else {
                // 没有初值：`var` 不盖掉已有的值（重复声明在 JS 里也是这样），`let` 设成 undefined。
                const name = (declarator.id as {name: string}).name;
                names.push(name);
                const text = node.kind === "var" ? `(("${name}" in globalThis) || (globalThis.${name} = undefined))` : `(globalThis.${name} = undefined)`;
                edits.push({start: declarator.start, end: declarator.end, text});
            }
        } else {
            const wrap = where === "statement" && declarator.id.type === "ObjectPattern";
            if (wrap) edits.push({start: declarator.start, end: declarator.start, text: "("});
            targetEdits(declarator.id, edits, names);
            if (wrap) edits.push({start: declarator.end, end: declarator.end, text: ")"});
        }
        declared.push(...names);
        if (node.kind === "var") hoisted.push(...names);
    }
}

/** 把声明的目标改成对全局的赋值目标：标识符加前缀，简写属性 `{a}` 展开成 `{a: globalThis.a}`。 */
function targetEdits(pattern: Pattern, edits: Edit[], names: string[]): void {
    switch (pattern.type) {
        case "Identifier":
            names.push(pattern.name);
            edits.push({start: pattern.start, end: pattern.start, text: "globalThis."});
            return;
        case "ObjectPattern":
            for (const property of pattern.properties) {
                if (property.type === "RestElement") {
                    targetEdits(property.argument, edits, names);
                    continue;
                }
                if (property.shorthand) {
                    // `{a}` 与 `{a = 1}`：键和值共用同一段文字，在开头插入 `a: `，再改值里的标识符。
                    const key = (property.key as {name: string}).name;
                    edits.push({start: property.start, end: property.start, text: `${key}: `});
                }
                targetEdits(property.value as Pattern, edits, names);
            }
            return;
        case "ArrayPattern":
            for (const element of pattern.elements) if (element !== null) targetEdits(element, edits, names);
            return;
        case "RestElement":
            targetEdits(pattern.argument, edits, names);
            return;
        case "AssignmentPattern":
            targetEdits(pattern.left, edits, names);
            return;
        case "MemberExpression":
            // 声明里不会出现（只在赋值里），这里没有要改的。
            return;
    }
}

/** 顶层语句里（不进函数）出现的 `var`：块、`if`、`try`、标签、`switch`、`for` 的头。 */
function collectNestedVars(node: Node, edits: Edit[], declared: string[], hoisted: string[]): void {
    const visit = (current: AnyNode, parent: AnyNode | null): void => {
        if (current.type === "FunctionDeclaration" || current.type === "FunctionExpression" || current.type === "ArrowFunctionExpression" || current.type === "ClassDeclaration" || current.type === "ClassExpression") return;
        if (current.type === "VariableDeclaration" && (current as unknown as VariableDeclaration).kind === "var") {
            const inHead = parent !== null && (parent.type === "ForStatement" ? parent.init === current : (parent.type === "ForInStatement" || parent.type === "ForOfStatement") && parent.left === current);
            rewriteDeclaration(current as unknown as VariableDeclaration, inHead ? "for-head" : "statement", edits, declared, hoisted);
            return;
        }
        for (const value of Object.values(current)) {
            if (Array.isArray(value)) {
                for (const item of value) if (isNode(item)) visit(item, current);
            } else if (isNode(value)) visit(value, current);
        }
    };
    visit(node as AnyNode, null);
}

/**
 * 代码里任何位置的 `import(…)`（包括函数里）换成内核的解析函数：间接 eval 里的 `import("./x")` 按内核入口文件所在的目录
 * 解析，不是工作目录（omp 对照时实测），模型写的相对路径会莫名其妙地找不到。
 */
function collectImportCalls(program: Program, edits: Edit[]): void {
    const visit = (current: AnyNode): void => {
        if (current.type === "ImportExpression") edits.push({start: current.start, end: current.start + "import".length, text: IMPORT_HELPER});
        for (const value of Object.values(current)) {
            if (Array.isArray(value)) {
                for (const item of value) if (isNode(item)) visit(item);
            } else if (isNode(value)) visit(value);
        }
    };
    visit(program as unknown as AnyNode);
}

function isNode(value: unknown): value is AnyNode {
    return typeof value === "object" && value !== null && typeof (value as {type?: unknown}).type === "string" && typeof (value as {start?: unknown}).start === "number";
}

/**
 * 最后一条语句是表达式时，它的值就是单元的值；顶层 `return` 由异步函数自己交回。只有一个字符串的单元（`"第一行"`）在语法上是
 * 指令，也当成值；`"use strict"` 除外，它要留在函数体开头才起作用。
 */
function lastValueStatement(program: Program): Statement | null {
    const body = program.body.filter((statement) => statement.type !== "EmptyStatement");
    const last = body.at(-1);
    if (last === undefined || last.type !== "ExpressionStatement") return null;
    const directive = (last as {directive?: string}).directive;
    return directive === "use strict" ? null : (last as Statement);
}

/** 开头的指令序列；当成值的那一条不算（它要改成 `return`，挂函数的语句不能排在它后面）。 */
function leadingDirectives(program: Program, value: Statement | null): Node[] {
    const result: Node[] = [];
    for (const statement of program.body) {
        if (statement === value || statement.type !== "ExpressionStatement" || (statement as {directive?: string}).directive === undefined) break;
        result.push(statement);
    }
    return result;
}

function lineOf(node: Node): number {
    return node.loc?.start.line ?? 1;
}

/**
 * 从后往前套用，改动彼此不重叠。同一位置上先套替换（它盖住右边的文字）、再套插入，插入之间按登记的先后排在左边：
 * 不然先插进去的文字会被随后的替换按旧的位置切掉一截。
 */
function apply(code: string, edits: readonly Edit[]): string {
    const ordered = edits.map((edit, index) => ({edit, index})).sort((a, b) => b.edit.start - a.edit.start || b.edit.end - a.edit.end || b.index - a.index);
    let result = code;
    for (const {edit} of ordered) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    return result;
}
