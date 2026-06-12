import * as Obsidian from "obsidian"

import * as Notice from "src/notice"

export function openUrlInBrowser(url: string, text: string): void {
    if (Obsidian.Platform.isMobile) {
        Notice.info(
            createFragment(fragment => {
                fragment.createEl("a", { href: url, text })
            }),
            { permanent: true },
        )
    } else {
        window.open(url)
    }
}
