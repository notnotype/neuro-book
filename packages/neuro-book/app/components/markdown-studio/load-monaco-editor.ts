export type MonacoEditorApi = typeof import("monaco-editor/esm/vs/editor/editor.api.js");

type MonacoWorkerCtor = {
    new (): Worker;
};

let monacoLoader: Promise<MonacoEditorApi> | null = null;

/**
 * 配置 Monaco 的 worker 工厂。
 * JSON 语言服务需要自己的 worker；其它工作区文本编辑走 editor worker。
 */
export const ensureMonacoEnvironment = (workers: {
    editor: MonacoWorkerCtor;
    json: MonacoWorkerCtor;
}): void => {
    globalThis.MonacoEnvironment = {
        getWorker(_moduleId: string, label: string) {
            if (label === "json") {
                return new workers.json();
            }
            return new workers.editor();
        },
    };
};

/**
 * 按需加载 Monaco ESM 入口，绕开 Vite 对 monaco-editor 整包预构建。
 */
export const loadMonacoEditor = async (): Promise<MonacoEditorApi> => {
    if (!monacoLoader) {
        monacoLoader = (async () => {
            const [
                monacoModule,
                _markdownContribution,
                _jsonContribution,
                _javascriptContribution,
                _typescriptContribution,
                _cssContribution,
                _htmlContribution,
                _xmlContribution,
                _yamlContribution,
                editorWorkerModule,
                jsonWorkerModule,
            ] = await Promise.all([
                import("monaco-editor/esm/vs/editor/editor.api.js"),
                import("monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js"),
                import("monaco-editor/esm/vs/language/json/monaco.contribution.js"),
                import("monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js"),
                import("monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js"),
                import("monaco-editor/esm/vs/basic-languages/css/css.contribution.js"),
                import("monaco-editor/esm/vs/basic-languages/html/html.contribution.js"),
                import("monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js"),
                import("monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js"),
                import("monaco-editor/esm/vs/editor/editor.worker.js?worker"),
                import("monaco-editor/esm/vs/language/json/json.worker.js?worker"),
            ]);

            ensureMonacoEnvironment({
                editor: editorWorkerModule.default,
                json: jsonWorkerModule.default,
            });
            return monacoModule;
        })().catch((error: unknown) => {
            monacoLoader = null;
            throw error;
        });
    }

    return monacoLoader;
};
