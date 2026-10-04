import {describe, expect, it} from "vitest";

import {parseJunitDurations, selectAffectedTargets, type AffectedSelectionInput, type WorkspacePackageInfo} from "#scripts/cli/test-affected";

const PACKAGES: readonly WorkspacePackageInfo[] = [
    {directory: "nb-history", scripts: {"test": "bun test", "typecheck": "tsc --noEmit", "test:llm": "NBOOK_LLM_TESTS=1 bun test .llm.test.ts"}},
    {directory: "nb-workflow", scripts: {test: "bun test"}},
    {directory: "llmlint", scripts: {test: "bun run registry:build && bun test", typecheck: "tsc --noEmit"}},
    {directory: "neuro-book", scripts: {}},
    {directory: "web-app", scripts: {"test": "bun run test:bun && bun run test:vitest", "test:bun": "bun test", "test:vitest": "vitest run"}},
    {directory: "neuro-book-legacy", scripts: {test: "vitest run"}},
];
// llmlint 与旧应用依赖 nb-history；新应用依赖 nb-workflow。
const CONSUMERS_OF = new Map<string, ReadonlySet<string>>([
    ["nb-history", new Set(["llmlint", "neuro-book-legacy"])],
    ["nb-workflow", new Set(["neuro-book"])],
]);

function select(changed: string[], options: Partial<Omit<AffectedSelectionInput, "changed" | "packages" | "consumersOf">> = {}) {
    return selectAffectedTargets({changed, packages: PACKAGES, consumersOf: CONSUMERS_OF, typecheck: false, all: false, tier: "fast", ...options});
}

function commands(changed: string[], options: Parameters<typeof select>[1] = {}): Record<string, string[]> {
    return Object.fromEntries(select(changed, options).targets.map((target) => [target.name, target.commands.map((command) => command.argv.join(" "))]));
}

