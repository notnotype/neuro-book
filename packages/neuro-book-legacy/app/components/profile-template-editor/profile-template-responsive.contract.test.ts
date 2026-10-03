import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const headerPath = fileURLToPath(new URL("./ProfileTemplateHeader.vue", import.meta.url));
const libraryPanelPath = fileURLToPath(new URL("./ProfileTemplateComponentLibraryPanel.vue", import.meta.url));
const inspectorPanelPath = fileURLToPath(new URL("./ProfileTemplateInspectorPanel.vue", import.meta.url));
const canvasPanelPath = fileURLToPath(new URL("./ProfileTemplateCanvasPanel.vue", import.meta.url));
const visualEditorPath = fileURLToPath(new URL("./ProfileTemplateVisualEditor.vue", import.meta.url));

describe("Profile Template 工作台响应式契约", () => {
    it("顶栏窄容器可换行，动作按钮完整可达且带语义标签", async () => {
        const source = (await readFile(headerPath, "utf8")).replace(/\r\n/g, "\n");

        expect(source).toContain('class="profile-template-header__actions flex min-w-0 max-w-full shrink-0 flex-wrap items-center gap-2"');
        // 品牌块与模板选择器同处 identity 容器：用 div 配对边界证明嵌套，而非仅顺序
        const identityOpen = source.indexOf('class="profile-template-header__identity');
        const selectOpen = source.indexOf("<FormSelect");
        const actionsOpen = source.indexOf('class="profile-template-header__actions');
        expect(identityOpen).toBeGreaterThanOrEqual(0);
        expect(selectOpen).toBeGreaterThan(identityOpen);
        expect(actionsOpen).toBeGreaterThan(selectOpen);
        const divPattern = /<div\b|<\/div>/g;
        divPattern.lastIndex = identityOpen;
        let depth = 1;
        let identityClose = -1;
        let match: RegExpExecArray | null;
        while ((match = divPattern.exec(source)) !== null) {
            depth += match[0].startsWith("</") ? -1 : 1;
            if (depth === 0) {
                identityClose = match.index;
                break;
            }
        }
        expect(identityClose).toBeGreaterThan(selectOpen);
        expect(identityClose).toBeLessThan(actionsOpen);
        expect(source).not.toContain("flex h-12 shrink-0 items-center");
        expect(source).toContain("profile-template-header__identity flex min-w-0 items-center gap-3");
        expect(source).toContain("@container (max-width: 900px)");
        // 状态文本可无限长（可能拼接服务端错误信息），必须可收缩截断而非撑爆动作区
        expect(source).toContain('class="hidden min-w-0 items-center gap-1 text-xs text-[var(--status-success)] md:flex"');
        expect(source).toContain('class="min-w-0 truncate">{{ props.editorStatusText }}');

        // 全部图标按钮逐个关联 type 与 aria-label，且不依赖原生 title
        const buttonTags = source.match(/<button[^>]*>/g) ?? [];
        expect(buttonTags.length).toBeGreaterThanOrEqual(11);
        for (const tag of buttonTags) {
            expect(tag).toContain('type="button"');
            expect(tag).toContain("aria-label=");
        }
        expect(source).not.toMatch(/\stitle="/);

        // disabled 按钮的 Tooltip 触发包装：每个 :disabled 按钮必须被真实盒模型 span 包裹，
        // 且该按钮携带 disabled:pointer-events-none；wrapper 数与 disabled 按钮数相等，不允许样例式存在
        const disabledButtonTags = buttonTags.filter((tag) => tag.includes(":disabled="));
        const wrappedButtonTags = source.match(/profile-template-tooltip-trigger">\s*<button[^>]*>/g) ?? [];
        expect(disabledButtonTags.length).toBeGreaterThanOrEqual(10);
        expect(wrappedButtonTags.length).toBe(disabledButtonTags.length);
        for (const tag of wrappedButtonTags) {
            expect(tag).toContain(":disabled=");
            expect(tag).toContain("disabled:pointer-events-none");
        }
    });

    it("组件库与检查器折叠按钮统一使用 Tooltip，不再使用原生 title", async () => {
        const librarySource = (await readFile(libraryPanelPath, "utf8")).replace(/\r\n/g, "\n");
        const inspectorSource = (await readFile(inspectorPanelPath, "utf8")).replace(/\r\n/g, "\n");

        expect(librarySource).toContain('import Tooltip from "nbook/app/components/common/Tooltip.vue"');
        expect(librarySource).toContain('<Tooltip text="收起组件库" placement="bottom">');
        expect(librarySource).toContain('aria-label="收起组件库"');
        expect(librarySource).not.toContain('title="收起组件库"');

        expect(inspectorSource).toContain('import Tooltip from "nbook/app/components/common/Tooltip.vue"');
        expect(inspectorSource).toContain('<Tooltip text="收起右侧面板" placement="bottom">');
        expect(inspectorSource).toContain('aria-label="收起右侧面板"');
        expect(inspectorSource).not.toContain('title="收起右侧面板"');
    });

    it("主网格按容器宽度分层：窄容器单列无横向滚动，宽容器恢复三栏轨道", async () => {
        const source = (await readFile(visualEditorPath, "utf8")).replace(/\r\n/g, "\n");

        expect(source).toContain("profile-editor-main grid min-h-0 min-w-0 flex-1 gap-3 overflow-hidden p-3");
        expect(source).toContain("'library-collapsed'");
        expect(source).toContain("'inspector-collapsed'");
        expect(source).not.toContain("overflow-x-auto");
        expect(source).not.toContain("!grid-cols-");

        expect(source).toContain("container-type: inline-size");
        expect(source).toContain("@container (min-width: 1259px)");
        // 规则块级断言：轨道声明必须绑定在对应状态选择器的规则内，防止字符串挪动规则仍假绿
        const mainRules = source.match(/\.profile-editor-main[^{]*\{[^}]*\}/g) ?? [];
        const expectRule = (selectorPart: string, declaration: string) => {
            const rule = mainRules.find((candidate) => candidate.includes(selectorPart) && candidate.includes(declaration));
            expect(rule, `缺少规则 ${selectorPart} → ${declaration}`).toBeDefined();
        };
        // 窄容器：四种折叠状态的行轨道与状态选择器一一绑定
        expectRule(":where(:not(.library-collapsed):not(.inspector-collapsed))", "grid-template-rows: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)");
        expectRule(":where(.library-collapsed:not(.inspector-collapsed))", "grid-template-rows: 52px minmax(0, 1fr) minmax(0, 1fr)");
        expectRule(":where(.inspector-collapsed:not(.library-collapsed))", "grid-template-rows: minmax(0, 1fr) minmax(0, 1fr) 52px");
        expectRule(":where(.library-collapsed.inspector-collapsed)", "grid-template-rows: 52px minmax(0, 1fr) 52px");
        // 宽容器：基础规则同时锁定单行与全展开列轨道；三种折叠列轨道与状态选择器一一绑定
        const wideBaseRule = mainRules.find((candidate) => candidate.includes("grid-template-rows: minmax(0, 1fr);") && candidate.includes("grid-template-columns: 290px minmax(560px, 1fr) minmax(360px, 30vw)"));
        expect(wideBaseRule).toBeDefined();
        expectRule(".profile-editor-main.library-collapsed {", "grid-template-columns: 52px minmax(560px, 1fr) minmax(360px, 30vw)");
        expectRule(".profile-editor-main.inspector-collapsed {", "grid-template-columns: 290px minmax(560px, 1fr) 52px");
        expectRule(".profile-editor-main.library-collapsed.inspector-collapsed {", "grid-template-columns: 52px minmax(560px, 1fr) 52px");
        // 特异性守卫：窄态单折叠规则的状态匹配必须整体收进 :where()，
        // 否则 :not() 贡献的 (0,1,0) 会让窄态行规则 (0,2,0) 压过宽容器 @container 规则 (0,1,0)。
        // 精确否定两种回归形态，避免误伤合法的 :where(:not(..):not(..)) 全展开规则。
        expect(source).not.toContain(".profile-editor-main:where(.library-collapsed):not(");
        expect(source).not.toContain(".profile-editor-main:where(.inspector-collapsed):not(");
    });

    it("折叠态面板入口是语义按钮并保留 Tooltip", async () => {
        const source = (await readFile(visualEditorPath, "utf8")).replace(/\r\n/g, "\n");

        expect(source).toContain('<button type="button" class="panel-rail" aria-label="展开右侧面板"');
        expect(source).not.toContain('<aside class="panel-rail"');
        expect(source).toContain('<Tooltip text="展开组件库" placement="right">');
        expect(source).toContain('aria-label="展开组件库"');
    });

    it("单列布局下面板根节点允许收缩，不被内容最小宽度撑开", async () => {
        const librarySource = (await readFile(libraryPanelPath, "utf8")).replace(/\r\n/g, "\n");
        const canvasSource = (await readFile(canvasPanelPath, "utf8")).replace(/\r\n/g, "\n");

        expect(librarySource).toContain('class="panel flex min-h-0 min-w-0 flex-col"');
        expect(canvasSource).toContain('class="panel flex min-h-0 min-w-0 flex-col"');
    });
});
