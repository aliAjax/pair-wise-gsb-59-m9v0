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
export type VersionStatus = "draft" | "finalized";
export type ProofReferenceStatus =
  | "unregistered"
  | "confirmed"
  | "stale"
  | "out_of_scope";

export interface ReviewerOpinion {
  id: string;
  responseId: string;
  reviewer: string;
  role: ReviewRole;
  decision: ComplianceStatus;
  score: number;
  comment: string;
  createdAt: string;
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
  proofConfirmRound: number;
  proofConfirmedAt?: string | null;
  proofConfirmedBy?: string | null;
  proofReferenceStatus: ProofReferenceStatus;
  proofBoundary?: ProofBoundary | null;
  reviews: ReviewerOpinion[];
  clarifications: Clarification[];
}

export interface ProofBoundary {
  fingerprint: string;
  attachmentName: string;
  version: number;
  versionLabel: string;
  supplierId: string;
  supplierName: string;
  clauseIds: string[];
  boundaryVersion: number;
  withdrawn: boolean;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

export interface ProofSnapshotBinding {
  fingerprint: string;
  attachmentName: string;
  version: number;
  versionLabel: string;
  supplierId: string;
  supplierName: string;
  clauseIds: string[];
  responseIds: string[];
  registeredBy: string;
  confirmedBy: string[];
  confirmedAt: string;
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
  proofBindings: ProofSnapshotBinding[];
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
  activeVersion: string;
  unconfirmedProofs: number;
  staleProofConclusions: number;
}

export interface Supplier {
  id: string;
  name: string;
}

export interface ClauseFilters {
  keyword: string;
  category: string;
  type: ClauseType | "all";
  differencesOnly: boolean;
}

export interface ReviewState {
  clauses: Clause[];
  proofBoundaries: ProofBoundary[];
  versions: ReviewVersion[];
  auditLogs: AuditLog[];
  dashboard?: DashboardStats;
  suppliers: Supplier[];
  filters: ClauseFilters;
  role: ReviewRole;
  selectedSupplierIds: string[];
  loading: boolean;
  saving: boolean;
  error?: string;
  toast?: string;
}

export interface WorkspaceQueryResult {
  workspace: {
    clauses: Clause[];
    proofBoundaries: ProofBoundary[];
    versions: ReviewVersion[];
    auditLogs: AuditLog[];
    dashboard: DashboardStats;
    suppliers: Supplier[];
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
  supplierId: string;
  clauseIds: string[];
  versionLabel: string;
  actor: string;
  role: ReviewRole;
  expectedBoundaryVersion: number;
  draftOnly: boolean;
}

export interface RegisterProofBoundaryPayload {
  boundary: ProofBoundary | null;
  conflict: boolean;
  serverBoundary: ProofBoundary | null;
  draftSaved: boolean;
  affectedResponseIds: string[];
}

export interface UpdateProofVersionInput {
  fingerprint: string;
  versionLabel: string;
  actor: string;
  role: ReviewRole;
}

export interface WithdrawProofInput {
  fingerprint: string;
  actor: string;
  role: ReviewRole;
}

export interface ConfirmProofReferenceInput {
  responseId: string;
  actor: string;
  role: ReviewRole;
}

export interface ProofChangePayload {
  boundary: ProofBoundary;
  affectedResponseIds: string[];
  invalidatedVersionIds: string[];
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

export const proofReferenceLabels: Record<ProofReferenceStatus, string> = {
  unregistered: "边界未登记",
  confirmed: "引用已确认",
  stale: "材料已更新待重认",
  out_of_scope: "引用越界",
};

export const proofReferenceSeverity: Record<ProofReferenceStatus, string> = {
  unregistered: "warn",
  confirmed: "success",
  stale: "danger",
  out_of_scope: "danger",
};
