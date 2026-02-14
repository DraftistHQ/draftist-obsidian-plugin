import * as Obsidian from "obsidian"

import type Plugin from "src/main"
import * as Config from "src/config"
import * as Content from "src/models/content"
import * as Post from "src/models/post"
import * as Site from "src/models/site"
import * as Notice from "src/notice"
import * as FieldError from "src/ui/field-error"
import { OK, ERROR } from "src/utils/result"
import * as Timer from "src/utils/timer"
import * as log from "src/logger"

// --- Modal

type FormState = {
    siteId: Site.SiteId | null
    status: Post.PostPrepublishedStatus
    title: string
    description: string
}

type CreateBlogPostOptions = {
    defaultStatus: Post.PostPrepublishedStatus
    prefilledSiteId?: Site.SiteId
}

export class CreateBlogPostModal extends Obsidian.Modal {
    private formState: FormState
    private sites: Config.SiteSettings[]
    private titleInputEl: HTMLInputElement | null = null
    private titleErrorEl: HTMLElement | null = null
    private siteDropdownEl: HTMLSelectElement | null = null
    private siteErrorEl: HTMLElement | null = null

    constructor(plugin: Plugin, options: CreateBlogPostOptions) {
        super(plugin.app)

        // Load enabled sites with blog modules
        this.sites = Site.sitesWithModule("blog")

        // Initialize form state
        this.formState = {
            siteId: options.prefilledSiteId ?? (this.sites.length === 1 ? this.sites[0].config.id : null),
            status: options.defaultStatus,
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

        // Site select
        if (this.sites.length > 1) {
            let defaultSiteId: Site.SiteId | null = !this.formState.siteId
                ? this.sites.find(site => site.default)?.config.id || this.sites[0]?.config.id
                : null

            const siteSetting = new Obsidian.Setting(contentEl)
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
                        this.clearSiteError()
                    })
                    this.siteDropdownEl = dropdown.selectEl
                })
            this.siteErrorEl = FieldError.createErrorEl(siteSetting.infoEl)
        }

        // Status select
        new Obsidian.Setting(contentEl)
            .setName("Status")
            .setDesc("Initial status for the blog post")
            .addDropdown(dropdown =>
                dropdown
                    .addOption(Post.PostStatusIdea.value, Post.PostStatusIdea.value)
                    .addOption(Content.ContentStatusDraft.value, Content.ContentStatusDraft.value)
                    .setValue(this.formState.status)
                    .onChange(value => {
                        this.formState.status = value as Post.PostPrepublishedStatus
                    }),
            )

        // Title input
        const titleSetting = new Obsidian.Setting(contentEl)
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

                this.titleInputEl = text.inputEl

                Timer.onNextTick(() => text.inputEl.focus())
            })
        this.titleErrorEl = FieldError.createErrorEl(titleSetting.infoEl)

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

    showSiteError(message: string) {
        if (this.siteErrorEl) {
            FieldError.show(this.siteDropdownEl, this.siteErrorEl, message)
        }
    }

    clearSiteError() {
        if (this.siteErrorEl) {
            FieldError.clear(this.siteDropdownEl, this.siteErrorEl)
        }
    }

    showTitleError(message: string) {
        if (this.titleInputEl && this.titleErrorEl) {
            FieldError.show(this.titleInputEl, this.titleErrorEl, message)
        }
    }

    clearTitleError() {
        if (this.titleInputEl && this.titleErrorEl) {
            FieldError.clear(this.titleInputEl, this.titleErrorEl)
        }
    }

    async handleCreate() {
        if (!this.formState.siteId) {
            this.showSiteError("Please select a site")
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

// --- Context Menu

export function registerFileMenuEventHandler(plugin: Plugin): void {
    plugin.registerEvent(
        plugin.app.workspace.on("file-menu", (menu: Obsidian.Menu, file: Obsidian.TAbstractFile) => {
            if (!Config.Store.onboarded()) return

            const result =
                file instanceof Obsidian.TFile
                    ? Site.getSiteAndModuleForFile(file)
                    : Site.getSiteAndModuleForFolder(file as Obsidian.TFolder)

            if (result._ === ERROR) return

            const { site, module } = result.data
            if (module.kind !== "blog") return

            menu.addSeparator()

            menu.addItem(item => item.setTitle(`Draft42: ${module.name}`).setIsLabel(true))

            menu.addItem(item =>
                item
                    .setTitle("Add post idea")
                    .setIcon("lightbulb")
                    .onClick(() => {
                        new CreateBlogPostModal(plugin, {
                            defaultStatus: "Idea",
                            prefilledSiteId: site.config.id,
                        }).open()
                    }),
            )

            menu.addItem(item =>
                item
                    .setTitle("Add post draft")
                    .setIcon("file-plus")
                    .onClick(() => {
                        new CreateBlogPostModal(plugin, {
                            defaultStatus: "Draft",
                            prefilledSiteId: site.config.id,
                        }).open()
                    }),
            )
        }),
    )
}
