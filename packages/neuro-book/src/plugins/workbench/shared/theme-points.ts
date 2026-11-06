/**
 * 主题相关贡献点的 id 与场景提供者的合同类型（docs/specs/theme/skins.md）。单独一个叶子文件：插件 SDK 的 `/workbench` 要导出这些，
 * 不能因此把内置主题的数据与界面文字一起公开。
 */

export const WORKBENCH_THEMES_POINT = "workbench.themes";
/** 由代码提供的场景图（输出 18）：浏览器入口的贡献，主题经 `sceneProvider` 引用。 */
export const WORKBENCH_THEME_SCENES_POINT = "workbench.theme-scenes";

export interface SceneRequest {
    readonly appearance: "light" | "dark";
    /** Agent 工作中（与 `Look.workingScene` 同一个状态）。 */
    readonly working: boolean;
}

export interface SceneResult {
    /** 图片；类型要是 `image/*`，不超过 `MAX_SCENE_BYTES`。 */
    readonly image: Blob;
    /** 到这个时刻（毫秒时间戳）重新请求一次；没有则只画一次。新图解码成功后才替换旧图。 */
    readonly expiresAt?: number;
}

export interface SceneProviderImplementation {
    scene(request: SceneRequest, signal: AbortSignal): Promise<SceneResult>;
}

export const MAX_SCENE_BYTES = 4 * 1024 * 1024;
