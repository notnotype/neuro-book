import {describe, expect, it} from "vitest";
import {Type} from "typebox";
import type {CommandMetadata} from "nbook/app/utils/workbench/commands";
import {
    foldTitleActionCount,
    resolveViewTitleActions,
    titleActionProblems,
    titleActionsSignature,
    type ViewTitleActionContribution,
    type ViewTitleActionState,
} from "nbook/app/utils/workbench/view-title-actions";

/**
 * View 标题动作的纯求值：贡献 × 可见性 × authority × 命令 when × 运行时状态。
 *
 * 这里断言的是**宿主看得见的展示项**（label / disabled / reason / 落在 primary 还是 secondary），
 * 不是求值内部的查表过程。
 */

const ARGS = Type.Object({viewId: Type.String()}, {additionalProperties: false});

function metadataOf(id: string, icon?: string): CommandMetadata {
    return {
        id,
        titleKey: `title.${id}`,
        description: `description.${id}`,
        argsSchema: ARGS,
        effect: "read",
        expose: {agent: "never"},
        ...(icon === undefined ? {} : {icon}),
    };
}

const COMMANDS: Record<string, CommandMetadata> = {
    "nbook.view.refresh-files": metadataOf("nbook.view.refresh-files", "i-lucide-refresh-cw"),
    "nbook.view.reset-demo": metadataOf("nbook.view.reset-demo", "i-lucide-undo-2"),
    "nbook.view.toggle-demo": metadataOf("nbook.view.toggle-demo", "i-lucide-star"),
    /** 没有图标的命令：primary 的它必须降级进 secondary。 */
    "nbook.view.iconless": metadataOf("nbook.view.iconless"),
    "editor.split-vertical": metadataOf("editor.split-vertical", "i-lucide-rows-2"),
};

const REFRESH: ViewTitleActionContribution = {
    id: "refresh",
    commandId: "nbook.view.refresh-files",
    placement: "primary",
    order: 10,
};

const RESET: ViewTitleActionContribution = {
    id: "reset",
    commandId: "nbook.view.reset-demo",
    placement: "secondary",
    order: 20,
};

const READY: ViewTitleActionState = {id: "refresh", enabled: true};

function evaluate(overrides: Partial<Parameters<typeof resolveViewTitleActions>[0]> = {}) {
    return resolveViewTitleActions({
        viewId: "nbook.files",
        contributions: [REFRESH, RESET],
        visible: true,
        actionable: true,
        authorityReasons: [],
        context: {},
        commandOf: (commandId) => COMMANDS[commandId] ?? null,
        commandUnavailableReason: () => null,
        states: [READY, {id: "reset", enabled: true}],
        hasHandle: true,
        titleOf: (metadata) => `t:${metadata.titleKey}`,
        ...overrides,
    });
}

