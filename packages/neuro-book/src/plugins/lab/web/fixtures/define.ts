/**
 * 场景登记的入口与类型。各插件的场景（`plugins/<插件>/web/lab/fixtures.ts`）、Lab 里的分组（`nb-ui/`、`nb-layout/`、
 * `nb-agent-ui/`）与草稿区（`../drafts/`）都经 `../scene-kit.ts` 用它，总登记表（`./index.ts`）再汇入它们。入口放在总登记表里
 * 会成一圈运行时导入，测试环境里先求值的分组拿不到它；类型也放在这里，场景就不必从总登记表取类型。
 */
import type {Component} from "vue";
import type {LabInputOf, LabJsonPropOf, LabSlotOf, LabSubjectProps} from "../lab-subject";

export type LabScene = {
    id: string;
    label: string;
    /** 运行时消费的宽化输入；登记入口负责把它约束到组件类型。 */
    input?: {props?: Record<string, unknown>; model?: Record<string, unknown>; slots?: Record<string, boolean>};
};

declare const LAB_FIXTURE_BRAND: unique symbol;

export type LabFixture = {
    /** 与组件文档同名 */
    component: string;
    scenes: LabScene[];
    /** 没有可登记 JSON 数据 prop 的组件可声明无输入理由；运行期能力仍由 fixture 绑定。 */
    noInput?: string;
    /** fixture 为哪些插槽备了预设内容。 */
    slots?: readonly string[];
    load: () => Promise<Component>;
    readonly [LAB_FIXTURE_BRAND]: true;
};

export type LabFixtureDefinition<C> = {
    component: string;
    load: () => Promise<Component>;
} & (
    | {
        noInput?: never;
        slots?: readonly LabSlotOf<C>[];
        scenes: Array<{id: string; label: string; input: LabInputOf<C>}>;
    }
    | ([LabJsonPropOf<C>] extends [never] ? {
        noInput: string;
        slots?: never;
        scenes: Array<{id: string; label: string; input?: never}>;
    } : never)
);

/**
 * 登记的形状不对时抛的错以 `nb-lab:` 开头。这句文案还是产物门禁的标记（`scripts/check-dist.ts` 的 `DEVELOPMENT_MARKERS`）：
 * 场景文件都经这里登记，误进生产产物时会带着这段文案，被门禁查出来。只返回参数的函数会被压缩器内联掉，留不下标记。
 */
export function checkLabFixture(value: unknown, where: string): LabFixture {
    const candidate = value as Partial<LabFixture> | null;
    if (typeof candidate?.component !== "string" || candidate.component === "" || !Array.isArray(candidate.scenes) || typeof candidate.load !== "function") {
        throw new Error(`nb-lab: ${where} 里的场景登记（component: ${String(candidate?.component)}）要有 component、scenes 与 load`);
    }
    return candidate as LabFixture;
}

/**
 * 把 `import.meta.glob` 收到的场景模块摊平成登记表：每个模块导出 `fixtures` 数组。导出写错时在这里抛带文件路径的错，
 * 不然 `flatMap` 会把 `undefined` 原样放进登记表，Lab 要到第一次读 `fixture.component` 时才报错，也看不出是哪个文件。
 */
export function collectLabFixtures(modules: Readonly<Record<string, unknown>>): LabFixture[] {
    return Object.entries(modules).flatMap(([path, module]) => {
        const fixtures = (module as {fixtures?: unknown} | null)?.fixtures;
        if (!Array.isArray(fixtures)) throw new Error(`nb-lab: ${path} 要导出 fixtures 数组`);
        return fixtures.map((fixture: unknown) => checkLabFixture(fixture, path));
    });
}

/** 唯一的类型化 fixture 登记入口；运行时只核对形状，不加载组件或推导签名。 */
export function defineLabFixture<C = never>(
    definition: [C] extends [never] ? never : [LabSubjectProps<C>] extends [never] ? never : LabFixtureDefinition<C>,
): LabFixture {
    // 类型检查发生在入口参数；消费方需要的宽化 registry 类型在此处擦除一次。
    return checkLabFixture(definition, "defineLabFixture");
}
