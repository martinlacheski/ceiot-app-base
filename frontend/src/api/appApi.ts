import axios from "axios";
import { useAuthStore } from "@/auth/store/auth.store";
import { API_BASE_URL } from "@/lib/apiBaseUrl";

const appApi = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

appApi.interceptors.request.use((config) => {
  // Use generic import to avoid circular dependency issues if possible,
  // but direct import of store is standard in Zustand.
  // We need to use "getState()" to get the current token.
  // Dynamic import to avoid circular dependency if this file is imported by store
  // But usually store imports api, so api importing store is circular.
  // Solution: Inject token or use a callback?
  // Or better: use a separate file for store if possible, OR just access localStorage?
  // User wants memory storage.
  // We can use a circular ref workaround or inject the store.
  // For now let's try direct import, if circular, we'll fix.
  // Actually, we can move appApi creation to a separate file or use a cleanup.

  // Standard pattern:
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

appApi.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Prevent infinite loop if refresh endpoint itself fails
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url.includes("/auth/refresh")
    ) {
      originalRequest._retry = true;

      try {
        const { data } = await appApi.post("/auth/refresh");

        // Update store with new access token
        useAuthStore.getState().loginWithToken(data.access_token);

        // Update header and retry
        originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
        return appApi(originalRequest);
      } catch (refreshError) {
        // Refresh failed, logout
        useAuthStore.getState().logout();
        return Promise.reject(refreshError);
      }
    }

    // If refresh failed or other 401
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
    }

    return Promise.reject(error);
  }
);

export { appApi };
