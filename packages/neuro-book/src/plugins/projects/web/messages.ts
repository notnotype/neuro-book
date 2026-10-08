/**
 * “打开项目”的文案。插件没有翻译表：中英两份写在一起，显示时按当前语言取一份，所以这里交出的是两种语言都已代入
 * 占位的 `LocalizedText`，不是字符串快照。
 */

import {formatText, localize} from "nbook/shared/localized-text";
import type {LocalizedText} from "nbook/shared/localized-text";
import type {ProjectRegisterFailure} from "nbook/shared/projects";

const MESSAGES = {
    title: {"zh-CN": "打开项目", "en-US": "Open Project"},
    retryTitle: {"zh-CN": "打开项目：登记失败（{reason}）", "en-US": "Open Project: registration failed ({reason})"},
    placeholder: {"zh-CN": "选择项目，或输入项目目录的路径", "en-US": "Pick a project, or type a project directory path"},
    empty: {"zh-CN": "还没有登记的项目：输入目录路径来登记", "en-US": "No registered projects yet: type a directory path to register one"},
    running: {"zh-CN": "{path} · 运行中", "en-US": "{path} · running"},
    registerAndOpen: {"zh-CN": "登记并打开 {path}", "en-US": "Register and open {path}"},
    listFailed: {"zh-CN": "列不出已登记的项目：{code}", "en-US": "Could not list registered projects: {code}"},
    unknownOutcome: {"zh-CN": "登记结果未知，再试一次即可：{cause}", "en-US": "The registration outcome is unknown; try again: {cause}"},
    notCompleted: {"zh-CN": "登记没有完成：{code}", "en-US": "The registration did not complete: {code}"},
} satisfies Record<string, LocalizedText>;

/** 登记失败的原因按失败码给出；服务端返回的说明原文只进诊断（docs/specs/runtime/projects.md 输出 10）。 */
const FAILURES: Record<ProjectRegisterFailure, LocalizedText> = {
    "invalid-path": {"zh-CN": "路径无效或不存在", "en-US": "the path is invalid or does not exist"},
    "not-directory": {"zh-CN": "不是目录", "en-US": "not a directory"},
    "not-accessible": {"zh-CN": "目录不可读写", "en-US": "the directory is not readable and writable"},
    "inside-state-root": {"zh-CN": "目录在应用的状态目录里", "en-US": "the directory is inside the application's state directory"},
    "identity-invalid": {"zh-CN": "目录里的项目身份文件无法读取", "en-US": "the project identity file in the directory cannot be read"},
    "identity-conflict": {"zh-CN": "与已登记的另一个项目冲突", "en-US": "conflicts with another registered project"},
    "registry-invalid": {"zh-CN": "项目登记表无法读取", "en-US": "the project registry cannot be read"},
    "write-failed": {"zh-CN": "写入失败", "en-US": "writing failed"},
};

export function projectsText(key: Exclude<keyof typeof MESSAGES, "retryTitle">, params: Readonly<Record<string, string>> = {}): LocalizedText {
    return formatText(MESSAGES[key], params);
}

/** 登记失败后重新打开选择时的标题：原因按失败码给出两种语言；不认识的失败码（服务端比页面新时）照原样显示。 */
export function retryTitle(code: string): LocalizedText {
    const reason = Object.hasOwn(FAILURES, code) ? FAILURES[code as ProjectRegisterFailure] : {"zh-CN": code, "en-US": code};
    return {
        "zh-CN": localize(formatText(MESSAGES.retryTitle, {reason: reason["zh-CN"]}), "zh-CN"),
        "en-US": localize(formatText(MESSAGES.retryTitle, {reason: reason["en-US"]}), "en-US"),
    };
}
