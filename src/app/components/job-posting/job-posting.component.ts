import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, finalize, timeout } from 'rxjs';
import DataTable from 'datatables.net-bs5';
import { DepartmentDto, DepartmentService } from '../../services/department.service';
import { JobDto, JobService } from '../../services/job.service';
import { InterviewStageDto, InterviewStageService } from '../../services/interview-stage.service';
import { SkillMappingDto, SkillService } from '../../services/skill.service';
import { ManagedUserDto, UserManagementService } from '../../services/user-management.service';
import { SessionCookieService } from '../../services/session-cookie.service';

type JobPageMode = 'table' | 'form';

@Component({
  selector: 'app-job-posting',
  imports: [ReactiveFormsModule],
  templateUrl: './job-posting.component.html',
  styleUrl: './job-posting.component.css'
})
export class JobPostingComponent implements OnInit, OnDestroy {
  @ViewChild('jobsDataTable') protected jobsDataTable?: ElementRef<HTMLTableElement>;

  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly jobService = inject(JobService);
  private readonly departmentService = inject(DepartmentService);
  private readonly interviewStageService = inject(InterviewStageService);
  private readonly skillService = inject(SkillService);
  private readonly userManagementService = inject(UserManagementService);
  private readonly sessionCookieService = inject(SessionCookieService);
  private readonly requestTimeoutMs = 15000;

  private dataTable: any = null;
  private tableClickHandler: ((event: Event) => void) | null = null;
  private filterCleanupCallbacks: Array<() => void> = [];
  private departmentChangeSubscription?: Subscription;
  private queryParamSubscription?: Subscription;
  private allSkillMappings: SkillMappingDto[] = [];
  private pendingEditJobId: number | null = null;

  protected readonly isHrManager = this.sessionCookieService
    .getRoles()
    .some((role) => role.toLowerCase() === 'hrmanager');
  protected readonly isRecruiter = this.sessionCookieService
    .getRoles()
    .some((role) => role.toLowerCase() === 'recruiter');
  protected readonly currentUserId = this.sessionCookieService.getUserId();

  protected pageMode: JobPageMode = 'table';
  protected jobs: JobDto[] = [];
  protected departments: DepartmentDto[] = [];
  protected interviewStages: InterviewStageDto[] = [];
  protected recruiters: ManagedUserDto[] = [];
  protected selectedJob: JobDto | null = null;
  protected departmentSkills: string[] = [];
  protected skillsHintMessage = '';
  protected isLoadingJobs = false;
  protected isSavingJob = false;
  protected jobErrorMessage = '';
  protected jobSuccessMessage = '';

  protected readonly experienceLevelOptions = [
    'Intern',
    'Entry Level',
    'Junior',
    'Mid-Level',
    'Senior',
    'Lead',
    'Architect',
    'Manager'
  ];
  protected readonly employmentTypeOptions = [
    'Full-time',
    'Part-time',
    'Contract',
    'Internship',
    'Freelance'
  ];
  protected readonly workModeOptions = ['Remote', 'Hybrid', 'On-site'];
  protected customEmploymentType = false;
  protected customExperienceLevel = false;

  protected jobForm = this.fb.group({
    departmentId: [null as number | null, [Validators.required]],
    jobTitle: ['', [Validators.required, Validators.maxLength(200)]],
    description: ['', [Validators.required]],
    employmentType: ['Full-time'],
    experienceLevel: ['Mid-Level'],
    experienceRequired: [''],
    educationRequirement: [''],
    minSalary: [null as number | null],
    maxSalary: [null as number | null],
    location: [''],
    workMode: ['On-site'],
    numberOfOpenings: [1, [Validators.required, Validators.min(1)]],
    applicationDeadline: [''],
    status: ['Open'],
    assignedRecruiterId: [''],
    stagesConfirmed: [false],
    isActive: [true]
  });

