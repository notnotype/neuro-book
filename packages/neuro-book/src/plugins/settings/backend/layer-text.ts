/**
 * 配置文件文本的解析与单键编辑（docs/specs/settings/configuration.md 输出 4、5、13）。只做文本，不碰文件。
 *
 * 用 `jsonc-parser`（VS Code 用的同一个库），但不照搬它的全部行为：它在出错时仍返回部分对象、对重复键不报错（取最后
 * 一个）、删除最后一个带尾随逗号的键会留下悬空逗号，删除独占一行的键还会重排相邻的缩进。所以解析一律先看错误、再
 * 在语法树上查重复键；编辑之后重新解析，通过与读取相同的检查才交出新文本。
 */

import {applyEdits, createScanner, findNodeAtLocation, getNodeValue, modify, parseTree, printParseErrorCode, SyntaxKind} from "jsonc-parser";
import type {FormattingOptions, Node, ParseError} from "jsonc-parser";
import {Value} from "typebox/value";

import {freezeJson, isJson} from "nbook/shared/settings";
import type {SettingDeclaration, SettingLayer} from "nbook/shared/settings";

import {canonical} from "../shared/layers";
import type {LayerEdit, LayerProblem} from "../shared/layers";

const BOM = "﻿";
const PARSE_OPTIONS = {allowTrailingComma: true, disallowComments: false, allowEmptyContent: true} as const;

export type ParsedLayer =
    | {readonly status: "ok"; readonly values: Readonly<Record<string, unknown>>; readonly problems: ReadonlyArray<LayerProblem>}
    | {readonly status: "invalid"; readonly detail: string};

/**
 * 解析一层的文件文本：空文本、只有空白或注释为空层；无法解析、根不是对象、任意深度出现重复键为 `invalid`。没有声明的键
 * 留在文件里、不进结果也不报问题；不符合 schema 或本层不允许的键进 `problems`（不含值）。
 */
export function parseLayerText(text: string, declarations: ReadonlyMap<string, SettingDeclaration>, layer: SettingLayer): ParsedLayer {
    const tree = parseRoot(text);
    if (!tree.ok) return {status: "invalid", detail: tree.detail};
    const values: Record<string, unknown> = {};
    const problems: LayerProblem[] = [];
    for (const property of tree.root?.children ?? []) {
        const [keyNode, valueNode] = property.children ?? [];
        if (keyNode === undefined || valueNode === undefined) continue;
        const key = keyNode.value as string;
        const declaration = declarations.get(key);
        if (declaration === undefined) continue;
        if (!declaration.layers.includes(layer)) {
            problems.push({key, reason: "layer-not-allowed"});
            continue;
        }
        const value: unknown = getNodeValue(valueNode);
        // 超出范围的数字（例如 1e400）解析成 Infinity，不是 JSON 能如实表示的值。
        if (!isJson(value) || !Value.Check(declaration.schema, value)) {
            problems.push({key, reason: "invalid-value"});
            continue;
        }
        values[key] = value;
    }
    problems.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
    return {status: "ok", values: freezeJson(values), problems: Object.freeze(problems)};
}

export type EditResult = {readonly ok: true; readonly text: string} | {readonly ok: false; readonly detail: string};

/**
 * 只改一个键：替换已有键的值不动其它文本；新增键追加在最后一个键之后（多行的对象另起一行，沿用最后一个键的缩进与原文
 * 的换行；单行的对象接在同一行），只在最后一个键的值后补逗号，其余文本不动；删除独占几行的键整行删去，其余行不动，
 * 与别的内容同在一行的键交给 `jsonc-parser`。BOM 原样保留。编辑后的文本不合法、或这个键的值不是要写的值时不交出。
 */
export function editLayerText(text: string, key: string, edit: LayerEdit): EditResult {
    const bom = text.startsWith(BOM);
    const body = bom ? text.slice(BOM.length) : text;
    const before = parseRoot(body);
    if (!before.ok) return {ok: false, detail: before.detail};
    const property = before.root === undefined ? undefined : findNodeAtLocation(before.root, [key])?.parent;
    let next: string;
    if (edit.kind === "delete") {
        if (property === undefined) return {ok: true, text};
        next = deleteOwnLines(body, property) ?? withoutDanglingCommas(applyEdits(body, modify(body, [key], undefined, {formattingOptions: formatting(body)})));
    } else if (property === undefined && before.root !== undefined && (before.root.children?.length ?? 0) > 0) {
        next = appendProperty(body, before.root, key, edit.value);
    } else {
        next = withoutDanglingCommas(applyEdits(body, modify(body, [key], edit.value, {formattingOptions: formatting(body)})));
    }
    const after = parseRoot(next);
    if (!after.ok) return {ok: false, detail: `编辑后的文本不合法：${after.detail}`};
    const node = after.root === undefined ? undefined : findNodeAtLocation(after.root, [key]);
    const written = node === undefined ? undefined : canonical(getNodeValue(node));
    const expected = edit.kind === "delete" ? undefined : canonical(edit.value);
    if (written !== expected) return {ok: false, detail: `编辑后键 ${key} 的值不是要写的值`};
    return {ok: true, text: bom ? BOM + next : next};
}

type RootResult = {readonly ok: true; readonly root: Node | undefined} | {readonly ok: false; readonly detail: string};

