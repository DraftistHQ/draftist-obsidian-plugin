import * as Obsidian from "obsidian"

import type Plugin from "src/main"
import { Commands } from "src/commands"
import * as Config from "src/config"
import * as Post from "src/models/post"
import * as FM from "src/models/fm"
import * as Image from "src/models/image"
import * as Notice from "src/notice"
import { OK, ERROR } from "src/utils/result"
import * as log from "src/logger"

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
                deleteMetadata(plugin.app)
            }
            return true
        },
    })
}

function deleteMetadata(app: Obsidian.App): void {
    const file = app.workspace.getActiveFile()

    if (!file) {
        Notice.warning("No active file. Open a file and try again.")
        return
    }

    const modal = new Obsidian.Modal(app)

    modal.titleEl.setText("Delete Draft42 metadata")

    modal.contentEl.createEl("p", {
        text: "It will delete all Draft42-related meta entries from frontmatter and image metadata files.",
    })
    modal.contentEl.createEl("p", {
        text: "This action cannot be undone.",
    })

    const buttonContainer = modal.contentEl.createDiv({ cls: "d42-alert-buttons" })

    const cancelButton = buttonContainer.createEl("button", {
        text: "Cancel",
        cls: "d42-button d42-button-secondary",
    })
    cancelButton.addEventListener("click", () => {
        modal.close()
    })

    const confirmButton = buttonContainer.createEl("button", {
        text: "Delete",
        cls: "d42-button d42-button-danger",
    })

    confirmButton.addEventListener("click", async () => {
        modal.close()

        // Delete frontmatter metadata
        const result = await Post.updateFrontmatter(app, file, meta => {
            Object.keys(meta).forEach(key => {
                if (key.startsWith(FM.D42_PREFIX)) {
                    delete (meta as Record<string, any>)[key]
                }
            })
        })

        switch (result._) {
            case OK: {
                // Delete image metadata files
                const fileCache = app.metadataCache.getFileCache(file)
                if (fileCache) {
                    const assets = Post.collectAssets(app, file, fileCache)

                    for (const asset of assets) {
                        const metadataPath = Image.buildImageMetadataPath(asset.file)
                        const metadataFile = app.vault.getAbstractFileByPath(metadataPath)
                        if (metadataFile instanceof Obsidian.TFile) {
                            try {
                                await app.vault.delete(metadataFile)
                                log.trace(`Deleted image metadata: ${metadataPath}`)
                            } catch (error) {
                                log.error(`Failed to delete image metadata: ${metadataPath}`, error)
                                Notice.error(`Failed to delete image metadata: ${metadataPath}`, { permanent: true })
                            }
                        }
                    }
                }

                Notice.info("Metadata deleted successfully")
                return
            }
            case ERROR: {
                Notice.error("Failed to delete metadata", { permanent: true })
                return
            }
            default: {
                result satisfies never
                return
            }
        }
    })

    modal.open()
}
