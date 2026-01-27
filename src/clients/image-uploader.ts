import { z } from "zod"

import * as Config from "src/config"
import * as Image from "src/models/image"
import * as Api from "src/clients/api"
import * as log from "src/logger"
import { Result, Ok, Err } from "src/utils/result"
import * as Maintenance from "src/clients/maintenance"

export type ResponseError =
    | { _: "MISSING_API_TOKEN" }
    | { _: "API_AUTH_ERROR" }
    | { _: "MAINTENANCE"; mode: Maintenance.Mode }
    | { _: "API_USER_ERROR"; error: UserError }
    | { _: "API_SERVER_ERROR" }
    | { _: "API_UNEXPECTED_ERROR"; error: any }

const UserError = z.string()
export type UserError = z.infer<typeof UserError>

export async function post(data: FormData): Promise<Result<Image.UploadedImage, ResponseError>> {
    const imageUploaderUrl = Config.Store.imageUploaderUrl()
    const apiToken = Config.Store.apiToken()

    log.debug(`Sending request: POST ${imageUploaderUrl}`, { body: data })

    try {
        const response = await fetch(imageUploaderUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiToken}` },
            body: data,
        })

        log.debug("Received response", { status: response.status })

        if (response.status < 200 || (response.status >= 300 && response.status < 400)) {
            return Err({ _: "API_UNEXPECTED_ERROR", error: new Error(`Unexpected HTTP status: ${response.status}`) })
        }

        if (response.status === 401) {
            return Err({ _: "API_AUTH_ERROR" })
        }

        if (response.status === Maintenance.READONLY_HTTP_STATUS) {
            return Err({ _: "MAINTENANCE", mode: "readonly" })
        }

        if (response.status === Maintenance.FULL_HTTP_STATUS) {
            return Err({ _: "MAINTENANCE", mode: "full" })
        }

        const contentType = response.headers.get("content-type")

        if (contentType && contentType.includes("application/json")) {
            const json = await response.json()

            log.debug("Parsed JSON response", { json })

            if (Api.userError(response.status)) {
                let output = UserError.safeParse(json)
                if (output.success) {
                    return Err({ _: "API_USER_ERROR", error: output.data })
                } else {
                    log.error("Failed to parse image uploader error response", output.error)
                    return Err({ _: "API_UNEXPECTED_ERROR", error: output.error })
                }
            } else if (Api.serverError(response.status)) {
                return Err({ _: "API_SERVER_ERROR" })
            }

            let output = Image.UploadedImage.safeParse(json)

            if (output.success) {
                return Ok(output.data)
            } else {
                log.error("Failed to parse image uploader successful response", output.error)
                return Err({ _: "API_UNEXPECTED_ERROR", error: output.error })
            }
        } else {
            if (Api.serverError(response.status)) {
                return Err({ _: "API_SERVER_ERROR" })
            }

            let text = await response.text()

            return Err({
                _: "API_UNEXPECTED_ERROR",
                error: { message: "Non JSON response from image uploader", response: text.trim() },
            })
        }
    } catch (error) {
        log.error("Fetch error", error)
        return Err({ _: "API_UNEXPECTED_ERROR", error })
    }
}
