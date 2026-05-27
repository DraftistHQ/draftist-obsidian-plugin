import * as Obsidian from "obsidian"
import { z } from "zod"

import * as FM from "src/models/fm"
import * as Config from "src/config"
import * as Site from "src/models/site"
import * as Content from "src/models/content"
import * as Image from "src/models/image"
import { Ok, Err, Result } from "src/utils/result"

import { DocPageId } from "src/models/content"
export { DocPageId }

export const DocPageSlug = z.string().brand<"DocPageSlug">()
export type DocPageSlug = z.infer<typeof DocPageSlug>

export const PublishableFrontmatter = z.object({
    status: Content.ContentStatus.nullable().optional(),
    description: z.string().nullable().optional(),
    "posted on": Content.PostedOn.optional(),
    slug: DocPageSlug.nullable().optional(),
    tags: z.array(z.string()).nullable().optional(),
    collapsed: z.boolean().nullable().optional(),
    [FM.DFT_CONTENT_KIND]: Content.ContentKind.nullable().optional(),
    [FM.DFT_CONTENT_ID]: DocPageId.nullable().optional(),
    [FM.DFT_POSITION]: z.number().nullable().optional(),
    [FM.DFT_LAST_PUBLISHED_TITLE]: z.string().nullable().optional(),
    [FM.DFT_LAST_PUBLISHED_SLUG]: Content.RenderedSlug.nullable().optional(),
    [FM.DFT_LAST_PUBLISHED_ON]: z.number().nullable().optional(),
})
export type PublishableFrontmatter = z.infer<typeof PublishableFrontmatter>

export const OrderedFrontmatter: Array<keyof PublishableFrontmatter> = [
    "status",
    "description",
    "posted on",
    "slug",
    "tags",
    "collapsed",
    FM.DFT_CONTENT_KIND,
    FM.DFT_CONTENT_ID,
    FM.DFT_POSITION,
    FM.DFT_LAST_PUBLISHED_TITLE,
    FM.DFT_LAST_PUBLISHED_SLUG,
    FM.DFT_LAST_PUBLISHED_ON,
]

export const Frontmatter = PublishableFrontmatter.partial()
export type Frontmatter = z.infer<typeof Frontmatter>

export function getFrontmatter(app: Obsidian.App, file: Obsidian.TFile) {
    return FM.getFrontmatter<Frontmatter>(app, file)
}

export type FrontmatterErrors = FrontmatterError[]

export type FrontmatterError = { _: typeof Content.INVALID_POSTED_ON }

