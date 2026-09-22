import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {dirname, join, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {labComponents} from "../component-index";
import {findLabFixture, labFixtures} from "./index";

const fixturesRoot = dirname(fileURLToPath(import.meta.url));

/** 收集 fixture 目录下的模块（含子目录与数据模块），不含测试自身。 */
function collectFixtureModules(from: string): string[] {
    return readdirSync(from, {withFileTypes: true}).flatMap((entry) => {
        const path = join(from, entry.name);
        if (entry.isDirectory()) return collectFixtureModules(path);
        return entry.isFile() && /\.(vue|ts)$/u.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
    });
}

/** 相对 specifier：只认真实导入语句里的双引号写法，免得把 fixture 里模拟「项目文件内容」的字符串当成导入。 */
function relativeSpecifiers(source: string): string[] {
    const found = new Set<string>();
    const collect = (pattern: RegExp): void => {
        for (const [, specifier] of source.matchAll(pattern)) {
            if (specifier !== undefined) found.add(specifier.replace(/\?.*$/u, ""));
        }
    };
    collect(/(?:^|\n)[\t ]*(?:import|export|\}|\*)[^\n]*?\bfrom\s*"(\.[^"\n]*)"/gu);
    collect(/\bimport\s*\(\s*"(\.[^"\n]*)"\s*\)/gu);
    return [...found];
}

