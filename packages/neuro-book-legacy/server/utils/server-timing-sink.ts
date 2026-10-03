/** 可选的 Server-Timing 记录出口，不依赖具体 HTTP runtime。 */
export type ServerTimingSink = {
    mark(name: string, durationMs: number): void;
};
