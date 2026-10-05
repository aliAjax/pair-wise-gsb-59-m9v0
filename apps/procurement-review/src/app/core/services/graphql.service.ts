import { Injectable, inject } from "@angular/core";
import { Apollo, gql } from "apollo-angular";
import { Observable, map } from "rxjs";
import type {
  AssessmentInput,
  Clarification,
  ClarificationInput,
  ClarificationResponseInput,
  FinalizeVersionInput,
  ProofBoundary,
  ProofBoundarySaveResult,
  RegisterProofBoundaryInput,
  ReviewVersion,
  ReviewerOpinion,
  Supplier,
  UpdateProofBoundaryInput,
  WithdrawSupplierInput,
  WorkspaceQueryResult,
} from "../models/review.models";

const WORKSPACE_QUERY = gql`
  query ProcurementReviewWorkspace {
    workspace {
      clauses {
        id
        code
        title
        category
        requirement
        type
        weight
        parentId
        evidenceRequired
        order
        responses {
          id
          clauseId
          supplierId
          supplierName
          status
          responseText
          claimedScore
          attachmentName
          proofFingerprint
          submittedBy
          submittedAt
          reviewRound
          referenceState
          proofReference {
            boundaryId
            materialVersion
            confirmedBy
            confirmedAt
          }
          reviews {
            id
            responseId
            reviewer
            role
            decision
            score
            comment
            createdAt
            invalidatedAt
            invalidReason
          }
          clarifications {
            id
            responseId
            clauseId
            round
            requestText
            supplierResponse
            requestedAt
            dueAt
            respondedAt
            status
          }
        }
      }
      versions {
        id
        version
        label
        status
        createdAt
        createdBy
        signedBy
        clauseCount
        responseCount
        contentHash
        invalidatedAt
        invalidReason
        proofSnapshots {
          fingerprint
          materialVersion
          responseIds
          adjudicator
        }
      }
      auditLogs {
        id
        at
        actor
        action
        entity
        detail
      }
      dashboard {
        totalClauses
        mandatoryCount
        pendingReviews
        differences
        overdueClarifications
        reusedProofs
        unconfirmedProofs
        activeVersion
      }
      suppliers {
        id
        name
        status
      }
      proofBoundaries {
        id
        fingerprint
        materialVersion
        supplierIds
        clauseIds
        adjudicator
        revision
        createdAt
        updatedAt
      }
    }
  }
`;

const SUBMIT_ASSESSMENT = gql`
  mutation SubmitAssessment($input: AssessmentInput!) {
    submitAssessment(input: $input) {
      id
      responseId
      reviewer
      role
      decision
      score
      comment
      createdAt
    }
  }
`;

const REQUEST_CLARIFICATION = gql`
  mutation RequestClarification($input: ClarificationInput!) {
    requestClarification(input: $input) {
      id
      responseId
      clauseId
      round
      requestText
      supplierResponse
      requestedAt
      dueAt
      respondedAt
      status
    }
  }
`;

const RESPOND_CLARIFICATION = gql`
  mutation RespondClarification($input: ClarificationResponseInput!) {
    respondClarification(input: $input) {
      id
      responseId
      clauseId
      round
      requestText
      supplierResponse
      requestedAt
      dueAt
      respondedAt
      status
    }
  }
`;

const FINALIZE_VERSION = gql`
  mutation FinalizeVersion($input: FinalizeVersionInput!) {
    finalizeVersion(input: $input) {
      id
      version
      label
      status
      createdAt
      createdBy
      signedBy
      clauseCount
      responseCount
      contentHash
    }
  }
`;

const RESET_REVIEW_DATA = gql`
  mutation ResetReviewData {
    resetReviewData
  }
`;

const REGISTER_PROOF_BOUNDARY = gql`
  mutation RegisterProofBoundary($input: RegisterProofBoundaryInput!) {
    registerProofBoundary(input: $input) {
      id
      fingerprint
      materialVersion
      supplierIds
      clauseIds
      adjudicator
      revision
      createdAt
      updatedAt
    }
  }
`;

