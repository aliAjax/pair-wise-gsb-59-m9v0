import { createActionGroup, emptyProps, props } from "@ngrx/store";
import type {
  AssessmentInput,
  ClauseFilters,
  ClarificationInput,
  ClarificationResponseInput,
  ConfirmProofReferenceInput,
  FinalizeVersionInput,
  RegisterProofBoundaryInput,
  ReviewRole,
  ReviewState,
  UpdateProofVersionInput,
  WithdrawProofInput,
} from "../models/review.models";

export const ReviewActions = createActionGroup({
  source: "Procurement Review",
  events: {
    "Load Review Data": emptyProps(),
    "Load Review Data Success": props<{
      workspace: Pick<
        ReviewState,
        | "clauses"
        | "proofBoundaries"
        | "versions"
        | "auditLogs"
        | "dashboard"
        | "suppliers"
      >;
      toast?: string;
    }>(),
    "Load Review Data Failure": props<{ error: string }>(),
    "Set Role": props<{ role: ReviewRole }>(),
    "Set Filters": props<{ filters: Partial<ClauseFilters> }>(),
    "Toggle Supplier": props<{ supplierId: string }>(),
    "Clear Toast": emptyProps(),
    "Submit Assessment": props<{ input: AssessmentInput }>(),
    "Request Clarification": props<{ input: ClarificationInput }>(),
    "Respond Clarification": props<{ input: ClarificationResponseInput }>(),
    "Register Proof Boundary": props<{ input: RegisterProofBoundaryInput }>(),
    "Update Proof Version": props<{ input: UpdateProofVersionInput }>(),
    "Withdraw Proof": props<{ input: WithdrawProofInput }>(),
    "Confirm Proof Reference": props<{ input: ConfirmProofReferenceInput }>(),
    "Finalize Version": props<{ input: FinalizeVersionInput }>(),
    "Reset Review Data": emptyProps(),
  },
});
