// CORE: core/lib/services/server/routes/providers/obsidian/docs/sync_doc_page.rs

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

const parsers = {
    success: Response,
    failure: null,
}

export function send(siteId: Site.SiteId, pageId: Doc.DocPageId) {
    return Api.get(`/sites/${siteId}/docs/page/${pageId}/sync`, { parsers })
}