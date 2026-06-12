import * as Obsidian from "obsidian"

import type Plugin from "src/main"
import * as Site from "src/models/site"
import * as Post from "src/models/post"
import * as Doc from "src/models/doc"
import * as FM from "src/models/fm"
import * as PullPostMetadataRequest from "src/clients/requests/pull-post-metadata"
import * as PullDocMetadataRequest from "src/clients/requests/pull-doc-metadata"
import { deleteFileMetadata } from "src/commands/delete-metadata"
import * as Notice from "src/notice"
import { OK, ERROR } from "src/utils/result"
import * as log from "src/logger"

type SyncReason = "pending" | "focus" | "user-request"

export class MetadataSyncManager {
    private plugin: Plugin
    private pendingFileOpenEventRef: Obsidian.EventRef | null = null
    private focusFileOpenEventRef: Obsidian.EventRef | null = null
    private pendingWindowFocusHandler: (() => void) | null = null
    private focusWindowFocusHandler: (() => void) | null = null
    private pendingSyncs: Obsidian.TFile[] = []
    private runningSyncs = new Set<string>()

    constructor(plugin: Plugin) {
        this.plugin = plugin
    }

    register() {
        // Keep Draftist-managed notes fresh when the user returns to them.
        // Pending post-publish syncs take priority and are skipped here.
        if (this.focusFileOpenEventRef === null) {
            this.focusFileOpenEventRef = this.plugin.app.workspace.on("file-open", (file: Obsidian.TFile | null) => {
                if (file) this.syncOnFocus(file)
            })
            this.plugin.registerEvent(this.focusFileOpenEventRef)
        }

        if (this.focusWindowFocusHandler === null) {
            this.focusWindowFocusHandler = () => {
                const activeFile = this.plugin.app.workspace.getActiveFile()
                if (activeFile) this.syncOnFocus(activeFile)
            }
            this.plugin.registerDomEvent(window, "focus", this.focusWindowFocusHandler)
        }
    }

    registerPendingSync(file: Obsidian.TFile) {
        // Check if this file already has a pending sync and replace it.
        const existingIndex = this.pendingSyncs.findIndex(f => f.path === file.path)
        if (existingIndex !== -1) {
            this.pendingSyncs[existingIndex] = file
        } else {
            this.pendingSyncs.push(file)
        }

        // Register temporary post-publish listeners if not already registered.
        if (this.pendingFileOpenEventRef === null) {
            this.pendingFileOpenEventRef = this.plugin.app.workspace.on("file-open", (file: Obsidian.TFile | null) => {
                if (file) this.syncPending(file)
            })
            this.plugin.registerEvent(this.pendingFileOpenEventRef)
        }

        if (this.pendingWindowFocusHandler === null) {
            this.pendingWindowFocusHandler = () => {
                const activeFile = this.plugin.app.workspace.getActiveFile()
                if (activeFile) this.syncPending(activeFile)
            }
            this.plugin.registerDomEvent(window, "focus", this.pendingWindowFocusHandler)
        }

        log.debug("Registered pending sync", { file: file.path, totalPending: this.pendingSyncs.length })
    }

    async syncPending(file: Obsidian.TFile) {
        // Pending syncs are one-shot follow-ups after publishing a draft.
        const syncIndex = this.pendingSyncs.findIndex(f => f.path === file.path)
        if (syncIndex === -1) return
        if (this.isSyncRunning(file)) return

        log.debug("Found pending sync for file, syncing", { file: file.path })

        try {
            await this.syncFile(file, "pending")
        } finally {
            // Remove from pending syncs after an attempted pending sync.
            this.pendingSyncs.splice(syncIndex, 1)
            log.debug("Removed pending sync", { file: file.path, remainingPending: this.pendingSyncs.length })

            // If no more pending syncs, unregister temporary listeners.
            if (this.pendingSyncs.length === 0) {
                this.unregisterPendingEventListeners()
            }
        }
    }

    async syncOnFocus(file: Obsidian.TFile) {
        // The pending post-publish monitor owns its files; don't duplicate requests.
        if (this.hasPendingSync(file)) return
        if (this.isSyncRunning(file)) return
        if (!this.hasDraftistContentId(file)) return

        await this.syncFile(file, "focus")
    }

    async syncOnUserRequest(file: Obsidian.TFile) {
        // Manual sync should not race an in-flight request.
        if (this.isSyncRunning(file)) {
            Notice.warning("Draftist sync is already in progress for this note.")
            return
        }

        if (!this.hasDraftistContentId(file)) {
            Notice.warning("This note is not saved to Draftist yet. Publish it first.")
            return
        }

        // Manual sync consumes a pending post-publish sync to avoid a duplicate follow-up.
        this.removePendingSync(file)
        await this.syncFile(file, "user-request")
    }

