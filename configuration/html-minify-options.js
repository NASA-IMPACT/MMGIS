// Production html-webpack-plugin `minify` options, shared by webpack.config.js and
// tests/unit/staticIndex.spec.js so the test minifies with the real options.
module.exports = {
  removeComments: true,
  collapseWhitespace: true,
  removeRedundantAttributes: true,
  useShortDoctype: true,
  removeEmptyAttributes: true,
  removeStyleLinkTypeAttributes: true,
  keepClosingSlash: true,
  minifyJS: true,
  minifyCSS: true,
  minifyURLs: true,
};
