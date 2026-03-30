import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize, Subscription, timeout } from 'rxjs';
import DataTable from 'datatables.net-bs5';
import { DepartmentDto, DepartmentService } from '../../services/department.service';
import { SkillMappingDto, SkillService } from '../../services/skill.service';

type DepartmentSkillMode = 'departments' | 'skills';

@Component({
  selector: 'app-department-skills',
  imports: [ReactiveFormsModule],
  templateUrl: './department-skills.component.html',
  styleUrl: './department-skills.component.css'
})
export class DepartmentSkillsComponent implements OnInit, OnDestroy {
  @ViewChild('departmentsDataTable') protected departmentsDataTable?: ElementRef<HTMLTableElement>;
  @ViewChild('skillMappingsDataTable') protected skillMappingsDataTable?: ElementRef<HTMLTableElement>;

  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly departmentService = inject(DepartmentService);
  private readonly skillService = inject(SkillService);
  private routeSubscription?: Subscription;
  private readonly requestTimeoutMs = 15000;
  private departmentTable: any = null;
  private skillTable: any = null;
  private departmentTableClickHandler: ((event: Event) => void) | null = null;
  private skillTableClickHandler: ((event: Event) => void) | null = null;
  private departmentFilterCleanupCallbacks: Array<() => void> = [];
  private skillFilterCleanupCallbacks: Array<() => void> = [];

  protected mode: DepartmentSkillMode = 'departments';
  protected departmentErrorMessage = '';
  protected departmentSuccessMessage = '';
  protected skillErrorMessage = '';
  protected skillSuccessMessage = '';
  protected isSavingDepartment = false;
  protected isSavingSkill = false;
  protected isLoadingDepartments = false;
  protected isLoadingSkills = false;
  protected departments: DepartmentDto[] = [];
  protected skillMappings: SkillMappingDto[] = [];
  protected editingDepartmentId: number | null = null;
  protected editingSkillMappingId: number | null = null;

  protected departmentForm = this.fb.group({
    departmentName: ['', [Validators.required, Validators.maxLength(150)]],
    isActive: [true]
  });

  protected skillForm = this.fb.group({
    skillName: ['', [Validators.required, Validators.maxLength(150)]],
    departmentId: [null as number | null, [Validators.required]],
    isActive: [true]
  });

