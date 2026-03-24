import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Derive the API base dynamically:
// - On Netlify (dashboard.phillipsbusinessgroup.com): empty string → relative calls to Netlify functions
// - On the platform proxy (/computer/a/{id}/): use the proxy path
// - Locally: empty string → relative calls
function getApiBase(): string {
  if (typeof window === "undefined") return "";
  const path = window.location.pathname;
  // On Perplexity platform proxy: use the proxy path
  const match = path.match(/(\/computer\/a\/[^/]+)/);
  if (match) return `${match[1]}/port/5000`;
  // On Netlify (dashboard.phillipsbusinessgroup.com or pbg-dashboard.netlify.app)
  // call the Railway backend directly
  const host = window.location.hostname;
  if (host.includes("netlify.app") || host.includes("phillipsbusinessgroup.com")) {
    return "https://pbg-tax-roadmap-production.up.railway.app";
  }
  // Local development
  return "";
}
export const API_BASE = getApiBase();

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
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
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`);

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
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
