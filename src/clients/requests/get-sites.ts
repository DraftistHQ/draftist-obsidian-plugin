// CORE: core/lib/services/server/routes/integrations/obsidian/settings/get_user_sites.rs

import { z } from "zod"

import * as Api from "src/clients/api"
import * as Site from "src/models/site"

const parsers = {
    success: z.array(Site.T),
    failure: null,
}

export function send(token?: string) {
    return Api.get("/settings/sites", { token, parsers })
}
