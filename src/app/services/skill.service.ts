import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { catchError, map, Observable, of, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { SessionCookieService } from './session-cookie.service';

export type SkillMappingDto = {
  id: number;
  companyId: number;
  departmentId: number;
  departmentName: string;
  skillId: number;
  skillName: string;
  isActive: boolean;
  createdAt: string;
};

export type SaveSkillRequest = {
  skillName: string;
  departmentId: number;
  isActive: boolean;
};

export type UpdateSkillMappingStatusRequest = {
  isActive: boolean;
};

type LegacySkillDto = {
  skillId: number;
  skillName: string;
  isActive: boolean;
};

@Injectable({
  providedIn: 'root'
})
export class SkillService {
  private readonly apiUrl = environment.apiUrl;
  private mappingsEndpointAvailable: boolean | null = null;

  constructor(
    private readonly http: HttpClient,
    private readonly sessionCookieService: SessionCookieService
  ) {}

  getSkillMappings(): Observable<SkillMappingDto[]> {
    if (this.mappingsEndpointAvailable === false) {
      return this.getLegacySkillMappings();
    }

    return this.http
      .get<SkillMappingDto[]>(`${this.apiUrl}/skills/mappings`, {
        headers: this.getAuthHeaders()
      })
      .pipe(
        map((mappings) => {
          this.mappingsEndpointAvailable = true;
          return mappings;
        }),
        catchError((error) => {
          if (error?.status !== 404) {
            return throwError(() => error);
          }

          this.mappingsEndpointAvailable = false;
          return this.getLegacySkillMappings();
        })
      );
  }

  createSkill(payload: SaveSkillRequest): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/skills`, payload, {
      headers: this.getAuthHeaders()
    });
  }

  updateSkillMapping(mappingId: number, payload: SaveSkillRequest): Observable<unknown> {
    if (mappingId < 0) {
      return this.updateLegacySkill(-mappingId, payload);
    }
    return this.http.put(`${this.apiUrl}/skills/mappings/${mappingId}`, payload, {
      headers: this.getAuthHeaders()
    });
  }

  updateSkillMappingStatus(mappingId: number, isActive: boolean): Observable<unknown> {
    if (mappingId < 0) {
      return this.updateLegacySkillStatus(-mappingId, isActive);
    }
    const payload: UpdateSkillMappingStatusRequest = { isActive };
    return this.http.patch(`${this.apiUrl}/skills/mappings/${mappingId}/status`, payload, {
      headers: this.getAuthHeaders()
    });
  }

  private getLegacySkillMappings(): Observable<SkillMappingDto[]> {
    return this.http
      .get<LegacySkillDto[]>(`${this.apiUrl}/skills`, {
        headers: this.getAuthHeaders()
      })
      .pipe(
        map((skills) =>
          skills.map(
            (skill): SkillMappingDto => ({
              id: -skill.skillId,
              companyId: 0,
              departmentId: 0,
              departmentName: '-',
              skillId: skill.skillId,
              skillName: skill.skillName,
              isActive: skill.isActive,
              createdAt: new Date().toISOString()
            })
          )
        ),
        catchError(() => of([]))
      );
  }

  private updateLegacySkill(skillId: number, payload: SaveSkillRequest): Observable<unknown> {
    return this.http.put(`${this.apiUrl}/skills/${skillId}`, payload, {
      headers: this.getAuthHeaders()
    });
  }

  private updateLegacySkillStatus(skillId: number, isActive: boolean): Observable<unknown> {
    if (!isActive) {
      return this.http.delete(`${this.apiUrl}/skills/${skillId}`, {
        headers: this.getAuthHeaders()
      });
    }

    return throwError(
      () => new Error('Please edit the skill and set a valid department to activate legacy skill mappings.')
    );
  }

  private getAuthHeaders(): HttpHeaders {
    const token = this.sessionCookieService.getToken();
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }
}
