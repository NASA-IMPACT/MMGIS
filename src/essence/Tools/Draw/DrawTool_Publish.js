import $ from 'jquery'

import calls from '../../../pre/calls'

var DrawTool = null
var Publish = {
    init: function (tool) {
        DrawTool = tool
        DrawTool.showReview = Publish.showReview
    },
    showReview: function (switchContent) {
        DrawTool.isReviewOpen = true
        $('#drawToolReview').remove()

        if (switchContent !== false && DrawTool.activeContent != 'shapes')
            DrawTool.showContent('shapes')

        //Turn on all master files
        // and turn off all non master files
        for (var f in DrawTool.files) {
            var id = DrawTool.files[f].id
            if (
                DrawTool.files[f].is_master &&
                DrawTool.filesOn.indexOf(id) == -1
            ) {
                DrawTool.toggleFile(id, null, true)
                $('.drawToolFileCheckbox[file_id="' + id + '" ]').addClass('on')
            } else if (
                !DrawTool.files[f].is_master &&
                DrawTool.filesOn.indexOf(id) != -1
            ) {
                DrawTool.toggleFile(id, null, true)
                $('.drawToolFileCheckbox[file_id="' + id + '" ]').removeClass(
                    'on'
                )
            }
        }

        //Hide all non master files
        // prettier-ignore
        var markup = [
                "<div id='drawToolReview'>",
                    "<div id='drawToolReviewTopbar'>",
                        "<div id='drawToolReviewTopbarTitle'>",
                            "Review",
                            "<div id='drawToolReviewRefresh'>",
                                "<div>refresh</div>",
                                "<i class='mdi mdi-refresh mdi-18px'></i>",
                            "</div>",
                        "</div>",
                        "<div id='drawToolReviewTopbarClose'>",
                            "<i class='mdi mdi-close mdi-18px'></i>",
                        "</div>",
                    "</div>",
                    "<div id='drawToolReviewContent'>",
                        "<ul>",
                        "</ul>",
                    "</div>",
                "</div>"
            ].join('\n');

        $('#drawTool').append(markup)

        $('#drawToolReviewRefresh').on('click', function () {
            DrawTool.showReview()
        })
        $('#drawToolReviewTopbarClose').on('click', function () {
            $('#drawToolReview').animate(
                {
                    opacity: 0,
                },
                250,
                function () {
                    $('#drawToolReview').remove()
                    DrawTool.isReviewOpen = false
                }
            )
        })

        DrawTool.compileFile({ verbose: true }, function (compileResponse) {
            $('#drawToolReviewContent ul *').remove()
            var liMarkup = [
                '<li class="drawToolReviewTitle">',
                'Issues',
                '</li>',
            ].join('\n')
            $('#drawToolReviewContent ul').append(liMarkup)

            var noErrors = true
            for (var i = 0; i < compileResponse.body.issues.length; i++) {
                var issue = compileResponse.body.issues[i]
                if (issue.severity === 'error') noErrors = false
                var message = issue.message
                if (issue.hasOwnProperty('antecedent')) {
                    message = message.replace(
                        '{antecedent}',
                        "<span class='ante' shape_id='" +
                            issue.antecedent.id +
                            "'>" +
                            (DrawTool.intentNameMapping[
                                issue.antecedent.intent
                            ] ||
                                issue.antecedent.intent.capitalizeFirstLetter()) +
                            '(' +
                            issue.antecedent.id +
                            ')' +
                            '</span>'
                    )
                }
                if (issue.hasOwnProperty('consequent'))
                    message = message.replace(
                        '{consequent}',
                        "<span class='cons' shape_id='" +
                            issue.consequent.id +
                            "'>" +
                            (DrawTool.intentNameMapping[
                                issue.consequent.intent
                            ] ||
                                issue.consequent.intent.capitalizeFirstLetter()) +
                            '(' +
                            issue.consequent.id +
                            ')' +
                            '</span>'
                    )

                var liMarkup = [
                    '<li>',
                    "<div class='" + issue.severity + "'>",
                    issue.severity,
                    '</div>',
                    message,
                    '</li>',
                ].join('\n')
                $('#drawToolReviewContent ul').append(liMarkup)
            }

            if (noErrors) {
                $('#drawToolReviewContent ul *').remove()
                //We can show the Changes and publish button
                var liMarkup = [
                    '<li class="drawToolReviewTitle">',
                    'Changes',
                    '</li>',
                ].join('\n')
                $('#drawToolReviewContent ul').append(liMarkup)

                //Changes
                if (compileResponse.body.changes) {
                    //Added
                    var added = compileResponse.body.changes.added
                    for (var i = 0; i < added.length; i++) {
                        var liMarkup = [
                            "<li class='changes'>",
                            "<div class='added'>added</div>",
                            "<span title='" +
                                added[i].uuid +
                                "' shape_id='" +
                                added[i].id +
                                "'>" +
                                added[i].name +
                                '</span>',
                            '</li>',
                        ].join('\n')
                        $('#drawToolReviewContent ul').append(liMarkup)
                    }

                    //Removed
                    var removed = compileResponse.body.changes.removed
                    for (var i = 0; i < removed.length; i++) {
                        var liMarkup = [
                            "<li class='changes'>",
                            "<div class='removed'>removed</div>",
                            "<span title='" +
                                removed[i].uuid +
                                "' shape_id='null'>" +
                                removed[i].name +
                                '</span>',
                            '</li>',
                        ].join('\n')
                        $('#drawToolReviewContent ul').append(liMarkup)
                    }

                    //Changed
                    var changed = compileResponse.body.changes.changed
                    for (var i = 0; i < changed.length; i++) {
                        var liMarkup = [
                            "<li class='changes'>",
                            "<div class='changed'>changed</div>",
                            "<span title='" +
                                changed[i].uuid +
                                "' shape_id='" +
                                changed[i].id +
                                "'>" +
                                changed[i].old_name +
                                ' &rarr; ' +
                                changed[i].new_name +
                                '</span>',
                            '</li>',
                        ].join('\n')
                        $('#drawToolReviewContent ul').append(liMarkup)
                    }
                }

                var liMarkup = [
                    '<li id="drawToolReviewPublish">',
                    '<div>Publish</div>',
                    '</li>',
                ].join('\n')
                $('#drawToolReviewContent ul').append(liMarkup)
            } else {
                var liMarkup = [
                    '<li id="drawToolReviewMessage">',
                    'All errors must be resolved before publishing.',
                    '</li>',
                ].join('\n')
                $('#drawToolReviewContent ul').append(liMarkup)
            }

            $('#drawToolReviewContent ul li > span').on(
                'mouseenter',
                function () {
                    $(
                        '.drawToolShapeLi[shape_id="' +
                            $(this).attr('shape_id') +
                            '"] .drawToolShapeLiItem'
                    ).mouseenter()
                }
            )
            $('#drawToolReviewContent ul li > span').on(
                'mouseleave',
                function () {
                    $(
                        '.drawToolShapeLi[shape_id="' +
                            $(this).attr('shape_id') +
                            '"] .drawToolShapeLiItem'
                    ).mouseleave()
                }
            )
            $('#drawToolReviewContent ul li > span').on('click', function () {
                $(
                    '.drawToolShapeLi[shape_id="' +
                        $(this).attr('shape_id') +
                        '"] .drawToolShapeLiItem'
                ).click()
            })

            //Publish
            var publishing = false
            $('#drawToolReviewPublish').on('click', function () {
                if (!publishing) {
                    publishing = true
                    calls.api(
                        'files_publish',
                        {},
                        function () {
                            $('#drawToolReviewPublish').html(
                                '<div>Published!</div>'
                            )
                            $('#drawToolReviewPublish').css({
                                background: '#26ff2b',
                            })
                            $('#drawToolReviewPublish > div').css({
                                color: '#001 !important',
                            })
                        },
                        function () {
                            $('#drawToolReviewPublish').html(
                                '<div>Publish Failed</div>'
                            )
                            $('#drawToolReviewPublish').css({
                                background: '#ff2626',
                            })
                            setTimeout(function () {
                                publishing = false
                                $('#drawToolReviewPublish').html(
                                    '<div>Publish</div>'
                                )
                                $('#drawToolReviewPublish').css({
                                    background: '#5d26ff',
                                })
                            }, 4000)
                        }
                    )
                }
            })
        })
    },
}

export default Publish
