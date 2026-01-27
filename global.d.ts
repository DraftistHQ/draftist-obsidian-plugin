export {}

declare global {
    var D42_VERSION: string
    var D42_BUILD_ID: string
    var D42_BUILD_TYPE: "debug" | "release"
    var D42_CONFIG: string | null

    interface Window {
        D42_DEBUG_EXTENSIVE_LOGGING: boolean | void
    }
}
