import * as Obsidian from "obsidian"
import { z } from "zod"

import * as Content from "src/models/content"
import * as Image from "src/models/image"
import * as BlockId from "src/automations/block-id"
import * as FM from "src/utils/frontmatter"
import * as Opaque from "src/utils/opaque"
import { Ok, Err, Result } from "src/utils/result"
import * as log from "src/logger"

export type FrontMatterErrors = FrontMatterError[]

const FrontMatterErrorType = {
    MISSING_POSTED_ON: "MISSING_POSTED_ON",
    INVALID_POSTED_ON: "INVALID_POSTED_ON",
    MISSING_COVER_LINK: "MISSING_COVER_LINK",
} as const

export type FrontMatterError =
    | { _: typeof FrontMatterErrorType.MISSING_POSTED_ON }
    | { _: typeof FrontMatterErrorType.INVALID_POSTED_ON }
    | { _: typeof FrontMatterErrorType.MISSING_COVER_LINK }

export const PostId = Opaque.id<"PostId">()
export type PostId = z.infer<typeof PostId>

export const CoverCredit = z.object({
    text: z.string(),
    link: z.string().nullable(),
})
export type CoverCredit = z.infer<typeof CoverCredit>

export const Cover = z.discriminatedUnion("TAG", [
    z.object({ TAG: z.literal("Internal"), imageId: Image.ImageId, credit: CoverCredit.nullable() }),
    z.object({ TAG: z.literal("External"), url: z.string(), credit: CoverCredit.nullable() }),
])
export type Cover = z.infer<typeof Cover>

export const PostStatusIdea = z.literal("Idea")
export const PostStatusDraft = z.literal("Draft")
export const PostStatusPublished = z.literal("Published")
export const PostStatusArchived = z.literal("Archived")

export const PostPrepublishedStatus = z.union([PostStatusIdea, PostStatusDraft])
export type PostPrepublishedStatus = z.infer<typeof PostPrepublishedStatus>

export const PostStatus = z.union([
    PostStatusIdea,
    PostStatusDraft,
    PostStatusPublished,
    PostStatusArchived,
    // z.string(),
])
export type PostStatus = z.infer<typeof PostStatus>

export function getStatusFolderName(status: "Idea" | "Draft" | "Published" | "Archived"): string {
    switch (status) {
        case "Idea":
            return "Ideas"
        case "Draft":
            return "Drafts"
        case "Published":
            return "Published"
        case "Archived":
            return "Archive"
        default:
            status satisfies never
            return status
    }
}

export const PostSlug = z.string().brand<"PostSlug">()
export type PostSlug = z.infer<typeof PostSlug>

export const PostedOn = z.string().refine(
    value => {
        const dateFormat = Obsidian.moment(value, "YYYY-MM-DD", true)
        if (dateFormat.isValid()) return true

        const dateTimeFormat = Obsidian.moment(value, "YYYY-MM-DDTHH:mm:ss", true)
        return dateTimeFormat.isValid()
    },
    { message: FrontMatterErrorType.INVALID_POSTED_ON },
)

export const InternalLink = z.discriminatedUnion("TAG", [
    z.object({
        TAG: z.literal("AnchorLink"),
        blockId: BlockId.T,
        mdLinkTarget: z.string(),
    }),
    z.object({
        TAG: z.literal("ContentLink"),
        contentId: PostId,
        contentKind: Content.ContentKind,
        blockId: BlockId.T.nullable(),
        mdLinkTarget: z.string(),
    }),
])
export type InternalLink = z.infer<typeof InternalLink>

export const PublishedPostSlug = z.string().brand<"PublishedPostSlug">()
export type PublishedPostSlug = z.infer<typeof PublishedPostSlug>

export const FM_D42_PREFIX = "[d42]"

export const FM_D42_CONTENT_KIND = `${FM_D42_PREFIX} content kind` as const
export const FM_D42_CONTENT_ID = `${FM_D42_PREFIX} content id` as const
export const FM_D42_LAST_PUBLISHED_TITLE = `${FM_D42_PREFIX} published title` as const
export const FM_D42_LAST_PUBLISHED_SLUG = `${FM_D42_PREFIX} published slug` as const
export const FM_D42_LAST_PUBLISHED_ON = `${FM_D42_PREFIX} published on` as const

export const PublishableFrontmatter = z.object({
    status: PostStatus.nullable().optional(),
    description: z.string().nullable().optional(),
    cover: z.string().nullable().optional(),
    "cover credit text": z.string().nullable().optional(),
    "cover credit link": z.string().nullable().optional(),
    "posted on": PostedOn,
    slug: PostSlug.nullable().optional(),
    tags: z.array(z.string()).nullable().optional(),
    [FM_D42_CONTENT_KIND]: Content.ContentKind.nullable().optional(),
    [FM_D42_CONTENT_ID]: PostId.nullable().optional(),
    [FM_D42_LAST_PUBLISHED_TITLE]: z.string().nullable().optional(),
    [FM_D42_LAST_PUBLISHED_SLUG]: PublishedPostSlug.nullable().optional(),
    [FM_D42_LAST_PUBLISHED_ON]: z.number().nullable().optional(),
})
export type PublishableFrontmatter = z.infer<typeof PublishableFrontmatter>

