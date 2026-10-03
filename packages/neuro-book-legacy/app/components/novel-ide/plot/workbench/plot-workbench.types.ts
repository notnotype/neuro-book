/**
 * 工作台手动维护的结构化引用。
 */
export type WorkbenchManualRef = {
    id: string;
    relation: string;
    target: string;
    note: string | null;
};
