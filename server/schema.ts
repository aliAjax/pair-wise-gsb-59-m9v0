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
    invalidated
  }

  enum SupplierStatus {
    active
    withdrawn
  }

  enum ProofReferenceState {
    confirmed
    pending_confirmation
    out_of_bounds
    unregistered
    invalidated
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
    invalidatedAt: String
    invalidReason: String
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

  type ProofReference {
    boundaryId: String!
    materialVersion: String!
    confirmedBy: String!
    confirmedAt: String!
  }

  type ProofBoundary {
    id: ID!
    fingerprint: String!
    materialVersion: String!
    supplierIds: [String!]!
    clauseIds: [String!]!
    adjudicator: String!
    revision: Int!
    createdAt: String!
    updatedAt: String!
  }

  type ProofSnapshot {
    fingerprint: String!
    materialVersion: String!
    responseIds: [String!]!
    adjudicator: String!
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
    proofReference: ProofReference
    referenceState: ProofReferenceState!
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
    proofSnapshots: [ProofSnapshot!]!
    invalidatedAt: String
    invalidReason: String
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
    unconfirmedProofs: Int!
    activeVersion: String!
  }

  type Supplier {
    id: ID!
    name: String!
    status: SupplierStatus!
  }

  type WorkspaceData {
    clauses: [Clause!]!
    versions: [ReviewVersion!]!
    auditLogs: [AuditLog!]!
    dashboard: DashboardStats!
    suppliers: [Supplier!]!
    proofBoundaries: [ProofBoundary!]!
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
    materialVersion: String!
    supplierIds: [String!]!
    clauseIds: [String!]!
    actor: String!
    role: ReviewRole!
  }

  input UpdateProofBoundaryInput {
    id: ID!
    baseRevision: Int!
    materialVersion: String!
    supplierIds: [String!]!
    clauseIds: [String!]!
    actor: String!
    role: ReviewRole!
  }

  input WithdrawSupplierInput {
    supplierId: ID!
    actor: String!
    role: ReviewRole!
  }

  type ProofBoundarySaveResult {
    conflict: Boolean!
    boundary: ProofBoundary!
  }

  type Query {
    workspace: WorkspaceData!
    dashboard: DashboardStats!
  }

  type Mutation {
    submitAssessment(input: AssessmentInput!): ReviewerOpinion!
    requestClarification(input: ClarificationInput!): Clarification!
    respondClarification(input: ClarificationResponseInput!): Clarification!
    finalizeVersion(input: FinalizeVersionInput!): ReviewVersion!
    registerProofBoundary(input: RegisterProofBoundaryInput!): ProofBoundary!
    updateProofBoundary(input: UpdateProofBoundaryInput!): ProofBoundarySaveResult!
    withdrawSupplier(input: WithdrawSupplierInput!): Supplier!
    resetReviewData: Boolean!
  }
`);
