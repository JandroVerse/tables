import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 403) {
      try {
        const data = JSON.parse(text);
        if (data.shouldClearSession) {
          window.location.href = "/session-ended";
          return;
        }
      } catch (e) {
        // If the response isn't JSON or doesn't have shouldClearSession, treat as regular error
      }
    }
    // Silently handle 401 errors
    if (res.status === 401) {
      throw new Error(`Unauthorized`);
    }
    throw new Error(`${res.status}: ${text || res.statusText}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey[0] as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    if (res.status === 403) {
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        if (data.shouldClearSession) {
          window.location.href = "/session-ended";
          return null;
        }
      } catch (e) {
        // If not JSON or no shouldClearSession, continue with normal error handling
      }
      throw new Error(`${res.status}: ${text}`);
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});