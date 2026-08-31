/**
 * 事件日志条目。类型单独成文件，因为 `<script setup>` 里不能导出类型，
 * 而 fixture 与 Lab 外壳都要按它构造条目。
 */
export type LabEventEntry = {
    /** 条目标识，展开状态按它记。使用方保证同一列表内不重复。 */
    id: string;
    /** 事件名，例如 "update:collapsed"。 */
    name: string;
    /** 发生时间。由使用方记录，本零件不取当前时间。 */
    at: Date;
    /** 事件负载。`undefined` 表示没有负载，条目不可展开；`null` 属于有负载。 */
    payload?: unknown;
};
