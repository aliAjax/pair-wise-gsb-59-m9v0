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
}

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
  /** 最近一次引用被确认/失效的轮次，结论失效后评审员需重新确认 */
  proofConfirmRound: number;
  /** 最近一次引用确认时间，未确认引用会阻止签字定稿 */
  proofConfirmedAt?: string;
  /** 最近一次引用确认人（裁定人） */
  proofConfirmedBy?: string;
  reviews: ReviewerOpinion[];
  clarifications: Clarification[];
}

export interface ProofBoundary {
  /** 即证明指纹，作为证明材料的唯一标识 */
  fingerprint: string;
  attachmentName: string;
  version: number;
  versionLabel: string;
  supplierId: string;
  supplierName: string;
  clauseIds: string[];
  /** 乐观锁版本号：两位评审员同时编辑时先到者保存，后到者收到冲突 */
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
  /** 定稿快照中实际固化的适用响应 */
  responseIds: string[];
  /** 快照固化时登记该证明边界的裁定人 */
  registeredBy: string;
  /** 快照固化时逐响应确认引用的评审员 */
  confirmedBy: string[];
  confirmedAt: string;
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
  /** 定稿快照固化的证明版本与适用响应 */
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

export interface ReviewDatabase {
  clauses: Clause[];
  responses: SupplierResponse[];
  proofBoundaries: ProofBoundary[];
  versions: ReviewVersion[];
  auditLogs: AuditLog[];
  suppliers: Array<{ id: string; name: string }>;
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
  /** 编辑时携带的乐观锁版本号，首次登记时为 0 */
  expectedBoundaryVersion: number;
  /** 冲突时仅保存草稿而不覆盖先到者的修改 */
  draftOnly: boolean;
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

/** 两位评审员同时修改同一证明边界时抛出，先到者已保存，后到者保留草稿 */
export class ProofBoundaryConflictError extends Error {
  readonly conflict = true as const;
  readonly current: ProofBoundary;
  readonly draft: RegisterProofBoundaryInput;

  constructor(current: ProofBoundary, draft: RegisterProofBoundaryInput) {
    super("证明边界已被其他评审员先行修改，当前编辑已保留为草稿。");
    this.name = "ProofBoundaryConflictError";
    this.current = current;
    this.draft = draft;
  }
}
