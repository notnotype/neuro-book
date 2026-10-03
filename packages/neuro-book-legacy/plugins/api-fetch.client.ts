import {resolveApiErrorMessage} from "nbook/app/utils/api-error";

type ApiFetchOptions = {
    notify?: boolean;
    errorMessage?: string | false;
};

export default defineNuxtPlugin(() => {
    const notification = useNotification();
    const originalFetch = globalThis.$fetch;

    const wrappedFetch = originalFetch.create({
        onResponseError({options, error}) {
            const requestOptions = options as ApiFetchOptions | undefined;
            if (requestOptions?.notify === false) {
                return;
            }

            const message = requestOptions?.errorMessage === false
                ? ""
                : requestOptions?.errorMessage || resolveApiErrorMessage(error, "请求失败");
            if (!message) {
                return;
            }

            notification.error(message);
        },
    });

    globalThis.$fetch = wrappedFetch as typeof $fetch;

    return {
        provide: {
            apiFetch: wrappedFetch,
        },
    };
});
