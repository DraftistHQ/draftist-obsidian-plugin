import * as Obsidian from "obsidian"

import type Plugin from "src/main"
import * as Assets from "src/models/assets"
import * as Post from "src/models/post"
import * as Image from "src/models/image"
import * as Notice from "src/notice"
import * as log from "src/logger"
import { ERROR } from "src/utils/result"

type FormState = {
    imageFile: File | null
    creditText: string
    creditLink: string
}

export class SetCoverImageModal extends Obsidian.Modal {
    private file: Obsidian.TFile
    private formState: FormState

    constructor(plugin: Plugin, file: Obsidian.TFile) {
        super(plugin.app)
        this.file = file
        this.formState = {
            imageFile: null,
            creditText: "",
            creditLink: "",
        }
    }

    onOpen() {
        const { titleEl, contentEl } = this

        titleEl.setText("Set Cover Image")

        this.modalEl.style.width = "600px"

        new Obsidian.Setting(contentEl)
            .setName("Image")
            .setDesc("Select a cover image")
            .addButton(button => {
                button.setButtonText(this.formState.imageFile ? "Change Image" : "Select Image").onClick(async () => {
                    const imageFile = await Image.pickImageFiles({ multiple: false })
                    if (imageFile) {
                        this.formState.imageFile = imageFile
                        button.setButtonText(`Selected: ${imageFile.name}`)
                    }
                })
            })

        new Obsidian.Setting(contentEl)
            .setName("Credit")
            .setDesc("Optional credit for the image")
            .addText(text =>
                text
                    .setPlaceholder("John Doe")
                    .setValue(this.formState.creditText)
                    .onChange(value => {
                        this.formState.creditText = value
                    }),
            )

        new Obsidian.Setting(contentEl)
            .setName("Credit link")
            .setDesc("Optional URL for the credit")
            .addText(text =>
                text
                    .setPlaceholder("https://johndoe.com")
                    .setValue(this.formState.creditLink)
                    .onChange(value => {
                        this.formState.creditLink = value
                    }),
            )

        new Obsidian.Setting(contentEl)
            .addButton(btn => btn.setButtonText("Cancel").onClick(() => this.close()))
            .addButton(btn =>
                btn
                    .setButtonText("Set cover")
                    .setCta()
                    .onClick(() => this.handleSubmit()),
            )
    }

    async handleSubmit() {
        if (!this.formState.imageFile) {
            Notice.warning("Please select an image")
            return
        }

        try {
            await this.setCoverImage()
            Notice.info("Cover image set")
            this.close()
        } catch (error) {
            log.error("Failed to set cover image", error)
            Notice.error("Failed to set cover image")
        }
    }

    async setCoverImage(): Promise<void> {
        if (!this.formState.imageFile) {
            throw new Error("No image file selected")
        }

        const folder = this.file.parent
        if (!folder) {
            throw new Error("Cannot determine post folder")
        }

        // Copy image to images folder
        const coverFileName = Image.generateUniqueFilename(this.formState.imageFile.name, Post.IMAGE_PREFIX_COVER)
        Assets.copyImageFileToSubfolder(this.app, folder, coverFileName, this.formState.imageFile)

        // Update frontmatter
        const creditText = this.formState.creditText.trim()
        const creditLink = this.formState.creditLink.trim()

        const result = await Post.updateFrontmatter(this.app, this.file, frontmatter => {
            frontmatter.cover = `[[${coverFileName}]]`
            if (creditText) {
                frontmatter["cover credit text"] = creditText
            }
            if (creditLink) {
                frontmatter["cover credit link"] = creditLink
            }
        })

        if (result._ === ERROR) {
            throw result.error
        }
    }

    onClose() {
        this.contentEl.empty()
    }
}
