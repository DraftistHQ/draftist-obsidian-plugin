import * as Config from "src/config"

const platform = (path: string) => Config.Store.platformUrl() + path

export const apiTokensUrl = () => platform("/manage/account/security/tokens")
export const manageSitesUrl = () => platform("/manage/sites")
