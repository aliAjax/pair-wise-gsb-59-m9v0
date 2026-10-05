import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import {
  createAudit,
  createClarificationId,
  createOpinionId,
  createProofBoundaryId,
  reviewDataStore,
} from "./data";
import { typeDefs } from "./schema";
import type {
  AssessmentInput,
  ClarificationInput,
  ClarificationResponseInput,
  Clause,
  DashboardStats,
  FinalizeVersionInput,
  ProofBoundary,
  ProofReferenceState,
  ProofSnapshot,
  RegisterProofBoundaryInput,
  ReviewDatabase,
  ReviewRole,
  SupplierResponse,
  UpdateProofBoundaryInput,
  WithdrawSupplierInput,
} from "./types";

const activeReviews = (response: SupplierResponse) =>
  response.reviews.filter((review) => !review.invalidatedAt);

// 计算响应引用证明的确认状态：边界登记、适用范围、材料版本与供应商状态共同决定。
const getReferenceState = (
  response: SupplierResponse,
  database: ReviewDatabase,
): ProofReferenceState => {
  const supplier = database.suppliers.find(
    (item) => item.id === response.supplierId,
  );
  if (supplier?.status === "withdrawn") {
    return "invalidated";
  }
  const boundary = database.proofBoundaries.find(
    (item) => item.fingerprint === response.proofFingerprint,
  );
  if (!boundary) {
    return "unregistered";
  }
  const inScope =
    boundary.supplierIds.includes(response.supplierId) &&
    boundary.clauseIds.includes(response.clauseId);
  if (!inScope) {
    return "out_of_bounds";
  }
  if (
    !response.proofReference ||
    response.proofReference.boundaryId !== boundary.id ||
    response.proofReference.materialVersion !== boundary.materialVersion
  ) {
    return "pending_confirmation";
  }
  return "confirmed";
};

// 级联失效：受影响响应的评审结论作废、退回待重新确认，
// 依赖这些响应的定稿快照同步失效。
const invalidateResponses = (
  database: ReviewDatabase,
  targets: SupplierResponse[],
  reason: string,
): void => {
  if (targets.length === 0) {
    return;
  }
  const now = new Date().toISOString();
  targets.forEach((response) => {
    response.reviews.forEach((review) => {
      if (!review.invalidatedAt) {
        review.invalidatedAt = now;
        review.invalidReason = reason;
      }
    });
    response.status = "pending";
    response.proofReference = undefined;
  });
  const affectedIds = new Set(targets.map((response) => response.id));
  database.versions.forEach((version) => {
    if (version.status !== "finalized") {
      return;
    }
    const dependsOnAffected = version.proofSnapshots.some((snapshot) =>
      snapshot.responseIds.some((id) => affectedIds.has(id)),
    );
    if (dependsOnAffected) {
      version.status = "invalidated";
      version.invalidatedAt = now;
      version.invalidReason = reason;
    }
  });
};

const buildProofSnapshots = (database: ReviewDatabase): ProofSnapshot[] => {
  const byFingerprint = new Map<string, string[]>();
  database.responses.forEach((response) => {
    const list = byFingerprint.get(response.proofFingerprint) ?? [];
    list.push(response.id);
    byFingerprint.set(response.proofFingerprint, list);
  });
  return Array.from(byFingerprint.entries()).map(
    ([fingerprint, responseIds]) => {
      const boundary = database.proofBoundaries.find(
        (item) => item.fingerprint === fingerprint,
      );
      return {
        fingerprint,
        materialVersion: boundary?.materialVersion ?? "未登记",
        responseIds,
        adjudicator: boundary?.adjudicator ?? "未登记",
      };
    },
  );
};

const validateBoundaryScope = (
  database: ReviewDatabase,
  supplierIds: string[],
  clauseIds: string[],
): void => {
  if (supplierIds.length === 0) {
    throw new Error("适用供应商至少选择一家。");
  }
  if (clauseIds.length === 0) {
    throw new Error("适用条款至少选择一条。");
  }
  const unknownSupplier = supplierIds.find(
    (id) => !database.suppliers.some((supplier) => supplier.id === id),
  );
  if (unknownSupplier) {
    throw new Error(`供应商 ${unknownSupplier} 不存在。`);
  }
  const unknownClause = clauseIds.find(
    (id) => !database.clauses.some((clause) => clause.id === id),
  );
  if (unknownClause) {
    throw new Error(`条款 ${unknownClause} 不存在。`);
  }
};

