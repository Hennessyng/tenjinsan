import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { FULL_BOOK_MANAGED_PROFILE, FullBookManagedConsent } from "@reading-studio/contracts"
import { registerSyntheticSubscriptionTool } from "@reading-studio/storage/test-support"
import { vi } from "vitest"
import { z } from "zod"
import { directOutput } from "./full-book-direct-output.ts"
import { managedFixture } from "./full-book-managed-fixture.ts"
import { pluralMapOutput } from "./full-book-test-fixture.ts"

export function managedProcess(mode = "complete", hierarchyPolicy?: "direct-children-2") {
  const f = managedFixture(hierarchyPolicy),
    capture = join(f.options.privateDataRoot, "managed-frames.ndjson"),
    half = join(f.options.privateDataRoot, "half-frame")
  const binary = f.grant.policy.build.binaryPath
  const metadata = z
    .object({ status: z.unknown(), settings: z.unknown() })
    .parse(
      JSON.parse(
        readFileSync(
          new URL(
            "../../../packages/storage/tests/pinned-metadata-notifications.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    )
  const code = `#!${process.execPath}
import{createInterface}from'node:readline';import{appendFileSync,writeFileSync}from'node:fs';import{randomUUID}from'node:crypto';import Database from ${JSON.stringify(createRequire(import.meta.resolve("@reading-studio/storage/test-support")).resolve("better-sqlite3"))};
const capture=${JSON.stringify(capture)},half=${JSON.stringify(half)},mode=${JSON.stringify(mode)},output=mode==='replay'?'{':${JSON.stringify(JSON.stringify(hierarchyPolicy ? directOutput(f.budget.session, []) : pluralMapOutput(f.budget.session)))},thread=mode==='replay'?'fixed-replay-thread':randomUUID(),turn=randomUUID();
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');const result=(id,x)=>send({id,result:x});
const r=createInterface({input:process.stdin});r.on('line',line=>{appendFileSync(capture,line+'\\n');const m=JSON.parse(line);
if(m.method==='initialize')result(m.id,{});
if(m.method==='account/read')result(m.id,{account:{type:'chatgpt',email:null,planType:'fixture'}});
if(m.method==='model/list')result(m.id,{data:[{model:'synthetic-model',displayName:'fixture'}],nextCursor:null});
if(m.method==='mcpServerStatus/list')result(m.id,{data:[],nextCursor:null});
if(m.method==='thread/start'){result(m.id,{model:mode==='model-mismatch'?'foreign-model':m.params.model,modelProvider:'openai',cwd:m.params.cwd,instructionSources:[],runtimeWorkspaceRoots:[],approvalPolicy:'never',activePermissionProfile:{id:${JSON.stringify(FULL_BOOK_MANAGED_PROFILE)}},sandbox:{type:'readOnly',networkAccess:false},thread:{id:thread,turns:[]}});
if(mode==='halfwrite')queueMicrotask(()=>{r.close();process.stdin.removeAllListeners('data');process.stdin.once('data',chunk=>{writeFileSync(half,chunk.subarray(0,12));process.exit(0)});process.stdin.resume()})}
if(m.method==='turn/start'){const db=new Database(${JSON.stringify(f.options.databasePath)},{readonly:true});try{writeFileSync(${JSON.stringify(join(f.options.privateDataRoot, "before-write-ledger.json"))},JSON.stringify(db.prepare("SELECT COUNT(*) AS counted FROM external_attempts WHERE state='dispatching'").get()))}finally{db.close()}if(mode==='timeout'||mode==='stall')return;
if(mode==='rpc-error'){send({id:m.id,error:{code:-32602,message:'Invalid output schema. SYNTHETIC_SECRET_NEVER_PERSIST',data:{prompt:'SYNTHETIC_BOOK_NEVER_PERSIST'}}});return}
if(mode==='malformed-ack'){result(m.id,{wrong:{id:turn}});return}
if(mode==='failed-ack'){result(m.id,{turn:{id:turn,status:'failed',items:[],error:{message:'SYNTHETIC_SECRET_NEVER_PERSIST',codexErrorInfo:'badRequest',additionalDetails:null}}});return}
const ack={id:m.id,result:{turn:{id:turn,status:'inProgress',items:[],error:null}}};
if(mode==='queue-empty-pre-ack'){send({method:'thread/queue/changed',params:{threadId:thread,turnId:''}});send(ack);return}
if(mode==='queue-empty-post-ack'){send(ack);setTimeout(()=>send({method:'thread/queue/changed',params:{threadId:thread,turnId:''}}),50);return}
if(mode==='metadata-settings-after-ack'){const pair=${JSON.stringify([metadata.status, metadata.settings])};process.stdout.write([ack,...pair.map(packet=>({...packet,params:{...packet.params,threadId:thread}}))].map(x=>JSON.stringify(x)).join('\\n')+'\\n');return}
if(mode.startsWith('queue-')){const notices=[{method:'thread/status/changed',params:{threadId:thread,status:{type:'idle'}}},{method:'thread/queue/changed',params:{threadId:mode==='queue-foreign-thread'?'foreign':thread,...(mode==='queue-foreign-turn'?{turnId:'foreign'}:{}),...(mode==='queue-invalid'?{queue:'PRIVATE_PAYLOAD_SENTINEL'}:{})}}];process.stdout.write((mode==='queue-after-ack'?[ack,...notices]:[...notices,ack]).map(x=>JSON.stringify(x)).join('\\n')+'\\n')}else send(ack);
if(mode==='ack-stall')return;
if(mode==='raw-overflow'){const packets=[{method:'item/reasoning/textDelta',params:{threadId:thread,turnId:turn,itemId:'r',contentIndex:0,delta:'x'.repeat(80000)}},{method:'item/completed',params:{threadId:thread,turnId:turn,completedAtMs:0,item:{type:'agentMessage',id:'answer',phase:'final_answer',text:output}}},{method:'turn/completed',params:{threadId:thread,turn:{id:turn,status:'completed',items:[],error:null}}}];process.stdout.write(packets.map(x=>JSON.stringify(x)).join('\\n')+'\\n');return}
if(mode==='user-echo'){for(const method of ['item/started','item/completed'])send({method,params:{threadId:thread,turnId:turn,...(method==='item/started'?{startedAtMs:0}:{completedAtMs:0}),item:{type:'userMessage',id:'input-1',content:[{type:'text',text:'SYNTHETIC_BOOK_NEVER_PERSIST',text_elements:[]}]}}})}
if(mode==='legacy-event'){send({method:'codex/event/task_started',params:{id:turn,msg:{type:'task_started',secret:'SYNTHETIC_SECRET_NEVER_PERSIST'}}});return}
if(mode==='unknown-method'){send({method:'SYNTHETIC_SECRET_NEVER_PERSIST',params:{secret:'SYNTHETIC_BOOK_NEVER_PERSIST'}});return}
if(mode==='bad-json'){process.stdout.write('SYNTHETIC_SECRET_NEVER_PERSIST\\n');return}
if(mode==='bad-envelope'){send({id:null,secret:'SYNTHETIC_SECRET_NEVER_PERSIST'});return}
if(mode==='client-request'){send({id:77,method:'item/commandExecution/requestApproval',params:{secret:'SYNTHETIC_SECRET_NEVER_PERSIST'}});return}
if(mode==='early-close'){process.exit(7);return}
if(mode==='user-echo-foreign'){send({method:'item/completed',params:{threadId:thread,turnId:'foreign',item:{type:'userMessage',id:'input-1',content:[{type:'text',text:'SYNTHETIC_BOOK_NEVER_PERSIST'}]}}});return}
if(mode==='bad-usage'){send({method:'thread/tokenUsage/updated',params:{threadId:thread,tokenUsage:{last:{inputTokens:null,outputTokens:4}}}});return}
if(mode==='failed-turn'){send({method:'turn/completed',params:{threadId:thread,turn:{id:turn,status:'failed',items:[],error:{message:'SYNTHETIC_SECRET_NEVER_PERSIST',codexErrorInfo:'badRequest',additionalDetails:null}}}});return}
if(mode==='null-phase'){send({method:'item/completed',params:{threadId:thread,turnId:turn,completedAtMs:0,item:{id:'answer-1',type:'agentMessage',phase:null,text:output}}});return}
if(mode==='error-notification'){send({method:'error',params:{threadId:thread,turnId:turn,willRetry:false,error:{message:'Invalid output schema. SYNTHETIC_SECRET_NEVER_PERSIST',codexErrorInfo:'badRequest',additionalDetails:'SYNTHETIC_BOOK_NEVER_PERSIST'}}});return}
if(mode==='summary-part'||mode==='foreign-summary'){send({method:'item/reasoning/summaryPartAdded',params:{threadId:thread,turnId:mode==='foreign-summary'?'foreign-turn':turn,itemId:'reasoning-1',summaryIndex:0}})}
const tokens={inputTokens:8,outputTokens:4,cachedInputTokens:0,reasoningOutputTokens:0,totalTokens:12};send({method:'thread/tokenUsage/updated',params:{threadId:thread,turnId:turn,tokenUsage:{last:tokens,total:tokens,modelContextWindow:null}}});
if(mode==='tool'){send({method:'item/started',params:{threadId:thread,turnId:turn,item:{type:'commandExecution'}}});return}
send({method:'item/completed',params:{threadId:mode==='foreign-thread'?'foreign':thread,turnId:turn,completedAtMs:0,item:{id:'answer-1',type:'agentMessage',phase:mode==='partial'?'partial_answer':'final_answer',text:mode==='overflow'?'X'.repeat(20000):output}}});
if(mode==='seen-close'){process.exit(0);return}send({method:'turn/completed',params:{threadId:thread,turn:{id:turn,status:'completed',items:[],error:null}}})}});
`
  writeFileSync(binary, code, { mode: 0o700 })
  registerSyntheticSubscriptionTool(binary)
  vi.stubEnv("STUDIO_SUBSCRIPTION_CODEX_BINARY", binary)
  const grant = FullBookManagedConsent.parse({
    ...f.grant,
    policy: {
      ...f.grant.policy,
      build: {
        ...f.grant.policy.build,
        sha256: createHash("sha256").update(readFileSync(binary)).digest("hex"),
      },
      timeoutMs: mode === "timeout" || mode === "ack-stall" ? 50 : mode === "stall" ? 5000 : 1000,
      collectorBytes: 10000,
    },
  })
  f.storage.fullBookManagedConsents.approve(grant)
  return { ...f, grant, capture, half }
}
