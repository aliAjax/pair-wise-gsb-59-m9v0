import { DatePipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from "@angular/core";
import {
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";
import { toSignal } from "@angular/core/rxjs-interop";
import { Store } from "@ngrx/store";
import { ButtonModule } from "primeng/button";
import { DialogModule } from "primeng/dialog";
import { InputTextModule } from "primeng/inputtext";
import { MultiSelectModule } from "primeng/multiselect";
import { SelectModule } from "primeng/select";
import { TableModule } from "primeng/table";
import { TagModule } from "primeng/tag";
import {
  proofReferenceStateLabels,
  roleProfiles,
} from "../../core/models/review.models";
import { ReviewActions } from "../../core/state/review.actions";
import {
  selectClauses,
  selectError,
  selectProofBoundaries,
  selectProofConflict,
  selectProofRows,
  selectRole,
  selectSaving,
  selectSuppliers,
  selectUnconfirmedReferences,
  selectVersions,
  type ProofRow,
} from "../../core/state/review.selectors";
import { ProofReferenceTagComponent } from "../../shared/status-tag.component";

interface BoundaryEditing {
  mode: "register" | "edit";
  fingerprint: string;
  boundaryId?: string;
}

@Component({
  selector: "app-proofs-page",
  imports: [
    DatePipe,
    FormsModule,
    ReactiveFormsModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    MultiSelectModule,
    SelectModule,
    TableModule,
    TagModule,
    ProofReferenceTagComponent,
  ],
  templateUrl: "./proofs.page.html",
  styleUrl: "./proofs.page.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProofsPage {
  private readonly store = inject(Store);

  readonly proofRows = toSignal(this.store.select(selectProofRows), {
    initialValue: [] as ProofRow[],
  });
  readonly boundaries = toSignal(this.store.select(selectProofBoundaries), {
    initialValue: [],
  });
  readonly suppliers = toSignal(this.store.select(selectSuppliers), {
    initialValue: [],
  });
  readonly clauses = toSignal(this.store.select(selectClauses), {
    initialValue: [],
  });
  readonly versions = toSignal(this.store.select(selectVersions), {
    initialValue: [],
  });
  readonly role = toSignal(this.store.select(selectRole), {
    initialValue: "reviewer_a",
  });
  readonly saving = toSignal(this.store.select(selectSaving), {
    initialValue: false,
  });
  readonly error = toSignal(this.store.select(selectError), {
    initialValue: undefined,
  });
  readonly proofConflict = toSignal(this.store.select(selectProofConflict), {
    initialValue: undefined,
  });
  readonly unconfirmedReferences = toSignal(
    this.store.select(selectUnconfirmedReferences),
    { initialValue: [] },
  );

  readonly dialogVisible = signal(false);
  readonly editing = signal<BoundaryEditing | null>(null);
  readonly baseRevision = signal(0);
  readonly withdrawTarget = signal<string | null>(null);
  readonly withdrawArmed = signal(false);
  readonly stateLabels = proofReferenceStateLabels;

  private readonly awaitingSave = signal(false);

  readonly canManageBoundary = computed(() =>
    ["reviewer_a", "reviewer_b", "chair"].includes(this.role()),
  );
  readonly canWithdraw = computed(() =>
    ["procurement", "chair"].includes(this.role()),
  );
  readonly registeredCount = computed(
    () => this.proofRows().filter((row) => row.boundary).length,
  );
  readonly invalidatedVersions = computed(
    () =>
      this.versions().filter((version) => version.status === "invalidated")
        .length,
  );
  readonly activeSuppliers = computed(() =>
    this.suppliers().filter((supplier) => supplier.status === "active"),
  );
  readonly supplierOptions = computed(() =>
    this.suppliers().map((supplier) => ({
      label:
        supplier.status === "withdrawn"
          ? `${supplier.name}（已撤回）`
          : supplier.name,
      value: supplier.id,
    })),
  );
  readonly clauseOptions = computed(() =>
    this.clauses().map((clause) => ({
      label: `${clause.code} ${clause.title}`,
      value: clause.id,
    })),
  );
  readonly conflictForEditing = computed(() => {
    const conflict = this.proofConflict();
    const editing = this.editing();
    if (!conflict || !editing || conflict.fingerprint !== editing.fingerprint) {
      return null;
    }
    return conflict;
  });

  readonly boundaryForm = new FormGroup({
    materialVersion: new FormControl("", {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2)],
    }),
    supplierIds: new FormControl<string[]>([], {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(1)],
    }),
    clauseIds: new FormControl<string[]>([], {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(1)],
    }),
  });

  constructor() {
    effect(() => {
      // 后到者冲突：保留草稿，仅同步服务器最新版次供再次提交。
      const conflict = this.conflictForEditing();
      if (conflict) {
        this.baseRevision.set(conflict.revision);
      }
    });
    effect(() => {
      if (!this.awaitingSave() || this.saving()) {
        return;
      }
      this.awaitingSave.set(false);
      // 冲突或校验失败时保留对话框和草稿；保存成功才关闭。
      if (this.conflictForEditing() || this.error()) {
        return;
      }
      this.closeDialog();
    });
  }

  supplierName(id: string): string {
    return (
      this.suppliers().find((supplier) => supplier.id === id)?.name ?? id
    );
  }

  clauseCode(id: string): string {
    return this.clauses().find((clause) => clause.id === id)?.code ?? id;
  }

  openRegister(row: ProofRow): void {
    if (!this.canManageBoundary()) {
      return;
    }
    this.store.dispatch(ReviewActions.clearProofConflict());
    this.editing.set({ mode: "register", fingerprint: row.fingerprint });
    this.baseRevision.set(0);
    this.boundaryForm.reset({
      materialVersion: "",
      supplierIds: Array.from(
        new Set(row.references.map((entry) => entry.response.supplierId)),
      ),
      clauseIds: Array.from(
        new Set(row.references.map((entry) => entry.response.clauseId)),
      ),
    });
    this.dialogVisible.set(true);
  }

  openEdit(row: ProofRow): void {
    const boundary = row.boundary;
    if (!boundary || !this.canManageBoundary()) {
      return;
    }
    this.store.dispatch(ReviewActions.clearProofConflict());
    this.editing.set({
      mode: "edit",
      fingerprint: row.fingerprint,
      boundaryId: boundary.id,
    });
    this.baseRevision.set(boundary.revision);
    this.boundaryForm.reset({
      materialVersion: boundary.materialVersion,
      supplierIds: [...boundary.supplierIds],
      clauseIds: [...boundary.clauseIds],
    });
    this.dialogVisible.set(true);
  }

  saveBoundary(): void {
    const editing = this.editing();
    if (!editing || this.boundaryForm.invalid) {
      this.boundaryForm.markAllAsTouched();
      return;
    }
    const value = this.boundaryForm.getRawValue();
    const actor = roleProfiles[this.role()].name;
    if (editing.mode === "register") {
      this.store.dispatch(
        ReviewActions.registerProofBoundary({
          input: {
            fingerprint: editing.fingerprint,
            materialVersion: value.materialVersion,
            supplierIds: value.supplierIds,
            clauseIds: value.clauseIds,
            actor,
            role: this.role(),
          },
        }),
      );
    } else if (editing.boundaryId) {
      this.store.dispatch(
        ReviewActions.updateProofBoundary({
          input: {
            id: editing.boundaryId,
            baseRevision: this.baseRevision(),
            materialVersion: value.materialVersion,
            supplierIds: value.supplierIds,
            clauseIds: value.clauseIds,
            actor,
            role: this.role(),
          },
        }),
      );
    }
    this.awaitingSave.set(true);
  }

  closeDialog(): void {
    this.dialogVisible.set(false);
    this.editing.set(null);
    this.awaitingSave.set(false);
    this.store.dispatch(ReviewActions.clearProofConflict());
  }

  confirmWithdraw(): void {
    const supplierId = this.withdrawTarget();
    if (!supplierId || !this.canWithdraw()) {
      return;
    }
    if (!this.withdrawArmed()) {
      this.withdrawArmed.set(true);
      return;
    }
    this.store.dispatch(
      ReviewActions.withdrawSupplier({
        input: {
          supplierId,
          actor: roleProfiles[this.role()].name,
          role: this.role(),
        },
      }),
    );
    this.withdrawArmed.set(false);
    this.withdrawTarget.set(null);
  }

  withdrawSelectionChanged(supplierId: string | null): void {
    this.withdrawTarget.set(supplierId);
    this.withdrawArmed.set(false);
  }
}
