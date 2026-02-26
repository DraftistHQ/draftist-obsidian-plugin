import * as Obsidian from "obsidian"

import * as Config from "src/config"
import * as Site from "src/models/site"
import * as Doc from "src/models/doc"
import * as Image from "src/models/image"
import * as Content from "src/models/content"
import * as FM from "src/models/fm"
import * as PublishDocRequest from "src/clients/requests/publish-doc"
import * as Position from "src/utils/position"
import { Ok, Err, OK, ERROR, Result, GenericError } from "src/utils/result"

export type PrePublishingOptions = {
    skipChangesCheck: boolean
}

export type PrePublishingError =
    | { _: "MISSING_FRONTMATTER" }
    | { _: "INVALID_DOC_FRONTMATTER"; errors: Doc.FrontmatterErrors }
    | { _: "MISSING_POSITION" }
    | { _: "NO_CHANGES_SINCE_LAST_PUBLISH" }
    | { _: "FAILED_TO_GET_SITE_AND_MODULE"; error: Site.GetSiteForFileError }
    | { _: "INVALID_SETTINGS"; errors: Config.SiteSettingsValidationError[] }
    | Doc.ResolveParentError
    | Content.ResolveLinkError
    | Content.ProcessAssetsError
    | { _: "INTERNAL_ERROR"; error: GenericError }

export type PrePublishingData = {
    site: Config.SiteSettings
    page: PublishDocRequest.PublishableDocPage
}

export async function prepareForPublishing(
    file: Obsidian.TFile,
    app: Obsidian.App,
    options: PrePublishingOptions,
    onAssetProcessed?: Content.ProgressCallback,
): Promise<Result<PrePublishingData, PrePublishingError>> {
    options = options || { skipChangesCheck: false }

    var fileCache

    fileCache = app.metadataCache.getFileCache(file)
    if (!fileCache) return Err({ _: "INTERNAL_ERROR", error: new GenericError("Failed to get initial file cache") })

    // Validate frontmatter
    var frontmatter!: Doc.PublishableFrontmatter
    if (fileCache.frontmatter) {
        let result = Doc.validateFrontmatter(fileCache.frontmatter)
        switch (result._) {
            case OK:
                frontmatter = result.data
                break
            case ERROR:
                return Err({ _: "INVALID_DOC_FRONTMATTER", errors: result.error })
        }
    } else {
        return Err({ _: "MISSING_FRONTMATTER" })
    }

    // Resolve links
    var links!: Content.InternalLink[]
    {
        let result = Content.resolveInternalLinks(file, fileCache, app)
        switch (result._) {
            case OK:
                links = result.data
                break
            case ERROR:
                return Err(result.error)
            default:
                result satisfies never
        }
    }

    // Get site and module
    var site!: Config.SiteSettings
    var siteModule!: Site.SiteModule
    {
        let siteAndModuleResult = Site.getSiteAndModuleForFile(file)

        switch (siteAndModuleResult._) {
            case OK: {
                site = siteAndModuleResult.data.site
                siteModule = siteAndModuleResult.data.module
                break
            }
            case ERROR: {
                return Err({ _: "FAILED_TO_GET_SITE_AND_MODULE", error: siteAndModuleResult.error })
            }
            default:
                siteAndModuleResult satisfies never
        }
    }

    // Check for changes
    if (!options.skipChangesCheck) {
        if (!Content.isFileChanged(file, frontmatter)) return Err({ _: "NO_CHANGES_SINCE_LAST_PUBLISH" })
    }

    // Validate settings
    {
        let settingsValidationResult = Config.Store.validateUserSettingsForSite(site.config.id)
        switch (settingsValidationResult._) {
            case OK:
                break
            case ERROR:
                return Err({ _: "INVALID_SETTINGS", errors: settingsValidationResult.error })
        }
    }

    // Process assets
    var images!: Image.PublishableImage[]
    {
        let assets = Doc.collectAssets(app, file, fileCache)
        let result = await Content.processAssets(site.config.id, assets, (_, image) => image, onAssetProcessed)
        switch (result._) {
            case OK:
                images = result.data
                break
            case ERROR:
                return Err(result.error)
            default:
                result satisfies never
        }
    }

    // Ensure block IDs
    {
        let result = await Content.ensureBlockIdsIfEnabled(file, app, fileCache)
        switch (result._) {
            case OK:
                fileCache = result.data
                break
            case ERROR:
                return Err({ _: "INTERNAL_ERROR", error: result.error })
            default:
                result satisfies never
        }
    }

    // Extract content body
    var pageBody!: string
    {
        let result = await Content.extractContentBody(file, app)
        switch (result._) {
            case OK:
                pageBody = result.data
                break
            case ERROR:
                return Err({ _: "INTERNAL_ERROR", error: result.error })
            default:
                result satisfies never
        }
    }

    // Resolve parent
    var parentId!: Doc.DocPageId | null
    {
        let result = Doc.resolveParentId(file, app, site, siteModule)
        switch (result._) {
            case OK:
                parentId = result.data
                break
            case ERROR:
                return Err(result.error)
            default:
                result satisfies never
        }
    }

    // Build page data
    let title = file.basename
    let description = frontmatter.description || null
    let slug = frontmatter.slug || null
    let d42PageId = frontmatter[FM.D42_CONTENT_ID]

    let status = frontmatter.status || null
    let postedOn = frontmatter["posted on"] || null
    let position = frontmatter[FM.D42_POSITION]

    if (position === undefined || position === null) {
        // Backfill position from folder prefix
        position = await backfillPosition(file, app)
        if (position === null) {
            return Err({ _: "MISSING_POSITION" })
        }
    }

    let collapsed = frontmatter.collapsed ?? null

    let pageData = {
        title,
        description,
        content: pageBody,
        status,
        slug,
        parentId,
        position,
        collapsed,
        postedOn,
        links,
        images,
    }

    let pageKind: PublishDocRequest.PublishableDocPageKind

    if (!d42PageId) {
        pageKind = "NewPage"
    } else {
        pageKind = { TAG: "ExistingPage", id: d42PageId }
    }

    let page = {
        siteModuleId: siteModule.id,
        pageKind,
        pageData,
    }

    return Ok({ site, page })
}

