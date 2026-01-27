export const generate = (length: number) => {
    return crypto.randomUUID().replace(/-/g, "").substring(0, length)
}
