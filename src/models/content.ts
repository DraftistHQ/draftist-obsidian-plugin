import * as Obsidian from "obsidian"
import { z } from "zod"

import * as FM from "src/models/fm"
import * as Site from "src/models/site"
import * as Image from "src/models/image"
import * as BlockId from "src/automations/block-id"
import * as Opaque from "src/utils/opaque"
import { Ok, Err, OK, ERROR, Result, GenericError } from "src/utils/result"
import * as log from "src/logger"

// --- Content IDs

export const PostId = Opaque.id<"PostId">()
export type PostId = z.infer<typeof PostId>

export const DocPageId = Opaque.id<"DocPageId">()
export type DocPageId = z.infer<typeof DocPageId>

export const ContentId = z.union([PostId, DocPageId])
export type ContentId = z.infer<typeof ContentId>

// --- Content Kinds

export const BlogPostContentKind = z.literal("BlogPost")
export const DocPageContentKind = z.literal("DocPage")

export const ContentKind = z.union([BlogPostContentKind, DocPageContentKind])
export type ContentKind = z.infer<typeof ContentKind>

// --- Content Status

export const ContentStatusDraft = z.literal("Draft")
export const ContentStatusPublished = z.literal("Published")
export const ContentStatusArchived = z.literal("Archived")

export const ContentStatus = z.union([ContentStatusDraft, ContentStatusPublished, ContentStatusArchived])
export type ContentStatus = z.infer<typeof ContentStatus>

// --- Posted On

export const INVALID_POSTED_ON = "INVALID_POSTED_ON"

export const PostedOn = z.preprocess(
    val => (val === "" || val === undefined ? null : val),
    z
        .string()
        .refine(
            value => {
                const dateFormat = Obsidian.moment(value, "YYYY-MM-DD", true)
                if (dateFormat.isValid()) return true

                const dateTimeFormat = Obsidian.moment(value, "YYYY-MM-DDTHH:mm", true)
                if (dateTimeFormat.isValid()) return true

                const dateTimeSecondsFormat = Obsidian.moment(value, "YYYY-MM-DDTHH:mm:ss", true)
                return dateTimeSecondsFormat.isValid()
            },
            { message: INVALID_POSTED_ON },
        )
        .nullable(),
)
export type PostedOn = z.infer<typeof PostedOn>

// --- Content Slug

export const Slug = z.object({
    id: z.string(),
    title: z.string().nullable(),
})
export type Slug = z.infer<typeof Slug>

export const RenderedSlug = z.string().brand<"RenderedSlug">()
export type RenderedSlug = z.infer<typeof RenderedSlug>

export function formatSlug(slug: Slug): RenderedSlug {
    return (slug.title ? `${slug.title}-${slug.id}` : slug.id) as RenderedSlug
}

// --- Internal Links

export const InternalLink = z.discriminatedUnion("TAG", [
    z.object({
        TAG: z.literal("AnchorLink"),
        blockId: BlockId.T,
        mdLinkTarget: z.string(),
    }),
    z.object({
        TAG: z.literal("ContentLink"),
        contentId: ContentId,
        contentKind: ContentKind,
        blockId: BlockId.T.nullable(),
        mdLinkTarget: z.string(),
    }),
])
export type InternalLink = z.infer<typeof InternalLink>

export type ResolveLinkError =
    | { _: "LINKED_RESOURCE_NOT_FOUND"; link: Obsidian.LinkCache }
    | { _: "LINKED_RESOURCE_IS_DIRECTORY"; link: Obsidian.LinkCache }
    | { _: "LOCAL_LINK_DOESNT_HAVE_BLOCK_ID"; link: Obsidian.LinkCache }
    | { _: "LINKED_RESOURCE_DOESNT_HAVE_METADATA"; link: Obsidian.LinkCache }
    | { _: "LINKED_RESOURCE_IS_NOT_PUBLISHED"; link: Obsidian.LinkCache }

// TODO?: Handle cross-site links when user links to document from another site within the same vault
export function resolveInternalLinks(
    file: Obsidian.TFile,
    fileCache: Obsidian.CachedMetadata,
    app: Obsidian.App,
): Result<InternalLink[], ResolveLinkError> {
    let links: InternalLink[] = []
    const currentAbsolutePath = file.path

    if (!fileCache.links) {
        return Ok(links)
    }

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

        let internalLink: InternalLink
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

            const contentId = linkedMetadata[FM.D42_CONTENT_ID]
            const contentType = ContentKind.safeParse(linkedMetadata[FM.D42_CONTENT_KIND])

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

    return Ok(links)
}

// --- Block IDs

import * as Config from "src/config"
import { sleep } from "src/utils/async"

// Ensures block IDs are present if enabled in settings.
// Returns updated file cache, or same cache if block IDs disabled.
export async function ensureBlockIdsIfEnabled(
    file: Obsidian.TFile,
    app: Obsidian.App,
    fileCache: Obsidian.CachedMetadata,
): Promise<Result<Obsidian.CachedMetadata, GenericError>> {
    let settings = Config.Store.userSettings()

    if (!settings.automations.blockIds.enable) {
        return Ok(fileCache)
    }

    await BlockId.ensureBlockIds(file, app.vault, fileCache)

    // Wait for Obsidian's metadata cache to reflect the block ID changes.
    // The cache update is async and sometimes takes longer than a single tick.
    for (let attempt = 0; attempt < 10; attempt++) {
        await sleep(10)
        let updatedCache = app.metadataCache.getFileCache(file)
        if (updatedCache) {
            return Ok(updatedCache)
        }
    }

    return Err(new GenericError("Failed to refresh cache after block IDs update"))
}

