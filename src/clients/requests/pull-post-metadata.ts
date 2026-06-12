// CORE: core/lib/services/server/routes/integrations/obsidian/blog/get_blog_post_metadata.rs

import { z } from "zod"

import * as Api from "src/clients/api"
import * as Site from "src/models/site"
import * as Post from "src/models/post"

const Response = z.object({
    status: Post.PostStatus.nullable(),
    postedOnAutoAssigned: z.string().nullable(),
})
export type Response = z.infer<typeof Response>

const Error = z.literal("NotFound")
export type Error = z.infer<typeof Error>

const parsers = {
    success: Response,
    failure: Error,
}

export function send(siteId: Site.SiteId, postId: Post.PostId) {
    return Api.get(`/sites/${siteId}/blog/post/${postId}/metadata`, { parsers })
}
