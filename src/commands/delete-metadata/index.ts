import * as Obsidian from "obsidian"

import type Plugin from "src/main"
import { Commands } from "src/commands"
import * as Config from "src/config"
import * as Site from "src/models/site"
import * as Post from "src/models/post"
import * as Doc from "src/models/doc"
import * as FM from "src/models/fm"
import * as Image from "src/models/image"
import * as Notice from "src/notice"
import { OK, ERROR, Ok, Err, Result, GenericError } from "src/utils/result"
import * as TypedRecord from "src/utils/record"
import * as log from "src/logger"

export type DeleteFileMetadataError =
    | { _: "FRONTMATTER_UPDATE_FAILED"; error: GenericError }
    | { _: "IMAGE_METADATA_DELETE_FAILED"; path: string; error: GenericError }

export function registerCommand(plugin: Plugin): void {
    plugin.addCommand({
        ...Commands.DELETE_META_ENTRIES,
        checkCallback: (checking: boolean) => {
            let target = Config.Store.target()
            switch (target) {
                case "local":
                case "ci":
                    break
                case "production":
                    return false
                default:
                    target satisfies never
            }
            if (!Config.Store.debugging().exposeInternalMetadata) return false

            if (!checking) {
                confirmAndDeleteFileMetadata(plugin.app)
            }
            return true
        },
    })
}

function confirmAndDeleteFileMetadata(app: Obsidian.App): void {
    const file = app.workspace.getActiveFile()

    if (!file) {
        Notice.warning("No active file. Open a file and try again.")
        return
    }

    const siteAndModuleResult = Site.getSiteAndModuleForFile(file)
    switch (siteAndModuleResult._) {
        case OK:
            break
        case ERROR:
            Notice.warning("This note is not managed by Draftist.")
            return
        default:
            siteAndModuleResult satisfies never
            return
    }

    const modal = new Obsidian.Modal(app)

    modal.titleEl.setText("Delete Draftist metadata")

    modal.contentEl.createEl("p", {
        text: "It will delete all Draftist-related meta entries from frontmatter and image metadata files.",
    })
    modal.contentEl.createEl("p", {
        text: "This action cannot be undone.",
    })

    const buttonContainer = modal.contentEl.createDiv({ cls: "draftist-alert-buttons" })

    const cancelButton = buttonContainer.createEl("button", {
        text: "Cancel",
        cls: "draftist-button draftist-button-secondary",
    })
    cancelButton.addEventListener("click", () => {
        modal.close()
    })

    const confirmButton = buttonContainer.createEl("button", {
        text: "Delete",
        cls: "draftist-button draftist-button-danger",
    })

    confirmButton.addEventListener("click", async () => {
        modal.close()

        const result = await deleteFileMetadata(app, file, siteAndModuleResult.data.module.kind)

        switch (result._) {
            case OK:
                Notice.info("Metadata deleted successfully")
                return
            case ERROR:
                log.error("Failed to delete metadata", result.error)
                Notice.error("Failed to delete metadata", { permanent: true })
                return
            default:
                result satisfies never
                return
        }
    })

    modal.open()
}

export async function deleteFileMetadata(
    app: Obsidian.App,
    file: Obsidian.TFile,
    moduleKind: Site.SiteModuleKind,
): Promise<Result<null, DeleteFileMetadataError[]>> {
    const frontmatterResult = await deleteFileFrontmatterMetadata(app, file)

    switch (frontmatterResult._) {
        case OK:
            break
        case ERROR:
            return Err([frontmatterResult.error])
        default:
            frontmatterResult satisfies never
    }

    const imageResult = await deleteFileImageMetadata(app, file, moduleKind)

    switch (imageResult._) {
        case OK:
            return Ok(null)
        case ERROR:
            return Err(imageResult.error)
        default:
            imageResult satisfies never
            return Ok(null)
    }
}

export async function deleteFileFrontmatterMetadata(
    app: Obsidian.App,
    file: Obsidian.TFile,
): Promise<Result<null, DeleteFileMetadataError>> {
    try {
        await app.fileManager.processFrontMatter(file, meta => {
            const frontmatter = meta as Record<string, any>
            TypedRecord.keys(frontmatter).forEach(key => {
                if (key.startsWith(FM.DFT_PREFIX)) {
                    delete frontmatter[key]
                }
            })
        })
        return Ok(null)
    } catch (error) {
        return Err({
            _: "FRONTMATTER_UPDATE_FAILED",
            error: new GenericError("Failed to delete Draftist frontmatter metadata", error),
        })
    }
}

export async function deleteFileImageMetadata(
    app: Obsidian.App,
    file: Obsidian.TFile,
    moduleKind: Site.SiteModuleKind,
): Promise<Result<null, DeleteFileMetadataError[]>> {
    const fileCache = app.metadataCache.getFileCache(file)
    if (!fileCache) return Ok(null)

    let assets: Image.ImageFile[]
    switch (moduleKind) {
        case "blog":
            assets = Post.collectAssets(app, file, fileCache)
            break
        case "docs":
            assets = Doc.collectAssets(app, file, fileCache)
            break
        default:
            moduleKind satisfies never
            throw new Error("unreachable")
    }

    const errors: DeleteFileMetadataError[] = []
    for (const asset of assets) {
        const metadataPath = Image.buildImageMetadataPath(asset.file)
        const metadataFile = app.vault.getAbstractFileByPath(metadataPath)
        if (!(metadataFile instanceof Obsidian.TFile)) continue

        try {
            await app.vault.delete(metadataFile)
            log.trace(`Deleted image metadata: ${metadataPath}`)
        } catch (error) {
            errors.push({
                _: "IMAGE_METADATA_DELETE_FAILED",
                path: metadataPath,
                error: new GenericError(`Failed to delete image metadata: ${metadataPath}`, error),
            })
        }
    }

    if (errors.length > 0) return Err(errors)

    return Ok(null)
}
