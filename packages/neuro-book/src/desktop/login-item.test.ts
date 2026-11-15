/** 开机自启登记的解析（login-item.ts）：`reg query` 列出整个 Run 键时，按值名找数据。 */

import {describe, expect, it} from "bun:test";

import {runValueOf} from "./login-item";

const LISTING = [
    "",
    "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
    "    OneDrive    REG_SZ    \"C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe\" /background",
    "    io.github.notnotype.neurobook    REG_SZ    \"C:\\Users\\me\\AppData\\Local\\io.github.notnotype.neurobook\\stable\\app\\bin\\launcher.exe\"",
    "    Some App    REG_EXPAND_SZ    %LOCALAPPDATA%\\Some App\\app.exe",
    "",
].join("\r\n");

describe("开机自启登记的解析", () => {
    it("按值名找到数据：REG_SZ、REG_EXPAND_SZ、值名与数据里有空格", () => {
        expect(runValueOf(LISTING, "io.github.notnotype.neurobook")).toBe("\"C:\\Users\\me\\AppData\\Local\\io.github.notnotype.neurobook\\stable\\app\\bin\\launcher.exe\"");
        expect(runValueOf(LISTING, "Some App")).toBe("%LOCALAPPDATA%\\Some App\\app.exe");
        expect(runValueOf(LISTING, "OneDrive")).toBe("\"C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe\" /background");
    });

    it("没有这个值名时为 null；同名前缀不算", () => {
        expect(runValueOf(LISTING, "io.github.notnotype.neurobook.t04test")).toBeNull();
        expect(runValueOf(LISTING, "io.github")).toBeNull();
        expect(runValueOf("", "anything")).toBeNull();
    });
});
