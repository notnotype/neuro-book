/**
 * 结果区与内联输入的文字：把控制器给出的失败码、动作与逐项结果换成当前显示语言的说明。常见的失败码换成可读的原因，
 * 不认识的原样带上服务端的说明。
 */

import type {ItemResult} from "nbook/plugins/files/shared/contracts";
import type {DisplayLocale} from "nbook/shared/localized-text";

import type {ActionName, NameError, Notice, UnavailableReason} from "./controller";
import {explorerText} from "./messages";
import type {ExplorerMessage} from "./messages";

const ACTIONS: Readonly<Record<ActionName, ExplorerMessage>> = {
    "create": "actionCreate",
    "rename": "actionRename",
    "delete": "actionDelete",
    "create-content": "actionCreateContent",
    "convert": "actionConvert",
    "display": "actionDisplay",
    "include": "actionInclude",
    "drop": "actionDrop",
    "reorder": "actionReorder",
};

const CODES: Readonly<Record<string, ExplorerMessage>> = {
    "conflict": "codeConflict",
    "source-changed": "codeSourceChanged",
    "permission-denied": "codePermission",
    "busy": "codeBusy",
    "not-found": "codeNotFound",
    "unknown-outcome": "codeUnknown",
};

export function actionText(locale: DisplayLocale, action: ActionName): string {
    return explorerText(locale, ACTIONS[action]);
}

export function reasonText(locale: DisplayLocale, code: string, detail: string): string {
    const known = CODES[code];
    return known === undefined ? `${code}：${detail}` : explorerText(locale, known);
}

export function noticeText(locale: DisplayLocale, notice: Notice): string {
    switch (notice.kind) {
        case "editor-missing":
            return explorerText(locale, "editorMissing", {address: notice.address});
        case "open-failed":
            return explorerText(locale, "openFailed", {address: notice.address, reason: notice.reason});
        case "failed":
            return explorerText(locale, "actionFailed", {action: actionText(locale, notice.action), address: notice.address, reason: reasonText(locale, notice.code, notice.detail)});
        case "manifest":
            return notice.issues.map((issue) => explorerText(locale, "manifestNotUpdated", {action: actionText(locale, notice.action), path: issue.path, reason: issue.detail})).join("\n");
    }
}

export function nameErrorText(locale: DisplayLocale, error: NameError): string {
    switch (error.code) {
        case "empty":
            return explorerText(locale, "nameEmpty");
        case "invalid":
            return explorerText(locale, "nameInvalid");
        case "conflict":
            return explorerText(locale, "codeConflict");
        case "failed":
            return error.detail;
    }
}

export function itemText(locale: DisplayLocale, result: ItemResult): string {
    switch (result.status) {
        case "done":
            return explorerText(locale, "itemDone");
        case "failed":
            return explorerText(locale, "itemFailed", {reason: reasonText(locale, result.code, result.detail)});
        case "skipped":
            return explorerText(locale, "itemSkipped");
        case "not-run":
            return explorerText(locale, "itemNotRun");
        case "cancelled":
            return explorerText(locale, "itemCancelled");
    }
}

const UNAVAILABLE: Readonly<Record<UnavailableReason, ExplorerMessage>> = {
    "no-target": "unavailableNoTarget",
    "no-selection": "unavailableNoSelection",
    "not-applicable": "unavailableNotApplicable",
    "busy": "unavailableBusy",
    "stopped": "notReady",
};

export function unavailableText(locale: DisplayLocale, reason: UnavailableReason): string {
    return explorerText(locale, UNAVAILABLE[reason]);
}
