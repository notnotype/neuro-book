// 由 HEAD 的旧字面量与键映射生成两份目录与“文字没变”测试用的对照表常量。
import {readFileSync, writeFileSync} from "node:fs";
const old: Record<string, {"zh-CN": string; "en-US": string}> = JSON.parse(readFileSync("/tmp/w00028-t03/7a/old.json", "utf8"));
const PLURAL = new Set(["row.entryProblems", "row.rejectedProblems", "row.catalogProblems"]);
const map: Array<[string, string]> = [
    ["SECTION.title", "settingsPages.installed.title"],
    ["SECTION.description", "settingsPages.installed.description"],
    ["TEXT.restartNote", "page.restartNote"],
    ["TEXT.pendingNote", "page.pendingNote"],
    ["TEXT.safeMode", "page.safeMode"],
    ["TEXT.problemsSnapshot", "page.problemsSnapshot"],
    ["TEXT.loading", "page.loading"],
    ["TEXT.retry", "page.retry"],
    ["TEXT.pathLabel", "install.pathLabel"],
    ["TEXT.pathPlaceholder", "install.pathPlaceholder"],
    ["TEXT.install", "install.start"],
    ["TEXT.thirdPartyHeading", "groups.thirdParty"],
    ["TEXT.builtinHeading", "groups.builtin"],
    ["TEXT.noThirdParty", "groups.noThirdParty"],
    ["TEXT.builtin", "row.builtin"],
    ["TEXT.toggle", "row.toggle"],
    ["TEXT.uninstall", "row.uninstall"],
    ["TEXT.uninstallNamed", "row.uninstallNamed"],
    ["TEXT.entryProblems", "row.entryProblems"],
    ["TEXT.rejectedProblems", "row.rejectedProblems"],
    ["TEXT.catalogProblems", "row.catalogProblems"],
    ["PENDING_TEXT.install", "row.pending.install"],
    ["PENDING_TEXT.uninstall", "row.pending.uninstall"],
    ["PENDING_TEXT.enable", "row.pending.enable"],
    ["PENDING_TEXT.disable", "row.pending.disable"],
    ["PENDING_TEXT.upgrade", "row.pending.upgrade"],
    ["TEXT.pendingDowngrade", "row.pending.downgrade"],
    ...["manifest-invalid", "entry-missing", "unreadable", "incompatible-engine", "safe-mode"].map((code): [string, string] => [`NOT_LOADED.${code}.text`, `row.notLoaded.${code}`]),
    ["TEXT.entryFailed", "problems.entryFailed"],
    ["TEXT.entryBlocked", "problems.entryBlocked"],
    ["TEXT.contributionRejected", "problems.contributionRejected"],
    ["TEXT.catalogUnavailable", "problems.catalogUnavailable"],
    ["TEXT.withDetail", "problems.withDetail"],
    ...["missing-service", "location-mismatch", "provider-blocked", "provider-failed", "dependency-cycle", "version-mismatch"].map((r): [string, string] => [`BLOCKED_REASON.${r}`, `problems.blockedReasons.${r}`]),
    ...["not-found", "invalid", "fetch-failed"].map((r): [string, string] => [`CATALOG_REASON.${r}`, `problems.catalogReasons.${r}`]),
    ...["invalid-declaration", "implementation-required", "implementation-not-accepted", "duplicate-contribution"].map((r): [string, string] => [`REJECTED_REASON.${r}`, `problems.rejectedReasons.${r}`]),
    ...["install", "upgrade", "downgrade"].flatMap((rel): Array<[string, string]> => [[`PREVIEW_TEXT.${rel}.title`, `preview.${rel}.title`], [`PREVIEW_TEXT.${rel}.confirm`, `preview.${rel}.confirm`]]),
    ["TEXT.downgrade", "preview.downgradeWarning"],
    ["TEXT.blocked", "preview.blockedTitle"],
    ["TEXT.blockedVersion", "preview.blockedReasons.version-mismatch"],
    ["TEXT.blockedService", "preview.blockedReasons.missing-service"],
    ["TEXT.blockedCycle", "preview.blockedReasons.dependency-cycle"],
    ["TEXT.blockedProvider", "preview.blockedReasons.provider-blocked"],
    ["TEXT.unchecked", "preview.unchecked"],
    ["TEXT.trust", "preview.trust"],
    ["TEXT.uninstallTitle", "uninstall.title"],
    ["TEXT.uninstallBody", "uninstall.body"],
    ["TEXT.cancel", "dialog.cancel"],
    ...["manifest-invalid", "catalog-invalid", "incompatible-engine", "already-installed", "uninstall-pending", "path-rejected", "entry-missing", "copy-failed", "not-installed", "builtin-fixed", "registry-failed"].map((code): [string, string] => [`FAILURE_TEXT.${code}`, `errors.${code}`]),
    ...["unavailable", "timeout", "unknown-outcome"].map((code): [string, string] => [`FAILURE_TEXT.${code}`, `remoteErrors.${code}`]),
    ["TEXT.unknownFailure", "failures.unknown"],
];
const usedOld = new Set(map.map(([o]) => o));
const missing = Object.keys(old).filter((k) => !usedOld.has(k));
if (missing.length > 0 || usedOld.size !== map.length || map.some(([o]) => !(o in old))) throw new Error(`mapping mismatch: ${missing.join(",")}`);
if (new Set(map.map(([, k]) => k)).size !== map.length) throw new Error("dup new key");
const convert = (s: string) => s.replace(/\{(\w+)\}/gu, "{{$1}}");
const plurals: Record<string, string[]> = {"zh-CN": ["other"], "en-US": ["one", "other"]};
function set(target: Record<string, unknown>, path: string, value: string) {
    const parts = path.split(".");
    let node = target;
    for (const part of parts.slice(0, -1)) node = (node[part] ??= {}) as Record<string, unknown>;
    if (parts.at(-1)! in node) throw new Error(`collision ${path}`);
    node[parts.at(-1)!] = value;
}
for (const locale of ["zh-CN", "en-US"] as const) {
    const catalog: Record<string, unknown> = {};
    for (const [o, key] of map) {
        const value = convert(old[o]![locale]);
        if (PLURAL.has(key)) for (const category of plurals[locale]!) set(catalog, `${key}_${category}`, value);
        else set(catalog, key, value);
    }
    writeFileSync(`/home/<user>/CodeRepository/neuro-book/.worktree/w00028-i18n/packages/neuro-book/src/plugins/plugins/locales/${locale}.json`, `${JSON.stringify(catalog, null, 4)}\n`);
}
// 对照表常量（旧写法 {name}，未转换）
const lines = map.map(([o, key]) => `    ${JSON.stringify(key)}: {"zh-CN": ${JSON.stringify(old[o]!["zh-CN"])}, "en-US": ${JSON.stringify(old[o]!["en-US"])}},`);
writeFileSync("/tmp/w00028-t03/7a/legacy-table.ts.txt", `${lines.join("\n")}\n`);
console.log("keys", map.length);
