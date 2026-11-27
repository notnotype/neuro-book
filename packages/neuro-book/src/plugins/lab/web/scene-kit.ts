/**
 * 插件场景用 Lab 的唯一入口（docs/specs/ui/component-lab.md 的“输入边界”）。各插件的场景放在 `plugins/<插件>/web/lab/`，
 * 由总登记表（`./fixtures/index.ts`）收集；它们用到 Lab 的东西只从这里取，架构测试（`src/architecture.test.ts`）拦下
 * 插件场景对 Lab 其它模块的引用，Lab 内部怎么拆就不牵连插件。
 */
export {checkLabFixture, defineLabFixture, type LabFixture, type LabFixtureDefinition, type LabScene} from "./fixtures/define";
export {createSubjectFixture, defineSubjectFixture, type SubjectFixtureDefinition, type SubjectFixtureOptions} from "./fixtures/subject-fixture";
export {
    LabSceneInputSchema,
    useLabSubject,
    type LabEventOf,
    type LabFixtureProps,
    type LabInputOf,
    type LabJsonPropOf,
    type LabPropOf,
    type LabSceneInput,
    type LabSlotOf,
    type LabSubjectProps,
} from "./lab-subject";
export {LAB_DATA_SINK, LAB_EVENT_SINK, LAB_INPUT_SINK, useLabDataSink, useLabEventSink} from "./lab-event-sink";
export {LAB_LOCALE} from "./lab-locale";
export {default as LabFixtureControls} from "./LabFixtureControls.vue";
