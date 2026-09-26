import {isDeepStrictEqual} from "node:util";
import {readdirSync, readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {Value} from "typebox/value";
import {describe, expect, it} from "vitest";
import {labComponents} from "../component-index";
import {LabSceneInputSchema} from "../lab-subject";
import {findLabFixture, labFixtures, type LabFixture} from "./index";

const fixturesRoot = dirname(fileURLToPath(import.meta.url));



describe("Lab 场景覆盖", () => {
    /**
     * 这不是「所有组件都该有场景」的整洁强迫症：组件规范把纯零件与受控零件的状态说明交给
     * fixture 承载，所以一个可挂载却没有场景的组件，等于既没有文档也没有演示。
     * 能力标签阻断的组件（io:/state:shared-write/persist:）不在此列——Lab 不给它们造替代场景。该仓库合同见 `docs/specs/ui/component-lab.md` 的失败与恢复与验收条款。
     */
    it("索引里每个可挂载组件都登记了至少一个场景", () => {
        const missing = labComponents
            .filter((entry) => entry.mountable)
            .filter((entry) => {
                const fixture = findLabFixture(entry.name);
                return fixture === null || fixture.scenes.length === 0 || typeof fixture.load !== "function";
            })
            .map((entry) => entry.name);

        expect(missing, `这些组件可以挂载却没有场景登记：${missing.join("、")}。在 fixtures/index.ts 里为它们登记场景；确实只能在正式界面验证的，按组件规范补阻断标签，而不是留着空档。`).toEqual([]);
    });

    /**
     * `findLabFixture` 只认第一份登记：组件名写重时后面的场景永远不可达，UI 与既有门禁都看不出异常
     * （EditorTabItem 就曾被一份单场景登记遮住另外 8 个场景）。登记重复按「场景丢失」处理。
     */
    it("每个组件名只能有一条登记", () => {
        const seen = new Set<string>();
        const duplicated: string[] = [];
        for (const fixture of labFixtures) {
            if (seen.has(fixture.component)) duplicated.push(fixture.component);
            seen.add(fixture.component);
        }

        expect(duplicated, `这些组件在 fixtures/index.ts 里登记了多份，生效的永远只是第一份：${duplicated.join("、")}。合并成一条登记。`).toEqual([]);
    });

    it("登记的每个场景都指向索引里真实存在的可挂载组件", () => {
        const mountable = new Set(labComponents.filter((entry) => entry.mountable).map((entry) => entry.name));
        const dead = labFixtures.filter((fixture) => !mountable.has(fixture.component)).map((fixture) => fixture.component);

        expect(dead, `这些登记指向不存在的组件名或不可挂载的组件：${dead.join("、")}。组件名要与同名组件文档一致，否则 Lab 永远选不中它。`).toEqual([]);
    });


    /**
     * 视口盒子唯一性契约：
     * ViewportCanvas 是唯一的视口宿主盒子。
     * 严禁在 Fixture 模板中自建假卡片外壳（例如 `w-[500px]`、`w-[420px]`、卡片三件套 `rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)]`）。
     * 单零件组件应充满视口宽度（`w-full`），由 Lab 顶栏或视口手柄调节观察响应式。
     */
    it("fixture 严禁在模板中自建固定宽度假盒子或卡片三件套假外壳", () => {
        const fixtureFiles = readdirSync(fixturesRoot)
            .filter((file) => file.endsWith("Fixture.vue") && !file.endsWith(".test.ts"));

        const violations: string[] = [];

        for (const file of fixtureFiles) {
            const filePath = join(fixturesRoot, file);
            const content = readFileSync(filePath, "utf8");

            // 1. 检查假卡片三件套: rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)]
            if (/rounded-lg\s+border\s+border-\[var\(--border-color\)\]\s+bg-\[var\(--bg-panel\)\]/u.test(content)) {
                violations.push(`${file} 包含自建假卡片三件套 (rounded-lg border bg-panel)，必须由 ViewportCanvas 充当视口盒子`);
            }

            // 2. 检查外层固定宽度假盒子 (如 w-[500px], w-[460px], w-[420px] 等，排查大于 100px 的硬编码尺寸容器)
            // 排除抽屉栏内的 input/slider，仅检查 template 层的 div/main/section 容器
            const hardcodedBoxMatch = content.match(/<(?:div|main|section)[^>]*class="[^"]*\b(w-\[(?:[1-9]\d{2,})px\]|max-w-\[(?:[1-9]\d{2,})px\])[^"]*"/u);
            if (hardcodedBoxMatch && !file.includes("ActivityBar") && !file.includes("TitleActions")) {
                violations.push(`${file} 包含固定像素宽度容器 (${hardcodedBoxMatch[1]})，严禁自建假尺寸，应使用 w-full 或由 ViewportCanvas 调节`);
            }
        }

        expect(violations, `发现违背 Component Lab 视口规范的老写法：\n${violations.join("\n")}`).toEqual([]);
    });
});

function collectInputRegistrationIssues(fixtures: readonly Pick<LabFixture, "component" | "scenes" | "slots" | "noInput">[]): string[] {
    const issues: string[] = [];
    for (const fixture of fixtures) {
        const reason = fixture.noInput?.trim() ?? "";
        if (fixture.noInput !== undefined && reason === "") {
            issues.push(`${fixture.component}：noInput 必须是非空理由`);
        }
        if (fixture.noInput !== undefined && fixture.slots !== undefined) {
            issues.push(`${fixture.component}：noInput fixture 不能登记 slots 预设`);
        }
        for (const scene of fixture.scenes) {
            const prefix = `${fixture.component}::${scene.id}`;
            if (fixture.noInput !== undefined) {
                if (scene.input !== undefined) issues.push(`${prefix}：noInput fixture 不能同时登记 input`);
                continue;
            }
            if (scene.input === undefined) {
                issues.push(`${prefix}：必须登记 input，或给无 props 组件提供 noInput 理由`);
                continue;
            }
            const layers = [scene.input.props, scene.input.model, scene.input.slots];
            if (layers.every((layer) => layer === undefined || Object.keys(layer).length === 0)) {
                issues.push(`${prefix}：input 不能是空对象`);
            }
            for (const slotName of Object.keys(scene.input.slots ?? {})) {
                if (!(fixture.slots ?? []).includes(slotName)) {
                    issues.push(`${prefix}.slots.${slotName}：未登记 fixture 插槽预设`);
                }
            }
        }
    }
    return issues;
}

function jsonRoundTripIssues(fixtures: readonly LabFixture[]): string[] {
    const invalid: string[] = [];
    for (const fixture of fixtures) {
        for (const scene of fixture.scenes) {
            if (scene.input === undefined) continue;
            const name = `${fixture.component}::${scene.id}`;
            try {
                const serialized = JSON.stringify(scene.input);
                const restored = JSON.parse(serialized);
                if (!Value.Check(LabSceneInputSchema, scene.input) || !isDeepStrictEqual(restored, scene.input)) {
                    invalid.push(name);
                }
            } catch {
                invalid.push(name);
            }
        }
    }
    return invalid;
}

describe("Component Lab 分层输入契约", () => {
    it("每个场景登记 input，或明确声明无输入理由", () => {
        const issues = collectInputRegistrationIssues(labFixtures);
        expect(issues, `分层输入登记问题：\n${issues.join("\n")}`).toEqual([]);
    });

    it("场景 input 符合分层 schema 且能无损 JSON 往返", () => {
        const invalid = jsonRoundTripIssues(labFixtures);
        expect(invalid, `这些场景的 input 不是合法 JSON 分层对象：${invalid.join("、")}`).toEqual([]);
    });

    it("登记的插槽预设都被至少一个场景使用", () => {
        const unused = labFixtures.flatMap((fixture) => (fixture.slots ?? [])
            .filter((name) => !fixture.scenes.some((scene) => scene.input?.slots?.[name] !== undefined))
            .map((name) => `${fixture.component}#${name}`));
        expect(unused, `这些插槽预设没有任何场景开关它们：${unused.join("、")}`).toEqual([]);
    });

    it("边界样例收集缺输入、空输入和坏 JSON", () => {
        const fixture = {component: "Probe", scenes: [
            {id: "missing", label: "缺输入"},
            {id: "empty", label: "空输入", input: {}},
            {id: "bad", label: "坏值", input: {props: {value: undefined}}},
        ], slots: []} satisfies Pick<LabFixture, "component" | "scenes" | "slots">;
        const registrationIssues = collectInputRegistrationIssues([fixture]);
        expect(registrationIssues).toHaveLength(2);
        expect(registrationIssues[0]).toContain("Probe::missing");
        expect(registrationIssues[1]).toContain("Probe::empty");
        expect(jsonRoundTripIssues([fixture as unknown as LabFixture])).toEqual(["Probe::bad"]);
    });
});


