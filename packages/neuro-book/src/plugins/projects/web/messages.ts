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

/** 登记类失败的原因；不认识的失败码（服务端比页面新时）照原样显示。 */
export function registerFailureReason(code: string): LocalizedText {
    return Object.hasOwn(FAILURES, code) ? FAILURES[code as ProjectRegisterFailure] : {"zh-CN": code, "en-US": code};
}

/** 登记失败后重新打开选择时的标题：原因按失败码给出两种语言。 */
export function retryTitle(code: string): LocalizedText {
    const reason = registerFailureReason(code);
    return {
        "zh-CN": localize(formatText(MESSAGES.retryTitle, {reason: reason["zh-CN"]}), "zh-CN"),
        "en-US": localize(formatText(MESSAGES.retryTitle, {reason: reason["en-US"]}), "en-US"),
    };
}

/** 书架页的文案（docs/specs/workbench/bookshelf.md）。 */
const SHELF = {
    shelfFailed: {"zh-CN": "书架没取到：{reason}", "en-US": "Could not load the shelf: {reason}"},
    refreshFailed: {"zh-CN": "书架没有更新：{reason}", "en-US": "The shelf was not refreshed: {reason}"},
    versionChanged: {"zh-CN": "页面与服务端的版本不一致，请刷新页面", "en-US": "the page and the server are out of sync; reload the page"},
    unavailable: {"zh-CN": "服务端暂时不可用", "en-US": "the server is temporarily unavailable"},
    popupBlocked: {"zh-CN": "浏览器拦截了新标签页，请允许本站打开弹出窗口", "en-US": "The browser blocked the new tab; allow pop-ups for this site"},
    libraryTitle: {"zh-CN": "选择作品目录（服务端上的目录路径）", "en-US": "Choose the library folder (a directory path on the server)"},
    libraryPlaceholder: {"zh-CN": "输入新作品所在的目录路径，以后新建都放在这里", "en-US": "Type the directory path where new books will be created"},
    libraryUse: {"zh-CN": "使用 {path}", "en-US": "Use {path}"},
    libraryNotSaved: {"zh-CN": "作品已建成，但作品目录没有记住：{reason}", "en-US": "The book was created, but the library folder was not saved: {reason}"},
    addTitle: {"zh-CN": "加入已有目录", "en-US": "Add an Existing Folder"},
    addRetryTitle: {"zh-CN": "加入已有目录：登记失败（{reason}）", "en-US": "Add an Existing Folder: registration failed ({reason})"},
    addPlaceholder: {"zh-CN": "输入作品目录的路径（服务端上的路径）", "en-US": "Type the book directory path (on the server)"},
    addLabel: {"zh-CN": "加入 {path}", "en-US": "Add {path}"},
    createInvalid: {"zh-CN": "{field}不合规：{reason}", "en-US": "{field} is invalid: {reason}"},
    createNoLibrary: {"zh-CN": "还没有作品目录，先选一个", "en-US": "No library folder yet; choose one first"},
    createInvalidParent: {"zh-CN": "作品目录不可用：{reason}", "en-US": "The library folder cannot be used: {reason}"},
    createExists: {"zh-CN": "同名目录已存在（{path}）：改个书名，或用“加入已有目录”", "en-US": "A folder with this name already exists ({path}): change the title, or use “Add an Existing Folder”"},
    createWriteFailed: {"zh-CN": "写不进作品目录：{reason}", "en-US": "Could not write into the library folder: {reason}"},
    createRegisterFailed: {"zh-CN": "目录已建好（{path}），但登记失败：{reason}。可以用“加入已有目录”接着完成", "en-US": "The folder was created ({path}) but registration failed: {reason}. Use “Add an Existing Folder” to finish"},
    createUnknown: {"zh-CN": "新建的结果未知，书架已重新读取；没看到它就再试一次", "en-US": "The outcome is unknown; the shelf was reloaded. Try again if the book is missing"},
    updateFailed: {"zh-CN": "没有保存：{reason}", "en-US": "Not saved: {reason}"},
    removeRunning: {"zh-CN": "这部作品正在打开，或在关闭后的宽限期里；关闭它的全部窗口、等几分钟后再移除", "en-US": "This book is open, or still within the grace period after closing; close all its windows and try again in a few minutes"},
    removeFailed: {"zh-CN": "没有移出书架：{reason}", "en-US": "Not removed from the shelf: {reason}"},
    unknownProject: {"zh-CN": "作品已不在书架上", "en-US": "the book is no longer on the shelf"},
    readOnly: {"zh-CN": "作品的身份文件只读", "en-US": "the book's identity file is read-only"},
    identityInvalid: {"zh-CN": "作品的身份文件无法读取", "en-US": "the book's identity file cannot be read"},
    identityConflict: {"zh-CN": "作品目录里的身份与登记不一致", "en-US": "the identity in the folder does not match the registry"},
    fieldTitle: {"zh-CN": "书名", "en-US": "The title"},
    fieldDescription: {"zh-CN": "简介", "en-US": "The description"},
    fieldColor: {"zh-CN": "主题色", "en-US": "The color"},
} satisfies Record<string, LocalizedText>;

export function shelfText(key: keyof typeof SHELF, params: Readonly<Record<string, string>> = {}): LocalizedText {
    return formatText(SHELF[key], params);
}

/** 路由层与常见业务失败码的原因；不认识的码照原样显示。 */
export function failureReason(code: string, detail?: unknown): LocalizedText {
    switch (code) {
        case "version-changed":
            return SHELF.versionChanged;
        case "unavailable":
        case "not-provided":
        case "target-gone":
            return SHELF.unavailable;
        case "unknown-project":
            return SHELF.unknownProject;
        case "read-only":
            return SHELF.readOnly;
        case "identity-invalid":
            return SHELF.identityInvalid;
        case "identity-conflict":
            return SHELF.identityConflict;
        default: {
            const text = typeof detail === "object" && detail !== null && "detail" in detail && typeof detail.detail === "string" && detail.detail !== "" ? `${code}：${detail.detail}` : code;
            return {"zh-CN": text, "en-US": text};
        }
    }
}

/** 作品信息的字段名，给失败码 `invalid-metadata` 的提示用。 */
export function fieldName(field: string): LocalizedText {
    if (field === "title") return SHELF.fieldTitle;
    if (field === "description") return SHELF.fieldDescription;
    if (field === "color") return SHELF.fieldColor;
    return {"zh-CN": field, "en-US": field};
}
