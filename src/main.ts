import * as Obsidian from "obsidian"
import * as _ from "lodash"

import * as Config from "src/config"
import * as Notice from "src/notice"
import { Commands } from "src/commands"
import { SettingTab } from "src/settings"
import { Styles } from "src/styles"
import { FileTreeManager } from "src/automations/file-tree-manager"
import { PendingSyncsManager } from "src/automations/pending-syncs-manager"
import { PublishingModal } from "src/commands/publish-entry"
import { CreateBlogPostModal } from "src/commands/create-blog-post"
import { SetCoverImageModal } from "src/commands/set-cover-image"
import * as InsertImageCmd from "src/commands/insert-image"
import * as InsertGalleryCmd from "src/commands/insert-gallery"
import * as NormalizeImagesCmd from "src/commands/normalize-images"
import * as NormalizeFrontmatterCmd from "src/commands/normalize-frontmatter"
import * as DeleteMetadataCmd from "src/commands/delete-metadata"
import * as CopyDebugInfoCmd from "src/commands/copy-debug-info"

export default class Draft42 extends Obsidian.Plugin {
    // @ts-expect-error
    styles: Styles
    // @ts-expect-error
    publishingModals: PublishingModals
    // @ts-expect-error
    fileTreeManager: FileTreeManager
    // @ts-expect-error
    pendingSyncsManager: PendingSyncsManager

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

        // Register commands

        this.addCommand({
            ...Commands.PUBLISH_ENTRY,
            callback: () => {
                let file = this.app.workspace.getActiveFile()

                if (!file) {
                    Notice.warning("No active file to publish. Open a file you want to publish and try again.")
                    return
                }

                this.publishingModals.open(file)
            },
        })

        this.addCommand({
            ...Commands.CREATE_BLOG_POST_IDEA,
            callback: () => {
                if (!Config.Store.onboarded()) {
                    Notice.warning("Please complete plugin setup first. Open Draft42 settings.")
                    return
                }
                new CreateBlogPostModal(this, "Idea").open()
            },
        })

        this.addCommand({
            ...Commands.CREATE_BLOG_POST_DRAFT,
            callback: () => {
                if (!Config.Store.onboarded()) {
                    Notice.warning("Please complete plugin setup first. Open Draft42 settings.")
                    return
                }
                new CreateBlogPostModal(this, "Draft").open()
            },
        })

        this.addCommand({
            ...Commands.INSERT_IMAGE,
            callback: () => InsertImageCmd.run(this.app),
        })

        this.addCommand({
            ...Commands.INSERT_GALLERY,
            callback: () => InsertGalleryCmd.run(this.app),
        })

        this.addCommand({
            ...Commands.NORMALIZE_IMAGES,
            callback: () => NormalizeImagesCmd.run(this.app),
        })

        this.addCommand({
            ...Commands.SET_COVER_IMAGE,
            callback: () => {
                const file = this.app.workspace.getActiveFile()
                if (!file) {
                    Notice.warning("No active file")
                    return
                }
                new SetCoverImageModal(this, file).open()
            },
        })

        this.addCommand({
            ...Commands.NORMALIZE_FRONTMATTER,
            callback: () => NormalizeFrontmatterCmd.run(this.app),
        })

        this.addCommand({
            ...Commands.COPY_DEBUG_INFO,
            callback: () => CopyDebugInfoCmd.run(),
        })

        this.registerDeleteD42MetadataCommand()

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

    registerDeleteD42MetadataCommand() {
        if (Config.Store.target() === "local" && Config.Store.debugging().exposeInternalMetadata) {
            this.addCommand({
                ...Commands.DELETE_META_ENTRIES,
                callback: () => DeleteMetadataCmd.run(this.app),
            })
        }
    }

    disposeDeleteD42MetadataCommand() {
        this.removeCommand(Commands.DELETE_META_ENTRIES.id)
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
