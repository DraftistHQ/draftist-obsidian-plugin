// CORE: core/lib/services/server/routes/providers/obsidian/blog/publish_blog_post_draft.rs

import { z } from "zod"

import * as Api from "src/clients/api"
import * as Site from "src/models/site"
import * as Post from "src/models/post"
import * as Image from "src/models/image"

const PostData = z.object({
    title: z.string(),
    content: z.string(),
    cover: Post.Cover.nullable(),
    status: Post.PostStatus.nullable(),
    slug: Post.PostSlug.nullable(),
    postedOn: z.string(),
    links: z.array(Post.InternalLink),
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
            z.object({
                TAG: z.literal("InvalidContent"),
                error: z.object({
                    TAG: z.literal("ParsingErrors"),
                    errors: z.array(
                        z.discriminatedUnion("TAG", [
                            z.object({
                                TAG: z.literal("UnimplementedNode"),
                                node: z.string(),
                            }),
                            z.object({
                                TAG: z.literal("UnexpectedNode"),
                                node: z.string(),
                            }),
                            z.object({
                                TAG: z.literal("HeadingNodeConversionError"),
                                error: z.object({ TAG: z.literal("TooDeep"), level: z.number() }),
                            }),
                            z.object({
                                TAG: z.literal("ListNodeConversionError"),
                                error: z.union([
                                    z.object({ TAG: z.literal("UnimplementedNode"), node: z.string() }),
                                    z.object({ TAG: z.literal("UnexpectedNode"), node: z.string() }),
                                    z.object({
                                        TAG: z.literal("SubListConversionError"),
                                        error: z.array(
                                            z.union([
                                                z.object({ TAG: z.literal("UnimplementedNode"), node: z.string() }),
                                                z.object({ TAG: z.literal("UnexpectedNode"), node: z.string() }),
                                                z.object({ TAG: z.literal("SubListConversionError"), error: z.any() }), // TODO: Handle recursive type
                                            ]),
                                        ),
                                    }),
                                ]),
                            }),
                            z.object({
                                TAG: z.literal("BlockquoteNodeConversionError"),
                                error: z.discriminatedUnion("TAG", [
                                    z.object({ TAG: z.literal("UnimplementedNode"), node: z.string() }),
                                    z.object({ TAG: z.literal("UnexpectedNode"), node: z.string() }),
                                ]),
                            }),
                            z.object({
                                TAG: z.literal("CalloutError"),
                                error: z.union([
                                    z.literal("InvalidSyntax"),
                                    z.object({ TAG: z.literal("UnexpectedCalloutVariant"), variant: z.string() }),
                                    z.object({
                                        TAG: z.literal("BlockParsingError"),
                                        error: z.discriminatedUnion("TAG", [
                                            z.object({ TAG: z.literal("UnsupportedNode"), node: z.string() }),
                                            z.object({
                                                TAG: z.literal("HeadingError"),
                                                error: z.object({ TAG: z.literal("TooDeep"), level: z.number() }),
                                            }),
                                            z.object({
                                                TAG: z.literal("ListError"),
                                                error: z.union([
                                                    z.object({ TAG: z.literal("UnimplementedNode"), node: z.string() }),
                                                    z.object({ TAG: z.literal("UnexpectedNode"), node: z.string() }),
                                                    z.object({
                                                        TAG: z.literal("SubListConversionError"),
                                                        error: z.any(),
                                                    }), // TODO: Handle recursive type
                                                ]),
                                            }),
                                            z.object({
                                                TAG: z.literal("QuoteError"),
                                                error: z.discriminatedUnion("TAG", [
                                                    z.object({ TAG: z.literal("UnimplementedNode"), node: z.string() }),
                                                    z.object({ TAG: z.literal("UnexpectedNode"), node: z.string() }),
                                                ]),
                                            }),
                                            z.object({
                                                TAG: z.literal("ImageError"),
                                                error: z.discriminatedUnion("TAG", [
                                                    z.object({
                                                        TAG: z.literal("UnexpectedParams"),
                                                        params: z.string(),
                                                    }),
                                                    z.object({
                                                        TAG: z.literal("UnexpectedPlacementValue"),
                                                        value: z.string(),
                                                    }),
                                                    z.object({ TAG: z.literal("ImageNotFound"), url: z.string() }),
                                                ]),
                                            }),
                                            z.object({
                                                TAG: z.literal("VideoError"),
                                                error: z.union([
                                                    z.object({ TAG: z.literal("InvalidYouTubeUrl"), url: z.string() }),
                                                    z.object({
                                                        TAG: z.literal("UnexpectedYouTubeUrl"),
                                                        url: z.string(),
                                                    }),
                                                    z.literal("YouTubeUrlContainsInvalidChars"),
                                                ]),
                                            }),
                                            z.object({
                                                TAG: z.literal("GalleryError"),
                                                error: z.union([
                                                    z.object({ TAG: z.literal("UnexpectedNode"), node: z.string() }),
                                                    z.object({ TAG: z.literal("MissingImage"), url: z.string() }),
                                                    z.literal("EmptyGallery"),
                                                ]),
                                            }),
                                        ]),
                                    }),
                                ]),
                            }),
                            z.object({
                                TAG: z.literal("ImageConversionError"),
                                error: z.discriminatedUnion("TAG", [
                                    z.object({ TAG: z.literal("UnexpectedParams"), params: z.string() }),
                                    z.object({ TAG: z.literal("UnexpectedPlacementValue"), value: z.string() }),
                                    z.object({ TAG: z.literal("ImageNotFound"), url: z.string() }),
                                ]),
                            }),
                            z.object({
                                TAG: z.literal("VideoConversionError"),
                                error: z.union([
                                    z.object({ TAG: z.literal("InvalidYouTubeUrl"), url: z.string() }),
                                    z.object({ TAG: z.literal("UnexpectedYouTubeUrl"), url: z.string() }),
                                    z.literal("YouTubeUrlContainsInvalidChars"),
                                ]),
                            }),
                            z.object({
                                TAG: z.literal("GalleryError"),
                                error: z.union([
                                    z.object({ TAG: z.literal("UnexpectedNode"), node: z.string() }),
                                    z.object({ TAG: z.literal("MissingImage"), url: z.string() }),
                                    z.literal("EmptyGallery"),
                                ]),
                            }),
                        ]),
                    ),
                }),
            }),
        ]),
    }),
    z.object({
        TAG: z.literal("BrokenLinks"),
        links: z.array(Post.InternalLink),
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
