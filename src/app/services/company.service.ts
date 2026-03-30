import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { SessionCookieService } from './session-cookie.service';

export type CompanyDto = {
  companyId: number;
  name: string;
  industry: string | null;
  companySize: string | null;
  website: string | null;
  email: string | null;
  address: string;
  profilePicture: string | null;
  isActive: boolean;
  createdDate: string;
};

@Injectable({
  providedIn: 'root'
})
export class CompanyService {
  private readonly apiUrl = environment.apiUrl;

  constructor(
    private readonly http: HttpClient,
    private readonly sessionCookieService: SessionCookieService
  ) {}

  getCompanies(): Observable<CompanyDto[]> {
    return this.http.get<CompanyDto[]>(`${this.apiUrl}/setup/companies`, {
      headers: this.getAuthHeaders()
    });
  }

  getCompanyById(companyId: number): Observable<CompanyDto> {
    return this.http.get<CompanyDto>(`${this.apiUrl}/setup/companies/${companyId}`, {
      headers: this.getAuthHeaders()
    });
  }

  createCompany(formData: FormData): Observable<CompanyDto> {
    return this.http.post<CompanyDto>(`${this.apiUrl}/setup/companies`, formData, {
      headers: this.getAuthHeaders()
    });
  }

  updateCompany(companyId: number, formData: FormData): Observable<CompanyDto> {
    return this.http.put<CompanyDto>(`${this.apiUrl}/setup/companies/${companyId}`, formData, {
      headers: this.getAuthHeaders()
    });
  }

  private getAuthHeaders(): HttpHeaders {
    const token = this.sessionCookieService.getToken();
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }
}
