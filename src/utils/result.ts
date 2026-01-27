export const OK = "OK" as const
export const ERROR = "ERROR" as const

export type Result<Ok, Err> =
    | { _: typeof OK, data: Ok }
    | { _: typeof ERROR, error: Err }

export const Ok = <Ok, Err>(data: Ok): Result<Ok, Err> => ({ _: OK, data })
export const Err = <Ok, Err>(error: Err): Result<Ok, Err> => ({ _: ERROR, error })

export class GenericError {
    public context: string
    public reason?: any

    constructor(context: string, reason?: any) {
        this.context = context
        this.reason = reason
    }

    toString() {
        return this.reason
            ? `${this.context} (Caused by: ${String(this.reason)})`
            : this.context
    }

    toJSON() {
        return {
            context: this.context,
            reason: this.reason,
        }
    }
}