  ngOnInit(): void {
    this.loadDepartments();
    this.loadSkillMappings();
    this.loadInterviewStages();
    this.jobForm.controls.assignedRecruiterId.clearValidators();
    this.jobForm.controls.assignedRecruiterId.updateValueAndValidity({ emitEvent: false });
    if (this.isHrManager) {
      this.loadRecruiters();
    }
    this.bindDepartmentSkillSync();

    // Subscribe to query params so edit always works, even when component is already loaded
    this.queryParamSubscription = this.route.queryParamMap.subscribe((params) => {
      const editIdParam = params.get('editJobId');
      const editId = editIdParam ? Number(editIdParam) : null;
      if (editId && !Number.isNaN(editId)) {
        this.pendingEditJobId = editId;
        // Clear the query param from URL immediately (so Back button doesn't re-trigger)
        void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
        // If jobs are already loaded, open the edit form right away
        if (this.jobs.length > 0) {
          const match = this.jobs.find((item) => item.jobId === this.pendingEditJobId);
          if (match) {
            this.openEditForm(match);
            this.pendingEditJobId = null;
          }
        }
      }
    });

    this.loadJobs();
  }

  ngOnDestroy(): void {
    this.departmentChangeSubscription?.unsubscribe();
    this.queryParamSubscription?.unsubscribe();
    this.destroyDataTable();
  }

  protected openCreateForm(): void {
    this.resetJobForm();
    this.selectedJob = null;
    this.pageMode = 'form';
    this.pendingEditJobId = null;
  }

  protected backToTable(): void {
    this.pageMode = 'table';
    this.selectedJob = null;
    this.resetJobForm();
    this.initializeDataTable();
  }

  protected onEmploymentTypeSelect(value: string): void {
    if (value === '__custom__') {
      this.customEmploymentType = true;
      if (this.employmentTypeOptions.includes(this.jobForm.controls.employmentType.value ?? '')) {
        this.jobForm.controls.employmentType.setValue('');
      }
      return;
    }
    this.customEmploymentType = false;
    this.jobForm.controls.employmentType.setValue(value);
  }

  protected onExperienceLevelSelect(value: string): void {
    if (value === '__custom__') {
      this.customExperienceLevel = true;
      if (this.experienceLevelOptions.includes(this.jobForm.controls.experienceLevel.value ?? '')) {
        this.jobForm.controls.experienceLevel.setValue('');
      }
      return;
    }
    this.customExperienceLevel = false;
    this.jobForm.controls.experienceLevel.setValue(value);
  }

  protected submitJobForm(): void {
    if (this.jobForm.invalid || this.isSavingJob) {
      this.jobForm.markAllAsTouched();
      this.jobErrorMessage = 'Please fill all required fields before submitting.';
      return;
    }

    const minSalary = this.jobForm.controls.minSalary.value;
    const maxSalary = this.jobForm.controls.maxSalary.value;
    if (minSalary !== null && maxSalary !== null && maxSalary < minSalary) {
      this.jobErrorMessage = 'Max salary must be greater than or equal to min salary.';
      return;
    }

    const payload = {
      departmentId: this.jobForm.controls.departmentId.value ?? 0,
      jobTitle: this.jobForm.controls.jobTitle.value?.trim() ?? '',
      description: this.jobForm.controls.description.value?.trim() ?? '',
      employmentType: this.jobForm.controls.employmentType.value?.trim() ?? null,
      experienceLevel: this.jobForm.controls.experienceLevel.value?.trim() ?? null,
      experienceRequired: this.jobForm.controls.experienceRequired.value?.trim() ?? null,
      educationRequirement: this.jobForm.controls.educationRequirement.value?.trim() ?? null,
      minSalary,
      maxSalary,
      location: this.jobForm.controls.location.value?.trim() ?? null,
      workMode: this.jobForm.controls.workMode.value?.trim() || 'On-site',
      isRemote: (this.jobForm.controls.workMode.value ?? 'On-site') === 'Remote',
      numberOfOpenings: this.jobForm.controls.numberOfOpenings.value ?? 1,
      applicationDeadline: this.jobForm.controls.applicationDeadline.value || null,
      status: this.jobForm.controls.status.value?.trim() ?? 'Open',
      assignedRecruiterId: this.isRecruiter
        ? this.currentUserId
        : (this.jobForm.controls.assignedRecruiterId.value || null),
      isActive: this.jobForm.controls.isActive.value ?? true
    };

    this.isSavingJob = true;
    this.jobErrorMessage = '';
    this.jobSuccessMessage = '';
    const request$ = this.selectedJob
      ? this.jobService.updateJob(this.selectedJob.jobId, payload)
      : this.jobService.createJob(payload);

    request$
      .pipe(timeout(this.requestTimeoutMs), finalize(() => (this.isSavingJob = false)))
      .subscribe({
        next: () => {
          this.isSavingJob = false;
          this.jobSuccessMessage = this.selectedJob
            ? 'Job updated successfully.'
            : 'Job created successfully.';
          this.backToTable();
          setTimeout(() => this.loadJobs(), 0);
        },
        error: (error) => {
          this.isSavingJob = false;
          this.jobErrorMessage = this.getApiErrorMessage(error, 'Unable to save job.');
        }
      });
  }

