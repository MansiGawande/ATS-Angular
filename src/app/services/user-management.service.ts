import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { catchError, Observable, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { SessionCookieService } from './session-cookie.service';

export type ManagedUserDto = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string | null;
  companyId: number | null;
  isActive: boolean;
  createdAt: string;
  profilePicture: string | null;
  role: string;
  lastLoginAtUtc: string | null;
};

@Injectable({
  providedIn: 'root'
})
export class UserManagementService {
  private readonly apiUrl = environment.apiUrl;

  constructor(
    private readonly http: HttpClient,
    private readonly sessionCookieService: SessionCookieService
  ) {}

  getUsers(): Observable<ManagedUserDto[]> {
    return this.http.get<ManagedUserDto[]>(`${this.apiUrl}/setup/users`, {
      headers: this.getAuthHeaders()
    });
  }

  getUserById(userId: string): Observable<ManagedUserDto> {
    return this.http.get<ManagedUserDto>(`${this.apiUrl}/setup/users/${userId}`, {
      headers: this.getAuthHeaders()
    });
  }

  createUser(formData: FormData): Observable<ManagedUserDto> {
    return this.http
      .post<ManagedUserDto>(`${this.apiUrl}/setup/users`, formData, {
        headers: this.getAuthHeaders()
      })
      .pipe(
        catchError((error) => {
          // Backward compatibility while backend still exposes legacy setup endpoints.
          if (error?.status !== 404) {
            return throwError(() => error);
          }

          const role = String(formData.get('Role') ?? '').trim();
          if (role === 'HRManager') {
            return this.http.post<ManagedUserDto>(`${this.apiUrl}/setup/hr-managers`, formData, {
              headers: this.getAuthHeaders()
            });
          }

          if (role === 'Recruiter') {
            return this.http.post<ManagedUserDto>(`${this.apiUrl}/setup/recruiters`, formData, {
              headers: this.getAuthHeaders()
            });
          }

          if (role === 'Interviewer') {
            return this.http.post<ManagedUserDto>(`${this.apiUrl}/setup/interviewers`, formData, {
              headers: this.getAuthHeaders()
            });
          }

          return throwError(() => error);
        })
      );
  }

  updateUser(userId: string, formData: FormData): Observable<ManagedUserDto> {
    return this.http.put<ManagedUserDto>(`${this.apiUrl}/setup/users/${userId}`, formData, {
      headers: this.getAuthHeaders()
    });
  }

  updateUserStatus(userId: string, isActive: boolean): Observable<ManagedUserDto> {
    return this.http.patch<ManagedUserDto>(
      `${this.apiUrl}/setup/users/${userId}/status`,
      { isActive },
      { headers: this.getAuthHeaders() }
    );
  }

  changePassword(userId: string, newPassword: string): Observable<string> {
    return this.http.post(`${this.apiUrl}/setup/users/${userId}/change-password`, { newPassword }, {
      headers: this.getAuthHeaders(),
      responseType: 'text'
    });
  }

  private getAuthHeaders(): HttpHeaders {
    const token = this.sessionCookieService.getToken();
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }
}
