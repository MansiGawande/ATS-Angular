import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize, timeout } from 'rxjs';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrl: './register.component.css'
})
export class RegisterComponent {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);

  protected isSubmitting = false;
  protected errorMessage = '';
  protected successMessage = '';

  protected registerForm = this.fb.group(
    {
      firstName: ['', [Validators.required, Validators.maxLength(100)]],
      lastName: ['', [Validators.required, Validators.maxLength(100)]],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', []],
      password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(100)]],
      confirmPassword: ['', [Validators.required]]
    },
    { validators: this.passwordMatchValidator }
  );

  protected onSubmit(): void {
    if (this.registerForm.invalid || this.isSubmitting) {
      this.registerForm.markAllAsTouched();
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';
    this.isSubmitting = true;

    const { firstName, lastName, email, phone, password } = this.registerForm.value;

    this.authService
      .registerCandidate({
        firstName: firstName ?? '',
        lastName: lastName ?? '',
        email: email ?? '',
        phone: phone || null,
        password: password ?? ''
      })
      .pipe(timeout(15000), finalize(() => (this.isSubmitting = false)))
      .subscribe({
        next: () => {
          this.successMessage = 'Registration successful! You can now login.';
          this.registerForm.reset();
          setTimeout(() => void this.router.navigate(['/login']), 2000);
        },
        error: (error) => {
          if (error?.status === 409) {
            this.errorMessage = 'This email is already registered.';
            return;
          }
          if (Array.isArray(error?.error)) {
            this.errorMessage = (error.error as string[]).join(' ');
            return;
          }
          this.errorMessage =
            typeof error?.error === 'string' ? error.error : 'Registration failed. Please try again.';
        }
      });
  }

  private passwordMatchValidator(group: import('@angular/forms').AbstractControl): { [key: string]: boolean } | null {
    const pw = group.get('password')?.value as string;
    const cpw = group.get('confirmPassword')?.value as string;
    return pw && cpw && pw !== cpw ? { passwordMismatch: true } : null;
  }
}
