export type ClauseType = "mandatory" | "scoring" | "evidence";
export type ComplianceStatus =
  | "compliant"
  | "deviation"
  | "clarification"
  | "pending";
export type ReviewRole =
  | "procurement"
  | "reviewer_a"
  | "reviewer_b"
  | "chair";
export type ClarificationStatus = "open" | "responded" | "overdue";
export type VersionStatus = "draft" | "finalized" | "invalidated";
export type SupplierStatus = "active" | "withdrawn";
export type ProofReferenceState =
  | "confirmed"
  | "pending_confirmation"
  | "out_of_bounds"
  | "unregistered"
  | "invalidated";

export interface ReviewerOpinion {
  id: string;
  responseId: string;
  reviewer: string;
  role: ReviewRole;
  decision: ComplianceStatus;
  score: number;
  comment: string;
  createdAt: string;
  invalidatedAt?: string;
  invalidReason?: string;
}

export interface Clarification {
  id: string;
  responseId: string;
  clauseId: string;
  round: number;
  requestText: string;
  supplierResponse?: string;
  requestedAt: string;
  dueAt: string;
  respondedAt?: string;
  status: ClarificationStatus;
}

export interface ProofReference {
  boundaryId: string;
  materialVersion: string;
  confirmedBy: string;
  confirmedAt: string;
}

export interface ProofBoundary {
  id: string;
  fingerprint: string;
  materialVersion: string;
  supplierIds: string[];
  clauseIds: string[];
  adjudicator: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProofSnapshot {
  fingerprint: string;
  materialVersion: string;
  responseIds: string[];
  adjudicator: string;
}

export interface SupplierResponse {
  id: string;
  clauseId: string;
  supplierId: string;
  supplierName: string;
  status: ComplianceStatus;
  responseText: string;
  claimedScore: number;
  attachmentName: string;
  proofFingerprint: string;
  submittedBy: string;
  submittedAt: string;
  reviewRound: number;
  proofReference?: ProofReference;
  referenceState: ProofReferenceState;
  reviews: ReviewerOpinion[];
  clarifications: Clarification[];
}

export interface Clause {
  id: string;
  code: string;
  title: string;
  category: string;
  requirement: string;
  type: ClauseType;
  weight: number;
  parentId?: string;
  evidenceRequired: boolean;
  order: number;
  responses: SupplierResponse[];
  children?: ClauseTreeNode[];
}

export interface ClauseTreeNode extends Clause {
  children: ClauseTreeNode[];
}

export interface ReviewVersion {
  id: string;
  version: string;
  label: string;
  status: VersionStatus;
  createdAt: string;
  createdBy: string;
  signedBy: string[];
  clauseCount: number;
  responseCount: number;
  contentHash: string;
  proofSnapshots: ProofSnapshot[];
  invalidatedAt?: string;
  invalidReason?: string;
}

export interface AuditLog {
  id: string;
  at: string;
  actor: string;
  action: string;
  entity: string;
  detail: string;
}

export interface DashboardStats {
  totalClauses: number;
  mandatoryCount: number;
  pendingReviews: number;
  differences: number;
  overdueClarifications: number;
  reusedProofs: number;
  unconfirmedProofs: number;
  activeVersion: string;
}

export interface Supplier {
  id: string;
  name: string;
  status: SupplierStatus;
}

export interface ClauseFilters {
  keyword: string;
  category: string;
  type: ClauseType | "all";
  differencesOnly: boolean;
}

export interface ReviewState {
  clauses: Clause[];
  versions: ReviewVersion[];
  auditLogs: AuditLog[];
  dashboard?: DashboardStats;
  suppliers: Supplier[];
  proofBoundaries: ProofBoundary[];
  filters: ClauseFilters;
  role: ReviewRole;
  selectedSupplierIds: string[];
  loading: boolean;
  saving: boolean;
  error?: string;
  toast?: string;
  proofConflict?: ProofConflict;
}

export interface WorkspaceQueryResult {
  workspace: {
    clauses: Clause[];
    versions: ReviewVersion[];
    auditLogs: AuditLog[];
    dashboard: DashboardStats;
    suppliers: Supplier[];
    proofBoundaries: ProofBoundary[];
  };
}

export interface AssessmentInput {
  responseId: string;
  decision: ComplianceStatus;
  score: number;
  comment: string;
  reviewer: string;
  role: ReviewRole;
}

export interface ClarificationInput {
  responseId: string;
  requestText: string;
  dueAt: string;
  actor: string;
}

export interface ClarificationResponseInput {
  clarificationId: string;
  responseText: string;
  actor: string;
}

export interface FinalizeVersionInput {
  label: string;
  actor: string;
  role: ReviewRole;
}

export interface RegisterProofBoundaryInput {
  fingerprint: string;
  materialVersion: string;
  supplierIds: string[];
  clauseIds: string[];
  actor: string;
  role: ReviewRole;
}

export interface UpdateProofBoundaryInput {
  id: string;
  baseRevision: number;
  materialVersion: string;
  supplierIds: string[];
  clauseIds: string[];
  actor: string;
  role: ReviewRole;
}

export interface WithdrawSupplierInput {
  supplierId: string;
  actor: string;
  role: ReviewRole;
}

export interface ProofBoundarySaveResult {
  conflict: boolean;
  boundary: ProofBoundary;
}

export interface ProofConflict {
  fingerprint: string;
  revision: number;
  materialVersion: string;
  adjudicator: string;
}

export const roleProfiles: Record<ReviewRole, { name: string; label: string }> = {
  procurement: { name: "采购专员", label: "采购人员" },
  reviewer_a: { name: "陈评审", label: "技术评审员 A" },
  reviewer_b: { name: "李评审", label: "技术评审员 B" },
  chair: { name: "赵主任", label: "评审组长" },
};

export const complianceLabels: Record<ComplianceStatus, string> = {
  compliant: "符合",
  deviation: "偏离",
  clarification: "待澄清",
  pending: "待评审",
};

export const clauseTypeLabels: Record<ClauseType, string> = {
  mandatory: "否决项",
  scoring: "评分项",
  evidence: "证明项",
};

export const statusSeverity: Record<ComplianceStatus, string> = {
  compliant: "success",
  deviation: "danger",
  clarification: "warn",
  pending: "secondary",
};

export const proofReferenceStateLabels: Record<ProofReferenceState, string> = {
  confirmed: "已确认",
  pending_confirmation: "待重新确认",
  out_of_bounds: "引用越界",
  unregistered: "未登记边界",
  invalidated: "已失效",
};
