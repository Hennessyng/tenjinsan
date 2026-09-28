import { randomUUID } from "node:crypto"
import {
  AnalysisCacheInput,
  analysisCacheKey,
  OwnerId,
  SetupRevisionId,
  StudyId,
  StudySetupRevision,
} from "@reading-studio/contracts"
import { z } from "zod"
import type { StorageContext } from "./database.ts"
import { ContractBoundaryError } from "./errors.ts"
import type { Storage } from "./storage.ts"

const Identity = z.strictObject({ studyId: StudyId, ownerId: OwnerId })
const Expected = Identity.extend({ expectedSetupRevisionId: SetupRevisionId })
const Revision = Expected.extend({
  analysis: AnalysisCacheInput,
  generation: StudySetupRevision.unwrap().shape.generation,
})
const Parent = z.object({ studyId: StudyId, setupRevisionId: SetupRevisionId })

export class RevisionRepository {
  constructor(
    private readonly context: StorageContext,
    private readonly storage: Pick<Storage, "sources" | "workflow" | "interviews" | "briefs">,
  ) {}

  current(input: unknown) {
    const identity = Identity.parse(input)
    const { sources, workflow, briefs } = this.storage
    const setup = sources.getLatestSetup(identity.studyId)
    if (
      !setup ||
      !sources
        .listStudiesByEdition(setup.editionId)
        .some((study) => study.id === identity.studyId && study.ownerId === identity.ownerId)
    )
      throw new ContractBoundaryError("owned study revision")
    const parent = this.context.sqlite
      .prepare(
        "SELECT parent_study_id AS studyId, parent_setup_revision_id AS setupRevisionId FROM study_forks WHERE study_id = ?",
      )
      .get(identity.studyId)
    return {
      setup,
      history: this.context.sqlite
        .prepare("SELECT record_json FROM setup_revisions WHERE study_id = ? ORDER BY rowid DESC")
        .all(identity.studyId)
        .map((row) =>
          StudySetupRevision.parse(
            JSON.parse(z.object({ record_json: z.string() }).parse(row).record_json),
          ),
        ),
      parent: parent ? Parent.parse(parent) : null,
      analysis: workflow.findSuccessfulAnalysis(analysisCacheKey(setup.analysis)),
      grant: sources.getGrant(`grant-${setup.id}`),
      brief: briefs.current(identity.studyId),
      descendants: briefs.descendants(identity.studyId),
    }
  }

  fork(input: unknown) {
    const write = Expected.parse(input)
    return this.context.sqlite
      .transaction(() => {
        const current = this.current({ studyId: write.studyId, ownerId: write.ownerId })
        if (current.setup.id !== write.expectedSetupRevisionId)
          throw new ContractBoundaryError("stale study revision")
        const { sources, interviews } = this.storage
        const study = sources.createStudy({
          id: randomUUID(),
          ownerId: write.ownerId,
          editionId: current.setup.editionId,
        })
        const setup = sources.appendSetup({
          record: { ...current.setup, id: randomUUID(), studyId: study.id },
          parentRevisionId: null,
        })
        this.context.sqlite
          .prepare(
            "INSERT INTO study_forks (study_id, parent_study_id, parent_setup_revision_id) VALUES (?, ?, ?)",
          )
          .run(study.id, write.studyId, current.setup.id)
        const interview = interviews.latest(write.studyId)
        if (interview && current.analysis?.id === interview.analysisRevisionId) {
          interviews.create({
            ...interview,
            id: randomUUID(),
            contextRevisionId: randomUUID(),
            studyId: study.id,
          })
        }
        return this.current({ studyId: setup.studyId, ownerId: write.ownerId })
      })
      .immediate()
  }

  revise(input: unknown) {
    const write = Revision.parse(input)
    return this.context.sqlite
      .transaction(() => {
        const current = this.current({ studyId: write.studyId, ownerId: write.ownerId })
        if (current.setup.id !== write.expectedSetupRevisionId)
          throw new ContractBoundaryError("stale study revision")
        this.storage.sources.appendSetup({
          record: {
            ...current.setup,
            id: randomUUID(),
            analysis: write.analysis,
            generation: write.generation,
          },
          parentRevisionId: current.setup.id,
        })
        return this.current({ studyId: write.studyId, ownerId: write.ownerId })
      })
      .immediate()
  }
}
