/**
 * 持久化字段此刻的问题，供界面给出唯一一种提示与操作（docs/specs/state/store.md 的读取与保存失败）：读不到（正在用
 * 缺省值）、记录损坏或版本不认识（不覆盖，只能整份重置），或有修改没保存上（重试或放弃）。资源管理器与 Lab 的偏好共用。
 */

export type FieldProblem =
    | {readonly kind: "unread"; readonly code: string}
    | {readonly kind: "protected"; readonly code: string}
    | {readonly kind: "unsaved"; readonly code: string};

type FieldView = {readonly failure: string | null; readonly base: {readonly status: string} | null; readonly save: {readonly state: string; readonly code?: string}};

/** 一份字段此刻的问题；没有为 null。 */
export function fieldProblem(field: FieldView): FieldProblem | null {
    if (field.failure !== null) return {kind: "unread", code: field.failure};
    if (field.base !== null && (field.base.status === "corrupt" || field.base.status === "unsupported-version")) return {kind: "protected", code: field.base.status};
    if ((field.save.state === "failed" || field.save.state === "unknown") && field.save.code !== undefined) return {kind: "unsaved", code: field.save.code};
    return null;
}
