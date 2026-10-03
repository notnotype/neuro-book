import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {createRequire} from "node:module";
import type * as TypeScript from "typescript";

const require = createRequire(import.meta.url);
const ts = require("typescript") as typeof TypeScript;

type ProfileTypeEntry = {
    profileKey: string;
    relativePath: string;
};

type PrepareMode = "system" | "user" | "all";

type PrepareConfig = {
    roots: string[];
    outputPath: string;
    builtinKeys: Set<string>;
};

const SYSTEM_PROFILE_ROOT = path.resolve(process.cwd(), "assets/workspace/.nbook/agent/profiles");
const USER_PROFILE_ROOT = path.resolve(process.cwd(), "workspace/.nbook/agent/profiles");
const OUTPUT_PATH = path.resolve(process.cwd(), "server/agent/profiles/dynamic-profile-types.generated.ts");
const BUILTIN_PROFILE_KEYS = new Set([
    "leader.default",
    "leader.assets",
]);

/**
 * 生成动态 profile 的开发期类型索引。
 */
async function main(): Promise<void> {
    const mode: PrepareMode = process.argv.includes("--user")
        ? "user"
        : process.argv.includes("--all")
            ? "all"
            : "system";
    const config = createConfig(mode);
    const entries = await readProfileTypeEntries(config);
    await fs.mkdir(path.dirname(config.outputPath), {recursive: true});
    await fs.writeFile(config.outputPath, renderTypeIndex(entries), "utf-8");
    console.log(`prepared ${entries.length} dynamic profile type entries -> ${path.relative(process.cwd(), config.outputPath)}`);
}

/**
 * 根据 roots mode 生成脚本配置。
 */
function createConfig(mode: PrepareMode): PrepareConfig {
    return {
        roots: mode === "all"
            ? [SYSTEM_PROFILE_ROOT, USER_PROFILE_ROOT]
            : mode === "user"
                ? [USER_PROFILE_ROOT]
                : [SYSTEM_PROFILE_ROOT],
        outputPath: OUTPUT_PATH,
        builtinKeys: BUILTIN_PROFILE_KEYS,
    };
}

/**
 * 读取 profile 类型索引条目。
 */
async function readProfileTypeEntries(config: PrepareConfig): Promise<ProfileTypeEntry[]> {
    const filesByProfileKey = new Map<string, ProfileTypeEntry>();
    for (const root of config.roots) {
        for (const filePath of await listProfileFiles(root)) {
            const manifest = readProfileManifest(await fs.readFile(filePath, "utf-8"));
            if (!manifest || config.builtinKeys.has(manifest.key)) {
                continue;
            }
            filesByProfileKey.set(manifest.key, {
                profileKey: manifest.key,
                relativePath: toImportPath(filePath),
            });
        }
    }
    return [...filesByProfileKey.values()].sort((left, right) => left.profileKey.localeCompare(right.profileKey));
}

/**
 * 列出 profile 文件。
 */
async function listProfileFiles(root: string): Promise<string[]> {
    const files: string[] = [];
    await appendProfileFiles(root, files);
    return files;
}

/**
 * 递归追加 profile 文件。
 */
async function appendProfileFiles(root: string, files: string[]): Promise<void> {
    let entries: Array<import("node:fs").Dirent>;
    try {
        entries = await fs.readdir(root, {withFileTypes: true});
    } catch (error) {
        if (isMissingPathError(error)) {
            return;
        }
        throw error;
    }
    for (const entry of entries) {
        const filePath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            await appendProfileFiles(filePath, files);
            continue;
        }
        if (entry.isFile() && entry.name.endsWith(".profile.tsx")) {
            files.push(filePath);
        }
    }
}

/**
 * 从源码中静态读取 profileManifest。
 */
function readProfileManifest(source: string): {key: string} | null {
    const sourceFile = ts.createSourceFile("profile.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    for (const statement of sourceFile.statements) {
        if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) {
            continue;
        }
        for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "profileManifest" || !declaration.initializer) {
                continue;
            }
            const objectLiteral = unwrapAsConst(declaration.initializer);
            if (!ts.isObjectLiteralExpression(objectLiteral)) {
                return null;
            }
            const key = readStringProperty(objectLiteral, "key");
            if (key) {
                return {key};
            }
        }
    }
    return null;
}

/**
 * 判断节点是否有 export 修饰符。
 */
function hasExportModifier(node: TypeScript.Node): boolean {
    return Boolean(ts.getCombinedModifierFlags(node as TypeScript.Declaration) & ts.ModifierFlags.Export);
}

/**
 * 去掉 `as const`。
 */
function unwrapAsConst(expression: TypeScript.Expression): TypeScript.Expression {
    return ts.isAsExpression(expression) ? expression.expression : expression;
}

/**
 * 读取对象字面量字符串属性。
 */
function readStringProperty(objectLiteral: TypeScript.ObjectLiteralExpression, name: string): string | null {
    for (const property of objectLiteral.properties) {
        if (!ts.isPropertyAssignment(property)) {
            continue;
        }
        const propertyName = property.name;
        const isNameMatched = ts.isIdentifier(propertyName)
            ? propertyName.text === name
            : ts.isStringLiteral(propertyName)
                ? propertyName.text === name
                : false;
        if (isNameMatched && ts.isStringLiteral(property.initializer)) {
            return property.initializer.text;
        }
    }
    return null;
}

/**
 * 渲染类型索引源码。
 */
function renderTypeIndex(entries: ProfileTypeEntry[]): string {
    return [
        "/**",
        " * 动态 profile 类型索引。",
        " *",
        " * 该文件由 `bun scripts/build/prepare-profile-types.ts` 生成。",
        " * 运行时不依赖它；它只服务源码开发时按自定义 profile key 推导 Input / Output。",
        " */",
        "export type DynamicProfileInputMap = {",
        ...entries.map((entry) => `    ${JSON.stringify(entry.profileKey)}: import(${JSON.stringify(entry.relativePath)}).Input;`),
        "};",
        "",
        "export type DynamicProfileOutputMap = {",
        ...entries.map((entry) => `    ${JSON.stringify(entry.profileKey)}: import(${JSON.stringify(entry.relativePath)}).Output;`),
        "};",
        "",
    ].join("\n");
}

/**
 * 转为可以被 TS import() 使用的项目别名路径。
 */
function toImportPath(filePath: string): string {
    return `nbook/${path.relative(process.cwd(), filePath).replace(/\\/g, "/")}`;
}

/**
 * 判断路径缺失。
 */
function isMissingPathError(error: unknown): boolean {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

await main();
