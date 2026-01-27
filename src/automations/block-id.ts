import * as Obsidian from "obsidian"
import { z } from "zod"

import * as Opaque from "src/utils/opaque"
import * as Uuid from "src/utils/uuid"
import * as log from "src/logger"

export const T = Opaque.id<"BlockId">()
export type T = z.infer<typeof T>

const LENGTH = 6 // matches obsidian's generated block id

function generate(): T {
    return Uuid.generate(LENGTH) as T
}

function validate(_blockId: string): boolean {
    // NOTE: Not validating anything here. Users can provide their own handmade ids.
    return true
}

export async function ensureBlockIds(
    file: Obsidian.TFile,
    vault: Obsidian.Vault,
    fileCache: Obsidian.CachedMetadata,
): Promise<string> {
    let content = await vault.read(file)

    if (!fileCache.sections || fileCache.sections.length === 0) {
        log.warn(`No file cache or sections found for ${file.path}`)
        return content
    }

    let blocks: Array<Obsidian.SectionCache | Obsidian.ListItemCache> = []
    let rootLists: Array<number> = []

    fileCache.sections.forEach(section => {
        if (section.type !== "list") {
            blocks.push(section)
        } else {
            rootLists.push(section.position.start.line)
        }
    })

    fileCache.listItems?.forEach(item => {
        // Don't include non-root list items (e.g., from callouts)
        if (rootLists.includes(-item.parent)) {
            blocks.push(item)
        }
    })

    // Processing each block in reverse order to keep positions unshifted
    blocks.sort((a, b) => b.position.start.offset - a.position.start.offset)

    // Skipping the last block since it's always frontmatter
    for (let i = 0; i < blocks.length - 1; i++) {
        const block = blocks[i]

        // TODO?: Ensure uniqueness

        if ("type" in block && block.type === "thematicBreak") {
            continue
        }

        if (block.id) {
            const valid = validate(block.id)

            if (valid) {
                continue
            } else {
                log.warn(`Invalid block id found: ${block.id}`)
                continue
            }
        } else {
            const blockId = generate()
            const blockEnd = block.position.end.offset

            var blockIdSuffix

            if ("type" in block && (block.type === "code" || block.type === "callout" || block.type === "blockquote")) {
                blockIdSuffix = `\n^${blockId}`
            } else {
                blockIdSuffix = ` ^${blockId}`
            }

            content = content.slice(0, blockEnd) + blockIdSuffix + content.slice(blockEnd)
        }
    }

    await vault.modify(file, content)

    return content
}