  private loadJobs(): void {
    this.isLoadingJobs = true;
    this.jobService
      .getJobs()
      .pipe(timeout(this.requestTimeoutMs), finalize(() => (this.isLoadingJobs = false)))
      .subscribe({
        next: (jobs) => {
          this.jobs = jobs;
          if (this.pendingEditJobId) {
            const match = this.jobs.find((item) => item.jobId === this.pendingEditJobId);
            if (match) {
              this.openEditForm(match);
            }
            this.pendingEditJobId = null;
          }
          this.initializeDataTable();
        },
        error: (error) => {
          this.jobErrorMessage = this.getApiErrorMessage(error, 'Unable to load jobs.');
        }
      });
  }

  private loadDepartments(): void {
    this.departmentService.getDepartments().pipe(timeout(this.requestTimeoutMs)).subscribe({
      next: (departments) => {
        this.departments = departments.filter((item) => item.isActive);
      }
    });
  }

  private loadInterviewStages(): void {
    this.interviewStageService.getStages().pipe(timeout(this.requestTimeoutMs)).subscribe({
      next: (stages) => {
        this.interviewStages = stages.filter((item) => item.isActive).sort((a, b) => a.orderIndex - b.orderIndex);
        if (this.interviewStages.length > 0) {
          this.jobForm.controls.stagesConfirmed.setValidators([Validators.requiredTrue]);
        } else {
          this.jobForm.controls.stagesConfirmed.clearValidators();
        }
        this.jobForm.controls.stagesConfirmed.updateValueAndValidity({ emitEvent: false });
      },
      error: () => {
        this.interviewStages = [];
        this.jobForm.controls.stagesConfirmed.clearValidators();
        this.jobForm.controls.stagesConfirmed.updateValueAndValidity({ emitEvent: false });
      }
    });
  }

  private loadSkillMappings(): void {
    this.skillService.getSkillMappings().pipe(timeout(this.requestTimeoutMs)).subscribe({
      next: (mappings) => {
        this.allSkillMappings = mappings.filter((item) => item.isActive && item.departmentId > 0);
        this.syncDepartmentSkills(this.jobForm.controls.departmentId.value);
      },
      error: () => {
        this.allSkillMappings = [];
        this.syncDepartmentSkills(this.jobForm.controls.departmentId.value);
      }
    });
  }

  private bindDepartmentSkillSync(): void {
    this.departmentChangeSubscription = this.jobForm.controls.departmentId.valueChanges.subscribe((departmentId) => {
      this.syncDepartmentSkills(departmentId);
    });
  }

