import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize, timeout } from 'rxjs';
import DataTable from 'datatables.net-bs5';
import { environment } from '../../../environments/environment';
import { CompanyDto, CompanyService } from '../../services/company.service';
import { SessionCookieService } from '../../services/session-cookie.service';

type CompanyPageMode = 'table' | 'create' | 'edit';

@Component({
  selector: 'app-company',
  imports: [ReactiveFormsModule],
  templateUrl: './company.component.html',
  styleUrl: './company.component.css'
})
export class CompanyComponent implements OnInit, OnDestroy {
  @ViewChild('companiesDataTable') protected companiesDataTable?: ElementRef<HTMLTableElement>;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly companyService = inject(CompanyService);
  private readonly sessionCookieService = inject(SessionCookieService);
  private readonly backendOrigin = environment.backendOriginUrl;
  private selectedProfilePicture: File | null = null;
  private selectedPictureObjectUrl: string | null = null;
  private dataTable: any = null;
  private tableClickHandler: ((event: Event) => void) | null = null;
  private filterCleanupCallbacks: Array<() => void> = [];

  protected readonly isAdmin = this.sessionCookieService
    .getRoles()
    .some((role) => role.toLowerCase() === 'admin');
  protected pageMode: CompanyPageMode = 'table';
  protected editingCompanyId: number | null = null;
  protected companyErrorMessage = '';
  protected companySuccessMessage = '';
  protected isSavingCompany = false;
  protected isLoadingCompanies = false;
  protected companyImagePreviewUrl: string | null = null;
  protected companies: CompanyDto[] = [];

