import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize, timeout } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { SessionCookieService } from '../../services/session-cookie.service';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly sessionCookieService = inject(SessionCookieService);
  private readonly cdr = inject(ChangeDetectorRef);

  protected isSubmitting = false;
  protected errorMessage = '';

  protected loginForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]]
  });

  constructor() {
    if (this.sessionCookieService.hasToken()) {
      void this.router.navigate(['/admin-dashboard']);
    }
  }

  protected onSubmit(): void {
    if (this.loginForm.invalid || this.isSubmitting) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.errorMessage = '';
    this.isSubmitting = true;

    const requestBody = {
      email: this.loginForm.controls.email.value ?? '',
      password: this.loginForm.controls.password.value ?? ''
    };

    this.authService
      .login(requestBody)
      .pipe(timeout(15000), finalize(() => { this.isSubmitting = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: (response) => {
          this.sessionCookieService.setSession(response);
          void this.router.navigate(['/admin-dashboard']);
        },
        error: (error) => {
          this.loginForm.patchValue({ password: '' });
          this.loginForm.controls.password.markAsPristine();
          this.loginForm.controls.password.markAsUntouched();
          if (error?.status === 401) {
            this.errorMessage = 'Invalid email or password.';
          } else {
            this.errorMessage = typeof error?.error === 'string' ? error.error : 'Unable to login. Please check your credentials.';
          }
          this.cdr.markForCheck();
        }
      });
  }
}