  private syncDepartmentSkills(departmentId: number | null): void {
    if (!departmentId) {
      this.departmentSkills = [];
      this.skillsHintMessage = 'Select department to view required skills.';
      return;
    }

    const skills = this.allSkillMappings
      .filter((item) => item.departmentId === departmentId)
      .map((item) => item.skillName)
      .filter((name) => name && name.trim().length > 0);

    this.departmentSkills = [...new Set(skills)].sort((a, b) => a.localeCompare(b));
    this.skillsHintMessage =
      this.departmentSkills.length > 0 ? '' : 'Please add the required skills for this department.';
  }

  private loadRecruiters(): void {
    this.userManagementService.getUsers().pipe(timeout(this.requestTimeoutMs)).subscribe({
      next: (users) => {
        this.recruiters = users.filter((item) => item.role === 'Recruiter' && item.isActive);
      }
    });
  }

  private initializeDataTable(): void {
    setTimeout(() => {
      if (this.pageMode !== 'table') {
        return;
      }
      const tableElement = this.jobsDataTable?.nativeElement;
      if (!tableElement) {
        return;
      }
      this.destroyDataTable();
      this.bindTableActions(tableElement);
      this.dataTable = new DataTable(tableElement, {
        data: this.jobs,
        searching: true,
        paging: true,
        info: true,
        pageLength: 10,
        lengthMenu: [5, 10, 20, 50],
        order: [[this.getCreatedAtColumnIndex(), 'desc']],
        columns: [
          { data: 'jobTitle' },
          {
            data: 'departmentId',
            render: (value: number) => this.getDepartmentName(value)
          },
          {
            data: 'assignedRecruiterId',
            visible: this.isHrManager,
            render: (value: string | null) => this.getRecruiterName(value)
          },
          { data: 'employmentType' },
          {
            data: 'workMode',
            render: (value: string | null) => value || '-'
          },
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
            render: (_: unknown, __: unknown, row: JobDto) =>
              `
                <div class="btn-group btn-group-sm">
                  <button type="button" class="btn btn-primary" data-action="edit" data-id="${row.jobId}">Edit</button>
                  <button type="button" class="btn btn-outline-secondary" data-action="toggle" data-id="${row.jobId}">
                    ${row.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              `
          }
        ],
        language: { emptyTable: 'No jobs found.' }
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
      const jobId = Number(button.dataset['id']);
      if (Number.isNaN(jobId)) {
        return;
      }
      const job = this.jobs.find((item) => item.jobId === jobId);
      if (!job) {
        return;
      }
      const action = button.dataset['action'];
      if (action === 'edit') {
        this.openEditForm(job);
      } else if (action === 'toggle') {
        this.toggleJobStatus(job);
      }
    };
    tableElement.addEventListener('click', this.tableClickHandler);
  }

  private bindFilters(tableElement: HTMLTableElement): void {
    const filters = tableElement.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-job-column]');
    filters.forEach((filter) => {
      const listener = () => {
        if (!this.dataTable) {
          return;
        }
        const columnIndex = Number(filter.dataset['jobColumn']);
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

  protected openEditForm(job: JobDto): void {
    this.selectedJob = job;
    this.pageMode = 'form';
    this.customEmploymentType = !!job.employmentType && !this.employmentTypeOptions.includes(job.employmentType);
    this.customExperienceLevel = !!job.experienceLevel && !this.experienceLevelOptions.includes(job.experienceLevel);
    this.jobForm.patchValue({
      departmentId: job.departmentId,
      jobTitle: job.jobTitle,
      description: job.description,
      employmentType: job.employmentType ?? '',
      experienceLevel: job.experienceLevel ?? '',
      experienceRequired: job.experienceRequired ?? '',
      educationRequirement: job.educationRequirement ?? '',
      minSalary: job.minSalary,
      maxSalary: job.maxSalary,
      location: job.location ?? '',
      workMode: job.workMode ?? (job.isRemote ? 'Remote' : 'On-site'),
      numberOfOpenings: job.numberOfOpenings,
      applicationDeadline: job.applicationDeadline ? job.applicationDeadline.substring(0, 10) : '',
      status: job.status ?? 'Open',
      assignedRecruiterId: job.assignedRecruiterId ?? '',
      stagesConfirmed: this.interviewStages.length > 0,
      isActive: job.isActive
    });
  }

  protected toggleJobStatus(job: JobDto): void {
    if (!job.isActive) {
      this.jobService
        .updateJob(job.jobId, {
          departmentId: job.departmentId,
          jobTitle: job.jobTitle,
          description: job.description,
          employmentType: job.employmentType,
          experienceLevel: job.experienceLevel,
          experienceRequired: job.experienceRequired,
          educationRequirement: job.educationRequirement,
          minSalary: job.minSalary,
          maxSalary: job.maxSalary,
          location: job.location,
          workMode: job.workMode,
          isRemote: job.isRemote,
          numberOfOpenings: job.numberOfOpenings,
          applicationDeadline: job.applicationDeadline,
          status: job.status,
          assignedRecruiterId: job.assignedRecruiterId,
          isActive: true
        })
        .pipe(timeout(this.requestTimeoutMs))
        .subscribe({
          next: () => {
            this.jobSuccessMessage = 'Job activated successfully.';
            this.loadJobs();
          },
          error: (error) => {
            this.jobErrorMessage = this.getApiErrorMessage(error, 'Unable to update job status.');
          }
        });
      return;
    }

    this.jobService
      .deactivateJob(job.jobId)
      .pipe(timeout(this.requestTimeoutMs))
      .subscribe({
        next: () => {
          this.jobSuccessMessage = 'Job deactivated successfully.';
          this.loadJobs();
        },
        error: (error) => {
          this.jobErrorMessage = this.getApiErrorMessage(error, 'Unable to update job status.');
        }
      });
  }

  private resetJobForm(): void {
    this.customEmploymentType = false;
    this.customExperienceLevel = false;
    this.jobForm.reset({
      departmentId: null,
      jobTitle: '',
      description: '',
      employmentType: 'Full-time',
      experienceLevel: 'Mid-Level',
      experienceRequired: '',
      educationRequirement: '',
      minSalary: null,
      maxSalary: null,
      location: '',
      workMode: 'On-site',
      numberOfOpenings: 1,
      applicationDeadline: '',
      status: 'Open',
      assignedRecruiterId: this.isRecruiter ? this.currentUserId : '',
      stagesConfirmed: false,
      isActive: true
    });
    this.jobForm.markAsPristine();
    this.jobForm.markAsUntouched();
  }

  private destroyDataTable(): void {
    const tableElement = this.jobsDataTable?.nativeElement;
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

  protected getDepartmentName(departmentId: number): string {
    return this.departments.find((item) => item.departmentId === departmentId)?.departmentName ?? '-';
  }

  protected getEmploymentTypeSelectValue(): string {
    const value = this.jobForm.controls.employmentType.value ?? '';
    if (!value) {
      return '';
    }
    return this.employmentTypeOptions.includes(value) ? value : '__custom__';
  }

  protected getExperienceLevelSelectValue(): string {
    const value = this.jobForm.controls.experienceLevel.value ?? '';
    if (!value) {
      return '';
    }
    return this.experienceLevelOptions.includes(value) ? value : '__custom__';
  }

  protected formatDateTime(value: string): string {
    return new Date(value).toLocaleString();
  }

  private getRecruiterName(recruiterId: string | null): string {
    if (!recruiterId) {
      return '-';
    }
    const recruiter = this.recruiters.find((item) => item.id === recruiterId);
    return recruiter ? `${recruiter.firstName} ${recruiter.lastName}` : recruiterId;
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
      if (typeof dictionary['title'] === 'string') {
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

  protected getEmploymentTypeColumnIndex(): number {
    return this.isHrManager ? 3 : 2;
  }

  protected getWorkModeColumnIndex(): number {
    return this.isHrManager ? 4 : 3;
  }

  protected getStatusColumnIndex(): number {
    return this.isHrManager ? 5 : 4;
  }

  protected getCreatedAtColumnIndex(): number {
    return this.isHrManager ? 6 : 5;
  }
}
