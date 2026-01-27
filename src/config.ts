import * as Obsidian from "obsidian"
import { z } from "zod"
import * as _ from "lodash"

import * as Site from "src/models/site"
import { Result, Ok, Err } from "src/utils/result"

export const Service = z.string().brand<"Service">()
export type Service = z.infer<typeof Service>

export type BuildId = typeof D42_BUILD_ID
export type BuildType = typeof D42_BUILD_TYPE

export type Build = {
    id: BuildId
    type: BuildType
}

export const Target = z.union([z.literal("local"), z.literal("production")])
export type Target = z.infer<typeof Target>

export const ApiUrl = z.string().brand<"ApiUrl">()
export type ApiUrl = z.infer<typeof ApiUrl>

export const ApiToken = z.string().brand<"ApiToken">()
export type ApiToken = z.infer<typeof ApiToken>

export const PlatformUrl = z.string().brand<"PlatformUrl">()
export type PlatformUrl = z.infer<typeof PlatformUrl>

export const ImageUploaderUrl = z.string().brand<"ImageUploaderUrl">()
export type ImageUploaderUrl = z.infer<typeof ImageUploaderUrl>

const Config = z.object({
    service: Service,
    target: Target,
    apiUrl: ApiUrl,
    platformUrl: PlatformUrl,
    imageUploaderUrl: ImageUploaderUrl,
})
type Config = z.infer<typeof Config>

export const SiteSettings = z.object({
    path: z.string().nullable(),
    enabled: z.boolean(),
    default: z.boolean(),
    config: Site.T,
})
export type SiteSettings = z.infer<typeof SiteSettings>

export const ValidSiteSettings = z.object({
    path: z.string(),
    enabled: z.boolean(),
    default: z.boolean(),
    config: Site.T,
})
export type ValidSiteSettings = z.infer<typeof ValidSiteSettings>

const SitesSettings = z.record(Site.SiteId, SiteSettings)
export type SitesSettings = z.infer<typeof SitesSettings>
const ValidSitesSettings = z.record(Site.SiteId, ValidSiteSettings)
export type ValidSitesSettings = z.infer<typeof ValidSitesSettings>

const AutomationsSettings = z.object({
    manageFileTrees: z.boolean(),
    blockIds: z.object({
        enable: z.boolean(),
        opacity: z.number(),
    }),
})
export type AutomationsSettings = z.infer<typeof AutomationsSettings>

const DebuggingSettings = z.object({
    extensiveLogging: z.boolean(),
    exposeInternalMetadata: z.boolean(),
})
type DebuggingSettings = z.infer<typeof DebuggingSettings>

const Settings = z.object({
    onboarded: z.boolean(),
    tokenSecretName: z.string().optional().nullable(),
    sites: SitesSettings,
    automations: AutomationsSettings,
    debugging: DebuggingSettings,
})
export type Settings = z.infer<typeof Settings>

const ValidSettings = z.object({
    tokenSecretName: z.string(),
    sites: ValidSitesSettings,
    automations: AutomationsSettings,
})
type ValidSettings = z.infer<typeof ValidSettings>

export const DEFAULT_SETTINGS: Settings = {
    onboarded: false,
    tokenSecretName: null,
    sites: {},
    automations: {
        manageFileTrees: true,
        blockIds: {
            enable: true,
            opacity: 0.15,
        },
    },
    debugging: {
        extensiveLogging: false,
        exposeInternalMetadata: false,
    },
}

export type SettingsValidationError =
    | { _: "MISSING_TOKEN" }
    | { _: "NO_SITES" }
    | { _: "MISSING_SITE_PATH"; error: { site: Site.SitePrimaryAddress } }
    | { _: "NO_SITE_MODULES"; error: { site: Site.SitePrimaryAddress } }

export type SiteSettingsValidationError = SettingsValidationError | { _: "MISSING_SITE" }

export class Store {
    private static self: Store
    private static plugin: Obsidian.Plugin

    private build: Build
    private service: Service
    private target: Target
    private apiUrl: ApiUrl
    private platformUrl: PlatformUrl
    private imageUploaderUrl: ImageUploaderUrl
    private userSettings: Settings

    private constructor(build: Build, config: Config, settings: Settings) {
        this.build = build
        this.service = config.service
        this.target = config.target
        this.apiUrl = config.apiUrl
        this.platformUrl = config.platformUrl
        this.imageUploaderUrl = config.imageUploaderUrl
        this.userSettings = settings
    }

    static async init(plugin: Obsidian.Plugin) {
        let build = { id: D42_BUILD_ID, type: D42_BUILD_TYPE }
        let config = await Store.loadConfig(plugin)
        let userSettings = await Store.loadUserSettings(plugin)
        Store.self = new Store(build, config, userSettings)
        Store.plugin = plugin
    }

    static dispose() {
        Store.self = null!
        Store.plugin = null!
    }

    // --- Loaders

    private static async loadConfig(plugin: Obsidian.Plugin): Promise<Config> {
        // Release builds have config bundled at build time as JSON
        if (D42_BUILD_TYPE === "release" && D42_CONFIG) {
            return Config.parse(JSON.parse(D42_CONFIG))
        }
        // Debug builds load from config.json file
        return await this.loadConfigFromFile(plugin)
    }

    private static async loadConfigFromFile(plugin: Obsidian.Plugin): Promise<Config> {
        let { app, manifest } = plugin

        let path = Obsidian.normalizePath(`${manifest.dir}/config.json`)
        let data = await app.vault.adapter.read(path)
        let json = JSON.parse(data)

        return Config.parse(json)
    }

