import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import { z } from "zod"
import { projectOwnerJobs } from "../../apps/server/src/job-projection.ts"
import { sourceViewerFixture } from "../../apps/server/src/testing/source-viewer-fixture.ts"
import { ProviderAdapter, ProviderRunner } from "../../packages/providers/src/index.ts"

afterEach(() => vi.unstubAllEnvs())

it.each([
  { scenario: "missing-usage", state: "paused", code: "unavailable" },
  { scenario: "late-usage", state: "completed", code: null },
  { scenario: "late-oversized", state: "paused", code: "output-limit" },
  { scenario: "usageLimitExceeded", state: "paused", code: "rate-limited" },
  { scenario: "rateLimitExceeded", state: "paused", code: "rate-limited" },
] as const)(
  "preserves Codex login after $scenario without replay",
  async ({ scenario, state, code }) => {
    const directory = await mkdtemp(join(tmpdir(), "ten-1-completion-"))
    const binary = join(directory, "codex-fixture")
    const calls = join(directory, "calls")
    await writeFile(
      binary,
      `#!/usr/bin/env node
const { createInterface } = require('node:readline');
const { writeFileSync, appendFileSync } = require('node:fs');
const { join } = require('node:path');
const reply = (id, result) => console.log(JSON.stringify({id,result}));
const notify = (method, params) => console.log(JSON.stringify({method,params}));
createInterface({input:process.stdin}).on('line', line => {
 const {id,method,params} = JSON.parse(line);
 if (method === 'initialize') reply(id, {});
 if (method === 'account/read') reply(id, {account:{type:'chatgpt'}});
 if (method === 'account/login/start') {
  writeFileSync(join(process.env.CODEX_HOME, 'auth.json'), 'synthetic-login-marker');
  reply(id, {authUrl:'https://auth.openai.com/authorize?state=synthetic'});
 }
 if (method === 'model/list') reply(id, {data:[{model:'offered/model',displayName:'Offered model'}],nextCursor:null});
 if (method === 'thread/start') reply(id, {thread:{id:'thread-fixture'}});
 if (method === 'turn/start') {
  appendFileSync(${JSON.stringify(calls)}, JSON.stringify(params)+'\\n');
  reply(id, {turn:{id:'turn-fixture',status:'inProgress'}});
  notify('item/completed',{threadId:params.threadId,turnId:'turn-fixture',item:{type:'agentMessage',text:'{"answer":"ok"}'}});
  const failed = ${JSON.stringify(scenario)}.endsWith('Exceeded');
  notify('turn/completed',{threadId:params.threadId,turn:{id:'turn-fixture',status:failed?'failed':'completed',error:failed?{message:'PRIVATE diagnostic',codexErrorInfo:${JSON.stringify(scenario)},additionalDetails:null}:null}});
  if (${JSON.stringify(scenario)}.startsWith('late-')) setImmediate(() =>
   notify('thread/tokenUsage/updated',{threadId:params.threadId,turnId:'turn-fixture',tokenUsage:{last:{inputTokens:8,outputTokens:${scenario === "late-oversized" ? 6001 : 4}}}}));
 }
});
`,
      { mode: 0o700 },
    )
    vi.stubEnv("STUDIO_CODEX_BINARY", binary)
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined)
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
      expect(draft.status).toBe(201)
      const { setupId } = z.object({ setupId: z.string() }).parse(await draft.json())
      expect(
        (
          await fetch(`${fixture.origin}/api/study-setup/revision-fixture/${setupId}`, {
            method: "POST",
            headers,
            body: JSON.stringify({ decision: "send" }),
          })
        ).status,
      ).toBe(200)
      const grant = fixture.storage.sources.getGrant(`grant-${setupId}`)
      if (!grant) throw new TypeError("Missing approved grant")
      const inputRevisionId = fixture.storage.workflow.ensureAnalysisInput(setupId)
      fixture.storage.execution.appendRun({
        id: "completion-run",
        inputRevisionId,
        budget: {},
        reservedCalls: 0,
        state: "running",
      })
      fixture.storage.execution.appendJob({
        id: "completion-job",
        runId: "completion-run",
        inputRevisionId,
        setupRevisionId: setupId,
        provider: "codex",
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
        token: "completion-lease",
        now: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 120000).toISOString(),
      })
      if (claim?.state !== "running") throw new TypeError("Missing claim")
      const connection = fixture.storage.providerConnections.codex(
        grant.ownerId,
        grant.installationId,
      )
      const runner = new ProviderRunner({
        storage: fixture.storage,
        ownerId: grant.ownerId,
        installationId: grant.installationId,
        clock: () => new Date(),
        adapters: {
          codex: new ProviderAdapter({ provider: "codex", codex: connection, timeoutMs: 1000 }),
        },
      })

      const result = await runner.execute(claim, {
        instruction: "Synthetic answer",
        schema: z.object({ answer: z.literal("ok") }),
      })

      expect(result.state).toBe(state)
      expect(fixture.storage.execution.providerPause(claim.id)?.code ?? null).toBe(code)
      const key = createHash("sha256")
        .update(JSON.stringify([grant.ownerId, grant.installationId]))
        .digest("hex")
      const home = join(fixture.privateDataRoot, "provider-connections", key)
      expect(await readFile(join(home, "authorized"), "utf8")).toBe("pending")
      expect(await readFile(join(home, "auth.json"), "utf8")).toBe("synthetic-login-marker")
      expect(await connection.models()).toEqual([
        { provider: "codex", model: "offered/model", label: "Codex / Offered model" },
      ])
      const requests = (await readFile(calls, "utf8")).trim().split("\n")
      expect(requests).toHaveLength(1)
      expect(JSON.parse(requests[0] ?? "null")).not.toHaveProperty("max_output_tokens")
      expect(JSON.parse(requests[0] ?? "null")).not.toHaveProperty("maxOutputTokens")
      if (state === "paused") {
        const view = projectOwnerJobs(fixture.storage, grant.ownerId).jobs.find(
          (job) => job.id === claim.id,
        )
        expect(view).toMatchObject({
          state: "paused",
          canRetry: false,
          trace_id: expect.any(String),
          explanation: expect.any(String),
        })
        expect(JSON.stringify(log.mock.calls)).toContain(view?.trace_id)
        expect(JSON.stringify(view)).not.toContain("PRIVATE diagnostic")
        expect(
          fixture.storage.execution.claimNextJob({
            token: "again",
            now: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 120000).toISOString(),
          }),
        ).toBeNull()
      }
    } finally {
      log.mockRestore()
      await fixture.close()
      await rm(directory, { recursive: true, force: true })
    }
  },
)
