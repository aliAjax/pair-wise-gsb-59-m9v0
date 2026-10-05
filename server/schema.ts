import { parse } from "graphql";

export const typeDefs = parse(`
  enum ClauseType {
    mandatory
    scoring
    evidence
  }

  enum ComplianceStatus {
    compliant
    deviation
    clarification
    pending
  }

  enum ReviewRole {
    procurement
    reviewer_a
    reviewer_b
    chair
  }

  enum ClarificationStatus {
    open
    responded
    overdue
  }

  enum VersionStatus {
    draft
    finalized
  }

  enum ProofReferenceStatus {
    unregistered
    confirmed
    stale
    out_of_scope
  }

  type ProofBoundary {
    fingerprint: String!
    attachmentName: String!
    version: Int!
    versionLabel: String!
    supplierId: String!
    supplierName: String!
    clauseIds: [String!]!
    boundaryVersion: Int!
    withdrawn: Boolean!
    createdBy: String!
    createdAt: String!
    updatedBy: String!
    updatedAt: String!
  }

  type ProofSnapshotBinding {
    fingerprint: String!
    attachmentName: String!
    version: Int!
    versionLabel: String!
    supplierId: String!
    supplierName: String!
    clauseIds: [String!]!
    responseIds: [String!]!
    registeredBy: String!
    confirmedBy: [String!]!
    confirmedAt: String!
  }

  type Clause {
    id: ID!
    code: String!
    title: String!
    category: String!
    requirement: String!
    type: ClauseType!
    weight: Int!
    parentId: String
    evidenceRequired: Boolean!
    order: Int!
    responses: [SupplierResponse!]!
  }

  type ReviewerOpinion {
    id: ID!
    responseId: String!
    reviewer: String!
    role: ReviewRole!
    decision: ComplianceStatus!
    score: Int!
    comment: String!
    createdAt: String!
  }

  type Clarification {
    id: ID!
    responseId: String!
    clauseId: String!
    round: Int!
    requestText: String!
    supplierResponse: String
    requestedAt: String!
    dueAt: String!
    respondedAt: String
    status: ClarificationStatus!
  }

  type SupplierResponse {
    id: ID!
    clauseId: String!
    supplierId: String!
    supplierName: String!
    status: ComplianceStatus!
    responseText: String!
    claimedScore: Int!
    attachmentName: String!
    proofFingerprint: String!
    submittedBy: String!
    submittedAt: String!
    reviewRound: Int!
    proofConfirmRound: Int!
    proofConfirmedAt: String
    proofConfirmedBy: String
    proofReferenceStatus: ProofReferenceStatus!
    proofBoundary: ProofBoundary
    reviews: [ReviewerOpinion!]!
    clarifications: [Clarification!]!
  }

  type ReviewVersion {
    id: ID!
    version: String!
    label: String!
    status: VersionStatus!
    createdAt: String!
    createdBy: String!
    signedBy: [String!]!
    clauseCount: Int!
    responseCount: Int!
    contentHash: String!
    proofBindings: [ProofSnapshotBinding!]!
  }

  type AuditLog {
    id: ID!
    at: String!
    actor: String!
    action: String!
    entity: String!
    detail: String!
  }

  type DashboardStats {
    totalClauses: Int!
    mandatoryCount: Int!
    pendingReviews: Int!
    differences: Int!
    overdueClarifications: Int!
    reusedProofs: Int!
    activeVersion: String!
    unconfirmedProofs: Int!
    staleProofConclusions: Int!
  }

  type Supplier {
    id: ID!
    name: String!
  }

  type WorkspaceData {
    clauses: [Clause!]!
    proofBoundaries: [ProofBoundary!]!
    versions: [ReviewVersion!]!
    auditLogs: [AuditLog!]!
    dashboard: DashboardStats!
    suppliers: [Supplier!]!
  }

  input AssessmentInput {
    responseId: ID!
    decision: ComplianceStatus!
    score: Int!
    comment: String!
    reviewer: String!
    role: ReviewRole!
  }

  input ClarificationInput {
    responseId: ID!
    requestText: String!
    dueAt: String!
    actor: String!
  }

  input ClarificationResponseInput {
    clarificationId: ID!
    responseText: String!
    actor: String!
  }

  input FinalizeVersionInput {
    label: String!
    actor: String!
    role: ReviewRole!
  }

  input RegisterProofBoundaryInput {
    fingerprint: String!
    supplierId: String!
    clauseIds: [String!]!
    versionLabel: String!
    actor: String!
    role: ReviewRole!
    expectedBoundaryVersion: Int!
    draftOnly: Boolean!
  }

  input UpdateProofVersionInput {
    fingerprint: String!
    versionLabel: String!
    actor: String!
    role: ReviewRole!
  }

  input WithdrawProofInput {
    fingerprint: String!
    actor: String!
    role: ReviewRole!
  }

  input ConfirmProofReferenceInput {
    responseId: ID!
    actor: String!
    role: ReviewRole!
  }

  type RegisterProofBoundaryPayload {
    boundary: ProofBoundary
    conflict: Boolean!
    serverBoundary: ProofBoundary
    draftSaved: Boolean!
    affectedResponseIds: [ID!]!
  }

  type ProofChangePayload {
    boundary: ProofBoundary!
    affectedResponseIds: [ID!]!
    invalidatedVersionIds: [ID!]!
  }

  type Query {
    workspace: WorkspaceData!
    dashboard: DashboardStats!
  }

  type Mutation {
    submitAssessment(input: AssessmentInput!): ReviewerOpinion!
    requestClarification(input: ClarificationInput!): Clarification!
    respondClarification(input: ClarificationResponseInput!): Clarification!
    registerProofBoundary(input: RegisterProofBoundaryInput!): RegisterProofBoundaryPayload!
    updateProofVersion(input: UpdateProofVersionInput!): ProofChangePayload!
    withdrawProof(input: WithdrawProofInput!): ProofChangePayload!
    confirmProofReference(input: ConfirmProofReferenceInput!): SupplierResponse!
    finalizeVersion(input: FinalizeVersionInput!): ReviewVersion!
    resetReviewData: Boolean!
  }
`);
