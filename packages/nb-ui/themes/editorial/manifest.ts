import type {NbThemeManifest} from "../../src/theme/theme-manifest";

/**
 * editorial 是**最小主题**：不新增变量、不带配色、不带资源、不覆盖组件。
 * 整个包就是这 12 行 + 一份 vars.css。声明式主题的下限。
 *
 * 它同时是一方主题——刻意与第三方主题走**同一条装载路径**，
 * 这样主题包格式先在自己身上被验证一遍，且全仓只有一条代码路径。默认主题是 `macos`，
 * 它享受的待遇与这一套完全相同。
 */
export const manifest: NbThemeManifest = {
    id: "editorial",
    name: "Editorial",
    tagline: "编辑室",
    description: "纸感、克制。靠边框和底色分层，几乎不用阴影。小圆角 4px，控制区 13px。",
    version: "1.0.0",
    author: "nb-ui",
    hostVersion: "^0.3.0",
};
