import { ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize, Subscription, timeout } from 'rxjs';
import DataTable from 'datatables.net-bs5';
import { CompanyDto, CompanyService } from '../../services/company.service';
import { SessionCookieService } from '../../services/session-cookie.service';
import { ManagedUserDto, UserManagementService } from '../../services/user-management.service';
import { environment } from '../../../environments/environment';

type UserPageMode = 'table' | 'form' | 'details' | 'password';
type UserHierarchyRowType = 'group' | 'user';

type UserTableRow = {
  id: string;
  rowType: UserHierarchyRowType;
  groupKey: string;
  parentId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  isActive: boolean;
  companyId: number | null;
  lastLoginAtUtc: string | null;
  recruiterCount: number;
  interviewerCount: number;
};

type CompanyDetailsViewModel = {
  name: string;
  industry: string;
  companySize: string;
  email: string;
};

@Component({
  selector: 'app-user-management',
  imports: [ReactiveFormsModule, DatePipe],
  templateUrl: './userManagement.component.html',
  styleUrl: './userManagement.component.css'
})
export class UserManagementComponent implements OnInit, OnDestroy {
  @ViewChild('usersDataTable') protected usersDataTable?: ElementRef<HTMLTableElement>;

  private readonly fb = inject(FormBuilder);
  private readonly userManagementService = inject(UserManagementService);
  private readonly companyService = inject(CompanyService);
  private readonly sessionCookieService = inject(SessionCookieService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly backendOriginUrl = environment.backendOriginUrl;
  private selectedProfilePicture: File | null = null;
  private selectedProfilePictureObjectUrl: string | null = null;
  private routeSubscription?: Subscription;
  private roleValueSubscription?: Subscription;
  private successMessageTimerId: number | null = null;

  private dataTable: any = null;
  private tableClickHandler: ((event: Event) => void) | null = null;
  private filterCleanupCallbacks: Array<() => void> = [];

  protected readonly isAdmin = this.sessionCookieService
    .getRoles()
    .some((role) => role.toLowerCase() === 'admin');
  protected readonly isHrManager = this.sessionCookieService
    .getRoles()
    .some((role) => role.toLowerCase() === 'hrmanager');

  protected pageMode: UserPageMode = 'table';
  protected managedUsers: ManagedUserDto[] = [];
  protected companies: CompanyDto[] = [];
  protected selectedUser: ManagedUserDto | null = null;
  protected isLoadingUsers = false;
  protected isSavingUser = false;
  protected isChangingPassword = false;
  protected userErrorMessage = '';
  protected userSuccessMessage = '';
  protected profilePicturePreviewUrl: string | null = null;
  protected isLoadingUserDetails = false;
  private readonly requestTimeoutMs = 15000;
  private readonly collapsedGroups = new Set<string>();
  private userTableRows: UserTableRow[] = [];

  protected readonly roleOptions = this.isAdmin
    ? ['HRManager', 'Recruiter', 'Interviewer']
    : ['Recruiter', 'Interviewer'];

  protected userForm = this.fb.group({
    firstName: ['', [Validators.required]],
    lastName: ['', [Validators.required]],
    email: ['', [Validators.required, Validators.email]],
    phone: [''],
    role: [this.roleOptions[0] ?? 'Recruiter', [Validators.required]],
    companyId: [null as number | null],
    isActive: [true],
    password: ['', [Validators.minLength(8)]]
  });

  protected passwordForm = this.fb.group({
    newPassword: ['', [Validators.required, Validators.minLength(8)]]
  });

  ngOnInit(): void {
    if (!this.isAdmin && !this.isHrManager) {
      void this.router.navigate(['/admin-dashboard']);
      return;
    }
    this.route.params.subscribe(params => {
    const id = params['id'];
    console.log('users/:id', id);
  }
);
    this.loadCompanies();
    this.routeSubscription = this.route.url.subscribe(() => this.scheduleRouteSync());
    this.roleValueSubscription = this.userForm.controls.role.valueChanges.subscribe(() => this.updateCompanyValidation());
    this.updateCompanyValidation();
    this.loadUsers();
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    this.roleValueSubscription?.unsubscribe();
    this.destroyDataTable();
    this.clearProfilePicturePreview();
    if (this.successMessageTimerId !== null) {
      window.clearTimeout(this.successMessageTimerId);
      this.successMessageTimerId = null;
    }
  }

  protected openCreateForm(): void {
    this.resetUserForm();
    this.pageMode = 'form';
  }

  protected backToTable(reloadUsers = true): void {
    this.isSavingUser = false;
    this.isChangingPassword = false;
    this.pageMode = 'table';
    this.selectedUser = null;
    this.passwordForm.reset({ newPassword: '' });
    this.resetUserForm();
    this.router.navigate(['/admin-dashboard/users']);
    if (reloadUsers) {
      this.loadUsers();
    } else {
      this.initializeDataTable();
    }
  }

  protected submitUserForm(): void {
    if (this.userForm.invalid || this.isSavingUser) {
      this.userForm.markAllAsTouched();
      return;
    }

    this.isSavingUser = true;
    this.userErrorMessage = '';
    this.userSuccessMessage = '';

    const formData = new FormData();
    formData.append('FirstName', this.userForm.controls.firstName.value ?? '');
    formData.append('LastName', this.userForm.controls.lastName.value ?? '');
    formData.append('Email', this.userForm.controls.email.value ?? '');
    formData.append('Phone', this.userForm.controls.phone.value ?? '');
    formData.append('Role', this.userForm.controls.role.value ?? '');
    formData.append('IsActive', String(this.userForm.controls.isActive.value ?? true));

    const companyId = this.userForm.controls.companyId.value;
    if (companyId) {
      formData.append('CompanyId', String(companyId));
    }
    if (this.selectedProfilePicture) {
      formData.append('ProfilePicture', this.selectedProfilePicture);
    }

    const password = this.userForm.controls.password.value ?? '';
    if (!this.selectedUser) {
      if (!password.trim()) {
        this.userForm.controls.password.setErrors({ required: true });
        this.userForm.controls.password.markAsTouched();
        this.isSavingUser = false;
        return;
      }
      formData.append('Password', password);
      this.userManagementService
        .createUser(formData)
        .pipe(timeout(this.requestTimeoutMs), finalize(() => (this.isSavingUser = false)))
        .subscribe({
          next: () => {
            this.showTemporarySuccess('User created successfully.');
            this.backToTable(true);
          },
          error: (error) => {
            if (this.isTimeoutError(error)) {
              this.showTemporarySuccess('Request timed out, but data may be saved. Refreshing users list...');
              this.backToTable(true);
              return;
            }
            this.userErrorMessage = this.getApiErrorMessage(error, 'Unable to create user.');
          }
        });

      return;
    }

    this.userManagementService
      .updateUser(this.selectedUser.id, formData)
      .pipe(timeout(this.requestTimeoutMs), finalize(() => (this.isSavingUser = false)))
      .subscribe({
        next: () => {
          this.showTemporarySuccess('User updated successfully.');
          this.backToTable(true);
        },
        error: (error) => {
          if (this.isTimeoutError(error)) {
            this.showTemporarySuccess('Request timed out, but update may be saved. Refreshing users list...');
            this.backToTable(true);
            return;
          }
          this.userErrorMessage = this.getApiErrorMessage(error, 'Unable to update user.');
        }
      });
  }

  protected getProfilePreviewInitial(): string {
    const firstName = this.userForm.controls.firstName.value?.trim() ?? '';
    const lastName = this.userForm.controls.lastName.value?.trim() ?? '';
    const text = `${firstName}${lastName}`.trim();
    return (text.charAt(0) || 'U').toUpperCase();
  }

  protected submitPasswordForm(): void {
    if (!this.selectedUser || this.passwordForm.invalid || this.isChangingPassword) {
      this.passwordForm.markAllAsTouched();
      return;
    }

    const newPassword = this.passwordForm.controls.newPassword.value ?? '';
    this.isChangingPassword = true;
    this.userErrorMessage = '';
    this.userSuccessMessage = '';

    this.userManagementService
      .changePassword(this.selectedUser.id, newPassword)
      .pipe(timeout(this.requestTimeoutMs), finalize(() => (this.isChangingPassword = false)))
      .subscribe({
        next: () => {
          this.showTemporarySuccess('Password updated successfully.');
          this.backToTable(true);
        },
        error: (error) => {
          this.userErrorMessage = this.getApiErrorMessage(error, 'Unable to change password.');
        }
      });
  }

  private loadCompanies(): void {
    if (!this.isAdmin && !this.isHrManager) {
      return;
    }

    this.companyService.getCompanies().pipe(timeout(this.requestTimeoutMs)).subscribe({
      next: (companies) => {
        this.companies = companies;
        if (this.pageMode === 'table') {
          this.initializeDataTable();
        }
      }
    });
  }

  private loadUsers(): void {
    this.isLoadingUsers = true;
    this.userErrorMessage = '';

    this.userManagementService
      .getUsers()
      .pipe(timeout(this.requestTimeoutMs), finalize(() => (this.isLoadingUsers = false)))
      .subscribe({
        next: (users) => {
          this.collapsedGroups.clear();
          this.managedUsers = users;
          this.scheduleRouteSync();
        },
        error: (error) => {
          this.userErrorMessage = this.getApiErrorMessage(error, 'Unable to load users.');
        }
      });
  }

  private initializeDataTable(): void {
    setTimeout(() => {
      const tableElement = this.usersDataTable?.nativeElement;
      if (!tableElement) {
        return;
      }

      this.destroyDataTable();
      this.bindTableActions(tableElement);
      this.userTableRows = this.isAdmin ? this.buildHierarchyRows(this.managedUsers) : this.buildFlatRows(this.managedUsers);

      this.dataTable = new DataTable(tableElement, {
        data: this.userTableRows,
        searching: true,
        paging: true,
        info: true,
        pageLength: 10,
        lengthMenu: [5, 10, 20, 50],
        ordering: !this.isAdmin,
        columns: [
          {
            data: null,
            render: (_: unknown, __: unknown, row: UserTableRow) => this.renderUserNameCell(row)
          },
          {
            data: 'email',
            render: (value: string, _: unknown, row: UserTableRow) =>
              row.rowType === 'group'
                ? `<span class="text-muted">${this.escapeHtml(value)}</span>`
                : this.escapeHtml(value)
          },
          {
            data: 'companyId',
            render: (_: number | null, __: unknown, row: UserTableRow) => this.escapeHtml(this.getCompanyName(row.companyId))
          },
          {
            data: 'role',
            render: (_: string, __: unknown, row: UserTableRow) => this.renderRoleCell(row)
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
            render: (_: unknown, __: unknown, row: UserTableRow) =>
              `
              <div class="btn-toolbar user-action-toolbar" role="toolbar">
                <div class="btn-group btn-group-sm me-1" role="group">
                  <button type="button" class="btn btn-outline-info" data-action="view" data-user-id="${row.id}">View</button>
                  <button type="button" class="btn btn-primary" data-action="edit" data-user-id="${row.id}">Edit</button>
                </div>
                <div class="btn-group btn-group-sm" role="group">
                  <button type="button" class="btn btn-outline-secondary" data-action="toggle" data-user-id="${row.id}">
                    ${row.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  <button type="button" class="btn btn-outline-primary" data-action="password" data-user-id="${row.id}">Password</button>
                </div>
              </div>
              `
          }
        ],
        language: { emptyTable: 'No users found.' },
        createdRow: (row: Node, data: object | any[]) => {
          const typedRow = data as UserTableRow;
          const rowElement = row as HTMLTableRowElement;
          if (typedRow.rowType === 'user' && this.isAdmin && this.collapsedGroups.has(typedRow.groupKey)) {
            rowElement.classList.add('user-child-row-hidden');
          }
          if (typedRow.rowType === 'group') {
            rowElement.classList.add('user-group-row');
          } else if (this.isAdmin) {
            rowElement.classList.add('user-child-row');
            if (typedRow.role === 'Recruiter') {
              rowElement.classList.add('user-row-recruiter');
            } else if (typedRow.role === 'Interviewer') {
              rowElement.classList.add('user-row-interviewer');
            }
          }
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

      const action = actionButton.dataset['action'];
      if (action === 'toggle-group') {
        const groupKey = actionButton.dataset['groupKey'];
        if (!groupKey) {
          return;
        }
        this.toggleGroupVisibility(groupKey);
        return;
      }

      const userId = actionButton.dataset['userId'];
      const user = this.managedUsers.find((item) => item.id === userId);
      if (!user) {
        return;
      }

      if (action === 'edit') {
        this.router.navigate(['/admin-dashboard/users', user.id, 'edit']);
        return;
      }

      if (action === 'view') {
        this.router.navigate(['/admin-dashboard/users', user.id]);
        return;
      }

      if (action === 'password') {
        this.selectedUser = user;
        this.pageMode = 'password';
        this.passwordForm.reset({ newPassword: '' });
        return;
      }

      if (action === 'toggle') {
        this.userManagementService
          .updateUserStatus(user.id, !user.isActive)
          .pipe(timeout(this.requestTimeoutMs))
          .subscribe({
            next: () => {
              this.showTemporarySuccess(
                user.isActive
                ? 'User deactivated successfully.'
                : 'User activated successfully.'
              );
              this.loadUsers();
            },
            error: (error) => {
              this.userErrorMessage = this.getApiErrorMessage(error, 'Unable to update user status.');
            }
          });
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

  private toggleGroupVisibility(groupKey: string): void {
    if (this.collapsedGroups.has(groupKey)) {
      this.collapsedGroups.delete(groupKey);
    } else {
      this.collapsedGroups.add(groupKey);
    }
    this.initializeDataTable();
  }

  private destroyDataTable(): void {
    const tableElement = this.usersDataTable?.nativeElement;
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

  protected onProfilePictureSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedProfilePicture = input.files?.[0] ?? null;
    this.clearProfilePicturePreview();

    if (this.selectedProfilePicture) {
      this.selectedProfilePictureObjectUrl = URL.createObjectURL(this.selectedProfilePicture);
      this.profilePicturePreviewUrl = this.selectedProfilePictureObjectUrl;
      return;
    }

    if (this.selectedUser) {
      this.profilePicturePreviewUrl = this.resolveProfilePictureUrl(this.selectedUser.profilePicture);
    }
  }

  protected resolveProfilePictureUrl(path: string | null): string | null {
    if (!path) {
      return null;
    }
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    return `${this.backendOriginUrl.replace(/\/$/, '')}${path}`;
  }

  protected getSelectedUserCompanyName(): string {
    return this.getCompanyName(this.selectedUser?.companyId ?? null);
  }

  protected getCurrentUserCompanyName(): string {
    if (this.companies.length > 0) {
      return this.companies[0].name;
    }
    return '-';
  }

  protected getSelectedUserCompanyDetails(): CompanyDetailsViewModel {
    const company = this.getCompanyById(this.selectedUser?.companyId ?? null);
    if (!company) {
      return {
        name: this.getCompanyName(this.selectedUser?.companyId ?? null),
        industry: '-',
        companySize: '-',
        email: '-'
      };
    }

    return {
      name: company.name,
      industry: company.industry ?? '-',
      companySize: company.companySize ?? '-',
      email: company.email ?? '-'
    };
  }

  protected getUserActivityHistory(user: ManagedUserDto): string[] {
    const history: string[] = [];
    if (user.lastLoginAtUtc) {
      history.push(`Last login at ${new Date(user.lastLoginAtUtc).toLocaleString()}`);
    }
    if (user.createdAt) {
      history.push(`Account created at ${new Date(user.createdAt).toLocaleString()}`);
    }
    if (history.length === 0) {
      history.push('No login activity is available yet.');
    }
    return history;
  }

  private showTemporarySuccess(message: string): void {
    this.userErrorMessage = '';
    this.userSuccessMessage = message;
    if (this.successMessageTimerId !== null) {
      window.clearTimeout(this.successMessageTimerId);
    }
    this.successMessageTimerId = window.setTimeout(() => {
      if (this.userSuccessMessage === message) {
        this.userSuccessMessage = '';
      }
      this.successMessageTimerId = null;
    }, 3000);
  }

  private buildFlatRows(users: ManagedUserDto[]): UserTableRow[] {
    return users
      .slice()
      .sort((a, b) => a.firstName.localeCompare(b.firstName))
      .map((user) => this.mapUserToRow(user, 'user', user.id, null, 0, 0));
  }

  private buildHierarchyRows(users: ManagedUserDto[]): UserTableRow[] {
    const hrManagers = users
      .filter((user) => user.role === 'HRManager')
      .sort((a, b) => a.firstName.localeCompare(b.firstName));
    const teamMembers = users.filter((user) => user.role === 'Recruiter' || user.role === 'Interviewer');
    const rows: UserTableRow[] = [];
    const assignedUserIds = new Set<string>();

    for (const hrManager of hrManagers) {
      const members = teamMembers.filter((member) => member.companyId === hrManager.companyId);
      members.forEach((member) => assignedUserIds.add(member.id));
      const recruiterCount = members.filter((member) => member.role === 'Recruiter').length;
      const interviewerCount = members.filter((member) => member.role === 'Interviewer').length;
      rows.push(this.mapUserToRow(hrManager, 'group', hrManager.id, null, recruiterCount, interviewerCount));
      for (const member of members.sort((a, b) => a.firstName.localeCompare(b.firstName))) {
        rows.push(this.mapUserToRow(member, 'user', hrManager.id, hrManager.id, 0, 0));
      }
    }

    const remaining = users
      .filter((user) => !assignedUserIds.has(user.id) && user.role !== 'HRManager')
      .sort((a, b) => a.firstName.localeCompare(b.firstName));
    for (const user of remaining) {
      rows.push(this.mapUserToRow(user, 'user', user.id, null, 0, 0));
    }

    return rows;
  }

  private mapUserToRow(
    user: ManagedUserDto,
    rowType: UserHierarchyRowType,
    groupKey: string,
    parentId: string | null,
    recruiterCount: number,
    interviewerCount: number
  ): UserTableRow {
    return {
      id: user.id,
      rowType,
      groupKey,
      parentId,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      companyId: user.companyId,
      lastLoginAtUtc: user.lastLoginAtUtc,
      recruiterCount,
      interviewerCount
    };
  }

  private renderUserNameCell(row: UserTableRow): string {
    const fullName = `${this.escapeHtml(row.firstName)} ${this.escapeHtml(row.lastName)}`.trim();
    if (row.rowType === 'group' && this.isAdmin) {
      const collapsed = this.collapsedGroups.has(row.groupKey);
      const toggleLabel = collapsed ? '+' : '-';
      return `
        <div class="d-flex align-items-center gap-2 hierarchy-cell">
          <button type="button" class="btn btn-sm btn-outline-secondary group-toggle-btn" title="Expand or collapse team" data-action="toggle-group" data-group-key="${row.groupKey}">
            ${toggleLabel}
          </button>
          <div>
            <div class="fw-semibold">${fullName}</div>
            <div class="small mt-1">
              <span class="count-pill recruiters me-1">Recruiters: ${row.recruiterCount}</span>
              <span class="count-pill interviewers">Interviewers: ${row.interviewerCount}</span>
            </div>
          </div>
        </div>
      `;
    }

    if (this.isAdmin && row.parentId) {
      return `<span class="ps-4 hierarchy-child-name">- ${fullName}</span>`;
    }

    return fullName;
  }

  private renderRoleCell(row: UserTableRow): string {
    const role = this.escapeHtml(row.role);
    if (row.role === 'HRManager') {
      return '<span class="role-pill role-hr">HRManager</span>';
    }
    if (row.role === 'Recruiter') {
      return '<span class="role-pill role-recruiter">Recruiter</span>';
    }
    if (row.role === 'Interviewer') {
      return '<span class="role-pill role-interviewer">Interviewer</span>';
    }
    return role;
  }

  private getCompanyName(companyId: number | null): string {
    if (companyId === null) {
      return '-';
    }
    const company = this.getCompanyById(companyId);
    if (company) {
      return company.name;
    }
    return '-';
  }

  private getCompanyById(companyId: number | null): CompanyDto | null {
    if (companyId === null) {
      return null;
    }
    const exact = this.companies.find((item) => item.companyId === companyId);
    if (exact) {
      return exact;
    }
    if (this.isHrManager && this.companies.length === 1) {
      return this.companies[0];
    }
    return null;
  }

  private isTimeoutError(error: unknown): boolean {
    const typed = error as { name?: string; message?: string };
    return typed?.name === 'TimeoutError' || (typed?.message ?? '').includes('Timeout');
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

  private scheduleRouteSync(): void {
    window.setTimeout(() => {
      this.syncRouteMode();
      this.cdr.detectChanges();
      if (this.pageMode === 'table') {
        this.initializeDataTable();
      } else {
        this.destroyDataTable();
      }
    }, 0);
  }

  private clearProfilePicturePreview(): void {
    if (this.selectedProfilePictureObjectUrl) {
      URL.revokeObjectURL(this.selectedProfilePictureObjectUrl);
      this.selectedProfilePictureObjectUrl = null;
    }
    this.profilePicturePreviewUrl = null;
  }

  protected openEditFromDetails(): void {
    if (!this.selectedUser) {
      return;
    }
    this.router.navigate(['/admin-dashboard/users', this.selectedUser.id, 'edit']);
  }

  protected openPasswordFromDetails(): void {
    if (!this.selectedUser) {
      return;
    }
    this.pageMode = 'password';
    this.passwordForm.reset({ newPassword: '' });
  }

  private resetUserForm(): void {
    this.userForm.reset({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      role: this.roleOptions[0] ?? 'Recruiter',
      companyId: null,
      isActive: true,
      password: ''
    });
    this.userForm.markAsPristine();
    this.userForm.markAsUntouched();
    this.selectedProfilePicture = null;
    this.clearProfilePicturePreview();
    this.updateCompanyValidation();
  }

  private openEditForm(user: ManagedUserDto): void {
    this.selectedUser = user;
    this.pageMode = 'form';
    this.userForm.patchValue({
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phoneNumber ?? '',
      role: user.role,
      companyId: user.companyId,
      isActive: user.isActive,
      password: ''
    });
    this.selectedProfilePicture = null;
    this.clearProfilePicturePreview();
    this.profilePicturePreviewUrl = this.resolveProfilePictureUrl(user.profilePicture);
  }

  private syncRouteMode(): void {
    const userId = this.route.snapshot.paramMap.get('id');
    if (!userId) {
      this.pageMode = this.pageMode === 'password' ? 'password' : 'table';
      return;
    }

    const user = this.managedUsers.find((item) => item.id === userId);
    if (!user) {
      this.loadUserForRoute(userId);
      return;
    }

    if (this.router.url.endsWith('/edit')) {
      this.openEditForm(user);
      return;
    }

    this.selectedUser = user;
    this.pageMode = 'details';
    this.profilePicturePreviewUrl = this.resolveProfilePictureUrl(user.profilePicture);
  }

  private loadUserForRoute(userId: string): void {
    if (this.isLoadingUserDetails) {
      return;
    }
    this.isLoadingUserDetails = true;
    this.userManagementService
      .getUserById(userId)
      .pipe(timeout(this.requestTimeoutMs), finalize(() => (this.isLoadingUserDetails = false)))
      .subscribe({
        next: (user) => {
          this.selectedUser = user;
          if (this.router.url.endsWith('/edit')) {
            this.openEditForm(user);
            return;
          }
          this.pageMode = 'details';
          this.profilePicturePreviewUrl = this.resolveProfilePictureUrl(user.profilePicture);
        },
        error: () => {
          this.userErrorMessage = 'Unable to load user details.';
        }
      });
  }

  private updateCompanyValidation(): void {
    if (!this.isAdmin) {
      this.userForm.controls.companyId.clearValidators();
      this.userForm.controls.companyId.updateValueAndValidity({ emitEvent: false });
      return;
    }

    this.userForm.controls.companyId.setValidators([Validators.required]);
    this.userForm.controls.companyId.updateValueAndValidity({ emitEvent: false });
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
