/**
 * 失败码到文字的对照（docs/specs/runtime/projects.md 输出 10、docs/specs/workbench/bookshelf.md 的“失败与恢复”）：
 * 服务端只给码和说明原文，说明原文只进诊断，界面上的原因按码从目录里取。表按码查键，查不到就是不认识的码，照原样显示；
 * 不拼 `errors.${code}` 去碰运气。
 */

import type {Text} from "@notnotype/nb-ui/text";

import type {ProjectRegisterFailure} from "nbook/shared/projects";
import type {TextResolver} from "nbook/shared/localized-text";

import {isRemoteFailureCode, remoteFailureText} from "nbook/web/failure-text";

import {projectsText} from "../shared/text";
import type {ProjectsTextKey} from "../shared/text";

/** 登记类失败（`register-failed` 的 `reason`、`invalid-parent` 的 `reason`）的原因。 */
export const REGISTER_FAILURE_KEYS = {
    "invalid-path": "registerFailures.invalid-path",
    "not-directory": "registerFailures.not-directory",
    "not-accessible": "registerFailures.not-accessible",
    "inside-state-root": "registerFailures.inside-state-root",
    "identity-invalid": "registerFailures.identity-invalid",
    "identity-conflict": "registerFailures.identity-conflict",
    "registry-invalid": "registerFailures.registry-invalid",
    "write-failed": "registerFailures.write-failed",
} as const satisfies Readonly<Record<ProjectRegisterFailure, ProjectsTextKey>>;

/** 登记失败后重新打开选择时的标题：原因写进整句，按失败码取一句。 */
const RETRY_TITLE_KEYS = {
    "invalid-path": "open.retryTitle.invalid-path",
    "not-directory": "open.retryTitle.not-directory",
    "not-accessible": "open.retryTitle.not-accessible",
    "inside-state-root": "open.retryTitle.inside-state-root",
    "identity-invalid": "open.retryTitle.identity-invalid",
    "identity-conflict": "open.retryTitle.identity-conflict",
    "registry-invalid": "open.retryTitle.registry-invalid",
    "write-failed": "open.retryTitle.write-failed",
} as const satisfies Readonly<Record<ProjectRegisterFailure, ProjectsTextKey>>;

/** 作品远程服务自己声明的业务失败码（`projectsRemoteContract` 的 `errors`）里，页面有专门说法的几个。 */
export const BUSINESS_FAILURE_KEYS = {
    "unknown-project": "errors.unknown-project",
    "read-only": "errors.read-only",
    "identity-invalid": "errors.identity-invalid",
    "identity-conflict": "errors.identity-conflict",
} as const satisfies Readonly<Record<string, ProjectsTextKey>>;

/** 作品信息的字段名，给失败码 `invalid-metadata` 的提示用。 */
const FIELD_KEYS = {
    title: "shelf.fields.title",
    description: "shelf.fields.description",
    color: "shelf.fields.color",
    cover: "shelf.fields.cover",
} as const satisfies Readonly<Record<string, ProjectsTextKey>>;

function lookup<Table extends Readonly<Record<string, ProjectsTextKey>>>(table: Table, code: string): Table[keyof Table] | null {
    return Object.hasOwn(table, code) ? table[code as keyof Table] : null;
}

/** 登记类失败的原因；不认识的失败码（服务端比页面新时）照原样显示。 */
export function registerFailureReason(text: TextResolver, code: string): string {
    const key = lookup(REGISTER_FAILURE_KEYS, code);
    return key === null ? code : text.t(projectsText(key));
}

/** 登记失败后重新打开选择时的标题；不认识的失败码把码放进整句。随语言切换更新，所以交出引用而不是字符串。 */
export function retryTitle(code: string): Text {
    const key = lookup(RETRY_TITLE_KEYS, code);
    return key === null ? projectsText("open.retryTitle.unknown", {reason: code}) : projectsText(key);
}

/**
 * 业务失败码与路由失败码的原因：业务码查本插件的表，路由码用宿主的文案。都不认识的码照原样显示，服务端说明（`detail`）
 * 有就跟在码后面：书架上的这些提示还没有“详情”可放，改按码兜底、原文进详情归 w00031 t08。
 */
export function failureReason(text: TextResolver, code: string, detail?: unknown): string {
    const key = lookup(BUSINESS_FAILURE_KEYS, code);
    if (key !== null) return text.t(projectsText(key));
    if (isRemoteFailureCode(code)) return text.t(remoteFailureText(code));
    return typeof detail === "object" && detail !== null && "detail" in detail && typeof detail.detail === "string" && detail.detail !== "" ? `${code}：${detail.detail}` : code;
}

/** 字段名；不认识的字段照原样显示。 */
export function fieldName(text: TextResolver, field: string): string {
    const key = lookup(FIELD_KEYS, field);
    return key === null ? field : text.t(projectsText(key));
}
