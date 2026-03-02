import type Plugin from "src/main"
import * as Config from "src/config"
import * as Site from "src/models/site"
import * as GetSitesRequest from "src/clients/requests/get-sites"
import { OK, ERROR } from "src/utils/result"

export type OnboardInput = {
    token: string
    sitePath: string
}

const TOKEN_SECRET_NAME = "d42-token"

async function onboard(plugin: Plugin, input: OnboardInput): Promise<void> {
    // Store the token in SecretStorage
    await plugin.app.secretStorage.setSecret(TOKEN_SECRET_NAME, input.token)
    await Config.Store.setTokenSecretName(TOKEN_SECRET_NAME)

    // Fetch sites from API
    let result = await GetSitesRequest.send(input.token)

    switch (result._) {
        case OK: {
            let sites: Config.SitesSettings = {}

            for (let site of result.data) {
                sites[site.id] = {
                    path: input.sitePath,
                    enabled: true,
                    default: typeof site.owner === "object" && site.owner.TAG === "User" ? site.owner.isPrimary : false,
                    config: site,
                }
            }

            await Config.Store.setSites(sites)
            await Config.Store.setOnboarded(true)
            await Site.createFolders(plugin.app)
            break
        }
        case ERROR: {
            throw new Error(result.error._)
        }
        default:
            result satisfies never
    }
}

export function registerCommand(plugin: Plugin): void {
    plugin.headless.onboard = input => onboard(plugin, input)
}