  protected companyForm = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(150)]],
    industry: ['', [Validators.required, Validators.maxLength(100)]],
    companySize: ['', [Validators.required, Validators.maxLength(50)]],
    website: ['', [Validators.required, Validators.pattern(/^https?:\/\/.+/i), Validators.maxLength(300)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(150)]],
    address: ['', [Validators.required, Validators.minLength(5), Validators.maxLength(500)]],
    isActive: [true]
  });

  ngOnInit(): void {
    if (!this.sessionCookieService.hasToken()) {
      void this.router.navigate(['/login']);
      return;
    }

    this.route.url.subscribe((segments) => {
      const lastSegment = segments.at(-1)?.path ?? '';
      if (lastSegment === 'new') {
        this.pageMode = 'create';
        this.editingCompanyId = null;
        this.resetCompanyForm();
        this.destroyDataTable();
        return;
      }

      if (lastSegment === 'edit') {
        this.pageMode = 'edit';
        this.destroyDataTable();
        const idParam = this.route.snapshot.paramMap.get('id');
        const companyId = Number(idParam);
        if (!Number.isNaN(companyId) && companyId > 0) {
          this.editingCompanyId = companyId;
          this.loadCompanyForEdit(companyId);
        }
        return;
      }

      this.pageMode = 'table';
      this.editingCompanyId = null;
      this.loadCompanies();
    });
  }

  ngOnDestroy(): void {
    this.destroyDataTable();
    this.clearImageObjectUrl();
  }

  protected goToCreatePage(): void {
    void this.router.navigate(['/admin-dashboard/companies/new']);
  }

  protected goToEditPage(companyId: number): void {
    void this.router.navigate(['/admin-dashboard/companies', companyId, 'edit']);
  }

  protected onCompanyImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedProfilePicture = input.files?.[0] ?? null;
    this.clearImageObjectUrl();

    if (this.selectedProfilePicture) {
      this.selectedPictureObjectUrl = URL.createObjectURL(this.selectedProfilePicture);
      this.companyImagePreviewUrl = this.selectedPictureObjectUrl;
      return;
    }

    this.companyImagePreviewUrl = null;
  }

  protected submitCompanyForm(): void {
    if (!this.isAdmin) {
      this.companyErrorMessage = 'Only Admin users can create and edit companies.';
      return;
    }

    if (this.companyForm.invalid || this.isSavingCompany) {
      this.companyForm.markAllAsTouched();
      this.companyErrorMessage = 'Please fill all required fields correctly before saving.';
      return;
    }

    this.companyErrorMessage = '';
    this.companySuccessMessage = '';
    this.isSavingCompany = true;

    const formData = this.buildCompanyFormData();
    const request$ =
      this.pageMode === 'edit' && this.editingCompanyId
        ? this.companyService.updateCompany(this.editingCompanyId, formData)
        : this.companyService.createCompany(formData);

    request$
      .pipe(timeout(15000), finalize(() => (this.isSavingCompany = false)))
      .subscribe({
        next: () => {
          this.companySuccessMessage =
            this.pageMode === 'edit' ? 'Company updated successfully.' : 'Company created successfully.';
          void this.router.navigate(['/admin-dashboard/companies']);
        },
        error: (error) => {
          if (error?.status === 0) {
            this.companyErrorMessage = 'Unable to reach backend API. Please ensure backend is running.';
            return;
          }

          this.companyErrorMessage = typeof error?.error === 'string' ? error.error : 'Unable to save company.';
        }
      });
  }

  protected backToCompanyList(): void {
    void this.router.navigate(['/admin-dashboard/companies']);
  }

  protected toggleCompanyStatus(company: CompanyDto): void {
    if (!this.isAdmin) {
      return;
    }

    const formData = new FormData();
    formData.append('Name', company.name);
    formData.append('Industry', company.industry ?? '');
    formData.append('CompanySize', company.companySize ?? '');
    formData.append('Website', company.website ?? '');
    formData.append('Email', company.email ?? '');
    formData.append('Address', company.address ?? '');
    formData.append('IsActive', String(!company.isActive));

    this.companyService
      .updateCompany(company.companyId, formData)
      .pipe(timeout(15000))
      .subscribe({
        next: () => {
          this.companySuccessMessage = company.isActive
            ? 'Company deactivated successfully.'
            : 'Company activated successfully.';
          this.loadCompanies();
        },
        error: (error) => {
          this.companyErrorMessage =
            typeof error?.error === 'string' ? error.error : 'Unable to update company status.';
        }
      });
  }

  protected resolveProfilePictureUrl(profilePicture: string | null): string | null {
    if (!profilePicture) {
      return null;
    }

    if (profilePicture.startsWith('http://') || profilePicture.startsWith('https://')) {
      return profilePicture;
    }

    return `${this.backendOrigin}${profilePicture}`;
  }

  private loadCompanies(): void {
    this.isLoadingCompanies = true;
    this.companyErrorMessage = '';

    this.companyService
      .getCompanies()
      .pipe(timeout(15000), finalize(() => (this.isLoadingCompanies = false)))
      .subscribe({
        next: (companies) => {
          this.companies = companies;
          this.initializeDataTable();
        },
        error: (error) => {
          this.companyErrorMessage = typeof error?.error === 'string' ? error.error : 'Unable to load companies.';
        }
      });
  }

  private loadCompanyForEdit(companyId: number): void {
    this.companyService
      .getCompanyById(companyId)
      .pipe(timeout(15000))
      .subscribe({
        next: (company) => {
          this.companyForm.patchValue({
            name: company.name,
            industry: company.industry ?? '',
            companySize: company.companySize ?? '',
            website: company.website ?? '',
            email: company.email ?? '',
            address: company.address,
            isActive: company.isActive
          });
          this.companyImagePreviewUrl = this.resolveProfilePictureUrl(company.profilePicture);
        },
        error: () => {
          this.companyErrorMessage = 'Unable to load company details for edit.';
          void this.router.navigate(['/admin-dashboard/companies']);
        }
      });
  }

  private initializeDataTable(): void {
    if (this.pageMode !== 'table') {
      return;
    }

    setTimeout(() => {
      const tableElement = this.companiesDataTable?.nativeElement;
      if (!tableElement) {
        return;
      }

      this.destroyDataTable();
      this.bindTableActions(tableElement);

      this.dataTable = new DataTable(tableElement, {
        data: this.companies,
        searching: true,
        paging: true,
        info: true,
        pageLength: 10,
        lengthMenu: [5, 10, 20, 50],
        columns: [
          {
            data: 'name',
            render: (value: string | null) => this.escapeHtml(value ?? '-')
          },
          {
            data: 'industry',
            render: (value: string | null) => this.escapeHtml(value ?? '-')
          },
          {
            data: 'companySize',
            render: (value: string | null) => this.escapeHtml(value ?? '-')
          },
          {
            data: 'website',
            render: (value: string | null) => this.escapeHtml(value ?? '-')
          },
          {
            data: 'email',
            render: (value: string | null) => this.escapeHtml(value ?? '-')
          },
          {
            data: 'isActive',
            render: (value: boolean) =>
              value
                ? '<span class="badge text-bg-success">Active</span>'
                : '<span class="badge text-bg-secondary">Inactive</span>'
          },
          {
            data: null,
            orderable: false,
            searchable: false,
            render: (_: unknown, __: unknown, row: CompanyDto) =>
              `
              <div class="d-flex gap-2 flex-wrap btn-group">
                <button type="button" class="btn btn-sm btn-outline-primary" data-action="view" data-company-id="${row.companyId}">
                  View
                </button>
                <button type="button" class="btn btn-sm btn-primary" data-action="edit" data-company-id="${row.companyId}" ${this.isAdmin ? '' : 'disabled'}>
                  Edit
                </button>
                <button type="button" class="btn btn-sm btn-outline-secondary" data-action="toggle" data-company-id="${row.companyId}" ${this.isAdmin ? '' : 'disabled'}>
                  ${row.isActive ? 'Deactivate' : 'Activate'}
                </button>
              </div>
              `
          }
        ],
        order: [[0, 'asc']],
        language: {
          emptyTable: 'No companies found.'
        }
      });

      this.bindColumnFilters(tableElement);
    }, 0);
  }

  private bindTableActions(tableElement: HTMLTableElement): void {
    this.tableClickHandler = (event: Event) => {
      const target = event.target as HTMLElement;
      const actionButton = target.closest('button[data-action]') as HTMLButtonElement | null;
      if (!actionButton) {
        return;
      }

      const companyId = Number(actionButton.dataset['companyId']);
      if (Number.isNaN(companyId)) {
        return;
      }

      const action = actionButton.dataset['action'];
      if (action === 'view' || action === 'edit') {
        this.goToEditPage(companyId);
        return;
      }

      if (action === 'toggle') {
        const company = this.companies.find((item) => item.companyId === companyId);
        if (company) {
          this.toggleCompanyStatus(company);
        }
      }
    };

    tableElement.addEventListener('click', this.tableClickHandler);
  }

  private bindColumnFilters(tableElement: HTMLTableElement): void {
    const filterElements = tableElement.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-column]');
    filterElements.forEach((filterElement) => {
      const listener = () => {
        if (!this.dataTable) {
          return;
        }

        const columnIndex = Number(filterElement.dataset['column']);
        if (Number.isNaN(columnIndex)) {
          return;
        }

        if (filterElement instanceof HTMLSelectElement && filterElement.value === 'all') {
          this.dataTable.column(columnIndex).search('').draw();
          return;
        }

        if (filterElement instanceof HTMLSelectElement) {
          this.dataTable.column(columnIndex).search(`^${filterElement.value}$`, true, false).draw();
          return;
        }

        this.dataTable.column(columnIndex).search(filterElement.value).draw();
      };

      filterElement.addEventListener('keyup', listener);
      filterElement.addEventListener('change', listener);
      this.filterCleanupCallbacks.push(() => {
        filterElement.removeEventListener('keyup', listener);
        filterElement.removeEventListener('change', listener);
      });
    });
  }

  private buildCompanyFormData(): FormData {
    const formData = new FormData();
    formData.append('Name', this.companyForm.controls.name.value?.trim() ?? '');
    formData.append('Industry', this.companyForm.controls.industry.value?.trim() ?? '');
    formData.append('CompanySize', this.companyForm.controls.companySize.value?.trim() ?? '');
    formData.append('Website', this.companyForm.controls.website.value?.trim() ?? '');
    formData.append('Email', this.companyForm.controls.email.value?.trim() ?? '');
    formData.append('Address', this.companyForm.controls.address.value?.trim() ?? '');
    formData.append('IsActive', String(this.companyForm.controls.isActive.value ?? true));

    if (this.selectedProfilePicture) {
      formData.append('ProfilePicture', this.selectedProfilePicture);
    }

    return formData;
  }

  private resetCompanyForm(): void {
    this.companyForm.reset({
      name: '',
      industry: '',
      companySize: '',
      website: '',
      email: '',
      address: '',
      isActive: true
    });
    this.selectedProfilePicture = null;
    this.clearImageObjectUrl();
    this.companyImagePreviewUrl = null;
  }

  private clearImageObjectUrl(): void {
    if (this.selectedPictureObjectUrl) {
      URL.revokeObjectURL(this.selectedPictureObjectUrl);
      this.selectedPictureObjectUrl = null;
    }
  }

  private destroyDataTable(): void {
    const tableElement = this.companiesDataTable?.nativeElement;
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

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
}
