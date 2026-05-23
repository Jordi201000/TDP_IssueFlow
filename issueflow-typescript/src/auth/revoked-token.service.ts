import { Injectable } from '@nestjs/common';

@Injectable()
export class RevokedTokenService {
  private readonly revokedUntil = new Map<string, number>();

  revoke(jti: string, expiresAtSeconds: number): void {
    this.prune();
    this.revokedUntil.set(jti, expiresAtSeconds);
  }

  isRevoked(jti: string): boolean {
    this.prune();
    return this.revokedUntil.has(jti);
  }

  private prune(): void {
    const nowSeconds = Math.floor(Date.now() / 1000);
    for (const [jti, expiresAtSeconds] of this.revokedUntil.entries()) {
      if (expiresAtSeconds <= nowSeconds) {
        this.revokedUntil.delete(jti);
      }
    }
  }
}
