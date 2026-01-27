export function keys<K extends string, V>(obj: Record<K, V>): K[] {
    return Object.keys(obj) as K[]
}

export function values<K extends string, V>(obj: Record<K, V>): NonNullable<V>[] {
    return Object.values(obj) as NonNullable<V>[]
}

export function entries<K extends string, V>(obj: Record<K, V>): [K, NonNullable<V>][] {
    return Object.entries(obj) as [K, NonNullable<V>][]
}