/** 解析并做读取的三项检查；根为 undefined 表示空文本或只有注释。BOM 由调用方先去掉。 */
function parseRoot(text: string): RootResult {
    const body = text.startsWith(BOM) ? text.slice(BOM.length) : text;
    const errors: ParseError[] = [];
    const root = parseTree(body, errors, PARSE_OPTIONS);
    const first = errors[0];
    if (first !== undefined) return {ok: false, detail: `第 ${String(lineOf(body, first.offset))} 行：${printParseErrorCode(first.error)}`};
    if (root === undefined) return {ok: true, root: undefined};
    if (root.type !== "object") return {ok: false, detail: "根不是对象"};
    const duplicate = firstDuplicate(root);
    if (duplicate !== null) return {ok: false, detail: `键 ${duplicate} 出现了多次`};
    return {ok: true, root};
}

function firstDuplicate(node: Node): string | null {
    if (node.type === "object") {
        const seen = new Set<string>();
        for (const property of node.children ?? []) {
            const name = property.children?.[0]?.value as string | undefined;
            if (name === undefined) continue;
            if (seen.has(name)) return name;
            seen.add(name);
        }
    }
    for (const child of node.children ?? []) {
        const found = firstDuplicate(child);
        if (found !== null) return found;
    }
    return null;
}

function lineOf(text: string, offset: number): number {
    let line = 1;
    for (let index = 0; index < offset && index < text.length; index += 1) if (text[index] === "\n") line += 1;
    return line;
}

/**
 * 缩进按原文：第一行有缩进的键决定用制表符还是几个空格；没有可参照的行时用 4 个空格。换行风格不用给，`jsonc-parser`
 * 自己沿用原文的。
 */
function formatting(text: string): FormattingOptions {
    const indent = /^([ \t]+)"/mu.exec(text)?.[1];
    if (indent === undefined) return {insertSpaces: true, tabSize: 4};
    if (indent.startsWith("\t")) return {insertSpaces: false, tabSize: 4};
    return {insertSpaces: true, tabSize: indent.length};
}

/**
 * `jsonc-parser` 新增键时会格式化相邻文本，并把新键插在最后一个键的行尾注释之前，注释就跟到了新键上。这里自己插：
 * 逗号紧跟最后一个值，新键放在这一行的尾随注释之后（遇到换行或 `}` 为止）；原来就有尾随逗号时新键也带上。
 */
function appendProperty(text: string, root: Node, key: string, value: unknown): string {
    const last = root.children!.at(-1)!;
    const valueEnd = last.offset + last.length;
    const scanner = createScanner(text, false);
    scanner.setPosition(valueEnd);
    let trailingComma = false;
    let insertAt = valueEnd;
    for (let kind = scanner.scan(); kind !== SyntaxKind.EOF; kind = scanner.scan()) {
        if (kind === SyntaxKind.LineBreakTrivia || kind === SyntaxKind.CloseBraceToken) break;
        if (kind === SyntaxKind.CommaToken) trailingComma = true;
        insertAt = scanner.getTokenOffset() + scanner.getTokenLength();
    }
    const lineStart = text.lastIndexOf("\n", last.offset - 1) + 1;
    const leading = text.slice(lineStart, last.offset);
    const multiline = lineStart > root.offset && leading.trim() === "";
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const unit = formatting(text);
    const encoded = JSON.stringify(value, null, unit.insertSpaces ? unit.tabSize : "\t");
    const property = `${JSON.stringify(key)}: ${multiline ? encoded.replaceAll("\n", eol + leading) : JSON.stringify(value)}${trailingComma ? "," : ""}`;
    const inserted = multiline ? `${eol}${leading}${property}` : ` ${property}`;
    const withProperty = text.slice(0, insertAt) + inserted + text.slice(insertAt);
    return trailingComma ? withProperty : withProperty.slice(0, valueEnd) + "," + withProperty.slice(valueEnd);
}

/**
 * 键独占几行时整行删去：行首到键之前只有空白，键之后到行尾只有可选的逗号、空白与行注释。删的是最后一个键时，
 * 前一个键的逗号留成尾随逗号，读取允许它。不满足条件时返回 null。
 */
function deleteOwnLines(text: string, property: Node): string | null {
    const start = text.lastIndexOf("\n", property.offset - 1) + 1;
    if (text.slice(start, property.offset).trim() !== "") return null;
    const end = property.offset + property.length;
    const newline = text.indexOf("\n", end);
    const lineEnd = newline === -1 ? text.length : newline + 1;
    if (!/^[ \t]*,?[ \t]*(\/\/[^\n]*)?\r?\n?$/u.test(text.slice(end, lineEnd))) return null;
    return text.slice(0, start) + text.slice(lineEnd);
}

/** 去掉紧跟在 `{` 或另一个逗号之后的逗号（`jsonc-parser` 删掉唯一一个带尾随逗号的键后留下的）。 */
function withoutDanglingCommas(text: string): string {
    const scanner = createScanner(text, false);
    const remove: number[] = [];
    let previous: SyntaxKind | null = null;
    for (let kind = scanner.scan(); kind !== SyntaxKind.EOF; kind = scanner.scan()) {
        if (kind === SyntaxKind.Trivia || kind === SyntaxKind.LineBreakTrivia || kind === SyntaxKind.LineCommentTrivia || kind === SyntaxKind.BlockCommentTrivia) continue;
        if (kind === SyntaxKind.CommaToken && (previous === SyntaxKind.OpenBraceToken || previous === SyntaxKind.CommaToken)) {
            remove.push(scanner.getTokenOffset());
            continue;
        }
        previous = kind;
    }
    let result = text;
    for (const offset of remove.reverse()) result = result.slice(0, offset) + result.slice(offset + 1);
    return result;
}