    hasPendingSync(file: Obsidian.TFile): boolean {
        return this.pendingSyncs.some(f => f.path === file.path)
    }

    isSyncRunning(file: Obsidian.TFile): boolean {
        return this.runningSyncs.has(file.path)
    }

    private async syncFile(file: Obsidian.TFile, reason: SyncReason) {
        if (this.isSyncRunning(file)) return

        this.runningSyncs.add(file.path)
        try {
            // Get site and module to determine sync type.
            const siteAndModuleResult = Site.getSiteAndModuleForFile(file)

            switch (siteAndModuleResult._) {
                case OK: {
                    const { site, module } = siteAndModuleResult.data

                    // Sync based on module kind.
                    switch (module.kind) {
                        case "blog": {
                            await this.pullBlogPostMetadata(file, site.config.id)
                            break
                        }
                        case "docs": {
                            await this.pullDocPageMetadata(file, site.config.id)
                            break
                        }
                        default:
                            module.kind satisfies never
                    }
                    break
                }
                case ERROR: {
                    log.error("Failed to get site and module for metadata sync", {
                        file: file.path,
                        reason,
                        error: siteAndModuleResult.error,
                    })
                    break
                }
                default:
                    siteAndModuleResult satisfies never
            }
        } finally {
            this.runningSyncs.delete(file.path)
        }
    }

    private async pullBlogPostMetadata(file: Obsidian.TFile, siteId: Site.SiteId) {
        try {
            const frontmatter = Post.getFrontmatter(this.plugin.app, file)
            const postId = frontmatter?.[FM.DFT_CONTENT_ID]

            if (!postId) {
                log.error("Cannot pull blog post metadata: missing post ID in frontmatter", { file: file.path })
                return
            }

            const result = await PullPostMetadataRequest.send(siteId, postId)

            switch (result._) {
                case OK: {
                    const data = result.data
                    const statusChanged = data.status != null && data.status !== frontmatter?.status
                    const postedOnAutoAssigned = !frontmatter?.["posted on"] ? data.postedOnAutoAssigned : null
                    const contentKindChanged = frontmatter?.[FM.DFT_CONTENT_KIND] !== "BlogPost"

                    if (statusChanged || postedOnAutoAssigned || contentKindChanged) {
                        await Post.updateFrontmatter(this.plugin.app, file, meta => {
                            if (statusChanged) meta["status"] = data.status
                            if (postedOnAutoAssigned) meta["posted on"] = postedOnAutoAssigned
                            if (contentKindChanged) meta[FM.DFT_CONTENT_KIND] = "BlogPost"
                        })
                        log.debug("Pulled blog post metadata", {
                            file: file.path,
                            ...(statusChanged && { status: data.status }),
                            ...(postedOnAutoAssigned && { postedOn: postedOnAutoAssigned }),
                            ...(contentKindChanged && { contentKind: "BlogPost" }),
                        })
                    } else {
                        log.debug("No metadata changes detected for blog post")
                    }
                    break
                }
                case ERROR: {
                    switch (result.error._) {
                        case "API_USER_ERROR": {
                            switch (result.error.error) {
                                case "NotFound": {
                                    const deletionResult = await deleteFileMetadata(this.plugin.app, file, "blog")
                                    switch (deletionResult._) {
                                        case OK:
                                            await Post.updateFrontmatter(this.plugin.app, file, meta => {
                                                meta.status = "Deleted"
                                            })
                                            log.debug("Deleted Draftist metadata for missing blog post", {
                                                file: file.path,
                                            })
                                            Notice.info(
                                                "Draftist metadata deleted because this post no longer exists on Draftist.",
                                            )
                                            return
                                        case ERROR:
                                            log.error("Failed to delete Draftist metadata for missing blog post", {
                                                file: file.path,
                                                error: deletionResult.error,
                                            })
                                            Notice.error("Failed to delete Draftist metadata", { permanent: true })
                                            return
                                        default:
                                            deletionResult satisfies never
                                            return
                                    }
                                }
                            }
                        }
                        case "MISSING_API_TOKEN":
                        case "API_AUTH_ERROR":
                        case "CLIENT_OUTDATED":
                        case "MAINTENANCE":
                        case "API_SERVER_ERROR":
                        case "API_UNEXPECTED_ERROR":
                            log.error("Failed to pull blog post metadata", { error: result.error })
                            break
                        default:
                            result.error satisfies never
                    }
                    break
                }
                default:
                    result satisfies never
            }
        } catch (error) {
            log.error("Unexpected error while pulling blog post metadata", error)
        }
    }

