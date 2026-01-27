import { z } from "zod"

export const id = <Key extends string>() => z.string().brand<Key>()