describe("test:affected 选包", () => {
    it("只改文档时不选任何目标", () => {
        expect(select(["docs/README.md", ".agents/works/w00001-x/README.md"])).toEqual({targets: [], skipped: []});
    });

    it("包内改动选中该包与依赖它的包，旧应用不参加", () => {
        const selection = select(["packages/nb-history/src/log.ts"]);

        expect(selection.targets.map((target) => [target.name, target.reason])).toEqual([
            ["llmlint", "依赖有改动的包"],
            ["nb-history", "包内有改动"],
        ]);
        expect(selection.targets[1]?.commands).toEqual([{argv: ["bun", "run", "test"], bunTest: true}]);
        expect(select(["packages/neuro-book-legacy/app/a.ts"]).targets).toEqual([]);
    });

    it("没有 test 脚本的包列为跳过", () => {
        expect(select(["packages/nb-workflow/src/run.ts"]).skipped).toEqual([{name: "neuro-book", reason: "没有 test 脚本"}]);
    });

    it("依赖锁或补丁变化时选中全部包与根脚本", () => {
        for (const changed of [["bun.lock"], ["patches/proper-lockfile@4.1.2.patch"]]) {
            expect(select(changed).targets.map((target) => target.name)).toEqual(["llmlint", "nb-history", "nb-workflow", "web-app", "scripts"]);
        }
    });

    it("根 package.json、scripts 与 workflow 的改动只选根脚本测试", () => {
        for (const changed of [["package.json"], ["scripts/ci/change-scope.ts"], [".github/workflows/code-baseline.yml"]]) {
            expect(select(changed).targets.map((target) => target.name)).toEqual(["scripts"]);
        }
    });

    it("--typecheck 在有 typecheck 脚本时先运行它", () => {
        const targets = select(["packages/nb-history/src/log.ts", "packages/nb-workflow/src/run.ts", "scripts/cli/test-affected.ts"], {typecheck: true}).targets;

        expect(Object.fromEntries(targets.map((target) => [target.name, target.commands.map((command) => command.argv.join(" "))]))).toEqual({
            "llmlint": ["bun run typecheck", "bun run test"],
            "nb-history": ["bun run typecheck", "bun run test"],
            "nb-workflow": ["bun run test"],
            "scripts": ["bun x tsc --noEmit -p scripts/tsconfig.json", "bun x vitest run --config scripts/vitest.config.ts"],
        });
    });

    it("--package 不看改动，只测指定的包；--with-consumers 连同依赖它的包；scripts 指根脚本测试", () => {
        expect(select([], {only: ["nb-history"]}).targets.map((target) => [target.name, target.reason])).toEqual([["nb-history", "指定的包"]]);
        expect(select([], {only: ["nb-history"], withConsumers: true}).targets.map((target) => [target.name, target.reason])).toEqual([
            ["llmlint", "依赖指定的包"],
            ["nb-history", "指定的包"],
        ]);
        expect(select([], {only: ["scripts"]}).targets.map((target) => target.name)).toEqual(["scripts"]);
        expect(() => select([], {only: ["nb-histroy"]})).toThrow("没有这个包：nb-histroy");
    });

    it("--tier llm 运行 test:llm，没有该脚本的包列为跳过，不跑根脚本测试", () => {
        const selection = select(["packages/nb-history/src/log.ts", "scripts/ci/change-scope.ts"], {tier: "llm"});

        expect(selection.targets.map((target) => [target.name, target.commands])).toEqual([["nb-history", [{argv: ["bun", "run", "test:llm"], bunTest: true}]]]);
        expect(selection.skipped).toEqual([{name: "llmlint", reason: "没有 test:llm 脚本"}]);
    });

    it("--files 只让改动所在、测试脚本是单条 bun test 的包按文件选择", () => {
        const changed = ["packages/nb-history/src/log.ts", "packages/llmlint/src/a.ts", "packages/nb-workflow/src/run.ts"];

        expect(commands(changed, {changedFilesSince: {since: undefined}})).toEqual({
            "llmlint": ["bun run test"],
            "nb-history": ["bun run test --changed"],
            "nb-workflow": ["bun run test --changed"],
        });
        expect(commands(["packages/nb-history/src/log.ts"], {changedFilesSince: {since: "master"}, tier: "llm"})).toEqual({"nb-history": ["bun run test:llm --changed=master"]});
        // 依赖方整包运行：Bun 的按文件选择不跨包追踪。
        expect(select(["packages/nb-history/src/log.ts"], {changedFilesSince: {since: undefined}}).targets.find((target) => target.name === "llmlint")?.commands).toEqual([{argv: ["bun", "run", "test"], bunTest: false}]);
    });

    it("`bun run a && bun run b` 形式的测试脚本拆成各步：Bun 与 Vitest 各自按文件选择，junit 只接 Bun 那一步", () => {
        const selection = select(["packages/web-app/src/a.ts"], {changedFilesSince: {since: "master"}});

        expect(selection.targets).toEqual([{
            name: "web-app",
            cwd: "packages/web-app",
            reason: "包内有改动，只跑受影响的测试文件",
            commands: [{argv: ["bun", "run", "test:bun", "--changed=master"], bunTest: true}, {argv: ["bun", "run", "test:vitest", "--changed=master"], bunTest: false}],
        }]);
        expect(commands(["packages/web-app/src/a.ts"])).toEqual({"web-app": ["bun run test:bun", "bun run test:vitest"]});
    });
});

describe("junit 耗时", () => {
    it("取出每个测试的文件、名称与毫秒数，并还原转义字符", () => {
        const xml = '<testsuites><testcase name="a &quot;b&quot; &lt;c&gt;" classname="" time="0.2504" file="src/x.test.ts" line="3" /><testcase name="bad" time="x" /></testsuites>';

        expect(parseJunitDurations("neuro-book", xml)).toEqual([{target: "neuro-book", file: "src/x.test.ts", name: "a \"b\" <c>", ms: 250}]);
    });
});
