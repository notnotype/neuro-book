import type EditorBreadcrumbs from "../../components/editor-workbench/EditorBreadcrumbs.vue";
import type {LabFixtureDefinition} from "./index";

const symbols = [{id: "sym-1", label: "第一节：潮声"}, {id: "sym-2", label: "核心冲突"}];

export const editorBreadcrumbsScenes = [
    {id: "default", label: "常规路径与符号", input: {props: {path: "src/story/chapter-01.md", symbols}, slots: {trailing: true}}},
    {id: "long", label: "深层超长路径", input: {props: {path: "packages/neuro-book/app/components/novel-ide/settings/sections/providers/components/ProviderSettingsViewFixtureLongPathComponentName.vue", symbols}, slots: {trailing: true}}},
] satisfies LabFixtureDefinition<typeof EditorBreadcrumbs>["scenes"];
