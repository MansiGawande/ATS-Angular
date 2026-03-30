import { Injectable } from '@angular/core';

type LoginSessionPayload = {
  token: string;
  expiresAtUtc: string;
  userId: string;
  email: string;
  roles: string[];
};

@Injectable({
  providedIn: 'root'
})
export class SessionCookieService {
  private readonly tokenKey = 'ats_token';
  private readonly userIdKey = 'ats_user_id';
  private readonly emailKey = 'ats_user_email';
  private readonly rolesKey = 'ats_user_roles';

  setSession(session: LoginSessionPayload): void {
    const expiresAt = this.tryParseExpiry(session.expiresAtUtc);
    this.setCookie(this.tokenKey, session.token, expiresAt);
    this.setCookie(this.userIdKey, session.userId, expiresAt);
    this.setCookie(this.emailKey, session.email, expiresAt);
    this.setCookie(this.rolesKey, JSON.stringify(session.roles), expiresAt);
  }

  clearSession(): void {
    this.deleteCookie(this.tokenKey);
    this.deleteCookie(this.userIdKey);
    this.deleteCookie(this.emailKey);
    this.deleteCookie(this.rolesKey);
  }

  hasToken(): boolean {
    return Boolean(this.getToken());
  }

  getToken(): string {
    return this.getCookie(this.tokenKey);
  }

  getEmail(): string {
    return this.getCookie(this.emailKey);
  }

  getUserId(): string {
    return this.getCookie(this.userIdKey);
  }

  getRoles(): string[] {
    const rawRoles = this.getCookie(this.rolesKey);
    if (!rawRoles) {
      return [];
    }

    try {
      const parsed = JSON.parse(rawRoles);
      return Array.isArray(parsed) ? parsed.map((role) => String(role)) : [];
    } catch {
      return [];
    }
  }

  private setCookie(name: string, value: string, expiresAt: Date | null): void {
    const encodedValue = encodeURIComponent(value);
    if (expiresAt) {
      document.cookie = `${name}=${encodedValue}; expires=${expiresAt.toUTCString()}; path=/; SameSite=Lax`;
      return;
    }

    document.cookie = `${name}=${encodedValue}; path=/; SameSite=Lax`;
  }

  private getCookie(name: string): string {
    const cookieName = `${name}=`;
    const parts = document.cookie.split(';');

    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.startsWith(cookieName)) {
        return decodeURIComponent(trimmed.substring(cookieName.length));
      }
    }

    return '';
  }

  private deleteCookie(name: string): void {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`;
  }

  private tryParseExpiry(expiresAtUtc: string): Date | null {
    const parsedDate = new Date(expiresAtUtc);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate <= new Date()) {
      return null;
    }

    return parsedDate;
  }
}
