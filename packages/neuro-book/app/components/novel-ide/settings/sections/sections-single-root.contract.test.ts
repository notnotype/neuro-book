/**
 * 契约：调用点给组件挂 `class` 时，组件必须**单根**。
 *
 * 多根模板（`v-if`/`v-else` 两支、并列兄弟）会让 Vue 丢弃调用点传入的 `class` / `style` /
 * 监听器，只在 dev 打一条警告，布局随之静默消失——本项目已两次踩到（Provider 详情列、
 * 服务商导轨：左侧内边距与顶部间距都没生效）。这条契约把「靠人记住」换成机械检查。
 *
 * 范围：`sections/` 下**本目录内定义**的组件（`<Name.vue>`）。nb-ui 基座组件在库内自测，
 * 不在本契约范围。需要承载滚动/内边距的组件，请把这两件事写在自己的根上。
 */
import {readFileSync, readdirSync} from "node:fs";
import {basename, dirname, join, relative} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const sectionsDir = dirname(fileURLToPath(import.meta.url));

function vueFiles(dir: string): string[] {
    return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            return vueFiles(path);
        }
        return entry.isFile() && entry.name.endsWith(".vue") ? [path] : [];
    });
}

function templateOf(source: string): string {
    const start = source.indexOf("<template>");
    const end = source.lastIndexOf("</template>");
    return start < 0 || end < 0 ? "" : source.slice(start, end);
}

/** 模板顶层元素数量：仓库约定根元素缩进 4 空格，注释行不计。 */
function rootCount(template: string): number {
    return template.split("\n").filter((line) => /^ {4}<[A-Za-z]/.test(line)).length;
}

describe("sections 单根契约", () => {
    it("被调用点挂 class 的同区段组件都是单根模板", () => {
        const files = vueFiles(sectionsDir);
        const byName = new Map(files.map((file) => [basename(file, ".vue"), file]));
        const offenders: string[] = [];

        for (const file of files) {
            const template = templateOf(readFileSync(file, "utf8"));
            // `<Component ... class=...>`：允许跨行，`[^<]` 保证不越过标签边界
            for (const match of template.matchAll(/<([A-Z][A-Za-z0-9]*)\b[^<]*?\bclass=/gs)) {
                const componentName = match[1] ?? "";
                const target = byName.get(componentName);
                if (!target || target === file) {
                    continue;
                }
                const roots = rootCount(templateOf(readFileSync(target, "utf8")));
                if (roots !== 1) {
                    offenders.push(`${relative(sectionsDir, file).replace(/\\/g, "/")} → <${componentName}> 有 ${roots} 个根元素`);
                }
            }
        }

        expect(offenders).toEqual([]);
    });

    it("检测器本身有效：能认多根、也能认出被挂 class 的调用点", () => {
        // 多根模板（v-if/v-else 两支）必须被判为 2 个根，否则本契约会静默失效
        const multiRoot = templateOf("<template>\n    <section v-if=\"a\">\n    </section>\n    <section v-else>\n    </section>\n</template>");
        expect(rootCount(multiRoot)).toBe(2);

        const files = vueFiles(sectionsDir);
        const byName = new Set(files.map((file) => basename(file, ".vue")));
        const carriesClass = files.some((file) => {
            const template = templateOf(readFileSync(file, "utf8"));
            return [...template.matchAll(/<([A-Z][A-Za-z0-9]*)\b[^<]*?\bclass=/gs)].some((match) => byName.has(match[1] ?? ""));
        });
        // 扫描面必须非空：全是「没命中」的话，这条契约就等于没跑
        expect(carriesClass).toBe(true);
    });
});
