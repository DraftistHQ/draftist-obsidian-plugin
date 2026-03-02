import * as Obsidian from "obsidian"

import * as Config from "src/config"
import { SettingTab } from "src/settings"
import { Styles } from "src/styles"
import { FileTreeManager } from "src/automations/file-tree-manager"
import { PendingSyncsManager } from "src/automations/pending-syncs-manager"
import * as PublishEntryCmd from "src/commands/publish-entry"
import { PublishingModal } from "src/commands/publish-entry"
import * as CreateBlogPostCmd from "src/commands/create-blog-post"
import type { CreateBlogPostInput } from "src/commands/create-blog-post"
import * as CreateDocPageCmd from "src/commands/create-doc-page"
import type { CreateDocPageInput } from "src/commands/create-doc-page"
import * as MoveDocPageCmd from "src/commands/move-doc-page"
import * as SetCoverImageCmd from "src/commands/set-cover-image"
import * as InsertImageCmd from "src/commands/insert-image"
import * as InsertGalleryCmd from "src/commands/insert-gallery"
import * as NormalizeImagesCmd from "src/commands/normalize-images"
import * as NormalizeFrontmatterCmd from "src/commands/normalize-frontmatter"
import * as DeleteMetadataCmd from "src/commands/delete-metadata"
import * as CopyDebugInfoCmd from "src/commands/copy-debug-info"
import * as OnboardCmd from "src/commands/onboard"
import type { OnboardInput } from "src/commands/onboard"

export default class Draft42 extends Obsidian.Plugin {
    // @ts-expect-error
    styles: Styles
    // @ts-expect-error
    publishingModals: PublishingModals
    // @ts-expect-error
    fileTreeManager: FileTreeManager
    // @ts-expect-error
    pendingSyncsManager: PendingSyncsManager

    headless: {
        onboard?: (input: OnboardInput) => Promise<void>
        createBlogPost?: (input: CreateBlogPostInput) => Promise<{ path: string }>
        createDocPage?: (input: CreateDocPageInput) => Promise<{ path: string }>
    } = {}

    async onload() {
        await Config.Store.init(this)

        this.styles = new Styles()
        this.publishingModals = new PublishingModals(this)
        this.fileTreeManager = new FileTreeManager(this)
        this.pendingSyncsManager = new PendingSyncsManager(this)

        // Handle styling
        let file = this.app.workspace.getActiveFile()
        this.applyStyling(file)

        this.registerEvent(
            this.app.workspace.on("file-open", (file: Obsidian.TFile | null) => {
                this.applyStyling(file)
            }),
        )

        // Register file tree manager if enabled
        this.fileTreeManager.register()

        // Register file menu handlers
        CreateBlogPostCmd.registerFileMenuEventHandler(this)
        CreateDocPageCmd.registerFileMenuEventHandler(this)
        MoveDocPageCmd.registerFileMenuEventHandler(this)

        // Register commands
        PublishEntryCmd.registerCommand(this)
        CreateBlogPostCmd.registerCommands(this)
        CreateDocPageCmd.registerCommand(this)
        MoveDocPageCmd.registerCommands(this)
        InsertImageCmd.registerCommand(this)
        InsertGalleryCmd.registerCommand(this)
        NormalizeImagesCmd.registerCommand(this)
        SetCoverImageCmd.registerCommand(this)
        NormalizeFrontmatterCmd.registerCommand(this)
        CopyDebugInfoCmd.registerCommand(this)
        DeleteMetadataCmd.registerCommand(this)
        OnboardCmd.registerCommand(this)

        this.addSettingTab(new SettingTab(this))
    }

    onunload() {
        this.publishingModals.disposeAll()
        this.styles.disposeAll()
        this.fileTreeManager.dispose()
        this.pendingSyncsManager.dispose()
        Config.Store.dispose()
    }

    applyStyling(file: Obsidian.TFile | null) {
        if (file) {
            this.styles.injectBlockIdCss(file)
            this.styles.injectInternalFrontmatterCss()
        }
    }
}

class PublishingModals {
    plugin: Draft42

    // Obsidian maintains a single TFile intance for a given file,
    // so it's fine using it as a key here
    entries: Map<Obsidian.TFile, PublishingModal>

    constructor(plugin: Draft42) {
        this.plugin = plugin
        this.entries = new Map()
    }

    open(file: Obsidian.TFile) {
        let existingModal = this.entries.get(file)

        if (existingModal) {
            existingModal.open()
            return
        }

        let newModal = new PublishingModal(this.plugin, file)

        this.entries.set(file, newModal)

        newModal.open()
    }

    dispose(file: Obsidian.TFile) {
        this.entries.delete(file)
    }

    disposeAll() {
        this.entries.forEach(modal => modal.close())
        this.entries.clear()
    }
}
