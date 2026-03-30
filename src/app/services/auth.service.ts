import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type LoginRequest = {
  email: string;
  password: string;
};

export type LoginResponse = {
  token: string;
  expiresAtUtc: string;
  userId: string;
  email: string;
  roles: string[];
};

export type RegisterCandidateRequest = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  password: string;
};

export type MyProfileResponse = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string | null;
  profilePicture: string | null;
  companyId: number | null;
  createdAt: string;
  isActive: boolean;
  lastLoginUtc: string | null;
  company: {
    companyId: number;
    name: string;
    industry: string | null;
    website: string | null;
    email: string | null;
    address: string;
    profilePicture: string | null;
  } | null;
  activityHistory: Array<{ label: string; dateTimeUtc: string }>;
  roles: string[];
};

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  login(payload: LoginRequest): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.apiUrl}/auth/login`, payload);
  }

  registerCandidate(payload: RegisterCandidateRequest): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/auth/register-candidate`, payload);
  }

  getMyProfile(token: string): Observable<MyProfileResponse> {
    return this.http.get<MyProfileResponse>(`${this.apiUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  changeMyPassword(token: string, newPassword: string): Observable<string> {
    return this.http.post(`${this.apiUrl}/auth/change-password`, { newPassword }, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'text'
    });
  }
}