const UPDATE_PROOF_BOUNDARY = gql`
  mutation UpdateProofBoundary($input: UpdateProofBoundaryInput!) {
    updateProofBoundary(input: $input) {
      conflict
      boundary {
        id
        fingerprint
        materialVersion
        supplierIds
        clauseIds
        adjudicator
        revision
        createdAt
        updatedAt
      }
    }
  }
`;

const WITHDRAW_SUPPLIER = gql`
  mutation WithdrawSupplier($input: WithdrawSupplierInput!) {
    withdrawSupplier(input: $input) {
      id
      name
      status
    }
  }
`;

@Injectable({ providedIn: "root" })
export class ReviewGraphqlService {
  private readonly apollo = inject(Apollo);

  loadWorkspace(): Observable<WorkspaceQueryResult> {
    return this.apollo
      .query<WorkspaceQueryResult>({
        query: WORKSPACE_QUERY,
        fetchPolicy: "network-only",
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回评审工作区。");
          }
          return result.data as WorkspaceQueryResult;
        }),
      );
  }

  submitAssessment(input: AssessmentInput): Observable<ReviewerOpinion> {
    return this.apollo
      .mutate<{ submitAssessment: ReviewerOpinion }>({
        mutation: SUBMIT_ASSESSMENT,
        variables: { input },
        refetchQueries: ["ProcurementReviewWorkspace"],
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回评审意见。");
          }
          return result.data.submitAssessment;
        }),
      );
  }

  requestClarification(input: ClarificationInput): Observable<Clarification> {
    return this.apollo
      .mutate<{ requestClarification: Clarification }>({
        mutation: REQUEST_CLARIFICATION,
        variables: { input },
        refetchQueries: ["ProcurementReviewWorkspace"],
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回澄清记录。");
          }
          return result.data.requestClarification;
        }),
      );
  }

  respondClarification(
    input: ClarificationResponseInput,
  ): Observable<Clarification> {
    return this.apollo
      .mutate<{ respondClarification: Clarification }>({
        mutation: RESPOND_CLARIFICATION,
        variables: { input },
        refetchQueries: ["ProcurementReviewWorkspace"],
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回澄清回复。");
          }
          return result.data.respondClarification;
        }),
      );
  }

  finalizeVersion(input: FinalizeVersionInput): Observable<ReviewVersion> {
    return this.apollo
      .mutate<{ finalizeVersion: ReviewVersion }>({
        mutation: FINALIZE_VERSION,
        variables: { input },
        refetchQueries: ["ProcurementReviewWorkspace"],
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回版本信息。");
          }
          return result.data.finalizeVersion;
        }),
      );
  }

  resetReviewData(): Observable<boolean> {
    return this.apollo
      .mutate<{ resetReviewData: boolean }>({
        mutation: RESET_REVIEW_DATA,
        refetchQueries: ["ProcurementReviewWorkspace"],
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回重置结果。");
          }
          return result.data.resetReviewData;
        }),
      );
  }

  registerProofBoundary(
    input: RegisterProofBoundaryInput,
  ): Observable<ProofBoundary> {
    return this.apollo
      .mutate<{ registerProofBoundary: ProofBoundary }>({
        mutation: REGISTER_PROOF_BOUNDARY,
        variables: { input },
        refetchQueries: ["ProcurementReviewWorkspace"],
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回证明边界。");
          }
          return result.data.registerProofBoundary;
        }),
      );
  }

  updateProofBoundary(
    input: UpdateProofBoundaryInput,
  ): Observable<ProofBoundarySaveResult> {
    return this.apollo
      .mutate<{ updateProofBoundary: ProofBoundarySaveResult }>({
        mutation: UPDATE_PROOF_BOUNDARY,
        variables: { input },
        refetchQueries: ["ProcurementReviewWorkspace"],
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回边界保存结果。");
          }
          return result.data.updateProofBoundary;
        }),
      );
  }

  withdrawSupplier(input: WithdrawSupplierInput): Observable<Supplier> {
    return this.apollo
      .mutate<{ withdrawSupplier: Supplier }>({
        mutation: WITHDRAW_SUPPLIER,
        variables: { input },
        refetchQueries: ["ProcurementReviewWorkspace"],
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回供应商状态。");
          }
          return result.data.withdrawSupplier;
        }),
      );
  }
}
