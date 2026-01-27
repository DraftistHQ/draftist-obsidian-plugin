import * as Obsidian from "obsidian"

import type Plugin from "src/main"
import * as Config from "src/config"
import * as Post from "src/models/post"
import * as Site from "src/models/site"
import * as Notice from "src/notice"
import * as Record from "src/utils/record"
import { OK, ERROR } from "src/utils/result"
import * as Timer from "src/utils/timer"
import * as log from "src/logger"

type FormState = {
    siteId: Site.SiteId | null
    status: Post.PostPrepublishedStatus
    title: string
    description: string
}

export class CreateBlogPostModal extends Obsidian.Modal {
    private formState: FormState
    private sites: Config.SiteSettings[]
    private titleInputEl: HTMLInputElement | null = null

    constructor(plugin: Plugin, defaultStatus: Post.PostPrepublishedStatus) {
        super(plugin.app)

        // Load enabled sites with blog modules
        const sites = Config.Store.sites()
        this.sites = Record.values(sites).filter(
            site => site.enabled && !!site.path && site.config.modules.some(m => m.kind === "blog"),
        )

        // Initialize form state
        this.formState = {
            siteId: this.sites.length === 1 ? this.sites[0].config.id : null,
            status: defaultStatus,
            title: "",
            description: "",
        }
    }

    onOpen() {
        const { contentEl, titleEl } = this

        const modalWidth = "600px"
        const inputWidth = "300px"

        titleEl.setText("Create New Blog Post")

        this.modalEl.style.width = modalWidth

        if (this.sites.length === 0) {
            contentEl.createEl("p", {
                text: "No enabled sites with blog modules found. Please configure a site first in Draft42 plugin settings.",
                cls: "d42-alert-message d42-alert-message-warning",
            })
            new Obsidian.Setting(contentEl).addButton(btn => btn.setButtonText("Close").onClick(() => this.close()))
            return
        }

        // Site select
        if (this.sites.length > 1) {
            let defaultSiteId: Site.SiteId | null = !this.formState.siteId
                ? this.sites.find(site => site.default)?.config.id || this.sites[0]?.config.id
                : null

            new Obsidian.Setting(contentEl)
                .setName("Site")
                .setDesc("Select the site for this blog post")
                .addDropdown(dropdown => {
                    if (!this.formState.siteId && !defaultSiteId) {
                        dropdown.addOption("", "Select a site...")
                    }
                    this.sites.forEach(site => {
                        dropdown.addOption(site.config.id, site.config.label || site.config.addresses.primary)
                    })
                    dropdown.setValue(this.formState.siteId || defaultSiteId || "").onChange(value => {
                        this.formState.siteId = value as Site.SiteId
                    })
                })
        }

        // Status select
        new Obsidian.Setting(contentEl)
            .setName("Status")
            .setDesc("Initial status for the blog post")
            .addDropdown(dropdown =>
                dropdown
                    .addOption(Post.PostStatusIdea.value, Post.PostStatusIdea.value)
                    .addOption(Post.PostStatusDraft.value, Post.PostStatusDraft.value)
                    .setValue(this.formState.status)
                    .onChange(value => {
                        this.formState.status = value as Post.PostPrepublishedStatus
                    }),
            )

        // Title input
        new Obsidian.Setting(contentEl)
            .setName("Title")
            .setDesc("Blog post title")
            .addText(text => {
                text.setPlaceholder("Enter post title")
                    .setValue(this.formState.title)
                    .onChange(value => {
                        this.formState.title = value
                        this.clearTitleError()
                    })

                text.inputEl.style.width = inputWidth

                text.inputEl.addEventListener("keydown", this.handleKeyboardSubmission)

                // Store reference to input element
                this.titleInputEl = text.inputEl

                // Auto-focus title field
                Timer.onNextTick(() => text.inputEl.focus())
            })

        // Description field
        new Obsidian.Setting(contentEl)
            .setName("Description")
            .setDesc("Optional description for the blog post")
            .addText(text => {
                text.setPlaceholder("Optional description")
                    .setValue(this.formState.description)
                    .onChange(value => {
                        this.formState.description = value
                    })

                text.inputEl.style.width = inputWidth

                text.inputEl.addEventListener("keydown", this.handleKeyboardSubmission)
            })

        // Buttons
        new Obsidian.Setting(contentEl)
            .addButton(btn => btn.setButtonText("Cancel").onClick(() => this.close()))
            .addButton(btn =>
                btn
                    .setButtonText("Create")
                    .setCta()
                    .onClick(() => this.handleCreate()),
            )
    }

    handleKeyboardSubmission = async (event: KeyboardEvent) => {
        if (event.key === "Enter") {
            event.preventDefault()
            event.stopPropagation()
            this.handleCreate()
        }
    }

    showTitleError(message: string) {
        Notice.warning(message)
        if (this.titleInputEl) {
            this.titleInputEl.style.borderColor = "var(--text-error)"
        }
    }

    clearTitleError() {
        if (this.titleInputEl) {
            this.titleInputEl.style.borderColor = ""
        }
    }

    async handleCreate() {
        if (!this.formState.siteId) {
            Notice.warning("Please select a site")
            return
        }

        const trimmedTitle = this.formState.title.trim()
        if (!trimmedTitle) {
            this.showTitleError("Title is required")
            return
        }

        try {
            const file = await this.createBlogPost()
            this.close()

            // Open the file in editor
            const leaf = this.app.workspace.getLeaf(false)
            await leaf.openFile(file)
        } catch (error) {
            log.error("Failed to create blog post", error)
            Notice.error("Failed to create blog post", { permanent: true })
        }
    }

    async createBlogPost(): Promise<Obsidian.TFile> {
        const site = this.sites.find(s => s.config.id === this.formState.siteId)
        if (!site) {
            throw new Error("Site not found")
        }

        if (!site.path) {
            throw new Error("Site path not configured")
        }

        const blogModule = site.config.modules.find(m => m.kind === "blog")
        if (!blogModule) {
            throw new Error("Blog module not found for this site")
        }

        const title = this.formState.title.trim()
        const description = this.formState.description.trim()

        // Build path
        const siteFolderPath = Obsidian.normalizePath(site.path)
        const moduleFolderPath = Obsidian.normalizePath(`${siteFolderPath}/${blogModule.name}`)
        const statusFolderName = Post.getStatusFolderName(this.formState.status)
        const statusFolderPath = Obsidian.normalizePath(`${moduleFolderPath}/${statusFolderName}`)
        const postFolderPath = Obsidian.normalizePath(`${statusFolderPath}/${title}`)
        const postFilePath = Obsidian.normalizePath(`${postFolderPath}/${title}.md`)

        // Ensure directories exist
        await this.ensureFolder(moduleFolderPath)
        await this.ensureFolder(statusFolderPath)
        await this.ensureFolder(postFolderPath)

        // Create file with empty content first
        const file = await this.app.vault.create(postFilePath, "")

        // Add frontmatter
        const result = await Post.updateFrontmatter(this.app, file, frontmatter => {
            frontmatter.status = this.formState.status
            frontmatter.description = description || null
            frontmatter["posted on"] = ""
            frontmatter.tags = []
        })

        switch (result._) {
            case OK: {
                return file
            }
            case ERROR: {
                throw result.error
            }
        }
    }

    async ensureFolder(path: string): Promise<void> {
        const exists = await this.app.vault.adapter.exists(path)
        if (!exists) {
            await this.app.vault.createFolder(path)
        }
    }

    onClose() {
        const { contentEl } = this
        contentEl.empty()
    }
}