export async function publish(
    siteId: Site.SiteId,
    page: PublishDocRequest.PublishableDocPage,
    file: Obsidian.TFile,
    app: Obsidian.App,
) {
    let result = await PublishDocRequest.send(siteId, page)

    switch (result._) {
        case OK: {
            // TODO: Handle error
            Doc.updateFrontmatter(app, file, meta => {
                meta[FM.D42_CONTENT_ID] = result.data.id
                meta[FM.D42_CONTENT_KIND] = Content.DocPageContentKind.value
                meta[FM.D42_LAST_PUBLISHED_TITLE] = page.pageData.title
                meta[FM.D42_LAST_PUBLISHED_SLUG] = result.data.slug
                meta[FM.D42_LAST_PUBLISHED_ON] = file.stat.mtime
            })
            break
        }
        case "ERROR":
            break
        default:
            result satisfies never
    }

    return result
}

async function backfillPosition(file: Obsidian.TFile, app: Obsidian.App): Promise<number | null> {
    const pageFolder = file.parent
    if (!pageFolder) return null

    const parentFolder = pageFolder.parent
    if (!parentFolder) return null

    const folderPrefix = Doc.extractPositionFromFolderName(pageFolder.name)
    if (folderPrefix === null) return null

    // Get siblings sorted by folder prefix
    const siblings = parentFolder.children
        .filter((c): c is Obsidian.TFolder => c instanceof Obsidian.TFolder)
        .map(folder => {
            const prefix = Doc.extractPositionFromFolderName(folder.name)
            if (prefix === null) return null

            const mdFile = folder.children.find(
                (c): c is Obsidian.TFile => c instanceof Obsidian.TFile && c.extension === "md",
            )
            if (!mdFile) return null

            const fm = Doc.getFrontmatter(app, mdFile)
            const position = fm?.[FM.D42_POSITION]

            return { folder, prefix, mdFile, position: typeof position === "number" ? position : null }
        })
        .filter((s): s is NonNullable<typeof s> => s !== null)
        .sort((a, b) => a.prefix - b.prefix)

    // Find our index in the sorted list
    const ourIndex = siblings.findIndex(s => s.folder.path === pageFolder.path)
    if (ourIndex === -1) return null

    // Find neighbors with valid positions
    let prevPosition: number | null = null
    let nextPosition: number | null = null

    for (let i = ourIndex - 1; i >= 0; i--) {
        if (siblings[i].position !== null) {
            prevPosition = siblings[i].position
            break
        }
    }

    for (let i = ourIndex + 1; i < siblings.length; i++) {
        if (siblings[i].position !== null) {
            nextPosition = siblings[i].position
            break
        }
    }

    // Calculate position
    let position: number
    if (prevPosition === null && nextPosition === null) {
        position = Position.initial()
    } else if (prevPosition === null) {
        position = Position.prepend(nextPosition!)
    } else if (nextPosition === null) {
        position = Position.append(prevPosition)
    } else {
        position = Position.insert(prevPosition, nextPosition)
    }

    // Write to frontmatter
    await Doc.updateFrontmatter(app, file, fm => {
        fm[FM.D42_POSITION] = position
    })

    return position
}
