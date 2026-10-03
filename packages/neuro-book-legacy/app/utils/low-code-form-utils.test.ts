import {describe, expect, it} from "vitest";
import {withLowCodeFormDefaults} from "nbook/app/components/common/low-code-form/low-code-form-utils";
import type {LowCodeFormDto} from "nbook/shared/dto/low-code-form.dto";

describe("low-code-form-utils", () => {
    it("withLowCodeFormDefaults 合并未触碰字段的默认值", () => {
        const form: LowCodeFormDto = {
            defaults: {
                answer_2: "open",
            },
            fields: [
                {
                    path: "answer_0",
                    component: "radio",
                    label: "开始位置",
                    required: true,
                    defaultValue: 2,
                    options: [
                        {value: 0, label: "村口"},
                        {value: 1, label: "遇狼"},
                        {value: 2, label: "遗迹"},
                    ],
                },
                {
                    path: "answer_1",
                    component: "radio",
                    label: "核心冲突",
                    required: true,
                    options: [
                        {value: 0, label: "探索"},
                        {value: 1, label: "秘密"},
                    ],
                },
                {
                    path: "answer_2",
                    component: "textarea",
                    label: "补充",
                    required: false,
                    options: [],
                },
            ],
        };

        expect(withLowCodeFormDefaults(form, {answer_1: 1})).toEqual({
            answer_0: 2,
            answer_1: 1,
            answer_2: "open",
        });
    });
});