  ngOnInit(): void {
    this.routeSubscription = this.route.url.subscribe((segments) => {
      const lastSegment = segments.at(-1)?.path ?? 'departments';
      this.mode = lastSegment === 'skills' ? 'skills' : 'departments';
      if (this.mode === 'departments') {
        this.destroySkillTable();
      } else {
        this.destroyDepartmentTable();
      }
      this.loadData();
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    this.destroyDepartmentTable();
    this.destroySkillTable();
  }

  protected submitDepartmentForm(): void {
    if (this.departmentForm.invalid || this.isSavingDepartment) {
      this.departmentForm.markAllAsTouched();
      return;
    }

    this.departmentErrorMessage = '';
    this.departmentSuccessMessage = '';
    this.isSavingDepartment = true;
    const payload = {
      departmentName: this.departmentForm.controls.departmentName.value?.trim() ?? '',
      isActive: this.departmentForm.controls.isActive.value ?? true
    };

    const request$ = this.editingDepartmentId
      ? this.departmentService.updateDepartment(this.editingDepartmentId, payload)
      : this.departmentService.createDepartment(payload);

    request$
      .pipe(timeout(this.requestTimeoutMs), finalize(() => (this.isSavingDepartment = false)))
      .subscribe({
        next: () => {
          this.departmentSuccessMessage = this.editingDepartmentId
            ? 'Department updated successfully.'
            : 'Department created successfully.';
          this.resetDepartmentForm();
          this.loadDepartments();
        },
        error: (error) => {
          this.departmentErrorMessage = this.getApiErrorMessage(error, 'Unable to save department.');
        }
      });
  }

  protected startEditDepartment(department: DepartmentDto): void {
    this.editingDepartmentId = department.departmentId;
    this.departmentForm.patchValue({
      departmentName: department.departmentName,
      isActive: department.isActive
    });
  }

  protected deactivateDepartment(department: DepartmentDto): void {
    this.departmentErrorMessage = '';
    this.departmentSuccessMessage = '';
    this.departmentService
      .deactivateDepartment(department.departmentId)
      .pipe(timeout(this.requestTimeoutMs))
      .subscribe({
        next: () => {
          this.departmentSuccessMessage = 'Department deactivated successfully.';
          if (this.editingDepartmentId === department.departmentId) {
            this.resetDepartmentForm();
          }
          this.loadDepartments();
          if (this.mode === 'skills') {
            this.loadSkillMappings();
          }
        },
        error: (error) => {
          this.departmentErrorMessage = this.getApiErrorMessage(error, 'Unable to deactivate department.');
        }
      });
  }

  protected toggleDepartmentStatus(department: DepartmentDto): void {
    if (department.isActive) {
      this.deactivateDepartment(department);
      return;
    }

    this.departmentService
      .updateDepartment(department.departmentId, {
        departmentName: department.departmentName,
        isActive: true
      })
      .pipe(timeout(this.requestTimeoutMs))
      .subscribe({
        next: () => {
          this.departmentSuccessMessage = 'Department activated successfully.';
          this.loadDepartments();
        },
        error: (error) => {
          this.departmentErrorMessage = this.getApiErrorMessage(error, 'Unable to activate department.');
        }
      });
  }

  protected submitSkillForm(): void {
    if (this.skillForm.invalid || this.isSavingSkill) {
      this.skillForm.markAllAsTouched();
      return;
    }

    this.skillErrorMessage = '';
    this.skillSuccessMessage = '';
    this.isSavingSkill = true;
    const payload = {
      skillName: this.skillForm.controls.skillName.value?.trim() ?? '',
      departmentId: this.skillForm.controls.departmentId.value ?? 0,
      isActive: this.skillForm.controls.isActive.value ?? true
    };

    const request$ = this.editingSkillMappingId
      ? this.skillService.updateSkillMapping(this.editingSkillMappingId, payload)
      : this.skillService.createSkill(payload);

    request$
      .pipe(timeout(this.requestTimeoutMs), finalize(() => (this.isSavingSkill = false)))
      .subscribe({
        next: () => {
          this.skillSuccessMessage = this.editingSkillMappingId
            ? 'Skill mapping updated successfully.'
            : 'Skill mapped to department successfully.';
          this.resetSkillForm();
          this.loadSkillMappings();
        },
        error: (error) => {
          this.skillErrorMessage = this.getApiErrorMessage(error, 'Unable to save skill.');
        }
      });
  }

  protected startEditSkillMapping(mapping: SkillMappingDto): void {
    if (!this.canManageMapping(mapping)) {
      return;
    }
    this.editingSkillMappingId = mapping.id;
    this.skillForm.patchValue({
      skillName: mapping.skillName,
      departmentId: mapping.departmentId > 0 ? mapping.departmentId : null,
      isActive: mapping.isActive
    });
  }

  protected toggleSkillMappingStatus(mapping: SkillMappingDto): void {
    if (!this.canManageMapping(mapping)) {
      return;
    }
    this.skillErrorMessage = '';
    this.skillSuccessMessage = '';
    this.skillService
      .updateSkillMappingStatus(mapping.id, !mapping.isActive)
      .pipe(timeout(this.requestTimeoutMs))
      .subscribe({
        next: () => {
          this.skillSuccessMessage = mapping.isActive
            ? 'Skill mapping deactivated successfully.'
            : 'Skill mapping activated successfully.';
          if (this.editingSkillMappingId === mapping.id) {
            this.resetSkillForm();
          }
          this.loadSkillMappings();
        },
        error: (error) => {
          this.skillErrorMessage = this.getApiErrorMessage(error, 'Unable to update skill mapping status.');
        }
      });
  }

  private loadData(): void {
    this.loadDepartments();
    if (this.mode === 'skills') {
      this.loadSkillMappings();
    } else {
      this.skillErrorMessage = '';
      this.skillSuccessMessage = '';
      this.editingSkillMappingId = null;
    }
  }

  private loadDepartments(): void {
    this.isLoadingDepartments = true;
    this.departmentService
      .getDepartments()
      .pipe(timeout(this.requestTimeoutMs), finalize(() => (this.isLoadingDepartments = false)))
      .subscribe({
        next: (departments) => {
          this.departments = departments
            .slice()
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          if (this.mode === 'departments') {
            this.initializeDepartmentTable();
          }
        },
        error: (error) => {
          this.departmentErrorMessage = this.getApiErrorMessage(error, 'Unable to load departments.');
        }
      });
  }

  private loadSkillMappings(): void {
    this.isLoadingSkills = true;
    this.skillService
      .getSkillMappings()
      .pipe(timeout(this.requestTimeoutMs), finalize(() => (this.isLoadingSkills = false)))
      .subscribe({
        next: (mappings) => {
          this.skillMappings = mappings
            .slice()
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          if (this.mode === 'skills') {
            this.initializeSkillTable();
          }
        },
        error: (error) => {
          this.skillErrorMessage = this.getApiErrorMessage(error, 'Unable to load skills.');
        }
      });
  }

  protected resetDepartmentForm(): void {
    this.editingDepartmentId = null;
    this.departmentForm.reset({
      departmentName: '',
      isActive: true
    });
    this.departmentForm.markAsPristine();
    this.departmentForm.markAsUntouched();
  }

  protected resetSkillForm(): void {
    this.editingSkillMappingId = null;
    this.skillForm.reset({
      skillName: '',
      departmentId: null,
      isActive: true
    });
    this.skillForm.markAsPristine();
    this.skillForm.markAsUntouched();
  }

  private initializeDepartmentTable(): void {
    setTimeout(() => {
      if (this.mode !== 'departments') {
        return;
      }
      const tableElement = this.departmentsDataTable?.nativeElement;
      if (!tableElement) {
        return;
      }

      this.destroyDepartmentTable();
      this.bindDepartmentTableActions(tableElement);
      this.departmentTable = new DataTable(tableElement, {
        data: this.departments,
        searching: true,
        paging: true,
        info: true,
        pageLength: 10,
        lengthMenu: [5, 10, 20, 50],
        order: [[2, 'desc']],
        columns: [
          { data: 'departmentName' },
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
            render: (_: unknown, __: unknown, row: DepartmentDto) =>
              `
              <div class="btn-group btn-group-sm">
                <button type="button" class="btn btn-primary" data-action="edit" data-id="${row.departmentId}">Edit</button>
                <button type="button" class="btn btn-outline-secondary" data-action="toggle" data-id="${row.departmentId}">
                  ${row.isActive ? 'Deactivate' : 'Activate'}
                </button>
              </div>
              `
          }
        ],
        language: { emptyTable: 'No departments found.' }
      });
      this.bindDepartmentFilters(tableElement);
    }, 0);
  }

  private initializeSkillTable(): void {
    setTimeout(() => {
      if (this.mode !== 'skills') {
        return;
      }
      const tableElement = this.skillMappingsDataTable?.nativeElement;
      if (!tableElement) {
        return;
      }

      this.destroySkillTable();
      this.bindSkillTableActions(tableElement);
      this.skillTable = new DataTable(tableElement, {
        data: this.skillMappings,
        searching: true,
        paging: true,
        info: true,
        pageLength: 10,
        lengthMenu: [5, 10, 20, 50],
        order: [[3, 'desc']],
        columns: [
          { data: 'departmentName' },
          { data: 'skillName' },
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
            render: (_: unknown, __: unknown, row: SkillMappingDto) =>
              `
              <div class="btn-group btn-group-sm">
                <button type="button" class="btn btn-primary" data-action="edit" data-id="${row.id}" ${this.canManageMapping(row) ? '' : 'disabled'}>Edit</button>
                <button type="button" class="btn btn-outline-secondary" data-action="toggle" data-id="${row.id}" ${this.canToggleMapping(row) ? '' : 'disabled'}>
                  ${row.isActive ? 'Deactivate' : 'Activate'}
                </button>
              </div>
              `
          }
        ],
        language: { emptyTable: 'No department-skill mappings found.' }
      });
      this.bindSkillFilters(tableElement);
    }, 0);
  }

