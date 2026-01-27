import * as Obsidian from "obsidian"
import { z, ZodTypeDef, ZodType } from "zod"

import * as Config from "src/config"
import * as Notice from "src/notice"
import * as log from "src/logger"
import { Result, Ok, Err } from "src/utils/result"
import * as Maintenance from "src/clients/maintenance"

export type Parsers<O, E> = {
    success: ZodType<O, ZodTypeDef, any> | null
    failure: ZodType<E, ZodTypeDef, any> | null
}

export type ResponseError<E> =
    | { _: "MISSING_API_TOKEN" }
    | { _: "API_AUTH_ERROR" }
    | { _: "CLIENT_OUTDATED" }
    | { _: "MAINTENANCE"; mode: Maintenance.Mode }
    | { _: "API_USER_ERROR"; error: E }
    | { _: "API_SERVER_ERROR" }
    | { _: "API_UNEXPECTED_ERROR"; error: any }

export const UserError = <const E extends string, T extends ZodType>(error: E, payload?: T) =>
    z.object({
        error: z.literal(error),
        payload: payload || z.void(),
    })

export function get<O, E>(
    path: string,
    options: { token?: string; parsers: Parsers<O, E> },
): Promise<Result<O, ResponseError<E>>> {
    return fetch<never, O, E>(path, {
        method: "GET",
        token: options.token,
        parsers: options.parsers,
    })
}

export function post<I, O, E>(
    path: string,
    options: { body?: I; headers?: Record<string, string>; parsers: Parsers<O, E> },
): Promise<Result<O, ResponseError<E>>> {
    return fetch<I, O, E>(path, {
        method: "POST",
        data: options.body,
        headers: { "Content-Type": "application/json", ...options.headers },
        parsers: options.parsers,
    })
}

interface FetchOptions<I, O, E> {
    method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
    data?: I
    token?: string
    headers?: Record<string, string>
    parsers: Parsers<O, E>
}

async function fetch<I, O, E>(
    path: string,
    { method, data, token, headers = {}, parsers }: FetchOptions<I, O, E>,
): Promise<Result<O, ResponseError<E>>> {
    const service = Config.Store.service()
    const apiUrl = Config.Store.apiUrl()
    const apiToken = token || Config.Store.apiToken()

    const authHeader = { Authorization: `Bearer ${apiToken}` }
    const clientHeader = { "D42-Client": `${service}/${D42_VERSION};build=${D42_BUILD_ID}` }

    const options: Obsidian.RequestUrlParam = {
        url: `${apiUrl}/v1/providers/obsidian${path}`,
        method,
        headers: { ...headers, ...authHeader, ...clientHeader },
        throw: false,
    }

    if (data) {
        options.body = JSON.stringify(data)
    }

    log.debug(`Sending request ${options.method} ${options.url}`, { body: data })

    try {
        const response: Obsidian.RequestUrlResponse = await Obsidian.requestUrl(options)

        log.debug("Received response", { status: response.status, json: response.json, headers: response.headers })

        if (response.status < 200 || (response.status >= 300 && response.status < 400)) {
            return Err({ _: "API_UNEXPECTED_ERROR", error: new Error(`Unexpected HTTP status: ${response.status}`) })
        }

        if (response.status === 426) {
            Notice.warning("Please update plugin to the latest version and try again", { permanent: true })
            return Err({ _: "CLIENT_OUTDATED" })
        }

        if (response.status === Maintenance.READONLY_HTTP_STATUS) {
            Notice.warning("Service under maintenance. Modifications temporarily disabled.", { permanent: true })
            return Err({ _: "MAINTENANCE", mode: "readonly" })
        }

        if (response.status === Maintenance.FULL_HTTP_STATUS) {
            Notice.warning("Service under maintenance. Please try again later.", { permanent: true })
            return Err({ _: "MAINTENANCE", mode: "full" })
        }

        if (response.status === 401) {
            return Err({ _: "API_AUTH_ERROR" })
        }

        const contentType = response.headers["Content-Type"] || response.headers["content-type"]

        if (contentType && contentType.includes("application/json")) {
            if (userError(response.status)) {
                if (parsers.failure) {
                    let output = parsers.failure.safeParse(response.json)
                    if (output.success) {
                        return Err({ _: "API_USER_ERROR", error: output.data })
                    } else {
                        log.error("Failed to parse response", output.error)
                        return Err({ _: "API_UNEXPECTED_ERROR", error: output.error })
                    }
                } else {
                    let message = "API responded with JSON, but no failure parser provided"
                    log.error(message, { response: response.json })
                    return Err({ _: "API_UNEXPECTED_ERROR", error: { message, response: response.json } })
                }
            } else if (serverError(response.status)) {
                return Err({ _: "API_SERVER_ERROR" })
            }

            if (parsers.success) {
                let output = parsers.success.safeParse(response.json)
                if (output.success) {
                    return Ok(output.data)
                } else {
                    log.error("Failed to parse response", output.error)
                    return Err({ _: "API_UNEXPECTED_ERROR", error: output.error })
                }
            } else {
                log.warn("API responded with JSON, but no success parser provided", { json: response.json })
                return Ok(null as O)
            }
        } else {
            let text = response.text.trim()

            if (userError(response.status)) {
                if (parsers.failure) {
                    let message = "Failure parser provided, but API didn't respond with JSON"
                    log.error(message, { response: text })
                    return Err({ _: "API_UNEXPECTED_ERROR", error: { message, response: text } })
                } else {
                    log.warn("API responded with non-JSON user error", { response: text })
                    return Err({ _: "API_USER_ERROR", error: text as E })
                }
            } else if (serverError(response.status)) {
                return Err({ _: "API_SERVER_ERROR" })
            }

            if (parsers.success) {
                let message = "Success parser provided, but API didn't respond with JSON"
                log.error(message, { response: text })
                return Err({ _: "API_UNEXPECTED_ERROR", error: { message, response: text } })
            } else {
                if (text) {
                    log.warn("Success text response", { response: text })
                }
                return Ok(null as O)
            }
        }
    } catch (error) {
        log.error("Fetch error", error)
        return Err({ _: "API_UNEXPECTED_ERROR", error })
    }
}

export function userError(status: number) {
    return status >= 400 && status < 500
}

export function serverError(status: number) {
    return status >= 500
}
