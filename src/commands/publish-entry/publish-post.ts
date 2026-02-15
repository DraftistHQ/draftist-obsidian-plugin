import * as Obsidian from "obsidian"

import * as Config from "src/config"
import * as Site from "src/models/site"
import * as Post from "src/models/post"
import * as Image from "src/models/image"
import * as Content from "src/models/content"
import * as FM from "src/models/fm"
import * as PublishPostRequest from "src/clients/requests/publish-post"
import { Ok, Err, OK, ERROR, Result, GenericError } from "src/utils/result"

export type PrePublishingOptions = {
    skipChangesCheck: boolean
}

export type PrePublishingError =
    | { _: "MISSING_FRONTMATTER" }
    | { _: "INVALID_POST_FRONTMATTER"; errors: Post.FrontmatterErrors }
    | { _: "NO_CHANGES_SINCE_LAST_PUBLISH" }
    | { _: "FAILED_TO_GET_SITE_AND_MODULE"; error: Site.GetSiteForFileError }
    | { _: "INVALID_SETTINGS"; errors: Config.SiteSettingsValidationError[] }
    | Content.ResolveLinkError
    | Content.ProcessAssetsError
    | { _: "INVALID_EXTERNAL_COVER_IMAGE_URL"; url: string }
    | { _: "INVALID_EXTERNAL_COVER_CREDIT_LINK"; link: string }
    | { _: "INTERNAL_ERROR"; error: GenericError }

export type PrePublishingData = {
    site: Config.SiteSettings
    post: PublishPostRequest.PublishablePost
    status: Post.PostStatus | null
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
    var frontmatter!: Post.PublishableFrontmatter
    if (fileCache.frontmatter) {
        let result = Post.validateFrontmatter(app, file, fileCache.frontmatter, fileCache.frontmatterLinks)
        switch (result._) {
            case OK:
                frontmatter = result.data
                break
            case ERROR:
                return Err({ _: "INVALID_POST_FRONTMATTER", errors: result.error })
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
    var images!: { image: Image.PublishableImage; isCover: boolean }[]
    {
        let assets = Post.collectAssets(app, file, fileCache)
        let result = await Content.processAssets(
            site.config.id,
            assets,
            (asset, image) => ({
                image,
                isCover: asset.isCover,
            }),
            onAssetProcessed,
        )
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
    var postBody!: string
    {
        let result = await Content.extractContentBody(file, app)
        switch (result._) {
            case OK:
                postBody = result.data
                break
            case ERROR:
                return Err({ _: "INTERNAL_ERROR", error: result.error })
            default:
                result satisfies never
        }
    }

    // Build post data
    const title = file.basename
    let status = frontmatter["status"] || null
    let description = frontmatter["description"] || null
    let slug = frontmatter["slug"] || null
    let postedOn = frontmatter["posted on"] || null
    let d42PostId = frontmatter[FM.D42_CONTENT_ID]

    let cover: Post.Cover | null = null

    let coverCredit = null
    let coverCreditText = frontmatter["cover credit text"]
    let coverCreditLink = frontmatter["cover credit link"]

    if (!!coverCreditText) {
        if (!!coverCreditLink && !coverCreditLink.startsWith("http")) {
            return Err({ _: "INVALID_EXTERNAL_COVER_CREDIT_LINK", link: coverCreditLink })
        }
        coverCredit = {
            text: coverCreditText,
            link: coverCreditLink || null,
        }
    }

    let coverImageInternal = images.find(image => image.isCover)?.image.id

    if (!!coverImageInternal) {
        cover = { TAG: "Internal", imageId: coverImageInternal, credit: coverCredit }
    } else {
        let coverImageExternal = frontmatter["cover"]

        if (!!coverImageExternal) {
            if (coverImageExternal.startsWith("http")) {
                cover = { TAG: "External", url: coverImageExternal, credit: coverCredit }
            } else {
                return Err({ _: "INVALID_EXTERNAL_COVER_IMAGE_URL", url: coverImageExternal })
            }
        }
    }

    let postData = {
        title,
        description,
        content: postBody,
        cover,
        status,
        slug,
        postedOn,
        links,
        images: images.map(image => image.image),
    }

    let postKind: PublishPostRequest.PublishablePostKind

    if (!d42PostId) {
        postKind = "NewPost"
    } else {
        postKind = { TAG: "ExistingPost", id: d42PostId }
    }

    let post = {
        siteModuleId: siteModule.id,
        postKind,
        postData,
    }

    return Ok({ site, post, status })
}

export async function publish(
    siteId: Site.SiteId,
    post: PublishPostRequest.PublishablePost,
    file: Obsidian.TFile,
    app: Obsidian.App,
) {
    let result = await PublishPostRequest.send(siteId, post)

    switch (result._) {
        case OK: {
            // TODO: Handle error
            Post.updateFrontmatter(app, file, meta => {
                meta[FM.D42_CONTENT_ID] = result.data.id
                meta[FM.D42_CONTENT_KIND] = Content.BlogPostContentKind.value
                meta[FM.D42_LAST_PUBLISHED_TITLE] = post.postData.title
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
