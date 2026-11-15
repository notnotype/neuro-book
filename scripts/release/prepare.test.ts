import {describe, expect, it} from "vitest";

import {parseChangelog} from "#scripts/release/changelog";
import {preparePlan, type PrepareState} from "#scripts/release/prepare";

const APP_CHANGELOG = "# 变更记录\n\n## [Unreleased]\n\n### 修复\n\n- 修好了 A\n\n## [0.13.0] - 2026-11-15\n\n### 新增\n\n- 第一个桌面版\n";
const PRODUCT = 'export const PRODUCT_VERSION = "0.13.0";\n\nexport type ProductStage = "canary" | "preview" | "stable";\n\nexport const PRODUCT_STAGE: ProductStage = "canary";\n';
const NB_UI_CHANGELOG = "# 变更记录\n\n## [Unreleased]\n\n### 修复\n\n- 修好了 nb-ui 的 X\n";

function state(overrides: Partial<PrepareState> = {}): PrepareState {
    return {
        branch: "master",
        containsOrigin: true,
        dirty: [],
        version: "0.13.0",
        stage: "canary",
        previousTag: "v0.13.0",
        appPackageJson: '{\n    "name": "@notnotype/neuro-book",\n    "version": "0.13.0"\n}\n',
        product: PRODUCT,
        appChangelog: APP_CHANGELOG,
        packages: [
            {dir: "nb-ui", version: "0.4.1", previousVersion: "0.4.0", changelog: NB_UI_CHANGELOG},
            {dir: "nb-story", version: "0.2.3", previousVersion: "0.2.3", changelog: null},
        ],
        ...overrides,
    };
}

const TARGET = {version: "0.13.1", stage: "canary", date: "2026-11-20"} as const;
const written = (plan: ReturnType<typeof preparePlan>, path: string) => plan.writes.find((write) => write.path === path)?.text;

describe("发版准备", () => {
    it("改两处产品版本与阶段，定稿应用与提了版本的源码包的 CHANGELOG", () => {
        const plan = preparePlan(state(), {...TARGET, stage: "preview"});
        expect(plan.problems).toEqual([]);
        expect(written(plan, "packages/neuro-book/package.json")).toContain('"version": "0.13.1"');
        expect(written(plan, "packages/neuro-book/src/shared/product.ts")).toBe(PRODUCT.replace('"0.13.0"', '"0.13.1"').replace('PRODUCT_STAGE: ProductStage = "canary"', 'PRODUCT_STAGE: ProductStage = "preview"'));
        const app = parseChangelog(written(plan, "packages/neuro-book/CHANGELOG.md") as string);
        expect(app.unreleased.size).toBe(0);
        expect(app.releases[0]).toMatchObject({version: "0.13.1", date: "2026-11-20"});
        expect(parseChangelog(written(plan, "packages/nb-ui/CHANGELOG.md") as string).releases[0]?.version).toBe("0.4.1");
        expect(plan.writes.map((write) => write.path)).not.toContain("packages/nb-story/CHANGELOG.md");
    });

    it("不在 master、落后 origin、有没提交的改动、版本没升或带阶段、要发 stable：都不写任何文件", () => {
        const cases: [Partial<PrepareState>, Partial<typeof TARGET> | {stage: "stable"}, string][] = [
            [{branch: "feat/x"}, {}, "只在 master 上"],
            [{containsOrigin: false}, {}, "不包含 origin/master"],
            [{dirty: [" M packages/nb-ui/package.json"]}, {}, "没提交的改动"],
            [{}, {version: "0.13.0"}, "不高于现在的 0.13.0"],
            [{}, {version: "0.13.1-canary.1"}, "不是纯数字"],
            [{}, {stage: "stable"}, "stable 的发布规则还没实现"],
        ];
        for (const [overrides, target, message] of cases) {
            const plan = preparePlan(state(overrides), {...TARGET, ...target});
            expect(plan.problems.join("\n")).toContain(message);
            expect(plan.writes).toEqual([]);
        }
    });

    it("应用没有条目、提了版本的包没有 CHANGELOG 或没有条目：停下", () => {
        const noApp = preparePlan(state({appChangelog: "## [Unreleased]\n\n## [0.13.0] - 2026-11-15\n\n### 新增\n\n- x\n"}), TARGET);
        expect(noApp.problems.join("\n")).toContain("packages/neuro-book/CHANGELOG.md 的 [Unreleased] 没有条目");
        const missing = preparePlan(state({packages: [{dir: "nb-ui", version: "0.4.1", previousVersion: "0.4.0", changelog: null}]}), TARGET);
        expect(missing.problems.join("\n")).toContain("没有 packages/nb-ui/CHANGELOG.md");
        const empty = preparePlan(state({packages: [{dir: "nb-ui", version: "0.4.1", previousVersion: "0.4.0", changelog: "## [Unreleased]\n"}]}), TARGET);
        expect(empty.problems.join("\n")).toContain("packages/nb-ui/CHANGELOG.md 的 [Unreleased] 没有条目");
        expect([noApp, missing, empty].every((plan) => plan.writes.length === 0)).toBe(true);
    });

    it("版本没提而 [Unreleased] 有条目的包留到下次，只提示；已有这个版本段的不再定稿", () => {
        const plan = preparePlan(state({packages: [
            {dir: "nb-ui", version: "0.4.0", previousVersion: "0.4.0", changelog: NB_UI_CHANGELOG},
            {dir: "nb-flock", version: "0.1.0", previousVersion: null, changelog: "## [Unreleased]\n\n## [0.1.0] - 2026-11-15\n\n### 新增\n\n- 首发\n"},
        ]}), TARGET);
        expect(plan.problems).toEqual([]);
        expect(plan.notices).toEqual([expect.stringContaining("nb-ui/CHANGELOG.md 的 [Unreleased] 有条目，但版本没提"), expect.stringContaining("nb-flock/CHANGELOG.md 已有 [0.1.0]")]);
        expect(plan.writes.map((write) => write.path).filter((path) => path.startsWith("packages/nb-"))).toEqual([]);
    });

    it("第一次发布（没有上一个版本标签）：源码包不定稿", () => {
        const plan = preparePlan(state({previousTag: null}), TARGET);
        expect(plan.problems).toEqual([]);
        expect(plan.writes.map((write) => write.path)).not.toContain("packages/nb-ui/CHANGELOG.md");
    });
});
