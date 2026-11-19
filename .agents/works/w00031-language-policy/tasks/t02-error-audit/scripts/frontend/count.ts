// 前端分区计数：用 TypeScript AST 按调用边界数错误与失败文字的汇点。只读源码，不写仓库。
// 用法：bun count.ts <worktree 的 packages 目录> <文件清单>
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
const require = createRequire("/home/<user>/CodeRepository/neuro-book/package.json");
const ts = require("typescript") as typeof import("typescript");
const sfc = require("@vue/compiler-sfc") as typeof import("@vue/compiler-sfc");

const [packages, listFile] = process.argv.slice(2) as [string, string];
const files = readFileSync(listFile, "utf8").split("\n").filter(Boolean).filter((f) => !/\.test\.ts$/.test(f) && !/\/testing\//.test(f) && !/\.typecheck\.ts$/.test(f));

const CJK = /[㐀-鿿]/;
type Lang = "zh" | "en" | "expr" | "none";
const areaOf = (f: string): string => {
    if (f.startsWith("neuro-book/src/web/")) return "app:src/web";
    if (f.startsWith("neuro-book/src/ui/")) return "app:src/ui";
    if (f.startsWith("neuro-book/src/sdk/")) return "app:src/sdk";
    if (f.startsWith("neuro-book/plugin-sdk/examples/")) return "app:plugin-sdk/examples";
    if (f.startsWith("neuro-book/src/plugins/lab/")) return "app:plugins/lab(开发场景)";
    if (f.startsWith("neuro-book/src/plugins/")) return "app:plugins/*/web";
    return f.split("/").slice(0, f.startsWith("dev-panel") || f.startsWith("nb-story") ? 3 : 1).join("/");
};

// 文字的语言：取节点里所有字面量片段；有 CJK 记 zh，只有 ASCII 字母记 en，没有字面量片段记 expr。
function langOf(node: import("typescript").Node | undefined): Lang {
    if (node === undefined) return "none";
    const parts: string[] = [];
    const walk = (n: import("typescript").Node): void => {
        // 函数调用的参数多是消息键或标识符（text("createInvalid")），不当作文字本身：整个调用按表达式记。
        if (ts.isCallExpression(n)) return;
        if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) parts.push(n.text);
        else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) parts.push(n.text);
        else if (ts.isObjectLiteralExpression(n)) {
            // {"zh-CN": ..., "en-US": ...} 这种双语表单独记。
            for (const p of n.properties) if (ts.isPropertyAssignment(p)) { const name = p.name.getText(); if (/zh-CN|en-US/.test(name)) { parts.push("\u0001BILINGUAL"); return; } }
        }
        ts.forEachChild(n, walk);
    };
    walk(node);
    if (parts.includes("\u0001BILINGUAL")) return "none"; // 另算
    if (parts.length === 0) return "expr";
    const joined = parts.join("");
    if (CJK.test(joined)) return "zh";
    if (/[A-Za-z]{3,}/.test(joined)) return "en";
    return "expr";
}
const isBilingual = (node: import("typescript").Node): boolean => {
    let found = false;
    const walk = (n: import("typescript").Node): void => {
        if (found) return;
        if (ts.isObjectLiteralExpression(n) && n.properties.some((p) => ts.isPropertyAssignment(p) && /zh-CN/.test(p.name.getText()))) { found = true; return; }
        ts.forEachChild(n, walk);
    };
    walk(node);
    return found;
};

type Row = {area: string; kind: string; lang: Lang | "bilingual"; file: string};
const rows: Row[] = [];
const add = (area: string, kind: string, lang: Lang | "bilingual", file: string) => rows.push({area, kind, lang, file});
const raw = {throwNew: 0, record: 0, okFalse: 0, catchClause: 0, consoleWE: 0, tplSink: 0, bilingualEntries: 0, emptyCatch: 0};