const getDashboard = (database: ReviewDatabase): DashboardStats => {
  const opinionsByResponse = database.responses.map((response) => {
    const decisions = new Set(
      activeReviews(response)
        .filter((review) => review.decision !== "clarification")
        .map((review) => review.decision),
    );
    return decisions.size > 1;
  });
  const proofCounts = database.responses.reduce<Record<string, number>>(
    (counts, response) => {
      if (response.proofFingerprint) {
        counts[response.proofFingerprint] =
          (counts[response.proofFingerprint] ?? 0) + 1;
      }
      return counts;
    },
    {},
  );
  const activeVersion =
    database.versions.find((version) => version.status === "draft") ??
    database.versions.find((version) => version.status === "finalized") ??
    database.versions[0];

  return {
    totalClauses: database.clauses.length,
    mandatoryCount: database.clauses.filter(
      (clause) => clause.type === "mandatory",
    ).length,
    pendingReviews: database.responses.filter(
      (response) => activeReviews(response).length < 2,
    ).length,
    differences: opinionsByResponse.filter(Boolean).length,
    overdueClarifications: database.responses.reduce(
      (count, response) =>
        count +
        response.clarifications.filter(
          (clarification) => clarification.status === "overdue",
        ).length,
      0,
    ),
    reusedProofs: Object.values(proofCounts).filter((count) => count > 1)
      .length,
    unconfirmedProofs: database.responses.filter(
      (response) => getReferenceState(response, database) !== "confirmed",
    ).length,
    activeVersion: activeVersion
      ? `${activeVersion.version} ${activeVersion.label}`
      : "未建立版本",
  };
};

const requireRole = (role: ReviewRole, allowed: ReviewRole[]): void => {
  if (!allowed.includes(role)) {
    throw new Error("当前角色无权执行此操作。");
  }
};

