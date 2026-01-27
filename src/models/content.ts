import { z } from "zod"

export const BlogPostContentKind = z.literal("BlogPost")
export const GalleryImageContentKind = z.literal("GalleryImage")

export const ContentKind = z.union([BlogPostContentKind, GalleryImageContentKind])
export type ContentKind = z.infer<typeof ContentKind>
