import axios from 'axios';

/**
 * One axios instance for the whole app.
 *
 * The access token lives in memory only — never in localStorage, where any
 * injected script could read it. The long-lived refresh token is an httpOnly
 * cookie the browser sends automatically and JavaScript cannot touch.
 */
const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 30000,
});

let accessToken = null;
let onSessionLost = null;

export const setAccessToken = (token) => {
  accessToken = token;
};

export const getAccessToken = () => accessToken;

export const setSessionLostHandler = (handler) => {
  onSessionLost = handler;
};

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

/* ── Silent refresh ──
   A 401 on any call triggers one refresh attempt, and every request that
   arrived during it waits on the same promise rather than each firing its own
   refresh (which would rotate the token out from under the others). */

let refreshPromise = null;

const refreshSession = async () => {
  refreshPromise =
    refreshPromise ??
    api
      .post('/auth/refresh')
      .then((response) => {
        accessToken = response.data.accessToken;
        return response.data;
      })
      .finally(() => {
        refreshPromise = null;
      });

  return refreshPromise;
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error;

    const isAuthRoute = config?.url?.startsWith('/auth/');
    const canRetry = response?.status === 401 && config && !config.__retried && !isAuthRoute;

    if (canRetry) {
      config.__retried = true;
      try {
        const session = await refreshSession();
        config.headers.Authorization = `Bearer ${session.accessToken}`;
        return api(config);
      } catch {
        accessToken = null;
        onSessionLost?.();
      }
    }

    return Promise.reject(error);
  },
);

/** Pulls a human-readable message out of whatever the server or network gave us. */
export const errorMessage = (error, fallback = 'Something went wrong. Please try again.') => {
  if (!error) return fallback;
  if (error.code === 'ECONNABORTED') return 'That took too long. Check your connection and try again.';
  if (error.message === 'Network Error') return 'We could not reach the server. Check your connection.';
  return error.response?.data?.error?.message ?? error.message ?? fallback;
};

/** Field-level validation messages, keyed by field name. */
export const errorDetails = (error) => error?.response?.data?.error?.details ?? null;

export const errorCode = (error) => error?.response?.data?.error?.code ?? null;

export default api;
