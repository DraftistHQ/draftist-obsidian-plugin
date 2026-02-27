import * as Obsidian from "obsidian"

import type Plugin from "src/main"
import { Commands } from "src/commands"
import * as Site from "src/models/site"
import * as Post from "src/models/post"
import * as Doc from "src/models/doc"
import * as Assets from "src/models/assets"
import * as Image from "src/models/image"
import * as Notice from "src/notice"
import * as FieldError from "src/ui/field-error"
import * as log from "src/logger"
import { ERROR } from "src/utils/result"

export function registerCommand(plugin: Plugin): void {
    plugin.addCommand({
        ...Commands.INSERT_IMAGE,
        checkCallback: (checking: boolean) => {
            const file = plugin.app.workspace.getActiveFile()
            if (!file) return false

            const result = Site.getSiteAndModuleForFile(file)
            if (result._ === ERROR) return false

            switch (result.data.module.kind) {
                case "blog": {
                    if (!checking) {
                        new InsertImageModal(plugin.app, file, {
                            imagePrefix: Post.IMAGE_PREFIX_POST,
                            supportPlacement: true,
                        }).open()
                    }
                    return true
                }

                case "docs": {
                    if (!checking) {
                        new InsertImageModal(plugin.app, file, {
                            imagePrefix: Doc.IMAGE_PREFIX_DOC,
                            supportPlacement: false,
                        }).open()
                    }
                    return true
                }

                default: {
                    result.data.module.kind satisfies never
                    return false
                }
            }
        },
    })
}

type ImagePlacement = "wide" | "fit" | "narrow"

type FormState = {
    imageFile: File | null
    caption: string
    placement: ImagePlacement | null
}

type Config = {
    imagePrefix: string
    supportPlacement: boolean
}

class InsertImageModal extends Obsidian.Modal {
    private file: Obsidian.TFile
    private config: Config
    private formState: FormState
    private imageErrorEl: HTMLElement | null = null

    constructor(app: Obsidian.App, file: Obsidian.TFile, config: Config) {
        super(app)
        this.file = file
        this.config = config
        this.formState = {
            imageFile: null,
            caption: "",
            placement: null,
        }
    }

    onOpen() {
        const { titleEl, contentEl } = this

        titleEl.setText("Insert Image")

        this.modalEl.style.width = "600px"

        const imageSetting = new Obsidian.Setting(contentEl)
            .setName("Image")
            .setDesc("Select an image to insert")
            .addButton(button => {
                button.setButtonText("Select Image").onClick(async () => {
                    const imageFile = await Image.pickImageFiles({ multiple: false })
                    if (imageFile) {
                        this.formState.imageFile = imageFile
                        button.setButtonText(`Selected: ${imageFile.name}`)
                        this.hideImageError()
                    }
                })
            })

        // It should be placed on the opposite side but Obsidian APIs
        // make it hard to provide proper error feedback
        this.imageErrorEl = FieldError.createErrorEl(imageSetting.infoEl)

        new Obsidian.Setting(contentEl)
            .setName("Caption")
            .setDesc("Optional caption for the image")
            .addText(text =>
                text
                    .setPlaceholder("Image caption")
                    .setValue(this.formState.caption)
                    .onChange(value => {
                        this.formState.caption = value
                    }),
            )

        if (this.config.supportPlacement) {
            new Obsidian.Setting(contentEl)
                .setName("Placement")
                .setDesc("Image placement in the post")
                .addDropdown(dropdown =>
                    dropdown
                        .addOption("", "Default")
                        .addOption("wide", "Wide")
                        .addOption("fit", "Fit")
                        .addOption("narrow", "Narrow")
                        .setValue(this.formState.placement || "")
                        .onChange(value => {
                            this.formState.placement = value === "" ? null : (value as ImagePlacement)
                        }),
                )
        }

        new Obsidian.Setting(contentEl)
            .addButton(btn => btn.setButtonText("Cancel").onClick(() => this.close()))
            .addButton(btn =>
                btn
                    .setButtonText("Insert")
                    .setCta()
                    .onClick(() => this.handleSubmit()),
            )
    }

    async handleSubmit() {
        if (!this.formState.imageFile) {
            this.showImageError("Please select an image")
            return
        }

        try {
            await this.insertImage()
            Notice.info("Image inserted")
            this.close()
        } catch (error) {
            log.error("Failed to insert image", error)
            Notice.error("Failed to insert image")
        }
    }

    showImageError(message: string) {
        if (this.imageErrorEl) {
            FieldError.show(null, this.imageErrorEl, message)
        }
    }

    hideImageError() {
        if (this.imageErrorEl) {
            FieldError.clear(null, this.imageErrorEl)
        }
    }

    async insertImage(): Promise<void> {
        const folder = this.file.parent
        if (!folder) {
            throw new Error("Cannot determine page folder")
        }

        const editor = this.app.workspace.activeEditor?.editor
        if (!editor) {
            throw new Error("No active editor")
        }

        if (!this.formState.imageFile) {
            throw new Error("No image file selected")
        }

        // Copy image to images folder
        const imageFileName = Image.generateUniqueFilename(this.formState.imageFile.name, this.config.imagePrefix)
        await Assets.copyImageFileToSubfolder(this.app, folder, imageFileName, this.formState.imageFile)

        // Build markdown
        const caption = this.formState.caption.trim()
        const placement = this.formState.placement

        let markdown: string
        if (placement) {
            markdown = `![${caption}](${imageFileName} "placement=${placement}")`
        } else {
            markdown = `![${caption}](${imageFileName})`
        }

        editor.replaceSelection(markdown)
    }

    onClose() {
        this.contentEl.empty()
    }
}
