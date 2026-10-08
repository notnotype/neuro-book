import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

export interface GreeterService {
    /** 按当前时间（UTC）问候，例如“上午好，Ada”。 */
    greet(name: string): string;
}

export const greeterKey: ServiceKey<GreeterService> = defineServiceKey<GreeterService>("example.greeter/greeter");
