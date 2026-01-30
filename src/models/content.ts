import { z } from "zod"

import * as BlockId from "src/automations/block-id"
import * as Opaque from "src/utils/opaque"

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
