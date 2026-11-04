import type { StorageContext } from "./database.ts"
import type { FullBookConsentRepository } from "./full-book-consent.ts"
import { acceptFullBookReply } from "./full-book-execution-accept.ts"
import { FullBookExecutionAttempts } from "./full-book-execution-attempts.ts"
import { fullBookAttempts } from "./full-book-execution-history.ts"
import { FullBookExecutionJobs } from "./full-book-execution-jobs.ts"
import { FullBookExecutionStore } from "./full-book-execution-store.ts"

export class FullBookExecutionRepository {
  private readonly store: FullBookExecutionStore
  private readonly jobs: FullBookExecutionJobs
  private readonly charges: FullBookExecutionAttempts
  constructor(context: StorageContext, consents: FullBookConsentRepository) {
    this.store = new FullBookExecutionStore(context, consents)
    this.jobs = new FullBookExecutionJobs(this.store)
    this.charges = new FullBookExecutionAttempts(this.store)
  }
  claim(input: unknown) {
    return this.jobs.claim(input)
  }
  reserve(input: unknown) {
    return this.charges.reserve(input)
  }
  beforeWrite(input: unknown) {
    return this.charges.beforeWrite(input)
  }
  receive(input: unknown) {
    return this.charges.receive(input)
  }
  accept(input: unknown) {
    return acceptFullBookReply(this.store, input)
  }
  recover(input: unknown) {
    return this.jobs.recover(input)
  }
  interrupt(input: unknown) {
    return this.jobs.interrupt(input)
  }
  resolve(input: unknown) {
    return this.jobs.resolve(input)
  }
  cancel(id: string, reason: string) {
    return this.jobs.cancel(id, reason)
  }
  attempts(id: string) {
    return this.store.sqlite.transaction(() => fullBookAttempts(this.store.sqlite, id))()
  }
  receipts(id: string) {
    return this.store.sqlite.transaction(() => this.store.snapshot(id, false).receipts)()
  }
}
