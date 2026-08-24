/**
 * Markdown rendering for plugins.
 *
 * Core owns the parser, the sanitizer policy, and the stylesheet. A plugin
 * renders authored text by handing a string to this component; it never holds
 * html, a class name, or dangerouslySetInnerHTML, so there is no part of
 * rendering it can skip or get wrong.
 *
 * A synchronous import rather than an mmgisAPI request: rendering is a pure
 * transform, and putting it on the bus would make every caller await a promise
 * to show a description.
 */
export {
    Markdown,
    type MarkdownProps,
} from '../../../Basics/Markdown_/Markdown'
export { hasMarkdownContent } from '../../../Basics/Markdown_/Markdown_'
