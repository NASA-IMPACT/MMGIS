import React from 'react'
import { Markdown } from '../../_shared/content/markdown'
import type { RenderDescription } from '../lib'

/**
 * Layer descriptions are authored as markdown in mission configuration, and
 * MMGIS owns the parser, the sanitizer policy and the stylesheet. Binding that
 * to the panel here keeps the components free of it, so a host without a
 * markdown renderer still shows the text as written.
 */
export const renderDescription: RenderDescription = (source, className) => (
    <Markdown source={source} className={className} />
)
