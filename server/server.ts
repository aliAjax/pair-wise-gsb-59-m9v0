import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import {
  createAudit,
  createClarificationId,
  createOpinionId,
  reviewDataStore,
} from "./data";
import { typeDefs } from "./schema";
import type {
  AssessmentInput,
  ClarificationInput,
  ClarificationResponseInput,
  Clause,
  ConfirmProofReferenceInput,
  DashboardStats,
  FinalizeVersionInput,
  ProofBoundary,
  ProofReferenceStatus,
  RegisterProofBoundaryInput,
  ReviewDatabase,
  ReviewRole,
  SupplierResponse,
  UpdateProofVersionInput,
  WithdrawProofInput,
} from "./types";

const getProofReferenceStatus = (
  database: ReviewDatabase,
  response: SupplierResponse,
): ProofReferenceStatus => {
  const boundary = database.proofBoundaries.find(
    (item) => item.fingerprint === response.proofFingerprint,
  );
  if (!boundary) {
    return "unregistered";
  }
  if (boundary.withdrawn) {
    return "stale";
  }
  const inScope =
    boundary.supplierId === response.supplierId &&
    boundary.clauseIds.includes(response.clauseId);
  if (!inScope) {
    return "out_of_scope";
  }
  return response.proofConfirmRound === boundary.boundaryVersion
    ? "confirmed"
    : "stale";
};

const findProofBoundary = (
  database: ReviewDatabase,
  fingerprint: string,
): ProofBoundary | undefined =>
  database.proofBoundaries.find((item) => item.fingerprint === fingerprint);

/** 材料版本更新 / 撤回 / 引用越界：结论退回待重新确认 */
const invalidateResponses = (
  database: ReviewDatabase,
  responseIds: string[],
): void => {
  const ids = new Set(responseIds);
  database.responses.forEach((response) => {
    if (!ids.has(response.id)) {
      return;
    }
    response.proofConfirmedAt = undefined;
    response.proofConfirmedBy = undefined;
    response.proofConfirmRound = 0;
    response.status = "pending";
    response.reviewRound += 1;
  });
};

/** 受影响的定稿快照立即退回工作版（失效） */
const invalidateFinalizedVersions = (
  database: ReviewDatabase,
  responseIds: string[],
): string[] => {
  const ids = new Set(responseIds);
  const invalidated: string[] = [];
  database.versions.forEach((version) => {
    if (version.status !== "finalized") {
      return;
    }
    const boundResponseIds = version.proofBindings.flatMap(
      (binding) => binding.responseIds,
    );
    if (boundResponseIds.some((id) => ids.has(id))) {
      version.status = "draft";
      invalidated.push(version.id);
    }
  });
  return invalidated;
};

