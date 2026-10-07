/** “打开项目”的文案。插件没有翻译表：中英两份写在一起，按显示语言取一份。 */

import {DISPLAY_LOCALE, localize} from "nbook/shared/localized-text";
import type {LocalizedText} from "nbook/shared/localized-text";

const MESSAGES = {
    title: {"zh-CN": "打开项目", "en-US": "Open Project"},
    retryTitle: {"zh-CN": "打开项目：登记失败（{reason}）", "en-US": "Open Project: registration failed ({reason})"},
    placeholder: {"zh-CN": "选择项目，或输入项目目录的路径", "en-US": "Pick a project, or type a project directory path"},
    empty: {"zh-CN": "还没有登记的项目：输入目录路径来登记", "en-US": "No registered projects yet: type a directory path to register one"},
    running: {"zh-CN": "运行中", "en-US": "running"},
    registerAndOpen: {"zh-CN": "登记并打开 {path}", "en-US": "Register and open {path}"},
} satisfies Record<string, LocalizedText>;

export function projectsText(key: keyof typeof MESSAGES, params: Readonly<Record<string, string>> = {}): string {
    return localize(MESSAGES[key], DISPLAY_LOCALE).replace(/\{(\w+)\}/gu, (placeholder, name: string) => params[name] ?? placeholder);
}
