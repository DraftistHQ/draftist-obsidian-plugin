import * as Obsidian from "obsidian"

import * as Post from "src/models/post"
import * as Image from "src/models/image"
import * as Notice from "src/notice"
import * as log from "src/logger"

type ImagePlacement = "wide" | "fit" | "narrow"

type FormState = {
    imageFile: File | null
    caption: string
    placement: ImagePlacement | null
}

class InsertImageModal extends Obsidian.Modal {
    private file: Obsidian.TFile
    private formState: FormState
    private imageErrorEl: HTMLElement | null = null

    constructor(app: Obsidian.App, file: Obsidian.TFile) {
        super(app)
        this.file = file
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
        this.imageErrorEl = imageSetting.infoEl.createEl("div", {
            attr: {
                style: "display: none; color: var(--text-error); font-size: var(--font-ui-smaller); padding-top: var(--size-4-1);",
            },
        })

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
            this.imageErrorEl.setText(message)
            this.imageErrorEl.style.display = "block"
        }
    }

    hideImageError() {
        if (this.imageErrorEl) {
            this.imageErrorEl.style.display = "none"
        }
    }

    async insertImage(): Promise<void> {
        const folder = this.file.parent
        if (!folder) {
            throw new Error("Cannot determine post folder")
        }

        const editor = this.app.workspace.activeEditor?.editor
        if (!editor) {
            throw new Error("No active editor")
        }

        if (!this.formState.imageFile) {
            throw new Error("No image file selected")
        }

        // Copy image to images folder
        const imageFileName = Image.generateUniqueFilename(this.formState.imageFile.name, Post.IMAGE_PREFIX_POST)
        await Post.copyImageFileToPostSubfolder(this.app, folder, imageFileName, this.formState.imageFile)

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

export async function insertImage(app: Obsidian.App, file: Obsidian.TFile): Promise<void> {
    const folder = file.parent
    if (!folder) {
        Notice.warning("Cannot determine post folder")
        return
    }

    const editor = app.workspace.activeEditor?.editor
    if (!editor) {
        Notice.warning("No active editor to insert image")
        return
    }

    new InsertImageModal(app, file).open()
}
