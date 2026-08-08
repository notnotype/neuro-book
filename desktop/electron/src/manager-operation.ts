export type ManagerGuiProvider = "managed" | "system";
export type ManagerGuiScope = "user" | "machine";
export type ManagerGuiChannel = "stable" | "canary";

export type ManagerGuiProviderInput = {
    name: string;
    baseURL: string;
    api: string;
    apiKey: string;
    model: string;
    discoverModels?: boolean;
};

export type ManagerGuiOperation =
    | {
        kind: "install";
        source: {kind: "path" | "https-manifest"; value: string};
        scope: ManagerGuiScope;
        channel: ManagerGuiChannel;
        runtimeProvider: ManagerGuiProvider;
        toolProvider: ManagerGuiProvider;
        addCliToPath: boolean;
        enableAuth: boolean;
        adminPassword?: string;
    }
    | {kind: "status"}
    | {kind: "doctor"}
    | {kind: "repair"}
    | {kind: "uninstall"; deleteData: boolean}
    | {kind: "configure-provider"; provider: ManagerGuiProviderInput}
    | {kind: "test-provider"; provider: ManagerGuiProviderInput};
