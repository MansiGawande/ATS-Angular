import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize, timeout } from 'rxjs';
import DataTable from 'datatables.net-bs5';
import {
  InterviewStageDto,
  InterviewStageService
} from '../../services/interview-stage.service';

@Component({
  selector: 'app-interview-stages',
  imports: [ReactiveFormsModule],
  templateUrl: './interview-stages.component.html',
  styleUrl: './interview-stages.component.css'
})
export class InterviewStagesComponent implements OnInit, OnDestroy {
  @ViewChild('stagesDataTable') protected stagesDataTable?: ElementRef<HTMLTableElement>;

  private readonly fb = inject(FormBuilder);
  private readonly stageService = inject(InterviewStageService);
  private readonly requestTimeoutMs = 15000;

  private dataTable: any = null;
  private tableClickHandler: ((event: Event) => void) | null = null;
  private filterCleanupCallbacks: Array<() => void> = [];

  protected stages: InterviewStageDto[] = [];
  protected selectedStage: InterviewStageDto | null = null;
  protected isLoading = false;
  protected isSaving = false;
  protected errorMessage = '';
  protected successMessage = '';

  protected stageForm = this.fb.group({
    stageName: ['', [Validators.required, Validators.maxLength(150)]],
    orderIndex: [1, [Validators.required, Validators.min(1)]],
    isActive: [true]
  });

  ngOnInit(): void {
    this.loadStages();
  }

  ngOnDestroy(): void {
    this.destroyDataTable();
  }

  protected submitForm(): void {
    if (this.stageForm.invalid || this.isSaving) {
      this.stageForm.markAllAsTouched();
      return;
    }

    this.isSaving = true;
    this.errorMessage = '';
    this.successMessage = '';

    const payload = {
      stageName: this.stageForm.controls.stageName.value?.trim() ?? '',
      orderIndex: this.stageForm.controls.orderIndex.value ?? 1,
      isActive: this.stageForm.controls.isActive.value ?? true
    };

    const request$ = this.selectedStage
      ? this.stageService.updateStage(this.selectedStage.id, payload)
      : this.stageService.createStage(payload);

    request$
      .pipe(timeout(this.requestTimeoutMs), finalize(() => (this.isSaving = false)))
      .subscribe({
        next: () => {
          this.successMessage = this.selectedStage
            ? 'Interview stage updated successfully.'
            : 'Interview stage created successfully.';
          this.resetForm();
          this.loadStages();
        },
        error: (error) => {
          this.errorMessage = this.getApiErrorMessage(error, 'Unable to save interview stage.');
        }
      });
  }

  protected cancelEdit(): void {
    this.resetForm();
  }

  private loadStages(): void {
    this.isLoading = true;
    this.stageService
      .getStages()
      .pipe(timeout(this.requestTimeoutMs), finalize(() => (this.isLoading = false)))
      .subscribe({
        next: (stages) => {
          this.stages = stages;
          this.initializeDataTable();
        },
        error: (error) => {
          this.errorMessage = this.getApiErrorMessage(error, 'Unable to load interview stages.');
        }
      });
  }

  private initializeDataTable(): void {
    setTimeout(() => {
      const tableElement = this.stagesDataTable?.nativeElement;
      if (!tableElement) {
        return;
      }

      this.destroyDataTable();
      this.bindTableActions(tableElement);

      this.dataTable = new DataTable(tableElement, {
        data: this.stages,
        searching: true,
        paging: true,
        info: true,
        pageLength: 10,
        order: [[1, 'asc']],
        columns: [
          { data: 'stageName' },
          { data: 'orderIndex' },
          {
            data: 'isActive',
            render: (value: boolean) =>
              value
                ? '<span class="badge text-bg-success">Active</span>'
                : '<span class="badge text-bg-secondary">Inactive</span>'
          },
          {
            data: 'createdAt',
            render: (value: string) => new Date(value).toLocaleString()
          },
          {
            data: null,
            orderable: false,
            searchable: false,
            render: (_: unknown, __: unknown, row: InterviewStageDto) =>
              `
              <div class="btn-group btn-group-sm">
                <button type="button" class="btn btn-primary" data-action="edit" data-id="${row.id}">Edit</button>
                <button type="button" class="btn btn-outline-secondary" data-action="toggle" data-id="${row.id}">
                  ${row.isActive ? 'Deactivate' : 'Activate'}
                </button>
              </div>
              `
          }
        ],
        language: { emptyTable: 'No interview stages found.' }
      });

      this.bindFilters(tableElement);
    }, 0);
  }

