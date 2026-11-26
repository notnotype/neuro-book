/**
 * 全局对象（docs/specs/agent/contributions.md 输出 24、25，agent/eval.md 输出 16、17，agent/resources.md 输出 16）：从
 * `agent.evalObjects` 的声明挑出有效的对象，给每个对象生成 `docs://eval/<名>.md`，给 eval 的说明拼“可用的全局对象”一节。
 *
 * 声明在进程生命期内不变（第三方插件集合启动前已定，docs/specs/runtime/plugin-install.md），所以挑一次、生成一次。
 */

import {createHash} from "node:crypto";
import {mkdir, readdir, rename, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import type {ContributionDeclarations} from "@notnotype/nb-runtime/plugins";

import {EVAL_OBJECTS_POINT} from "../../shared/points";
import type {AgentEvalObjectDeclaration} from "../../shared/points";

export interface EvalObject {
    readonly name: string;
    readonly plugin: string;
    readonly summary: string;
    readonly docs?: string;
}

/** 一个方法：带 `global` 的工具在文档里的样子。 */
export interface EvalMethod {
    readonly object: string;
    readonly method: string;
    readonly description: string;
    readonly parameters: unknown;
    readonly returns?: unknown;
    /** 失败码到 `details` 的形状（eval.md 输出 8、17）。 */
    readonly errors?: Readonly<Record<string, unknown>>;
}

/**
 * 有效的对象，按名字。不登记的：与内核给的名字（`reserved`）或宿主全局上已有的名字（`Math`、`process`、`Bun`…）冲突的；两个插件
 * 同名的双方都不登记（结果不随加载顺序变）。
 */
export function validEvalObjects(declarations: ContributionDeclarations, reserved: readonly string[], report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void): ReadonlyMap<string, EvalObject> {
    const byName = new Map<string, EvalObject[]>();
    for (const descriptor of declarations.list<AgentEvalObjectDeclaration>(EVAL_OBJECTS_POINT)) {
        const {name, summary, docs} = descriptor.declaration;
        if (reserved.includes(name) || name in globalThis) {
            report("eval-object-conflict", `the eval object ${name} of ${descriptor.plugin} clashes with a name the kernel already has; it is left out`, {name, plugin: descriptor.plugin});
            continue;
        }
        const list = byName.get(name) ?? [];
        list.push({name, plugin: descriptor.plugin, summary, ...(docs === undefined ? {} : {docs})});
        byName.set(name, list);
    }
    const valid = new Map<string, EvalObject>();
    for (const [name, list] of byName) {
        if (list.length === 1) valid.set(name, list[0]!);
        else report("eval-object-conflict", `${list.map((item) => item.plugin).join(" and ")} both register the eval object ${name}; neither is used`, {name, plugins: list.map((item) => item.plugin)});
    }
    return valid;
}

// ─── 文档 ─────────────────────────────────────────────

/** 一个对象的文档：一行摘要、插件写的说明、每个方法的签名与说明（resources.md 输出 16）。 */
export function objectDoc(object: EvalObject, methods: readonly EvalMethod[]): string {
    const lines = [`# ${object.name}`, "", object.summary, ""];
    if (object.docs !== undefined && object.docs.trim() !== "") lines.push(object.docs.trim(), "");
    lines.push("## 方法", "", "每个方法收一个参数对象，都是异步的，要 `await`。失败时抛 `ToolCallError`（有 `status` 与 `code`）。", "");
    for (const method of [...methods].sort((a, b) => a.method.localeCompare(b.method))) {
        lines.push(`### ${object.name}.${method.method}`, "", "```ts", `${method.method}(args: ${tsType(method.parameters)}): Promise<${method.returns === undefined ? "string" : tsType(method.returns)}>`, "```", "");
        if (method.description.trim() !== "") lines.push(method.description.trim(), "");
        const errors = Object.entries(method.errors ?? {}).sort(([a], [b]) => a.localeCompare(b));
        if (errors.length > 0) lines.push("失败时 `ToolCallError.details` 的形状，按 `code`：", "", "```ts", ...errors.map(([code, schema]) => `${JSON.stringify(code)}: ${tsType(schema)}`), "```", "");
    }
    return `${lines.join("\n").trimEnd()}\n`;
}

/** 写下全部对象的文档，删掉不再有的；先写临时文件再改名，读的人看不到写了一半的文件。 */
export async function writeEvalDocs(directory: string, docs: ReadonlyMap<string, string>): Promise<void> {
    await mkdir(directory, {recursive: true});
    for (const [name, text] of docs) {
        const target = join(directory, `${name}.md`);
        const staging = `${target}.${String(process.pid)}.tmp`;
        await writeFile(staging, text);
        await rename(staging, target);
    }
    for (const file of await readdir(directory)) {
        if (!docs.has(file.replace(/\.md$/u, "")) || !file.endsWith(".md")) await rm(join(directory, file), {force: true});
    }
}

/**
 * JSON Schema 到 TypeScript 类型的打印（技术选型：工具参数是 TypeBox 生成的 JSON Schema，只用到下面这几种）。认不出的写 `unknown`，
 * 宁可宽也不写错。对象里有字段带 `description` 或 `default`（含更深一层的）时分行写、字段前写 JSDoc（eval.md 输出 17）；
 * 都没有的仍是一行，现有方法的签名不变。`indent` 是这个类型所在那一行的缩进。
 */
export function tsType(schema: unknown, indent = ""): string {
    if (typeof schema !== "object" || schema === null) return "unknown";
    const node = schema as Record<string, unknown>;
    if ("const" in node) return JSON.stringify(node.const);
    if (Array.isArray(node.enum)) return node.enum.map((value) => JSON.stringify(value)).join(" | ");
    for (const key of ["anyOf", "oneOf"] as const) if (Array.isArray(node[key])) return (node[key] as unknown[]).map((item) => tsType(item, indent)).join(" | ");
    if (Array.isArray(node.type)) return (node.type as unknown[]).map((type) => tsType({...node, type}, indent)).join(" | ");
    switch (node.type) {
        case "string":
            return "string";
        case "number":
        case "integer":
            return "number";
        case "boolean":
            return "boolean";
        case "null":
            return "null";
        case "array": {
            const items = tsType(node.items, indent);
            return items.includes(" ") ? `Array<${items}>` : `${items}[]`;
        }
        case "object": {
            const properties = Object.entries((node.properties ?? {}) as Record<string, unknown>);
            const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
            const extra = typeof node.additionalProperties === "object" && node.additionalProperties !== null ? node.additionalProperties : undefined;
            const key = (name: string): string => `${/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name) ? name : JSON.stringify(name)}${required.has(name) ? "" : "?"}`;
            if (!properties.some(([, value]) => documented(value)) && (extra === undefined || !documented(extra))) {
                const fields = properties.map(([name, value]) => `${key(name)}: ${tsType(value)}`);
                if (extra !== undefined) fields.push(`[key: string]: ${tsType(extra)}`);
                return fields.length === 0 ? "{}" : `{${fields.join("; ")}}`;
            }
            const inner = `${indent}    `;
            const lines = properties.flatMap(([name, value]) => {
                const doc = fieldDoc(value);
                return [...(doc === null ? [] : [`${inner}/** ${doc} */`]), `${inner}${key(name)}: ${tsType(value, inner)};`];
            });
            if (extra !== undefined) lines.push(`${inner}[key: string]: ${tsType(extra, inner)};`);
            return `{\n${lines.join("\n")}\n${indent}}`;
        }
        default:
            return "unknown";
    }
}

/** 字段前的 JSDoc：说明加缺省值。说明里的星号加斜杠会提前结束注释，在斜杠前加反斜杠；换行折成空格。 */
function fieldDoc(schema: unknown): string | null {
    if (typeof schema !== "object" || schema === null) return null;
    const node = schema as Record<string, unknown>;
    const description = typeof node.description === "string" ? node.description.replace(/\s*\r?\n\s*/gu, " ").trim() : "";
    const fallback = "default" in node ? `缺省 ${JSON.stringify(node.default)}` : "";
    const text = description === "" ? fallback : fallback === "" ? description : `${description}（${fallback}）`;
    return text === "" ? null : text.replaceAll("*/", "*\\/");
}

/** 这个 schema 或它里面的字段有没有要写进 JSDoc 的东西。 */
function documented(schema: unknown): boolean {
    if (typeof schema !== "object" || schema === null) return false;
    if (fieldDoc(schema) !== null) return true;
    const node = schema as Record<string, unknown>;
    const children = [
        ...Object.values((node.properties ?? {}) as Record<string, unknown>),
        node.items,
        node.additionalProperties,
        ...(Array.isArray(node.anyOf) ? node.anyOf : []),
        ...(Array.isArray(node.oneOf) ? node.oneOf : []),
    ];
    return children.some(documented);
}

// ─── eval 的说明 ─────────────────────────────────────────────

/**
 * eval 说明里“可用的全局对象”一节（eval.md 输出 16）：这个会话里至少有一个方法在生效工具集的对象，每个一行摘要加文档地址。
 * 交回这一节与它的短哈希（工具的版本跟着它变，内核据此写 `tools-changed`）；没有对象时为 null。
 */
export function objectsSection(objects: readonly EvalObject[]): {readonly text: string; readonly hash: string} | null {
    if (objects.length === 0) return null;
    const lines = ["可用的全局对象（用之前先读文档地址里的方法签名）：", ...[...objects].sort((a, b) => a.name.localeCompare(b.name)).map((object) => `- \`${object.name}\`：${object.summary}（docs://eval/${object.name}.md）`)];
    const text = lines.join("\n");
    return {text, hash: createHash("sha256").update(text).digest("hex").slice(0, 8)};
}
