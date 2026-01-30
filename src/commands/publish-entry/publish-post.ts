import * as Obsidian from "obsidian"

import * as Config from "src/config"
import * as Site from "src/models/site"
import * as Post from "src/models/post"
import * as Image from "src/models/image"
import * as Content from "src/models/content"
import * as FM from "src/models/fm"
import * as BlockId from "src/automations/block-id"
import * as Api from "src/clients/api"
import * as PublishPostRequest from "src/clients/requests/publish-post"
import { Ok, Err, OK, ERROR, Result, GenericError } from "src/utils/result"
import * as log from "src/logger"

export type PrePublishingOptions = {
    skipChangesCheck: boolean
}

export type PrePublishingError =
    | { _: "NO_FRONTMATTER" }
    | { _: "INVALID_FRONTMATTER"; errors: Post.FrontMatterErrors }
    | { _: "NO_CHANGES_SINCE_LAST_PUBLISH" }
    | { _: "FAILED_TO_GET_SITE_AND_MODULE"; error: Site.GetSiteForFileError }
    | { _: "INVALID_SETTINGS"; errors: Config.SiteSettingsValidationError[] }
    | { _: "LINKED_RESOURCE_NOT_FOUND"; link: Obsidian.LinkCache }
    | { _: "LINKED_RESOURCE_IS_DIRECTORY"; link: Obsidian.LinkCache }
    | { _: "LOCAL_LINK_DOESNT_HAVE_BLOCK_ID"; link: Obsidian.LinkCache }
    | { _: "LINKED_RESOURCE_DOESNT_HAVE_METADATA"; link: Obsidian.LinkCache }
    | { _: "LINKED_RESOURCE_IS_NOT_PUBLISHED"; link: Obsidian.LinkCache }
    | { _: "IMAGES_VALIDATION_FAILED"; errors: Image.ImageValidtaionError[] }
    | { _: "FAILED_TO_GET_IMAGE_PLACEHOLDER_KIND"; error: Api.ResponseError<unknown> }
    | { _: "IMAGES_UPLOADING_FAILED"; errors: BlogPostImageUploadingError[] }
    | { _: "INVALID_EXTERNAL_COVER_IMAGE_URL"; url: string }
    | { _: "INVALID_EXTERNAL_COVER_CREDIT_LINK"; link: string }
    | { _: "INTERNAL_ERROR"; error: GenericError }

export type BlogPostImageUploadingError =
    | { _: "FAILED_TO_UPLOAD_IMAGE"; error: Image.ImageUploadError }
    | { _: "FAILED_TO_WRITE_UPLOADED_IMAGE_METADATA"; error: GenericError }

export type PrePublishingData = {
    site: Config.SiteSettings
    post: PublishPostRequest.PublishablePost
    status: Post.PostStatus | null
}