    private async pullDocPageMetadata(file: Obsidian.TFile, siteId: Site.SiteId) {
        try {
            const frontmatter = Doc.getFrontmatter(this.plugin.app, file)
            const pageId = frontmatter?.[FM.DFT_CONTENT_ID]

            if (!pageId) {
                log.error("Cannot pull doc page metadata: missing page ID in frontmatter", { file: file.path })
                return
            }

            const result = await PullDocMetadataRequest.send(siteId, pageId)

            switch (result._) {
                case OK: {
                    const data = result.data
                    const statusChanged = data.status != null && data.status !== frontmatter?.status
                    const postedOnAutoAssigned = !frontmatter?.["posted on"] ? data.postedOnAutoAssigned : null
                    const contentKindChanged = frontmatter?.[FM.DFT_CONTENT_KIND] !== "DocPage"

                    if (statusChanged || postedOnAutoAssigned || contentKindChanged) {
                        await Doc.updateFrontmatter(this.plugin.app, file, meta => {
                            if (statusChanged) meta["status"] = data.status
                            if (postedOnAutoAssigned) meta["posted on"] = postedOnAutoAssigned
                            if (contentKindChanged) meta[FM.DFT_CONTENT_KIND] = "DocPage"
                        })
                        log.debug("Pulled doc page metadata", {
                            file: file.path,
                            ...(statusChanged && { status: data.status }),
                            ...(postedOnAutoAssigned && { postedOn: postedOnAutoAssigned }),
                            ...(contentKindChanged && { contentKind: "DocPage" }),
                        })
                    } else {
                        log.debug("No metadata changes detected for doc page")
                    }
                    break
                }
                case ERROR: {
                    switch (result.error._) {
                        case "API_USER_ERROR": {
                            switch (result.error.error) {
                                case "NotFound": {
                                    const deletionResult = await deleteFileMetadata(this.plugin.app, file, "docs")
                                    switch (deletionResult._) {
                                        case OK:
                                            await Doc.updateFrontmatter(this.plugin.app, file, meta => {
                                                meta.status = "Deleted"
                                            })
                                            log.debug("Deleted Draftist metadata for missing doc page", {
                                                file: file.path,
                                            })
                                            Notice.info(
                                                "Draftist metadata deleted because this page no longer exists on Draftist.",
                                            )
                                            return
                                        case ERROR:
                                            log.error("Failed to delete Draftist metadata for missing doc page", {
                                                file: file.path,
                                                error: deletionResult.error,
                                            })
                                            Notice.error("Failed to delete Draftist metadata", { permanent: true })
                                            return
                                        default:
                                            deletionResult satisfies never
                                            return
                                    }
                                }
                            }
                        }
                        case "MISSING_API_TOKEN":
                        case "API_AUTH_ERROR":
                        case "CLIENT_OUTDATED":
                        case "MAINTENANCE":
                        case "API_SERVER_ERROR":
                        case "API_UNEXPECTED_ERROR":
                            log.error("Failed to pull doc page metadata", { error: result.error })
                            break
                        default:
                            result.error satisfies never
                    }
                    break
                }
                default:
                    result satisfies never
            }
        } catch (error) {
            log.error("Unexpected error while pulling doc page metadata", error)
        }
    }

    private hasDraftistContentId(file: Obsidian.TFile): boolean {
        const frontmatter = FM.getFrontmatter<Record<string, unknown>>(this.plugin.app, file)
        return !!frontmatter?.[FM.DFT_CONTENT_ID]
    }

    private removePendingSync(file: Obsidian.TFile) {
        const syncIndex = this.pendingSyncs.findIndex(f => f.path === file.path)
        if (syncIndex === -1) return

        this.pendingSyncs.splice(syncIndex, 1)
        log.debug("Removed pending sync", { file: file.path, remainingPending: this.pendingSyncs.length })

        if (this.pendingSyncs.length === 0) {
            this.unregisterPendingEventListeners()
        }
    }

    private unregisterPendingEventListeners() {
        if (this.pendingFileOpenEventRef !== null) {
            this.plugin.app.workspace.offref(this.pendingFileOpenEventRef)
            this.pendingFileOpenEventRef = null
        }
        if (this.pendingWindowFocusHandler !== null) {
            window.removeEventListener("focus", this.pendingWindowFocusHandler)
            this.pendingWindowFocusHandler = null
        }
        log.debug("Unregistered pending syncs event listeners")
    }

    private unregisterFocusEventListeners() {
        if (this.focusFileOpenEventRef !== null) {
            this.plugin.app.workspace.offref(this.focusFileOpenEventRef)
            this.focusFileOpenEventRef = null
        }
        if (this.focusWindowFocusHandler !== null) {
            window.removeEventListener("focus", this.focusWindowFocusHandler)
            this.focusWindowFocusHandler = null
        }
        log.debug("Unregistered focus sync event listeners")
    }

    dispose() {
        this.unregisterPendingEventListeners()
        this.unregisterFocusEventListeners()
        this.pendingSyncs = []
        this.runningSyncs.clear()
        log.debug("Disposed metadata sync manager")
    }
}
