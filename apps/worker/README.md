# Worker

The worker executes persisted stage jobs through `@reading-studio/storage`. SQLite owns
lease claims, monotonic fence numbers, heartbeats, checkpoints, cancellation, call budgets,
and external-attempt receipts. Provider calls occur outside database transactions and must
receive `maxRetries: 0`; an accepted call without a durable receipt pauses as an unknown
outcome until an explicit retry or stop decision.

```sh
bun run --cwd apps/worker test:integration
bun run --cwd apps/worker manual:qa
```

The manual QA command uses synthetic fixtures only. It terminates a child worker after a
checkpoint, reopens the same temporary SQLite database, resumes after lease expiry, prints
job/attempt states, and removes the temporary directory.