export const OrderedFrontmatter: Array<keyof PublishableFrontmatter> = [
    "status",
    "description",
    "posted on",
    "cover",
    "cover credit text",
    "cover credit link",
    "slug",
    "tags",
    FM_D42_CONTENT_KIND,
    FM_D42_CONTENT_ID,
    FM_D42_LAST_PUBLISHED_TITLE,
    FM_D42_LAST_PUBLISHED_SLUG,
    FM_D42_LAST_PUBLISHED_ON,
]

export const Frontmatter = PublishableFrontmatter.partial()
export type Frontmatter = z.infer<typeof Frontmatter>

export const IMAGES_FOLDER = "images"
export const IMAGE_PREFIX_POST = "post"
export const IMAGE_PREFIX_COVER = "cover"

export function isNormalizedImageFilename(filename: string): boolean {
    const pattern = new RegExp(`^(${IMAGE_PREFIX_POST}|${IMAGE_PREFIX_COVER})-.*\\.[a-f0-9]{8}\\.\\w+$`, "i")
    return pattern.test(filename)
}

export async function copyImageFileToPostSubfolder(
    app: Obsidian.App,
    postFolder: Obsidian.TFolder,
    imageFileName: string,
    imageFile: File,
) {
    const imagesFolderPath = Obsidian.normalizePath(`${postFolder.path}/${IMAGES_FOLDER}`)
    const imagesFolderExists = await app.vault.adapter.exists(imagesFolderPath)
    if (!imagesFolderExists) {
        await app.vault.createFolder(imagesFolderPath)
    }

    const imagePath = Obsidian.normalizePath(`${imagesFolderPath}/${imageFileName}`)
    const imageBuffer = await imageFile.arrayBuffer()
    await app.vault.adapter.writeBinary(imagePath, Buffer.from(imageBuffer))
}

export function getFrontmatter(app: Obsidian.App, file: Obsidian.TFile): Frontmatter | null {
    const fileCache = app.metadataCache.getFileCache(file)
    return fileCache?.frontmatter ? (fileCache.frontmatter as Frontmatter) : null
}

export function validateFrontmatter(
    app: Obsidian.App,
    file: Obsidian.TFile,
    frontmatter: Obsidian.FrontMatterCache,
    links: Obsidian.FrontmatterLinkCache[] | undefined,
): Result<PublishableFrontmatter, FrontMatterErrors> {
    let data = frontmatter as Frontmatter

    const result = PublishableFrontmatter.safeParse(data)

    if (result.success) {
        if (!!result.data.cover) {
            if (!result.data.cover.startsWith("http")) {
                let hasCoverLink = links?.some(link => link.key === "cover")
                if (!hasCoverLink) return Err([{ _: "MISSING_COVER_LINK" }])
            }
        }
        return Ok(result.data)
    } else {
        let errors: FrontMatterErrors = result.error.issues.map(issue => {
            if (issue.path[0] == "posted on") {
                if (issue.code === "invalid_type" && issue.received === "undefined") {
                    return { _: "MISSING_POSTED_ON" }
                } else if (issue.code === "custom" && issue.message === "INVALID_POSTED_ON") {
                    return { _: issue.message }
                } else {
                    throw result.error
                }
            } else {
                throw result.error
            }
        })
        return Err(errors)
    }
}

export async function updateFrontmatter(
    app: Obsidian.App,
    file: Obsidian.TFile,
    fn: (meta: Frontmatter) => void,
): Promise<Result<null, Error>> {
    try {
        await app.fileManager.processFrontMatter(file, frontmatter => {
            fn(frontmatter)
            FM.ensureOrder(frontmatter, OrderedFrontmatter)
        })
        return Ok(null)
    } catch (error) {
        log.error("Failed to update frontmatter", error)
        return Err(error as Error)
    }
}

export type Asset = Image.ImageFile<{ isCover: boolean }>

export function collectAssets(app: Obsidian.App, file: Obsidian.TFile, fileCache: Obsidian.CachedMetadata): Asset[] {
    const assetsMap = new Map<string, Asset>()

    fileCache.embeds?.forEach(embed => {
        const asset = app.metadataCache.getFirstLinkpathDest(embed.link, file.path)
        if (asset && !assetsMap.has(asset.path)) {
            assetsMap.set(asset.path, { file: asset, isCover: false })
        }
    })

    fileCache.frontmatterLinks?.forEach(fm => {
        if (fm.key === "cover") {
            const asset = app.metadataCache.getFirstLinkpathDest(fm.link, file.path)
            if (asset) {
                // Cover takes precedence - overwrite if exists
                assetsMap.set(asset.path, { file: asset, isCover: true })
            }
        }
    })

    return Array.from(assetsMap.values())
}
