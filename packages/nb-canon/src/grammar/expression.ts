/**
 * 式子（`V` 的 `expr`、`If` 与 `ElseIf` 的 `test`）与地址（`V` 的 `of`）：只解析、按节点表查、按三值逻辑求值，不执行
 * （docs/specs/canon/rendering.md 白名单下的节点表、输出 2、5）。解析用 acorn，结果只取决于原文，前后端相同。
 */

import {parseExpressionAt, type Expression, type Node} from "acorn";

import {formatPath, parsePath} from "../core/address";
import {RESERVED_ROOTS} from "../core/identifiers";

/** 式子里的一个字段引用：`entry` 为 null 表示本条目，否则是 `ref('…')` 或 `V` 的 `entry` 给的条目 id。 */
export interface FieldReference {
    readonly entry: string | null;
    readonly path: string;
}

/** 解析好的式子：语法树与它的字段引用（成员访问链的节点 → 引用）。 */
export interface ParsedExpression {
    readonly node: Expression;
    readonly references: readonly FieldReference[];
    readonly referenceOf: ReadonlyMap<Node, FieldReference>;
}

/** 解析失败：`offset` 是在式子原文里的位置。 */
export interface ExpressionError {
    readonly offset: number;
    readonly message: string;
}

export type ExpressionResult = {readonly ok: true; readonly expression: ParsedExpression} | {readonly ok: false; readonly error: ExpressionError};

const COMPARISON = new Set(["==", "!=", "===", "!==", "<", "<=", ">", ">="]);
const ARITHMETIC = new Set(["+", "-", "*", "/", "%"]);
const LOGICAL = new Set(["&&", "||"]);

/**
 * 内置函数与参数个数（输出 2）。只在调用的位置认：`round.计数` 照旧是名叫 `round` 的命名空间的地址，函数名不占命名空间的名字
 * （omp 设计审查第 16 条）。
 */
const FUNCTIONS: Readonly<Record<string, {readonly min: number; readonly max: number}>> = {
    round: {min: 1, max: 2},
    floor: {min: 1, max: 1},
    ceil: {min: 1, max: 1},
    min: {min: 1, max: Infinity},
    max: {min: 1, max: Infinity},
    abs: {min: 1, max: 1},
    percent: {min: 2, max: 2},
};

function parseNode(text: string): {readonly node: Expression} | {readonly error: ExpressionError} {
    let comment = -1;
    let node: Expression;
    try {
        node = parseExpressionAt(text, 0, {
            ecmaVersion: "latest",
            onComment: (_block, _text, start) => {
                if (comment < 0) comment = start;
            },
        });
    } catch (error) {
        const offset = typeof (error as {pos?: unknown}).pos === "number" ? (error as {pos: number}).pos : 0;
        return {error: {offset, message: error instanceof Error ? error.message : String(error)}};
    }
    if (comment >= 0) return {error: {offset: comment, message: "comments are not allowed"}};
    // 只许一个式子，前后可以有空白：读完之后剩下的不是空白就拒收（acorn 读完一个式子就停）。
    if (text.slice(node.end).trim() !== "") return {error: {offset: node.end, message: "only a single expression is allowed"}};
    return {node};
}

/** 解析一个式子（`expr`、`test`）。 */
export function parseExpression(text: string): ExpressionResult {
    const parsed = parseNode(text);
    if ("error" in parsed) return {ok: false, error: parsed.error};
    const references: FieldReference[] = [];
    const referenceOf = new Map<Node, FieldReference>();
    const problem = check(parsed.node, references, referenceOf);
    if (problem !== null) return {ok: false, error: problem};
    return {ok: true, expression: {node: parsed.node, references, referenceOf}};
}

/** 解析一个地址（`V` 的 `of`）：只许一条不带 `ref` 的成员访问链。 */
export function parseAddress(text: string): {readonly ok: true; readonly path: string} | {readonly ok: false; readonly error: ExpressionError} {
    const parsed = parseNode(text);
    if ("error" in parsed) return {ok: false, error: parsed.error};
    const reference = parsed.node.type === "MemberExpression" ? memberReference(parsed.node) : null;
    if (reference === null || reference.entry !== null) return {ok: false, error: {offset: parsed.node.start, message: "of takes a field address such as panel.魔力; another entry's field is written with entry=\"…\""}};
    return {ok: true, path: reference.path};
}

const fail = (node: Node, message: string): ExpressionError => ({offset: node.start, message});