describe("resolveViewTitleActions", () => {
    it("就绪的动作按贡献给出的位置分到两份清单，标题取 canonical 命令元数据", () => {
        const result = evaluate();

        expect(result.problems).toEqual([]);
        expect(result.primary.map((item) => item.id)).toEqual(["refresh"]);
        expect(result.primary[0]).toMatchObject({
            label: "t:title.nbook.view.refresh-files",
            icon: "i-lucide-refresh-cw",
        });
        expect(result.primary[0]!.disabled).toBeUndefined();
        expect(result.secondary.map((item) => item.id)).toEqual(["reset"]);
    });
    it("有效 Alt 备用命令进入图标按钮，无效备用命令被忽略", () => {
        const valid = evaluate({contributions: [{
            ...REFRESH,
            alternate: {modifier: "alt", commandId: "editor.split-vertical"},
        }]});
        expect(valid.primary[0]?.alternate).toEqual({
            modifier: "alt",
            id: "editor.split-vertical",
            label: "t:title.editor.split-vertical",
            icon: "i-lucide-rows-2",
        });
        const invalid = evaluate({contributions: [{
            ...REFRESH,
            alternate: {modifier: "alt", commandId: "nbook.view.missing"},
        }]});
        expect(invalid.primary[0]?.alternate).toBeUndefined();
    });

    it("同序按 id 稳定排序；primary 与 secondary 各自保序", () => {
        const contributions: ViewTitleActionContribution[] = [
            {...REFRESH, id: "b-refresh", order: 10},
            {...REFRESH, id: "a-refresh", order: 10},
            {...RESET, id: "later", order: 30},
        ];
        const result = evaluate({contributions, states: [
            {id: "a-refresh", enabled: true},
            {id: "b-refresh", enabled: true},
            {id: "later", enabled: true},
        ]});

        expect(result.primary.map((item) => item.id)).toEqual(["a-refresh", "b-refresh"]);
    });

    it("未登记的命令：可见但禁用，标签用 action.id（诊断不指向不存在的标题）", () => {
        const result = evaluate({contributions: [{...REFRESH, commandId: "nbook.view.missing"}], states: [READY]});

        expect(result.problems).toEqual(["nbook.files 的标题动作 refresh 指向未登记的命令：nbook.view.missing"]);
        const item = result.secondary.find((candidate) => candidate.id === "refresh");
        expect(item).toMatchObject({label: "refresh", disabled: true, reason: "未登记的命令：nbook.view.missing"});
        expect(result.primary).toEqual([]);
    });

    it("没有图标的不进 primary：标题条上不该出现空白按钮", () => {
        const withoutIcon = evaluate({contributions: [{...REFRESH, commandId: "nbook.view.iconless"}], states: [READY]});

        expect(withoutIcon.primary).toEqual([]);
        expect(withoutIcon.secondary.map((item) => item.id)).toEqual(["refresh"]);
    });

    it("缺句柄或缺该动作的状态：禁用「视图操作尚未就绪」", () => {
        const withoutHandle = evaluate({hasHandle: false});
        const withoutState = evaluate({states: [{id: "reset", enabled: true}]});

        expect(withoutHandle.primary[0]).toMatchObject({disabled: true, reason: "视图操作尚未就绪"});
        expect(withoutState.primary[0]).toMatchObject({disabled: true, reason: "视图操作尚未就绪"});
    });

    it("busy：禁用并标记正在执行（原因与 busy 分开给）", () => {
        const result = evaluate({states: [{id: "refresh", enabled: true, busy: true}, {id: "reset", enabled: true}]});

        expect(result.primary[0]).toMatchObject({disabled: true, busy: true, reason: "视图操作正在执行"});
    });

    it("实例说不可用：用它自己的原因，不自造一句", () => {
        const result = evaluate({
            states: [{id: "refresh", enabled: false, reason: "文件树正在加载"}, {id: "reset", enabled: true}],
        });

        expect(result.primary[0]).toMatchObject({disabled: true, reason: "文件树正在加载"});
    });

    it("authority 不足：禁用并用 requiredAuthority 的原因（可见性不是权限）", () => {
        const result = evaluate({actionable: false, authorityReasons: ["需要工作区文件 authority"]});

        expect(result.primary[0]).toMatchObject({disabled: true, reason: "需要工作区文件 authority"});
    });

    it("命令 when 不满足：禁用并带原因，不是隐藏", () => {
        const result = evaluate({commandUnavailableReason: (commandId) => commandId === "nbook.view.refresh-files" ? "需要打开 Project" : null});

        expect(result.primary[0]).toMatchObject({disabled: true, reason: "需要打开 Project"});
    });

    it("贡献自己的 when 不满足：隐藏（与 View 可见性同一套语义）", () => {
        const hidden = evaluate({contributions: [{...REFRESH, when: {requires: ["project"]}}], states: [READY], context: {}});
        const shown = evaluate({contributions: [{...REFRESH, when: {requires: ["project"]}}], states: [READY], context: {project: true}});

        expect(hidden.primary).toEqual([]);
        expect(hidden.secondary).toEqual([]);
        expect(shown.primary.map((item) => item.id)).toEqual(["refresh"]);
    });

    it("View 不可见：整份动作清单为空", () => {
        const result = evaluate({visible: false});

        expect(result.primary).toEqual([]);
        expect(result.secondary).toEqual([]);
    });

    it("checked 透传成受控 checkbox；未上报 checked 的动作不带勾选态", () => {
        const result = evaluate({
            contributions: [{...REFRESH, id: "toggle", commandId: "nbook.view.toggle-demo"}],
            states: [{id: "toggle", enabled: true, checked: true}],
        });

        expect(result.primary[0]).toMatchObject({type: "checkbox", checked: true});
    });

    it("未登记的状态 id：忽略并诊断（不因为多报一个 id 就污染展示）", () => {
        const result = evaluate({states: [READY, {id: "ghost", enabled: true}]});

        expect(result.problems).toEqual(["nbook.files 上报了未登记标题动作的状态：ghost"]);
        expect(result.secondary.map((item) => item.id)).toEqual(["reset"]);
    });
});

