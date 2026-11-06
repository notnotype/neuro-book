import {describe, expect, it} from "bun:test";

import type {ThemeEntry} from "../../themes";
import {themeSwatch} from "./theme-swatch";

const BASE = (base: string, appearance: "light" | "dark") => (appearance === "light" ? {"--bg-main": "#ffffff", "--text-main": "#111111", "--accent-main": "#2563eb"} : {"--bg-main": "#101010", "--text-main": "#eeeeee", "--accent-main": "#60a5fa"});

const entry = (light: Record<string, string>): ThemeEntry => ({id: "user:1", plugin: "user", declaration: {title: "夜读", base: "nbook", light: {colors: light}, dark: {}}});

describe("主题的预览色", () => {
    it("声明里写的盖在主题包缺省配色上，没写的取缺省", () => {
        expect(themeSwatch(entry({"--bg-main": "#f3ead8"}), "light", BASE)).toEqual({background: "#f3ead8", text: "#111111", accent: "#2563eb"});
    });

    it("取的是被问的那个明暗", () => {
        expect(themeSwatch(entry({"--bg-main": "#f3ead8"}), "dark", BASE)).toEqual({background: "#101010", text: "#eeeeee", accent: "#60a5fa"});
    });

    it("缺省配色也读不出时给 null，调用方不画那一块", () => {
        expect(themeSwatch(entry({}), "light", () => ({}))).toEqual({background: null, text: null, accent: null});
    });
});
