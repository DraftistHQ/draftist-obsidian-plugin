export const onNextTick = (fn: () => void) => {
    setTimeout(fn, 1)
}