describe("titleActionProblems", () => {
    it("空 id / 重复 id / 非法 placement / 非有限 order / 未登记 when 一次全报", () => {
        const problems = titleActionProblems("视图 nbook.files", [
            {...REFRESH, id: "  "},
            {...REFRESH, id: "duplicate"},
            {...REFRESH, id: "duplicate"},
            {...REFRESH, id: "bad-placement", placement: "top" as never},
            {...REFRESH, id: "bad-order", order: Number.NaN},
            {...REFRESH, id: "bad-when", when: {requires: ["not-registered" as never]}},
        ]);

        // 重复 id 只在第二次出现时报一条；其余各报一条，一次全给。
        expect(problems).toHaveLength(5);
        expect(problems[0]).toContain("id 不能为空");
        expect(problems[1]).toContain("id 重复：duplicate");
        expect(problems[2]).toContain("placement 必须是 primary 或 secondary");
        expect(problems[3]).toContain("order 不是有限数");
        expect(problems[4]).toContain("when 取值未登记：not-registered");
    });

    it("合法贡献没有问题（缺省 undefined 同样干净）", () => {
        expect(titleActionProblems("视图 nbook.files", [REFRESH, RESET])).toEqual([]);
        expect(titleActionProblems("视图 nbook.files", undefined)).toEqual([]);
    });
});

describe("foldTitleActionCount", () => {
    const base = {count: 5, itemWidth: 26, moreWidth: 26, gap: 4, hasSecondary: false};

    it("宽度未知（<=0）不折叠：量不到就不该把按钮藏起来", () => {
        expect(foldTitleActionCount({...base, availableWidth: 0})).toBe(5);
        expect(foldTitleActionCount({...base, availableWidth: -1})).toBe(5);
    });

    it("够宽时全部直接渲染", () => {
        expect(foldTitleActionCount({...base, availableWidth: 200})).toBe(5);
    });

    it("放不下就从最后一个开始折，并给「更多」留出位置", () => {
        // 5 个按钮 + 4 个间隙 = 146；没有「更多」时 150 放得下全部。
        expect(foldTitleActionCount({...base, availableWidth: 150})).toBe(5);
        // 140：3 个按钮（86）+「更多」与间隙（30）= 116 ≤ 140，4 个就要 146。
        expect(foldTitleActionCount({...base, availableWidth: 140})).toBe(3);
        expect(foldTitleActionCount({...base, availableWidth: 90})).toBe(2);
    });

    it("有 secondary 时必须保留「更多」：空间极小时宁可全折", () => {
        expect(foldTitleActionCount({...base, hasSecondary: true, availableWidth: 150})).toBe(4);
        expect(foldTitleActionCount({...base, hasSecondary: true, availableWidth: 100})).toBe(2);
        expect(foldTitleActionCount({...base, hasSecondary: true, availableWidth: 20})).toBe(0);
    });

    it("没有项时不产生负数", () => {
        expect(foldTitleActionCount({...base, count: 0, availableWidth: 10})).toBe(0);
    });
});

describe("titleActionsSignature", () => {
    it("随勾选、禁用与子项变化：菜单内容一变，指纹就变", () => {
        const base = {primary: [{id: "a", label: "A"}], secondary: [{id: "b", label: "B"}]};

        expect(titleActionsSignature(base)).not.toBe(titleActionsSignature({...base, primary: [{id: "a", label: "A", checked: true}]}));
        expect(titleActionsSignature(base)).not.toBe(titleActionsSignature({...base, primary: [{id: "a", label: "A", disabled: true, reason: "x"}]}));
        expect(titleActionsSignature(base)).not.toBe(titleActionsSignature({
            ...base,
            secondary: [{id: "b", label: "B", children: [{id: "c", label: "C"}]}],
        }));
        expect(titleActionsSignature(base)).toBe(titleActionsSignature({primary: [{id: "a", label: "A"}], secondary: [{id: "b", label: "B"}]}));
    });
});
