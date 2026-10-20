import { join } from "node:path"
import { LocalSubscriptionSession } from "@reading-studio/contracts"
import { z } from "zod"
import { beginSubscriptionLogin, discoverLocalAccount } from "./subscription-auth-protocol.ts"
import { hasCustomSubscriptionProfile } from "./subscription-profile.ts"
import { SubscriptionSessionSlot } from "./subscription-session-slot.ts"
import {
  SubscriptionLoginError,
  type SubscriptionSessionStore,
} from "./subscription-session-store.ts"
import { SubscriptionToolRpc } from "./subscription-tool-rpc.ts"

export type LocalToolSession = {
  readonly state: LocalSubscriptionSession
  readonly rpc: SubscriptionToolRpc
}

export class SubscriptionLogin {
  private readonly active = new Map<
    string,
    { readonly rpc: SubscriptionToolRpc; readonly finished: Promise<void> }
  >()
  private closed = false
  private readonly processes = new Set<SubscriptionToolRpc>()
  private readonly slot: SubscriptionSessionSlot
  constructor(
    private readonly store: SubscriptionSessionStore,
    root: string,
  ) {
    this.slot = new SubscriptionSessionSlot(root, store.provider)
  }
  status(installation: string): LocalSubscriptionSession {
    const state = this.store.status(installation)
    if (state.status !== "pending") return state
    try {
      const lock = this.slot.lock(installation)
      try {
        this.store.save(installation, {
          ...state,
          status: "expired",
          authUrl: null,
          expiresAt: null,
        })
        return this.store.status(installation)
      } finally {
        lock.close()
      }
    } catch (error) {
      if (error instanceof SubscriptionLoginError && error.code === "connection-busy") return state
      throw error
    }
  }
  canDispatch(installation: string): boolean {
    const state = this.status(installation)
    return (
      state.status === "connected" &&
      state.generation !== null &&
      !hasCustomSubscriptionProfile(
        join(this.slot.directory(installation), state.generation),
        this.store.provider,
      )
    )
  }
  profileBlocked(installation: string): boolean {
    const state = this.status(installation)
    return hasCustomSubscriptionProfile(
      state.generation ? join(this.slot.directory(installation), state.generation) : undefined,
      this.store.provider,
    )
  }
  private open(installation: string, existing?: LocalSubscriptionSession) {
    if (this.closed) throw new SubscriptionLoginError("tool-unavailable")
    const lock = this.slot.lock(installation)
    try {
      const state = existing ?? this.store.begin(installation)
      if (this.store.status(installation).connectionRevision !== state.connectionRevision)
        throw new SubscriptionLoginError("connection-changed")
      if (!state.generation) throw new SubscriptionLoginError("protocol-error")
      this.slot.cleanup(installation, state.generation)
      const rpc = new SubscriptionToolRpc(
        join(this.slot.directory(installation), state.generation),
        this.store.provider,
      )
      this.processes.add(rpc)
      return { state, rpc, lock }
    } catch (error) {
      lock.close()
      throw error
    }
  }
  async connect(installation: string): Promise<LocalSubscriptionSession> {
    const { state, rpc, lock } = this.open(installation)
    try {
      await rpc.initialize()
      const login = await beginSubscriptionLogin(rpc, state)
      const pending = LocalSubscriptionSession.parse({
        ...state,
        authUrl: login.authUrl,
        expiresAt: login.expiresAt,
      })
      if (!this.store.save(installation, pending))
        throw new SubscriptionLoginError("connection-changed")
      const guard = setInterval(() => {
        if (
          this.closed ||
          Date.now() >= (pending.expiresAt ?? 0) ||
          this.status(installation).connectionRevision !== pending.connectionRevision
        )
          rpc.stop()
      }, 100)
      guard.unref()
      const finished = (async () => {
        try {
          if (!(await login.completed)) throw new SubscriptionLoginError("login-failed")
          const connected = await discoverLocalAccount(rpc, pending)
          if (!this.closed) this.store.save(installation, connected)
        } catch (error) {
          if (!(error instanceof SubscriptionLoginError || error instanceof z.ZodError)) throw error
          if (!this.closed)
            this.store.save(installation, {
              ...pending,
              status: "error",
              authUrl: null,
              expiresAt: null,
            })
        } finally {
          clearInterval(guard)
          rpc.stop()
          await rpc.closed
          this.processes.delete(rpc)
          try {
            if (!this.closed)
              this.slot.cleanup(installation, this.store.status(installation).generation)
          } finally {
            lock.close()
          }
          this.active.delete(installation)
        }
      })()
      this.active.set(installation, { rpc, finished })
      return pending
    } catch (error) {
      rpc.stop()
      await rpc.closed
      this.processes.delete(rpc)
      lock.close()
      if (!this.closed)
        this.store.save(installation, { ...state, status: "error", authUrl: null, expiresAt: null })
      if (error instanceof z.ZodError) throw new SubscriptionLoginError("protocol-error")
      throw error
    }
  }
  async refresh(installation: string): Promise<LocalSubscriptionSession> {
    const state = this.status(installation)
    if (state.status !== "connected" || !state.generation) return state
    const { rpc, lock } = this.open(installation, state)
    try {
      await rpc.initialize()
      const refreshed = await discoverLocalAccount(rpc, state)
      if (this.closed) throw new SubscriptionLoginError("tool-unavailable")
      return this.store.refreshed(installation, refreshed)
    } catch (error) {
      if (!(error instanceof SubscriptionLoginError || error instanceof z.ZodError)) throw error
      if (this.closed) throw error
      this.store.expire(installation, state)
      return this.status(installation)
    } finally {
      rpc.stop()
      await rpc.closed
      this.processes.delete(rpc)
      try {
        if (!this.closed)
          this.slot.cleanup(installation, this.store.status(installation).generation)
      } finally {
        lock.close()
      }
    }
  }
  async disconnect(installation: string): Promise<LocalSubscriptionSession> {
    const previous = this.status(installation)
    const disconnected = this.store.disconnect(installation)
    const active = this.active.get(installation)
    active?.rpc.stop()
    await active?.finished
    try {
      const lock = this.slot.lock(installation)
      try {
        if (previous.generation) this.slot.cleanup(installation, null)
      } finally {
        lock.close()
      }
    } catch (error) {
      if (!(error instanceof SubscriptionLoginError && error.code === "connection-busy"))
        throw error
    }
    return disconnected
  }
  async settled(installation: string): Promise<void> {
    await this.active.get(installation)?.finished
  }
  async withSession<T>(
    installation: string,
    operation: (session: LocalToolSession) => Promise<T>,
  ): Promise<T> {
    const current = this.status(installation)
    if (current.status !== "connected") throw new SubscriptionLoginError("login-failed")
    const { rpc, lock } = this.open(installation, current)
    let guard: ReturnType<typeof setInterval> | undefined
    let verified = false
    try {
      await rpc.initialize()
      const observed = await discoverLocalAccount(rpc, current)
      if (this.closed) throw new SubscriptionLoginError("tool-unavailable")
      const state = this.store.refreshed(installation, observed)
      verified = true
      guard = setInterval(() => {
        if (
          this.closed ||
          this.store.status(installation).connectionRevision !== state.connectionRevision
        )
          rpc.stop()
      }, 100)
      guard.unref()
      return await operation({ rpc, state })
    } catch (error) {
      if (
        !verified &&
        !this.closed &&
        (error instanceof SubscriptionLoginError || error instanceof z.ZodError)
      )
        this.store.expire(installation, current)
      throw error
    } finally {
      if (guard) clearInterval(guard)
      rpc.stop()
      await rpc.closed
      this.processes.delete(rpc)
      try {
        if (!this.closed)
          this.slot.cleanup(installation, this.store.status(installation).generation)
      } finally {
        lock.close()
      }
    }
  }
  close(): void {
    this.closed = true
    for (const rpc of this.processes) rpc.stop()
  }
}
