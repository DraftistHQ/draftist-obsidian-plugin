// CORE: core/lib/services/server/routes/providers/obsidian/docs/publish_doc_page_draft.rs (TODO: implement)

import { z } from "zod"

import * as Api from "src/clients/api"
import * as Errors from "src/clients/errors"
import * as Site from "src/models/site"
import * as Doc from "src/models/doc"
import * as Content from "src/models/content"
import * as Image from "src/models/image"

const DocPageData = z.object({
    title: z.string(),
    description: z.string().nullable(),
    content: z.string(),
    status: Content.ContentStatus.nullable(),
    slug: Doc.DocPageSlug.nullable(),
    parentId: Doc.DocPageId.nullable(),
    position: z.number(),
    postedOn: z.string().nullable(),
    links: z.array(Content.InternalLink),
    images: z.array(Image.PublishableImage),
})
type DocPageData = z.infer<typeof DocPageData>

const PublishableDocPageKind = z.union([
    z.literal("NewPage"),
    z.object({ TAG: z.literal("ExistingPage"), id: Doc.DocPageId }),
])
export type PublishableDocPageKind = z.infer<typeof PublishableDocPageKind>

const PublishableDocPage = z.object({
    siteModuleId: Site.SiteModuleId,
    pageKind: PublishableDocPageKind,
    pageData: DocPageData,
})
export type PublishableDocPage = z.infer<typeof PublishableDocPage>

export const PublishedDocPage = z.object({
    id: Doc.DocPageId,
    slug: Content.RenderedSlug,
})
export type PublishedDocPage = z.infer<typeof PublishedDocPage>

const Error = z.union([
    z.literal("BadRequest"),
    z.object({
        TAG: z.literal("InvalidInput"),
        error: z.union([
            z.literal("EmptyTitle"),
            z.object({
                TAG: z.literal("InvalidSlug"),
                error: z.union([z.literal("NonAscii"), z.literal("UnsafeChars")]),
            }),
            z.object({
                TAG: z.literal("ParentNotFound"),
                parentId: Doc.DocPageId,
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
    success: PublishedDocPage,
    failure: Error,
}

export function send(siteId: Site.SiteId, page: PublishableDocPage) {
    return Api.post(`/sites/${siteId}/docs/page/draft`, { body: page, parsers })
}
