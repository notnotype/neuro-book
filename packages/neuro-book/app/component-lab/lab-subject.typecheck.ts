import type {Component} from "vue";
import type FixtureExample from "./FixtureExample.vue";
import {defineLabFixture, type LabFixture} from "./fixtures";
import type {LabInputOf} from "./lab-subject";

declare const fixtureLoader: () => Promise<Component>;
type FixtureDefinition = Parameters<typeof defineLabFixture<typeof FixtureExample>>[0];
type ValidFixtureInput = LabInputOf<typeof FixtureExample>;

const validInput = {
    props: {title: "示例", status: "ready"},
    slots: {extra: true},
} satisfies ValidFixtureInput;

void validInput;
void defineLabFixture<typeof FixtureExample>({
    component: "FixtureExample",
    slots: ["extra"],
    scenes: [{id: "default", label: "默认", input: validInput}],
    load: fixtureLoader,
});

const missingTitle: FixtureDefinition = {
    component: "FixtureExample",
    scenes: [{
        id: "missing-title",
        label: "错误",
        // @ts-expect-error FixtureExample 的必填 title 不能省略
        input: {props: {status: "ready"}},
    }],
    load: fixtureLoader,
};
void missingTitle;

const wrongProp: FixtureDefinition = {
    component: "FixtureExample",
    scenes: [{
        id: "wrong-prop",
        label: "错误",
        // @ts-expect-error 不存在的 selectedValue 不能替代 title/model 字段
        input: {props: {title: "示例", selectedValue: "a"}},
    }],
    load: fixtureLoader,
};
void wrongProp;

const wrongModel: FixtureDefinition = {
    component: "FixtureExample",
    scenes: [{
        id: "wrong-model",
        label: "错误",
        input: {
            props: {title: "示例"},
            // @ts-expect-error active 是普通 prop，不是 FixtureExample 的 model
            model: {active: true},
        },
    }],
    load: fixtureLoader,
};
void wrongModel;

void defineLabFixture<typeof FixtureExample>({
    component: "FixtureExample",
    // @ts-expect-error 有数据 props 的组件不能使用 noInput 豁免
    noInput: "暂时不调",
    // @ts-expect-error 场景缺少 input
    scenes: [{id: "no-input", label: "错误"}],
    load: fixtureLoader,
});

// @ts-expect-error registry 消费类型要求 defineLabFixture 返回的私有 brand
const bypassedFixture: LabFixture = ordinaryObject;
void bypassedFixture;
const invalidTitleType: FixtureDefinition = {
    component: "FixtureExample",
    scenes: [{id: "wrong-title-type", label: "错误", input: {
        props: {
            // @ts-expect-error title 必须是 string
            title: 42,
        },
    }}],
    load: fixtureLoader,
};
void invalidTitleType;

const invalidStatus: FixtureDefinition = {
    component: "FixtureExample",
    scenes: [{id: "wrong-status", label: "错误", input: {
        props: {
            title: "示例",
            // @ts-expect-error status 不接受未知字面量
            status: "done",
        },
    }}],
    load: fixtureLoader,
};
void invalidStatus;

const invalidSlot: FixtureDefinition = {
    component: "FixtureExample",
    scenes: [{id: "wrong-slot", label: "错误", input: {
        props: {title: "示例"},
        slots: {
            // @ts-expect-error FixtureExample 没有 unknown 插槽
            unknown: true,
        },
    }}],
    load: fixtureLoader,
};
void invalidSlot;

type PickerInstance = {
    $props: {
        open: boolean;
        modelValue: string;
        models: string[];
        direction?: string;
        "onUpdate:open"?: (value: boolean) => void;
        "onUpdate:model-value"?: (value: string) => void;
    };
};
type PickerComponent = abstract new (...args: never[]) => PickerInstance;
declare const pickerLoader: () => Promise<Component>;

void defineLabFixture<PickerComponent>({
    component: "Picker",
    scenes: [{id: "default", label: "默认", input: {props: {models: []}, model: {open: true, modelValue: "a"}}}],
    load: pickerLoader,
});

const pickerMissingModel: Parameters<typeof defineLabFixture<PickerComponent>>[0] = {
    component: "Picker",
    scenes: [{id: "missing-model", label: "错误", input: {
        props: {models: []},
        // @ts-expect-error modelValue 是必填 v-model 值
        model: {open: true},
    }}],
    load: pickerLoader,
};
void pickerMissingModel;

const pickerWrongModel: Parameters<typeof defineLabFixture<PickerComponent>>[0] = {
    component: "Picker",
    scenes: [{id: "wrong-model-type", label: "错误", input: {
        props: {models: []},
        model: {
            open: true,
            // @ts-expect-error modelValue 必须是 string
            modelValue: 1,
        },
    }}],
    load: pickerLoader,
};
void pickerWrongModel;

const pickerModelInProps: Parameters<typeof defineLabFixture<PickerComponent>>[0] = {
    component: "Picker",
    scenes: [{id: "model-in-props", label: "错误", input: {
        // @ts-expect-error open 是 v-model，必须放 model 层
        props: {models: [], open: true, modelValue: "a"},
        model: {open: true, modelValue: "a"},
    }}],
    load: pickerLoader,
};
void pickerModelInProps;

type NoPropsInstance = { $props: Record<never, never> };
type NoPropsComponent = abstract new (...args: never[]) => NoPropsInstance;
void defineLabFixture<NoPropsComponent>({
    component: "NoProps",
    noInput: "该组件没有可编辑输入",
    scenes: [{id: "default", label: "默认"}],
    load: pickerLoader,
});

type UnsupportedComponent = () => unknown;
// @ts-expect-error 不支持无法取得实例 $props 的组件类型
void defineLabFixture<UnsupportedComponent>({
    component: "Unsupported",
    scenes: [],
    load: pickerLoader,
});

type OptionalPropsInstance = {$props: {caption?: string}};
type OptionalPropsComponent = abstract new (...args: never[]) => OptionalPropsInstance;
void defineLabFixture<OptionalPropsComponent>({
    component: "OptionalProps",
    scenes: [{id: "default", label: "默认", input: {props: {}}}],
    load: pickerLoader,
});
const missingPropsLayer: Parameters<typeof defineLabFixture<OptionalPropsComponent>>[0] = {
    component: "OptionalProps",
    scenes: [{id: "missing-props", label: "错误",
        // @ts-expect-error 有数据 prop 时 props 层必须声明
        input: {slots: {}},
    }],
    load: pickerLoader,
};
void missingPropsLayer;

// @ts-expect-error 必须显式提供组件泛型
void defineLabFixture({component: "MissingType", scenes: [], load: pickerLoader});
