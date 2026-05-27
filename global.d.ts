export {}

declare global {
    var DFT_VERSION: string
    var DFT_BUILD_ID: string
    var DFT_BUILD_TYPE: "debug" | "release"
    var DFT_CONFIG: string | null

    interface Window {
        DFT_DEBUG_EXTENSIVE_LOGGING: boolean | void
    }
}
