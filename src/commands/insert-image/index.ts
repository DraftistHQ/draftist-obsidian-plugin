import * as Obsidian from "obsidian"

import * as Site from "src/models/site"
import * as Notice from "src/notice"
import { OK, ERROR } from "src/utils/result"
import * as BlogPost from "./blog-post"

export async function run(app: Obsidian.App): Promise<void> {
    const file = app.workspace.getActiveFile()

    if (!file) {
        Notice.warning("No active file")
        return
    }

    const result = Site.getSiteAndModuleForFile(file)

    switch (result._) {
        case OK: {
            const { module } = result.data

            switch (module.kind) {
                case "blog": {
                    return BlogPost.insertImage(app, file)
                }

                case "docs": {
                    return
                }

                default: {
                    module.kind satisfies never
                    return
                }
            }
        }

        case ERROR: {
            // TODO: Improve error - match against result.error
            Notice.warning("This file is not part of a site module")
            return
        }

        default: {
            result satisfies never
            return
        }
    }
}