export async function prepareForPublishing(
    file: Obsidian.TFile,
    app: Obsidian.App,
    options: PrePublishingOptions,
): Promise<Result<PrePublishingData, PrePublishingError>> {
    options = options || { skipChangesCheck: false }

    let settings = Config.Store.userSettings()

    var fileCache

    fileCache = app.metadataCache.getFileCache(file)
    if (!fileCache) return Err({ _: "INTERNAL_ERROR", error: new GenericError("Failed to get initial file cache") })

    if (!fileCache.frontmatter) {
        return Err({ _: "NO_FRONTMATTER" })
    }

    let links: Array<Content.InternalLink> = []

    const currentAbsolutePath = file.path

    if (fileCache.links) {
        for (const link of fileCache.links) {
            const [linkTarget, blockId] = link.link.split("#^")

            log.trace("Parsed link", { linkTarget, blockId })

            const linkedFile =
                app.vault.getAbstractFileByPath(linkTarget) ||
                app.vault.getAllLoadedFiles().find(file => file.name === linkTarget)

            log.trace("Linked file", linkedFile)

            if (!linkedFile) {
                return Err({ _: "LINKED_RESOURCE_NOT_FOUND", link })
            }

            if (!(linkedFile instanceof Obsidian.TFile)) {
                return Err({ _: "LINKED_RESOURCE_IS_DIRECTORY", link })
            }

            // TODO: Handle cross-site links when user links to document from another site within the same vault

            let internalLink: Content.InternalLink

            const isLocalLink = currentAbsolutePath === linkedFile.path

            if (isLocalLink) {
                log.trace("Local link to a block in the current doc")

                if (!blockId) return Err({ _: "LOCAL_LINK_DOESNT_HAVE_BLOCK_ID", link })

                internalLink = {
                    TAG: "AnchorLink",
                    blockId: blockId as BlockId.T,
                    mdLinkTarget: link.link,
                }
            } else {
                log.trace("Link to resource")

                const linkedMetadata = app.metadataCache.getFileCache(linkedFile)?.frontmatter

                if (!linkedMetadata) return Err({ _: "LINKED_RESOURCE_DOESNT_HAVE_METADATA", link })

                const meta = linkedMetadata as Post.Frontmatter

                const contentId = meta[FM.D42_CONTENT_ID]
                const contentType = Content.ContentKind.safeParse(meta[FM.D42_CONTENT_KIND])

                if (!contentId || !contentType.success) {
                    return Err({ _: "LINKED_RESOURCE_IS_NOT_PUBLISHED", link })
                }

                internalLink = {
                    TAG: "ContentLink",
                    contentId,
                    contentKind: contentType.data,
                    blockId: (blockId as BlockId.T) || null,
                    mdLinkTarget: link.link,
                }
            }

            links.push(internalLink)
        }
    }

    let frontmatter!: Post.PublishableFrontmatter
    let frontmatterValidation = Post.validateFrontmatter(app, file, fileCache.frontmatter, fileCache.frontmatterLinks)

    switch (frontmatterValidation._) {
        case OK:
            frontmatter = frontmatterValidation.data
            break
        case ERROR:
            return Err({ _: "INVALID_FRONTMATTER", errors: frontmatterValidation.error })
    }

    var site!: Config.SiteSettings
    var siteModule!: Site.SiteModule

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

    if (!options.skipChangesCheck) {
        if (!isFileChanged(file, frontmatter)) return Err({ _: "NO_CHANGES_SINCE_LAST_PUBLISH" })
    }

    let settingsValidationResult = Config.Store.validateUserSettingsForSite(site.config.id)

    switch (settingsValidationResult._) {
        case OK:
            break
        case ERROR:
            return Err({ _: "INVALID_SETTINGS", errors: settingsValidationResult.error })
    }

    let assets = Post.collectAssets(app, file, fileCache)
    let images: { image: Image.PublishableImage; isCover: boolean }[] = []

    if (assets.length > 0) {
        log.debug("Blog post assets", { assets })

        let newAssets: Post.Asset[] = []

        {
            let errors: GenericError[] = []

            await Promise.allSettled(
                assets.map(async asset => {
                    let metadataResult = await Image.readUploadedImageMetadata(asset.file)
                    switch (metadataResult._) {
                        case OK: {
                            let metadata = metadataResult.data
                            if (metadata === null || metadata.lastModified !== asset.file.stat.mtime) {
                                log.debug(
                                    `New asset: ${asset.file.name}. Reason: ${metadata === null ? "No metadata" : "Modification time doesn't match"}`,
                                )
                                newAssets.push(asset)
                            } else {
                                log.debug(`Uploaded asset: ${asset.file.name}`, asset)
                                images.push({
                                    image: {
                                        id: metadata.imageId,
                                        filename: asset.file.name,
                                        absolutePath: asset.file.path,
                                    },
                                    isCover: asset.isCover,
                                })
                            }
                            break
                        }
                        case ERROR: {
                            errors.push(metadataResult.error)
                            break
                        }
                    }
                }),
            )

            if (errors.length > 0) {
                let error = new GenericError("Failed to read assets metadata", errors)
                log.error(error)
                return Err({ _: "INTERNAL_ERROR", error })
            }
        }

        log.debug("Assets", { new: newAssets, published: images })

        let totalSizeOfNewAssets = newAssets.reduce((acc, asset) => acc + asset.file.stat.size, 0)
        // TODO: Check total size against core

        log.trace("Total size of new assets", totalSizeOfNewAssets)

        let validationResult = Image.validateAssets(newAssets)

        log.debug("Assets validation result", validationResult)

        switch (validationResult._) {
            case OK:
                break
            case ERROR:
                return Err({ _: "IMAGES_VALIDATION_FAILED", errors: validationResult.error })
            default:
                validationResult satisfies never
        }

        let uploadErrors: BlogPostImageUploadingError[] = []

        if (newAssets.length > 0) {
            async function uploadAssetsWithConcurrencyLimit() {
                const queue = [...newAssets]
                const inProgress = new Set()
                const maxConcurrent = 10

                async function processAsset(asset: Post.Asset) {
                    inProgress.add(asset)
                    log.debug("Starting to process asset", { asset, inProgress: inProgress.size })
                    try {
                        let uploadResult = await Image.uploadImage(site.config.id, asset.file)
                        switch (uploadResult._) {
                            case OK: {
                                let imageId = uploadResult.data.id
                                let writeResult = await Image.writeUploadedImageMetadata(imageId, asset.file)
                                switch (writeResult._) {
                                    case OK: {
                                        images.push({
                                            image: {
                                                id: imageId,
                                                filename: asset.file.name,
                                                absolutePath: asset.file.path,
                                            },
                                            isCover: asset.isCover,
                                        })
                                        break
                                    }
                                    case ERROR: {
                                        uploadErrors.push({
                                            _: "FAILED_TO_WRITE_UPLOADED_IMAGE_METADATA",
                                            error: writeResult.error,
                                        })
                                        break
                                    }
                                }
                                break
                            }
                            case ERROR: {
                                uploadErrors.push({ _: "FAILED_TO_UPLOAD_IMAGE", error: uploadResult.error })
                                break
                            }
                        }
                    } finally {
                        inProgress.delete(asset)

                        if (queue.length > 0) {
                            const nextAsset = queue.shift()!
                            processAsset(nextAsset)
                        }
                    }
                }

                const initialBatch = queue.splice(0, maxConcurrent)
                initialBatch.map(asset => processAsset(asset))

                while (inProgress.size > 0) {
                    await new Promise(resolve => setTimeout(resolve, 50))
                }
            }

            await uploadAssetsWithConcurrencyLimit()

            if (uploadErrors.length > 0) {
                return Err({ _: "IMAGES_UPLOADING_FAILED", errors: uploadErrors })
            }
        }
    }

    if (settings.automations.blockIds.enable) {
        await BlockId.ensureBlockIds(file, app.vault, fileCache)
        await sleep(10) // let changes propagate so the cache is updated (doesn't seem reliable, though)

        fileCache = app.metadataCache.getFileCache(file)
        if (!fileCache)
            return Err({
                _: "INTERNAL_ERROR",
                error: new GenericError("Failed to get file cache after block ids update"),
            })
    }

    let editor = app.workspace.activeEditor?.editor
    if (!editor) return Err({ _: "INTERNAL_ERROR", error: new GenericError("Failed to get active editor") })

    // TODO?: Extract into a function
    const title = file.basename
    let fileContents = editor.getDoc().getValue()
    let { contentStart } = Obsidian.getFrontMatterInfo(fileContents)
    let postBody = fileContents.slice(contentStart)

    let status = frontmatter["status"] || null
    let description = frontmatter["description"] || null
    let slug = frontmatter["slug"] || null
    let postedOn = frontmatter["posted on"]
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
                meta[FM.D42_LAST_PUBLISHED_TITLE] = file.basename
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

function isFileChanged(file: Obsidian.TFile, frontmatter: Post.Frontmatter) {
    // TODO: We should probably move this check to the server since user might preview a draft without publishing it
    let d42LastPublishedOn = frontmatter[FM.D42_LAST_PUBLISHED_ON]
    let d42LastPublishedTitle = frontmatter[FM.D42_LAST_PUBLISHED_TITLE]

    if (!d42LastPublishedOn || !d42LastPublishedTitle) return true // missing key means it's never been published

    const currentTitle = file.basename
    const tolerance = 1000 // 1 second tolerance
    const isModified = Math.abs(file.stat.mtime - d42LastPublishedOn) > tolerance
    const isTitleChanged = d42LastPublishedTitle !== currentTitle

    // TODO: Check if assets have been modified

    return isModified || isTitleChanged
}
