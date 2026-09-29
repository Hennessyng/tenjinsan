import { once } from "node:events"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import { z } from "zod"
import { sourceViewerFixture } from "../../apps/server/src/testing/source-viewer-fixture.ts"
import { ProviderAdapter, ProviderRunner } from "../../packages/providers/src/index.ts"

afterEach(() => vi.unstubAllEnvs())

it.each(["openrouter", "codex"] as const)(
  "completes consent-approved %s work using an offered model",
  async (provider) => {
    const directory = await mkdtemp(join(tmpdir(), "ten-1-wire-"))
    const calls: unknown[] = []
    const wire = createServer(async (request, response) => {
      response.setHeader("content-type", "application/json")
      if (request.method === "GET") {
        response.end(
          JSON.stringify({
            data: [
              {
                id: "offered/model",
                name: "Offered model",
                supported_parameters: ["structured_outputs"],
              },
            ],
          }),
        )
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      calls.push(JSON.parse(Buffer.concat(chunks).toString()))
      response.end(
        JSON.stringify({
          choices: [{ message: { content: '{"answer":"ok"}' }, finish_reason: "stop" }],
          usage: { prompt_tokens: 8, completion_tokens: 4 },
        }),
      )
    })
    wire.listen(0, "127.0.0.1")
    await once(wire, "listening")
    const address = wire.address()
    if (!address || typeof address === "string") throw new TypeError("Missing test address")
    vi.stubEnv("STUDIO_PROVIDER_BASE_URL", `http://127.0.0.1:${address.port}/v1`)
    vi.stubEnv("OPENROUTER_API_KEY", "synthetic-key")
    const binary = join(directory, "codex-fixture")
    await writeFile(
      binary,
      `#!/usr/bin/env node
const { createInterface } = require('node:readline');
const reply = (id, result) => console.log(JSON.stringify({id,result}));
const notify = (method, params) => console.log(JSON.stringify({method,params}));
createInterface({input:process.stdin}).on('line', line => {
 const {id,method,params} = JSON.parse(line);
 if (method === 'initialize') reply(id, {});
 if (method === 'account/read') reply(id, {account:{type:'chatgpt',email:'synthetic@example.test',planType:'plus'}});
 if (method === 'account/login/start') reply(id, {type:'chatgpt',loginId:'fixture',authUrl:'https://auth.openai.com/authorize?state=synthetic'});
 if (method === 'model/list') reply(id, {data:[{id:'offered',model:'offered/model',displayName:'Offered model',hidden:false}],nextCursor:null});
 if (method === 'thread/start') reply(id, {thread:{id:'thread-fixture'}});
 if (method === 'turn/start') {
  if ('max_output_tokens' in params || 'maxOutputTokens' in params) process.exit(9);
  reply(id, {turn:{id:'turn-fixture',status:'inProgress'}});
  notify('thread/tokenUsage/updated',{threadId:params.threadId,turnId:'turn-fixture',tokenUsage:{last:{inputTokens:8,outputTokens:4}}});
  notify('item/completed',{threadId:params.threadId,turnId:'turn-fixture',item:{type:'agentMessage',text:'{"answer":"ok"}'}});
  notify('turn/completed',{threadId:params.threadId,turn:{id:'turn-fixture',status:'completed'}});
 }
});
`,
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
      if (provider === "codex") {
        const connection = await fetch(`${fixture.origin}/api/provider-connections/codex/connect`, {
          method: "POST",
          headers,
        })
        expect(connection.status).toBe(200)
      }
      const choices = await fetch(`${fixture.origin}/api/study-setup/revision-fixture`, { headers })
      expect(await choices.json()).toMatchObject({
        choices: expect.arrayContaining([
          { provider, model: "offered/model", label: expect.any(String) },
        ]),
      })
      const draft = await fetch(`${fixture.origin}/api/study-setup/revision-fixture`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          provider,
          model: "offered/model",
          scope: "partial",
          chapters: ["chapter-two.xhtml"],
        }),
      })
      expect(draft.status).toBe(201)
      const { setupId } = z.object({ setupId: z.string() }).parse(await draft.json())
      const send = await fetch(`${fixture.origin}/api/study-setup/revision-fixture/${setupId}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ decision: "send" }),
      })
      expect(send.status).toBe(200)
      const grant = fixture.storage.sources.getGrant(`grant-${setupId}`)
      if (!grant) throw new TypeError("Missing approved grant")
      const inputRevisionId = fixture.storage.workflow.ensureAnalysisInput(setupId)
      fixture.storage.execution.appendRun({
        id: "acceptance-run",
        inputRevisionId,
        budget: {},
        reservedCalls: 0,
        state: "running",
      })
      fixture.storage.execution.appendJob({
        id: "acceptance-job",
        runId: "acceptance-run",
        inputRevisionId,
        setupRevisionId: setupId,
        provider,
        model: "offered/model",
        promptVersion: "analysis-1",
        schemaVersion: "analysis-1",
        grant,
        stage: "analysis",
        checkpoint: null,
        cancellationRequested: false,
        usage: { kind: "unknown" },
        state: "queued",
      })
      const claim = fixture.storage.execution.claimNextJob({
        token: "acceptance-lease",
        now: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 120000).toISOString(),
      })
      if (claim?.state !== "running") throw new TypeError("Missing claim")
      const runner = new ProviderRunner({
        storage: fixture.storage,
        ownerId: grant.ownerId,
        installationId: grant.installationId,
        clock: () => new Date(),
        adapters: {
          [provider]: new ProviderAdapter({
            provider,
            codex: fixture.storage.providerConnections.codex(grant.ownerId, grant.installationId),
          }),
        },
      })
      expect(
        await runner.execute(claim, {
          instruction: "Return the synthetic answer.",
          schema: z.object({ answer: z.literal("ok") }),
        }),
      ).toMatchObject({ state: "completed", provider, model: "offered/model" })
      if (provider === "openrouter") expect(calls).toHaveLength(1)
    } finally {
      await fixture.close()
      await new Promise<void>((resolve) => wire.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    }
  },
)
