import * as Obsidian from "obsidian"

import * as Config from "src/config"
import * as Doc from "src/models/doc"
import * as Post from "src/models/post"
import * as Site from "src/models/site"
import * as Image from "src/models/image"
import * as Notice from "src/notice"
import * as Timer from "src/utils/timer"
import { OK, ERROR } from "src/utils/result"
import * as log from "src/logger"
import * as BlogPost from "./blog-post"
import * as DocPage from "./doc-page"

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
                } else if (file instanceof Obsidian.TFolder) {
                    Timer.onNextTick(() => {
                        this.handleFolderRename(file, prevLocation)
                    })
                } else {
                    log.trace("Unknown file type. Ignoring.")
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
                } else if (file instanceof Obsidian.TFolder) {
                    Timer.onNextTick(() => {
                        this.handleFolderDelete(file)
                    })
                } else {
                    log.trace("Unknown file type. Ignoring.")
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

    private async handleFolderRename(folder: Obsidian.TFolder, prevLocation: string): Promise<void> {
        try {
            const result = Site.getSiteAndModuleForFolder(folder)
            if (result._ === ERROR) {
                log.trace("Folder doesn't belong to any site. Ignoring.")
                return
            }

            const { site, module } = result.data

            // Find the single markdown file in folder
            const mdFiles = folder.children.filter(
                child => child instanceof Obsidian.TFile && child.extension === "md",
            ) as Obsidian.TFile[]

            if (mdFiles.length === 0) {
                log.trace("No markdown file in folder. Ignoring.")
                return
            }

            if (mdFiles.length > 1) {
                log.warn(`Multiple markdown files in folder: ${folder.path}`)
                Notice.warning(`Folder "${folder.name}" has multiple notes. Keep only one.`)
                return
            }

            const mdFile = mdFiles[0]

            switch (module.kind) {
                case "blog":
                    await this.syncBlogPostFolderRename(folder, mdFile)
                    break
                case "docs":
                    await this.syncDocPageFolderRename(folder, mdFile)
                    break
                default:
                    module.kind satisfies never
            }
        } catch (error) {
            log.error("Failed to handle folder rename", error)
        }
    }

    // Blog folder format: "YYYY-MM-DD - Title" or "Title"
    private async syncBlogPostFolderRename(folder: Obsidian.TFolder, mdFile: Obsidian.TFile): Promise<void> {
        const dateMatch = folder.name.match(/^(\d{4}-\d{2}-\d{2})\s*[-–—]\s*(.*)/)
        const folderDate = dateMatch ? dateMatch[1] : null
        const folderTitle = dateMatch ? dateMatch[2] : folder.name

        // Sync posted on → frontmatter
        const frontmatter = Post.getFrontmatter(this.app, mdFile)
        const currentPostedOn = frontmatter?.["posted on"] ?? null
        // Normalize current posted on to date-only for comparison with folder date
        const currentDate = currentPostedOn ? Obsidian.moment(currentPostedOn).format("YYYY-MM-DD") : null

        if (currentDate !== folderDate) {
            await Post.updateFrontmatter(this.app, mdFile, meta => {
                meta["posted on"] = folderDate
            })
        }

        // Sync title → note basename
        await this.syncNoteBasename(folder, mdFile, folderTitle)
    }

    // Doc folder format: "01 - Title" or "Title"
    private async syncDocPageFolderRename(folder: Obsidian.TFolder, mdFile: Obsidian.TFile): Promise<void> {
        const folderTitle = Doc.extractTitleFromFolderName(folder.name) ?? folder.name
        await this.syncNoteBasename(folder, mdFile, folderTitle)
    }

    private async syncNoteBasename(folder: Obsidian.TFolder, mdFile: Obsidian.TFile, folderTitle: string): Promise<void> {
        if (mdFile.basename === folderTitle) return

        const newFilePath = `${folder.path}/${folderTitle}.md`
        const conflict = await this.app.vault.adapter.exists(newFilePath)
        if (conflict) {
            log.warn(`Cannot rename note: ${newFilePath} already exists`)
            Notice.warning(`Cannot rename note to "${folderTitle}.md" - file already exists`)
            return
        }

        await this.app.fileManager.renameFile(mdFile, newFilePath)
        Notice.info(`Note renamed to "${folderTitle}.md"`)
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

    private async handleFolderDelete(folder: Obsidian.TFolder): Promise<void> {
        try {
            // Extract parent path from the deleted folder's path
            const lastSlash = folder.path.lastIndexOf("/")
            if (lastSlash === -1) {
                log.trace("Folder is at root. Ignoring.")
                return
            }

            const parentPath = folder.path.substring(0, lastSlash)
            const parentFolder = this.app.vault.getAbstractFileByPath(parentPath)

            if (!(parentFolder instanceof Obsidian.TFolder)) {
                log.trace("Parent folder not found. Ignoring.")
                return
            }

            // Check if parent belongs to a docs module
            const result = Site.getSiteAndModuleForFolder(parentFolder)
            if (result._ === ERROR) {
                log.trace("Parent folder doesn't belong to any site. Ignoring.")
                return
            }

            const { module } = result.data
            if (module.kind !== "docs") {
                log.trace("Not a docs module. Ignoring.")
                return
            }

            // Handle doc page folder deletion (renumber siblings)
            await DocPage.handleDocPageFolderDelete(this.app, folder.name, parentFolder)
        } catch (error) {
            log.error("Failed to handle folder delete", error)
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
                    const changeData = DocPage.detectDocPageChange(file, cache, site, module)
                    if (changeData) {
                        await DocPage.handleDocPageChange(this.app, changeData, site, module)
                    }
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
