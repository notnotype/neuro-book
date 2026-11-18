/**
 * eval 内核与宿主两边都要的几个常量。单放一个文件：内核入口要用它们，但不能为几个常量把 TypeBox、acorn 也打进内核的包
 * （每起一个内核都要加载）。
 */

/** 协议版本。握手时版本不同（升级后还在跑的旧入口、构建漏了入口）就拒绝，不让两边按不同的协议说话。 */
export const EVAL_PROTOCOL_VERSION = 1;

/**
 * 单元结束时内核往自己的标准输出与错误各写一个这个标记，再发 `done`。直接写 fd 的输出走管道、`done` 走 IPC，两者谁先到没有保证；
 * 管道是先进先出的，宿主在两条管道里都读到标记，就知道这个单元期间写的都收全了。
 */
export const cellEndMarker = (cell: number): string => `\u0000nbook-eval-cell-end:${String(cell)}\u0000`;

/** 内核在全局上的模块解析函数：代码里的顶层 `import` 与 `import(…)` 都改写成调它（`rewrite.ts`），按工作目录解析（`kernel-entry.ts`）。 */
export const IMPORT_HELPER = "__nbook_import__";
