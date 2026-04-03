import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { finalize, timeout } from 'rxjs';
import { AuthService, MyProfileResponse } from '../../services/auth.service';
import { SessionCookieService } from '../../services/session-cookie.service';

@Component({
  selector: 'app-my-profile',
  imports: [ReactiveFormsModule],
  templateUrl: './my-profile.component.html',
  styleUrl: './my-profile.component.css'
})
export class MyProfileComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly sessionCookieService = inject(SessionCookieService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly requestTimeoutMs = 10000;

  protected profile: MyProfileResponse | null = null;
  protected isLoading = false;
  protected isSaving = false;
  protected isChangingPassword = false;
  protected errorMessage = '';
  protected successMessage = '';
  protected editMode = false;
  protected editImageFile: File | null = null;
  protected editImagePreview: string | null = null;

  protected readonly profileUserId = this.sessionCookieService.getUserId();
  protected readonly roles = this.sessionCookieService.getRoles().map((r) => r.toLowerCase());
  protected readonly isCandidate = this.roles.includes('candidate');
  protected readonly canEditInUserManagement = this.roles.includes('admin') || this.roles.includes('hrmanager');
  protected readonly canChangeOwnPassword = this.roles.includes('admin') || this.roles.includes('candidate');

  protected editForm = this.fb.group({
    firstName: ['', [Validators.required, Validators.maxLength(100)]],
    lastName: ['', [Validators.required, Validators.maxLength(100)]],
    phoneNumber: ['', [Validators.maxLength(30)]]
  });

  protected passwordForm = this.fb.group({
    newPassword: ['', [Validators.required, Validators.minLength(8)]]
  });

  ngOnInit(): void {
    this.loadProfile();
  }

  protected get roleSummary(): string {
    return this.profile?.roles?.join(', ') || '-';
  }

  protected formatDateTime(value: string | null): string {
    if (!value) return '-';
    return new Date(value).toLocaleString();
  }

  protected goBack(): void {
    if (this.editMode) {
      this.cancelEdit();
      return;
    }
    this.location.back();
  }

  protected openEditUser(): void {
    if (!this.canEditInUserManagement || !this.profileUserId) return;
    void this.router.navigate(['/admin-dashboard/users', this.profileUserId, 'edit']);
  }

  // ── Candidate self-edit ─────────────────────────

  protected openEdit(): void {
    if (!this.profile) return;
    this.editForm.setValue({
      firstName: this.profile.firstName ?? '',
      lastName: this.profile.lastName ?? '',
      phoneNumber: this.profile.phoneNumber ?? ''
    });
    this.editImageFile = null;
    this.editImagePreview = null;
    this.errorMessage = '';
    this.successMessage = '';
    this.editMode = true;
    this.cdr.markForCheck();
  }

  protected cancelEdit(): void {
    this.editMode = false;
    this.editImageFile = null;
    this.editImagePreview = null;
    this.errorMessage = '';
    this.cdr.markForCheck();
  }

  protected onProfileImagePick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (this.editImagePreview) {
      URL.revokeObjectURL(this.editImagePreview);
      this.editImagePreview = null;
    }
    if (!file) {
      this.editImageFile = null;
      this.cdr.markForCheck();
      return;
    }
    const ext = (file.name.split('.').pop() ?? '').toLowerCase();
    if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
      this.errorMessage = 'Profile picture must be JPG, PNG, or WebP.';
      this.cdr.markForCheck();
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.errorMessage = 'Profile picture must be under 5 MB.';
      this.cdr.markForCheck();
      return;
    }
    this.editImageFile = file;
    this.editImagePreview = URL.createObjectURL(file);
    this.errorMessage = '';
    this.cdr.markForCheck();
  }

  protected submitEdit(): void {
    if (this.editForm.invalid || this.isSaving) {
      this.editForm.markAllAsTouched();
      return;
    }
    const token = this.sessionCookieService.getToken();
    if (!token) {
      this.errorMessage = 'Session expired. Please log in again.';
      return;
    }

    const fd = new FormData();
    fd.append('FirstName', this.editForm.controls.firstName.value?.trim() ?? '');
    fd.append('LastName', this.editForm.controls.lastName.value?.trim() ?? '');
    fd.append('PhoneNumber', this.editForm.controls.phoneNumber.value?.trim() ?? '');
    if (this.editImageFile) {
      fd.append('ProfilePicture', this.editImageFile, this.editImageFile.name);
    }

    this.isSaving = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.cdr.markForCheck();

    this.authService
      .updateMyProfile(token, fd)
      .pipe(timeout(this.requestTimeoutMs), finalize(() => { this.isSaving = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: (updated) => {
          this.profile = updated;
          this.editMode = false;
          if (this.editImagePreview) {
            URL.revokeObjectURL(this.editImagePreview);
            this.editImagePreview = null;
          }
          this.editImageFile = null;
          this.successMessage = 'Profile updated successfully.';
          this.cdr.markForCheck();
        },
        error: (err) => {
          if (Array.isArray(err?.error)) {
            this.errorMessage = (err.error as string[]).join(', ');
          } else {
            this.errorMessage = typeof err?.error === 'string' ? err.error : 'Could not save changes. Please try again.';
          }
          this.cdr.markForCheck();
        }
      });
  }

  // ── Password change ─────────────────────────────

  protected submitPasswordChange(): void {
    if (!this.canChangeOwnPassword) {
      this.errorMessage = 'You are not allowed to change the password from this page.';
      return;
    }
    if (this.passwordForm.invalid || this.isChangingPassword) {
      this.passwordForm.markAllAsTouched();
      return;
    }

    const token = this.sessionCookieService.getToken();
    if (!token) {
      this.errorMessage = 'Session expired. Please log in again.';
      return;
    }

    this.isChangingPassword = true;
    this.errorMessage = '';
    this.successMessage = '';
    const newPassword = this.passwordForm.controls.newPassword.value ?? '';
    this.authService
      .changeMyPassword(token, newPassword)
      .pipe(timeout(this.requestTimeoutMs), finalize(() => { this.isChangingPassword = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: () => {
          this.successMessage = 'Password changed successfully.';
          this.passwordForm.reset({ newPassword: '' });
          this.cdr.markForCheck();
        },
        error: (error) => {
          if (Array.isArray(error?.error)) {
            this.errorMessage = (error.error as string[]).join(', ');
            return;
          }
          this.errorMessage = typeof error?.error === 'string' ? error.error : 'Unable to change password.';
          this.cdr.markForCheck();
        }
      });
  }

  private loadProfile(): void {
    const token = this.sessionCookieService.getToken();
    if (!token) {
      this.errorMessage = 'Session expired. Please log in again.';
      return;
    }

    this.profile = {
      id: this.profileUserId,
      firstName: '',
      lastName: '',
      email: this.sessionCookieService.getEmail(),
      phoneNumber: null,
      profilePicture: null,
      companyId: null,
      createdAt: '',
      isActive: true,
      lastLoginUtc: null,
      company: null,
      activityHistory: [],
      roles: this.sessionCookieService.getRoles()
    };

    this.isLoading = true;
    this.errorMessage = '';
    this.authService
      .getMyProfile(token)
      .pipe(timeout(this.requestTimeoutMs), finalize(() => { this.isLoading = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: (profile) => {
          this.profile = profile;
          this.cdr.markForCheck();
        },
        error: () => {
          this.errorMessage = 'Unable to load profile.';
          this.cdr.markForCheck();
        }
      });
  }
}