function scan(file: string, code: string, area: string): void {
    const sf = ts.createSourceFile(file, code, ts.ScriptTarget.ESNext, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (n: import("typescript").Node): void => {
        if (ts.isThrowStatement(n) && n.expression !== undefined && ts.isNewExpression(n.expression)) {
            const ctor = n.expression.expression.getText();
            const args = n.expression.arguments ?? [];
            // 自定义错误类（BootstrapRejected、NbThemeInstallError）的文字在最后一个参数，前面是码或 id。
            add(area, `throw new ${/Error$/.test(ctor) && !["NbThemeInstallError", "FormWidgetError"].includes(ctor) ? "*Error" : ctor}`, langOf(args.length > 1 && !/Error$/.test(ctor) ? args[args.length - 1] : (ctor === "NbThemeInstallError" ? args[args.length - 1] : args[0])), file);
        }
        if (ts.isClassDeclaration(n) && n.heritageClauses?.some((h) => h.types.some((t) => /Error$/.test(t.expression.getText())))) {
            // 自定义错误类：文字在构造函数的 super(...) 里。
            let sup: import("typescript").CallExpression | undefined;
            const find = (m: import("typescript").Node): void => { if (ts.isCallExpression(m) && m.expression.kind === ts.SyntaxKind.SuperKeyword) sup = m; ts.forEachChild(m, find); };
            find(n);
            add(area, `class ${n.name?.text ?? "?"} extends Error`, sup === undefined ? "none" : langOf((sup as import("typescript").CallExpression).arguments[0]), file);
        }
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "record") {
            const arg = n.arguments[0];
            if (arg !== undefined && ts.isObjectLiteralExpression(arg) && arg.properties.some((p) => p.name?.getText() === "level")) {
                const msg = arg.properties.find((p) => p.name?.getText() === "message");
                add(area, "diagnostics.record({level})", msg !== undefined && ts.isPropertyAssignment(msg) ? langOf(msg.initializer) : (msg !== undefined ? "expr" : "none"), file);
            }
        }
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === "console" && ["warn", "error"].includes(n.expression.name.text)) {
            add(area, "console.warn|error", langOf(n.arguments[0]), file);
        }
        if (ts.isObjectLiteralExpression(n)) {
            const okFalse = n.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText() === "ok" && p.initializer.kind === ts.SyntaxKind.FalseKeyword);
            if (okFalse !== undefined) {
                const text = n.properties.find((p) => ts.isPropertyAssignment(p) && ["reason", "detail", "message"].includes(p.name.getText())) as import("typescript").PropertyAssignment | undefined;
                const code = n.properties.some((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText() === "code");
                const kind = `{ok:false}${code ? "+code" : ""}${text !== undefined ? "+" + text.name.getText() : ""}`;
                add(area, kind, text === undefined ? "none" : isBilingual(text.initializer) ? "bilingual" : langOf(text.initializer), file);
            }
        }
        if (ts.isCatchClause(n)) {
            const empty = n.block.statements.length === 0;
            add(area, empty ? "catch(空体)" : "catch(有处理)", "none", file);
        }
        if (ts.isPropertyAssignment(n) && /^["']?zh-CN["']?$/.test(n.name.getText()) && n.parent.properties.length === 2) raw.bilingualEntries++;
        ts.forEachChild(n, visit);
    };
    visit(sf);
}

for (const f of files) {
    const path = `${packages}/${f}`;
    const text = readFileSync(path, "utf8");
    const area = areaOf(f);
    if (f.endsWith(".vue")) {
        const {descriptor} = sfc.parse(text, {filename: f});
        for (const block of [descriptor.script, descriptor.scriptSetup]) if (block !== null) scan(f + ".ts", block.content, area);
        const tpl = descriptor.template?.content ?? "";
        // 模板里直接显示或绑定 message/reason/detail/error 的位置：插值 {{ }} 与 :error|:message|:title 绑定。
        for (const m of tpl.matchAll(/\{\{([^}]*\.(?:message|reason|detail|error)\b[^}]*)\}\}/g)) add(area, "模板插值显示 .message|.reason|.detail|.error", "none", f), raw.tplSink++;
        for (const m of tpl.matchAll(/:(?:error|message|title|text)="([^"]*\.(?:message|reason|detail)\b[^"]*)"/g)) add(area, "模板绑定 :error|:message|:title=…message|reason|detail", "none", f), raw.tplSink++;
    } else scan(f, text, area);
}

import {writeFileSync} from "node:fs";
writeFileSync(new URL("rows.tsv", import.meta.url), rows.map((r) => [r.file, r.area, r.kind, r.lang].join("\t")).join("\n") + "\n");
const tally = new Map<string, number>();
for (const r of rows) { const k = `${r.area}\t${r.kind}\t${r.lang}`; tally.set(k, (tally.get(k) ?? 0) + 1); }
const out = [...tally.entries()].sort().map(([k, v]) => `${k}\t${v}`);
console.log("area\tkind\tlang\tcount");
console.log(out.join("\n"));
console.log("\n# 汇总（kind × lang）");
const byKind = new Map<string, number>();
for (const r of rows) { const k = `${r.kind}\t${r.lang}`; byKind.set(k, (byKind.get(k) ?? 0) + 1); }
for (const [k, v] of [...byKind.entries()].sort()) console.log(`${k}\t${v}`);
console.log("\n# 逐文件（{ok:false}、throw、record、class extends Error、模板汇点）");
const byFile = new Map<string, Map<string, number>>();
for (const r of rows) { if (/^(catch|console)/.test(r.kind)) continue; const m = byFile.get(r.file) ?? new Map(); m.set(`${r.kind}|${r.lang}`, (m.get(`${r.kind}|${r.lang}`) ?? 0) + 1); byFile.set(r.file, m); }
for (const [f, m] of [...byFile.entries()].sort()) console.log(f + "\t" + [...m.entries()].map(([k, v]) => `${k}=${v}`).join("; "));
console.log(`\n# 文件数 ${files.length}；AST 汇点总数 ${rows.length}`);
