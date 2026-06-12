// CORE: core/lib/services/server/routes/integrations/obsidian/docs/get_doc_page_metadata.rs

import { z } from "zod"

import * as Api from "src/clients/api"
import * as Site from "src/models/site"
import * as Doc from "src/models/doc"
import * as Content from "src/models/content"

const Response = z.object({
    status: Content.ContentStatus.nullable(),
    postedOnAutoAssigned: z.string().nullable(),
})
export type Response = z.infer<typeof Response>

const Error = z.literal("NotFound")
export type Error = z.infer<typeof Error>

const parsers = {
    success: Response,
    failure: Error,
}

export function send(siteId: Site.SiteId, pageId: Doc.DocPageId) {
    return Api.get(`/sites/${siteId}/docs/page/${pageId}/metadata`, { parsers })
}