const getDashboard = (database: ReviewDatabase): DashboardStats => {
  const opinionsByResponse = database.responses.map((response) => {
    const decisions = new Set(
      response.reviews
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
  const referenceStatuses = database.responses.map((response) =>
    getProofReferenceStatus(database, response),
  );
  const activeVersion =
    database.versions.find((version) => version.status === "draft") ??
    database.versions[0];

  return {
    totalClauses: database.clauses.length,
    mandatoryCount: database.clauses.filter(
      (clause) => clause.type === "mandatory",
    ).length,
    pendingReviews: database.responses.filter(
      (response) => response.reviews.length < 2,
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
    unconfirmedProofs: referenceStatuses.filter(
      (status) => status !== "confirmed",
    ).length,
    staleProofConclusions: database.responses.filter(
      (response) =>
        response.reviews.length > 0 &&
        ["stale", "out_of_scope"].includes(
          getProofReferenceStatus(database, response),
        ),
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
    proofReferenceStatus: (
      response: SupplierResponse,
      _args: unknown,
      context: { database: ReviewDatabase },
    ) => getProofReferenceStatus(context.database, response),
    proofBoundary: (
      response: SupplierResponse,
      _args: unknown,
      context: { database: ReviewDatabase },
    ) =>
      context.database.proofBoundaries.find(
        (boundary) => boundary.fingerprint === response.proofFingerprint,
      ) ?? null,
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
    registerProofBoundary: (
      _parent: unknown,
      { input }: { input: RegisterProofBoundaryInput },
    ) => {
      requireRole(input.role, ["reviewer_a", "reviewer_b", "chair"]);
      if (input.fingerprint.trim().length < 3) {
        throw new Error("证明指纹至少需要 3 个字符。");
      }
      if (!input.clauseIds.length) {
        throw new Error("证明适用条款范围至少选择一个条款。");
      }
      if (input.versionLabel.trim().length < 2) {
        throw new Error("材料版本标识至少需要 2 个字符。");
      }
      return reviewDataStore.mutate((database) => {
        const supplier = database.suppliers.find(
          (item) => item.id === input.supplierId,
        );
        if (!supplier) {
          throw new Error("适用供应商不存在。");
        }
        const clauseIds = database.clauses
          .filter((clause) => input.clauseIds.includes(clause.id))
          .map((clause) => clause.id);
        if (clauseIds.length !== input.clauseIds.length) {
          throw new Error("适用条款范围包含不存在的条款。");
        }

        const existing = findProofBoundary(database, input.fingerprint.trim());

        // 乐观锁：两位评审员同时编辑时先到者保存，后到者只保留草稿并看到冲突
        if (
          existing &&
          input.expectedBoundaryVersion !== existing.boundaryVersion
        ) {
          createAudit(
            database,
            input.actor,
            "证明边界保存冲突",
            existing.fingerprint,
            `后到修改基于第 ${input.expectedBoundaryVersion} 版，先到者已保存第 ${existing.boundaryVersion} 版，草稿已保留。`,
          );
          return {
            boundary: null,
            conflict: true,
            serverBoundary: existing,
            draftSaved: true,
            affectedResponseIds: [],
          };
        }

        const now = new Date().toISOString();
        let boundary: ProofBoundary;
        let affectedResponseIds: string[];

        if (!existing) {
          const attachmentName =
            database.responses.find(
              (response) => response.proofFingerprint === input.fingerprint.trim(),
            )?.attachmentName ?? "证明材料.pdf";
          boundary = {
            fingerprint: input.fingerprint.trim(),
            attachmentName,
            version: 1,
            versionLabel: input.versionLabel.trim(),
            supplierId: supplier.id,
            supplierName: supplier.name,
            clauseIds,
            boundaryVersion: 1,
            withdrawn: false,
            createdBy: input.actor,
            createdAt: now,
            updatedBy: input.actor,
            updatedAt: now,
          };
          database.proofBoundaries.push(boundary);
          affectedResponseIds = database.responses
            .filter(
              (response) =>
                response.proofFingerprint === boundary.fingerprint &&
                getProofReferenceStatus(database, response) !== "confirmed",
            )
            .map((response) => response.id);
          createAudit(
            database,
            input.actor,
            "登记证明边界",
            boundary.fingerprint,
            `${supplier.name} ${boundary.attachmentName} 版本 ${boundary.versionLabel} 已登记，适用 ${clauseIds.length} 个条款，引用响应需逐一确认。`,
          );
        } else {
          const scopeChanged =
            existing.supplierId !== supplier.id ||
            existing.clauseIds.length !== clauseIds.length ||
            existing.clauseIds.some((id) => !clauseIds.includes(id));
          const versionChanged =
            existing.versionLabel !== input.versionLabel.trim();
          existing.supplierId = supplier.id;
          existing.supplierName = supplier.name;
          existing.clauseIds = clauseIds;
          existing.versionLabel = input.versionLabel.trim();
          existing.boundaryVersion += 1;
          existing.updatedBy = input.actor;
          existing.updatedAt = now;
          boundary = existing;

          // 范围收窄/供应商变更后越界的引用立即退回；材料版本不变时范围内引用保持有效
          affectedResponseIds = database.responses
            .filter((response) => response.proofFingerprint === boundary.fingerprint)
            .filter((response) => {
              const status = getProofReferenceStatus(database, response);
              return status !== "confirmed";
            })
            .map((response) => response.id);
          invalidateResponses(database, affectedResponseIds);
          const invalidatedVersionIds = invalidateFinalizedVersions(
            database,
            affectedResponseIds,
          );
          createAudit(
            database,
            input.actor,
            "调整证明边界",
            boundary.fingerprint,
            `边界更新到第 ${boundary.boundaryVersion} 版（${scopeChanged ? "范围变更" : "范围未变"}${versionChanged ? "、材料版本变更" : ""}），${affectedResponseIds.length} 个响应退回重新确认，${invalidatedVersionIds.length} 份定稿快照失效。`,
          );
        }

        return {
          boundary,
          conflict: false,
          serverBoundary: null,
          draftSaved: false,
          affectedResponseIds,
        };
      });
    },
    updateProofVersion: (
      _parent: unknown,
      { input }: { input: UpdateProofVersionInput },
    ) => {
      requireRole(input.role, ["reviewer_a", "reviewer_b", "chair"]);
      if (input.versionLabel.trim().length < 2) {
        throw new Error("材料版本标识至少需要 2 个字符。");
      }
      return reviewDataStore.mutate((database) => {
        const boundary = findProofBoundary(database, input.fingerprint);
        if (!boundary) {
          throw new Error("证明边界尚未登记，请先登记供应商与条款范围。");
        }
        boundary.version += 1;
        boundary.versionLabel = input.versionLabel.trim();
        boundary.boundaryVersion += 1;
        boundary.updatedBy = input.actor;
        boundary.updatedAt = new Date().toISOString();

        // 引用继承旧边界，材料版本更新后全部继承引用失效，等待重新确认
        const affectedResponseIds = database.responses
          .filter((response) => response.proofFingerprint === boundary.fingerprint)
          .filter((response) =>
            boundary.clauseIds.includes(response.clauseId),
          )
          .filter((response) => response.supplierId === boundary.supplierId)
          .map((response) => response.id);
        invalidateResponses(database, affectedResponseIds);
        const invalidatedVersionIds = invalidateFinalizedVersions(
          database,
          affectedResponseIds,
        );
        createAudit(
          database,
          input.actor,
          "更新证明版本",
          boundary.fingerprint,
          `${boundary.attachmentName} 更新为 ${boundary.versionLabel}，${affectedResponseIds.length} 个继承引用的评审结论退回重新确认，${invalidatedVersionIds.length} 份定稿快照失效。`,
        );
        return { boundary, affectedResponseIds, invalidatedVersionIds };
      });
    },
    withdrawProof: (
      _parent: unknown,
      { input }: { input: WithdrawProofInput },
    ) => {
      requireRole(input.role, ["reviewer_a", "reviewer_b", "chair"]);
      return reviewDataStore.mutate((database) => {
        const boundary = findProofBoundary(database, input.fingerprint);
        if (!boundary) {
          throw new Error("证明边界尚未登记。");
        }
        if (boundary.withdrawn) {
          throw new Error("该证明已处于撤回状态。");
        }
        boundary.withdrawn = true;
        boundary.boundaryVersion += 1;
        boundary.updatedBy = input.actor;
        boundary.updatedAt = new Date().toISOString();

        const affectedResponseIds = database.responses
          .filter((response) => response.proofFingerprint === boundary.fingerprint)
          .map((response) => response.id);
        invalidateResponses(database, affectedResponseIds);
        const invalidatedVersionIds = invalidateFinalizedVersions(
          database,
          affectedResponseIds,
        );
        createAudit(
          database,
          input.actor,
          "供应商撤回证明",
          boundary.fingerprint,
          `${boundary.supplierName}撤回 ${boundary.attachmentName}，${affectedResponseIds.length} 个评审结论立即失效并退回重审，${invalidatedVersionIds.length} 份定稿快照失效。`,
        );
        return { boundary, affectedResponseIds, invalidatedVersionIds };
      });
    },
    confirmProofReference: (
      _parent: unknown,
      { input }: { input: ConfirmProofReferenceInput },
    ) => {
      requireRole(input.role, ["reviewer_a", "reviewer_b", "chair"]);
      return reviewDataStore.mutate((database) => {
        const response = database.responses.find(
          (item) => item.id === input.responseId,
        );
        if (!response) {
          throw new Error("供应商响应不存在。");
        }
        const boundary = findProofBoundary(database, response.proofFingerprint);
        if (!boundary || boundary.withdrawn) {
          throw new Error("证明材料未登记有效边界或已被撤回，不能确认引用。");
        }
        if (
          boundary.supplierId !== response.supplierId ||
          !boundary.clauseIds.includes(response.clauseId)
        ) {
          throw new Error("该引用超出证明适用边界，不能确认。");
        }
        response.proofConfirmRound = boundary.boundaryVersion;
        response.proofConfirmedAt = new Date().toISOString();
        response.proofConfirmedBy = input.actor;
        createAudit(
          database,
          input.actor,
          "确认证明引用",
          response.id,
          `确认 ${boundary.attachmentName} ${boundary.versionLabel} 适用于该响应，引用继承证明边界。`,
        );
        return response;
      });
    },
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
        const unconfirmed = database.responses
          .map((response) => ({
            response,
            status: getProofReferenceStatus(database, response),
          }))
          .filter((item) => item.status !== "confirmed");
        if (unconfirmed.length > 0) {
          const stale = unconfirmed.filter(
            (item) =>
              item.status === "stale" || item.status === "out_of_scope",
          ).length;
          const unregistered = unconfirmed.filter(
            (item) => item.status === "unregistered",
          ).length;
          throw new Error(
            `仍有 ${unconfirmed.length} 项证明引用未确认（${stale} 项失效或越界、${unregistered} 项未登记边界），不能签字定稿。`,
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
          version.status = "finalized";
        });

        // 定稿快照逐份记录证明版本、适用响应和裁定人
        const proofBindings = database.proofBoundaries
          .filter((boundary) => !boundary.withdrawn)
          .map((boundary) => {
            const scopedResponses = database.responses.filter(
              (response) =>
                response.proofFingerprint === boundary.fingerprint &&
                response.supplierId === boundary.supplierId &&
                boundary.clauseIds.includes(response.clauseId),
            );
            return {
              fingerprint: boundary.fingerprint,
              attachmentName: boundary.attachmentName,
              version: boundary.version,
              versionLabel: boundary.versionLabel,
              supplierId: boundary.supplierId,
              supplierName: boundary.supplierName,
              clauseIds: [...boundary.clauseIds],
              responseIds: scopedResponses.map((response) => response.id),
              registeredBy: boundary.updatedBy,
              confirmedBy: Array.from(
                new Set(
                  scopedResponses
                    .map((response) => response.proofConfirmedBy)
                    .filter((by): by is string => Boolean(by)),
                ),
              ),
              confirmedAt: new Date().toISOString(),
            };
          });

        const hashSource = JSON.stringify({
          clauses: database.clauses.map((clause) => clause.id),
          responses: database.responses.map((response) => [
            response.id,
            response.status,
            response.proofFingerprint,
            response.proofConfirmRound,
          ]),
          proofBindings: proofBindings.map((binding) => [
            binding.fingerprint,
            binding.version,
            binding.responseIds.join(","),
          ]),
        });
        let contentHash = 0;
        for (let index = 0; index < hashSource.length; index += 1) {
          contentHash = (contentHash * 31 + hashSource.charCodeAt(index)) >>> 0;
        }

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
          contentHash: contentHash.toString(16).padStart(8, "0"),
          proofBindings,
        };
        database.versions.unshift(version);
        createAudit(
          database,
          input.actor,
          "汇总签字定稿",
          version.id,
          `${version.version} ${version.label} 已锁定，固化 ${proofBindings.length} 份证明版本与适用响应，签署人 ${input.actor}。`,
        );
        return version;
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
