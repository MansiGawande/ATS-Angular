import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { SessionCookieService } from './session-cookie.service';

export type DepartmentDto = {
  departmentId: number;
  companyId: number;
  departmentName: string;
  isActive: boolean;
  createdAt: string;
};

export type SaveDepartmentRequest = {
  departmentName: string;
  isActive: boolean;
};

@Injectable({
  providedIn: 'root'
})
export class DepartmentService {
  private readonly apiUrl = environment.apiUrl;

  constructor(
    private readonly http: HttpClient,
    private readonly sessionCookieService: SessionCookieService
  ) {}

  getDepartments(): Observable<DepartmentDto[]> {
    return this.http.get<DepartmentDto[]>(`${this.apiUrl}/departments`, {
      headers: this.getAuthHeaders()
    });
  }

  createDepartment(payload: SaveDepartmentRequest): Observable<DepartmentDto> {
    return this.http.post<DepartmentDto>(`${this.apiUrl}/departments`, payload, {
      headers: this.getAuthHeaders()
    });
  }

  updateDepartment(departmentId: number, payload: SaveDepartmentRequest): Observable<DepartmentDto> {
    return this.http.put<DepartmentDto>(`${this.apiUrl}/departments/${departmentId}`, payload, {
      headers: this.getAuthHeaders()
    });
  }

  deactivateDepartment(departmentId: number): Observable<string> {
    return this.http.delete(`${this.apiUrl}/departments/${departmentId}`, {
      headers: this.getAuthHeaders(),
      responseType: 'text'
    });
  }

  private getAuthHeaders(): HttpHeaders {
    const token = this.sessionCookieService.getToken();
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }
}