/** 按节点表查（rendering.md 白名单下的表），收集字段引用；不合规则返回出错的节点与说明。 */
function check(node: Node, references: FieldReference[], referenceOf: Map<Node, FieldReference>): ExpressionError | null {
    const expression = node as Expression;
    switch (expression.type) {
        case "MemberExpression": {
            const reference = memberReference(expression);
            if (reference === null) return fail(expression, "not a field address");
            references.push(reference);
            referenceOf.set(expression, reference);
            return null;
        }
        case "Literal": {
            const value = expression.value;
            if (typeof value === "number") return Number.isFinite(value) ? null : fail(expression, "number literal is not finite");
            if ("regex" in expression || "bigint" in expression) return fail(expression, "literal kind not allowed");
            return typeof value === "string" || typeof value === "boolean" || value === null ? null : fail(expression, "literal kind not allowed");
        }
        case "BinaryExpression":
            if (!COMPARISON.has(expression.operator) && !ARITHMETIC.has(expression.operator)) return fail(expression, `operator ${expression.operator} not allowed`);
            return check(expression.left, references, referenceOf) ?? check(expression.right, references, referenceOf);
        case "LogicalExpression":
            if (!LOGICAL.has(expression.operator)) return fail(expression, `operator ${expression.operator} not allowed`);
            return check(expression.left, references, referenceOf) ?? check(expression.right, references, referenceOf);
        case "UnaryExpression":
            if (expression.operator !== "!" && expression.operator !== "-") return fail(expression, `operator ${expression.operator} not allowed`);
            return check(expression.argument, references, referenceOf);
        case "ConditionalExpression":
            return check(expression.test, references, referenceOf) ?? check(expression.consequent, references, referenceOf) ?? check(expression.alternate, references, referenceOf);
        case "CallExpression": {
            const callee = expression.callee;
            const rule = callee.type === "Identifier" && Object.hasOwn(FUNCTIONS, callee.name) ? FUNCTIONS[callee.name] : undefined;
            if (rule === undefined || expression.optional) return fail(expression, "only the built-in functions round, floor, ceil, min, max, abs and percent can be called; ref('id') starts a field address");
            const count = expression.arguments.length;
            if (count < rule.min || count > rule.max) return fail(expression, `${(callee as {name: string}).name} takes ${rule.min === rule.max ? String(rule.min) : `${String(rule.min)} or more`} arguments`);
            for (const argument of expression.arguments) {
                if (argument.type === "SpreadElement") return fail(argument, "spread is not allowed");
                const problem = check(argument, references, referenceOf);
                if (problem !== null) return problem;
            }
            const digits = expression.arguments[1];
            if ((callee as {name: string}).name === "round" && digits !== undefined && !(digits.type === "Literal" && typeof digits.value === "number" && Number.isInteger(digits.value))) return fail(digits, "the digits of round must be an integer literal");
            return null;
        }
        default:
            return fail(expression, `${expression.type} not allowed`);
    }
}

/** 成员访问链 → 字段引用；根是 `entry`、`text`、命名空间，或 `ref('条目 id')`。 */
export function memberReference(node: Node): FieldReference | null {
    const segments: Array<{kind: "key" | "id"; value: string}> = [];
    let current = node as Expression;
    while (current.type === "MemberExpression") {
        const property = current.property;
        if (!current.computed && property.type === "Identifier") segments.unshift({kind: "key", value: property.name});
        else if (current.computed && property.type === "Literal" && typeof property.value === "string") segments.unshift({kind: "id", value: property.value});
        else if (current.computed && property.type === "Identifier") segments.unshift({kind: "id", value: property.name});
        else return null;
        if (current.optional || current.object.type === "Super") return null;
        current = current.object;
    }
    let entry: string | null = null;
    let root: string;
    if (current.type === "CallExpression") {
        if (current.callee.type !== "Identifier" || current.callee.name !== "ref" || current.arguments.length !== 1) return null;
        const argument = current.arguments[0];
        if (argument === undefined || argument.type !== "Literal" || typeof argument.value !== "string") return null;
        entry = argument.value;
        const first = segments.shift();
        if (first === undefined || first.kind !== "key") return null;
        root = first.value;
    } else if (current.type === "Identifier") {
        root = current.name;
        if (root === "ref" || (RESERVED_ROOTS.has(root) && root !== "entry" && root !== "text")) return null;
    } else return null;
    let path = root;
    for (const segment of segments) path += segment.kind === "key" ? `.${segment.value}` : `[${segment.value}]`;
    const parsed = parsePath(path);
    return parsed === null ? null : {entry, path: formatPath(parsed)};
}

/** 取一个字段引用的值：`value` 为 null 表示未知；`unavailable` 是读不到的原因（输出 6）。`M` 是不完整的标记。 */
export interface Resolved<M> {
    readonly value: unknown;
    readonly incomplete?: M;
    readonly unavailable?: string;
}

export interface Evaluated<M> {
    /** null 表示未知。 */
    readonly value: unknown;
    readonly incomplete: M | undefined;
    readonly unavailable: string | undefined;
}

