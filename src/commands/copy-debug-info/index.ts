import * as Obsidian from "obsidian"

import type Plugin from "src/main"
import { Commands } from "src/commands"
import * as Notice from "src/notice"

export function registerCommand(plugin: Plugin): void {
    plugin.addCommand({
        ...Commands.COPY_DEBUG_INFO,
        callback: () => runCommand(),
    })
}

export async function runCommand(): Promise<void> {
    const info = getInfo()
    await navigator.clipboard.writeText(info)

    const fragment = document.createDocumentFragment()
    fragment.createEl("span", { text: "Debug info copied." })
    for (const line of info.split("\n")) {
        fragment.createEl("div", { text: line })
    }
    Notice.info(fragment)
}

function getInfo(): string {
    const os = getOS()
    const lines = [`OS: ${os}`, `Obsidian: ${Obsidian.apiVersion}`, `Draftist: ${DFT_VERSION} (${DFT_BUILD_ID})`]
    return lines.join("\n")
}

function getOS(): string {
    if (Obsidian.Platform.isMacOS) {
        return "macOS"
    } else if (Obsidian.Platform.isWin) {
        return "Windows"
    } else if (Obsidian.Platform.isLinux) {
        return "Linux"
    } else if (Obsidian.Platform.isIosApp) {
        return "iOS"
    } else if (Obsidian.Platform.isAndroidApp) {
        return "Android"
    }
    return "Unknown"
}