const resolvers = {
  Query: {
    workspace: () => {
      const database = reviewDataStore.snapshot();
      return {
        ...database,
        dashboard: getDashboard(database),
      };
    },
    dashboard: () => getDashboard(reviewDataStore.snapshot()),
  },
  Clause: {
    responses: (clause: Clause, _args: unknown, context: { database: ReviewDatabase }) =>
      context.database.responses.filter(
        (response) => response.clauseId === clause.id,
      ),
  },
  SupplierResponse: {
    referenceState: (
      response: SupplierResponse,
      _args: unknown,
      context: { database: ReviewDatabase },
    ) => getReferenceState(response, context.database),
  },
  Mutation: {
    submitAssessment: (
      _parent: unknown,
      { input }: { input: AssessmentInput },
    ) => {
      requireRole(input.role, ["reviewer_a", "reviewer_b", "chair"]);
      if (input.comment.trim().length < 6) {
        throw new Error("评审意见至少需要 6 个字符。");
      }
      return reviewDataStore.mutate((database) => {
        const response = database.responses.find(
          (item) => item.id === input.responseId,
        );
        if (!response) {
          throw new Error("供应商响应不存在。");
        }
        const supplier = database.suppliers.find(
          (item) => item.id === response.supplierId,
        );
        if (supplier?.status === "withdrawn") {
          throw new Error("该供应商已撤回，响应已退回，不能再提交评审结论。");
        }
        const clause = database.clauses.find(
          (item) => item.id === response.clauseId,
        );
        if (!clause) {
          throw new Error("对应技术条款不存在。");
        }
        if (input.score < 0 || input.score > clause.weight) {
          throw new Error(`评分必须在 0 至 ${clause.weight} 之间。`);
        }
        if (
          clause.type === "scoring" &&
          input.decision === "compliant" &&
          input.score === 0
        ) {
          throw new Error("评分项判定为符合时必须填写评分。");
        }
        const opinion = {
          id: createOpinionId(),
          responseId: response.id,
          reviewer: input.reviewer.trim(),
          role: input.role,
          decision: input.decision,
          score: input.score,
          comment: input.comment.trim(),
          createdAt: new Date().toISOString(),
        };
        response.reviews.push(opinion);
        response.status = input.decision;
        response.reviewRound = Math.max(response.reviewRound, 1);
        // 评审员按响应确认证明引用：边界有效且在适用范围内时继承当前材料版本。
        const boundary = database.proofBoundaries.find(
          (item) => item.fingerprint === response.proofFingerprint,
        );
        if (
          boundary &&
          boundary.supplierIds.includes(response.supplierId) &&
          boundary.clauseIds.includes(response.clauseId)
        ) {
          response.proofReference = {
            boundaryId: boundary.id,
            materialVersion: boundary.materialVersion,
            confirmedBy: opinion.reviewer,
            confirmedAt: opinion.createdAt,
          };
        }
        createAudit(
          database,
          opinion.reviewer,
          "提交独立意见",
          response.id,
          `${clause.code} ${clause.title} 判定为 ${input.decision}，评分 ${input.score}。`,
        );
        return opinion;
      });
    },
    requestClarification: (
      _parent: unknown,
      { input }: { input: ClarificationInput },
    ) =>
      reviewDataStore.mutate((database) => {
        const response = database.responses.find(
          (item) => item.id === input.responseId,
        );
        if (!response) {
          throw new Error("供应商响应不存在。");
        }
        if (input.requestText.trim().length < 6) {
          throw new Error("澄清要求至少需要 6 个字符。");
        }
        const requestedAt = new Date();
        const dueAt = new Date(input.dueAt);
        if (Number.isNaN(dueAt.getTime()) || dueAt <= requestedAt) {
          throw new Error("澄清截止时间必须晚于当前时间。");
        }
        const maximumDueAt = new Date(requestedAt);
        maximumDueAt.setDate(maximumDueAt.getDate() + 7);
        if (dueAt > maximumDueAt) {
          throw new Error("澄清期限不得超过 7 个自然日。");
        }
        const round =
          Math.max(
            0,
            ...response.clarifications.map((item) => item.round),
          ) + 1;
        const clarification = {
          id: createClarificationId(),
          responseId: response.id,
          clauseId: response.clauseId,
          round,
          requestText: input.requestText.trim(),
          requestedAt: requestedAt.toISOString(),
          dueAt: dueAt.toISOString(),
          status: "open" as const,
        };
        response.clarifications.push(clarification);
        response.status = "clarification";
        createAudit(
          database,
          input.actor,
          "发起澄清",
          clarification.id,
          `${response.supplierName} ${response.clauseId} 第 ${round} 轮澄清已发起。`,
        );
        return clarification;
      }),
    respondClarification: (
      _parent: unknown,
      { input }: { input: ClarificationResponseInput },
    ) =>
      reviewDataStore.mutate((database) => {
        const clarification = database.responses
          .flatMap((response) => response.clarifications)
          .find((item) => item.id === input.clarificationId);
        if (!clarification) {
          throw new Error("澄清记录不存在。");
        }
        if (input.responseText.trim().length < 6) {
          throw new Error("澄清回复至少需要 6 个字符。");
        }
        clarification.supplierResponse = input.responseText.trim();
        clarification.respondedAt = new Date().toISOString();
        clarification.status = "responded";
        const response = database.responses.find(
          (item) => item.id === clarification.responseId,
        );
        if (response) {
          response.status = "pending";
        }
        createAudit(
          database,
          input.actor,
          "回复澄清",
          clarification.id,
          `第 ${clarification.round} 轮澄清已回复，等待评审员复核。`,
        );
        return clarification;
      }),
    finalizeVersion: (
      _parent: unknown,
      { input }: { input: FinalizeVersionInput },
    ) =>
      reviewDataStore.mutate((database) => {
        requireRole(input.role, ["chair"]);
        if (input.label.trim().length < 4) {
          throw new Error("版本名称至少需要 4 个字符。");
        }
        const blockingClarifications = database.responses
          .flatMap((response) => response.clarifications)
          .filter(
            (clarification) =>
              clarification.status === "open" ||
              clarification.status === "overdue",
          );
        if (blockingClarifications.length > 0) {
          throw new Error(
            `仍有 ${blockingClarifications.length} 项未完成澄清，不能定稿。`,
          );
        }
        // 未确认的证明引用会拦住签字定稿。
        const unconfirmed = database.responses
          .map((response) => ({
            response,
            state: getReferenceState(response, database),
          }))
          .filter((item) => item.state !== "confirmed");
        if (unconfirmed.length > 0) {
          const countOf = (state: ProofReferenceState) =>
            unconfirmed.filter((item) => item.state === state).length;
          const parts = [
            `引用越界 ${countOf("out_of_bounds")} 项`,
            `待重新确认 ${countOf("pending_confirmation")} 项`,
            `未登记边界 ${countOf("unregistered")} 项`,
            `已失效 ${countOf("invalidated")} 项`,
          ]
            .filter((part) => !part.endsWith(" 0 项"))
            .join("，");
          throw new Error(
            `仍有 ${unconfirmed.length} 项证明引用未确认（${parts}），不能定稿。`,
          );
        }
        const maxVersion =
          database.versions.reduce((maximum, version) => {
            const numeric = Number(version.version.replace(/\D/g, ""));
            return Number.isFinite(numeric)
              ? Math.max(maximum, numeric)
              : maximum;
          }, 0) + 1;
        database.versions.forEach((version) => {
          if (version.status === "draft") {
            version.status = "finalized";
          }
        });
        const version = {
          id: `VER-${Date.now()}`,
          version: `V${maxVersion}`,
          label: input.label.trim(),
          status: "finalized" as const,
          createdAt: new Date().toISOString(),
          createdBy: input.actor,
          signedBy: [input.actor],
          clauseCount: database.clauses.length,
          responseCount: database.responses.length,
          contentHash: Math.random().toString(16).slice(2, 10),
          // 定稿快照记录证明版本、适用响应和裁定人。
          proofSnapshots: buildProofSnapshots(database),
        };
        database.versions.unshift(version);
        createAudit(
          database,
          input.actor,
          "汇总签字定稿",
          version.id,
          `${version.version} ${version.label} 已锁定，签署人 ${input.actor}，记录 ${version.proofSnapshots.length} 组证明快照。`,
        );
        return version;
      }),
    registerProofBoundary: (
      _parent: unknown,
      { input }: { input: RegisterProofBoundaryInput },
    ) =>
      reviewDataStore.mutate((database) => {
        requireRole(input.role, ["reviewer_a", "reviewer_b", "chair"]);
        if (input.materialVersion.trim().length < 2) {
          throw new Error("材料版本至少需要 2 个字符。");
        }
        validateBoundaryScope(database, input.supplierIds, input.clauseIds);
        const referencing = database.responses.filter(
          (response) => response.proofFingerprint === input.fingerprint,
        );
        if (referencing.length === 0) {
          throw new Error("没有响应引用该证明指纹。");
        }
        if (
          database.proofBoundaries.some(
            (item) => item.fingerprint === input.fingerprint,
          )
        ) {
          throw new Error("该证明指纹已登记适用边界。");
        }
        const now = new Date().toISOString();
        const boundary: ProofBoundary = {
          id: createProofBoundaryId(),
          fingerprint: input.fingerprint,
          materialVersion: input.materialVersion.trim(),
          supplierIds: [...input.supplierIds],
          clauseIds: [...input.clauseIds],
          adjudicator: input.actor,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        };
        database.proofBoundaries.push(boundary);
        // 范围内响应继承边界；范围外引用立即越界失效并退回。
        const outOfScope = referencing.filter(
          (response) =>
            !boundary.supplierIds.includes(response.supplierId) ||
            !boundary.clauseIds.includes(response.clauseId),
        );
        referencing
          .filter((response) => !outOfScope.includes(response))
          .forEach((response) => {
            response.proofReference = {
              boundaryId: boundary.id,
              materialVersion: boundary.materialVersion,
              confirmedBy: input.actor,
              confirmedAt: now,
            };
          });
        invalidateResponses(
          database,
          outOfScope,
          `证明 ${boundary.fingerprint} 登记边界后不适用该响应，引用越界。`,
        );
        createAudit(
          database,
          input.actor,
          "登记证明边界",
          boundary.id,
          `${boundary.fingerprint} 材料版本 ${boundary.materialVersion}，适用 ${boundary.supplierIds.length} 家供应商、${boundary.clauseIds.length} 条条款。`,
        );
        return boundary;
      }),
    updateProofBoundary: (
      _parent: unknown,
      { input }: { input: UpdateProofBoundaryInput },
    ) =>
      reviewDataStore.mutate((database) => {
        requireRole(input.role, ["reviewer_a", "reviewer_b", "chair"]);
        const boundary = database.proofBoundaries.find(
          (item) => item.id === input.id,
        );
        if (!boundary) {
          throw new Error("证明边界不存在。");
        }
        // 乐观并发：先到者保存，后到者看到冲突并保留草稿。
        if (input.baseRevision !== boundary.revision) {
          return { conflict: true, boundary };
        }
        if (input.materialVersion.trim().length < 2) {
          throw new Error("材料版本至少需要 2 个字符。");
        }
        validateBoundaryScope(database, input.supplierIds, input.clauseIds);
        const nextMaterialVersion = input.materialVersion.trim();
        const referencing = database.responses.filter(
          (response) => response.proofFingerprint === boundary.fingerprint,
        );
        const affected = new Map<string, SupplierResponse>();
        const reasons: string[] = [];
        if (nextMaterialVersion !== boundary.materialVersion) {
          referencing.forEach((response) => affected.set(response.id, response));
          reasons.push(
            `材料版本由「${boundary.materialVersion}」更新为「${nextMaterialVersion}」`,
          );
        }
        const removedSuppliers = boundary.supplierIds.filter(
          (id) => !input.supplierIds.includes(id),
        );
        if (removedSuppliers.length > 0) {
          referencing
            .filter((response) => removedSuppliers.includes(response.supplierId))
            .forEach((response) => affected.set(response.id, response));
          reasons.push("部分供应商被移出适用边界");
        }
        const removedClauses = boundary.clauseIds.filter(
          (id) => !input.clauseIds.includes(id),
        );
        if (removedClauses.length > 0) {
          referencing
            .filter((response) => removedClauses.includes(response.clauseId))
            .forEach((response) => affected.set(response.id, response));
          reasons.push("部分条款被移出适用边界，引用越界");
        }
        boundary.materialVersion = nextMaterialVersion;
        boundary.supplierIds = [...input.supplierIds];
        boundary.clauseIds = [...input.clauseIds];
        boundary.adjudicator = input.actor;
        boundary.revision += 1;
        boundary.updatedAt = new Date().toISOString();
        if (affected.size > 0) {
          invalidateResponses(
            database,
            Array.from(affected.values()),
            `证明 ${boundary.fingerprint} 边界调整：${reasons.join("；")}。`,
          );
        }
        createAudit(
          database,
          input.actor,
          "更新证明边界",
          boundary.id,
          `${boundary.fingerprint} 第 ${boundary.revision} 版，材料版本 ${boundary.materialVersion}，影响 ${affected.size} 项响应。`,
        );
        return { conflict: false, boundary };
      }),
    withdrawSupplier: (
      _parent: unknown,
      { input }: { input: WithdrawSupplierInput },
    ) =>
      reviewDataStore.mutate((database) => {
        requireRole(input.role, ["procurement", "chair"]);
        const supplier = database.suppliers.find(
          (item) => item.id === input.supplierId,
        );
        if (!supplier) {
          throw new Error("供应商不存在。");
        }
        if (supplier.status === "withdrawn") {
          throw new Error("该供应商已撤回，请勿重复操作。");
        }
        supplier.status = "withdrawn";
        const now = new Date().toISOString();
        database.proofBoundaries.forEach((boundary) => {
          if (boundary.supplierIds.includes(supplier.id)) {
            boundary.supplierIds = boundary.supplierIds.filter(
              (id) => id !== supplier.id,
            );
            boundary.revision += 1;
            boundary.updatedAt = now;
          }
        });
        const affected = database.responses.filter(
          (response) => response.supplierId === supplier.id,
        );
        invalidateResponses(
          database,
          affected,
          `供应商「${supplier.name}」已撤回，相关结论与定稿快照失效。`,
        );
        createAudit(
          database,
          input.actor,
          "供应商撤回",
          supplier.id,
          `${supplier.name} 撤回，${affected.length} 项响应退回待重新确认。`,
        );
        return supplier;
      }),
    resetReviewData: () => {
      reviewDataStore.reset();
      return true;
    },
  },
};

const server = new ApolloServer({
  typeDefs,
  resolvers,
});

async function startServer(): Promise<void> {
  const { url } = await startStandaloneServer(server, {
    listen: { port: 18462, host: "0.0.0.0" },
    context: async () => ({
      database: reviewDataStore.snapshot(),
    }),
  });
  console.log(`GraphQL mock server ready at ${url}`);
}

void startServer();
