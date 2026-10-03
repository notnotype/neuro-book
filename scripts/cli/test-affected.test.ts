import {describe, expect, it} from "vitest";

import {selectAffectedTargets, type WorkspacePackageInfo} from "#scripts/cli/test-affected";

const PACKAGES: readonly WorkspacePackageInfo[] = [
    {directory: "nb-history", scripts: {test: "bun test", typecheck: "tsc --noEmit"}},
    {directory: "nb-workflow", scripts: {test: "bun test"}},
    {directory: "llmlint", scripts: {test: "bun test", typecheck: "tsc --noEmit"}},
    {directory: "neuro-book", scripts: {}},
    {directory: "neuro-book-legacy", scripts: {test: "vitest run"}},
];
// llmlint 与旧应用依赖 nb-history；新应用依赖 nb-workflow。
const CONSUMERS_OF = new Map<string, ReadonlySet<string>>([
    ["nb-history", new Set(["llmlint", "neuro-book-legacy"])],
    ["nb-workflow", new Set(["neuro-book"])],
]);

function select(changed: string[], options: {typecheck?: boolean; all?: boolean} = {}) {
    return selectAffectedTargets({changed, packages: PACKAGES, consumersOf: CONSUMERS_OF, typecheck: options.typecheck ?? false, all: options.all ?? false});
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
        expect(selection.targets[1]?.commands).toEqual([["bun", "run", "test"]]);
        expect(select(["packages/neuro-book-legacy/app/a.ts"]).targets).toEqual([]);
    });

    it("没有 test 脚本的包列为跳过", () => {
        expect(select(["packages/nb-workflow/src/run.ts"]).skipped).toEqual([{name: "neuro-book", reason: "没有 test 脚本"}]);
    });

    it("依赖锁或补丁变化时选中全部包与根脚本", () => {
        for (const changed of [["bun.lock"], ["patches/proper-lockfile@4.1.2.patch"]]) {
            expect(select(changed).targets.map((target) => target.name)).toEqual(["llmlint", "nb-history", "nb-workflow", "scripts"]);
        }
    });

    it("根 package.json、scripts 与 workflow 的改动只选根脚本测试", () => {
        for (const changed of [["package.json"], ["scripts/ci/change-scope.ts"], [".github/workflows/code-baseline.yml"]]) {
            expect(select(changed).targets.map((target) => target.name)).toEqual(["scripts"]);
        }
    });

    it("--typecheck 在有 typecheck 脚本时先运行它", () => {
        const targets = select(["packages/nb-history/src/log.ts", "packages/nb-workflow/src/run.ts", "scripts/cli/test-affected.ts"], {typecheck: true}).targets;

        expect(Object.fromEntries(targets.map((target) => [target.name, target.commands.map((command) => command.join(" "))]))).toEqual({
            "llmlint": ["bun run typecheck", "bun run test"],
            "nb-history": ["bun run typecheck", "bun run test"],
            "nb-workflow": ["bun run test"],
            "scripts": ["bun x tsc --noEmit -p scripts/tsconfig.json", "bun x vitest run --config scripts/vitest.config.ts"],
        });
    });
});
