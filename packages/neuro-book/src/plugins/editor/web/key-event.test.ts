/** 键盘事件与键位写法的匹配（docs/specs/workbench/markdown-editing.md 输出 28 的快捷键）。 */

import {describe, expect, it} from "bun:test";

import type {KeyEventLike} from "../shared/contracts";
import {keyEventMatches} from "./key-event";

const event = (overrides: Partial<KeyEventLike> & {altGraph?: boolean} = {}): KeyEventLike => {
    const {altGraph = false, ...rest} = overrides;
    return {code: "KeyM", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, getModifierState: (key) => altGraph && key === "AltGraph", ...rest};
};

describe("Mod+Alt+M", () => {
    it("非 macOS 是 Ctrl+Alt+M，macOS 是 ⌘⌥M，不带 Shift", () => {
        expect(keyEventMatches("Mod+Alt+M", "other", event({ctrlKey: true, altKey: true}))).toBe(true);
        expect(keyEventMatches("Mod+Alt+M", "other", event({metaKey: true, altKey: true}))).toBe(false);
        expect(keyEventMatches("Mod+Alt+M", "mac", event({metaKey: true, altKey: true}))).toBe(true);
        expect(keyEventMatches("Mod+Alt+M", "mac", event({ctrlKey: true, altKey: true}))).toBe(false);
        expect(keyEventMatches("Mod+Alt+M", "other", event({ctrlKey: true, altKey: true, shiftKey: true}))).toBe(false);
        expect(keyEventMatches("Mod+Alt+M", "other", event({ctrlKey: true}))).toBe(false);
    });

    it("按物理键位：macOS 上 Option+M 的 key 是 µ，code 仍是 KeyM；别的键不匹配", () => {
        expect(keyEventMatches("Mod+Alt+M", "mac", event({metaKey: true, altKey: true}))).toBe(true);
        expect(keyEventMatches("Mod+Alt+M", "other", event({code: "KeyN", ctrlKey: true, altKey: true}))).toBe(false);
    });

    it("AltGr（Windows 上报成 Ctrl+Alt）打字与输入法组字中都不匹配", () => {
        expect(keyEventMatches("Mod+Alt+M", "other", event({ctrlKey: true, altKey: true, altGraph: true}))).toBe(false);
        expect(keyEventMatches("Mod+Alt+M", "other", event({ctrlKey: true, altKey: true, isComposing: true}))).toBe(false);
    });

    it("写不出键位或主键不是字母数字时不匹配", () => {
        expect(keyEventMatches("Mod+Alt+", "other", event({ctrlKey: true, altKey: true}))).toBe(false);
        expect(keyEventMatches("Mod+Escape", "other", event({code: "Escape", ctrlKey: true}))).toBe(false);
        expect(keyEventMatches("Mod+Alt+1", "other", event({code: "Digit1", ctrlKey: true, altKey: true}))).toBe(true);
    });
});
