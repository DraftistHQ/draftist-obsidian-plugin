// CORE: core/lib/services/server/routes/providers/obsidian/blog/publish_blog_post_draft.rs

import { z } from "zod"

import * as Api from "src/clients/api"
import * as Errors from "src/clients/errors"
import * as Site from "src/models/site"
import * as Post from "src/models/post"
import * as Content from "src/models/content"
import * as Image from "src/models/image"

const PostData = z.object({
    title: z.string(),
    content: z.string(),
    cover: Post.Cover.nullable(),
    status: Post.PostStatus.nullable(),
    slug: Post.PostSlug.nullable(),
    postedOn: z.string(),
    links: z.array(Content.InternalLink),
    images: z.array(Image.PublishableImage),
})
type PostData = z.infer<typeof PostData>

const PublishablePostKind = z.union([
    z.literal("NewPost"),
    z.object({ TAG: z.literal("ExistingPost"), id: Post.PostId }),
])
export type PublishablePostKind = z.infer<typeof PublishablePostKind>

const PublishablePost = z.object({
    siteModuleId: Site.SiteModuleId,
    postKind: PublishablePostKind,
    postData: PostData,
})
export type PublishablePost = z.infer<typeof PublishablePost>

export const PublishedPost = z.object({
    id: Post.PostId,
    slug: Post.PublishedPostSlug,
})
export type PublishedPost = z.infer<typeof PublishedPost>

const Error = z.union([
    z.literal("BadRequest"),
    z.object({
        TAG: z.literal("InvalidInput"),
        error: z.union([
            z.literal("EmptyContent"),
            z.object({
                TAG: z.literal("InvalidSlug"),
                error: z.union([z.literal("NonAscii"), z.literal("UnsafeChars")]),
            }),
            Errors.InvalidContentError,
        ]),
    }),
    z.object({
        TAG: z.literal("BrokenLinks"),
        links: z.array(Content.InternalLink),
    }),
    z.object({
        TAG: z.literal("MissingImages"),
        images: z.array(Image.PublishableImage),
    }),
])
export type Error = z.infer<typeof Error>

const parsers = {
    success: PublishedPost,
    failure: Error,
}

export function send(siteId: Site.SiteId, post: PublishablePost) {
    return Api.post(`/sites/${siteId}/blog/post/draft`, { body: post, parsers })
}