export function validateFrontmatter(
    frontmatter: Obsidian.FrontMatterCache,
): Result<PublishableFrontmatter, FrontmatterErrors> {
    const result = PublishableFrontmatter.safeParse(frontmatter)

    if (result.success) {
        return Ok(result.data)
    } else {
        let errors: FrontmatterErrors = result.error.issues.map(issue => {
            if (issue.path[0] == "posted on") {
                if (issue.code === "custom" && issue.message === Content.INVALID_POSTED_ON) {
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

// --- Hierarchy Derivation
//
// These functions derive hierarchy from Obsidian's folder structure.
// The parentPath is then resolved to a domain DocPageId before sending to the API.

// Extract numeric position from folder name prefix.
// e.g., "01 - Introduction" -> 1, "02-Setup" -> 2, "Quick Start" -> null
const FOLDER_PREFIX_REGEX = /^(\d+)\s*[-–—]\s*/

export function extractPositionFromFolderName(folderName: string): number | null {
    const match = folderName.match(FOLDER_PREFIX_REGEX)
    return match ? parseInt(match[1], 10) : null
}

export function extractTitleFromFolderName(folderName: string): string | null {
    const match = folderName.match(FOLDER_PREFIX_REGEX)
    return match ? folderName.slice(match[0].length) : null
}

export function parseFolderName(folderName: string): { position: number; title: string } | null {
    const match = folderName.match(FOLDER_PREFIX_REGEX)
    if (!match) return null
    return { position: parseInt(match[1], 10), title: folderName.slice(match[0].length) }
}

// Obsidian-specific hierarchy info derived from folder structure.
// The parentPath is resolved to a DocPageId in publish-doc.ts before sending data to API.
export type DocHierarchy = {
    // Relative folder path to parent (Obsidian-specific, resolved to parentId before API call)
    parentPath: string | null
    // Position for ordering (from folder numeric prefix)
    position: number
}

// Derive hierarchy from Obsidian folder structure.
// Given: DocsModule/01 - Getting Started/02 - Installation/Installation.md
// Returns: { parentPath: "01 - Getting Started", position: 2 }
export function deriveHierarchy(file: Obsidian.TFile, modulePath: string): DocHierarchy {
    // Get path relative to module root
    const normalizedModulePath = Obsidian.normalizePath(modulePath)
    const normalizedFilePath = Obsidian.normalizePath(file.path)

    let relativePath = normalizedFilePath
    if (normalizedFilePath.startsWith(normalizedModulePath + "/")) {
        relativePath = normalizedFilePath.slice(normalizedModulePath.length + 1)
    } else if (normalizedFilePath.startsWith(normalizedModulePath)) {
        relativePath = normalizedFilePath.slice(normalizedModulePath.length)
    }

    // Split into parts: ["01 - Getting Started", "02 - Installation", "Installation.md"]
    const parts = relativePath.split("/").filter(p => p.length > 0)

    // Remove filename to get folder path
    parts.pop()

    if (parts.length === 0) {
        // File is at module root (shouldn't happen normally, but handle it)
        return { parentPath: null, position: 1 }
    }

    // Last folder is the page's own folder - extract position from it
    const pageFolder = parts.pop()!
    const position = extractPositionFromFolderName(pageFolder) ?? 1

    // Remaining parts form the parent path
    const parentPath = parts.length > 0 ? parts.join("/") : null

    return { parentPath, position }
}

// --- Parent Resolution

export type ResolveParentError =
    | { _: "PARENT_FOLDER_NOT_FOUND"; folderPath: string }
    | { _: "PARENT_NOTE_NOT_FOUND"; folderPath: string }
    | { _: "PARENT_NOT_PUBLISHED"; folderPath: string }

// Resolves parent page ID from folder structure.
// Returns null if page is at root level (no parent).
export function resolveParentId(
    file: Obsidian.TFile,
    app: Obsidian.App,
    site: Config.SiteSettings,
    siteModule: Site.SiteModule,
): Result<DocPageId | null, ResolveParentError> {
    const sitePath = site.path === "/" ? "" : site.path
    const modulePath = Obsidian.normalizePath(`${sitePath}/${siteModule.name}`)
    const hierarchy = deriveHierarchy(file, modulePath)

    if (hierarchy.parentPath === null) {
        return Ok(null)
    }

    const parentFolderPath = Obsidian.normalizePath(`${modulePath}/${hierarchy.parentPath}`)
    const parentFolder = app.vault.getAbstractFileByPath(parentFolderPath)

    if (!parentFolder || !(parentFolder instanceof Obsidian.TFolder)) {
        return Err({ _: "PARENT_FOLDER_NOT_FOUND", folderPath: hierarchy.parentPath })
    }

    const parentNote = parentFolder.children.find(
        child => child instanceof Obsidian.TFile && child.extension === "md",
    ) as Obsidian.TFile | undefined

    if (!parentNote) {
        return Err({ _: "PARENT_NOTE_NOT_FOUND", folderPath: hierarchy.parentPath })
    }

    const parentFrontmatter = app.metadataCache.getFileCache(parentNote)?.frontmatter
    const parentContentId = parentFrontmatter?.[FM.DFT_CONTENT_ID] as DocPageId | undefined

    if (!parentContentId) {
        return Err({ _: "PARENT_NOT_PUBLISHED", folderPath: hierarchy.parentPath })
    }

    return Ok(parentContentId)
}

// --- Assets

export const IMAGE_PREFIX_DOC = "doc"

export function isNormalizedImageFilename(filename: string): boolean {
    const pattern = new RegExp(`^${IMAGE_PREFIX_DOC}-.*\\.[a-f0-9]{8}\\.\\w+$`, "i")
    return pattern.test(filename)
}

export type Asset = Image.ImageFile

export function collectAssets(app: Obsidian.App, file: Obsidian.TFile, fileCache: Obsidian.CachedMetadata): Asset[] {
    const assetsMap = new Map<string, Asset>()

    fileCache.embeds?.forEach(embed => {
        const asset = app.metadataCache.getFirstLinkpathDest(embed.link, file.path)
        if (asset && !assetsMap.has(asset.path)) {
            assetsMap.set(asset.path, { file: asset })
        }
    })

    return Array.from(assetsMap.values())
}
