import { BookMapPipeline } from "@reading-studio/generation"
import { queueQuestions } from "@reading-studio/generation/queue-questions"
import type { Storage } from "@reading-studio/storage"

export function studySetupSend(storage: Storage, queueFollowup = true) {
  return (input: {
    readonly setupId: string
    readonly grantId: string
    readonly ownerId: string
    readonly installationId: string
  }) => {
    const analysis = new BookMapPipeline({
      storage,
      ownerId: input.ownerId,
      installationId: input.installationId,
    }).prepare(input.setupId, input.grantId)
    if (queueFollowup) queueQuestions(storage, input.setupId, input.grantId, analysis)
  }
}
