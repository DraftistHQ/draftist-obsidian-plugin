import * as Obsidian from "obsidian"

import type Plugin from "src/main"
import * as Site from "src/models/site"
import * as Post from "src/models/post"
import * as GetPostStatusRequest from "src/clients/requests/get-post-status"
import { OK, ERROR } from "src/utils/result"
import * as log from "src/logger"

export class PendingSyncsManager {
    private plugin: Plugin
    private fileOpenEventRef: Obsidian.EventRef | null = null
    private windowFocusHandler: (() => void) | null = null
    private pendingSyncs: Obsidian.TFile[] = []

    constructor(plugin: Plugin) {
        this.plugin = plugin
    }

    registerPendingSync(file: Obsidian.TFile) {
        // Check if this file already has a pending sync and replace it
        const existingIndex = this.pendingSyncs.findIndex(f => f.path === file.path)
        if (existingIndex !== -1) {
            this.pendingSyncs[existingIndex] = file
        } else {
            this.pendingSyncs.push(file)
        }

        // Register event listeners if not already registered
        if (this.fileOpenEventRef === null) {
            this.fileOpenEventRef = this.plugin.app.workspace.on("file-open", (file: Obsidian.TFile | null) => {
                if (file) this.syncFile(file)
            })
            this.plugin.registerEvent(this.fileOpenEventRef)
        }

        if (this.windowFocusHandler === null) {
            this.windowFocusHandler = () => {
                const activeFile = this.plugin.app.workspace.getActiveFile()
                if (activeFile) this.syncFile(activeFile)
            }
            this.plugin.registerDomEvent(window, "focus", this.windowFocusHandler)
        }

        log.debug("Registered pending sync", { file: file.path, totalPending: this.pendingSyncs.length })
    }

    private async syncFile(file: Obsidian.TFile) {
        // Find pending sync for this file
        const syncIndex = this.pendingSyncs.findIndex(f => f.path === file.path)
        if (syncIndex === -1) return

        log.debug("Found pending sync for file, syncing", { file: file.path })

        // Get site and module to determine sync type
        const siteAndModuleResult = Site.getSiteAndModuleForFile(file)

        switch (siteAndModuleResult._) {
            case OK: {
                const { site, module } = siteAndModuleResult.data

                // Sync based on module kind
                switch (module.kind) {
                    case "blog": {
                        await this.syncBlogPostStatus(file, site.config.id)
                        break
                    }
                    case "docs": {
                        log.debug("Doc status sync not yet implemented")
                        break
                    }
                    default:
                        module.kind satisfies never
                }
                break
            }
            case ERROR: {
                log.error("Failed to get site and module for pending sync", { error: siteAndModuleResult.error })
                break
            }
        }

        // Remove from pending syncs
        this.pendingSyncs.splice(syncIndex, 1)
        log.debug("Removed pending sync", { file: file.path, remainingPending: this.pendingSyncs.length })

        // If no more pending syncs, unregister event listeners
        if (this.pendingSyncs.length === 0) {
            this.unregisterEventListeners()
        }
    }

    private async syncBlogPostStatus(file: Obsidian.TFile, siteId: Site.SiteId) {
        try {
            // Get post ID from frontmatter
            const frontmatter = Post.getFrontmatter(this.plugin.app, file)
            const postId = frontmatter?.[Post.FM_D42_CONTENT_ID]

            if (!postId) {
                log.error("Cannot sync blog post status: missing post ID in frontmatter", { file: file.path })
                return
            }

            const result = await GetPostStatusRequest.send(siteId, postId)

            switch (result._) {
                case OK: {
                    // Sync status if server has a value
                    if (result.data.status) {
                        const currentLocalStatus = frontmatter?.status

                        if (result.data.status !== currentLocalStatus) {
                            await Post.updateFrontmatter(this.plugin.app, file, meta => {
                                meta["status"] = result.data.status
                            })
                            log.debug("Updated blog post status", {
                                file: file.path,
                                oldStatus: currentLocalStatus,
                                newStatus: result.data.status,
                            })
                        } else {
                            log.debug("No status changes detected for blog post")
                        }
                    }
                    break
                }
                case ERROR: {
                    log.error("Failed to fetch blog post status for sync", { error: result.error })
                    break
                }
            }
        } catch (error) {
            log.error("Unexpected error during blog post status sync", error)
        }
    }

    private unregisterEventListeners() {
        if (this.fileOpenEventRef !== null) {
            this.plugin.app.workspace.offref(this.fileOpenEventRef)
            this.fileOpenEventRef = null
        }
        if (this.windowFocusHandler !== null) {
            window.removeEventListener("focus", this.windowFocusHandler)
            this.windowFocusHandler = null
        }
        log.debug("Unregistered pending syncs event listeners")
    }

    dispose() {
        this.unregisterEventListeners()
        this.pendingSyncs = []
        log.debug("Disposed pending syncs manager")
    }
}
