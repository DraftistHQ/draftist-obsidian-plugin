import * as Obsidian from "obsidian"

import { Ok, Err, Result } from "src/utils/result"
import * as log from "src/logger"

export const D42_PREFIX = "[d42]"

export const D42_CONTENT_KIND = `${D42_PREFIX} content kind` as const
export const D42_CONTENT_ID = `${D42_PREFIX} content id` as const
export const D42_LAST_PUBLISHED_TITLE = `${D42_PREFIX} published title` as const
export const D42_LAST_PUBLISHED_SLUG = `${D42_PREFIX} published slug` as const
export const D42_LAST_PUBLISHED_ON = `${D42_PREFIX} published on` as const

export function ensureOrder(frontmatter: Record<string, any>, order: string[]): void {
    const ordered: Record<string, any> = {}

    // First, add properties in desired order (if they exist) and remove them from frontmatter
    for (const key of order) {
        if (key in frontmatter) {
            ordered[key] = frontmatter[key]
            delete frontmatter[key]
        }
    }

    // Then add any remaining properties
    for (const key in frontmatter) {
        ordered[key] = frontmatter[key]
        delete frontmatter[key]
    }

    // Assign ordered properties back
    Object.assign(frontmatter, ordered)
}

export function getFrontmatter<T>(app: Obsidian.App, file: Obsidian.TFile): T | null {
    const fileCache = app.metadataCache.getFileCache(file)
    return fileCache?.frontmatter ? (fileCache.frontmatter as T) : null
}

export async function updateFrontmatter<T>(
    app: Obsidian.App,
    file: Obsidian.TFile,
    orderedKeys: string[],
    fn: (meta: T) => void,
): Promise<Result<null, Error>> {
    try {
        await app.fileManager.processFrontMatter(file, frontmatter => {
            fn(frontmatter as T)
            ensureOrder(frontmatter, orderedKeys)
        })
        return Ok(null)
    } catch (error) {
        log.error("Failed to update frontmatter", error)
        return Err(error as Error)
    }
}
