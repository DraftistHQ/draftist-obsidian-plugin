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
        ...Commands.INSERT_GALLERY,
        checkCallback: (checking: boolean) => {
            const file = plugin.app.workspace.getActiveFile()
            if (!file) return false

            const result = Site.getSiteAndModuleForFile(file)
            if (result._ === ERROR) return false

            switch (result.data.module.kind) {
                case "blog": {
                    if (!checking) {
                        new InsertGalleryModal(plugin.app, file, Post.IMAGE_PREFIX_POST).open()
                    }
                    return true
                }

                case "docs": {
                    if (!checking) {
                        new InsertGalleryModal(plugin.app, file, Doc.IMAGE_PREFIX_DOC).open()
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

// TODO: Current gallery UX is meh. Things to implement:
// - ability to add/reorder/remove images
// - set optional caption for each image

type FormState = {
    imageFiles: File[]
    caption: string
    collapsedByDefault: boolean
}

class InsertGalleryModal extends Obsidian.Modal {
    private file: Obsidian.TFile
    private imagePrefix: string
    private formState: FormState
    private imageButtonEl: HTMLButtonElement | null = null
    private imageErrorEl: HTMLElement | null = null

    constructor(app: Obsidian.App, file: Obsidian.TFile, imagePrefix: string) {
        super(app)
        this.file = file
        this.imagePrefix = imagePrefix
        this.formState = {
            imageFiles: [],
            caption: "",
            collapsedByDefault: true,
        }
    }

    onOpen() {
        const { titleEl, contentEl } = this

        titleEl.setText("Insert Gallery")

        this.modalEl.style.width = "600px"

        const imagesSetting = new Obsidian.Setting(contentEl)
            .setName("Images")
            .setDesc("Select images for the gallery")
            .addButton(button => {
                this.imageButtonEl = button.buttonEl
                button.setButtonText("Select Images").onClick(async () => {
                    const imageFiles = await Image.pickImageFiles({ multiple: true })
                    if (imageFiles.length > 0) {
                        this.formState.imageFiles = imageFiles
                        button.setButtonText(`${imageFiles.length} image(s) selected`)
                        this.hideImageError()
                    }
                })
            })
        this.imageErrorEl = FieldError.createErrorEl(imagesSetting.infoEl)

        new Obsidian.Setting(contentEl)
            .setName("Caption")
            .setDesc("Optional caption for the gallery")
            .addText(text =>
                text
                    .setPlaceholder("My photo gallery")
                    .setValue(this.formState.caption)
                    .onChange(value => {
                        this.formState.caption = value
                    }),
            )

        new Obsidian.Setting(contentEl)
            .setName("Collapsed by default")
            .setDesc("Gallery will be collapsed when the page loads")
            .addToggle(toggle =>
                toggle.setValue(this.formState.collapsedByDefault).onChange(value => {
                    this.formState.collapsedByDefault = value
                }),
            )

        new Obsidian.Setting(contentEl)
            .addButton(btn => btn.setButtonText("Cancel").onClick(() => this.close()))
            .addButton(btn =>
                btn
                    .setButtonText("Insert")
                    .setCta()
                    .onClick(() => this.handleSubmit()),
            )
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

    async handleSubmit() {
        if (this.formState.imageFiles.length === 0) {
            this.showImageError("Please select at least one image")
            return
        }

        try {
            await this.insertGallery()
            Notice.info("Gallery inserted")
            this.close()
        } catch (error) {
            log.error("Failed to insert gallery", error)
            Notice.error("Failed to insert gallery")
        }
    }

    async insertGallery(): Promise<void> {
        const folder = this.file.parent
        if (!folder) {
            throw new Error("Cannot determine page folder")
        }

        const editor = this.app.workspace.activeEditor?.editor
        if (!editor) {
            throw new Error("No active editor")
        }

        const imageFileNames: string[] = []

        for (const imageFile of this.formState.imageFiles) {
            const imageFileName = Image.generateUniqueFilename(imageFile.name, this.imagePrefix)
            await Assets.copyImageFileToSubfolder(this.app, folder, imageFileName, imageFile)
            imageFileNames.push(imageFileName)
        }

        const foldingMarker = this.formState.collapsedByDefault ? "-" : "+"
        const caption = this.formState.caption.trim()
        const headerLine = `> [!GALLERY]${foldingMarker}${caption ? ` ${caption}` : ""}`

        const imageLines = imageFileNames.map(name => `> ![](${name})`).join("\n")

        const markdown = `${headerLine}\n${imageLines}`

        editor.replaceSelection(markdown)
    }

    onClose() {
        this.contentEl.empty()
    }
}
