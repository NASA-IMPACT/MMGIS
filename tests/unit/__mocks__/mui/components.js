// Test stubs for the MUI components the Configure app's UploadField uses.
//
// MUI is a dependency of the Configure app only (configure/node_modules),
// which the unit run does not install. The Vitest config aliases
// `@mui/material/<Name>` to the same-named file beside this one, which
// re-exports the stub below as its default. A spec rendering a Configure
// component gets the plain element each one boils down to, with MUI-only
// props dropped.
import React from 'react'

export const Button = ({ children, variant, size, ...rest }) =>
    React.createElement('button', rest, children)

export const Typography = ({ children, variant }) =>
    React.createElement('span', null, children)

export const TextField = ({ inputProps, variant, size, ...rest }) =>
    React.createElement('input', { ...inputProps, ...rest })
