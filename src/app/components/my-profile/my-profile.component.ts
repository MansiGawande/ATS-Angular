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
  private readonly requestTimeoutMs = 5000;

  protected profile: MyProfileResponse | null = null;
  protected isLoading = false;
  protected isChangingPassword = false;
  protected errorMessage = '';
  protected successMessage = '';
  protected readonly profileUserId = this.sessionCookieService.getUserId();
  protected readonly roles = this.sessionCookieService.getRoles().map((r) => r.toLowerCase());
  protected readonly canEditInUserManagement = this.roles.includes('admin') || this.roles.includes('hrmanager');
  protected readonly canChangeOwnPassword = this.roles.includes('admin') || this.roles.includes('candidate');

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
    if (!value) {
      return '-';
    }
    return new Date(value).toLocaleString();
  }

  protected goBack(): void {
    this.location.back();
  }

  protected openEditUser(): void {
    if (!this.canEditInUserManagement || !this.profileUserId) {
      return;
    }
    void this.router.navigate(['/admin-dashboard/users', this.profileUserId, 'edit']);
  }

  protected submitPasswordChange(): void {
    if (!this.canChangeOwnPassword) {
      this.errorMessage = 'You are not allowed to change password from self profile.';
      return;
    }
    if (this.passwordForm.invalid || this.isChangingPassword) {
      this.passwordForm.markAllAsTouched();
      return;
    }

    const token = this.sessionCookieService.getToken();
    if (!token) {
      this.errorMessage = 'Session expired. Please login again.';
      return;
    }

    this.isChangingPassword = true;
    this.errorMessage = '';
    this.successMessage = '';
    const newPassword = this.passwordForm.controls.newPassword.value ?? '';
    this.authService
      .changeMyPassword(token, newPassword)
      .pipe(timeout(this.requestTimeoutMs), finalize(() => (this.isChangingPassword = false)))
      .subscribe({
        next: () => {
          this.successMessage = 'Password changed successfully.';
          this.passwordForm.reset({ newPassword: '' });
        },
        error: (error) => {
          if (Array.isArray(error?.error)) {
            this.errorMessage = (error.error as string[]).join(', ');
            return;
          }
          this.errorMessage = typeof error?.error === 'string' ? error.error : 'Unable to change password.';
        }
      });
  }

  private loadProfile(): void {
    const token = this.sessionCookieService.getToken();
    if (!token) {
      this.errorMessage = 'Session expired. Please login again.';
      return;
    }

    // Quick local render to avoid long loading state while API responds.
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
