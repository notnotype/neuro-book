/**
 * Button 的缺省变体（Button.md 的“交互”）：不写 variant 是次按钮，主按钮要写明。外观在 Lab 里看，这里只守外观的来源：
 * 主按钮的面取 `--accent-main`，次按钮的面取 `--text-main` 的淡色。
 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import Button from "./Button.vue";

const surface = (variant?: "primary" | "secondary") => mount(Button, {props: variant === undefined ? {} : {variant}, slots: {default: "保存草稿"}}).get("button").classes();

describe("Button 的缺省变体", () => {
    it("不写 variant 时是次按钮，不是实底强调色", () => {
        expect(surface()).not.toContain("bg-[var(--accent-main)]");
        expect(surface()).toEqual(surface("secondary"));
    });

    it("写明 primary 才是强调色实底", () => {
        expect(surface("primary")).toContain("bg-[var(--accent-main)]");
    });
});
