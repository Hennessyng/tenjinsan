import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, isAbsolute, join, relative } from "node:path"
import { afterEach, expect, it } from "vitest"
import { PrivateBlobStore, PrivatePathError } from "../src/index.ts"

const temporaryDirectories: string[] = []

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

it("generates an absolute content-addressed path beneath the configured private root", () => {
  const root = temporaryDirectory("reading-studio-blobs-")
  const store = new PrivateBlobStore(root)
  const hash = "a".repeat(64)
  const path = store.pathFor(hash)
  expect(isAbsolute(path)).toBe(true)
  expect(relative(realpathSync(root), path)).toBe(join("blobs", "aa", hash))
})

it.each(["../outside", "/tmp/outside", `a${"/../".repeat(21)}b`])(
  "rejects traversal or absolute input %s",
  (input) => {
    const root = temporaryDirectory("reading-studio-invalid-blob-")
    const store = new PrivateBlobStore(root)
    expect(() => store.pathFor(input)).toThrow(PrivatePathError)
  },
)

it("rejects a symlinked shard without creating an outside-root file", () => {
  const root = temporaryDirectory("reading-studio-symlink-root-")
  const outside = temporaryDirectory("reading-studio-symlink-outside-")
  const store = new PrivateBlobStore(root)
  const shard = join(root, "blobs", "aa")
  mkdirSync(join(root, "blobs"), { recursive: true })
  symlinkSync(outside, shard)
  expect(() => store.pathFor("a".repeat(64))).toThrow(PrivatePathError)
  expect(readdirSync(outside)).toEqual([])
  expect(existsSync(join(outside, "a".repeat(64)))).toBe(false)
})

it("rejects an existing final symlink that resolves outside the private root", () => {
  const root = temporaryDirectory("reading-studio-final-link-root-")
  const store = new PrivateBlobStore(root)
  const hash = "b".repeat(64)
  const candidate = store.pathFor(hash)
  mkdirSync(dirname(candidate), { recursive: true })
  symlinkSync(tmpdir(), candidate)

  expect(() => store.pathFor(hash)).toThrow(PrivatePathError)
  expect(realpathSync(candidate)).toBe(realpathSync(tmpdir()))
})

it("rejects a dangling final symlink without creating its outside target", () => {
  const root = temporaryDirectory("reading-studio-dangling-link-root-")
  const store = new PrivateBlobStore(root)
  const hash = "c".repeat(64)
  const candidate = store.pathFor(hash)
  const missingTarget = join(tmpdir(), `${basename(root)}-missing`)
  expect(existsSync(missingTarget)).toBe(false)
  mkdirSync(dirname(candidate), { recursive: true })
  symlinkSync(missingTarget, candidate)

  expect(() => store.pathFor(hash)).toThrow(PrivatePathError)
  expect(existsSync(missingTarget)).toBe(false)
})

it("rejects a relative or symlinked configured data root", () => {
  expect(() => new PrivateBlobStore("relative/private")).toThrow(PrivatePathError)
  const target = temporaryDirectory("reading-studio-root-target-")
  const linkParent = temporaryDirectory("reading-studio-root-link-")
  const link = join(linkParent, "private")
  symlinkSync(target, link)
  expect(() => new PrivateBlobStore(link)).toThrow(PrivatePathError)
})
