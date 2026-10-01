export type ProductExitCode = 0 | 1 | 75;

/** 插件和控制面只提供停止原因；信号、排空、日志和进程退出由宿主拥有。 */
export interface ProductStopPort {
    requestStop(source: string, exitCode?: ProductExitCode): void;
}
