import * as Obsidian from "obsidian"

import * as Config from "src/config"
import * as Doc from "src/models/doc"
import * as Site from "src/models/site"
import * as Notice from "src/notice"
import * as log from "src/logger"

import type { DocPageChangeData, DocPageState } from "../types"

export function detectDocPageChange(
    file: Obsidian.TFile,
    cache: Obsidian.CachedMetadata,
    site: Config.SiteSettings,
    module: Site.SiteModule,
): DocPageChangeData | null {
    const folder = file.parent
    if (!folder) return null

    // Extract current state
    const state: DocPageState = {
        title: file.basename,
        position: Doc.extractPositionFromFolderName(folder.name),
    }

    // Calculate expected folder name based on current state
    const expectedFolderName = buildFolderName(state)
    if (!expectedFolderName) return null

    // Compare to actual folder name
    if (folder.name === expectedFolderName) return null // Already correct

    // Folder needs to be renamed
    return {
        file,
        folder,
        state,
    }
}

export async function handleDocPageChange(
    app: Obsidian.App,
    change: DocPageChangeData,
    site: Config.SiteSettings,
    module: Site.SiteModule,
): Promise<void> {
    const { folder, state } = change

    // Calculate new folder name
    const newFolderName = buildFolderName(state)
    if (!newFolderName) {
        log.error("Failed to calculate new folder name for doc page", { file: change.file.path, state })
        return
    }

    // Build the new folder path (same parent, different name)
    const parentPath = folder.parent?.path || ""
    const newFolderPath = parentPath ? `${parentPath}/${newFolderName}` : newFolderName

    // Check for conflicts
    const conflict = await app.vault.adapter.exists(newFolderPath)
    if (conflict) {
        log.warn(`Cannot rename folder: destination already exists: ${newFolderPath}`)
        Notice.warning("Cannot rename doc folder - folder already exists at destination")
        return
    }

    try {
        // Rename the folder
        await app.fileManager.renameFile(folder, newFolderPath)

        Notice.info(`"${change.file.basename}" folder renamed`)
    } catch (error) {
        log.error("Failed to rename doc page folder", error)
        Notice.error("Failed to rename doc folder")
    }
}

function buildFolderName(state: DocPageState): string | null {
    // If no position (no numeric prefix), just use the title
    if (state.position === null) {
        return state.title
    }

    // Format: "01 - Title" (pad to 2 digits)
    const paddedPosition = String(state.position).padStart(2, "0")
    return `${paddedPosition} - ${state.title}`
}

// Handle doc page folder deletion by renumbering remaining siblings.
// Called after a folder is deleted to shift siblings down.
export async function handleDocPageFolderDelete(
    app: Obsidian.App,
    deletedFolderName: string,
    parentFolder: Obsidian.TFolder,
): Promise<void> {
    // Extract position from deleted folder name
    const deletedPosition = Doc.extractPositionFromFolderName(deletedFolderName)
    if (deletedPosition === null) {
        log.trace("Deleted folder had no position prefix. No renumbering needed.")
        return
    }

    // Get sibling folders with position > deleted position
    const siblings = parentFolder.children
        .filter((child): child is Obsidian.TFolder => child instanceof Obsidian.TFolder)
        .map(folder => ({
            folder,
            position: Doc.extractPositionFromFolderName(folder.name),
        }))
        .filter(
            (x): x is { folder: Obsidian.TFolder; position: number } =>
                x.position !== null && x.position > deletedPosition,
        )
        .sort((a, b) => a.position - b.position) // Sort ascending for sequential renaming

    if (siblings.length === 0) {
        log.trace("No siblings to renumber after deletion.")
        return
    }

    log.trace(`Renumbering ${siblings.length} siblings after deletion of position ${deletedPosition}`)

    // Rename in ascending order (shift down: 3→2, 4→3, etc.)
    for (const { folder, position } of siblings) {
        const newPosition = position - 1
        const paddedPosition = String(newPosition).padStart(2, "0")
        const nameParts = folder.name.match(/^\d+\s*[-–—]\s*(.*)$/)
        const nameWithoutPrefix = nameParts ? nameParts[1] : folder.name
        const newName = `${paddedPosition} - ${nameWithoutPrefix}`
        const newPath = `${parentFolder.path}/${newName}`

        try {
            await app.fileManager.renameFile(folder, newPath)
            log.trace(`Renamed folder: ${folder.name} -> ${newName}`)
        } catch (error) {
            log.error(`Failed to rename folder ${folder.name}`, error)
            Notice.error(`Failed to renumber "${folder.name}"`)
            return // Stop on first error
        }
    }

    Notice.info("Doc pages renumbered")
}
