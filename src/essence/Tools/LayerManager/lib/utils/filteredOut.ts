// Absent from `listed` means listed; only an explicit false is filtered out.
export const filteredOutLayers = (
    visible: Record<string, boolean> | null | undefined,
    listed: Record<string, boolean> | null | undefined,
): string[] =>
    Object.keys(visible ?? {}).filter(
        (id) => visible?.[id] === true && listed?.[id] === false,
    )
