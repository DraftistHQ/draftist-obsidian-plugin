import * as Obsidian from "obsidian"
import { z } from "zod"

import * as Config from "src/config"
import * as Opaque from "src/utils/opaque"
import * as Record from "src/utils/record"
import { Result, Ok, Err, OK, ERROR } from "src/utils/result"
import * as log from "src/logger"

export const SiteId = Opaque.id<"SiteId">()
export type SiteId = z.infer<typeof SiteId>

const SiteOwner = z.union([z.literal("System"), z.object({ TAG: z.literal("User"), isPrimary: z.boolean() })])
export type SiteOwner = z.infer<typeof SiteOwner>

const SiteContentType = z.enum(["Editorial", "Documentation"])

export const SiteModuleId = Opaque.id<"SiteModuleId">()
export type SiteModuleId = z.infer<typeof SiteModuleId>

const SiteModuleKind = z.enum(["blog", "docs"])
export type SiteModuleKind = z.infer<typeof SiteModuleKind>

const SiteModule = z.object({
    id: SiteModuleId,
    kind: SiteModuleKind,
    name: z.string(),
    slug: z.string(),
    isEnabled: z.boolean(),
})
export type SiteModule = z.infer<typeof SiteModule>

const SitePrimaryAddress = z.string().brand<"SitePrimaryAddress">()
export type SitePrimaryAddress = z.infer<typeof SitePrimaryAddress>

const SitePlatformAddress = z.string().brand<"SitePlatformAddress">()
export type SitePlatformAddress = z.infer<typeof SitePlatformAddress>

const SiteDraftAddress = z.string().brand<"SiteDraftAddress">()
export type SiteDraftAddress = z.infer<typeof SiteDraftAddress>

const SiteAddresses = z.object({
    primary: SitePrimaryAddress,
    platform: SitePlatformAddress,
    draft: SiteDraftAddress,
})

const Site = z.object({
    id: SiteId,
    label: z.string().nullable(),
    owner: SiteOwner,
    contentType: SiteContentType,
    modules: z.array(SiteModule),
    addresses: SiteAddresses,
    isOnline: z.boolean(),
})
export type T = z.infer<typeof Site>
export { Site as T }

const SiteAndModule = z.object({
    site: Config.SiteSettings,
    module: SiteModule,
})
export type SiteAndModule = z.infer<typeof SiteAndModule>

export type GetSiteForFileError =
    | ValidateSitesError
    | { _: "SITE_NOT_FOUND" }
    | { _: "SITE_DISABLED"; site: SitePrimaryAddress }
    | { _: "MODULE_NOT_FOUND" }

export function isFileManaged(file: Obsidian.TFile): boolean {
    let result = getSiteForFile(file)
    return result._ === OK && !!result.data
}

export function getSiteForFile(file: Obsidian.TFile): Result<Config.SiteSettings | void, ValidateSitesError> {
    return getSiteForPath(file.path)
}

export function getSiteAndModuleForFile(file: Obsidian.TFile): Result<SiteAndModule, GetSiteForFileError> {
    return getSiteAndModuleForPath(file.path)
}

export function getSiteAndModuleForFolder(folder: Obsidian.TFolder): Result<SiteAndModule, GetSiteForFileError> {
    return getSiteAndModuleForPath(folder.path)
}

function getSiteForPath(path: string): Result<Config.SiteSettings | void, ValidateSitesError> {
    let settings = Config.Store.userSettings()
    let sites = settings.sites as Config.SitesSettings

    let validation = validateSites(sites)
    if (validation._ === ERROR) {
        return Err(validation.error)
    }

    const normalizedPath = Obsidian.normalizePath(path)

    let site = Record.values(sites).find(site => {
        if (!site.path) return false

        // Site at the root matches all files
        if (site.path === "/") return true

        const sitePath = Obsidian.normalizePath(site.path)
        return normalizedPath.startsWith(sitePath)
    })

    return Ok(site)
}

function getSiteAndModuleForPath(path: string): Result<SiteAndModule, GetSiteForFileError> {
    let siteResult = getSiteForPath(path)

    switch (siteResult._) {
        case ERROR:
            return Err(siteResult.error)
        case OK: {
            let matchingSite = siteResult.data

            if (!matchingSite) {
                return Err({ _: "SITE_NOT_FOUND" })
            }

            if (!matchingSite.enabled) {
                return Err({ _: "SITE_DISABLED", site: matchingSite.config.addresses.primary })
            }

            const normalizedPath = Obsidian.normalizePath(path)

            const matchingModule = matchingSite.config.modules.find(module => {
                const sitePath = matchingSite.path === "/" ? "" : matchingSite.path
                const modulePath = Obsidian.normalizePath(`${sitePath}/${module.name}`)
                return normalizedPath.startsWith(modulePath)
            })

            if (!matchingModule) {
                return Err({ _: "MODULE_NOT_FOUND" })
            }

            return Ok({
                site: matchingSite,
                module: matchingModule,
            })
        }
        default:
            siteResult satisfies never
            return Err({ _: "SITE_NOT_FOUND" })
    }
}