function resolvesOnDisk(from: string, specifier: string): boolean {
    const base = resolve(from, specifier);
    return [base, `${base}.ts`, `${base}.vue`, `${base}.json`, join(base, "index.ts"), join(base, "index.vue")].some(
        (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
    );
}

describe("AgentProfileSettingsView Lab 场景", () => {
    it("保留既有状态场景并登记 DialogWindow 内嵌场景", () => {
        const fixture = findLabFixture("AgentProfileSettingsView");

        expect(fixture).not.toBeNull();
        expect(fixture?.scenes.map((scene) => scene.id)).toEqual([
            "global",
            "project",
            "dialog-window",
            "statuses",
            "custom-settings",
            "empty",
        ]);
    });
});

describe("FrontendSettingsView Lab 场景", () => {
    it("登记两轴选择器的两种场景", () => {
        const fixture = findLabFixture("FrontendSettingsView");

        expect(fixture).not.toBeNull();
        expect(fixture?.scenes.map((scene) => scene.id)).toEqual(["default", "disabled"]);
    });
});

describe("ProjectPicker 及子组件 Lab 场景", () => {
    it("完整登记 ProjectPickerView 及全部 7 个子组件", async () => {
        const expectedComponents = [
            "ProjectPickerView",
            "ProjectPickerHeader",
            "ProjectPickerEmptyState",
            "ProjectCard",
            "ProjectCreateCoverPreview",
            "ProjectCreateForm",
            "ProjectCreateDialog",
            "ProjectCoverDialog",
        ];

        for (const name of expectedComponents) {
            const fixture = findLabFixture(name);
            expect(fixture, `Fixture for ${name} should be registered`).not.toBeNull();
            expect(fixture?.scenes.length).toBeGreaterThan(0);
            expect(typeof fixture?.load).toBe("function");
        }
    });

    it("ProjectCreateForm 包含拟真与恢复场景", () => {
        const fixture = findLabFixture("ProjectCreateForm");
        expect(fixture?.scenes.map((s) => s.id)).toEqual([
            "default",
            "filled",
            "creating",
            "recovery-error",
            "phone",
        ]);
    });
});

describe("AgentChatFlow 及拆分子零件 Lab 场景", () => {
    it("完整登记 AgentChatFlow 及其拆分子零件的场景", () => {
        const expectedComponents = [
            "AgentChatFlow",
            "AgentChatEmptyState",
            "AgentChatHistoryLoader",
        ];

        for (const name of expectedComponents) {
            const fixture = findLabFixture(name);
            expect(fixture, `Fixture for ${name} should be registered`).not.toBeNull();
            expect(fixture?.scenes.length).toBeGreaterThan(0);
            expect(typeof fixture?.load).toBe("function");
        }
    });

    it("AgentChatFlow 包含 7 个关键交互与空状态场景", () => {
        const fixture = findLabFixture("AgentChatFlow");
        expect(fixture?.scenes.map((s) => s.id)).toEqual([
            "empty-main",
            "empty-unselected",
            "empty-compact",
            "conversation",
            "with-tools",
            "history-loading",
            "streaming-simulation",
        ]);
    });
});

describe("Agent 消息与专用工具气泡群 Lab 场景", () => {
    it("完整登记新拆解出的文本气泡与专用工具气泡", () => {
        const expectedComponents = [
            "AgentUserBubble",
            "AgentAssistantBubble",
            "AgentThinkingCollapsible",
            "AgentMessageActionBar",
            "AgentSystemBubble",
            "AgentTextBubble",
            "AgentToolBubble",
            "AgentToolNode",
            "AgentEditFileBubble",
            "AgentWriteFileBubble",
            "AgentApplyPatchBubble",
            "AgentSwitchModeBubble",
            "AgentTaskBubble",
            "AgentRequestUserInputBubble",
        ];

        for (const name of expectedComponents) {
            const fixture = findLabFixture(name);
            expect(fixture, `Fixture for ${name} should be registered`).not.toBeNull();
            expect(fixture?.scenes.length).toBeGreaterThan(0);
            expect(typeof fixture?.load).toBe("function");
        }
    });
});

describe("Agent 输入编排层（Composer）子组件 Lab 场景", () => {
    it("完整登记 Composer 输入栏解耦零件与控制面板", () => {
        const expectedComponents = [
            "AgentQueuedMessageList",
            "AgentComposerAvailabilityBanner",
            "AgentComposerImageBar",
            "AgentComposerToolbar",
            "AgentSessionStatusBar",
            "AgentComposerInput",
            "AgentSessionModelControls",
            "AgentUserInputPrompt",
        ];

        for (const name of expectedComponents) {
            const fixture = findLabFixture(name);
            expect(fixture, `Fixture for ${name} should be registered`).not.toBeNull();
            expect(fixture?.scenes.length).toBeGreaterThan(0);
            expect(typeof fixture?.load).toBe("function");
        }
    });
});

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
     * 场景模块是运行时才动态 import 的：specifier 写错时上面这些注册表断言照样全绿，只有真人点开
     * 场景才会看到「场景加载失败」。所以这里把相对导入钉回磁盘，让这类错误在测试里就暴露。
     */
    it("fixture 模块的相对导入都能在磁盘上解析", () => {
        const broken = collectFixtureModules(fixturesRoot).flatMap((file) => {
            const source = readFileSync(file, "utf8");
            return relativeSpecifiers(source)
                .filter((specifier) => !resolvesOnDisk(dirname(file), specifier))
                .map((specifier) => `${relative(fixturesRoot, file)} -> ${specifier}`);
        });

        expect(broken, `这些相对导入指向不存在的文件：${broken.join("、")}。Vite 解析失败会让对应场景在 Lab 里报「场景加载失败」。`).toEqual([]);
    });

    /**
     * 多场景组件的 fixture 必须声明并消费 scene prop。
     * 严禁在 fixture 内部写死静态展示或平铺展示多个状态，否则工具条或 SegmentedControl 切换场景将无反应。
     */
    it("多场景 fixture 必须声明并消费 scene prop", () => {
        const multiSceneFixtures = labFixtures.filter((f) => f.scenes.length > 1);
        const missing: string[] = [];

        for (const entry of multiSceneFixtures) {
            const fixtureFileName = `${entry.component}Fixture.vue`;
            const filePath = join(fixturesRoot, fixtureFileName);
            if (!existsSync(filePath)) continue;
            const content = readFileSync(filePath, "utf8");

            const hasScene = /defineProps<[\s\S]*?scene\s*:\s*string/mu.test(content)
                || /defineProps\([\s\S]*?scene/mu.test(content)
                || content.includes("props.scene")
                || content.includes("scene:");
            if (!hasScene) {
                missing.push(`${entry.component}（${entry.scenes.length} 个场景）`);
            }
        }

        expect(missing, `这些登记了多个场景的组件 fixture 未声明或消费 scene prop，会导致切换场景无响应：${missing.join("、")}`).toEqual([]);
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