  private bindTableActions(tableElement: HTMLTableElement): void {
    this.tableClickHandler = (event: Event) => {
      const target = event.target as HTMLElement;
      const button = target.closest('button[data-action]') as HTMLButtonElement | null;
      if (!button) {
        return;
      }

      const stageId = Number(button.dataset['id']);
      if (Number.isNaN(stageId)) {
        return;
      }

      const stage = this.stages.find((item) => item.id === stageId);
      if (!stage) {
        return;
      }

      const action = button.dataset['action'];
      if (action === 'edit') {
        this.startEdit(stage);
      } else if (action === 'toggle') {
        this.toggleStatus(stage);
      }
    };
    tableElement.addEventListener('click', this.tableClickHandler);
  }

  private bindFilters(tableElement: HTMLTableElement): void {
    const filters = tableElement.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-stage-column]');
    filters.forEach((filter) => {
      const listener = () => {
        if (!this.dataTable) {
          return;
        }
        const columnIndex = Number(filter.dataset['stageColumn']);
        if (Number.isNaN(columnIndex)) {
          return;
        }
        if (filter instanceof HTMLSelectElement && filter.value === 'all') {
          this.dataTable.column(columnIndex).search('').draw();
          return;
        }
        if (filter instanceof HTMLSelectElement) {
          this.dataTable.column(columnIndex).search(`^${filter.value}$`, true, false).draw();
          return;
        }
        this.dataTable.column(columnIndex).search(filter.value).draw();
      };
      filter.addEventListener('keyup', listener);
      filter.addEventListener('change', listener);
      this.filterCleanupCallbacks.push(() => {
        filter.removeEventListener('keyup', listener);
        filter.removeEventListener('change', listener);
      });
    });
  }

  private startEdit(stage: InterviewStageDto): void {
    this.selectedStage = stage;
    this.stageForm.patchValue({
      stageName: stage.stageName,
      orderIndex: stage.orderIndex,
      isActive: stage.isActive
    });
  }

  private toggleStatus(stage: InterviewStageDto): void {
    this.errorMessage = '';
    this.successMessage = '';
    this.stageService
      .updateStatus(stage.id, !stage.isActive)
      .pipe(timeout(this.requestTimeoutMs))
      .subscribe({
        next: () => {
          this.successMessage = stage.isActive
            ? 'Interview stage deactivated successfully.'
            : 'Interview stage activated successfully.';
          this.loadStages();
        },
        error: (error) => {
          this.errorMessage = this.getApiErrorMessage(error, 'Unable to update interview stage status.');
        }
      });
  }

  private resetForm(): void {
    this.selectedStage = null;
    this.stageForm.reset({
      stageName: '',
      orderIndex: 1,
      isActive: true
    });
    this.stageForm.markAsPristine();
    this.stageForm.markAsUntouched();
  }

  private destroyDataTable(): void {
    const tableElement = this.stagesDataTable?.nativeElement;
    if (tableElement && this.tableClickHandler) {
      tableElement.removeEventListener('click', this.tableClickHandler);
      this.tableClickHandler = null;
    }
    this.filterCleanupCallbacks.forEach((cleanup) => cleanup());
    this.filterCleanupCallbacks = [];
    if (this.dataTable) {
      this.dataTable.destroy();
      this.dataTable = null;
    }
  }

  private getApiErrorMessage(error: unknown, fallback: string): string {
    const typed = error as { error?: unknown; message?: string };
    if (typeof typed?.error === 'string' && typed.error.trim()) {
      return typed.error;
    }
    if (Array.isArray(typed?.error)) {
      return typed.error.join(', ');
    }
    if (typed?.error && typeof typed.error === 'object') {
      const dictionary = typed.error as Record<string, unknown>;
      if (typeof dictionary['title'] === 'string' && dictionary['title'].trim()) {
        return dictionary['title'];
      }
      const errors = dictionary['errors'];
      if (errors && typeof errors === 'object') {
        const messages = Object.values(errors as Record<string, unknown>)
          .flatMap((value) => (Array.isArray(value) ? value : [value]))
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
        if (messages.length > 0) {
          return messages.join(', ');
        }
      }
    }
    return typed?.message || fallback;
  }
}
