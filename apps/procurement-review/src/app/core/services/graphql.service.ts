import { Injectable, inject } from "@angular/core";
import { Apollo, gql } from "apollo-angular";
import { Observable, map } from "rxjs";
import type {
  AssessmentInput,
  Clarification,
  ClarificationInput,
  ClarificationResponseInput,
  ConfirmProofReferenceInput,
  FinalizeVersionInput,
  ProofChangePayload,
  RegisterProofBoundaryInput,
  RegisterProofBoundaryPayload,
  ReviewVersion,
  ReviewerOpinion,
  SupplierResponse,
  UpdateProofVersionInput,
  WithdrawProofInput,
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
          proofConfirmRound
          proofConfirmedAt
          proofConfirmedBy
          proofReferenceStatus
          proofBoundary {
            fingerprint
            attachmentName
            version
            versionLabel
            supplierId
            supplierName
            clauseIds
            boundaryVersion
            withdrawn
            createdBy
            createdAt
            updatedBy
            updatedAt
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
      proofBoundaries {
        fingerprint
        attachmentName
        version
        versionLabel
        supplierId
        supplierName
        clauseIds
        boundaryVersion
        withdrawn
        createdBy
        createdAt
        updatedBy
        updatedAt
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
        proofBindings {
          fingerprint
          attachmentName
          version
          versionLabel
          supplierId
          supplierName
          clauseIds
          responseIds
          registeredBy
          confirmedBy
          confirmedAt
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
        activeVersion
        unconfirmedProofs
        staleProofConclusions
      }
      suppliers {
        id
        name
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

const REGISTER_PROOF_BOUNDARY = gql`
  mutation RegisterProofBoundary($input: RegisterProofBoundaryInput!) {
    registerProofBoundary(input: $input) {
      boundary {
        fingerprint
        attachmentName
        version
        versionLabel
        supplierId
        supplierName
        clauseIds
        boundaryVersion
        withdrawn
        createdBy
        createdAt
        updatedBy
        updatedAt
      }
      conflict
      serverBoundary {
        fingerprint
        attachmentName
        version
        versionLabel
        supplierId
        supplierName
        clauseIds
        boundaryVersion
        withdrawn
        createdBy
        createdAt
        updatedBy
        updatedAt
      }
      draftSaved
      affectedResponseIds
    }
  }
`;

const UPDATE_PROOF_VERSION = gql`
  mutation UpdateProofVersion($input: UpdateProofVersionInput!) {
    updateProofVersion(input: $input) {
      boundary {
        fingerprint
        attachmentName
        version
        versionLabel
        supplierId
        supplierName
        clauseIds
        boundaryVersion
        withdrawn
        createdBy
        createdAt
        updatedBy
        updatedAt
      }
      affectedResponseIds
      invalidatedVersionIds
    }
  }
`;

const WITHDRAW_PROOF = gql`
  mutation WithdrawProof($input: WithdrawProofInput!) {
    withdrawProof(input: $input) {
      boundary {
        fingerprint
        attachmentName
        version
        versionLabel
        supplierId
        supplierName
        clauseIds
        boundaryVersion
        withdrawn
        createdBy
        createdAt
        updatedBy
        updatedAt
      }
      affectedResponseIds
      invalidatedVersionIds
    }
  }
`;

const CONFIRM_PROOF_REFERENCE = gql`
  mutation ConfirmProofReference($input: ConfirmProofReferenceInput!) {
    confirmProofReference(input: $input) {
      id
      proofConfirmRound
      proofConfirmedAt
      proofConfirmedBy
      proofReferenceStatus
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
      proofBindings {
        fingerprint
        attachmentName
        version
        versionLabel
        supplierId
        supplierName
        clauseIds
        responseIds
        registeredBy
        confirmedBy
        confirmedAt
      }
    }
  }
`;

const RESET_REVIEW_DATA = gql`
  mutation ResetReviewData {
    resetReviewData
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

  registerProofBoundary(
    input: RegisterProofBoundaryInput,
  ): Observable<RegisterProofBoundaryPayload> {
    return this.apollo
      .mutate<{ registerProofBoundary: RegisterProofBoundaryPayload }>({
        mutation: REGISTER_PROOF_BOUNDARY,
        variables: { input },
        refetchQueries: ["ProcurementReviewWorkspace"],
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回证明边界登记结果。");
          }
          return result.data.registerProofBoundary;
        }),
      );
  }

  updateProofVersion(input: UpdateProofVersionInput): Observable<ProofChangePayload> {
    return this.apollo
      .mutate<{ updateProofVersion: ProofChangePayload }>({
        mutation: UPDATE_PROOF_VERSION,
        variables: { input },
        refetchQueries: ["ProcurementReviewWorkspace"],
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回证明版本更新结果。");
          }
          return result.data.updateProofVersion;
        }),
      );
  }

  withdrawProof(input: WithdrawProofInput): Observable<ProofChangePayload> {
    return this.apollo
      .mutate<{ withdrawProof: ProofChangePayload }>({
        mutation: WITHDRAW_PROOF,
        variables: { input },
        refetchQueries: ["ProcurementReviewWorkspace"],
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回证明撤回结果。");
          }
          return result.data.withdrawProof;
        }),
      );
  }

  confirmProofReference(
    input: ConfirmProofReferenceInput,
  ): Observable<SupplierResponse> {
    return this.apollo
      .mutate<{ confirmProofReference: SupplierResponse }>({
        mutation: CONFIRM_PROOF_REFERENCE,
        variables: { input },
        refetchQueries: ["ProcurementReviewWorkspace"],
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回引用确认结果。");
          }
          return result.data.confirmProofReference;
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
}
