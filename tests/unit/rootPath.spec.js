import { test, expect } from 'vitest'

// The single reading of ROOT_PATH. Everything downstream joins its own "/…"
// onto the result, so what matters is that the value never ends in a slash,
// however the operator wrote the env.

const { rootPath } = require('../../API/Backend/Utils/rootPath')

const saved = process.env.ROOT_PATH

test.afterEach(() => {
    if (saved === undefined) delete process.env.ROOT_PATH
    else process.env.ROOT_PATH = saved
})

test('an unset ROOT_PATH is the origin root', () => {
    delete process.env.ROOT_PATH
    expect(rootPath()).toBe('')
})

test('an empty ROOT_PATH is the origin root', () => {
    process.env.ROOT_PATH = ''
    expect(rootPath()).toBe('')
})

test('a slash-less prefix is passed through', () => {
    process.env.ROOT_PATH = '/mmgis'
    expect(rootPath()).toBe('/mmgis')
})

test('a trailing slash is dropped', () => {
    process.env.ROOT_PATH = '/mmgis/'
    expect(rootPath()).toBe('/mmgis')
})

test('a doubled trailing slash is dropped too', () => {
    process.env.ROOT_PATH = '/mmgis//'
    expect(rootPath()).toBe('/mmgis')
})

test('an env set after load still reaches the caller', () => {
    // The value is read per call, so a process that configures ROOT_PATH
    // after requiring this module is not stuck with the prefix it had then.
    process.env.ROOT_PATH = '/first'
    expect(rootPath()).toBe('/first')
    process.env.ROOT_PATH = '/second'
    expect(rootPath()).toBe('/second')
})
