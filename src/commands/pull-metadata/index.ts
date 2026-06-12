import type Plugin from "src/main"
import { Commands } from "src/commands"
import * as Site from "src/models/site"
import { ERROR } from "src/utils/result"

export function registerCommand(plugin: Plugin): void {
    plugin.addCommand({
        ...Commands.PULL_METADATA,
        checkCallback: (checking: boolean) => {
            const file = plugin.app.workspace.getActiveFile()
            if (!file) return false

            const result = Site.getSiteAndModuleForFile(file)
            if (result._ === ERROR) return false

            if (!checking) {
                plugin.metadataSyncManager.syncOnUserRequest(file)
            }
            return true
        },
    })
}
