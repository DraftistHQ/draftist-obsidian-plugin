const styles = {
    trace: "background: #636363; color: #fff; font-weight: bold;",
    debug: "background: #82658c; color: #fff; font-weight: bold;",
    info: "background: #29d; color: #fff; font-weight: bold;",
    warn: "background: #fce473; color: #573a08; font-weight: bold;",
    error: "background: #d11a1a; color: #fff; font-weight: bold;",
}

const isExtensiveLogging = () => !!window.DFT_DEBUG_EXTENSIVE_LOGGING

function createLogger(level: string, style: string) {
    return (...args: any[]) => {
        const shouldLog = ["INFO", "WARN", "ERROR"].includes(level) || isExtensiveLogging()

        if (!shouldLog) return

        console.log(`%c DRAFTIST: ${level} `, style, ...args)
    }
}

export const trace = createLogger("TRACE", styles.trace)
export const debug = createLogger("DEBUG", styles.debug)
export const info = createLogger("INFO", styles.info)
export const warn = createLogger("WARN", styles.warn)
export const error = createLogger("ERROR", styles.error)
