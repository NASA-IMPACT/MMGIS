import $ from 'jquery'
import Modal from './Modal'
import { renderMarkdown, MARKDOWN_CLASS } from '../Basics/Markdown_/Markdown_'

import './Help.css'

const Help = {
    getComponent: function (helpKey) {
        return `<div id='helpModal_${helpKey}' class='mmgisButton5 mmgisHelpButton' title='Help'><i class='mdi mdi-help-rhombus-outline mdi-18px'></i></div>`
    },
    finalize: function (helpKey) {
        $(`#helpModal_${helpKey}`).on('click', function () {
            $.get(
                `${window.location.origin}${(
                    window.location.pathname || ''
                ).replace(/\/$/g, '')}/public/helps/${helpKey}.md`,
                function (doc) {
                    // prettier-ignore
                    Modal.set(
                    [
                        `<div id='HelpModal'>`,
                            `<div id='HelpModalTitle'>`,
                                `<div><i class='mdi mdi-help-rhombus-outline mdi-18px'></i><div>Help</div></div>`,
                                `<div id='HelpModalClose'><i class='mmgisHoverBlue mdi mdi-close mdi-18px'></i></div>`,
                            `</div>`,
                            `<div id='HelpModalContent' class='${MARKDOWN_CLASS}'>`,
                                renderMarkdown(doc),
                            `</div>`,
                        `</div>`
                    ].join('\n'),
                    function () {
                        $('#HelpModalClose').on('click', function () {
                            Modal.remove()
                        })
                    }       
                )
                }
            )
        })
    },
}

export default Help