function pathsOverlap(path1: string, path2: string): boolean {
    const normalized1 = Obsidian.normalizePath(path1)
    const normalized2 = Obsidian.normalizePath(path2)

    if (normalized1 === normalized2) return true
    if (normalized1 === "/") return true
    if (normalized2 === "/") return true

    const withTrailing1 = normalized1 + "/"
    const withTrailing2 = normalized2 + "/"

    return normalized2.startsWith(withTrailing1) || normalized1.startsWith(withTrailing2)
}

export type ValidateSitesError =
    | { _: "ENABLED_SITE_MISSING_PATH"; siteId: SiteId }
    | {
          _: "OVERLAPPING_PATHS"
          site1: { id: SiteId; label: string; path: string }
          site2: { id: SiteId; label: string; path: string }
      }

export function validateSites(sites: Config.SitesSettings): Result<void, ValidateSitesError> {
    // Check that every enabled site has a path set
    for (const [siteId, site] of Record.entries(sites)) {
        if (site.enabled && !site.path) {
            return Err({ _: "ENABLED_SITE_MISSING_PATH", siteId })
        }
    }

    // Check for overlapping paths among sites with paths set
    const sitesWithPaths = Record.entries(sites).filter(([, site]) => site.path)

    for (let i = 0; i < sitesWithPaths.length; i++) {
        for (let j = i + 1; j < sitesWithPaths.length; j++) {
            const [siteId1, site1] = sitesWithPaths[i]
            const [siteId2, site2] = sitesWithPaths[j]

            if (pathsOverlap(site1.path!, site2.path!)) {
                return Err({
                    _: "OVERLAPPING_PATHS",
                    site1: {
                        id: siteId1,
                        label: site1.config.label || site1.config.addresses.primary,
                        path: site1.path!,
                    },
                    site2: {
                        id: siteId2,
                        label: site2.config.label || site2.config.addresses.primary,
                        path: site2.path!,
                    },
                })
            }
        }
    }

    return Ok(undefined)
}

export function sitesWithModule(kind: SiteModuleKind): Config.SiteSettings[] {
    const sites = Config.Store.sites()
    return Record.values(sites).filter(
        site => site.enabled && !!site.path && site.config.modules.some(m => m.kind === kind),
    )
}

export function hasModuleOfKind(kind: SiteModuleKind): boolean {
    return sitesWithModule(kind).length > 0
}

export async function createFolders(app: Obsidian.App): Promise<Result<void, ValidateSitesError>> {
    const sites = Config.Store.sites()

    let validation = validateSites(sites)
    if (validation._ === ERROR) {
        return Err(validation.error)
    }

    for (const [siteId, site] of Record.entries(sites)) {
        let ident = site.config.label || site.config.addresses.primary

        log.trace(`[${ident}] Creating folders for user site`)

        if (!site.enabled) {
            log.trace(`[${ident}] Site is disabled. Skipping.`)
            continue
        }

        if (!site.path) {
            log.trace(`[${ident}] No path in configuration. Skipping.`)
            continue
        }

        const sitePath = Obsidian.normalizePath(site.path)

        // Check if site folder exists, create it if not
        const siteExists = await app.vault.adapter.exists(sitePath)
        if (!siteExists) {
            log.trace(`[${ident}] Site folder doesn't exist. Creating it.`)
            await app.vault.createFolder(sitePath)
        } else {
            log.trace(`[${ident}] Site folder exists. Skipping.`)
        }

        // Create module folders
        for (const module of site.config.modules) {
            const sitePathPrefix = sitePath === "/" ? "" : sitePath
            const modulePath = Obsidian.normalizePath(`${sitePathPrefix}/${module.name}`)

            const moduleExists = await app.vault.adapter.exists(modulePath)
            if (!moduleExists) {
                log.trace(`[${ident}] ${module.name} module folder doesn't exist. Creating it.`)
                await app.vault.createFolder(modulePath)
            } else {
                log.trace(`[${ident}] ${module.name} module folder exists. Skipping.`)
            }
        }
    }

    return Ok(undefined)
}
