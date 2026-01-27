import * as Obsidian from "obsidian"

import * as Config from "src/config"
import * as Site from "src/models/site"
import * as Image from "src/models/image"
import * as Timer from "src/utils/timer"
import { OK, ERROR } from "src/utils/result"
import * as log from "src/logger"
import * as BlogPost from "./blog-post"

export class FileTreeManager {
    private app: Obsidian.App
    private plugin: Obsidian.Plugin
    private metadataEventRef: Obsidian.EventRef | null = null
    private renameEventRef: Obsidian.EventRef | null = null
    private deleteEventRef: Obsidian.EventRef | null = null

    constructor(plugin: Obsidian.Plugin) {
        this.app = plugin.app
        this.plugin = plugin
    }

    register(): void {
        if (!Config.Store.automations().manageFileTrees) return

        if (!this.metadataEventRef) {
            this.metadataEventRef = this.app.metadataCache.on(
                "changed",
                (file: Obsidian.TFile, _data: string, cache: Obsidian.CachedMetadata) => {
                    log.trace(`Metadata changed at ${file.path}`, file)

                    const result = Site.getSiteAndModuleForFile(file)
                    if (result._ === ERROR) return

                    this.processFile(file, cache, result.data)
                },
            )
            this.plugin.registerEvent(this.metadataEventRef)
        }

        if (!this.renameEventRef) {
            this.renameEventRef = this.app.vault.on("rename", (file: Obsidian.TAbstractFile, prevLocation: string) => {
                log.trace("Rename event", { prevLocation, nextLocation: file.path })
                if (file instanceof Obsidian.TFile) {
                    Timer.onNextTick(() => {
                        this.handleFileRename(file, prevLocation)
                    })
                } else {
                    log.trace("Not a file. Ignoring.")
                }
            })
            this.plugin.registerEvent(this.renameEventRef)
        }

        if (!this.deleteEventRef) {
            this.deleteEventRef = this.app.vault.on("delete", (file: Obsidian.TAbstractFile) => {
                log.trace("Delete event", { path: file.path })
                if (file instanceof Obsidian.TFile) {
                    Timer.onNextTick(() => {
                        this.handleFileDelete(file)
                    })
                } else {
                    log.trace("Not a file. Ignoring.")
                }
            })
            this.plugin.registerEvent(this.deleteEventRef)
        }
    }

    dispose(): void {
        if (this.metadataEventRef) {
            this.app.metadataCache.offref(this.metadataEventRef)
            this.metadataEventRef = null
        }

        if (this.renameEventRef) {
            this.app.vault.offref(this.renameEventRef)
            this.renameEventRef = null
        }

        if (this.deleteEventRef) {
            this.app.vault.offref(this.deleteEventRef)
            this.deleteEventRef = null
        }
    }

    private async handleFileRename(file: Obsidian.TFile, prevLocation: string): Promise<void> {
        try {
            // Ignore if this is an image metadata file itself
            if (file.path.endsWith(`.${Image.METADATA_SUFFIX}`)) {
                log.trace("This is an image metadata file. Ignoring.")
                return
            }

            // Check wheither renamed item is a parent folder
            const prevParent = prevLocation.substring(0, prevLocation.lastIndexOf("/"))
            const nextParent = file.parent ? file.parent.path : ""
            if (prevParent !== nextParent) {
                log.trace("Parent folder rename. Ignoring.")
                return
            }

            // Check if this file has image metadata
            const oldMetadataPath = `${prevLocation}.${Image.METADATA_SUFFIX}`
            const metadataFile = this.app.vault.getAbstractFileByPath(oldMetadataPath)

            log.trace("Checking if image metadata file exists", { oldMetadataPath, metadataFile })

            if (metadataFile instanceof Obsidian.TFile) {
                const newMetadataPath = Image.buildImageMetadataPath(file)
                log.trace("Image metadata file exists. Renaming it.", { oldMetadataPath, newMetadataPath })
                await this.app.fileManager.renameFile(metadataFile, newMetadataPath)
                return
            } else {
                log.trace("No image metadata file found. Proceeding.")
            }

            if (file.extension !== "md") {
                log.trace("Not a markdown file. Ignoring.")
                return
            }

            const result = Site.getSiteAndModuleForFile(file)
            switch (result._) {
                case OK: {
                    log.trace("File belongs to a site. Proceeding.", result.data)
                    break
                }
                case ERROR: {
                    log.trace("File doesn't belong to any site. Ignoring.")
                    return
                }
                default: {
                    result satisfies never
                }
            }

            const cache = this.app.metadataCache.getFileCache(file)
            if (cache) {
                log.trace("File has cached metadata. Processing the file.")
                await this.processFile(file, cache, result.data)
            } else {
                log.warn("File has no cached metadata. Ignoring.")
            }
        } catch (error) {
            log.error("Failed to handle file rename", error)
        }
    }

    private async handleFileDelete(file: Obsidian.TFile): Promise<void> {
        try {
            // Ignore if this is an image metadata file itself
            if (file.path.endsWith(`.${Image.METADATA_SUFFIX}`)) {
                log.trace("This is an image metadata file. Ignoring.")
                return
            }

            // Check if this file has image metadata
            const metadataPath = Image.buildImageMetadataPath(file)
            const metadataFile = this.app.vault.getAbstractFileByPath(metadataPath)

            log.trace("Checking if image metadata file exists", { metadataPath, metadataFile })

            if (metadataFile instanceof Obsidian.TFile) {
                log.trace("Image metadata file exists. Deleting it.", { metadataPath })
                await this.app.vault.delete(metadataFile)
            }
        } catch (error) {
            log.error("Failed to handle file delete", error)
        }
    }

    private async processFile(
        file: Obsidian.TFile,
        cache: Obsidian.CachedMetadata,
        siteAndModule: Site.SiteAndModule,
    ): Promise<void> {
        try {
            const { site, module } = siteAndModule

            switch (module.kind) {
                case "blog": {
                    const changeData = BlogPost.detectBlogPostChange(file, cache, site, module)
                    if (changeData) {
                        await BlogPost.handleBlogPostChange(this.app, changeData, site, module)
                    }
                    break
                }

                case "docs": {
                    break
                }

                default: {
                    module.kind satisfies never
                }
            }
        } catch (error) {
            log.error("Failed to process file tree event", error)
        }
    }
}