  private bindDepartmentTableActions(tableElement: HTMLTableElement): void {
    this.departmentTableClickHandler = (event: Event) => {
      const target = event.target as HTMLElement;
      const button = target.closest('button[data-action]') as HTMLButtonElement | null;
      if (!button) {
        return;
      }
      const id = Number(button.dataset['id']);
      if (Number.isNaN(id)) {
        return;
      }
      const item = this.departments.find((d) => d.departmentId === id);
      if (!item) {
        return;
      }
      const action = button.dataset['action'];
      if (action === 'edit') {
        this.startEditDepartment(item);
      } else if (action === 'toggle') {
        this.toggleDepartmentStatus(item);
      }
    };
    tableElement.addEventListener('click', this.departmentTableClickHandler);
  }

  private bindSkillTableActions(tableElement: HTMLTableElement): void {
    this.skillTableClickHandler = (event: Event) => {
      const target = event.target as HTMLElement;
      const button = target.closest('button[data-action]') as HTMLButtonElement | null;
      if (!button) {
        return;
      }
      const id = Number(button.dataset['id']);
      if (Number.isNaN(id)) {
        return;
      }
      const item = this.skillMappings.find((m) => m.id === id);
      if (!item) {
        return;
      }
      const action = button.dataset['action'];
      if (action === 'edit') {
        this.startEditSkillMapping(item);
      } else if (action === 'toggle') {
        this.toggleSkillMappingStatus(item);
      }
    };
    tableElement.addEventListener('click', this.skillTableClickHandler);
  }

