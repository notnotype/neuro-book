/**
 * 插件场景用 Lab 的唯一入口（docs/specs/ui/component-lab.md 的“输入边界”）。各插件的场景放在 `plugins/<插件>/web/lab/`，
 * 由总登记表（`./fixtures/index.ts`）收集；它们用到 Lab 的东西只从这里取，架构测试（`src/architecture.test.ts`）拦下
 * 插件场景对 Lab 其它模块的引用，Lab 内部怎么拆就不牵连插件。只导出插件场景与草稿真用到的，加上场景说明
 * （`./fixtures/README.md`）教的写法；要别的再加。
 */
export {defineLabFixture, type LabFixture} from "./fixtures/define";
export {createSubjectFixture, defineSubjectFixture} from "./fixtures/subject-fixture";
export {useLabSubject, type LabFixtureProps, type LabSceneInput} from "./lab-subject";
export {LAB_EVENT_SINK, useLabDataSink, useLabEventSink} from "./lab-event-sink";
export {LAB_LOCALE} from "./lab-locale";
export {default as LabFixtureControls} from "./LabFixtureControls.vue";
