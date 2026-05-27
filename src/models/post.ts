import * as Obsidian from "obsidian"
import { z } from "zod"

import * as Content from "src/models/content"
import * as Image from "src/models/image"
import * as BlockId from "src/automations/block-id"
import * as FM from "src/models/fm"
import * as Opaque from "src/utils/opaque"
import { Ok, Err, Result } from "src/utils/result"

import { PostId } from "src/models/content"
export { PostId }

export type FrontmatterErrors = FrontmatterError[]

const FrontmatterErrorType = {
    INVALID_POSTED_ON: Content.INVALID_POSTED_ON,
    MISSING_COVER_LINK: "MISSING_COVER_LINK",
} as const

export type FrontmatterError =
    | { _: typeof FrontmatterErrorType.INVALID_POSTED_ON }
    | { _: typeof FrontmatterErrorType.MISSING_COVER_LINK }

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

export const PostPrepublishedStatus = z.union([PostStatusIdea, Content.ContentStatusDraft])
export type PostPrepublishedStatus = z.infer<typeof PostPrepublishedStatus>

export const PostStatus = z.union([PostStatusIdea, Content.ContentStatus])
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

export const PublishableFrontmatter = z.object({
    status: PostStatus.nullable().optional(),
    description: z.string().nullable().optional(),
    "posted on": Content.PostedOn.optional(),
    cover: z.string().nullable().optional(),
    "cover credit text": z.string().nullable().optional(),
    "cover credit link": z.string().nullable().optional(),
    slug: PostSlug.nullable().optional(),
    tags: z.array(z.string()).nullable().optional(),
    [FM.DFT_CONTENT_KIND]: Content.ContentKind.nullable().optional(),
    [FM.DFT_CONTENT_ID]: PostId.nullable().optional(),
    [FM.DFT_LAST_PUBLISHED_TITLE]: z.string().nullable().optional(),
    [FM.DFT_LAST_PUBLISHED_SLUG]: Content.RenderedSlug.nullable().optional(),
    [FM.DFT_LAST_PUBLISHED_ON]: z.number().nullable().optional(),
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
    FM.DFT_CONTENT_KIND,
    FM.DFT_CONTENT_ID,
    FM.DFT_LAST_PUBLISHED_TITLE,
    FM.DFT_LAST_PUBLISHED_SLUG,
    FM.DFT_LAST_PUBLISHED_ON,
]

export const Frontmatter = PublishableFrontmatter.partial()
export type Frontmatter = z.infer<typeof Frontmatter>

export const IMAGE_PREFIX_POST = "post"
export const IMAGE_PREFIX_COVER = "cover"

export function isNormalizedImageFilename(filename: string): boolean {
    const pattern = new RegExp(`^(${IMAGE_PREFIX_POST}|${IMAGE_PREFIX_COVER})-.*\\.[a-f0-9]{8}\\.\\w+$`, "i")
    return pattern.test(filename)
}

export function getFrontmatter(app: Obsidian.App, file: Obsidian.TFile) {
    return FM.getFrontmatter<Frontmatter>(app, file)
}

export function validateFrontmatter(
    app: Obsidian.App,
    file: Obsidian.TFile,
    frontmatter: Obsidian.FrontMatterCache,
    links: Obsidian.FrontmatterLinkCache[] | undefined,
): Result<PublishableFrontmatter, FrontmatterErrors> {
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
        let errors: FrontmatterErrors = result.error.issues.map(issue => {
            if (issue.path[0] == "posted on") {
                if (issue.code === "custom" && issue.message === "INVALID_POSTED_ON") {
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

export function updateFrontmatter(app: Obsidian.App, file: Obsidian.TFile, fn: (meta: Frontmatter) => void) {
    return FM.updateFrontmatter(app, file, OrderedFrontmatter, fn)
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