  private bindDepartmentFilters(tableElement: HTMLTableElement): void {
    const filters = tableElement.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-dept-column]');
    filters.forEach((filter) => {
      const listener = () => {
        if (!this.departmentTable) {
          return;
        }
        const columnIndex = Number(filter.dataset['deptColumn']);
        if (Number.isNaN(columnIndex)) {
          return;
        }
        if (filter instanceof HTMLSelectElement && filter.value === 'all') {
          this.departmentTable.column(columnIndex).search('').draw();
          return;
        }
        if (filter instanceof HTMLSelectElement) {
          this.departmentTable.column(columnIndex).search(`^${filter.value}$`, true, false).draw();
          return;
        }
        this.departmentTable.column(columnIndex).search(filter.value).draw();
      };
      filter.addEventListener('keyup', listener);
      filter.addEventListener('change', listener);
      this.departmentFilterCleanupCallbacks.push(() => {
        filter.removeEventListener('keyup', listener);
        filter.removeEventListener('change', listener);
      });
    });
  }

  private bindSkillFilters(tableElement: HTMLTableElement): void {
    const filters = tableElement.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-skill-column]');
    filters.forEach((filter) => {
      const listener = () => {
        if (!this.skillTable) {
          return;
        }
        const columnIndex = Number(filter.dataset['skillColumn']);
        if (Number.isNaN(columnIndex)) {
          return;
        }
        if (filter instanceof HTMLSelectElement && filter.value === 'all') {
          this.skillTable.column(columnIndex).search('').draw();
          return;
        }
        if (filter instanceof HTMLSelectElement) {
          this.skillTable.column(columnIndex).search(`^${filter.value}$`, true, false).draw();
          return;
        }
        this.skillTable.column(columnIndex).search(filter.value).draw();
      };
      filter.addEventListener('keyup', listener);
      filter.addEventListener('change', listener);
      this.skillFilterCleanupCallbacks.push(() => {
        filter.removeEventListener('keyup', listener);
        filter.removeEventListener('change', listener);
      });
    });
  }

  private destroyDepartmentTable(): void {
    const tableElement = this.departmentsDataTable?.nativeElement;
    if (tableElement && this.departmentTableClickHandler) {
      tableElement.removeEventListener('click', this.departmentTableClickHandler);
      this.departmentTableClickHandler = null;
    }
    this.departmentFilterCleanupCallbacks.forEach((cleanup) => cleanup());
    this.departmentFilterCleanupCallbacks = [];
    if (this.departmentTable) {
      this.departmentTable.destroy();
      this.departmentTable = null;
    }
  }

  private destroySkillTable(): void {
    const tableElement = this.skillMappingsDataTable?.nativeElement;
    if (tableElement && this.skillTableClickHandler) {
      tableElement.removeEventListener('click', this.skillTableClickHandler);
      this.skillTableClickHandler = null;
    }
    this.skillFilterCleanupCallbacks.forEach((cleanup) => cleanup());
    this.skillFilterCleanupCallbacks = [];
    if (this.skillTable) {
      this.skillTable.destroy();
      this.skillTable = null;
    }
  }

  private canManageMapping(mapping: SkillMappingDto): boolean {
    return mapping.id !== 0;
  }

  private canToggleMapping(mapping: SkillMappingDto): boolean {
    if (mapping.id < 0 && !mapping.isActive) {
      return false;
    }
    return this.canManageMapping(mapping);
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
      if (typeof dictionary['detail'] === 'string' && dictionary['detail'].trim()) {
        return dictionary['detail'];
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
