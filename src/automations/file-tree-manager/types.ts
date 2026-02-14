import * as Obsidian from "obsidian"

import * as Config from "src/config"
import * as Site from "src/models/site"

export type BlogPostState = {
    status: string | null
    postedOn: string | null
    title: string
}

export type BlogPostChangeData = {
    file: Obsidian.TFile
    folder: Obsidian.TFolder
    state: BlogPostState
}

export type DocPageState = {
    title: string
    position: number | null
}

export type DocPageChangeData = {
    file: Obsidian.TFile
    folder: Obsidian.TFolder
    state: DocPageState
}

export type DetectedContentChange =
    | {
          kind: "blog"
          site: Config.SiteSettings
          module: Site.SiteModule
          data: BlogPostChangeData
      }
    | {
          kind: "docs"
          site: Config.SiteSettings
          module: Site.SiteModule
          data: DocPageChangeData
      }