// --- Assets

export type AssetUploadError =
    | { _: "FAILED_TO_UPLOAD_IMAGE"; error: Image.ImageUploadError }
    | { _: "FAILED_TO_WRITE_UPLOADED_IMAGE_METADATA"; error: GenericError }

export type ProgressCallback = (processed: number, total: number) => void

export type ProcessAssetsError =
    | { _: "FAILED_TO_READ_ASSETS_METADATA"; error: GenericError }
    | { _: "IMAGES_VALIDATION_FAILED"; errors: Image.ImageValidtaionError[] }
    | { _: "IMAGES_UPLOADING_FAILED"; errors: AssetUploadError[] }

// Process assets for publishing: check metadata, validate, and upload new ones.
// Uses a callback to build the result for each processed asset.
export async function processAssets<A extends Image.ImageFile, T>(
    siteId: Site.SiteId,
    assets: A[],
    buildResult: (asset: A, image: Image.PublishableImage) => T,
    onAssetProcessed?: ProgressCallback,
): Promise<Result<T[], ProcessAssetsError>> {
    if (assets.length === 0) {
        return Ok([])
    }

    log.debug("Processing assets", { count: assets.length })

    let processed: T[] = []
    let toUpload: A[] = []

    // Check which assets need uploading
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
                            toUpload.push(asset)
                        } else {
                            log.debug(`Already uploaded: ${asset.file.name}`)
                            processed.push(
                                buildResult(asset, {
                                    id: metadata.imageId,
                                    filename: asset.file.name,
                                    absolutePath: asset.file.path,
                                }),
                            )
                            onAssetProcessed?.(processed.length, assets.length)
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
            return Err({ _: "FAILED_TO_READ_ASSETS_METADATA", error })
        }
    }

    log.debug("Assets partitioned", { alreadyUploaded: processed.length, toUpload: toUpload.length })

    // Validate new assets
    {
        let validationResult = Image.validateAssets(toUpload)
        switch (validationResult._) {
            case OK:
                break
            case ERROR:
                return Err({ _: "IMAGES_VALIDATION_FAILED", errors: validationResult.error })
            default:
                validationResult satisfies never
        }
    }

    // Upload new assets with concurrency limit
    if (toUpload.length > 0) {
        let uploadErrors: AssetUploadError[] = []

        async function uploadWithConcurrencyLimit() {
            const queue = [...toUpload]
            const inProgress = new Set()
            const maxConcurrent = 10

            async function uploadAsset(asset: A) {
                inProgress.add(asset)
                log.debug("Uploading asset", { name: asset.file.name, inProgress: inProgress.size })
                try {
                    let uploadResult = await Image.uploadImage(siteId, asset.file)
                    switch (uploadResult._) {
                        case OK: {
                            let imageId = uploadResult.data.id
                            let writeResult = await Image.writeUploadedImageMetadata(imageId, asset.file)
                            switch (writeResult._) {
                                case OK: {
                                    processed.push(
                                        buildResult(asset, {
                                            id: imageId,
                                            filename: asset.file.name,
                                            absolutePath: asset.file.path,
                                        }),
                                    )
                                    onAssetProcessed?.(processed.length, assets.length)
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
                        uploadAsset(nextAsset)
                    }
                }
            }

            const initialBatch = queue.splice(0, maxConcurrent)
            initialBatch.map(asset => uploadAsset(asset))

            while (inProgress.size > 0) {
                await new Promise(resolve => setTimeout(resolve, 50))
            }
        }

        await uploadWithConcurrencyLimit()

        if (uploadErrors.length > 0) {
            return Err({ _: "IMAGES_UPLOADING_FAILED", errors: uploadErrors })
        }
    }

    return Ok(processed)
}

// --- Misc

export async function extractContentBody(
    file: Obsidian.TFile,
    app: Obsidian.App,
): Promise<Result<string, GenericError>> {
    try {
        let fileContents = await app.vault.read(file)
        let { contentStart } = Obsidian.getFrontMatterInfo(fileContents)
        return Ok(fileContents.slice(contentStart))
    } catch (error) {
        return Err(new GenericError("Failed to read file content", error))
    }
}

export type PublishTrackingFrontmatter = {
    [FM.D42_LAST_PUBLISHED_ON]?: number | null
    [FM.D42_LAST_PUBLISHED_TITLE]?: string | null
}

// Check if file has changed since last publish.
// Returns true if file should be published (has changes or never published).
export function isFileChanged(file: Obsidian.TFile, frontmatter: PublishTrackingFrontmatter): boolean {
    // TODO: We should probably move this check to the server since user might preview a draft without publishing it
    let d42LastPublishedOn = frontmatter[FM.D42_LAST_PUBLISHED_ON]
    let d42LastPublishedTitle = frontmatter[FM.D42_LAST_PUBLISHED_TITLE]

    if (!d42LastPublishedOn || !d42LastPublishedTitle) return true // never published

    const currentTitle = file.basename
    const tolerance = 1000 // 1 second tolerance
    const isModified = Math.abs(file.stat.mtime - d42LastPublishedOn) > tolerance
    const isTitleChanged = d42LastPublishedTitle !== currentTitle

    // TODO: Check if assets have been modified

    return isModified || isTitleChanged
}
