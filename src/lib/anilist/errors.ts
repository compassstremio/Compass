export class AnilistApiError extends Error {
  status: number;
  body: string;

  // Plain fields, not parameter properties: Node's type stripping (used by the tests) rejects the latter.
  constructor(status: number, body: string) {
    super(`AniList HTTP ${status}: ${body.slice(0, 200)}`);
    this.status = status;
    this.body = body;
  }

  get isAuthenticationError(): boolean {
    if (this.status === 401) return true;
    if (this.status !== 400 && this.status !== 200) return false;
    let messages = [this.body];
    try {
      const parsed = JSON.parse(this.body);
      messages = parsed.errors?.map((error: { message?: string }) => error.message ?? "") ?? [];
    } catch { /* GraphQL errors may already be reduced to their message. */ }
    return messages.some(message => /^(invalid token|token (?:has )?expired|unauthenticated)\.?$/i.test(message.trim()));
  }
}
