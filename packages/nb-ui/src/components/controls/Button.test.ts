/**
 * Button 的缺省变体（Button.md 的“交互”）：不写 variant 是次按钮，主按钮要写明。外观在 Lab 里看，这里只比缺省与两种写明的
 * 是否同一套类，不断言具体类名。
 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import Button from "./Button.vue";

const surface = (variant?: "primary" | "secondary") => mount(Button, {props: variant === undefined ? {} : {variant}, slots: {default: "保存草稿"}}).get("button").classes();

describe("Button 的缺省变体", () => {
    it("不写 variant 时与写明 secondary 一样", () => {
        expect(surface()).toEqual(surface("secondary"));
        expect(surface()).not.toEqual(surface("primary"));
    });
});
