import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
import { z } from "zod"
import { sourceViewerFixture } from "../../apps/server/src/testing/source-viewer-fixture.ts"
import { ProviderAdapter } from "../../packages/providers/src/adapter.ts"
import { defaultSettings } from "../../packages/providers/src/catalog.ts"

it("disables stale Send and F4 when the official Codex route rejects a turn", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ten1-rejection-"))
  const binary = join(directory, "codex-fixture")
  await writeFile(
    binary,
    `#!/usr/bin/env node
const {createInterface}=require('node:readline');
createInterface({input:process.stdin}).on('line',line=>{
 const {id,method}=JSON.parse(line);
 const result = method==='account/login/start'?{authUrl:'https://auth.openai.com/authorize?state=fixture'}:
 method==='account/read'?{account:{type:'chatgpt'}}:
 method==='model/list'?{data:[{model:'offered/model',displayName:'Fixture',hidden:false}],nextCursor:null}:
 method==='thread/start'?{thread:{id:'thread'}}:{};
 if(method==='turn/start') console.log(JSON.stringify({id,error:{code:-32000,message:'private rejected token'}}));
 else if(id!==undefined) console.log(JSON.stringify({id,result}));
});`,
    { mode: 0o700 },
  )
  vi.stubEnv("STUDIO_CODEX_BINARY", binary)
  const fixture = await sourceViewerFixture()
  try {
    const login = await fetch(`${fixture.origin}/login`, {
      method: "POST",
      headers: { origin: fixture.origin, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fixture.credentials),
      redirect: "manual",
    })
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ")
    const headers = { cookie, origin: fixture.origin, "content-type": "application/json" }
    expect(
      (
        await fetch(`${fixture.origin}/api/provider-connections/codex/connect`, {
          method: "POST",
          headers,
        })
      ).status,
    ).toBe(200)
    const draft = await fetch(`${fixture.origin}/api/study-setup/revision-fixture`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider: "codex",
        model: "offered/model",
        scope: "partial",
        chapters: ["chapter-two.xhtml"],
      }),
    })
    const { setupId } = z.object({ setupId: z.string() }).parse(await draft.json())
    const setup = fixture.storage.sources.getSetup(setupId)
    if (!setup) throw new TypeError("Expected draft")
    const owner = fixture.storage.sources
      .listStudiesByEdition(setup.editionId)
      .find((study) => study.id === setup.studyId)?.ownerId
    if (!owner) throw new TypeError("Expected owner")
    const installation = fixture.storage.sources.getInstallation(owner)
    if (!installation) throw new TypeError("Expected installation")
    const adapter = new ProviderAdapter({
      provider: "codex",
      codex: fixture.storage.providerConnections.codex(owner, installation),
    })
    const reply = await adapter.dispatch({
      model: "offered/model",
      settings: defaultSettings,
      prompt: "Synthetic fixture",
      schema: { type: "object", properties: {} },
      signal: new AbortController().signal,
    })
    expect(reply).toMatchObject({ kind: "error", code: "rejected" })
    const status = await fetch(`${fixture.origin}/api/provider-connections/codex`, { headers })
    expect(await status.json()).toMatchObject({
      available: false,
      status: "unavailable",
      f4: "BLOCKED",
    })
    const review = await fetch(`${fixture.origin}/api/study-setup/revision-fixture/${setupId}`, {
      headers,
    })
    expect(await review.json()).toMatchObject({ available: false })
    const send = await fetch(`${fixture.origin}/api/study-setup/revision-fixture/${setupId}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ decision: "send" }),
    })
    expect(send.status).toBe(503)
    expect(fixture.storage.sources.getGrant(`grant-${setupId}`)).toBeNull()
  } finally {
    await fixture.close()
    vi.unstubAllEnvs()
    await rm(directory, { recursive: true, force: true })
  }
})