/** 运算结果按 15 位有效数字去掉二进制的尾差（`0.1 + 0.2` 得 `0.3`）；只用于显示与比较，不存。不是有限数的得未知。 */
function finite(value: number): number | null {
    if (!Number.isFinite(value)) return null;
    const rounded = Number(value.toPrecision(15));
    return Object.is(rounded, -0) ? 0 : rounded;
}

/** 三值逻辑的求值（输出 5）：null 是未知。全部字段引用都会取一次，不完整与读不到的标记按出现的先后取第一个。 */
export function evaluate<M>(expression: ParsedExpression, resolve: (reference: FieldReference) => Resolved<M>): Evaluated<M> {
    let incomplete: M | undefined;
    let unavailable: string | undefined;
    const values = new Map<Node, unknown>();
    for (const [node, reference] of expression.referenceOf) {
        const resolved = resolve(reference);
        incomplete ??= resolved.incomplete;
        unavailable ??= resolved.unavailable;
        values.set(node, resolved.unavailable === undefined ? (resolved.value ?? null) : null);
    }
    const numbers = (items: unknown[]): number[] | null => (items.every((item) => typeof item === "number") ? (items as number[]) : null);
    const visit = (node: Node): unknown => {
        const expression = node as Expression;
        switch (expression.type) {
            case "MemberExpression":
                return values.get(expression) ?? null;
            case "Literal":
                return expression.value;
            case "UnaryExpression": {
                const value = visit(expression.argument);
                if (value === null) return null;
                if (expression.operator === "-") return typeof value === "number" ? finite(-value) : null;
                return !value;
            }
            case "BinaryExpression": {
                const left = visit(expression.left);
                const right = visit(expression.right);
                if (left === null || right === null) return null;
                switch (expression.operator) {
                    case "==":
                    case "===":
                        return left === right;
                    case "!=":
                    case "!==":
                        return left !== right;
                    case "<":
                    case "<=":
                    case ">":
                    case ">=": {
                        const comparable = (typeof left === "number" && typeof right === "number") || (typeof left === "string" && typeof right === "string");
                        if (!comparable) return null;
                        const a = left as number;
                        const b = right as number;
                        return expression.operator === "<" ? a < b : expression.operator === "<=" ? a <= b : expression.operator === ">" ? a > b : a >= b;
                    }
                    default: {
                        if (typeof left !== "number" || typeof right !== "number") return null;
                        // 除以 0、`% 0` 得到无穷或 NaN，由 `finite` 当成未知。
                        const result = expression.operator === "+" ? left + right : expression.operator === "-" ? left - right : expression.operator === "*" ? left * right : expression.operator === "/" ? left / right : left % right;
                        return finite(result);
                    }
                }
            }
            case "LogicalExpression": {
                const left = visit(expression.left);
                const right = visit(expression.right);
                if (expression.operator === "&&") {
                    if (left !== null && !left) return left;
                    if (left === null) return right !== null && !right ? right : null;
                    return right;
                }
                if (left !== null && left) return left;
                if (left === null) return right !== null && right ? right : null;
                return right;
            }
            case "ConditionalExpression": {
                const test = visit(expression.test);
                // 判断未知时整个条件未知，不当成假。
                if (test === null) return null;
                return test ? visit(expression.consequent) : visit(expression.alternate);
            }
            case "CallExpression": {
                const name = (expression.callee as {name: string}).name;
                const args = expression.arguments.map((argument) => visit(argument));
                if (args.some((argument) => argument === null)) return null;
                const given = numbers(args);
                if (given === null) return null;
                switch (name) {
                    case "round": {
                        const scale = 10 ** (given[1] ?? 0);
                        return finite(Math.round((given[0] as number) * scale) / scale);
                    }
                    case "floor":
                        return finite(Math.floor(given[0] as number));
                    case "ceil":
                        return finite(Math.ceil(given[0] as number));
                    case "abs":
                        return finite(Math.abs(given[0] as number));
                    case "min":
                        return finite(Math.min(...given));
                    case "max":
                        return finite(Math.max(...given));
                    case "percent": {
                        const [part, whole] = given as [number, number];
                        if (whole === 0) return null;
                        const ratio = finite((part / whole) * 100);
                        return ratio === null ? null : `${String(Math.round(ratio))}%`;
                    }
                    default:
                        return null;
                }
            }
            default:
                return null;
        }
    };
    const value = visit(expression.node);
    return {value: value ?? null, incomplete, unavailable};
}

/** 式子里有没有字段引用（`expr` 一个都没有时报 `no-field-expression`）。 */
export const hasField = (expression: ParsedExpression): boolean => expression.references.length > 0;
