import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from "@angular/core";
import { DatePipe } from "@angular/common";
import {
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";
import { toSignal, takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { Actions, ofType } from "@ngrx/effects";
import { Store } from "@ngrx/store";
import { RouterLink } from "@angular/router";
import { filter } from "rxjs";
import type { TreeNode } from "primeng/api";
import { AccordionModule } from "primeng/accordion";
import { ButtonModule } from "primeng/button";
import { DatePickerModule } from "primeng/datepicker";
import { DialogModule } from "primeng/dialog";
import { InputNumberModule } from "primeng/inputnumber";
import { InputTextModule } from "primeng/inputtext";
import { MultiSelectModule } from "primeng/multiselect";
import { SelectModule } from "primeng/select";
import { TagModule } from "primeng/tag";
import { TextareaModule } from "primeng/textarea";
import { TreeModule } from "primeng/tree";
import {
  complianceLabels,
  roleProfiles,
  type Clause,
  type ComplianceStatus,
  type ProofBoundary,
  type SupplierResponse,
} from "../../core/models/review.models";
import { ReviewActions } from "../../core/state/review.actions";
import {
  hasReviewDifference,
  proofReferenceStatusOf,
  selectClauseTree,
  selectProofBoundaries,
  selectRole,
} from "../../core/state/review.selectors";
import {
  ClarificationTagComponent,
  ClauseTypeTagComponent,
  ProofReferenceTagComponent,
  StatusTagComponent,
} from "../../shared/status-tag.component";

@Component({
  selector: "app-clauses-page",
  imports: [
    DatePipe,
    RouterLink,
    FormsModule,
    ReactiveFormsModule,
    AccordionModule,
    ButtonModule,
    DatePickerModule,
    DialogModule,
    InputNumberModule,
    InputTextModule,
    MultiSelectModule,
    SelectModule,
    TagModule,
    TextareaModule,
    TreeModule,
    StatusTagComponent,
    ClauseTypeTagComponent,
    ClarificationTagComponent,
    ProofReferenceTagComponent,
  ],
  templateUrl: "./clauses.page.html",
  styleUrl: "./clauses.page.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClausesPage {
  private readonly store = inject(Store);
  private readonly actions$ = inject(Actions);

  readonly clauseTree = toSignal(this.store.select(selectClauseTree), {
    initialValue: [],
  });
  readonly treeNodes = computed(() => this.toTreeNodes(this.clauseTree()));
  readonly role = toSignal(this.store.select(selectRole), {
    initialValue: "reviewer_a",
  });
  readonly proofBoundaries = toSignal(
    this.store.select(selectProofBoundaries),
    { initialValue: [] as ProofBoundary[] },
  );
  readonly selectedTreeKey = signal<string | null>(null);
  readonly selectedSupplierId = signal<string | null>(null);

  readonly boundaryVisible = signal(false);
  readonly boundaryFingerprint = signal<string | null>(null);
  readonly boundaryConflict = signal<ProofBoundary | null>(null);
  readonly pendingConfirmResponseId = signal<string | null>(null);
  readonly versionVisible = signal(false);
  readonly clarificationVisible = signal(false);
  readonly selectedClause = computed(() => {
    const key = this.selectedTreeKey();
    if (!key) {
      return this.clauseTree()[0] ?? null;
    }
    return this.findClause(this.treeNodes(), key) ?? null;
  });
  readonly selectedResponse = computed(() => {
    const clause = this.selectedClause();
    if (!clause) {
      return null;
    }
    return (
      clause.responses.find(
        (response) => response.supplierId === this.selectedSupplierId(),
      ) ??
      clause.responses[0] ??
      null
    );
  });
  readonly supplierOptions = computed(() =>
    this.clauseTree()
      .flatMap((clause) => clause.responses.map((response) => ({
        id: response.supplierId,
        name: response.supplierName,
      })))
      .filter(
        (option, index, all) =>
          all.findIndex((item) => item.id === option.id) === index,
      ),
  );
  readonly clauseOptions = computed(() =>
    this.clauseTree().map((clause) => ({
      id: clause.id,
      name: `${clause.code} ${clause.title}`,
    })),
  );
  readonly selectedBoundary = computed(() => {
    const response = this.selectedResponse();
    if (!response) {
      return null;
    }
    return (
      this.proofBoundaries().find(
        (boundary) => boundary.fingerprint === response.proofFingerprint,
      ) ?? null
    );
  });
  readonly selectedProofStatus = computed(() => {
    const response = this.selectedResponse();
    if (!response) {
      return "unregistered" as const;
    }
    return proofReferenceStatusOf(response, this.selectedBoundary());
  });
  readonly canReview = computed(() => this.role() !== "procurement");
  readonly canManageBoundary = computed(() => this.role() !== "procurement");
  readonly clauseRisks = computed(() => {
    const clause = this.selectedClause();
    if (!clause) {
      return [];
    }
    const risks: string[] = [];
    if (
      clause.type === "mandatory" &&
      clause.responses.some((response) => response.status === "pending")
    ) {
      risks.push("存在尚未明确结论的否决项");
    }
    if (clause.responses.some(hasReviewDifference)) {
      risks.push("不同评审员意见存在分歧，必须保留并进入小组复核");
    }
    if (
      clause.responses.some((response) =>
        response.clarifications.some(
          (clarification) => clarification.status === "overdue",
        ),
      )
    ) {
      risks.push("存在逾期澄清，不得直接形成最终结论");
    }
    const duplicatedProof = new Set<string>();
    clause.responses.forEach((response) => {
      if (
        clause.responses.filter(
          (candidate) =>
            candidate.proofFingerprint === response.proofFingerprint,
        ).length > 1
      ) {
        duplicatedProof.add(response.proofFingerprint);
      }
    });
    duplicatedProof.forEach((fingerprint) => {
      const boundary = this.proofBoundaries().find(
        (item) => item.fingerprint === fingerprint,
      );
      if (!boundary) {
        risks.push("同一证明被多个响应引用但未登记适用边界");
      } else if (boundary.withdrawn) {
        risks.push("重复引用的证明已被供应商撤回，相关结论已失效");
      }
    });
    const staleReferences = clause.responses.filter(
      (response) =>
        proofReferenceStatusOf(
          response,
          this.proofBoundaries().find(
            (boundary) => boundary.fingerprint === response.proofFingerprint,
          ) ?? null,
        ) !== "confirmed",
    );
    if (staleReferences.length > 0) {
      risks.push("存在未确认、越界或材料已更新的证明引用，签字定稿会被拦截");
    }
    return risks;
  });

  readonly decisionOptions = (
    Object.entries(complianceLabels) as Array<
      [ComplianceStatus, string]
    >
  ).map(([value, label]) => ({ value, label }));

  readonly assessmentForm = new FormGroup({
    decision: new FormControl<ComplianceStatus>("compliant", {
      nonNullable: true,
      validators: [Validators.required],
    }),
    score: new FormControl(0, {
      nonNullable: true,
      validators: [Validators.min(0)],
    }),
    comment: new FormControl("", {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(6)],
    }),
  });

  readonly clarificationForm = new FormGroup({
    requestText: new FormControl("", {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(6)],
    }),
    dueAt: new FormControl(
      new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      { nonNullable: true },
    ),
  });

  readonly boundaryForm = new FormGroup({
    supplierId: new FormControl<string>("", {
      nonNullable: true,
      validators: [Validators.required],
    }),
    clauseIds: new FormControl<string[]>([], {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(1)],
    }),
    versionLabel: new FormControl("", {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2)],
    }),
  });

  readonly versionForm = new FormGroup({
    versionLabel: new FormControl("", {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2)],
    }),
  });

  readonly minimumClarificationDate = new Date();

  constructor() {
    // 边界保存冲突：先到者已写入，工作区刷新后保留当前草稿，仅提示冲突
    this.actions$
      .pipe(
        ofType(ReviewActions.loadReviewDataSuccess),
        filter(({ toast }) => toast?.includes("先行保存") ?? false),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        const fingerprint = this.boundaryFingerprint();
        const serverBoundary = fingerprint
          ? this.proofBoundaries().find(
              (boundary) => boundary.fingerprint === fingerprint,
            ) ?? null
          : null;
        this.boundaryConflict.set(serverBoundary);
      });
    // 登记成功后若带了待确认响应，自动弹出该响应的引用确认
    this.actions$
      .pipe(
        ofType(ReviewActions.loadReviewDataSuccess),
        filter(({ toast }) => toast?.startsWith("证明适用边界已登记") ?? false),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        const responseId = this.pendingConfirmResponseId();
        this.pendingConfirmResponseId.set(null);
        this.boundaryVisible.set(false);
        if (responseId) {
          this.confirmProofReference(responseId);
        }
      });
  }

  nodeTemplateData(node: TreeNode): Clause {
    return node.data as Clause;
  }

  selectNode(node: TreeNode): void {
    const clause = node.data as Clause;
    this.selectedTreeKey.set(clause.id);
    this.selectedSupplierId.set(clause.responses[0]?.supplierId ?? null);
    this.resetAssessmentForm(clause.responses[0]);
  }

  selectResponse(response: SupplierResponse): void {
    this.selectedSupplierId.set(response.supplierId);
    this.resetAssessmentForm(response);
  }

  submitAssessment(): void {
    const response = this.selectedResponse();
    const clause = this.selectedClause();
    if (!response || !clause || this.assessmentForm.invalid) {
      this.assessmentForm.markAllAsTouched();
      return;
    }
    if (!this.canReview()) {
      return;
    }
    const value = this.assessmentForm.getRawValue();
    this.store.dispatch(
      ReviewActions.submitAssessment({
        input: {
          responseId: response.id,
          decision: value.decision,
          score: clause.type === "scoring" ? value.score : 0,
          comment: value.comment,
          reviewer: roleProfiles[this.role()].name,
          role: this.role(),
        },
      }),
    );
  }

  openClarificationDialog(): void {
    this.clarificationForm.reset({
      requestText: "",
      dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    });
    this.clarificationVisible.set(true);
  }

  submitClarification(): void {
    const response = this.selectedResponse();
    if (!response || this.clarificationForm.invalid) {
      this.clarificationForm.markAllAsTouched();
      return;
    }
    const value = this.clarificationForm.getRawValue();
    this.store.dispatch(
      ReviewActions.requestClarification({
        input: {
          responseId: response.id,
          requestText: value.requestText,
          dueAt: value.dueAt.toISOString(),
          actor: roleProfiles[this.role()].name,
        },
      }),
    );
    this.clarificationVisible.set(false);
  }

  boundaryOf(response: SupplierResponse): ProofBoundary | null {
    return (
      this.proofBoundaries().find(
        (boundary) => boundary.fingerprint === response.proofFingerprint,
      ) ?? null
    );
  }

  proofStatusOf(response: SupplierResponse) {
    return proofReferenceStatusOf(response, this.boundaryOf(response));
  }

  openBoundaryDialog(response: SupplierResponse): void {
    const existing = this.boundaryOf(response);
    this.boundaryFingerprint.set(response.proofFingerprint);
    this.boundaryConflict.set(null);
    this.pendingConfirmResponseId.set(null);
    this.boundaryForm.reset({
      supplierId: existing?.supplierId ?? response.supplierId,
      clauseIds: existing?.clauseIds ?? [response.clauseId],
      versionLabel: existing?.versionLabel ?? "初版（V1）",
    });
    this.boundaryVisible.set(true);
  }

  saveBoundary(): void {
    const fingerprint = this.boundaryFingerprint();
    if (!fingerprint || this.boundaryForm.invalid) {
      this.boundaryForm.markAllAsTouched();
      return;
    }
    const value = this.boundaryForm.getRawValue();
    const existing = this.proofBoundaries().find(
      (boundary) => boundary.fingerprint === fingerprint,
    );
    const response = this.selectedResponse();
    // 首次登记后立即引导确认当前响应；编辑保存不自动确认
    this.pendingConfirmResponseId.set(existing ? null : response?.id ?? null);
    this.store.dispatch(
      ReviewActions.registerProofBoundary({
        input: {
          fingerprint,
          supplierId: value.supplierId,
          clauseIds: value.clauseIds,
          versionLabel: value.versionLabel,
          actor: roleProfiles[this.role()].name,
          role: this.role(),
          expectedBoundaryVersion: existing?.boundaryVersion ?? 0,
          draftOnly: false,
        },
      }),
    );
  }

  /** 冲突后以服务端最新版本为基底重新保存，草稿内容优先 */
  overwriteBoundaryDraft(): void {
    const fingerprint = this.boundaryFingerprint();
    const serverBoundary = this.boundaryConflict();
    if (!fingerprint || !serverBoundary || this.boundaryForm.invalid) {
      this.boundaryForm.markAllAsTouched();
      return;
    }
    const value = this.boundaryForm.getRawValue();
    this.store.dispatch(
      ReviewActions.registerProofBoundary({
        input: {
          fingerprint,
          supplierId: value.supplierId,
          clauseIds: value.clauseIds,
          versionLabel: value.versionLabel,
          actor: roleProfiles[this.role()].name,
          role: this.role(),
          expectedBoundaryVersion: serverBoundary.boundaryVersion,
          draftOnly: false,
        },
      }),
    );
    this.boundaryConflict.set(null);
  }

  openVersionDialog(): void {
    const boundary = this.selectedBoundary();
    this.versionForm.reset({
      versionLabel: boundary
        ? boundary.versionLabel.replace(/V?\d+/, `V${boundary.version + 1}`)
        : "",
    });
    this.versionVisible.set(true);
  }

  updateProofVersion(): void {
    const boundary = this.selectedBoundary();
    if (!boundary || this.versionForm.invalid) {
      this.versionForm.markAllAsTouched();
      return;
    }
    this.store.dispatch(
      ReviewActions.updateProofVersion({
        input: {
          fingerprint: boundary.fingerprint,
          versionLabel: this.versionForm.controls.versionLabel.value,
          actor: roleProfiles[this.role()].name,
          role: this.role(),
        },
      }),
    );
    this.versionVisible.set(false);
  }

  withdrawProof(): void {
    const boundary = this.selectedBoundary();
    if (!boundary) {
      return;
    }
    this.store.dispatch(
      ReviewActions.withdrawProof({
        input: {
          fingerprint: boundary.fingerprint,
          actor: roleProfiles[this.role()].name,
          role: this.role(),
        },
      }),
    );
  }

  confirmProofReference(responseId?: string): void {
    const target =
      responseId ?? this.selectedResponse()?.id;
    if (!target) {
      return;
    }
    this.store.dispatch(
      ReviewActions.confirmProofReference({
        input: {
          responseId: target,
          actor: roleProfiles[this.role()].name,
          role: this.role(),
        },
      }),
    );
  }

  latestOpinion(
    response: SupplierResponse,
    reviewer: string,
  ): string | undefined {
    return response.reviews.find((review) => review.reviewer === reviewer)
      ?.comment;
  }

  private findClause(
    nodes: readonly TreeNode<Clause>[],
    clauseId: string,
  ): Clause | undefined {
    for (const node of nodes) {
      if (node.data?.id === clauseId) {
        return node.data;
      }
      const child = this.findClause(node.children ?? [], clauseId);
      if (child) {
        return child;
      }
    }
    return undefined;
  }

  private toTreeNodes(nodes: readonly Clause[]): TreeNode<Clause>[] {
    return nodes.map((clause) => ({
      key: clause.id,
      label: `${clause.code} ${clause.title}`,
      data: clause,
      children: this.toTreeNodes(clause.children ?? []),
    }));
  }

  private resetAssessmentForm(response: SupplierResponse | undefined): void {
    if (!response) {
      return;
    }
    const latest = [...response.reviews].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    )[0];
    this.assessmentForm.reset({
      decision: latest?.decision ?? response.status,
      score: latest?.score ?? response.claimedScore,
      comment: "",
    });
  }
}
