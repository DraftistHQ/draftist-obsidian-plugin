import * as Obsidian from "obsidian"

import type Plugin from "src/main"
import { Commands } from "src/commands"
import * as Config from "src/config"
import * as Content from "src/models/content"
import * as Post from "src/models/post"
import * as Site from "src/models/site"
import * as Notice from "src/notice"
import * as FieldError from "src/ui/field-error"
import { type Result, Ok, Err, OK, ERROR } from "src/utils/result"
import * as Timer from "src/utils/timer"
import * as log from "src/logger"

// --- Action

export type CreateBlogPostInput = {
    siteId: Site.SiteId
    status: Post.PostPrepublishedStatus
    title: string
    description?: string
}

export type CreateBlogPostError =
    | { _: "SITE_NOT_FOUND" }
    | { _: "SITE_PATH_NOT_CONFIGURED" }
    | { _: "BLOG_MODULE_NOT_FOUND" }
    | { _: "TITLE_REQUIRED" }
    | { _: "FRONTMATTER_UPDATE_FAILED"; error: Error }

export async function createBlogPost(
    app: Obsidian.App,
    input: CreateBlogPostInput,
): Promise<Result<Obsidian.TFile, CreateBlogPostError>> {
    const title = input.title.trim()
    if (!title) {
        return Err({ _: "TITLE_REQUIRED" })
    }

    const sites = Site.sitesWithModule("blog")
    const site = sites.find(s => s.config.id === input.siteId)
    if (!site) {
        return Err({ _: "SITE_NOT_FOUND" })
    }

    if (!site.path) {
        return Err({ _: "SITE_PATH_NOT_CONFIGURED" })
    }

    const blogModule = site.config.modules.find(m => m.kind === "blog")
    if (!blogModule) {
        return Err({ _: "BLOG_MODULE_NOT_FOUND" })
    }

    const description = input.description?.trim() ?? ""

    // Build path
    const siteFolderPath = Obsidian.normalizePath(site.path)
    const moduleFolderPath = Obsidian.normalizePath(`${siteFolderPath}/${blogModule.name}`)
    const statusFolderName = Post.getStatusFolderName(input.status)
    const statusFolderPath = Obsidian.normalizePath(`${moduleFolderPath}/${statusFolderName}`)
    const postFolderPath = Obsidian.normalizePath(`${statusFolderPath}/${title}`)
    const postFilePath = Obsidian.normalizePath(`${postFolderPath}/${title}.md`)

    // Ensure directories exist
    await ensureFolder(app, moduleFolderPath)
    await ensureFolder(app, statusFolderPath)
    await ensureFolder(app, postFolderPath)

    // Create file with empty content first
    const file = await app.vault.create(postFilePath, "")

    // Add frontmatter
    const result = await Post.updateFrontmatter(app, file, frontmatter => {
        frontmatter.status = input.status
        frontmatter.description = description || null
        frontmatter["posted on"] = ""
        frontmatter.tags = []
    })

    switch (result._) {
        case OK:
            return Ok(file)
        case ERROR:
            return Err({ _: "FRONTMATTER_UPDATE_FAILED", error: result.error })
        default:
            return result satisfies never
    }
}

async function ensureFolder(app: Obsidian.App, path: string): Promise<void> {
    const exists = await app.vault.adapter.exists(path)
    if (!exists) {
        await app.vault.createFolder(path)
    }
}

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

class CreateBlogPostModal extends Obsidian.Modal {
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

        const result = await createBlogPost(this.app, {
            siteId: this.formState.siteId,
            status: this.formState.status,
            title: this.formState.title,
            description: this.formState.description,
        })

        switch (result._) {
            case OK: {
                this.close()
                const leaf = this.app.workspace.getLeaf(false)
                await leaf.openFile(result.data)
                break
            }
            case ERROR: {
                log.error("Failed to create blog post", result.error)
                Notice.error("Failed to create blog post", { permanent: true })
                break
            }
            default:
                result satisfies never
        }
    }

    onClose() {
        const { contentEl } = this
        contentEl.empty()
    }
}

// --- Commands

export function registerCommands(plugin: Plugin): void {
    plugin.addCommand({
        ...Commands.CREATE_BLOG_POST_IDEA,
        checkCallback: (checking: boolean) => {
            if (!Config.Store.onboarded()) return false
            if (!Site.hasModuleOfKind("blog")) return false

            if (!checking) {
                new CreateBlogPostModal(plugin, { defaultStatus: "Idea" }).open()
            }
            return true
        },
    })

    plugin.addCommand({
        ...Commands.CREATE_BLOG_POST_DRAFT,
        checkCallback: (checking: boolean) => {
            if (!Config.Store.onboarded()) return false
            if (!Site.hasModuleOfKind("blog")) return false

            if (!checking) {
                new CreateBlogPostModal(plugin, { defaultStatus: "Draft" }).open()
            }
            return true
        },
    })

    // Headless API
    plugin.headless.createBlogPost = async input => {
        const result = await createBlogPost(plugin.app, {
            siteId: input.siteId,
            status: input.status ?? "Draft",
            title: input.title,
            description: input.description,
        })

        switch (result._) {
            case OK:
                return { path: result.data.path }
            case ERROR:
                throw new Error(result.error._)
            default:
                result satisfies never
                throw new Error("unreachable")
        }
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
