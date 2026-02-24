import * as Obsidian from "obsidian"

import * as Config from "src/config"
import * as Content from "src/models/content"
import * as Post from "src/models/post"
import * as Site from "src/models/site"
import * as Notice from "src/notice"
import * as log from "src/logger"

import type { BlogPostChangeData, BlogPostState } from "../types"

export function detectBlogPostChange(
    file: Obsidian.TFile,
    cache: Obsidian.CachedMetadata,
    site: Config.SiteSettings,
    module: Site.SiteModule,
): BlogPostChangeData | null {
    const folder = file.parent
    if (!folder) return null

    // Extract current state from frontmatter
    const frontmatter = cache.frontmatter as Post.Frontmatter | undefined
    const state: BlogPostState = {
        status: frontmatter?.status || null,
        postedOn: frontmatter?.["posted on"] || null,
        title: file.basename,
    }

    // Calculate expected folder path based on current state
    const expectedPath = buildFolderPath(state, site, module)
    if (!expectedPath) return null

    // Compare to actual path
    const actualPath = Obsidian.normalizePath(folder.path)
    if (actualPath === expectedPath) return null // Already in correct location

    // File needs to be relocated
    return {
        file,
        folder,
        state,
    }
}

export async function handleBlogPostChange(
    app: Obsidian.App,
    change: BlogPostChangeData,
    site: Config.SiteSettings,
    module: Site.SiteModule,
): Promise<void> {
    const { folder, state } = change

    // Calculate new folder path
    const newFolderPath = buildFolderPath(state, site, module)
    if (!newFolderPath) {
        log.error("Failed to calculate new folder path for blog post", { file: change.file.path, state })
        return
    }

    // Check for conflicts
    const conflict = await app.vault.adapter.exists(newFolderPath)
    if (conflict) {
        log.warn(`Cannot move folder: destination already exists: ${newFolderPath}`)
        Notice.warning("Cannot move post - folder already exists at destination")
        return
    }

    try {
        // Ensure parent directories exist
        await ensureParentFolders(app, newFolderPath)

        // Move the folder
        await app.fileManager.renameFile(folder, newFolderPath)

        Notice.info(`"${change.file.basename}" note location updated`)
    } catch (error) {
        log.error("Failed to move blog post folder", error)
        Notice.error("Failed to move post folder")
    }
}

function buildFolderPath(state: BlogPostState, site: Config.SiteSettings, module: Site.SiteModule): string | null {
    if (!site.path) return null

    // Validate status using existing PostStatus schema
    const statusResult = Post.PostStatus.safeParse(state.status)
    if (!statusResult.success) return null

    const statusFolder = Post.getStatusFolderName(statusResult.data)

    // Determine post folder name (with or without date prefix)
    let postFolderName: string
    const postedOnResult = Content.PostedOn.safeParse(state.postedOn)
    if (postedOnResult.success && postedOnResult.data !== null) {
        const datePrefix = Obsidian.moment(postedOnResult.data).format("YYYY-MM-DD")
        postFolderName = `${datePrefix} - ${state.title}`
    } else {
        postFolderName = state.title
    }

    const basePath = Obsidian.normalizePath(`${site.path}/${module.name}`)
    return Obsidian.normalizePath(`${basePath}/${statusFolder}/${postFolderName}`)
}

async function ensureParentFolders(app: Obsidian.App, folderPath: string): Promise<void> {
    const parts = folderPath.split("/")
    parts.pop() // Remove the target folder name

    let currentPath = ""
    for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part
        const exists = await app.vault.adapter.exists(currentPath)
        if (!exists) {
            await app.vault.createFolder(currentPath)
        }
    }
}