    private static async loadUserSettings(plugin: Obsidian.Plugin): Promise<Settings> {
        let data = await plugin.loadData()

        // Migration: remove old `token` field if present (now using SecretStorage)
        if (data && "token" in data) {
            delete data.token
            await plugin.saveData(data)
        }

        let settings: Settings = _.merge({}, DEFAULT_SETTINGS, data)
        window.D42_DEBUG_EXTENSIVE_LOGGING = !!settings.debugging.extensiveLogging
        return settings
    }

    private static async updateUserSettings(updater: (settings: Settings) => void) {
        updater(Store.self.userSettings)
        await Store.plugin.saveData(Store.self.userSettings)
    }

    static async resetUserSettings() {
        Store.self.userSettings = DEFAULT_SETTINGS
        await Store.plugin.saveData(Store.self.userSettings)
    }

    // --- Getters / Setters

    static onboarded(): boolean {
        return Store.self.userSettings.onboarded
    }

    static async setOnboarded(value: boolean) {
        await Store.updateUserSettings(settings => {
            settings.onboarded = value
        })
    }

    static service(): Service {
        return Store.self.service
    }

    static target(): Target {
        return Store.self.target
    }

    static apiUrl(): ApiUrl {
        return Store.self.apiUrl
    }

    static apiToken(): ApiToken | null {
        const secretName = Store.self.userSettings.tokenSecretName
        if (!secretName) return null
        const value = Store.plugin.app.secretStorage.getSecret(secretName)
        return value ? ApiToken.parse(value) : null
    }

    static tokenSecretName(): string | null {
        return Store.self.userSettings.tokenSecretName || null
    }

    static async setTokenSecretName(name: string | null) {
        await Store.updateUserSettings(settings => {
            settings.tokenSecretName = name || null
        })
    }

    static platformUrl(): PlatformUrl {
        return Store.self.platformUrl
    }

    static imageUploaderUrl(): ImageUploaderUrl {
        return Store.self.imageUploaderUrl
    }

    static userSettings(): Settings {
        return Store.self.userSettings
    }

    static sites(): SitesSettings {
        return Store.self.userSettings.sites
    }

    static siteSettings(siteId: Site.SiteId): SiteSettings | void {
        return Store.self.userSettings.sites[siteId]
    }

    static async setSites(sites: SitesSettings) {
        await Store.updateUserSettings(settings => {
            settings.sites = sites
        })
    }

    static async setSiteSettings(siteId: Site.SiteId, site: SiteSettings) {
        await Store.updateUserSettings(settings => {
            settings.sites[siteId] = site
        })
    }

    static automations(): AutomationsSettings {
        return Store.self.userSettings.automations
    }

    static async setAutomationsManageFileTrees(value: boolean) {
        await Store.updateUserSettings(settings => {
            settings.automations.manageFileTrees = value
        })
    }

    static async setAutomationsBlockIdsEnable(value: boolean) {
        await Store.updateUserSettings(settings => {
            settings.automations.blockIds.enable = value
        })
    }

    static async setAutomationsBlockIdsOpacity(value: number) {
        await Store.updateUserSettings(settings => {
            settings.automations.blockIds.opacity = value
        })
    }

    static debugging(): DebuggingSettings {
        return Store.self.userSettings.debugging
    }

    static async setDebuggingExtensiveLogging(value: boolean) {
        await Store.updateUserSettings(settings => {
            settings.debugging.extensiveLogging = value
            window.D42_DEBUG_EXTENSIVE_LOGGING = value
        })
    }

    static async setDebuggingExposeInternalMetadata(value: boolean) {
        await Store.updateUserSettings(settings => {
            settings.debugging.exposeInternalMetadata = value
        })
    }

    // --- Validators

    static validateUserSettings(settings: Settings): Result<ValidSettings, SettingsValidationError[]> {
        let errors: SettingsValidationError[] = []

        if (!settings.tokenSecretName) {
            errors.push({ _: "MISSING_TOKEN" })
        }

        if (Object.keys(settings.sites).length === 0) {
            errors.push({ _: "NO_SITES" })
        }

        for (const entry of Object.values(settings.sites)) {
            let site = entry!

            if (!site.path) {
                errors.push({ _: "MISSING_SITE_PATH", error: { site: site.config.addresses.primary } })
            }

            if (site.config.modules.length === 0) {
                errors.push({
                    _: "NO_SITE_MODULES",
                    error: { site: site.config.addresses.primary },
                })
            }
        }

        // TODO: Check that site paths don't overlap

        if (errors.length > 0) {
            return Err(errors)
        }

        return Ok(settings as ValidSettings)
    }

    static validateUserSettingsForSite(siteId: Site.SiteId): Result<ValidSiteSettings, SiteSettingsValidationError[]> {
        let settings = Store.self.userSettings

        let errors: SiteSettingsValidationError[] = []

        if (!settings.tokenSecretName) {
            errors.push({ _: "MISSING_TOKEN" })
        }

        let site = settings.sites[siteId]

        if (!site) {
            errors.push({ _: "MISSING_SITE" })
            return Err(errors)
        }

        if (!site.path) {
            errors.push({ _: "MISSING_SITE_PATH", error: { site: site.config.addresses.primary } })
        }

        if (site.config.modules.length === 0) {
            errors.push({
                _: "NO_SITE_MODULES",
                error: { site: site.config.addresses.primary },
            })
        }

        // TODO: Check that site paths don't overlap

        if (errors.length > 0) {
            return Err(errors)
        }

        return Ok(site as ValidSiteSettings)
    }
}
