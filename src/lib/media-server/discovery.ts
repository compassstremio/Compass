import { mediaServerAdapter } from "./sync";
import { candidateServerOrigins } from "./transport";
import type { AuthResult, MediaServerConnection, MediaServerProvider } from "./types";

/**
 * A server that answered with an HTTP status (for example a 401 for wrong
 * credentials) is more useful to report than a transport failure from a
 * fallback scheme, which often hides the real problem.
 */
function mostInformativeFailure(failures: string[]): string | undefined {
  return (
    failures.find((message) => /media server request failed \(\d{3}\)/i.test(message)) ??
    failures.at(-1)
  );
}

export async function discoverAndAuthenticate(
  provider: MediaServerProvider,
  address: string,
  credentials: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ origin: string; auth: AuthResult }> {
  const failures: string[] = [];
  signal?.throwIfAborted();
  for (const origin of candidateServerOrigins(address, provider)) {
    try {
      signal?.throwIfAborted();
      const adapter = mediaServerAdapter({ provider, origin } as MediaServerConnection);
      const auth = await adapter.authenticate(credentials);
      signal?.throwIfAborted();
      return { origin, auth };
    } catch (cause) {
      signal?.throwIfAborted();
      failures.push(cause instanceof Error ? cause.message : String(cause));
    }
  }
  throw new Error(
    mostInformativeFailure(failures) ?? "Could not find a media server at that address",
  );
}

export async function discoverExistingConnection(
  connection: MediaServerConnection,
  address: string,
  signal?: AbortSignal,
): Promise<string> {
  const failures: string[] = [];
  signal?.throwIfAborted();
  for (const origin of candidateServerOrigins(address, connection.provider)) {
    try {
      signal?.throwIfAborted();
      await mediaServerAdapter({ ...connection, origin }).libraries({ ...connection, origin });
      signal?.throwIfAborted();
      return origin;
    } catch (cause) {
      signal?.throwIfAborted();
      failures.push(cause instanceof Error ? cause.message : String(cause));
    }
  }
  throw new Error(
    mostInformativeFailure(failures) ?? "Could not find a media server at that address",
  );
}
