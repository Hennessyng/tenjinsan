export class StorageError extends Error {
  override readonly name: string = "StorageError"
}

export class MaintenancePausedError extends StorageError {
  override readonly name = "MaintenancePausedError"

  constructor() {
    super("New provider dispatch is paused for library maintenance")
  }
}

export class ContractBoundaryError extends StorageError {
  override readonly name: string = "ContractBoundaryError"

  constructor(
    readonly boundary: string,
    options?: ErrorOptions,
  ) {
    super(`invalid ${boundary} contract`, options)
  }
}

export class StoredRecordError extends StorageError {
  override readonly name: string = "StoredRecordError"

  constructor(
    readonly entity: string,
    readonly id: string,
    options?: ErrorOptions,
  ) {
    super(`stored ${entity} ${id} is invalid`, options)
  }
}

export class ImmutableRecordError extends StorageError {
  override readonly name: string = "ImmutableRecordError"

  constructor(
    readonly entity: string,
    readonly id: string,
    options?: ErrorOptions,
  ) {
    super(`${entity} ${id} already exists and is immutable`, options)
  }
}

export class StorageConstraintError extends StorageError {
  override readonly name: string = "StorageConstraintError"

  constructor(
    readonly entity: string,
    options?: ErrorOptions,
  ) {
    super(`${entity} violates storage lineage`, options)
  }
}

export class StorageWriteError extends StorageError {
  override readonly name: string = "StorageWriteError"

  constructor(
    readonly entity: string,
    options?: ErrorOptions,
  ) {
    super(`failed to persist ${entity}`, options)
  }
}

export class PrivatePathError extends StorageError {
  override readonly name: string = "PrivatePathError"

  constructor(
    readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(`invalid private blob path: ${reason}`, options)
  }
}

export class LeaseFenceError extends StorageError {
  override readonly name = "LeaseFenceError"

  constructor(readonly jobId: string) {
    super(`job ${jobId} lease is expired or no longer owned by this worker`)
  }
}

export class ExecutionTransitionError extends StorageError {
  override readonly name = "ExecutionTransitionError"

  constructor(
    readonly entity: string,
    readonly id: string,
    readonly expectedState: string,
  ) {
    super(`${entity} ${id} is not in ${expectedState}`)
  }
}
